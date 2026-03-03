// main.ts - Proxy a OpenRouter (DeepSeek) amb memòria

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
      JSON.stringify({ status: "ok", message: "Servidor IA actiu (OpenRouter)" }),
      { headers },
    );
  }

  if (req.method === "POST") {
    try {
      const body = await req.json();

      const token = Deno.env.get("OPENROUTER_API_KEY");
      if (!token) {
        return new Response(
          JSON.stringify({ error: "OPENROUTER_API_KEY no configurat" }),
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

      // Preparamos el system prompt como parte del primer mensaje de usuario
      const systemInstruction = `Ets un expert en orientació universitària a Catalunya.

Treballes únicament amb les dades que l’usuari et proporciona (matèries seleccionades, notes i llistat de graus filtrats).

Normes estrictes:
- NO inventis dades.
- NO afegeixis universitats o graus que no apareguin a la llista.
- Si falta informació, digues clarament que no es pot determinar.
- Basa totes les recomanacions en les notes de tall i les ponderacions facilitades.

Respon sempre en català, de manera clara i breu.`;

      // Si ya hay mensajes, añadimos la instrucción al inicio del primer mensaje de usuario
      // Si no hay mensajes, creamos uno nuevo con la instrucción
      let messagesToSend: { role: string; content: string }[];
      if (filteredMessages.length > 0) {
        messagesToSend = [
          {
            role: "user",
            content: `${systemInstruction}\n\n${filteredMessages[0].content}`,
          },
          ...filteredMessages.slice(1), // Añadimos el resto de mensajes
        ];
      } else {
        messagesToSend = [{ role: "user", content: systemInstruction }];
      }

      // Crida a OpenRouter (modelo free DeepSeek)
      const orResponse = await fetch(
        "https://openrouter.ai/api/v1/chat/completions",
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${token}`,
            "Content-Type": "application/json",
            "HTTP-Referer": "https://batxi2uni.jmcots-svg.deno.net/",
            "X-Title": "Batxi2Uni Orientació",
          },
			body: JSON.stringify({
			  // Prueba con tu opción principal aquí:
			  model: "nvidia/nemotron-3-nano-30b-a3b:free", 
			  
			  // Usa la lista de `models` para el "fallback" en orden de preferencia
			  // para que OpenRouter intente con el siguiente si el anterior falla por rate-limit u otra razón.
			  models: [
				"nvidia/nemotron-3-nano-30b-a3b:free",       // Opción principal
				"z-ai/glm-4.5-air:free",                     // Excelente alternativa por capacidad
				"stepfun/step-3.5-flash:free",               // Potencialmente muy potente, pero a confirmar rendimiento/fiabilidad
				"qwen/qwen3-next-80b-a3b-instruct:free",     // Máximo contexto, pero modelo más pequeño
				// Puedes añadir más si quieres tener más respaldo, pero ten en cuenta la calidad vs. los costes de prueba.
			  ],
			  route: "fallback", // Mantén esto para que OpenRouter pruebe los modelos en la lista
			  messages: messagesToSend, // ¡Asegúrate de usar los mensajes con el system prompt fusionado!
			  max_tokens: 900,
			  temperature: 0.3,
			  top_p: 0.9,
			}),
        },
      );

      if (!orResponse.ok) {
        const errorDetails = await orResponse.text();
        console.error("Error OpenRouter:", errorDetails);
        return new Response(
          JSON.stringify({
            error: "Error OpenRouter API",
            details: errorDetails,
          }),
          { status: 502, headers },
        );
      }

      const data = await orResponse.json();

      const generatedText =
        data.choices?.[0]?.message?.content ||
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