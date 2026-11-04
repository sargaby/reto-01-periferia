import { z } from "zod";
import type { LlmAdapter, LlmMessage, LlmToolDefinition } from "./adapter.js";

const completionSchema = z.object({
  choices: z.array(z.object({
    finish_reason: z.string(),
    message: z.object({
      content: z.string().nullable(),
      refusal: z.string().nullable().optional(),
      tool_calls: z.array(z.object({ id: z.string(), type: z.literal("function"), function: z.object({ name: z.string(), arguments: z.string() }) })).optional(),
    }),
  })).min(1),
  usage: z.object({ total_tokens: z.number().int().nonnegative() }),
});

export class OpenAIAdapter implements LlmAdapter {
  constructor(private readonly config: { apiKey: string; model: string; timeoutMs: number }, private readonly request: typeof fetch = fetch) {}

  async enviar(mensajes: readonly LlmMessage[], herramientas: readonly LlmToolDefinition[], options: { maxOutputTokens: number }) {
    const messages = mensajes.map(m => ({
      role: m.role, content: m.content,
      ...(m.toolCallId ? { tool_call_id: m.toolCallId } : {}),
      ...(m.toolCalls?.length ? { tool_calls: m.toolCalls.map(t => ({ id: t.id, type: "function", function: { name: t.name, arguments: t.arguments } })) } : {}),
    }));
    let response: Response;
    try {
      response = await this.request("https://api.openai.com/v1/chat/completions", {
        method: "POST", headers: { Authorization: `Bearer ${this.config.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: this.config.model, messages, tools: herramientas.map(t => ({ type: "function", function: { ...t, strict: false } })), tool_choice: "auto", parallel_tool_calls: false, max_completion_tokens: options.maxOutputTokens, response_format: { type: "json_object" }, store: false }),
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
      if (!response.ok) {
        const reason = response.status === 401 ? "Clave OpenAI rechazada: revisa OPENAI_API_KEY en el backend."
          : response.status === 429 ? "OpenAI limitó la solicitud o la cuota; revisa el saldo y vuelve a intentar."
          : response.status === 400 || response.status === 404 ? "OpenAI rechazó la configuración: revisa el modelo y su compatibilidad con Chat Completions, JSON y herramientas."
          : "OpenAI no está disponible temporalmente. Intenta de nuevo.";
        await response.body?.cancel();
        throw new Error(reason);
      }
      // Mantener el timeout activo también durante la lectura del cuerpo.
      const parsed = completionSchema.safeParse(await response.json());
      if (!parsed.success) throw new Error("OpenAI devolvió una respuesta con estructura no válida.");
      const choice = parsed.data.choices[0]!;
      if (choice.finish_reason === "length") throw new Error("La respuesta alcanzó el límite de salida. Aumenta LLM_MAX_OUTPUT_TOKENS o reduce la solicitud.");
      if (choice.message.refusal || choice.finish_reason === "content_filter") throw new Error("El proveedor no pudo responder a esta solicitud.");
      return { content: choice.message.content, toolCalls: (choice.message.tool_calls ?? []).map(t => ({ id: t.id, name: t.function.name, arguments: t.function.arguments })), totalTokens: parsed.data.usage.total_tokens };
    } catch (error) {
      if (error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name)) throw new Error("OpenAI excedió el tiempo de espera. Puedes volver a intentar en esta sesión.");
      if (error instanceof TypeError) throw new Error("No se pudo conectar con OpenAI. Revisa la conexión del backend.");
      if (error instanceof SyntaxError) throw new Error("OpenAI devolvió una respuesta ilegible.");
      throw error;
    }
  }
}
