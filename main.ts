// main.ts
Deno.serve(async (req) => {
  // 1. Configuración de cabeceras (CORS)
  const headers = new Headers({
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  });

  // 2. Responder a la verificación del navegador (OPTIONS)
  if (req.method === "OPTIONS") {
    return new Response(null, { headers });
  }

  // 3. Lógica para la consulta de IA (POST)
  if (req.method === "POST") {
    try {
      const { prompt } = await req.json();
      const token = Deno.env.get("HF_TOKEN");

      if (!token) {
        return new Response(JSON.stringify({ error: "Token no configurado en Deno" }), { 
          status: 500, headers 
        });
      }

      const hfResponse = await fetch(
        "https://api-inference.huggingface.co/models/google/gemma-2-2b-it",
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ 
            inputs: prompt,
            parameters: { max_new_tokens: 250, return_full_text: false }
          }),
        }
      );

      const data = await hfResponse.json();
      return new Response(JSON.stringify(data), { headers });

    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), { 
        status: 500, headers 
      });
    }
  }

  // 4. Respuesta para el "Warm up" de Deno (GET)
  // Esto es lo que hará que el check de "Warm up" se ponga en verde
  return new Response(JSON.stringify({ status: "ok", message: "Servidor Proxy IA Activo" }), { 
    status: 200, 
    headers 
  });
});