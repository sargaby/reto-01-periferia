import { randomUUID } from "node:crypto";
import { GoogleGenAI, FunctionCallingConfigMode, type Content, type Part, type GenerateContentParameters, type GenerateContentResponse, type GetModelParameters, type Model } from "@google/genai";
import { z } from "zod";
import type { LlmAdapter, LlmMessage, LlmResponse, LlmToolDefinition } from "./adapter.js";

/** Solo la superficie SDK usada; permite pruebas sin red ni claves reales. */
export interface GeminiClient {
  models: { get(params: GetModelParameters): Promise<Model>; generateContent(params: GenerateContentParameters): Promise<GenerateContentResponse> };
}
class GeminiError extends Error {}
const recordSchema = z.record(z.unknown());
const contentSchema = z.object({ role: z.literal("model"), parts: z.array(z.object({}).passthrough()) });

function parseRecord(text: string): Record<string, unknown> {
  try { return recordSchema.parse(JSON.parse(text) as unknown); }
  catch { throw new GeminiError("El historial contiene JSON de herramientas inválido."); }
}
function translate(messages: readonly LlmMessage[]) {
  const contents: Content[] = [];
  const calls = new Map<string, { name: string; id?: string }>();
  const append = (role: string, parts: Part[]) => {
    const last = contents.at(-1);
    if (last?.role === role) last.parts!.push(...parts); else contents.push({ role, parts });
  };
  for (const message of messages) {
    if (message.role === "system") continue;
    if (message.role === "assistant" && message.toolCalls?.length) {
      let content: Content;
      if (message.continuation) {
        // Conserva partes y thoughtSignature originales, sin fusionarlas entre sí.
        try { content = contentSchema.parse(JSON.parse(message.continuation) as unknown); }
        catch { throw new GeminiError("No se pudo recuperar el estado de continuación del modelo."); }
      } else {
        content = { role: "model", parts: message.toolCalls.map(call => ({ functionCall: { id: call.id, name: call.name, args: parseRecord(call.arguments) } })) };
      }
      const originalCalls = (content.parts ?? []).flatMap(part => part.functionCall ? [part.functionCall] : []);
      if (originalCalls.length !== message.toolCalls.length) throw new GeminiError("El historial de llamadas no coincide con su continuación.");
      message.toolCalls.forEach((call, index) => {
        const original = originalCalls[index]!;
        calls.set(call.id, { name: call.name, ...(original.id ? { id: original.id } : {}) });
      });
      append("model", content.parts ?? []);
    } else if (message.role === "tool") {
      const call = message.toolCallId ? calls.get(message.toolCallId) : undefined;
      if (!call) throw new GeminiError("Respuesta de herramienta sin una llamada previa correspondiente.");
      append("user", [{ functionResponse: { name: call.name, ...(call.id ? { id: call.id } : {}), response: parseRecord(message.content) } }]);
    } else append(message.role === "assistant" ? "model" : "user", [{ text: message.content }]);
  }
  return { systemInstruction: messages.filter(m => m.role === "system").map(m => m.content).join("\n\n"), contents };
}

function responseData(response: GenerateContentResponse): LlmResponse {
  const candidate = response.candidates?.[0];
  if (candidate?.finishReason === "MAX_TOKENS") throw new GeminiError("Gemini alcanzó el límite de salida. Ajusta LLM_MAX_OUTPUT_TOKENS o reduce la solicitud.");
  if (!candidate?.content?.parts?.length || (candidate.finishReason && candidate.finishReason !== "STOP")) throw new GeminiError("Gemini no pudo completar la respuesta (bloqueo o formato no admitido).");
  const tokens = response.usageMetadata?.totalTokenCount;
  if (tokens === undefined || !Number.isInteger(tokens) || tokens < 0) throw new GeminiError("Gemini no informó un consumo válido de tokens.");
  const content: Content = { ...candidate.content, role: "model" };
  const toolCalls = (content.parts ?? []).flatMap(part => {
    if (!part.functionCall) return [];
    if (!part.functionCall.name) throw new GeminiError("Gemini devolvió una llamada sin nombre de herramienta.");
    return [{ id: part.functionCall.id ?? randomUUID(), name: part.functionCall.name, arguments: JSON.stringify(part.functionCall.args ?? {}) }];
  });
  return { content: (content.parts ?? []).filter(p => !p.thought && p.text !== undefined).map(p => p.text).join("") || null, toolCalls, totalTokens: tokens, ...(toolCalls.length ? { continuation: JSON.stringify(content) } : {}) };
}

function safeError(error: unknown): Error {
  if (error instanceof GeminiError) return error;
  if (error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name)) return new GeminiError("Gemini excedió el tiempo de espera. Puedes reintentar en esta sesión.");
  const status = typeof error === "object" && error !== null && "status" in error ? error.status : undefined;
  if (status === 408 || status === 504) return new GeminiError("Gemini excedió el tiempo de espera. Puedes reintentar en esta sesión.");
  if (status === 401 || status === 403) return new GeminiError("Gemini rechazó la clave o el acceso. Revisa GEMINI_API_KEY y los permisos en Google AI Studio.");
  if (status === 404) return new GeminiError("GEMINI_MODEL no existe o no está disponible con esta clave.");
  if (status === 400) return new GeminiError("Gemini rechazó la configuración: revisa GEMINI_MODEL y su compatibilidad con herramientas.");
  if (status === 429) return new GeminiError("Gemini limitó la solicitud o la cuota. Revisa el proyecto de Google AI Studio.");
  return new GeminiError("No se pudo conectar o completar la solicitud con Gemini. Revisa la red y vuelve a intentar.");
}

export class GeminiAdapter implements LlmAdapter {
  private verified = false;
  get overheadTokens(): number { return this.verified ? 0 : 4096; }
  private readonly client: GeminiClient;
  constructor(private readonly config: { apiKey: string; model: string; timeoutMs: number }, client?: GeminiClient) {
    if (!/^(models\/)?[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(config.model)) throw new GeminiError("GEMINI_MODEL debe ser un identificador de modelo de Google AI Studio.");
    this.client = client ?? new GoogleGenAI({ apiKey: config.apiKey, vertexai: false, httpOptions: { timeout: config.timeoutMs, retryOptions: { attempts: 1 } } });
  }
  /** Una prueba acotada de capacidad; nunca ejecuta herramientas de negocio. */
  async verifyModel(): Promise<{ functionCalling: true; totalTokens: number }> {
    if (this.verified) return { functionCalling: true, totalTokens: 0 };
    try {
      const model = await this.client.models.get({ model: this.config.model, config: { abortSignal: AbortSignal.timeout(this.config.timeoutMs) } });
      if (!model.name || !model.supportedActions?.includes("generateContent")) throw new GeminiError("El modelo configurado no admite generateContent.");
      // Los metadatos no prueban function calling: comprobar una llamada forzada real.
      const probe = await this.client.models.generateContent({ model: this.config.model, contents: [{ role: "user", parts: [{ text: "Call verificar_capacidad with no arguments. Do not perform any external action." }] }], config: {
        maxOutputTokens: 1024, abortSignal: AbortSignal.timeout(this.config.timeoutMs), automaticFunctionCalling: { disable: true }, automaticContinuation: false,
        tools: [{ functionDeclarations: [{ name: "verificar_capacidad", description: "Comprueba únicamente la capacidad de emitir una llamada.", parametersJsonSchema: { type: "object", properties: {}, additionalProperties: false } }] }],
        toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.ANY, allowedFunctionNames: ["verificar_capacidad"] } },
      } });
      const result = responseData(probe);
      if (result.toolCalls.length !== 1 || result.toolCalls[0]?.name !== "verificar_capacidad") throw new GeminiError("No se pudo verificar function calling en GEMINI_MODEL; el modelo no emitió la llamada requerida.");
      this.verified = true;
      return { functionCalling: true, totalTokens: result.totalTokens };
    } catch (error) { throw safeError(error); }
  }
  async enviar(messages: readonly LlmMessage[], tools: readonly LlmToolDefinition[], options: { maxOutputTokens: number }): Promise<LlmResponse> {
    try {
      const check = await this.verifyModel();
      const { contents, systemInstruction } = translate(messages);
      const response = await this.client.models.generateContent({ model: this.config.model, contents, config: {
        systemInstruction, maxOutputTokens: options.maxOutputTokens, abortSignal: AbortSignal.timeout(this.config.timeoutMs),
        automaticFunctionCalling: { disable: true }, automaticContinuation: false,
        tools: tools.length ? [{ functionDeclarations: tools.map(t => ({ name: t.name, description: t.description, parametersJsonSchema: t.parameters })) }] : [],
        toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.AUTO } },
        // No forzar JSON MIME con herramientas: el prompt común exige JSON al finalizar.
      } });
      const result = responseData(response);
      return { ...result, totalTokens: result.totalTokens + check.totalTokens };
    } catch (error) { throw safeError(error); }
  }
}
