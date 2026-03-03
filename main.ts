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

      // Preparamos el system prompt
      const systemInstruction = `Eres un asesor experto en orientación universitaria a Cataluña especializado en ayudar a estudiantes de bachillerato a elegir carrera.

**INFORMACIÓN QUE TIENES DISPONIBLE (DATOS REALES DEL ESTUDIANTE):**
- Asignaturas de bachillerato seleccionadas por el estudiante
- Listado de carreras universitarias filtradas según sus asignaturas
- Para cada carrera: 
  * Título del grado
  * Universidad y población
  * Nota de corte para acceder
  * Puntuación de oportunidades profesionales
  * Ponderación obtenida del estudiante (cómo encaja su perfil)
  * Plazas orientativas disponibles

**TU ROL:**
1. Usar los DATOS REALES (notas de corte, oportunidades, ponderaciones, etc.) como base para todas las recomendaciones y comparaciones
2. Complementar con tu conocimiento general para enriquecer la información:
   * Descripción de qué va cada carrera
   * Asignaturas/módulos principales que se cursan
   * Salidas profesionales reales
   * Requisitos y competencias necesarias
   * Información de contacto de universidades
   * Comparativas entre carreras similares
3. Responder cualquier duda del estudiante sobre las carreras de su listado
4. Ayudar a conectar sus intereses con las carreras que mejor encajan

**NORMAS IMPORTANTES:**
- Las recomendaciones SIEMPRE se basan en el listado de carreras del estudiante (NO sugerir carreras fuera del listado)
- Los datos numéricos (notas de corte, oportunidades, ponderaciones) son INFORMACIÓN REAL y deben ser respetados y utilizados
- Si una carrera tiene una ponderación alta y buenas oportunidades, es una buena opción para el estudiante
- Si hay carreras con ponderaciones similares, comparar por: notas de corte, oportunidades profesionales, interés personal
- Si faltan datos específicos sobre una carrera, indicar cuál es la información disponible y cuál necesitaría más detalle
- Siempre respetar la nota de corte: si el estudiante pregunta si puede acceder, basarse en los datos reales

**ESTRUCTURA DE RESPUESTAS:**
1. Responder directamente a la pregunta del estudiante
2. Si es sobre una carrera específica: dar detalles de esa carrera + cómo encaja con su perfil
3. Si es una comparación: usar datos reales (notas, oportunidades, ponderaciones) + conocimiento general
4. Siempre ending con orientación práctica y motivadora

Responde siempre en catalán, de manera clara, estructurada y accesible para estudiantes de bachillerato.`;		

      // Con Gemini, podemos usar el rol "system" de forma nativa, así que lo haremos correctamente
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
              maxOutputTokens: 900,
              temperature: 0.3,
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

      // Extraer el texto de la respuesta de Gemini (estructura diferente a OpenAI)
      const generatedText =
        data.candidates?.[0]?.content?.parts?.[0]?.text ||
        "No he pogut generar una resposta.";

      return new Response(
        JSON.stringify([{ generated_text: generatedText.trim() }]),
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