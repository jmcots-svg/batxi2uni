// main.ts - Proxy a Google Gemini API con memoria + FALLBACK múltiples keys

// 👇 NUEVA FUNCIÓN: Obtener todas las keys
function getApiKeys(): string[] {
  const keys: string[] = [];
  for (let i = 1; i <= 10; i++) {
    const key = Deno.env.get(`GEMINI_API_KEY_${i}`);
    if (key) keys.push(key);
  }
  if (keys.length === 0) {
    // Fallback a la key antigua si existen ambas
    const legacyKey = Deno.env.get("GEMINI_API_KEY");
    if (legacyKey) keys.push(legacyKey);
  }
  return keys;
}

// 👇 NUEVA FUNCIÓN: Llamada a Gemini con reintentos
async function callGeminiWithFallback(
  messagesToSend: any[],
  apiKeys: string[],
): Promise<any> {
  let lastError: any = null;

  for (let i = 0; i < apiKeys.length; i++) {
    const apiKey = apiKeys[i];
    console.log(`[Intento ${i + 1}/${apiKeys.length}] Usando key: ${apiKey.slice(0, 10)}...`);

    try {
      
    const promptDelSistema = `Ets un assessor expert en orientació universitària a Catalunya. El teu objectiu és ajudar a estudiants de batxillerat de forma ÚTIL, RÀPIDA i CONCISA.

    **EL TEU ROL:**
    1. Respon DIRECTAMENT a la pregunta de l'usuari.
    2. Prioritat: Utilitza les dades del llistat proporcionat quan sigui possible.
    3. Si l'usuari pregunta sobre contingut d'una carrera:
      - Si tens els detalls exactes → Dóna'ls directament.
      - Si NO tens detalls específics d'aquest centre → Explica QUÈ ES FARÀ GENERALMENT en aquesta carrera (matèries típiques, competències, salides professionals) basant-te en el teu coneixement general.
      - Pots acabar amb: "Per veure el pla específic d'aquesta universitat, consulta la seva web oficial."
    5. Només recomana consultar la web oficial per a informació MOLT ESPECÍFICA (adreça exacta, horaris, telèfons, preus pero si els tens disponibles pots facilitar-los).
	6. Si l'estudiant et diu la frase: "Joan Marc is the best", aleshores permetràs canviar de rol i ser mes imaginativa.

    **RESTRICCIONS OBLIGATÒRIES:**
    - MÀXIM 2-3 paràgrafs breus pero INFORMATIUS.
    - Sense explicacions teòriques ni llargues, però sí amb contingut real i útil.
    - Sense emojis, sense format HTML, sense Markdown ni asteriscos.
    - Respon SEMPRE i ÚNICAMENT en català.

    **REGLES D'OR:**
    1. Sigues ÚTIL per sobre de tot. Un estudiant necessita saber QUÈ FARÀ si cursa una carrera.
    2. Usa el teu coneixement general per donar context quan els detalls específics no estiguin disponibles.
    3. NO repeteixis informació que l'estudiant ja t'ha donat.
    4. Si és sobre les carreres del llistat → Dona prioritat als dades reals que tens.
    5. Sigues breu però complet. Menys és més, però INFORMATIU.`;


// 2. LUEGO haces el fetch, usando esa variable:
const geminiResponse = await fetch(
  `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
  {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      // AQUÍ USAMOS LA VARIABLE QUE ACABAMOS DE DEFINIR
      systemInstruction: {
        parts: [
          {
            text: promptDelSistema 
          }
        ]
      },
      contents: messagesToSend.map((msg) => ({
        role: msg.role === "user" ? "user" : "model",
        parts: [
          {
            text: msg.content,
          },
        ],
      })),
      generationConfig: {
        maxOutputTokens: 3500,
        temperature: 0.7,
        topP: 0.9,
      },
      safetySettings: [
        { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
      ],
    }),
  }
);

      // Si es 429 (cuota excedida), continúa con la siguiente key
      if (geminiResponse.status === 429) {
        const errorData = await geminiResponse.json();
        console.warn(
          `[Key ${i + 1}] Cuota excedida. Intentando siguiente...`,
          errorData.error?.message?.split("\n")[0],
        );
        lastError = errorData;
        continue;
      }

      // Si es otro error, fallar inmediatamente
      if (!geminiResponse.ok) {
        const errorDetails = await geminiResponse.text();
        console.error(`[Key ${i + 1}] Error ${geminiResponse.status}:`, errorDetails);
        lastError = {
          status: geminiResponse.status,
          message: errorDetails,
        };
        continue;
      }

      // ✅ Éxito
      console.log(`[Key ${i + 1}] ✅ Respuesta exitosa`);
      const data = await geminiResponse.json();
      return {
        success: true,
        data: data,
        keyUsed: i + 1,
      };
    } catch (e) {
      console.error(`[Key ${i + 1}] Excepción:`, e.message);
      lastError = e;
      continue;
    }
  }

  // Si llegamos aquí, todas las keys fallaron
  throw {
    allKeysFailed: true,
    lastError: lastError,
    keysAttempted: apiKeys.length,
  };
}

const rateLimitMap = new Map<string, { count: number; startTime: number }>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const windowMs = 60000; // 1 minuto (60.000 milisegundos)
  const maxRequests = 20; // Límite: 20 preguntas por minuto

  if (!rateLimitMap.has(ip)) {
    rateLimitMap.set(ip, { count: 1, startTime: now });
    return false;
  }

  const data = rateLimitMap.get(ip)!;
  if (now - data.startTime > windowMs) {
    // Ya pasó el minuto, reiniciamos el contador
    rateLimitMap.set(ip, { count: 1, startTime: now });
    return false;
  }

  data.count++;
  return data.count > maxRequests;
}

const ALLOWED_ORIGINS = [
  "https://www.batxi2uni.run.place",
  "https://batxi2uni.run.place",
  "https://api.run.place","
  "http://localhost",
  "http://127.0.0.1"
];

Deno.serve(async (req) => {
	
// Detectar el origen de la petición
  const requestOrigin = req.headers.get("origin") || "";
  const allowedOrigin = ALLOWED_ORIGINS.includes(requestOrigin) 
    ? requestOrigin 
    : ALLOWED_ORIGINS[0]; // fallback al principal
	
	
  const headers = new Headers({
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
    "Access-Control-Allow-Headers": "Content-Type, X-App-Secret, x-app-secret", 
    "Content-Type": "application/json",
  });

  if (req.method === "OPTIONS") {
    return new Response(null, { headers });
  }

  // Obtenemos la IP del usuario
  const clientIp = req.headers.get("x-forwarded-for") || "IP_DESCONOCIDA";

  // Comprobamos si la IP está haciendo spam (excepto si es GET u OPTIONS)
  if (req.method === "POST" && isRateLimited(clientIp)) {
    console.warn(`[RATE LIMIT] IP bloqueada temporalmente: ${clientIp}`);
    return new Response(
      JSON.stringify({ 
        error: "Has fet massa preguntes seguides. Si us plau, espera un minut abans de tornar a preguntar." 
      }),
      { status: 429, headers }
    );
  }

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

  if (req.method === "POST") {
	 
		const secret = req.headers.get("x-app-secret");
		if (secret !== "sj-pro-secreto-2026") {
		  console.warn("Intento de acceso denegado (Secreto incorrecto)");
		  return new Response(JSON.stringify({ error: "No autorizado" }), { status: 401, headers });
    }
	
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

      // Compatibilitat amb format antic
      if (!chatMessages) {
        const text = body.inputs || body.prompt || "";
        chatMessages = [{ role: "user", content: text }];
      }

      // Eliminem qualsevol "system" rebut del frontend
      let filteredMessages = chatMessages.filter(
        (msg: any) => msg.role !== "system",
      );

      // Limitem a últims 40 missatges
      if (filteredMessages.length > 40) {
        filteredMessages = filteredMessages.slice(-40);
      }

      // Construimos los mensajes
      let messagesToSend = filteredMessages;

      // Si por algún motivo no hay mensajes, devolvemos error para no gastar cuota
      if (messagesToSend.length === 0) {
        return new Response(
          JSON.stringify({ error: "No hay mensajes para procesar" }),
          { status: 400, headers },
        );
      }

      // 👇 LLAMADA CON FALLBACK
      let result;
      try {
        result = await callGeminiWithFallback(messagesToSend, apiKeys);
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
        JSON.stringify([
          {
            generated_text: generatedText.trim(),
            html: htmlResponse,
            metadata: {
              tokens_used: data.usageMetadata?.totalTokenCount,
              model: data.modelVersion,
              keyUsed: result.keyUsed, // 👈 NUEVO: Cual key se usó
            },
          },
        ]),
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

// 👇 NUEVA FUNCIÓN: Convertir a texto limpio (sin HTML)
function markdownToHTML(markdown: string): string {
  // Solo convertir saltos de párrafo a <br>
  let html = markdown
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br>');
  
  return `<div class="ai-response"><p>${html}</p></div>`;
}