import { loadAiApiKey, loadPersistedSettings } from "@/lib/settings-storage";
import type { AIProvider } from "@/types";

type AIAction =
  | "rewrite"
  | "spellcheck"
  | "professional"
  | "friendly"
  | "translate"
  | "quick_replies";

type AIConfig = {
  enabled: boolean;
  provider: AIProvider;
  apiKey: string;
  model: string;
  baseUrl: string;
};

type PromptContext = {
  systemPrompt: string;
  userPrompt: string;
};

function defaultModelFor(provider: AIProvider): string {
  if (provider === "gemini") {
    return "gemini-2.5-flash";
  }

  return "gpt-4.1-mini";
}

function normalizeBaseUrl(provider: AIProvider, baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");

  if (trimmed) {
    return trimmed;
  }

  if (provider === "openai-compatible") {
    return "https://api.openai.com/v1";
  }

  return "https://api.openai.com/v1";
}

function loadAiConfig(): AIConfig {
  const settings = loadPersistedSettings();

  const provider = settings.aiProvider || "openai";

  return {
    enabled: settings.aiEnabled ?? true,
    provider,
    apiKey: settings.aiApiKey?.trim() || "",
    model: settings.aiModel?.trim() || defaultModelFor(provider),
    baseUrl: normalizeBaseUrl(provider, settings.aiBaseUrl || ""),
  };
}

function buildPromptContext(
  action: AIAction,
  params: {
    text?: string;
    emailBody?: string;
    emailSubject?: string;
    emailFrom?: string;
  },
): PromptContext {
  switch (action) {
    case "rewrite":
      return {
        systemPrompt:
          "You are an email writing assistant. Rewrite the given text to be clearer and more concise. Return only the rewritten text, no explanations.",
        userPrompt: params.text || "",
      };
    case "spellcheck":
      return {
        systemPrompt:
          "You are a proofreader. Fix all spelling and grammar errors in the given text. Return only the corrected text, no explanations.",
        userPrompt: params.text || "",
      };
    case "professional":
      return {
        systemPrompt:
          "You are an email writing assistant. Rewrite the given text in a professional, formal tone. Return only the rewritten text, no explanations.",
        userPrompt: params.text || "",
      };
    case "friendly":
      return {
        systemPrompt:
          "You are an email writing assistant. Rewrite the given text in a warm, friendly tone. Return only the rewritten text, no explanations.",
        userPrompt: params.text || "",
      };
    case "translate":
      return {
        systemPrompt:
          "You are a translator. Translate the given text to English. If it's already in English, translate to Spanish. Return only the translated text, no explanations.",
        userPrompt: params.text || "",
      };
    case "quick_replies":
      return {
        systemPrompt:
          'You are an email assistant. Generate exactly 3 short reply suggestions (each under 15 words) for the given email. Return them as a JSON array of strings like ["reply1","reply2","reply3"]. No other text.',
        userPrompt: `Subject: ${params.emailSubject || ""}\nFrom: ${
          params.emailFrom || ""
        }\n\n${(params.emailBody || "").replace(/<[^>]*>?/gm, "")}`,
      };
    default:
      throw new Error(`Unsupported AI action: ${action satisfies never}`);
  }
}

function extractOpenAIContent(data: any): string {
  const messageContent = data?.choices?.[0]?.message?.content;

  if (typeof messageContent === "string") {
    return messageContent.trim();
  }

  if (Array.isArray(messageContent)) {
    return messageContent
      .map((part) => {
        if (typeof part === "string") return part;
        if (part?.type === "text") return part.text || "";
        return "";
      })
      .join("")
      .trim();
  }

  return "";
}

function extractGeminiContent(data: any): string {
  const parts = data?.candidates?.[0]?.content?.parts;

  if (!Array.isArray(parts)) {
    return "";
  }

  return parts
    .map((part) => (typeof part?.text === "string" ? part.text : ""))
    .join("")
    .trim();
}

async function callOpenAICompatible(config: AIConfig, prompt: PromptContext): Promise<string> {
  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.model,
      temperature: 0.4,
      messages: [
        { role: "system", content: prompt.systemPrompt },
        { role: "user", content: prompt.userPrompt },
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `AI request failed (${response.status}): ${errorText || "Unknown provider error"}`,
    );
  }

  const data = await response.json();
  const content = extractOpenAIContent(data);

  if (!content) {
    throw new Error("AI provider returned an empty response.");
  }

  return content;
}

async function callGemini(config: AIConfig, prompt: PromptContext): Promise<string> {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      config.model,
    )}:generateContent?key=${encodeURIComponent(config.apiKey)}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: prompt.systemPrompt }],
        },
        contents: [
          {
            role: "user",
            parts: [{ text: prompt.userPrompt }],
          },
        ],
        generationConfig: {
          temperature: 0.4,
        },
      }),
    },
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Gemini request failed (${response.status}): ${errorText || "Unknown provider error"}`,
    );
  }

  const data = await response.json();
  const content = extractGeminiContent(data);

  if (!content) {
    throw new Error("Gemini returned an empty response.");
  }

  return content;
}

export async function callEmailAI(params: {
  action: AIAction;
  text?: string;
  emailBody?: string;
  emailSubject?: string;
  emailFrom?: string;
}): Promise<string> {
  const config = loadAiConfig();
  config.apiKey = (await loadAiApiKey()).trim() || config.apiKey;

  if (!config.enabled) {
    throw new Error("AI features are disabled in settings.");
  }

  if (!config.apiKey) {
    throw new Error("Add an AI API key in settings first.");
  }

  const prompt = buildPromptContext(params.action, params);

  if (config.provider === "gemini") {
    return callGemini(config, prompt);
  }

  return callOpenAICompatible(config, prompt);
}
