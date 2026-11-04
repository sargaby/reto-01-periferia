import { z } from "zod";
import { GeminiAdapter } from "./gemini.js";
import { OpenAIAdapter } from "./openai.js";
import type { LlmAdapter } from "./adapter.js";
import { DemoAdapter } from "./demo.js";

const providerSchema = z.preprocess(value => value === "" || value === undefined ? "openai" : value, z.enum(["openai", "gemini", "demo"]));
export function selectProvider(env: NodeJS.ProcessEnv, timeoutMs: number): { provider: "openai" | "gemini" | "demo"; model: string | null; configured: boolean; adapter?: LlmAdapter; secrets: string[] } {
  const provider = providerSchema.parse(env.LLM_PROVIDER);
  const secrets = [env.OPENAI_API_KEY?.trim(), env.GEMINI_API_KEY?.trim()].filter((v): v is string => Boolean(v));
  if (provider === "demo") return { provider, model: null, configured: true, adapter: new DemoAdapter(), secrets };
  const apiKey = (provider === "gemini" ? env.GEMINI_API_KEY : env.OPENAI_API_KEY)?.trim();
  const model = ((provider === "gemini" ? env.GEMINI_MODEL : env.OPENAI_MODEL) ?? "").trim();
  const configured = Boolean(apiKey && model);
  const adapter = configured ? (provider === "gemini" ? new GeminiAdapter({ apiKey: apiKey!, model, timeoutMs }) : new OpenAIAdapter({ apiKey: apiKey!, model, timeoutMs })) : undefined;
  return { provider, model: model || null, configured, ...(adapter ? { adapter } : {}), secrets };
}
