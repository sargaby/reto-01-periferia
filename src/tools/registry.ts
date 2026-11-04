import { appendFile, lstat, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import * as proveedor from "./proveedor.js";
import type { LlmToolDefinition } from "../llm/adapter.js";

/** Conversión de los tipos Zod presentes en las herramientas P0, sin duplicar contratos. */
function jsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  let result: Record<string, unknown>;
  if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable) {
    const inner = jsonSchema(schema.unwrap());
    result = schema instanceof z.ZodNullable ? { anyOf: [inner, { type: "null" }] } : inner;
  } else if (schema instanceof z.ZodObject) {
    const shape: z.ZodRawShape = schema.shape;
    result = { type: "object", properties: Object.fromEntries(Object.entries(shape).map(([key, value]) => [key, jsonSchema(value)])), required: Object.keys(shape).filter(key => !shape[key]!.isOptional()), additionalProperties: false };
  } else if (schema instanceof z.ZodArray) result = { type: "array", items: jsonSchema(schema.element) };
  else if (schema instanceof z.ZodUnion) result = { anyOf: (schema.options as z.ZodTypeAny[]).map(jsonSchema) };
  else if (schema instanceof z.ZodEnum) result = { type: "string", enum: schema.options };
  else if (schema instanceof z.ZodString) {
    result = { type: "string" };
    for (const check of schema._def.checks) {
      if (check.kind === "regex") result.pattern = check.regex.source;
      if (check.kind === "min") result.minLength = check.value;
      if (check.kind === "max") result.maxLength = check.value;
    }
  } else if (schema instanceof z.ZodNumber) result = { type: "number" };
  else if (schema instanceof z.ZodBoolean) result = { type: "boolean" };
  else throw new Error("Tipo Zod no soportado en el registro de herramientas");
  return schema.description ? { ...result, description: schema.description } : result;
}

function register<S extends z.ZodRawShape>(name: string, tool: { description: string; args: S; execute: (args: z.infer<z.ZodObject<S>>, ctx: proveedor.ToolContext) => Promise<string> }) {
  const schema = z.object(tool.args).strict();
  return { definition: { name, description: tool.description, parameters: jsonSchema(schema) } satisfies LlmToolDefinition,
    async execute(raw: unknown, ctx: proveedor.ToolContext) {
      const parsed = schema.safeParse(raw);
      if (!parsed.success) return { rejected: true, result: JSON.stringify({ ok: false, error: "Argumentos inválidos", detalles: parsed.error.issues.map(i => ({ campo: i.path.join("."), problema: i.message })) }) };
      return { rejected: false, result: await tool.execute(parsed.data, ctx) };
    },
  };
}
const tools = [register("proveedor_leer_solicitud", proveedor.leer_solicitud), register("proveedor_mapear_campos", proveedor.mapear_campos), register("proveedor_generar_formulario", proveedor.generar_formulario), register("proveedor_armar_paquete", proveedor.armar_paquete)];
export const definitions = tools.map(t => t.definition);

/** Las ejecuciones P0 ya registran sus logs; solo auditar aquí los rechazos previos. */
async function logRejection(ctx: proveedor.ToolContext, name: string, raw: unknown) {
  const caso = z.object({ caso: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(100) }).safeParse(raw);
  const destinations = [join(ctx.directory, "out")];
  if (caso.success) destinations.push(join(ctx.directory, "out", caso.data.caso));
  const line = JSON.stringify({ ts: new Date().toISOString(), herramienta: name, ok: false, resumen: "Llamada rechazada antes de ejecutar", sessionId: ctx.sessionId }) + "\n";
  for (const directory of destinations) {
    try { if ((await lstat(directory)).isSymbolicLink()) throw new Error("Ruta de log insegura"); } catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error; }
    await mkdir(directory, { recursive: true });
    const path = join(directory, "log.jsonl");
    try { if ((await lstat(path)).isSymbolicLink()) throw new Error("Ruta de log insegura"); } catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error; }
    await appendFile(path, line);
  }
}
export async function executeTool(name: string, argumentsJson: string, ctx: proveedor.ToolContext): Promise<string> {
  let raw: unknown;
  try { raw = JSON.parse(argumentsJson) as unknown; } catch { raw = null; }
  try {
    const registered = tools.find(t => t.definition.name === name);
    const outcome = registered ? await registered.execute(raw, ctx) : { rejected: true, result: JSON.stringify({ ok: false, error: "Herramienta no disponible. No hay acciones de envío, firma ni carga a portales." }) };
    if (outcome.rejected) await logRejection(ctx, name, raw);
    return outcome.result;
  } catch { return JSON.stringify({ ok: false, error: "No se pudo ejecutar o auditar la herramienta. Revisa los archivos de salida." }); }
}
