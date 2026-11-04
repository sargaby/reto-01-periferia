import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { LlmAdapter, LlmMessage, LlmResponse } from "./adapter.js";
import { mapear_campos, generar_formulario } from "../tools/proveedor.js";

const resultSchema = z.discriminatedUnion("ok", [z.object({ ok: z.literal(true), data: z.unknown() }), z.object({ ok: z.literal(false), error: z.string() }).passthrough()]);
type Result = z.infer<typeof resultSchema>;
interface Executed { name: string; args: Record<string, unknown>; result: Result }
const mappingSchema = z.object(generar_formulario.args).shape.mapeo;
const packageSchema = z.object({ ruta: z.string(), listo_para_firma: z.boolean(), formulario_disponible: z.boolean(), checklist: z.array(z.object({ tipo: z.string(), estado: z.string(), vigencia_hasta: z.string().nullable() })) });
const label = "Modo demostración determinista · Sin LLM ni API externa.";

function final(reply: string): LlmResponse {
  return { content: JSON.stringify({ reply: `${label}\n\n${reply}`, needsConfirmation: false }), toolCalls: [], totalTokens: 0 };
}
function call(name: string, args: Record<string, unknown>): LlmResponse {
  return { content: null, toolCalls: [{ id: randomUUID(), name, arguments: JSON.stringify(args) }], totalTokens: 0 };
}
function executed(messages: readonly LlmMessage[]): Executed[] {
  const calls = new Map(messages.flatMap(m => (m.toolCalls ?? []).map(c => [c.id, c] as const)));
  return messages.filter(m => m.role === "tool").map(m => {
    const previous = m.toolCallId ? calls.get(m.toolCallId) : undefined;
    if (!previous) throw new Error("El modo demo recibió un historial de herramientas incompleto.");
    return { name: previous.name, args: z.record(z.unknown()).parse(JSON.parse(previous.arguments) as unknown), result: resultSchema.parse(JSON.parse(m.content) as unknown) };
  });
}
function requestedCase(message: string): string | undefined {
  const named = [...message.matchAll(/\b(?:caso|solicitud)\s+["'`“]?([^\s"'`”?,;]+)/gi)].map(m => m[1]!.replace(/[.!]$/, ""));
  const ids = [...new Set(named.length ? named : message.match(/\b[a-z]{2}-[a-z0-9]+(?:-[a-z0-9]+)*\b/gi) ?? [])];
  if (ids.length === 1) return ids[0];
  if (!ids.length && /^[a-z0-9]+(?:-[a-z0-9]+)+$/.test(message.trim())) return message.trim();
  return undefined;
}
function summary(history: Executed[]): string {
  const lines: string[] = [];
  for (const entry of history) {
    if (!entry.result.ok) { lines.push(`${entry.name}: ${entry.result.error}`); continue; }
    const data = entry.result.data;
    if (entry.name === "proveedor_mapear_campos") {
      const mapped = mappingSchema.parse(data);
      lines.push(`Llenos (${mapped.llenos.length}): ${mapped.llenos.map(c => `${c.etiqueta} [${c.ruta_maestro}]`).join(", ") || "ninguno"}.`,
        `Faltantes (${mapped.faltantes.length}): ${mapped.faltantes.map(c => c.etiqueta).join(", ") || "ninguno"}.`,
        `Requiere confirmación (${mapped.requiere_confirmacion.length}): ${mapped.requiere_confirmacion.map(c => `${c.etiqueta}: ${c.nota} [${c.ruta_maestro}]`).join(", ") || "ninguno"}.`);
    } else if (entry.name === "proveedor_generar_formulario") {
      const form = z.object({ ruta: z.string(), formato: z.string() }).parse(data);
      lines.push(`Formulario ${form.formato}: ${form.ruta}`);
    } else if (entry.name === "proveedor_armar_paquete") {
      const pack = packageSchema.parse(data);
      lines.push(`Paquete: ${pack.ruta}`, `Listo para firma: ${pack.listo_para_firma ? "sí" : "no"}. Formulario disponible: ${pack.formulario_disponible ? "sí" : "no"}.`,
        ...pack.checklist.map(s => `- ${s.tipo}: ${s.estado}; vigencia: ${s.vigencia_hasta ?? "sin vencimiento registrado"}`));
    }
  }
  return lines.join("\n\n");
}

/** Planificador local: emite llamadas, nunca ejecuta herramientas ni consulta la red. */
export class DemoAdapter implements LlmAdapter {
  readonly metering = "local" as const;
  async enviar(messages: readonly LlmMessage[]): Promise<LlmResponse> {
    let index = messages.length - 1;
    while (index >= 0 && messages[index]?.role !== "user") index--;
    const message = messages[index]?.content.trim() ?? "";
    const history = executed(messages.slice(index + 1));
    if (!history.length) {
      if (/^(?:por favor[, ]*)?(?:env[ií]a|enviar|firma|firmar|carga|cargar)\b/i.test(message)) return final("El envío, la firma y la carga a portales no están implementados. No se realizó ninguna acción externa.");
      if (/^(s[ií]|confirmo|confirmado|de acuerdo|acepto|s[ií],? confirmo)[.!\s]*$/i.test(message)) {
        const confirmed = messages.some(m => m.role === "system" && m.content.includes("actual: true"));
        return final(confirmed ? "Revisión reconocida en este turno. No se cambió ningún dato ni se enviaron documentos." : "No había una confirmación pendiente válida para este turno. No se enviaron documentos.");
      }
      if (/\bno\s+(?:proces|ejecut|gener)/i.test(message)) return final("No se procesó ningún caso. Indica un caso cuando quieras ejecutar las herramientas.");
      const caso = requestedCase(message);
      return caso ? call("proveedor_leer_solicitud", { caso }) : final("Indica un único identificador de caso, por ejemplo: Procesa el caso \"<identificador>\". Este modo no interpreta preguntas generales ni modifica datos.");
    }
    const first = history[0]!;
    const caso = first.args.caso;
    if (typeof caso !== "string") return final(summary(history));
    const last = history.at(-1)!;
    if (last.name === "proveedor_leer_solicitud" && last.result.ok) {
      const source = z.object({ campos: mapear_campos.args.campos }).parse(last.result.data);
      return call("proveedor_mapear_campos", { caso, campos: source.campos });
    }
    if (last.name === "proveedor_mapear_campos" && last.result.ok) return call("proveedor_generar_formulario", { caso, mapeo: mappingSchema.parse(last.result.data) });
    if (last.name === "proveedor_generar_formulario") return call("proveedor_armar_paquete", { caso });
    return final(summary(history));
  }
}
