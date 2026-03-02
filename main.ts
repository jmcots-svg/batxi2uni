// main.ts  ← versión corregida y funcional con Qwen/Qwen2.5-7B-Instruct

Deno.serve(async (req) => {
  const url = new URL(req.url);
  console.log(`Petición recibida: ${req.method} ${url.pathname}`);

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
    return new Response(JSON.stringify({ status: "ok", path: url.pathname }), { headers });
  }

  if (req.method === "POST") {
    try {
      const body = await req.json();
      const text = body.inputs || body.prompt || "Hola";

      const token = Deno.env.get("HF_TOKEN");
      if (!token) {
        return new Response(JSON.stringify({ error: "No HF_TOKEN en variables de entorno" }), {
          status: 500,
          headers,
        });
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
            model: "Qwen/Qwen2.5-7B-Instruct",  // Modelo que ya probaste y funciona
			messages: [
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
			  { 
				role: "user", 
				content: text // Aquí 'text' contindrà el bloc que hem construït al frontend amb matèries + llista + pregunta
			  }
			],
            max_tokens: 1024,
            temperature: 0.3,
            top_p: 0.9,          // Opcional, pero ayuda a respuestas más coherentes
          }),
        }
      );

      if (!hfResponse.ok) {
        const errorText = await hfResponse.text();
        console.error(`Error de Hugging Face: ${hfResponse.status} - ${errorText}`);
        return new Response(JSON.stringify({
          error: `Hugging Face error ${hfResponse.status}: ${errorText}`
        }), { status: 502, headers });
      }

      const data = await hfResponse.json();

      // Extraemos el texto generado del formato OpenAI
      const generatedText = data.choices?.[0]?.message?.content?.trim() 
        || "No s'ha rebut resposta vàlida del model.";

      // Devolvemos en formato compatible con tu frontend (data[0].generated_text)
      const compatibleResponse = [{ generated_text: generatedText }];

      return new Response(JSON.stringify(compatibleResponse), { headers });

    } catch (e) {
      console.error("Error en el handler POST:", e);
      return new Response(JSON.stringify({ error: e.message }), {
        status: 500,
        headers,
      });
    }
  }

  // Solo llega aquí si no es GET/POST/OPTIONS
  return new Response("Mètode no permès", { status: 405, headers });
});