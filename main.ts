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
      const textToSend = body.inputs || body.prompt; 
      
      // 1. Verificación del Token con LOG
      const token = Deno.env.get("HF_TOKEN");
      if (!token) {
        console.error("ERROR CRÍTICO: No se ha encontrado la variable HF_TOKEN");
        return new Response(JSON.stringify({ error: "Error de configuración en el servidor (Falta Token)" }), { 
          status: 500, headers 
        });
      }

      console.log("Enviando petición a Hugging Face...");

      // 2. Llamada a Hugging Face
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
            parameters: { max_new_tokens: 500, return_full_text: false }
          }),
        }
      );

      // 3. Si Hugging Face da error, leemos el texto del error
      if (!hfResponse.ok) {
        const errorText = await hfResponse.text();
        console.error("Error de Hugging Face:", errorText);
        return new Response(JSON.stringify({ error: `Hugging Face Error: ${errorText}` }), { 
          status: 500, headers 
        });
      }

      const data = await hfResponse.json();
      return new Response(JSON.stringify(data), { headers });

    } catch (e) {
      console.error("EXCEPCIÓN EN DENO:", e);
      return new Response(JSON.stringify({ error: "Excepción interna: " + e.message }), { 
        status: 500, headers 
      });
    }
  }

  return new Response(JSON.stringify({ error: "Método no permitido" }), { 
    status: 405, headers 
  });
});