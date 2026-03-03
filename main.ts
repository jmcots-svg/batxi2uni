// main.ts - Versió amb memòria optimitzada per Gemini

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
      JSON.stringify({ status: "ok", message: "Servidor IA actiu (Gemini)" }),
      { headers }
    );
  }

  if (req.method === "POST") {
    try {
      const body = await req.json();

      // ✅ Token Gemini
      const token = Deno.env.get("GEMINI_API_KEY");
      if (!token) {
        return new Response(
          JSON.stringify({ error: "GEMINI_API_KEY no configurat" }),
          { status: 500, headers }
        );
      }

      // ✅ Memòria: rebem historial del frontend
		let chatMessages = body.messages;

		if (!chatMessages) {
		  const text = body.inputs || body.prompt || "";
		  chatMessages = [{ role: "user", content: text }];
		}

      // ✅ Eliminem qualsevol "system" enviat pel frontend
      const filteredMessages = chatMessages.filter(
        (msg: any) => msg.role !== "system"
      );

		// ✅ Limitamos historial a últimos 20 mensajes
		if (chatMessages.length > 40) {
		  chatMessages = chatMessages.slice(-40);
		}


      // ✅ Convertim format OpenAI → Gemini
      const contents = filteredMessages.map((msg: any) => ({
        role: msg.role === "assistant" ? "model" : "user",
        parts: [{ text: msg.content }],
      }));

      // ✅ Crida a Gemini amb systemInstruction professional
      const geminiResponse = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${token}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            systemInstruction: {
              parts: [
                {
                  text: `Ets un expert en orientació universitària a Catalunya.

Treballes únicament amb les dades que l’usuari et proporciona (matèries seleccionades, notes i llistat de graus filtrats).

Normes estrictes:
- NO inventis dades.
- NO afegeixis universitats o graus que no apareguin a la llista.
- Si falta informació, digues clarament que no es pot determinar.
- Basa totes les recomanacions en les notes de tall i les ponderacions facilitades.

Objectiu:
1. Analitzar les millors opcions segons la nota de l'alumne.
2. Detectar si la nota és justa, suficient o insuficient.
3. Proposar alternatives dins la mateixa llista si escau.
4. Respondre de manera clara, estructurada i breu.

Respon sempre en català.`,
                },
              ],
            },
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
	  console.log("Gemini raw response:", JSON.stringify(data, null, 2));

	let generatedText = "No he pogut generar una resposta.";

	if (data.candidates && data.candidates.length > 0) {
	  const parts = data.candidates[0].content?.parts;
	  if (parts && parts.length > 0 && parts[0].text) {
		generatedText = parts[0].text;
	  }
	}

	// Si Gemini bloquea por seguridad
	if (data.promptFeedback?.blockReason) {
	  generatedText = "La consulta ha estat bloquejada per polítiques de seguretat.";
}

      return new Response(
        JSON.stringify([{ generated_text: generatedText.trim() }]),
        { headers }
      );
    } catch (e) {
      console.error("Error al servidor:", e);
      return new Response(
        JSON.stringify({ error: e.message }),
        { status: 500, headers }
      );
    }
  }

  return new Response("Not Found", { status: 404, headers });
});