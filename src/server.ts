import "dotenv/config";
import { resolve } from "node:path";
import { z } from "zod";
import { Agent } from "./agent.js";
import { createApp } from "./app.js";
import { selectProvider } from "./llm/provider.js";

const numberSetting = (fallback: number, max: number) => z.preprocess(v => v === "" || v === undefined ? fallback : v, z.coerce.number().int().min(1).max(max));
const config = z.object({
  PORT: numberSetting(3000, 65535),
  REFERENCE_DATE: z.preprocess(v => v === "" ? undefined : v, z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v).optional()),
  LLM_MAX_ITERATIONS: numberSetting(25, 100),
  LLM_MAX_SESSION_TOKENS: numberSetting(100000, 10000000),
  LLM_MAX_TOTAL_TOKENS: numberSetting(1000000, 100000000),
  LLM_MAX_OUTPUT_TOKENS: numberSetting(4096, 32768),
  LLM_TIMEOUT_MS: numberSetting(30000, 120000),
  MAX_SESSIONS: numberSetting(100, 10000),
}).safeParse(process.env);

async function main() {
  if (!config.success) { console.error("Configuración inválida. Revisa los límites numéricos, PORT y REFERENCE_DATE en .env."); process.exitCode = 1; return; }
  const env = config.data;
  const selected = selectProvider(process.env, env.LLM_TIMEOUT_MS);
  const directory = resolve(process.cwd());
  const agent = await Agent.create({ directory, maxIterations: env.LLM_MAX_ITERATIONS, maxSessionTokens: env.LLM_MAX_SESSION_TOKENS, maxTotalTokens: env.LLM_MAX_TOTAL_TOKENS, maxOutputTokens: env.LLM_MAX_OUTPUT_TOKENS, maxSessions: env.MAX_SESSIONS, ...(env.REFERENCE_DATE ? { referenceDate: env.REFERENCE_DATE } : {}) }, selected.adapter);
  const app = createApp(agent, { directory, provider: selected.provider, model: selected.model, configured: selected.configured, secrets: selected.secrets });
  const server = app.listen(env.PORT, "0.0.0.0", () => console.log(`Servidor disponible en http://localhost:${env.PORT}; ${selected.provider} ${selected.configured ? "configurado" : "pendiente de configurar"}.`));
  server.on("error", (error: NodeJS.ErrnoException) => { console.error(error.code === "EADDRINUSE" ? "El puerto está ocupado. Configura otro PORT." : "No se pudo iniciar el servidor HTTP."); process.exitCode = 1; });
}
main().catch(() => { console.error("No se pudo iniciar. Revisa LLM_PROVIDER (openai/gemini/demo), el modelo seleccionado, agent/prompt.md y src/knowledge/."); process.exitCode = 1; });
