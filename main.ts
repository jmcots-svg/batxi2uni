// main.ts - Versió amb memòria i System Prompt expert
Deno.serve(async (req) => {
  const url = new URL(req.url);

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
    return new Response(JSON.stringify({ status: "ok", message: "Servidor IA actiu" }), { headers });
  }

  if (req.method === "POST") {
    try {
      const body = await req.json();
      
      // Obtenim el token de les variables d'entorn
      const token = Deno.env.get("HF_TOKEN");
      if (!token) {
        return new Response(JSON.stringify({ error: "HF_TOKEN no configurat" }), { status: 500, headers });
      }

      /* LOGICA DE MEMÒRIA:
         Si el frontend ens envia un array 'messages', l'utilitzem.
         Si només ens envia 'inputs' (format antic), construïm l'estructura estàndard.
      */
      let chatMessages = body.messages;

      if (!chatMessages) {
        const text = body.inputs || body.prompt || "";
        chatMessages = [
          { 
            role: "system", 
            content: `Ets un expert en orientació universitària a Catalunya. 
            L'usuari et passarà dades contextuals (matèries i llistat de graus filtrats).
            La teva tasca és:
            1. Analitzar les notes de tall i les ponderacions de la llista per suggerir les millors opcions.
            2. Si la nota de l'alumne és justa, proposar alternatives amb notes més baixes o millors sortides.
            3. Respondre sempre en català, de forma directa i basada en les dades facilitades.
            4. No inventis dades: si una carrera no és a la llista o no tens la info, digues-ho clarament.`
          },
          { role: "user", content: text }
        ];
      }

      const hfResponse = await fetch(
        "https://router.huggingface.co/v1/chat/completions",
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "Qwen/Qwen2.5-7B-Instruct",
            messages: chatMessages,
            max_tokens: 1024,
            temperature: 0.3, // Temperatura baixa per a respostes més precises i basades en dades
            top_p: 0.9,
          }),
        }
      );

      if (!hfResponse.ok) {
        const errorDetails = await hfResponse.text();
        return new Response(JSON.stringify({ error: "Error HF API", details: errorDetails }), { status: 502, headers });
      }

      const data = await hfResponse.json();

      // Extraiem el text de la resposta d'OpenAI/HuggingFace
      const generatedText = data.choices?.[0]?.message?.content || "No he pogut generar una resposta.";

      // Retornem el format compatible amb el teu frontend (array amb objecte generated_text)
      return new Response(JSON.stringify([{ generated_text: generatedText.trim() }]), { headers });

    } catch (e) {
      console.error("Error al servidor:", e);
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers });
    }
  }

  return new Response("Not Found", { status: 404, headers });
});