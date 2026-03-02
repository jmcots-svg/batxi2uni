// main.ts
Deno.serve(async (req) => {
  // 1. Configuración de cabeceras para permitir que tu web (GitHub Pages) se comunique con Deno
  const headers = new Headers({
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  });

  // 2. Responder a la verificación del navegador (Pre-flight OPTIONS)
  if (req.method === "OPTIONS") {
    return new Response(null, { headers });
  }

  // 3. Responder al test de "Warm up" de Deno o si entras por el navegador (GET)
  if (req.method === "GET") {
    return new Response(JSON.stringify({ 
      status: "ok", 
      message: "Servidor Proxy IA Activo" 
    }), { status: 200, headers });
  }

  // 4. Lógica principal para procesar la pregunta (POST)
  if (req.method === "POST") {
    try {
      const { prompt } = await req.json();
      const token = Deno.env.get("HF_TOKEN");

      if (!token) {
        return new Response(JSON.stringify({ error: "Falta el token HF_TOKEN en Deno" }), { 
          status: 500, headers 
        });
      }

      // LA NUEVA URL ACTUALIZADA SEGÚN EL ERROR ANTERIOR
      const hfResponse = await fetch(
        "https://router.huggingface.co/hf-inference/models/google/gemma-2-2b-it",
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ 
            inputs: prompt,
            options: { wait_for_model: true }, // Espera a que la IA cargue si está inactiva
            parameters: { max_new_tokens: 500 }
          }),
        }
      );

      const data = await hfResponse.json();
      
      // Enviamos la respuesta de la IA de vuelta a tu web
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