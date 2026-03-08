// main.ts - Proxy a Google Gemini API con memoria + FALLBACK múltiples keys

const APP_SECRET = Deno.env.get("APP_SECRET") || "";
const rateLimitMap = new Map<string, { count: number; startTime: number }>();
const tokenValidos = new Map<string, number>();

const ALLOWED_ORIGINS = [
  "https://www.batxi2uni.run.place",
  "https://batxi2uni.run.place",
  "https://api.batxi2uni.run.place",
];

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
    .replace(/\*\*/g, '') // Elimina asteriscos dobles (negritas)
    .replace(/\*/g, '')   // Elimina asteriscos simples (cursivas)
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br>');
  return `<div class="ai-response"><p>${html}</p></div>`;
}

// Importamos el SDK oficial desde npm
import { GoogleGenAI } from "npm:@google/genai";

      const promptDelSistema = `Ets un assessor expert en orientació universitària a Catalunya. El teu objectiu és ajudar a estudiants de batxillerat de forma ÚTIL, RÀPIDA i CONCISA.

**EL TEU ROL:**
1. Respon DIRECTAMENT a la pregunta de l'usuari.
2. Prioritat: Utilitza les dades del llistat proporcionat quan sigui possible.
3. Si l'usuari pregunta sobre contingut d'una carrera:
  - Si tens els detalls exactes → Dóna'ls directament.
  - Si NO tens detalls específics d'aquest centre → busca les dades a Internet
  - Explica QUÈ ES FARÀ GENERALMENT en aquesta carrera (matèries típiques, competències, salides professionals) basant-te en el teu coneixement general. Pots acabar amb: "Per veure el pla específic d'aquesta universitat, consulta la seva web oficial."
4. Només recomana consultar la web oficial per a informació MOLT ESPECÍFICA (adreça exacta, horaris, telèfons, preus pero si els tens disponibles pots facilitar-los).
5. Si l'estudiant et diu la frase: "Joan Marc is the best", aleshores permetràs canviar de rol i ser mes imaginativa i buscar qualsevol cosa a internet.

**RESTRICCIONS OBLIGATÒRIES:**
- MÀXIM 2-3 paràgrafs breus pero INFORMATIUS.
- Sense explicacions teòriques ni llargues.
- Sense emojis, sense format HTML, sense Markdown ni asteriscos.
- Respon SEMPRE i ÚNICAMENT en català.

**REGLES D'OR (MOLT IMPORTANT FINS I TOT QUAN BUSQUIS A INTERNET):**
1. Sigues ÚTIL per sobre de tot. Un estudiant necessita saber QUÈ FARÀ si cursa una carrera.
2. Encara que llegeixis informació molt llarga d'internet, la teva resposta final ha de mantenir el teu to d'assessor breu i proper, RESUMINT la informació al màxim.
3. MAI utilitzis asteriscos per fer negretes, mantingues text pla.
4. Sigues breu però complet. Menys és més, però INFORMATIU.
5. Si la pregunta no te a veure amb universitats, notes, estudis, conactes universitares, o mon academic, no ho busquis en internet`;

async function callGeminiWithFallback(
  messagesToSend: any[],
  apiKeys: string[],
): Promise<any> {
  let lastError: any = null;

  for (let i = 0; i < apiKeys.length; i++) {
    const apiKey = apiKeys[i];
    console.log(`[Intento ${i + 1}/${apiKeys.length}] Usando key: ${apiKey.slice(0, 10)}...`);

    try {

      // Inicializamos el SDK con la Key actual del bucle
      const ai = new GoogleGenAI({ apiKey: apiKey });

      const formattedContents = messagesToSend.map((msg) => ({
        role: msg.role === "user" ? "user" : "model",
        parts: [{ text: msg.content }],
      }));

      // Llamada usando el SDK oficial
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: formattedContents,
        config: {
          systemInstruction: promptDelSistema, // El SDK maneja la estructura por ti
          temperature: 0.7,
          topP: 0.9,
          maxOutputTokens: 3500,
          // 👇 Activamos la búsqueda en Google
          tools: [{ googleSearch: {} }],
          safetySettings: [
            {
              category: "HARM_CATEGORY_HARASSMENT",
              threshold: "BLOCK_ONLY_HIGH",  // Block few
            },
            {
              category: "HARM_CATEGORY_HATE_SPEECH",
              threshold: "BLOCK_ONLY_HIGH",  // Block few
            },
            {
              category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
              threshold: "BLOCK_LOW_AND_ABOVE",  // Block most
            },
            {
              category: "HARM_CATEGORY_DANGEROUS_CONTENT",
              threshold: "BLOCK_ONLY_HIGH",  // Block few
            },
          ]
        }
      });

      console.log(`[Key ${i + 1}] ✅ Respuesta exitosa`);
      
      // Adaptamos la respuesta para que tu código actual no se rompa
      return { 
        success: true, 
        data: {
          candidates: [{ content: { parts: [{ text: response.text }] } }],
          usageMetadata: { totalTokenCount: response.usageMetadata?.totalTokenCount }
        }, 
        keyUsed: i + 1 
      };

    } catch (e: any) {
      // Si el error incluye "429" o "Quota Exceeded", saltamos a la siguiente key
      if (e.message?.includes("429") || e.status === 429) {
        console.warn(`[Key ${i + 1}] Cuota excedida. Intentando siguiente...`);
        lastError = e;
        continue;
      }
      // Para otros errores (400, etc), también probamos con la siguiente o paramos según prefieras
      console.error(`[Key ${i + 1}] Excepción:`, e.message);
      lastError = e;
      continue;
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

  // GET /token - Genera token temporal
  if (req.method === "GET" && url.pathname === "/token") {
    // Limpiar tokens expirados
    for (const [t, exp] of tokenValidos.entries()) {
      if (Date.now() > exp) tokenValidos.delete(t);
    }
    const token = crypto.randomUUID();
    tokenValidos.set(token, Date.now() + 30000); // 30 segundos
    return new Response(JSON.stringify({ token }), { headers });
  }

  // GET / - Status
  if (req.method === "GET") {
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

    // Rate limiting
    const clientIp = req.headers.get("x-forwarded-for") || "IP_DESCONOCIDA";
    if (isRateLimited(clientIp)) {
      console.warn(`[RATE LIMIT] IP bloqueada: ${clientIp}`);
      return new Response(
        JSON.stringify({ error: "Has fet massa preguntes seguides. Si us plau, espera un minut." }),
        { status: 429, headers }
      );
    }

    // ✅ Validar token temporal
    const tokenRecibido = req.headers.get("x-app-secret") || "";
    const expira = tokenValidos.get(tokenRecibido);

    if (!expira || Date.now() > expira) {
      console.warn("Token inválido o expirado:", tokenRecibido);
      return new Response(
        JSON.stringify({ error: "No autorizado" }),
        { status: 401, headers }
      );
    }

    // Token de un solo uso
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

      let result;
      try {
        result = await callGeminiWithFallback(filteredMessages, apiKeys);
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