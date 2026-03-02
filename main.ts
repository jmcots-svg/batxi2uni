// main.ts
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
    return new Response(JSON.stringify({ 
      status: "ok", 
      message: "Servidor Proxy IA Activo" 
    }), { status: 200, headers });
  }

  if (req.method === "POST") {
    try {
      const body = await req.json();
      // Aceptamos 'inputs' o 'prompt' para evitar errores de envío
      const textToSend = body.inputs || body.prompt; 
      
      const token = Deno.env.get("HF_TOKEN");

      if (!token) {
        return new Response(JSON.stringify({ error: "Falta el token HF_TOKEN en Deno" }), { 
          status: 500, headers 
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
            inputs: textToSend,
            options: { wait_for_model: true },
            parameters: { max_new_tokens: 500 }
          }),
        }
      );

      const data = await hfResponse.json();
      return new Response(JSON.stringify(data), { headers });

    } catch (e) {
      return new Response(JSON.stringify({ error: "Error en el servidor: " + e.message }), { 
        status: 500, headers 
      });
    }
  }

  return new Response(JSON.stringify({ error: "Método no permitido" }), { 
    status: 405, headers 
  });
});