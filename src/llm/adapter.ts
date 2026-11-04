/** Contrato independiente del proveedor; conserva el protocolo de llamadas. */
export interface LlmMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCallId?: string;
  toolCalls?: readonly LlmToolCall[];
  /** Estado opaco serializado que el adaptador necesita para reproducir el mensaje. */
  continuation?: string;
}

export interface LlmToolDefinition {
  name: string;
  description: string;
  parameters: Readonly<Record<string, unknown>>;
}

export interface LlmToolCall {
  id: string;
  name: string;
  /** JSON original: los argumentos inválidos deben poder devolverse al modelo. */
  arguments: string;
}

export interface LlmResponse {
  content: string | null;
  toolCalls: readonly LlmToolCall[];
  totalTokens: number;
  continuation?: string;
}

export interface LlmAdapter {
  /** Los planificadores locales no consumen ni reservan tokens de un proveedor. */
  readonly metering?: "local" | "tokens";
  /** Reserva adicional para comprobaciones internas acotadas del adaptador. */
  readonly overheadTokens?: number;
  enviar(
    mensajes: readonly LlmMessage[],
    herramientas: readonly LlmToolDefinition[],
    options: { maxOutputTokens: number },
  ): Promise<LlmResponse>;
}
