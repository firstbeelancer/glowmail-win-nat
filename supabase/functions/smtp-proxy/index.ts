import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function ok(data: unknown) {
  return new Response(JSON.stringify(data), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function err(msg: string, status = 500) {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { host, port, username, password, from, to, cc, bcc, subject, html, text, replyTo, inReplyTo, references } = body;

    if (!host || !username || !password) {
      return err("Missing server credentials", 400);
    }
    if (!to || !Array.isArray(to) || to.length === 0) {
      return err("Missing recipients", 400);
    }

    const isPort465 = port === 465;
    
    const client = new SMTPClient({
      connection: {
        hostname: host,
        port: port || 465,
        tls: isPort465,
        auth: {
          username,
          password,
        },
      },
    });

    const mailConfig: any = {
      from: from || username,
      to: to,
      subject: subject || "(No Subject)",
    };

    if (cc?.length) mailConfig.cc = cc;
    if (bcc?.length) mailConfig.bcc = bcc;
    if (html) mailConfig.html = html;
    if (text) mailConfig.content = text;
    if (replyTo) mailConfig.replyTo = replyTo;

    // Add threading headers
    if (inReplyTo || references) {
      mailConfig.headers = {};
      if (inReplyTo) mailConfig.headers["In-Reply-To"] = inReplyTo;
      if (references) mailConfig.headers["References"] = references;
    }

    await client.send(mailConfig);
    await client.close();

    return ok({ success: true });
  } catch (e) {
    console.error("smtp-proxy error:", e);
    const message = e instanceof Error ? e.message : "Unknown error";
    if (message.includes("auth") || message.includes("credentials")) {
      return err("SMTP authentication failed", 401);
    }
    return err(message);
  }
});
