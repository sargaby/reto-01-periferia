import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { LlmAdapter, LlmMessage, LlmToolCall } from "./llm/adapter.js";
import { definitions, executeTool } from "./tools/registry.js";

export interface AgentConfig { directory: string; maxIterations: number; maxSessionTokens: number; maxTotalTokens: number; maxOutputTokens: number; maxSessions: number; referenceDate?: string }
export interface HistoryEvent { role: "user" | "assistant" | "tool"; content: string; needsConfirmation?: boolean; toolCall?: { id: string; name: string; arguments: string; result: string } }
interface Session { id: string; messages: LlmMessage[]; history: HistoryEvent[]; needsConfirmation: boolean; reservedTokens: number; actualTokens: number }
const finalSchema = z.object({ reply: z.string().min(1), needsConfirmation: z.boolean() });
const affirmative = /^(s[ií]|confirmo|confirmado|de acuerdo|acepto|s[ií],? confirmo)[.!\s]*$/i;

/** La continuación sustituye la representación común en el adaptador, no la duplica. */
function inputBytes(messages: readonly LlmMessage[]): number {
  return messages.reduce((sum, message) => {
    const { continuation, ...common } = message;
    return sum + Math.max(Buffer.byteLength(JSON.stringify(common), "utf8"), Buffer.byteLength(continuation ?? "", "utf8")) + 2;
  }, 2);
}

export class Agent {
  private readonly sessions = new Map<string, Session>();
  private totalReservedTokens = 0;
  private busy = false;
  private constructor(private readonly config: AgentConfig, private readonly adapter: LlmAdapter | undefined, private readonly instructions: string) {}
  static async create(config: AgentConfig, adapter?: LlmAdapter) {
    const [prompt, knowledge] = await Promise.all([readFile(join(config.directory, "agent", "prompt.md"), "utf8"), readFile(join(config.directory, "src", "knowledge", "registro-proveedor.md"), "utf8")]);
    return new Agent(config, adapter, `${prompt}\n\n<conocimiento>\n${knowledge}\n</conocimiento>`);
  }
  getSession(id: string) { const session = this.sessions.get(id); return session ? this.view(session) : undefined; }
  private view(session: Session) {
    return { sessionId: session.id, history: session.history, needsConfirmation: session.needsConfirmation, tokens: { reserved: session.reservedTokens, actual: session.actualTokens, limit: this.config.maxSessionTokens } };
  }
  private finish(session: Session, reply: string, needsConfirmation = false, status = 200) {
    if (needsConfirmation) reply += "\n\n¿Confirmas que has revisado los resultados y sus advertencias? Esta revisión no envía, firma ni carga documentos.";
    session.needsConfirmation = needsConfirmation;
    session.history.push({ role: "assistant", content: reply, needsConfirmation });
    session.messages.push({ role: "assistant", content: JSON.stringify({ reply, needsConfirmation }) });
    return { status, body: { ...this.view(session), reply, toolCalls: session.history.filter(e => e.role === "tool").map(e => e.toolCall) } };
  }
  async chat(message: string, sessionId?: string) {
    if (this.busy) return { status: 409, body: { error: "Hay una solicitud en proceso. Espera a que termine para proteger los archivos compartidos." } };
    let session = sessionId ? this.sessions.get(sessionId) : undefined;
    if (sessionId && !session) return { status: 404, body: { error: "Sesión inexistente. Inicia una conversación nueva." } };
    if (!session) {
      if (this.sessions.size >= this.config.maxSessions) return { status: 429, body: { error: "Se alcanzó el límite de sesiones del servidor." } };
      session = { id: randomUUID(), messages: [], history: [], needsConfirmation: false, reservedTokens: 0, actualTokens: 0 };
      this.sessions.set(session.id, session);
    }
    if (session.history.length >= 500) return { status: 429, body: { error: "La sesión alcanzó el límite de historial. Inicia una nueva conversación." } };
    const confirmed = session.needsConfirmation && affirmative.test(message.trim());
    session.needsConfirmation = false;
    session.history.push({ role: "user", content: message });
    session.messages.push({ role: "user", content: message });
    if (!this.adapter) return this.finish(session, "Configura la clave y el modelo del proveedor seleccionado con LLM_PROVIDER en .env del backend y reinicia el servidor. No se llamó al modelo ni se procesó el caso.", false, 503);
    this.busy = true;
    let reviewRequired = false;
    const currentTools: string[] = [];
    try {
      for (let iteration = 0; iteration < this.config.maxIterations; iteration++) {
        const messages: LlmMessage[] = [{ role: "system", content: this.instructions }, { role: "system", content: `Confirmación explícita de revisión en el mensaje actual: ${confirmed}. Nunca autoriza envíos; no hay herramientas externas. Fecha de referencia para vigencias: ${this.config.referenceDate ?? new Date().toISOString().slice(0, 10)}.` }, ...session.messages];
        // Reserva conservadora por bytes UTF-8, margen de protocolo y salida máxima.
        const reservation = this.adapter.metering === "local" ? 0 : inputBytes(messages) + Buffer.byteLength(JSON.stringify(definitions), "utf8") + 2048 + messages.length * 64 + this.config.maxOutputTokens + (this.adapter.overheadTokens ?? 0);
        if (session.reservedTokens + reservation > this.config.maxSessionTokens || this.totalReservedTokens + reservation > this.config.maxTotalTokens) return this.finish(session, this.partial("Se alcanzó el presupuesto de tokens. No se harán más llamadas con este presupuesto.", currentTools), reviewRequired);
        session.reservedTokens += reservation; this.totalReservedTokens += reservation;
        const answer = await this.adapter.enviar(messages, definitions, { maxOutputTokens: this.config.maxOutputTokens });
        session.actualTokens += answer.totalTokens;
        if (answer.totalTokens > reservation) { const extra = answer.totalTokens - reservation; session.reservedTokens += extra; this.totalReservedTokens += extra; }
        if (answer.toolCalls.length) {
          if (answer.toolCalls.length > 8 || new Set(answer.toolCalls.map(t => t.id)).size !== answer.toolCalls.length) throw new Error("El modelo devolvió demasiadas llamadas o identificadores duplicados. Intenta una solicitud más pequeña.");
          session.messages.push({ role: "assistant", content: answer.content ?? "", toolCalls: answer.toolCalls, ...(answer.continuation ? { continuation: answer.continuation } : {}) });
          for (const call of answer.toolCalls) {
            const result = await this.runTool(session, call);
            currentTools.push(`${call.name}: ${result.ok ? "completada" : "fallida"}`);
            if (result.reviewRequired) reviewRequired = true;
          }
          continue;
        }
        const parsed = finalSchema.safeParse(this.readJson(answer.content));
        if (!parsed.success) throw new Error("La respuesta del modelo no tiene el formato esperado. Puedes volver a intentar; los resultados de herramientas se conservan.");
        return this.finish(session, parsed.data.reply, reviewRequired || parsed.data.needsConfirmation);
      }
      return this.finish(session, this.partial("Se alcanzó el límite de iteraciones; el procesamiento está incompleto.", currentTools), reviewRequired);
    } catch (error) {
      const reply = error instanceof Error ? error.message : "No se pudo completar el turno. Puedes volver a intentar.";
      return this.finish(session, this.partial(reply, currentTools), reviewRequired, 502);
    } finally { this.busy = false; }
  }
  private readJson(content: string | null): unknown { try { return JSON.parse(content ?? "") as unknown; } catch { return null; } }
  private partial(reason: string, tools: string[]) {
    return `${reason}${tools.length ? `\n\nResultados disponibles en el historial:\n${tools.map(t => `- ${t}`).join("\n")}` : ""}\nNo se realizó ningún envío, firma ni carga a un portal.`;
  }
  private async runTool(session: Session, call: LlmToolCall) {
    const result = await executeTool(call.name, call.arguments, { directory: this.config.directory, sessionId: session.id, ...(this.config.referenceDate ? { referenceDate: this.config.referenceDate } : {}) });
    session.messages.push({ role: "tool", content: result, toolCallId: call.id });
    session.history.push({ role: "tool", content: result, toolCall: { ...call, result } });
    const parsed = z.object({ ok: z.boolean(), data: z.unknown().optional() }).parse(this.readJson(result));
    const review = z.object({ requiere_confirmacion: z.array(z.unknown()).optional() }).safeParse(parsed.data);
    return { ok: parsed.ok, reviewRequired: parsed.ok && (call.name === "proveedor_armar_paquete" || (review.success && (review.data.requiere_confirmacion?.length ?? 0) > 0)) };
  }
}
