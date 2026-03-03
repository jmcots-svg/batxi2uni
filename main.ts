// main.ts - Gemini estable y limpio

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
      JSON.stringify({ status: "ok", message: "Servidor IA actiu GEMINI OK" }),
      { headers }
    );
  }

  if (req.method === "POST") {
    try {
      const body = await req.json();

      const token = Deno.env.get("GEMINI_API_KEY");
      if (!token) {
        return new Response(
          JSON.stringify({ error: "GEMINI_API_KEY no configurat" }),
          { status: 500, headers }
        );
      }

      let chatMessages = body.messages;

      if (!chatMessages) {
        const text = body.inputs || body.prompt || "";
        chatMessages = [{ role: "user", content: text }];
      }

      // Eliminar system si viene del frontend
      let filteredMessages = chatMessages.filter(
        (msg: any) => msg.role !== "system"
      );

      // Limitar a últimos 40 mensajes
      if (filteredMessages.length > 40) {
        filteredMessages = filteredMessages.slice(-40);
      }

	// Convertimos formato OpenAI → Gemini
	let contents = filteredMessages.map((msg: any) => ({
	  role: msg.role === "assistant" ? "model" : "user",
	  parts: [{ text: msg.content }],
	}));

	// Asegurar que empieza por user
	if (contents.length > 0 && contents[0].role !== "user") {
	  contents = contents.slice(1);
	}

	// ✅ Inyectamos el system prompt como primer mensaje user
	const systemPrompt = `Ets un expert en orientació universitària a Catalunya.

	Treballes únicament amb les dades que l’usuari et proporciona.

	Normes estrictes:
	- NO inventis dades.
	- NO afegeixis universitats o graus que no apareguin a la llista.
	- Si falta informació, digues-ho clarament.
	- Basa les recomanacions només en les dades facilitades.

	Respon sempre en català de forma clara i breu.`;

	contents.unshift({
	  role: "user",
	  parts: [{ text: systemPrompt }]
	});

	const geminiResponse = await fetch(
	  `https://generativelanguage.googleapis.com/v1/models/gemini-1.0-pro:generateContent?key=${token}`,
	  {
		method: "POST",
		headers: {
		  "Content-Type": "application/json",
		},
		body: JSON.stringify({
		  contents: contents,
		  generationConfig: {
			temperature: 0.3,
			maxOutputTokens: 900,
			topP: 0.9,
		  },
		}),
	  }
	);

      if (!geminiResponse.ok) {
        const errorDetails = await geminiResponse.text();
        return new Response(
          JSON.stringify({ error: "Error Gemini API", details: errorDetails }),
          { status: 502, headers }
        );
      }

      const data = await geminiResponse.json();

      let generatedText = "No he pogut generar una resposta.";

      if (data.candidates && data.candidates.length > 0) {
        const parts = data.candidates[0].content?.parts;
        if (parts && parts.length > 0 && parts[0].text) {
          generatedText = parts[0].text;
        }
      }

      if (data.promptFeedback?.blockReason) {
        generatedText = "La consulta ha estat bloquejada per polítiques de seguretat.";
      }

      return new Response(
        JSON.stringify([{ generated_text: generatedText.trim() }]),
        { headers }
      );

    } catch (e) {
      console.error("Error servidor:", e);
      return new Response(
        JSON.stringify({ error: e.message }),
        { status: 500, headers }
      );
    }
  }

  return new Response("Not Found", { status: 404, headers });
});