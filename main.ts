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

      // Afegim system prompt fix (expert orientació universitària)
      const systemMessage = {
        role: "system",
        content: `Ets un expert en orientació universitària a Catalunya.

Treballes únicament amb les dades que l’usuari et proporciona (matèries seleccionades, notes i llistat de graus filtrats).

Normes estrictes:
- NO inventis dades.
- NO afegeixis universitats o graus que no apareguin a la llista.
- Si falta informació, digues clarament que no es pot determinar.
- Basa totes les recomanacions en les notes de tall i les ponderacions facilitades.

Respon sempre en català, de manera clara i breu.`,
      };

      const messages = [systemMessage, ...filteredMessages];

      // Crida a OpenRouter (model free DeepSeek)
      const orResponse = await fetch(
        "https://openrouter.ai/api/v1/chat/completions",
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${token}`,
            "Content-Type": "application/json",
            // opcional pero recomendado por OpenRouter
            "HTTP-Referer": "https://batxi2uni.jmcots-svg.deno.net/",
            "X-Title": "Batxi2Uni Orientació",
          },
          body: JSON.stringify({
            model: "google/gemma-3-27b-it:free",
            messages,
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