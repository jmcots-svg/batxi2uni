// main.ts - Proxy a Google Gemini / Gemma API amb streaming + rotació resilient de 30 claus
import {
  GoogleGenAI,
  ThinkingLevel,
} from "npm:@google/genai";

const APP_SECRET = Deno.env.get("APP_SECRET") || "";
const rateLimitMap = new Map<string, { count: number; startTime: number }>();
const tokenValidos = new Map<string, number>();

const ALLOWED_ORIGIN_PATTERNS = [
  /^https?:\/\/localhost(:\d+)?$/,
  /^https?:\/\/127\.0\.0\.1(:\d+)?$/,
  /^https:\/\/(www\.)?batxi2uni\.run\.place$/,
  /^https:\/\/api\.batxi2uni\.run\.place$/,
  /^https:\/\/jmcots-svg\.github\.io$/,
];

function isOriginAllowed(origin: string): boolean {
  if (!origin) return true;
  return ALLOWED_ORIGIN_PATTERNS.some((pat) => pat.test(origin));
}

// ========== CONFIGURACIÓ DE MODELS ==========
const MODEL_GEMMA_PRIMARY = "gemma-4-26b-a4b-it";
const MODEL_GEMMA_FALLBACK = "gemma-4-31b-it";
const MODEL_WEB_SEARCH = "gemini-2.5-flash";
const MODEL_URL_INSPECT = "gemini-3.5-flash-lite";

// Límits oficials de Gemma per clau
const GEMMA_LIMITS = {
  MAX_RPM: 28,          // Límit oficial: 30 RPM (marge de seguretat a 28)
  MAX_TPM: 15000,       // Límit oficial: 16.000 TPM (marge a 15K)
  MAX_RPD: 14400,       // Límit oficial: 14.400 RPD
  COOLDOWN_MS: 45000,   // Cooldown si Google retorna 429, 500 o 503
};

// Estat de quota i ús per clau
interface KeyState {
  key: string;
  requestsThisMinute: number[]; // Timestamps de peticions en els darrers 60s
  tokensThisMinute: { time: number; tokens: number }[];
  requestsToday: number;
  lastResetDay: number;
  cooldownUntil: number;
}

const keyStates: KeyState[] = [];

// Funció per carregar totes les claus disponibles (fitxer local .gemini_free_keys o variables d'entorn)
function initApiKeys() {
  if (keyStates.length > 0) return;

  const rawKeys: string[] = [];

  // 1. Intentar llegir el fitxer local .gemini_free_keys
  try {
    const fileContent = Deno.readTextFileSync(".gemini_free_keys");
    const lines = fileContent.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
    if (lines.length > 0) {
      rawKeys.push(...lines);
      console.log(`[API Keys] Carregades ${lines.length} claus des de .gemini_free_keys`);
    }
  } catch {
    // Fitxer no disponible (entorn de producció sense fitxer)
  }

  // 2. Si no s'han trobat claus a l'arxiu, mirar variable d'entorn GEMINI_API_KEYS (llista separada per comes)
  if (rawKeys.length === 0) {
    const envMulti = Deno.env.get("GEMINI_API_KEYS");
    if (envMulti) {
      const parsed = envMulti.split(",").map((k) => k.trim()).filter(Boolean);
      rawKeys.push(...parsed);
      console.log(`[API Keys] Carregades ${parsed.length} claus des de GEMINI_API_KEYS`);
    }
  }

  // 3. Fallback a GEMINI_API_KEY_1..30 o GEMINI_API_KEY
  if (rawKeys.length === 0) {
    for (let i = 1; i <= 30; i++) {
      const k = Deno.env.get(`GEMINI_API_KEY_${i}`);
      if (k && k.trim()) rawKeys.push(k.trim());
    }
    const legacy = Deno.env.get("GEMINI_API_KEY");
    if (legacy && legacy.trim() && !rawKeys.includes(legacy.trim())) {
      rawKeys.push(legacy.trim());
    }
    if (rawKeys.length > 0) {
      console.log(`[API Keys] Carregades ${rawKeys.length} claus des de variables d'entorn individuals`);
    }
  }

  // Inicialitzar estats
  const today = new Date().getUTCDate();
  for (const k of rawKeys) {
    keyStates.push({
      key: k,
      requestsThisMinute: [],
      tokensThisMinute: [],
      requestsToday: 0,
      lastResetDay: today,
      cooldownUntil: 0,
    });
  }

  console.log(`[API Keys] Total claus actives al pool: ${keyStates.length}`);
}

// Netejar mètriques antigues d'una clau
function cleanKeyState(state: KeyState) {
  const now = Date.now();
  const currentDay = new Date().getUTCDate();

  // Reset diari si ha canviat de dia UTC
  if (currentDay !== state.lastResetDay) {
    state.requestsToday = 0;
    state.lastResetDay = currentDay;
  }

  // Netejar peticions de més d'1 minut
  state.requestsThisMinute = state.requestsThisMinute.filter((t) => now - t < 60000);
  state.tokensThisMinute = state.tokensThisMinute.filter((e) => now - e.time < 60000);
}

// Seleccionar la millor clau disponible segons límits de Gemma
function leaseApiKey(): KeyState | null {
  initApiKeys();
  if (keyStates.length === 0) return null;

  const now = Date.now();
  const candidates: { state: KeyState; rpm: number }[] = [];

  for (const state of keyStates) {
    cleanKeyState(state);

    // Descartar si està en cooldown
    if (state.cooldownUntil > now) continue;

    const rpm = state.requestsThisMinute.length;
    const tpm = state.tokensThisMinute.reduce((acc, cur) => acc + cur.tokens, 0);

    // Descartar si supera llindars de seguretat
    if (rpm >= GEMMA_LIMITS.MAX_RPM) continue;
    if (tpm >= GEMMA_LIMITS.MAX_TPM) continue;
    if (state.requestsToday >= GEMMA_LIMITS.MAX_RPD) continue;

    candidates.push({ state, rpm });
  }

  if (candidates.length === 0) {
    // Si totes estan al límit, agafar la que tingui menor temps de cooldown restant
    const sortedByCooldown = [...keyStates].sort((a, b) => a.cooldownUntil - b.cooldownUntil);
    return sortedByCooldown[0] || null;
  }

  // Ordenar candidats per menor RPM actiu
  candidates.sort((a, b) => a.rpm - b.rpm);
  const chosen = candidates[0].state;

  // Registrar petició
  chosen.requestsThisMinute.push(now);
  chosen.requestsToday++;

  return chosen;
}

// Reportar consum de tokens o fallada d'una clau
function reportKeyOutcome(state: KeyState, success: boolean, tokens: number = 0, isRateLimitOrServerError: boolean = false) {
  const now = Date.now();
  if (success) {
    state.tokensThisMinute.push({ time: now, tokens: tokens || 500 });
  } else if (isRateLimitOrServerError) {
    // Posar clau en cooldown preventiu
    state.cooldownUntil = now + GEMMA_LIMITS.COOLDOWN_MS;
    console.warn(`[KeyCoordinator] ⚠️ Clau ...${state.key.slice(-6)} en cooldown durant ${GEMMA_LIMITS.COOLDOWN_MS / 1000}s`);
  }
}

// URLs oficials de PDFs
function getPdfUrls(): string[] {
  const urls: string[] = [];
  const grausUrl = Deno.env.get("PDF_URL_graus") || "https://universitats.gencat.cat/web/.content/02_preinscripcio/enllac-documents/Ponderacions-2026_v7.pdf";
  const notesUrl = Deno.env.get("PDF_URL_notes") || "https://universitats.gencat.cat/web/.content/02_preinscripcio/enllac-documents/notes-de-tall/quadre_comparatiu_nota_tall_juny_2025.pdf";

  if (grausUrl && grausUrl.trim()) urls.push(grausUrl.trim());
  if (notesUrl && notesUrl.trim()) urls.push(notesUrl.trim());
  return urls;
}

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const windowMs = 60000;
  const maxRequests = 30;

  if (!rateLimitMap.has(ip)) {
    rateLimitMap.set(ip, { count: 1, startTime: now });
    return false;
  }

  const data = rateLimitMap.get(ip)!;
  if (now - data.startTime > windowMs) {
    rateLimitMap.set(ip, { count: 1, startTime: now });
    return false;
  }

  data.count++;
  return data.count > maxRequests;
}

function markdownToHTML(markdown: string): string {
  const html = markdown
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br>');
  return `<div class="ai-response"><p>${html}</p></div>`;
}

// ========== PROMPT DE L'ORIENTADOR UNIVERSITARI ==========
const promptDelSistema = `Ets un orientador expert en orientació universitària a Catalunya. El teu objectiu és ajudar a estudiants d'institut de forma ÚTIL, RÀPIDA i CONCISA.

**EL TEU ROL:**
1. Respon DIRECTAMENT a la pregunta de l'usuari.
2. Prioritat estricta en la cerca d'informació:
   a. **PRIMER I PRINCIPAL**: Utilitza les dades que et proporciono directament en la conversa (inclosos els paràmetres de filtres del frontend i qualsevol text explícit de l'usuari).
   b. **SEGON**: Si la informació no està disponible en les dades directes, utilitza el teu coneixement intern com a model d'IA de forma concisa.
   c. **TERCER**: Si la pregunta demana dades molt específiques i actualitzades (portes obertes, telèfons, horaris, preus de crèdit), recomana o ofereix consultar la web oficial de la universitat.
3. Si l'usuari pregunta sobre el contingut o pla d'una carrera:
   - Explica QUÈ ES FARÀ GENERALMENT (matèries típiques, competències, sortides professionals) basant-te en el teu coneixement general.
4. Respon SEMPRE i ÚNICAMENT en català (tret que l'usuari demani expressament respondre en un altre idioma).

**RESTRICCIONS OBLIGATÒRIES:**
- MÀXIM 2-3 paràgrafs breus però INFORMATIUS.
- Sense explicacions teòriques interminables.
- Sense emojis ni artificis innecessaris.
- Mantingues text clar i net.`;

// ========== CONSTANTS DE CONFIRMACIÓ ==========
const PDF_CONFIRMATION_QUESTION = "Vols que consulti aquesta informació als documents PDF oficials que publica la Generalitat de Catalunya? (Sí / No)";
const WEB_CONFIRMATION_QUESTION_CA = "Aquesta informació (portes obertes, telèfons, horaris, preus...) requereix consultar la web oficial a temps real. Vols que faci una cerca a Internet ara mateix? (Sí / No)";
const WEB_CONFIRMATION_QUESTION_ES = "Esta información (puertas abiertas, teléfonos, horarios, precios...) requiere consultar la web oficial en tiempo real. ¿Quieres que busque en Internet ahora mismo? (Sí / No)";

const confirmationYesWords = [
  "sí", "si", "yes", "ok", "vale", "d'acord", "dacord", "endavant",
  "perfecte", "va", "va bé", "sí, si us plau", "si si", "clar", "clar que sí",
  "per favor", "afirmatiu", "confirmo", "adelante", "por favor"
];

const confirmationNoWords = [
  "no", "nop", "no gràcies", "no gracies", "no cal", "deixa",
  "no fa falta", "passa", "cancel", "res", "no gracias"
];

const webSearchKeywords = [
  "portes obertes", "puertas abiertas",
  "telefon", "telèfon", "teléfono", "adreça", "direccio", "dirección", "contacte", "contacto",
  "preu", "precio", "matrícula", "matricula", "taxa", "taxes", "tasas", "credit", "crèdit", "crèdits", "crédito", "créditos",
  "horari", "horario", "torn", "turno",
  "pla d'estudis", "plan de estudios", "guia docent", "guía docente",
  "web oficial", "pagina oficial", "pàgina oficial", "enllaç", "enlace"
];

function isAwaitingPdfConfirmation(messages: any[]): boolean {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "assistant" || messages[i].role === "model") {
      const content = (messages[i].content || "").trim();
      return content === PDF_CONFIRMATION_QUESTION;
    }
  }
  return false;
}

function isAwaitingWebConfirmation(messages: any[]): boolean {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "assistant" || messages[i].role === "model") {
      const content = (messages[i].content || "").trim();
      return content === WEB_CONFIRMATION_QUESTION_CA || content === WEB_CONFIRMATION_QUESTION_ES;
    }
  }
  return false;
}

function isUserConfirmingYes(text: string): boolean {
  const normalized = text.toLowerCase().trim().replace(/[.,!?¿¡]/g, "").trim();
  return confirmationYesWords.some((word) => normalized === word || normalized.startsWith(word));
}

function isUserConfirmingNo(text: string): boolean {
  const normalized = text.toLowerCase().trim().replace(/[.,!?¿¡]/g, "").trim();
  return confirmationNoWords.some((word) => normalized === word || normalized.startsWith(word));
}

function findOriginalUserQuestion(messages: any[], targetQuestions: string[]): string | null {
  let foundConfirmation = false;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (!foundConfirmation) {
      if ((msg.role === "assistant" || msg.role === "model") && targetQuestions.includes((msg.content || "").trim())) {
        foundConfirmation = true;
      }
    } else {
      if (msg.role === "user") {
        return msg.content || "";
      }
    }
  }
  return null;
}

// ========== CRIDA A IA AMB GENERATECONTENTSTREAM I FALLBACK DE 30 CLAUS ==========
interface ExecutionOptions {
  model?: string;
  usePdfs?: boolean;
  useWebSearch?: boolean;
  onChunk?: (text: string) => void;
}

async function callAiStreamWithFallback(
  messagesToSend: any[],
  options: ExecutionOptions = {}
): Promise<{ text: string; model: string; keyUsed: number; tokens: number }> {
  initApiKeys();
  if (keyStates.length === 0) {
    throw new Error("No hi ha claus GEMINI_API_KEY configurades.");
  }

  const { usePdfs = false, useWebSearch = false, onChunk } = options;

  // Selecció del model
  let modelToUse = options.model;
  if (!modelToUse) {
    if (useWebSearch) {
      modelToUse = MODEL_WEB_SEARCH; // gemini-2.5-flash suporta googleSearch al Free Tier
    } else {
      modelToUse = MODEL_GEMMA_PRIMARY; // gemma-4-26b-a4b-it
    }
  }

  // Configuració del model
  const configObj: any = {
    systemInstruction: promptDelSistema,
  };

  // Thinking level minimal per a models que ho suporten
  if (modelToUse.includes("gemma-4") || modelToUse.includes("3.1") || modelToUse.includes("3.5")) {
    configObj.thinkingConfig = {
      thinkingLevel: ThinkingLevel.MINIMAL,
    };
  }

  // Eines de cerca web (només actives per a models que ho suporten)
  if (useWebSearch && modelToUse === MODEL_WEB_SEARCH) {
    configObj.tools = [{ googleSearch: {} }];
  }

  let lastError: any = null;
  const maxAttempts = Math.min(8, keyStates.length);

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const keyState = leaseApiKey();
    if (!keyState) {
      throw new Error("Totes les claus estan ocupades o en cooldown.");
    }

    const keyIndex = keyStates.indexOf(keyState) + 1;
    console.log(`[IA Attempt ${attempt + 1}/${maxAttempts}] Clau #${keyIndex} (...${keyState.key.slice(-6)}) | Model: ${modelToUse}`);

    try {
      const ai = new GoogleGenAI({ apiKey: keyState.key });

      // Cridar generateContentStream
      const responseStream = await ai.models.generateContentStream({
        model: modelToUse,
        contents: messagesToSend,
        config: configObj,
      });

      let accumulatedText = "";
      let totalTokens = 0;

      for await (const chunk of responseStream) {
        const chunkText = chunk.text || "";
        if (chunkText) {
          accumulatedText += chunkText;
          if (onChunk) onChunk(chunkText);
        }
        if (chunk.usageMetadata?.totalTokenCount) {
          totalTokens = chunk.usageMetadata.totalTokenCount;
        }
      }

      // Èxit: reportar mètriques de la clau
      reportKeyOutcome(keyState, true, totalTokens || Math.ceil(accumulatedText.length / 3));
      console.log(`[IA Attempt ${attempt + 1}] ✅ Resposta generada amb èxit (${accumulatedText.length} caràcters)`);

      return {
        text: accumulatedText,
        model: modelToUse,
        keyUsed: keyIndex,
        tokens: totalTokens,
      };

    } catch (err: any) {
      console.warn(`[IA Attempt ${attempt + 1}] Error amb clau #${keyIndex} (${err.status || err.message?.slice(0, 80)})`);
      lastError = err;

      const isRateOrServerError =
        err.status === 429 ||
        err.status === 500 ||
        err.status === 503 ||
        err.message?.includes("429") ||
        err.message?.includes("500") ||
        err.message?.includes("503") ||
        err.message?.includes("quota") ||
        err.message?.includes("demand");

      reportKeyOutcome(keyState, false, 0, isRateOrServerError);

      // Si falla amb el model primari per 503 (sobrecàrrega), provar el model de reserva
      if (modelToUse === MODEL_GEMMA_PRIMARY && (err.status === 503 || err.message?.includes("demand"))) {
        console.log(`[Model Fallback] Commutant a model fallback: ${MODEL_GEMMA_FALLBACK}`);
        modelToUse = MODEL_GEMMA_FALLBACK;
      }

      continue;
    }
  }

  throw lastError || new Error("Totes les claus han fallat.");
}

// ========== SERVIDOR HTTP DENO ==========
Deno.serve(async (req) => {
  const url = new URL(req.url);
  const requestOrigin = req.headers.get("origin") || "";
  const allowedOrigin = isOriginAllowed(requestOrigin) ? requestOrigin : "*";

  const headers = new Headers({
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
    "Access-Control-Allow-Headers": "Content-Type, X-App-Secret, x-app-secret, Accept",
  });

  // OPTIONS (CORS preflight)
  if (req.method === "OPTIONS") {
    headers.set("Access-Control-Max-Age", "86400");
    headers.set("Vary", "Origin");
    return new Response(null, { status: 204, headers });
  }

  // GET /token
  if (req.method === "GET" && url.pathname === "/token") {
    for (const [t, exp] of tokenValidos.entries()) {
      if (Date.now() > exp) tokenValidos.delete(t);
    }
    const token = crypto.randomUUID();
    tokenValidos.set(token, Date.now() + 30000);
    headers.set("Content-Type", "application/json");
    return new Response(JSON.stringify({ token }), { headers });
  }

  // GET / - Status
  if (req.method === "GET" && url.pathname === "/") {
    initApiKeys();
    headers.set("Content-Type", "application/json");
    return new Response(
      JSON.stringify({
        status: "ok",
        message: "Servidor IA actiu (Gemma 4 + Gemini Flash amb rotació de 30 claus)",
        keysConfigured: keyStates.length,
        models: {
          primary: MODEL_GEMMA_PRIMARY,
          fallback: MODEL_GEMMA_FALLBACK,
          search: MODEL_WEB_SEARCH,
        },
      }),
      { headers }
    );
  }

  // POST / - Consulta IA
  if (req.method === "POST" && (url.pathname === "/" || url.pathname === "/chat")) {
    const clientIp = req.headers.get("x-forwarded-for") || "IP_DESCONOCIDA";
    if (isRateLimited(clientIp)) {
      headers.set("Content-Type", "application/json");
      return new Response(
        JSON.stringify({ error: "Has fet massa preguntes seguides. Si us plau, espera un minut." }),
        { status: 429, headers }
      );
    }

    const tokenRecibido = req.headers.get("x-app-secret") || "";
    const expira = tokenValidos.get(tokenRecibido);

    // Si APP_SECRET està configurat o token temporal
    const isLocal = clientIp === "127.0.0.1" || clientIp.includes("localhost") || clientIp === "IP_DESCONOCIDA";
    if (!isLocal && APP_SECRET && tokenRecibido !== APP_SECRET && (!expira || Date.now() > expira)) {
      headers.set("Content-Type", "application/json");
      return new Response(JSON.stringify({ error: "No autoritzat" }), { status: 401, headers });
    }
    if (expira) tokenValidos.delete(tokenRecibido);

    try {
      const body = await req.json();
      initApiKeys();

      if (keyStates.length === 0) {
        headers.set("Content-Type", "application/json");
        return new Response(
          JSON.stringify({ error: "No hi ha claus API configurades al backend." }),
          { status: 500, headers }
        );
      }

      let chatMessages = body.messages;
      if (!chatMessages) {
        const text = body.inputs || body.prompt || "";
        chatMessages = [{ role: "user", content: text }];
      }

      let filteredMessages = chatMessages.filter((msg: any) => msg.role !== "system");
      if (filteredMessages.length > 40) {
        filteredMessages = filteredMessages.slice(-40);
      }

      if (filteredMessages.length === 0) {
        headers.set("Content-Type", "application/json");
        return new Response(
          JSON.stringify({ error: "No hi ha missatges per processar" }),
          { status: 400, headers }
        );
      }

      const wantsStream = req.headers.get("accept")?.includes("text/event-stream") || body.stream === true;
      const lastUserMessage = filteredMessages[filteredMessages.length - 1];
      const lastUserMessageText = (lastUserMessage?.content || "").trim();

      // ============================================================
      // 1. GESTIÓ DE CONFIRMACIÓ DE PDFs
      // ============================================================
      const awaitingPdf = isAwaitingPdfConfirmation(filteredMessages);
      if (awaitingPdf) {
        if (isUserConfirmingYes(lastUserMessageText)) {
          console.log("✅ Usuari CONFIRMA consultar PDFs oficials.");
          const originalQuestion = findOriginalUserQuestion(filteredMessages, [PDF_CONFIRMATION_QUESTION]) || lastUserMessageText;

          const messagesClean = filteredMessages.filter((msg: any) => (msg.content || "").trim() !== PDF_CONFIRMATION_QUESTION);
          messagesClean.pop(); // treure el "sí"

          const messagesForGenAI = messagesClean.map((msg: any) => ({
            role: msg.role === "user" ? "user" : "model",
            parts: [{ text: msg.content }],
          }));

          // Adjuntar PDFs
          const pdfUrls = getPdfUrls();
          if (pdfUrls.length > 0) {
            const urlParts = pdfUrls.map((pdfUrl) => ({
              fileData: { mimeType: "application/pdf", fileUri: pdfUrl },
            }));
            for (let i = 0; i < messagesForGenAI.length; i++) {
              if (messagesForGenAI[i].role === "user") {
                messagesForGenAI[i].parts.push(...urlParts);
              }
            }
          }

          // Execució amb gemini-2.5-flash (admet multimodalitat PDF)
          const result = await callAiStreamWithFallback(messagesForGenAI, {
            model: MODEL_WEB_SEARCH,
            usePdfs: true,
          });

          headers.set("Content-Type", "application/json");
          return new Response(
            JSON.stringify([{
              generated_text: result.text.trim(),
              html: markdownToHTML(result.text),
              metadata: { model: result.model, keyUsed: result.keyUsed, pdfConsulted: true },
            }]),
            { headers }
          );

        } else if (isUserConfirmingNo(lastUserMessageText)) {
          console.log("❌ Usuari REBUTJA consultar PDFs oficials.");
          const messagesClean = filteredMessages.filter((msg: any) => (msg.content || "").trim() !== PDF_CONFIRMATION_QUESTION);
          messagesClean.pop(); // treure el "no"

          const messagesForGenAI = messagesClean.map((msg: any) => ({
            role: msg.role === "user" ? "user" : "model",
            parts: [{ text: msg.content }],
          }));

          const result = await callAiStreamWithFallback(messagesForGenAI, { model: MODEL_GEMMA_PRIMARY });
          headers.set("Content-Type", "application/json");
          return new Response(
            JSON.stringify([{
              generated_text: result.text.trim(),
              html: markdownToHTML(result.text),
              metadata: { model: result.model, keyUsed: result.keyUsed, pdfConsulted: false },
            }]),
            { headers }
          );
        }
      }

      // ============================================================
      // 2. GESTIÓ DE CONFIRMACIÓ DE CERCA WEB
      // ============================================================
      const awaitingWeb = isAwaitingWebConfirmation(filteredMessages);
      if (awaitingWeb) {
        if (isUserConfirmingYes(lastUserMessageText)) {
          console.log("✅ Usuari CONFIRMA cerca web a Internet.");
          const targetQuestions = [WEB_CONFIRMATION_QUESTION_CA, WEB_CONFIRMATION_QUESTION_ES];
          const originalQuestion = findOriginalUserQuestion(filteredMessages, targetQuestions) || lastUserMessageText;

          const messagesClean = filteredMessages.filter((msg: any) => !targetQuestions.includes((msg.content || "").trim()));
          messagesClean.pop(); // treure el "sí"

          const messagesForGenAI = messagesClean.map((msg: any) => ({
            role: msg.role === "user" ? "user" : "model",
            parts: [{ text: msg.content }],
          }));

          const result = await callAiStreamWithFallback(messagesForGenAI, {
            model: MODEL_WEB_SEARCH,
            useWebSearch: true,
          });

          headers.set("Content-Type", "application/json");
          return new Response(
            JSON.stringify([{
              generated_text: result.text.trim(),
              html: markdownToHTML(result.text),
              metadata: { model: result.model, keyUsed: result.keyUsed, webSearched: true },
            }]),
            { headers }
          );

        } else if (isUserConfirmingNo(lastUserMessageText)) {
          console.log("❌ Usuari REBUTJA cerca web a Internet.");
          const targetQuestions = [WEB_CONFIRMATION_QUESTION_CA, WEB_CONFIRMATION_QUESTION_ES];
          const messagesClean = filteredMessages.filter((msg: any) => !targetQuestions.includes((msg.content || "").trim()));
          messagesClean.pop(); // treure el "no"

          const messagesForGenAI = messagesClean.map((msg: any) => ({
            role: msg.role === "user" ? "user" : "model",
            parts: [{ text: msg.content }],
          }));

          const result = await callAiStreamWithFallback(messagesForGenAI, { model: MODEL_GEMMA_PRIMARY });
          headers.set("Content-Type", "application/json");
          return new Response(
            JSON.stringify([{
              generated_text: result.text.trim(),
              html: markdownToHTML(result.text),
              metadata: { model: result.model, keyUsed: result.keyUsed, webSearched: false },
            }]),
            { headers }
          );
        }
      }

      // ============================================================
      // 3. DETECCIONS PROACTIVES (PDFs o CERCA WEB)
      // ============================================================
      const esPrimerMensaje = filteredMessages.length === 1;

      // A. Detecció de paraules clau de PDFs
      const isPdfRelated = !esPrimerMensaje && !awaitingPdf && lastUserMessageText.toLowerCase().includes("pdf");
      if (isPdfRelated) {
        console.log("🔔 Pregunta sobre PDFs detectada. Preguntant a l'usuari...");
        headers.set("Content-Type", "application/json");
        return new Response(
          JSON.stringify([{
            generated_text: PDF_CONFIRMATION_QUESTION,
            html: markdownToHTML(PDF_CONFIRMATION_QUESTION),
            metadata: { model: "confirmation-prompt", awaitingPdfConfirmation: true },
          }]),
          { headers }
        );
      }

      // B. Detecció bilingüe de necessitat de Cerca Web (portes obertes, telèfons, preus...)
      const lowerText = lastUserMessageText.toLowerCase();
      const isWebRelated = !esPrimerMensaje && !awaitingWeb && webSearchKeywords.some((kw) => lowerText.includes(kw));

      if (isWebRelated) {
        console.log("🔔 Pregunta sobre dades web externes detectada. Preguntant a l'usuari...");
        // Detectar si l'usuari escriu en castellà per respondre en castellà
        const isSpanish = /¿|\b(puertas|abiertas|informacion|carrera|gracias|horario|telefono|precio)\b/i.test(lowerText);
        const confirmText = isSpanish ? WEB_CONFIRMATION_QUESTION_ES : WEB_CONFIRMATION_QUESTION_CA;

        headers.set("Content-Type", "application/json");
        return new Response(
          JSON.stringify([{
            generated_text: confirmText,
            html: markdownToHTML(confirmText),
            metadata: { model: "confirmation-prompt", awaitingWebConfirmation: true },
          }]),
          { headers }
        );
      }

      // ============================================================
      // 4. FLUX STANDARD AMB GEMMA 4 (STREAMING O JSON)
      // ============================================================
      const messagesForGenAI = filteredMessages.map((msg: any) => ({
        role: msg.role === "user" ? "user" : "model",
        parts: [{ text: msg.content }],
      }));

      // Si el client sol·licita Server-Sent Events (SSE)
      if (wantsStream) {
        headers.set("Content-Type", "text/event-stream; charset=utf-8");
        headers.set("Cache-Control", "no-cache");
        headers.set("Connection", "keep-alive");

        const stream = new ReadableStream({
          async start(controller) {
            const encoder = new TextEncoder();
            try {
              const res = await callAiStreamWithFallback(messagesForGenAI, {
                model: MODEL_GEMMA_PRIMARY,
                onChunk: (chunkText) => {
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ chunk: chunkText })}\n\n`));
                },
              });
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ done: true, fullText: res.text, model: res.model, keyUsed: res.keyUsed })}\n\n`)
              );
            } catch (err: any) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: err.message })}\n\n`));
            } finally {
              controller.close();
            }
          },
        });

        return new Response(stream, { headers });
      }

      // Resposta clàssica JSON
      const result = await callAiStreamWithFallback(messagesForGenAI, { model: MODEL_GEMMA_PRIMARY });
      headers.set("Content-Type", "application/json");
      return new Response(
        JSON.stringify([{
          generated_text: result.text.trim(),
          html: markdownToHTML(result.text),
          metadata: {
            tokens_used: result.tokens,
            model: result.model,
            keyUsed: result.keyUsed,
          },
        }]),
        { headers }
      );

    } catch (e: any) {
      console.error("Error al servidor:", e);
      headers.set("Content-Type", "application/json");
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers });
    }
  }

  return new Response("Not Found", { status: 404, headers });
});
