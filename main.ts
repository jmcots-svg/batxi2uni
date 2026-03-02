// main.ts
Deno.serve(async (req) => {
  const headers = new Headers({
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  });

  // Manejo de Preflight (CORS)
  if (req.method === "OPTIONS") return new Response(null, { headers });

  // Test de funcionamiento
  if (req.method === "GET") {
    return new Response(JSON.stringify({ status: "ok" }), { status: 200, headers });
  }

  if (req.method === "POST") {
    try {
      const body = await req.json();
      const textToSend = body.inputs || body.prompt; 
      const token = Deno.env.get("HF_TOKEN");

      if (!token) {
        return new Response(JSON.stringify({ error: "Falta el token HF_TOKEN en Deno" }), { 
          status: 500, headers 
        });
      }

      // USAMOS MISTRAL-7B: Es el modelo más fiable para la API gratuita actualmente
      const hfResponse = await fetch(
        "https://api-inference.huggingface.co/models/mistralai/Mistral-7B-Instruct-v0.3",
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ 
            inputs: `<s>[INST] ${textToSend} [/INST]`, // Formato específico para Mistral
            parameters: { max_new_tokens: 500, return_full_text: false }
          }),
        }
      );

      const data = await hfResponse.json();

      // Si el modelo se está cargando, Hugging Face devuelve un 503 con 'estimated_time'
      if (hfResponse.status === 503) {
        return new Response(JSON.stringify({ 
          error: "El model s'està despertant... Torna a provar-ho en 20 segons." 
        }), { status: 503, headers });
      }

      if (!hfResponse.ok) {
        return new Response(JSON.stringify({ error: `IA Error: ${JSON.stringify(data)}` }), { 
          status: hfResponse.status, headers 
        });
      }

      return new Response(JSON.stringify(data), { headers });

    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers });
    }
  }

  return new Response(JSON.stringify({ error: "Método no permitido" }), { status: 405, headers });
});