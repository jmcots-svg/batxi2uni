// main.ts - Proxy a Google Gemini API con memoria

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
    return new Response(
      JSON.stringify({ status: "ok", message: "Servidor IA actiu (Google Gemini)" }),
      { headers },
    );
  }

  if (req.method === "POST") {
    try {
      const body = await req.json();

      const apiKey = Deno.env.get("GEMINI_API_KEY");
      if (!apiKey) {
        return new Response(
          JSON.stringify({ error: "GEMINI_API_KEY no configurat" }),
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

      // 👇 SYSTEM PROMPT MEJORADO CON MARKDOWN
      const systemInstruction = `Eres un asesor experto en orientación universitaria a Cataluña. Tu objetivo es ayudar a estudiantes de bachillerato de forma RÁPIDA Y CONCISA.

**INFORMACIÓN DISPONIBLE:**
- Asignaturas del estudiante
- Listado de carreras filtradas
- Notas de corte, oportunidades profesionales y ponderaciones

**TU ROL:**
1. Responder DIRECTAMENTE a la pregunta
2. Usar datos reales para recomendaciones
3. Enriquecer con conocimiento general (descripción carrera, asignaturas, salidas)
4. NO REPETIR información innecesaria

**NORMAS:**
- Respuestas BREVES y al punto (máximo 3-4 párrafos)
- Solo sugerir carreras del listado del estudiante
- Usar Markdown para estructura clara
- Emojis relevantes: 🎓 📚 💼 ✅ ❌ ⭐ 📍

**FORMATO:**
### 🎓 Respuesta Directa
Párrafo breve respondiendo la pregunta

#### 💡 Datos Clave
- Punto 1
- Punto 2

#### ✅ Recomendación
Conclusión breve y práctica

Responde siempre en catalán, de forma clara, directa y accesible.`;

      // Construimos los mensajes con el system message al inicio
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

      // Crida a Google Gemini API
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
              maxOutputTokens: 4000,
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

      if (!geminiResponse.ok) {
        const errorDetails = await geminiResponse.text();
        console.error("Error Gemini:", errorDetails);
        return new Response(
          JSON.stringify({
            error: "Error Google Gemini API",
            details: errorDetails,
          }),
          { status: 502, headers },
        );
      }

      const data = await geminiResponse.json();

      // Extraer el texto de la respuesta de Gemini
      const generatedText =
        data.candidates?.[0]?.content?.parts?.[0]?.text ||
        "No he pogut generar una resposta.";

      // 👇 NUEVO: Convertir Markdown a HTML enriquecido
      const htmlResponse = markdownToHTML(generatedText);

      // 👇 NUEVO: Devolver tanto texto como HTML
      return new Response(
        JSON.stringify([{ 
          generated_text: generatedText.trim(),
          html: htmlResponse,
          metadata: {
            tokens_used: data.usageMetadata?.totalTokenCount,
            model: data.modelVersion,
          }
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

// 👇 NUEVA FUNCIÓN: Convertir Markdown a HTML
function markdownToHTML(markdown: string): string {
  let html = markdown
    // Títulos h3
    .replace(/^### (.*?)$/gm, '<h3 class="ai-h3">\$1</h3>')
    // Títulos h4
    .replace(/^#### (.*?)$/gm, '<h4 class="ai-h4">\$1</h4>')
    // Negrita
    .replace(/\*\*(.*?)\*\*/g, '<strong class="ai-highlight">\$1</strong>')
    // Blockquotes
    .replace(/^> (.*?)$/gm, '<blockquote class="ai-blockquote">\$1</blockquote>')
    // Listas (guiones)
    .replace(/^\- (.*?)$/gm, '<li>\$1</li>')
    // Listas (asteriscos)
    .replace(/^\* (.*?)$/gm, '<li>\$1</li>')
    // Envolver listas en <ul>
    .replace(/(<li>.*?<\/li>)/s, '<ul class="ai-list">\$1</ul>')
    // Divisores (---)
    .replace(/---/g, '<hr class="ai-divider">')
    // Párrafos dobles
    .replace(/\n\n/g, '</p><p>')
    // Saltos de línea simples
    .replace(/\n/g, '<br>');

  // Envolver todo en div con párrafo
  return `<div class="ai-response"><p>${html}</p></div>`;
}