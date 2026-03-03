// main.ts - Proxy a Google Gemini API con memoria + FALLBACK múltiples keys

// 👇 NUEVA FUNCIÓN: Obtener todas las keys
function getApiKeys(): string[] {
  const keys: string[] = [];
  for (let i = 1; i <= 5; i++) {
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
const geminiResponse = await fetch(
  `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`, // Nota: he puesto 2.0 o 1.5, asegúrate de la versión que usas
  {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      // 1. AQUÍ AÑADIMOS EL SYSTEM PROMPT CORRECTAMENTE
      systemInstruction: {
        parts: [
          {
            text: systemInstruction
          }
        ]
      },
      // 2. AQUÍ VAN LOS MENSAJES DEL USUARIO
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
        temperature: 0.3, // Esto está perfecto para respuestas precisas
        topP: 0.95,
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

Deno.serve(async (req) => {
  const headers = new Headers({
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  });

  if (req.method === "OPTIONS") {
    return new Response(null, { headers });
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

      // SYSTEM PROMPT
      const systemInstruction = `Ets un assessor expert en orientació universitària a Catalunya. El teu objectiu és ajudar a estudiants de batxillerat de forma ULTRA RÀPIDA, CONCISA i PROFESSIONAL.

      **EL TEU ROL:**
      1. Respon DIRECTAMENT a la pregunta de l'usuari.
      2. Utilitza exclusivament les dades del llistat proporcionat sempre que sigui possible.
      3. Si pregunten per informació EXTERNA (telèfon, web específica, ubicació exacta) que no apareix a la teva informació:
        - NO enviïs a l'usuari a buscar a Google.
        - Recomana amablement consultar la "pàgina web oficial de la universitat o centre" per obtenir les dades actualitzades.

      **RESTRICCIONS OBLIGATÒRIES:**
      - MÀXIM 2-3 paràgrafs breus.
      - Sense explicacions llargues, teòriques ni redundàncies. Menys és més.
      - Sense emojis, sense format HTML, sense Markdown ni asteriscos.
      - Respon SEMPRE i ÚNICAMENT en català.

      **INFORMACIÓ DISPONIBLE (Contextual):**
      *(Nota interna: recorda utilitzar les dades de notes de tall, carreres i ponderacions que s'inclouen en el missatge de l'usuari per respondre).*

      **REGLES D'OR:**
      1. MAI expliquis conceptes bàsics (l'estudiant ja sap què és la selectivitat o una carrera).
      2. NO repeteixis informació que l'estudiant ja t'ha donat.
      3. Si és sobre les carreres del llistat → SEMPRE RESPÓN amb dades concretes.
      4. Sigues EXTREMADAMENT breu i directe.`;

      // Construimos los mensajes
      let messagesToSend: any[] = [];

      if (filteredMessages.length > 0) {
        messagesToSend = [
          {
            role: "user",
            content: `${systemInstruction}\n\n${filteredMessages[0].content}`,
          },
          ...filteredMessages.slice(1),
        ];
      } else {
        messagesToSend = [
          {
            role: "user",
            content: systemInstruction,
          },
        ];
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