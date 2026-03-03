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
			  // *** CAMBIO AQUÍ ***
			  // Usa un modelo que no sea "free" y tenga mejores límites de tasa.
			  // Asegúrate de que este modelo también soporte el formato de mensajes que envías (con system instruction integrada en el user message).
			  model: "openai/gpt-3.5-turbo", // ¡Ejemplo! Necesitarías OpenRouter para acceder a este o su propia clave.
			  
			  // Si quieres seguir usando fallback, asegúrate de que todos los modelos en la lista sean fiables y no "free".
			  // O simplemente quita la lista 'models' y 'route: "fallback"' para usar solo el 'model' principal.
			  // models: [
			  //   "openai/gpt-3.5-turbo",
			  //   "google/gemini-pro", // Otro ejemplo
			  //   // ...
			  // ],
			  // route: "fallback", // Si usas una lista, mantén esto. Si solo usas "model", quítalo.
			  
			  messages: messagesToSend, // Asumiendo que 'messagesToSend' ya contiene el system prompt fusionado
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