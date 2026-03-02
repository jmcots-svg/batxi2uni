// main.ts
Deno.serve(async (req) => {
  const url = new URL(req.url);
  console.log(`Petición recibida: ${req.method} en ${url.pathname}`);

  const headers = new Headers({
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  });

  if (req.method === "OPTIONS") return new Response(null, { headers });

  // Responder OK a cualquier ruta GET (para el navegador y warm-up)
  if (req.method === "GET") {
    return new Response(JSON.stringify({ status: "ok", path: url.pathname }), { headers });
  }

  if (req.method === "POST") {
    try {
      const body = await req.json();
      const text = body.inputs || body.prompt || "Hola";
      const token = Deno.env.get("HF_TOKEN");

      const hfResponse = await fetch(
        "https://router.huggingface.co/hf-inference/models/google/gemma-2-2b-it",
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ 
            inputs: text,
            options: { wait_for_model: true },
            parameters: { max_new_tokens: 500, return_full_text: false }
          }),
        }
      );

      const data = await hfResponse.json();
      return new Response(JSON.stringify(data), { headers });

    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers });
    }
  }

  return new Response("No trobat", { status: 404, headers });
});