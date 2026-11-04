/** Contrato preliminar; no hay proveedor conectado ni ciclo del agente. */
export interface LlmMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCallId?: string;
}

export interface LlmToolDefinition {
  name: string;
  description: string;
  parameters: Readonly<Record<string, unknown>>;
}

export interface LlmToolCall {
  id: string;
  name: string;
  arguments: Readonly<Record<string, unknown>>;
}

export interface LlmResponse {
  content: string | null;
  toolCalls: readonly LlmToolCall[];
}

export interface LlmAdapter {
  enviar(
    mensajes: readonly LlmMessage[],
    herramientas: readonly LlmToolDefinition[],
  ): Promise<LlmResponse>;
}
