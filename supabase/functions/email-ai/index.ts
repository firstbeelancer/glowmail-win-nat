import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const { action, text, emailBody, emailSubject, emailFrom } = await req.json();

    let systemPrompt = "";
    let userPrompt = "";

    switch (action) {
      case "rewrite":
        systemPrompt = "You are an email writing assistant. Rewrite the given text to be clearer and more concise. Return only the rewritten text, no explanations.";
        userPrompt = text;
        break;
      case "spellcheck":
        systemPrompt = "You are a proofreader. Fix all spelling and grammar errors in the given text. Return only the corrected text, no explanations.";
        userPrompt = text;
        break;
      case "professional":
        systemPrompt = "You are an email writing assistant. Rewrite the given text in a professional, formal tone. Return only the rewritten text, no explanations.";
        userPrompt = text;
        break;
      case "friendly":
        systemPrompt = "You are an email writing assistant. Rewrite the given text in a warm, friendly tone. Return only the rewritten text, no explanations.";
        userPrompt = text;
        break;
      case "translate":
        systemPrompt = "You are a translator. Translate the given text to English. If it's already in English, translate to Spanish. Return only the translated text, no explanations.";
        userPrompt = text;
        break;
      case "quick_replies":
        systemPrompt = "You are an email assistant. Generate exactly 3 short reply suggestions (each under 15 words) for the given email. Return them as a JSON array of strings, e.g. [\"reply1\", \"reply2\", \"reply3\"]. No other text.";
        userPrompt = `Subject: ${emailSubject}\nFrom: ${emailFrom}\n\n${emailBody?.replace(/<[^>]*>?/gm, "")}`;
        break;
      default:
        return new Response(JSON.stringify({ error: "Unknown action" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded, please try again later." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Please add credits in Lovable settings." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await response.text();
      console.error("AI gateway error:", response.status, t);
      return new Response(JSON.stringify({ error: "AI service error" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "";

    return new Response(JSON.stringify({ result: content }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("email-ai error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
