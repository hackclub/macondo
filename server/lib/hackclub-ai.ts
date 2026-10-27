// Retries on Qwen when the primary model errors, so features survive a removed model.

import { useRuntimeConfig } from "#imports";
import { HACKCLUB_AI_URL } from "./api-urls";

export const QWEN_FALLBACK_MODEL = "qwen/qwen3-next-80b-a3b-instruct";

export function getDefaultAiModel(): string {
  const config = useRuntimeConfig();
  return (config.aiPrimaryModel as string) || QWEN_FALLBACK_MODEL;
}

export interface ChatCompletionMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

export interface AiChatOptions {
  apiKey: string;
  model: string;
  body: Record<string, unknown> & { messages: ChatCompletionMessage[] };
  signal?: AbortSignal;
  timeout?: number;
  fallbackModel?: string;
}

export async function aiChat<T = ChatCompletionResponse>(
  opts: AiChatOptions,
): Promise<T> {
  const fallback = opts.fallbackModel ?? QWEN_FALLBACK_MODEL;
  const primary = opts.model;
  const call = async (model: string): Promise<T> => {
    return (await $fetch<unknown>(`${HACKCLUB_AI_URL}/chat/completions`, {
      method: "POST",
      signal: opts.signal,
      timeout: opts.timeout,
      headers: {
        Authorization: `Bearer ${opts.apiKey}`,
        "Content-Type": "application/json",
      },
      body: { ...opts.body, model },
    })) as T;
  };

  try {
    return await call(primary);
  } catch (err) {
    if (primary !== fallback) {
      console.warn(
        `[hackclub-ai] primary model "${primary}" failed, retrying with "${fallback}"`,
        err,
      );
      return await call(fallback);
    }
    throw err;
  }
}

function configuredAiKey(): string | undefined {
  const config = useRuntimeConfig();
  return config.hackclubAiKey as string | undefined;
}

export async function aiEmbed(input: string): Promise<number[] | null> {
  const apiKey = configuredAiKey();
  if (!apiKey) return null;
  try {
    const res = await fetch(`${HACKCLUB_AI_URL}/embeddings`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "text-embedding-3-small",
        input: input.slice(0, 8000), // keep within the embedding model's input limit
      }),
    });
    if (!res.ok) {
      return null;
    }
    const vec = ((await res.json()) as { data?: Array<{ embedding?: number[] }> }).data?.[0]?.embedding;
    return Array.isArray(vec) && vec.length > 0 ? vec : null;
  } catch {
    return null;
  }
}
