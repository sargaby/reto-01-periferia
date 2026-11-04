import express from "express";
import { resolve } from "node:path";
import { z } from "zod";
import type { Agent } from "./agent.js";

const chatSchema = z.object({ sessionId: z.string().uuid().optional(), message: z.string().trim().min(1).max(8000) }).strict();
export function createApp(agent: Agent, options: { directory: string; model: string | null; configured: boolean; provider?: "openai" | "gemini" | "demo"; apiKey?: string; secrets?: readonly string[] }) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "64kb" }));
  const send = (response: express.Response, status: number, body: unknown) => {
    let serialized = JSON.stringify(body);
    for (const secret of [...(options.secrets ?? []), options.apiKey].filter((v): v is string => Boolean(v))) serialized = serialized.split(secret).join("[SECRETO OMITIDO]");
    response.status(status).type("json").send(serialized);
  };
  app.get("/api/health", (_req, res) => send(res, 200, { ok: true, provider: options.provider ?? "openai", model: options.model, configured: options.configured, ...(options.provider === "demo" ? { demonstration: true } : {}) }));
  app.post("/api/chat", async (req, res) => {
    const parsed = chatSchema.safeParse(req.body);
    if (!parsed.success) { send(res, 400, { error: "Envía message (1–8000 caracteres) y, opcionalmente, un sessionId UUID existente." }); return; }
    const result = await agent.chat(parsed.data.message, parsed.data.sessionId);
    send(res, result.status, result.body);
  });
  app.get("/api/sessions/:id", (req, res) => {
    if (!z.string().uuid().safeParse(req.params.id).success) { send(res, 400, { error: "Identificador de sesión inválido." }); return; }
    const session = agent.getSession(req.params.id);
    send(res, session ? 200 : 404, session ?? { error: "Sesión inexistente." });
  });
  app.use(express.static(resolve(options.directory, "web")));
  app.use((_req, res) => send(res, 404, { error: "Ruta no encontrada" }));
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const status = error instanceof SyntaxError ? 400 : typeof error === "object" && error !== null && "status" in error && error.status === 413 ? 413 : 500;
    send(res, status, { error: status === 400 ? "El cuerpo debe ser JSON válido." : status === 413 ? "El mensaje excede el tamaño permitido." : "No se pudo completar la solicitud. La sesión se conserva." });
  });
  return app;
}
