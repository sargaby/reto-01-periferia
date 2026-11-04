import { appendFile, copyFile, lstat, mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import ExcelJS from "exceljs";
import { z } from "zod";

export interface ToolContext { directory: string; sessionId: string; referenceDate?: string }
const casoSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(100).describe("Carpeta del caso dentro de fixtures/reto-01/casos");
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v, "Fecha inválida");
const campoSchema = z.object({ etiqueta: z.string().min(1), obligatorio: z.boolean().optional(), hoja: z.string().min(1).optional(), celda_etiqueta: z.string().regex(/^[A-Z]{1,3}[1-9]\d{0,6}$/).optional(), celda_valor: z.string().regex(/^[A-Z]{1,3}[1-9]\d{0,6}$/).optional() });
const valorSchema = z.union([z.string(), z.number().finite(), z.boolean()]);
const resultadoSchema = z.object({ etiqueta: z.string(), estado: z.enum(["lleno", "faltante", "requiere_confirmacion"]), ruta_maestro: z.string().nullable(), valor: valorSchema.nullable(), confianza: z.number(), nota: z.string(), identificador_pais: z.string().optional() });
const mapeoSchema = z.object({ llenos: z.array(resultadoSchema), faltantes: z.array(resultadoSchema), requiere_confirmacion: z.array(resultadoSchema) });
type Campo = z.infer<typeof campoSchema>;
type Mapeo = z.infer<typeof mapeoSchema>;
const solicitudSchema = z.object({ id: z.string(), de: z.string(), asunto: z.string(), fecha: dateSchema, pais: z.string(), cliente: z.string(), cuerpo: z.string(), formato: z.enum(["xlsx", "pdf", "portal"]), adjuntos: z.array(z.string()) });
const soporteSchema = z.object({ tipo: z.string(), archivo: z.string(), vigencia_hasta: dateSchema.nullable(), pais_emisor: z.string() });

/** Rechaza escapes y enlaces simbólicos/junctions en cualquier componente existente. */
async function safePath(ctx: ToolContext, ...parts: string[]): Promise<string> {
  const root = resolve(ctx.directory);
  const target = resolve(root, ...parts);
  const rel = relative(root, target);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error("Ruta fuera del proyecto");
  let current = root;
  for (const part of ["", ...rel.split(sep).filter(Boolean)]) {
    current = join(current, part);
    try { if ((await lstat(current)).isSymbolicLink()) throw new Error("No se permiten enlaces simbólicos"); }
    catch (error) { if (!isMissing(error)) throw error; }
  }
  return target;
}
function isMissing(error: unknown): boolean { return error instanceof Error && "code" in error && error.code === "ENOENT"; }
async function json(ctx: ToolContext, ...parts: string[]): Promise<unknown> { return JSON.parse(await readFile(await safePath(ctx, ...parts), "utf8")) as unknown; }
async function save(ctx: ToolContext, caso: string, filename: string, content: string): Promise<void> {
  const path = await safePath(ctx, "out", caso, filename);
  await mkdir(await safePath(ctx, "out", caso), { recursive: true });
  await writeFile(path, content, "utf8");
}
function referenceDate(ctx: ToolContext): string { return dateSchema.parse(ctx.referenceDate ?? new Date().toISOString().slice(0, 10)); }
function publicPath(caso: string, file: string): string { return `out/${caso}/${file}`; }
function errorMessage(error: unknown): string {
  if (error instanceof z.ZodError) return "Datos o argumentos inválidos: revisa la estructura de la solicitud, plantilla o repositorio.";
  if (error instanceof SyntaxError) return "Archivo JSON corrupto.";
  if (isMissing(error)) return "Caso o archivo requerido inexistente.";
  if (error instanceof Error && "code" in error) return "No se pudo acceder a los archivos de entrada o salida.";
  return error instanceof Error ? error.message : "Error inesperado al procesar el caso.";
}
async function log(ctx: ToolContext, caso: unknown, herramienta: string, ok: boolean): Promise<void> {
  const line = JSON.stringify({ ts: new Date().toISOString(), herramienta, ok, resumen: ok ? "Operación completada" : "Operación no completada", sessionId: ctx.sessionId }) + "\n";
  const dir = await safePath(ctx, "out");
  await mkdir(dir, { recursive: true });
  await appendFile(await safePath(ctx, "out", "log.jsonl"), line);
  if (casoSchema.safeParse(caso).success && typeof caso === "string") {
    await mkdir(await safePath(ctx, "out", caso), { recursive: true });
    await appendFile(await safePath(ctx, "out", caso, "log.jsonl"), line);
  }
}
function tool<S extends z.ZodRawShape, T>(name: string, description: string, args: S, action: (args: z.infer<z.ZodObject<S>>, ctx: ToolContext) => Promise<T>) {
  return { description, args, async execute(input: z.infer<z.ZodObject<S>>, ctx: ToolContext): Promise<string> {
    let result: { ok: true; data: T } | { ok: false; error: string };
    try { referenceDate(ctx); result = { ok: true, data: await action(z.object(args).strict().parse(input), ctx) }; }
    catch (error) { result = { ok: false, error: errorMessage(error) }; }
    try { await log(ctx, input?.caso, `proveedor_${name}`, result.ok); }
    catch { return JSON.stringify({ ok: false, error: "No se pudo escribir el registro de auditoría; la operación puede haber generado archivos parciales." }); }
    return JSON.stringify(result);
  } };
}
async function loadCase(ctx: ToolContext, caso: string) {
  casoSchema.parse(caso);
  const base = ["fixtures", "reto-01", "casos", caso];
  const solicitud = solicitudSchema.parse(await json(ctx, ...base, "solicitud.json"));
  const campos = z.array(campoSchema).parse(await json(ctx, ...base, solicitud.formato === "xlsx" ? "plantilla-celdas.json" : "plantilla-campos.json"));
  if (new Set(campos.map(c => c.etiqueta)).size !== campos.length) throw new Error("Plantilla con etiquetas duplicadas");
  if (solicitud.formato === "xlsx" && campos.some(c => !c.hoja || !c.celda_etiqueta || !c.celda_valor)) throw new Error("Plantilla Excel incompleta");
  const soportes = z.array(z.string()).parse(await json(ctx, ...base, "soportes-exigidos.json"));
  return { ...solicitud, campos, soportes };
}
function normalize(value: string): string { return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase(); }
function lookup(master: unknown, path: string): unknown {
  let value: unknown = master;
  for (const key of path.split(".")) {
    if (["__proto__", "constructor", "prototype"].includes(key) || typeof value !== "object" || value === null || !Object.hasOwn(value, key)) return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}
async function mapFields(ctx: ToolContext, caso: string, campos: Campo[]): Promise<Mapeo> {
  const source = await loadCase(ctx, caso);
  const master = await json(ctx, "fixtures", "reto-01", "repositorio", "maestro.json");
  const glossary = z.record(z.string()).parse(await json(ctx, "fixtures", "reto-01", "glosario-campos.json"));
  const aliases = new Map(Object.entries(glossary).map(([k, v]) => [normalize(k), v]));
  const requested = new Set(source.campos.map(c => c.etiqueta));
  const result: Mapeo = { llenos: [], faltantes: [], requiere_confirmacion: [] };
  for (const campo of campos) {
    if (!requested.has(campo.etiqueta)) throw new Error("Campo no solicitado en la plantilla");
    const path = aliases.get(normalize(campo.etiqueta));
    const parsed = valorSchema.safeParse(path ? lookup(master, path) : undefined);
    if (!path || !parsed.success || parsed.data === "") {
      result.faltantes.push({ etiqueta: campo.etiqueta, estado: "faltante", ruta_maestro: null, valor: null, confianza: 0, nota: "Sin dato en el maestro" });
      continue;
    }
    const tax = path === "nit";
    const foreign = tax && source.pais !== "CO";
    const ambiguous = tax && !["nit", "ruc", "rtn"].includes(normalize(campo.etiqueta));
    const confirm = foreign || ambiguous;
    const item: z.infer<typeof resultadoSchema> = { etiqueta: campo.etiqueta, estado: confirm ? "requiere_confirmacion" : "lleno", ruta_maestro: path, valor: parsed.data, confianza: 1, nota: foreign ? "identificador extranjero" : ambiguous ? "Confirmar identificador tributario" : "Coincidencia de glosario" };
    if (tax) item.identificador_pais = ({ CO: "NIT", EC: "RUC", PE: "RUC", PA: "RUC", HN: "RTN" } as Record<string, string>)[source.pais] ?? "Identificador tributario por confirmar";
    result[confirm ? "requiere_confirmacion" : "llenos"].push(item);
  }
  return result;
}
function values(mapeo: Mapeo) { return new Map([...mapeo.llenos, ...mapeo.faltantes, ...mapeo.requiere_confirmacion].map(c => [c.etiqueta, c])); }
async function report(ctx: ToolContext, caso: string, mapeo: Mapeo) {
  await save(ctx, caso, "mapeo.json", JSON.stringify(mapeo, null, 2) + "\n");
  await save(ctx, caso, "faltantes.md", "# Campos faltantes\n\n" + (mapeo.faltantes.map(c => `- ${c.etiqueta}`).join("\n") || "Ninguno.") + "\n");
}
async function generate(ctx: ToolContext, caso: string, mapeo: Mapeo) {
  const source = await loadCase(ctx, caso);
  const canonical = await mapFields(ctx, caso, source.campos);
  if (JSON.stringify(mapeo) !== JSON.stringify(canonical)) throw new Error("El mapeo no coincide con la plantilla y el maestro; vuelve a mapear los campos");
  await report(ctx, caso, canonical);
  const mapped = values(canonical);
  if (source.formato === "pdf") throw new Error("PDF P1 pendiente de implementación; se generaron mapeo.json y faltantes.md, no un formulario PDF");
  if (source.formato === "portal") {
    await save(ctx, caso, "valores-portal.md", "# Valores para copiar al portal\n\nFormato no soportado: carga manual por un humano.\n\n" + source.campos.map(c => { const m = mapped.get(c.etiqueta); return `- ${c.etiqueta}: ${m?.valor ?? "[faltante]"} (${m?.estado})`; }).join("\n") + "\n");
    throw new Error(`formato no soportado: portal; valores disponibles en ${publicPath(caso, "valores-portal.md")}`);
  }
  const workbook = new ExcelJS.Workbook();
  workbook.created = new Date("2000-01-01T00:00:00Z");
  workbook.modified = workbook.created;
  for (const c of source.campos) {
    if (!c.hoja || !c.celda_etiqueta || !c.celda_valor) throw new Error("Plantilla Excel incompleta");
    const sheet = workbook.getWorksheet(c.hoja) ?? workbook.addWorksheet(c.hoja);
    sheet.getCell(c.celda_etiqueta).value = c.etiqueta;
    sheet.getCell(c.celda_valor).value = mapped.get(c.etiqueta)?.valor ?? null;
  }
  await workbook.xlsx.writeFile(await safePath(ctx, "out", caso, "formulario.xlsx"));
  return { ruta: publicPath(caso, "formulario.xlsx"), formato: "xlsx" as const };
}

export const leer_solicitud = tool("leer_solicitud", "Lee correo, campos de plantilla y soportes exigidos de un caso.", { caso: casoSchema }, async ({ caso }, ctx) => loadCase(ctx, caso));
export const mapear_campos = tool("mapear_campos", "Mapea campos solicitados al maestro con trazabilidad y reglas tributarias.", { caso: casoSchema, campos: z.array(campoSchema).describe("Campos leídos de la plantilla del cliente") }, async ({ caso, campos }, ctx) => {
  const mapeo = await mapFields(ctx, caso, campos); await report(ctx, caso, mapeo); return mapeo;
});
export const generar_formulario = tool("generar_formulario", "Genera Excel exacto o informa PDF pendiente y prepara valores de portal sin automatizarlo.", { caso: casoSchema, mapeo: mapeoSchema.describe("Mapeo completo obtenido de mapear_campos") }, async ({ caso, mapeo }, ctx) => generate(ctx, caso, mapeo));
export const armar_paquete = tool("armar_paquete", "Prepara formulario y soportes con checklist de vigencias y borrador sin datos bancarios.", { caso: casoSchema }, async ({ caso }, ctx) => {
  const source = await loadCase(ctx, caso);
  const mapeo = await mapFields(ctx, caso, source.campos);
  await report(ctx, caso, mapeo);
  const date = referenceDate(ctx);
  const index = z.array(soporteSchema).parse(await json(ctx, "fixtures", "reto-01", "repositorio", "soportes", "index.json"));
  const packageDir = await safePath(ctx, "out", caso, "paquete");
  await mkdir(packageDir, { recursive: true });
  // Evitar que un soporte eliminado del repositorio persista en el paquete.
  const previousFiles = await readdir(packageDir);
  for (const file of previousFiles) {
    const path = await safePath(ctx, "out", caso, "paquete", file);
    if (!(await lstat(path)).isFile()) throw new Error("Contenido inesperado en la carpeta de paquete");
  }
  for (const file of previousFiles) await unlink(await safePath(ctx, "out", caso, "paquete", file));
  let formularioDisponible = false;
  if (source.formato === "xlsx") {
    const form = await generate(ctx, caso, mapeo);
    await copyFile(await safePath(ctx, form.ruta), await safePath(ctx, "out", caso, "paquete", "formulario.xlsx"));
    formularioDisponible = true;
  }
  const checklist: { tipo: string; estado: "presente" | "ausente" | "vencido"; vigencia_hasta: string | null }[] = [];
  for (const tipo of source.soportes) {
    const support = index.find(s => s.tipo === tipo);
    let estado: "presente" | "ausente" | "vencido" = "ausente";
    if (support) {
      if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(support.archivo)) throw new Error("Nombre de soporte inválido");
      const path = await safePath(ctx, "fixtures", "reto-01", "repositorio", "soportes", support.archivo);
      try {
        await copyFile(path, await safePath(ctx, "out", caso, "paquete", support.archivo));
        estado = support.vigencia_hasta !== null && support.vigencia_hasta < date ? "vencido" : "presente";
      } catch (error) { if (!isMissing(error)) throw error; }
    }
    checklist.push({ tipo, estado, vigencia_hasta: support?.vigencia_hasta ?? null });
  }
  const listo_para_firma = formularioDisponible && checklist.every(s => s.estado === "presente");
  const notes = [`# Checklist`, `Fecha de referencia: ${date}`, `Formulario: ${formularioDisponible ? "disponible" : "no disponible (formato pendiente/no soportado)"}`, `Listo para firma: ${listo_para_firma}`, ...checklist.map(s => `- ${s.tipo}: ${s.estado}; vigencia: ${s.vigencia_hasta ?? "sin vencimiento registrado"}`), "## Campos faltantes (no bloquean por sí solos)", ...mapeo.faltantes.map(c => `- ${c.etiqueta}`), "## Requiere confirmación", ...mapeo.requiere_confirmacion.map(c => `- ${c.etiqueta}: ${c.nota}`)];
  await writeFile(await safePath(ctx, "out", caso, "paquete", "checklist.md"), notes.join("\n\n") + "\n");
  await writeFile(await safePath(ctx, "out", caso, "paquete", "borrador-correo.md"), "# Borrador para revisión humana\n\nSe ha preparado la documentación disponible para revisión y firma. Revise el checklist y complete o actualice lo indicado antes de continuar.\n\nEste borrador no ha sido enviado.\n");
  return { ruta: publicPath(caso, "paquete/"), listo_para_firma, checklist, formulario_disponible: formularioDisponible };
});
