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
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            contents: messagesToSend.map((msg) => ({
              role: msg.role === "user" ? "user" : "model",
              parts: [
                {
                  text: msg.content,
                },
              ],
            })),
            generationConfig: {
              maxOutputTokens: 1500,
              temperature: 0.2,
              topP: 0.9,
            },
            safetySettings: [
              {
                category: "HARM_CATEGORY_HARASSMENT",
                threshold: "BLOCK_NONE",
              },
              {
                category: "HARM_CATEGORY_HATE_SPEECH",
                threshold: "BLOCK_NONE",
              },
              {
                category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
                threshold: "BLOCK_NONE",
              },
              {
                category: "HARM_CATEGORY_DANGEROUS_CONTENT",
                threshold: "BLOCK_NONE",
              },
            ],
          }),
        },
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
	const systemInstruction = `Eres un asesor experto en orientación universitaria a Cataluña. Tu objetivo es ayudar a estudiantes de bachillerato de forma ULTRA RÁPIDA Y CONCISA.

	**RESTRICCIONES OBLIGATORIAS:**
	- MÁXIMO 2-3 párrafos breves (5-6 líneas totales)
	- Sin explicaciones largas ni redundancias
	- Responde DIRECTAMENTE a la pregunta, nada más
	- Usa SOLO bullet points para datos

	**INFORMACIÓN DISPONIBLE:**
	- Asignaturas del estudiante
	- Listado de carreras filtradas
	- Notas de corte, oportunidades profesionales y ponderaciones

	**FORMATO OBLIGATORIO:**

	### 🎓 Respuesta
	Párrafo BREVE (máx 2 líneas) respondiendo directamente

	**📊 Datos clave:**
	• Dato 1
	• Dato 2 (máx 3 bullet points)

	**✅ Conclusión**
	Una línea con recomendación o siguiente paso

	**REGLAS DE ORO:**
	1. NUNCA explicar conceptos básicos
	2. NO repetir información del student
	3. Emojis: 🎓 📚 💼 ✅ ❌ ⭐ 📍 💡
	4. Responde en catalán
	5. Si no sabes, di "No tinc aquesta informació"

	IMPORTANTE: Sé EXTREMADAMENTE breve. Menos es más.`;	

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

function markdownToHTML(markdown: string): string {
  let html = markdown
    .replace(/^### (.*?)$/gm, '<h3 class="ai-h3">\$1</h3>')
    .replace(/^#### (.*?)$/gm, '<h4 class="ai-h4">\$1</h4>')
    .replace(/\*\*(.*?)\*\*/g, '<strong class="ai-highlight">\$1</strong>')
    .replace(/^> (.*?)$/gm, '<blockquote class="ai-blockquote">\$1</blockquote>')
    .replace(/^\- (.*?)$/gm, '<li>\$1</li>')
    .replace(/^\* (.*?)$/gm, '<li>\$1</li>')
    .replace(/(<li>.*?<\/li>)/s, '<ul class="ai-list">\$1</ul>')
    .replace(/---/g, '<hr class="ai-divider">')
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br>');

  return `<div class="ai-response"><p>${html}</p></div>`;
}