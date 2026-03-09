// main.ts - Proxy a Google Gemini API con memoria + FALLBACK múltiples keys

const APP_SECRET = Deno.env.get("APP_SECRET") || "";
const rateLimitMap = new Map<string, { count: number; startTime: number }>();
const tokenValidos = new Map<string, number>();

const ALLOWED_ORIGINS = [
  "https://www.batxi2uni.run.place",
  "https://batxi2uni.run.place",
  "https://api.batxi2uni.run.place",
  "https://jmcots-svg.github.io",
];

// Cache para PDFs subidos
const pdfCache = new Map<string, { uri: string, uploadTime: number }>();

// Función para obtener las URLs de los PDFs
function getPdfUrls(): string[] {
  const urls = [];
  const grausUrl = Deno.env.get("PDF_URL_graus");
  const notesUrl = Deno.env.get("PDF_URL_notes");
  
  if (grausUrl && grausUrl.trim()) {
    urls.push(grausUrl.trim());
  }
  if (notesUrl && notesUrl.trim()) {
    urls.push(notesUrl.trim());
  }
  
  console.log(`PDFs configurados: ${urls.length}`);
  console.log(`PDF graus: ${grausUrl ? 'SÍ' : 'NO'}`);
  console.log(`PDF notes: ${notesUrl ? 'SÍ' : 'NO'}`);
  return urls;
}


// ========== FUNCIONES ==========

function getApiKeys(): string[] {
  const keys: string[] = [];
  for (let i = 1; i <= 10; i++) {
    const key = Deno.env.get(`GEMINI_API_KEY_${i}`);
    if (key) keys.push(key);
  }
  if (keys.length === 0) {
    const legacyKey = Deno.env.get("GEMINI_API_KEY");
    if (legacyKey) keys.push(legacyKey);
  }
  return keys;
}

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const windowMs = 60000;
  const maxRequests = 20;

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
  let html = markdown
    .replace(/\*\*/g, '')
    .replace(/\*/g, '')
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br>');
  return `<div class="ai-response"><p>${html}</p></div>`;
}


import {
  GoogleGenAI,
  HarmBlockThreshold,
  HarmCategory,
  ThinkingLevel,
} from "npm:@google/genai";

const promptDelSistema = `Ets un orientador expert en orientació universitària a Catalunya. El teu objectiu és ajudar a estudiants d'institut de forma ÚTIL, RÀPIDA i CONCISA.

**EL TEU ROL:**
1. Respon DIRECTAMENT a la pregunta de l'usuari.
2. Prioritat estricta en la cerca d'informació:
   a. **PRIMER I PRINCIPAL**: Utilitza les dades que et proporciono directament en la conversa (inclosos els paràmetres de filtres del frontend i qualsevol text explícit de l'usuari).
   b. **SEGON**: Si la informació no està disponible en cap de les fonts anteriors (dades directes o PDFs), utilitza el teu coneixement intern com a model de IA. Dóna informació de forma concisa i, si no n'estàs segur al 100%, ves al seguent punt 2c.
   c. **TERCER**: Si la informació no es troba en cap de les fonts anteriors (dades directes, PDFs o el teu coneixement intern), fes una cerca a Internet (Google Search), i dona la resposta indicant que ho has buscat a internet.
   d. **QUART**: Si la pregunta esta relacionada en saber una nota, o les places d'un grau, o les ponderacions d'un grau. Pots contestar: "Pots demanar-me buscar informacio sobre notes, poneracions o places en els PDFs oficials, només m'has de demanar que ho busqui en el PDFs oficials" 
3. Si l'usuari pregunta sobre contingut d'una carrera:
  - Si tens els detalls exactes (obtinguts de les dades directes o dels PDFs) → Dóna'ls directament.
  - Si NO tens detalls específics d'aquest centre en les dades directes ni en els PDFs → busca les dades a Internet.
  - Explica QUÈ ES FARÀ GENERALMENT en aquesta carrera (matèries típiques, competències, salides professionals) basant-te en el teu coneixement general. Pots acabar amb: "Per veure un pla específic consulta la seva web oficial o pots introduïr la URL aquí per a que jo ho revisi ;-)"
4. Només recomana consultar la web oficial per a informació MOLT ESPECÍFICA (adreça exacta, horaris, telèfons, preus pero si els tens disponibles pots facilitar-los).
5. Si l'estudiant et diu la frase: "Joan Marc is the best", aleshores permetràs canviar de rol i ser mes imaginativa i buscar qualsevol cosa a internet (i si pot ser facilita la font).

**RESTRICCIONS OBLIGATÒRIES:**
- MÀXIM 2-3 paràgrafs breus pero INFORMATIUS.
- Sense explicacions teòriques ni llargues.
- Sense emojis, sense format HTML, sense Markdown ni asteriscos.
- Respon SEMPRE i ÚNICAMENT en català.

**REGLES D'OR (MOLT IMPORTANT FINS I TOT QUAN BUSQUIS A INTERNET):**
1. Sigues ÚTIL per sobre de tot. Un estudiant necessita saber QUÈ FARÀ si cursa una especialitat.
2. Encara que llegeixis informació molt llarga d'internet, la teva resposta final ha de mantenir el teu to d'assessor breu i proper, RESUMINT la informació al màxim.
3. MAI utilitzis asteriscos per fer negretes, mantingues text pla.
4. Sigues breu però complet. Menys és més, però INFORMATIU.
5. Si la pregunta no te a veure amb universitats, estudis, conactes universitaris, o mon academic, no ho busquis en internet`;


// ========== CONSTANTES PARA LA LÓGICA DE CONFIRMACIÓN PDF ==========

// Este es el texto EXACTO que el backend devuelve cuando pide confirmación.
// Lo usamos para detectar en el historial si estamos esperando confirmación.
const PDF_CONFIRMATION_QUESTION = "Vols que consulti aquesta informació als documents PDF oficials que publica la Generalitat de Catalunya? (Sí / No)";

// Palabras clave para detectar si la pregunta está relacionada con los PDFs
const pdfKeywords = [
  "pdf",
];

// Palabras que indican confirmación afirmativa del usuario
const confirmationYesWords = [
  "sí", "si", "yes", "ok", "vale", "d'acord", "dacord", "endavant",
  "perfecte", "va", "va bé", "sí, si us plau", "si si", "clar", "clar que sí",
  "per favor", "afirmatiu", "confirmo"
];

// Palabras que indican rechazo
const confirmationNoWords = [
  "no", "nop", "no gràcies", "no gracies", "no cal", "deixa",
  "no fa falta", "passa", "cancel", "res"
];

/**
 * Comprueba si el último mensaje del modelo en el historial
 * es la pregunta de confirmación de PDFs.
 */
function isAwaitingPdfConfirmation(messages: any[]): boolean {
  // Buscar el último mensaje del modelo (assistant/model)
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "assistant" || messages[i].role === "model") {
      const content = (messages[i].content || "").trim();
      return content === PDF_CONFIRMATION_QUESTION;
    }
  }
  return false;
}

/**
 * Detecta si el texto del usuario es una confirmación afirmativa.
 */
function isUserConfirmingYes(text: string): boolean {
  const normalized = text.toLowerCase().trim().replace(/[.,!?¿¡]/g, "").trim();
  return confirmationYesWords.some(word => normalized === word || normalized.startsWith(word));
}

/**
 * Detecta si el texto del usuario es un rechazo.
 */
function isUserConfirmingNo(text: string): boolean {
  const normalized = text.toLowerCase().trim().replace(/[.,!?¿¡]/g, "").trim();
  return confirmationNoWords.some(word => normalized === word || normalized.startsWith(word));
}

/**
 * Busca la última pregunta del usuario ANTES de la pregunta de confirmación del modelo.
 * Es decir, la pregunta original que desencadenó la confirmación.
 */
function findOriginalUserQuestion(messages: any[]): string | null {
  // Buscar hacia atrás: primero encontrar la confirmación del modelo,
  // luego el mensaje del usuario justo antes
  let foundConfirmation = false;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (!foundConfirmation) {
      if ((msg.role === "assistant" || msg.role === "model") &&
          (msg.content || "").trim() === PDF_CONFIRMATION_QUESTION) {
        foundConfirmation = true;
        continue;
      }
    } else {
      if (msg.role === "user") {
        return msg.content || "";
      }
    }
  }
  return null;
}


async function callGeminiWithFallback(
  messagesToSend: any[],
  apiKeys: string[],
  usePdfs: boolean = false,  // ← NUEVO PARÁMETRO
): Promise<any> {
  let lastError: any = null;

  const model1 = 'gemini-2.5-flash';
  const model2 = 'gemini-3.1-flash-lite-preview';

  // 🔥 Solo incluir urlContext si realmente hay PDFs adjuntos
  const tools1 = usePdfs
    ? [{ googleSearch: {} }, { urlContext: {} }]
    : [{ googleSearch: {} }];

  const tools2 = usePdfs
    ? [{ urlContext: {} }]
    : [];

  for (let vuelta = 0; vuelta < 2; vuelta++) {
    for (let i = 0; i < apiKeys.length; i++) {
      const apiKey = apiKeys[i];

      const modelToUse = vuelta === 0 ? model1 : model2;
      const toolsToUse = vuelta === 0 ? tools1 : tools2;

      console.log(`[Intento ${i + 1}/${apiKeys.length}] Key: ${apiKey.slice(0, 10)}... | Modelo: ${modelToUse} | PDFs: ${usePdfs}`);

      try {
        const ai = new GoogleGenAI({ apiKey: apiKey });

        const contentsForGemini = messagesToSend;

        // 🔥 Solo pasar tools si hay alguna herramienta configurada
        const configObj: any = {
          systemInstruction: promptDelSistema,
          temperature: 0.7,
          topP: 0.9,
          maxOutputTokens: 3500,
        };

        if (toolsToUse.length > 0) {
          configObj.tools = toolsToUse;
        }

        const response = await ai.models.generateContent({
          model: modelToUse,
          contents: contentsForGemini,
          config: configObj,
        });

        console.log(`[Key ${i + 1}] ✅ Respuesta exitosa con modelo: ${modelToUse}`);

        return {
          success: true,
          data: {
            candidates: [{ content: { parts: [{ text: response.text }] } }],
            usageMetadata: { totalTokenCount: response.usageMetadata?.totalTokenCount },
            modelVersion: modelToUse,
          },
          keyUsed: i + 1,
          modelUsed: modelToUse,
        };

      } catch (e: any) {
        if (e.message?.includes("429") || e.status === 429) {
          console.warn(`[Key ${i + 1}] Cuota excedida. Intentando siguiente...`);
          lastError = e;
          continue;
        }
        console.error(`[Key ${i + 1}] Excepción:`, e.message);
        lastError = e;
        continue;
      }
    }
  }
  throw { allKeysFailed: true, lastError: lastError, keysAttempted: apiKeys.length };
}

// ========== SERVIDOR ==========

Deno.serve(async (req) => {

  const url = new URL(req.url);
  const requestOrigin = req.headers.get("origin") || "";
  const allowedOrigin = ALLOWED_ORIGINS.includes(requestOrigin)
    ? requestOrigin
    : ALLOWED_ORIGINS[0];

  const headers = new Headers({
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
    "Access-Control-Allow-Headers": "Content-Type, X-App-Secret, x-app-secret",
    "Content-Type": "application/json",
  });

  // OPTIONS
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
    return new Response(JSON.stringify({ token }), { headers });
  }

  // ENDPOINT DE PRUEBA PDFs
  if (req.method === "GET" && url.pathname === "/test-pdfs") {
    const grausUrl = Deno.env.get("PDF_URL_graus");
    const notesUrl = Deno.env.get("PDF_URL_notes");

    return new Response(
      JSON.stringify({
        message: "Debug de variables PDF",
        variables: {
          PDF_URL_graus: {
            exists: !!grausUrl,
            value: grausUrl || "UNDEFINED",
            length: grausUrl ? grausUrl.length : 0,
            trimmed: grausUrl ? grausUrl.trim() : "N/A"
          },
          PDF_URL_notes: {
            exists: !!notesUrl,
            value: notesUrl || "UNDEFINED",
            length: notesUrl ? notesUrl.length : 0,
            trimmed: notesUrl ? notesUrl.trim() : "N/A"
          }
        },
        finalUrls: getPdfUrls()
      }),
      { headers }
    );
  }

  // Endpoint para debug
  if (req.method === "GET" && url.pathname === "/debug") {
    return new Response(
      JSON.stringify({
        method: req.method,
        pathname: url.pathname,
        fullUrl: req.url,
        headers: [...req.headers.entries()],
        env_count: Object.keys(Deno.env.toObject()).length
      }),
      { headers }
    );
  }

  // GET / - Status
  if (req.method === "GET" && url.pathname === "/") {
    const keys = getApiKeys();
    return new Response(
      JSON.stringify({
        status: "ok",
        message: "Servidor IA actiu (Google Gemini)",
        keysConfigured: keys.length,
      }),
      { headers },
    );
  }

  // POST / - Consulta IA
  if (req.method === "POST") {
    console.log(`🔥 POST recibido en: ${url.pathname}`);

    const clientIp = req.headers.get("x-forwarded-for") || "IP_DESCONOCIDA";
    if (isRateLimited(clientIp)) {
      console.warn(`[RATE LIMIT] IP bloqueada: ${clientIp}`);
      return new Response(
        JSON.stringify({ error: "Has fet massa preguntes seguides. Si us plau, espera un minut." }),
        { status: 429, headers }
      );
    }

    const tokenRecibido = req.headers.get("x-app-secret") || "";
    const expira = tokenValidos.get(tokenRecibido);

    if (!expira || Date.now() > expira) {
      console.warn("Token inválido o expirado:", tokenRecibido);
      return new Response(
        JSON.stringify({ error: "No autorizado" }),
        { status: 401, headers }
      );
    }

    tokenValidos.delete(tokenRecibido);

    try {
      const body = await req.json();
      const apiKeys = getApiKeys();

      if (apiKeys.length === 0) {
        return new Response(
          JSON.stringify({ error: "No hay GEMINI_API_KEY configuradas" }),
          { status: 500, headers },
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
        return new Response(
          JSON.stringify({ error: "No hay mensajes para procesar" }),
          { status: 400, headers },
        );
      }

      // ============================================================
      // 🔥 NUEVA LÓGICA DE CONFIRMACIÓN PARA PDFs 🔥
      // ============================================================

      const lastUserMessage = filteredMessages[filteredMessages.length - 1];
      const lastUserMessageText = lastUserMessage
        ? lastUserMessage.content || ""
        : "";

      // CASO A: El modelo preguntó "¿Quieres consultar los PDFs?" y el usuario responde
      const awaitingConfirmation = isAwaitingPdfConfirmation(filteredMessages);

      if (awaitingConfirmation) {
        // El usuario está respondiendo a nuestra pregunta de confirmación

        if (isUserConfirmingYes(lastUserMessageText)) {
          // ✅ Usuario dijo SÍ → Cargar PDFs y reenviar la pregunta original
          console.log("✅ Usuario CONFIRMA consultar PDFs oficiales.");

          const originalQuestion = findOriginalUserQuestion(filteredMessages);

          if (!originalQuestion) {
            console.warn("⚠️ No se encontró la pregunta original. Procesando normalmente.");
          }

          // Construir mensajes para Gemini:
          // Eliminamos del historial la pregunta de confirmación y la respuesta "sí"
          // y reenviamos la pregunta original CON los PDFs adjuntos
          const messagesWithoutConfirmation = filteredMessages.filter((msg: any) => {
            const content = (msg.content || "").trim();
            // Quitar la pregunta de confirmación del modelo
            if ((msg.role === "assistant" || msg.role === "model") &&
                content === PDF_CONFIRMATION_QUESTION) {
              return false;
            }
            return true;
          });

          // Quitar también la respuesta "sí/no" del usuario (último mensaje)
          messagesWithoutConfirmation.pop();

          let messagesForGemini = messagesWithoutConfirmation.map((msg: any) => ({
            role: msg.role === "user" ? "user" : "model",
            parts: [{ text: msg.content }]
          }));

          // Adjuntar PDFs a TODOS los mensajes de usuario
          const pdfUrls = getPdfUrls();
          if (pdfUrls.length > 0) {
            const urlParts = pdfUrls.map(pdfUrl => ({
              fileData: {
                mimeType: "application/pdf",
                fileUri: pdfUrl,
              }
            }));

            for (let i = 0; i < messagesForGemini.length; i++) {
              if (messagesForGemini[i].role === "user") {
                messagesForGemini[i].parts.push(...urlParts);
              }
            }
            console.log(`📎 PDFs adjuntados. Total URLs: ${pdfUrls.length}`);
          }

          // Llamar a Gemini con los PDFs
          let result;
          try {
            result = await callGeminiWithFallback(messagesForGemini, apiKeys, true);
          } catch (error: any) {
            if (error.allKeysFailed) {
              console.error("❌ TODAS LAS KEYS FALLARON", error);
              return new Response(
                JSON.stringify({
                  error: "Todas las claves API han excedido la cuota",
                  keysAttempted: error.keysAttempted,
                  details: error.lastError?.message || "Error desconocido",
                }),
                { status: 503, headers },
              );
            }
            throw error;
          }

          if (!result.success) {
            return new Response(
              JSON.stringify({ error: "Error inesperado" }),
              { status: 502, headers },
            );
          }

          const data = result.data;
          const generatedText =
            data.candidates?.[0]?.content?.parts?.[0]?.text ||
            "No he pogut generar una resposta.";
          const htmlResponse = markdownToHTML(generatedText);

          return new Response(
            JSON.stringify([{
              generated_text: generatedText.trim(),
              html: htmlResponse,
              metadata: {
                tokens_used: data.usageMetadata?.totalTokenCount,
                model: data.modelVersion,
                keyUsed: result.keyUsed,
                pdfConsulted: true,
              },
            }]),
            { headers },
          );

        } else if (isUserConfirmingNo(lastUserMessageText)) {
          // ❌ Usuario dijo NO → Responder sin PDFs
          console.log("❌ Usuario RECHAZA consultar PDFs. Respondiendo sin PDFs.");

          const originalQuestion = findOriginalUserQuestion(filteredMessages);

          // Eliminar confirmación e historial de la pregunta de confirmación
          const messagesWithoutConfirmation = filteredMessages.filter((msg: any) => {
            const content = (msg.content || "").trim();
            if ((msg.role === "assistant" || msg.role === "model") &&
                content === PDF_CONFIRMATION_QUESTION) {
              return false;
            }
            return true;
          });
          messagesWithoutConfirmation.pop(); // Quitar el "no" del usuario

          let messagesForGemini = messagesWithoutConfirmation.map((msg: any) => ({
            role: msg.role === "user" ? "user" : "model",
            parts: [{ text: msg.content }]
          }));

          // Sin PDFs, llamar directamente
          let result;
          try {
            result = await callGeminiWithFallback(messagesForGemini, apiKeys);
          } catch (error: any) {
            if (error.allKeysFailed) {
              return new Response(
                JSON.stringify({
                  error: "Todas las claves API han excedido la cuota",
                  keysAttempted: error.keysAttempted,
                  details: error.lastError?.message || "Error desconocido",
                }),
                { status: 503, headers },
              );
            }
            throw error;
          }

          if (!result.success) {
            return new Response(
              JSON.stringify({ error: "Error inesperado" }),
              { status: 502, headers },
            );
          }

          const data = result.data;
          const generatedText =
            data.candidates?.[0]?.content?.parts?.[0]?.text ||
            "No he pogut generar una resposta.";
          const htmlResponse = markdownToHTML(generatedText);

          return new Response(
            JSON.stringify([{
              generated_text: generatedText.trim(),
              html: htmlResponse,
              metadata: {
                tokens_used: data.usageMetadata?.totalTokenCount,
                model: data.modelVersion,
                keyUsed: result.keyUsed,
                pdfConsulted: false,
              },
            }]),
            { headers },
          );

        }
        // Si no es ni sí ni no, caerá al flujo normal (el usuario dijo otra cosa)
        console.log("🤔 Respuesta ambigua a la confirmación. Procesando como pregunta normal.");
      }

		// CASO B: Pregunta nueva del usuario - comprobar si contiene palabras clave de PDFs

		// 🔥 Si es la PRIMERA pregunta, NUNCA preguntar por PDFs
		const esPrimerMensaje = filteredMessages.length === 1;

		if (esPrimerMensaje) {
		  console.log("➡️ Primera pregunta del usuario. Saltando comprobación de PDFs.");
		}

		// Solo analizar keywords si NO es el primer mensaje
		const isPdfRelated = !esPrimerMensaje && pdfKeywords.some(keyword =>
		  lastUserMessageText.toLowerCase().includes(keyword.toLowerCase())
		);

		if (isPdfRelated && !awaitingConfirmation) {
		  // 🔔 La pregunta es relevante para PDFs → PREGUNTAR AL USUARIO
		  console.log("🔔 Pregunta relacionada con PDFs detectada. Preguntando al usuario...");

		  const htmlResponse = markdownToHTML(PDF_CONFIRMATION_QUESTION);

		  return new Response(
			JSON.stringify([{
			  generated_text: PDF_CONFIRMATION_QUESTION,
			  html: htmlResponse,
			  metadata: {
				tokens_used: 0,
				model: "confirmation-prompt",
				keyUsed: 0,
				awaitingPdfConfirmation: true,
			  },
			}]),
			{ headers },
		  );
		}

      // CASO C: Pregunta normal sin relación con PDFs → Flujo estándar sin PDFs
      console.log("➡️ Pregunta normal. Procesando sin PDFs.");

      let messagesForGemini = filteredMessages.map((msg: any) => ({
        role: msg.role === "user" ? "user" : "model",
        parts: [{ text: msg.content }]
      }));

      let result;
      try {
        result = await callGeminiWithFallback(messagesForGemini, apiKeys);
      } catch (error: any) {
        if (error.allKeysFailed) {
          console.error("❌ TODAS LAS KEYS FALLARON", error);
          return new Response(
            JSON.stringify({
              error: "Todas las claves API han excedido la cuota",
              keysAttempted: error.keysAttempted,
              details: error.lastError?.message || "Error desconocido",
            }),
            { status: 503, headers },
          );
        }
        throw error;
      }

      if (!result.success) {
        return new Response(
          JSON.stringify({ error: "Error inesperado" }),
          { status: 502, headers },
        );
      }

      const data = result.data;
      const generatedText =
        data.candidates?.[0]?.content?.parts?.[0]?.text ||
        "No he pogut generar una resposta.";
      const htmlResponse = markdownToHTML(generatedText);

      return new Response(
        JSON.stringify([{
          generated_text: generatedText.trim(),
          html: htmlResponse,
          metadata: {
            tokens_used: data.usageMetadata?.totalTokenCount,
            model: data.modelVersion,
            keyUsed: result.keyUsed,
          },
        }]),
        { headers },
      );

    } catch (e) {
      console.error("Error servidor:", e);
      return new Response(
        JSON.stringify({ error: e.message }),
        { status: 500, headers },
      );
    }
  }

  return new Response("Not Found", { status: 404, headers });
});