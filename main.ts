Deno.serve(async (req) => {
  const headers = new Headers({
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  });

  if (req.method === "OPTIONS") return new Response(null, { headers });

  if (req.method === "POST") {
    try {
      const body = await req.json();
      const text = body.inputs || body.prompt;
      
      // 1. Verificación de Seguridad: ¿Está el Token?
      const token = Deno.env.get("HF_TOKEN");
      if (!token || token.trim() === "") {
        return new Response(JSON.stringify({ 
          error: "TOKEN_MISSING", 
          message: "No se ha encontrado la variable HF_TOKEN en la configuración de Deno." 
        }), { status: 200, headers }); // Enviamos 200 para ver el mensaje de error en la web
      }

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
            inputs: text,
            options: { wait_for_model: true },
            parameters: { max_new_tokens: 500, return_full_text: false }
          }),
        }
      );

      const data = await hfResponse.json();
      return new Response(JSON.stringify(data), { headers });

    } catch (e) {
      // Si el código explota, capturamos el error aquí
      return new Response(JSON.stringify({ error: "SERVER_ERROR", message: e.message }), { 
        status: 200, // Usamos 200 para que el error llegue al navegador y lo puedas leer
        headers 
      });
    }
  }

  // Respuesta por defecto para GET (Warm up)
  return new Response(JSON.stringify({ status: "ok" }), { headers });
});