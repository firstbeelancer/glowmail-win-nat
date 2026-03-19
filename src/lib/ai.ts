import { supabase } from "@/integrations/supabase/client";

export async function callEmailAI(params: {
  action: string;
  text?: string;
  emailBody?: string;
  emailSubject?: string;
  emailFrom?: string;
}): Promise<string> {
  const { data, error } = await supabase.functions.invoke("email-ai", {
    body: params,
  });

  if (error) throw new Error(error.message || "AI request failed");
  if (data?.error) throw new Error(data.error);
  return data.result;
}
