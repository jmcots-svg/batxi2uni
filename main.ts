import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

serve(async (req) => {
  const headers = new Headers({
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  });

  if (req.method === "OPTIONS") return new Response(null, { headers });

  if (req.method === "POST") {
    try {
      const { prompt } = await req.json();
      const token = Deno.env.get("HF_TOKEN");

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
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers });
    }
  }
  return new Response("Servidor OK", { headers });
});