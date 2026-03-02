// main.ts  ← versión corregida

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
            parameters: {
              max_new_tokens: 500,
              return_full_text: false
            }
          }),
        }
      );

      if (!hfResponse.ok) {
        const errorText = await hfResponse.text();
        return new Response(JSON.stringify({
          error: `Hugging Face error ${hfResponse.status}: ${errorText}`
        }), { status: 502, headers });
      }

      const data = await hfResponse.json();

      return new Response(JSON.stringify(data), { headers });

    } catch (e) {
      console.error(e);
      return new Response(JSON.stringify({ error: e.message }), {
        status: 500,
        headers,
      });
    }
  }

  // Solo llega aquí si no es GET/POST/OPTIONS
  return new Response("Mètode no permès", { status: 405, headers });
});