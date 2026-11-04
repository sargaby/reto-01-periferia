import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cp, lstat, mkdir, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import ExcelJS from "exceljs";
import { z } from "zod";
import { leer_solicitud, mapear_campos, generar_formulario, armar_paquete, type ToolContext } from "./src/tools/proveedor.js";

const directory = resolve(process.cwd());
const ctx: ToolContext = { directory, sessionId: "demo", referenceDate: process.env.REFERENCE_DATE ?? "2026-11-03" };
const responseSchema = z.discriminatedUnion("ok", [z.object({ ok: z.literal(true), data: z.unknown() }), z.object({ ok: z.literal(false), error: z.string() })]);
function parse(raw: string) { return responseSchema.parse(JSON.parse(raw) as unknown); }
function data<T extends z.ZodTypeAny>(raw: string, schema: T): z.infer<T> {
  const result = parse(raw); assert.equal(result.ok, true, result.ok ? undefined : result.error);

  return schema.parse(result.data) as z.infer<T>;
}
async function inventory(path: string): Promise<string[]> {
  assert.equal((await lstat(path)).isSymbolicLink(), false, `Enlace rechazado: ${path}`);
  const entries = await readdir(path, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const child = join(path, entry.name);
    assert.equal((await lstat(child)).isSymbolicLink(), false, `Enlace rechazado: ${child}`);
    if (entry.isDirectory()) files.push(...await inventory(child)); else files.push(child);
  }
  return files.sort();
}
async function hashes(path: string) {
  return Promise.all((await inventory(path)).map(async file => [relative(path, file), createHash("sha256").update(await readFile(file)).digest("hex")]));
}
async function cleanOutput() {
  const root = await realpath(directory);
  assert.equal(root.toLowerCase(), resolve(directory).replace(/[\\/]$/, "").toLowerCase(), "La raíz no debe ser un enlace");
  const out = resolve(root, "out");
  assert.equal(relative(root, out), "out");
  assert.ok(out.startsWith(root + sep));
  try { await inventory(out); } catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error; }
  await rm(out, { recursive: true, force: true });
  await mkdir(out);
}
const itemSchema = z.object({ etiqueta: z.string(), valor: z.union([z.string(), z.number(), z.boolean()]).nullable(), ruta_maestro: z.string().nullable(), estado: z.string(), nota: z.string() }).passthrough();
const mappingSchema = z.object({ llenos: z.array(itemSchema), faltantes: z.array(itemSchema), requiere_confirmacion: z.array(itemSchema) }).passthrough();
const packageSchema = z.object({ listo_para_firma: z.boolean(), formulario_disponible: z.boolean(), checklist: z.array(z.object({ tipo: z.string(), estado: z.enum(["presente", "ausente", "vencido"]), vigencia_hasta: z.string().nullable() })) });

async function run() {
  const fixtureRoot = join(directory, "fixtures");
  const before = await hashes(fixtureRoot);
  await cleanOutput();
  console.log(`Fecha de referencia: ${ctx.referenceDate}`);
  const cases = (await readdir(join(fixtureRoot, "reto-01", "casos"), { withFileTypes: true })).filter(e => e.isDirectory()).map(e => e.name).sort();
  let failures = 0;
  for (const caso of cases) {
    try {
      const loaded = data(await leer_solicitud.execute({ caso }, ctx), z.object({ pais: z.string(), formato: z.enum(["xlsx", "pdf", "portal"]), campos: z.unknown() }));
      const fields = z.array(z.object({ etiqueta: z.string(), hoja: z.string().optional(), celda_etiqueta: z.string().optional(), celda_valor: z.string().optional(), obligatorio: z.boolean().optional() })).parse(loaded.campos);
      const rawMapping = await mapear_campos.execute({ caso, campos: fields }, ctx);
      const mapped = data(rawMapping, mappingSchema);
      // Validate the complete tool contract before passing data to generation.
      const mapping = z.object(generar_formulario.args).shape.mapeo.parse(mapped);
      assert.equal(mapped.llenos.length + mapped.faltantes.length + mapped.requiere_confirmacion.length, fields.length);
      for (const field of [...mapped.llenos, ...mapped.requiere_confirmacion]) assert.ok(field.ruta_maestro);
      if (loaded.pais !== "CO") assert.ok(mapped.requiere_confirmacion.some(f => f.ruta_maestro === "nit" && f.nota === "identificador extranjero"));
      const generated = parse(await generar_formulario.execute({ caso, mapeo: mapping }, ctx));
      if (loaded.formato === "xlsx") {
        assert.equal(generated.ok, true);
        const book = new ExcelJS.Workbook();
        await book.xlsx.readFile(join(directory, "out", caso, "formulario.xlsx"));
        const all = new Map([...mapped.llenos, ...mapped.faltantes, ...mapped.requiere_confirmacion].map(f => [f.etiqueta, f]));
        for (const f of fields) {
          assert.ok(f.hoja && f.celda_etiqueta && f.celda_valor);
          const sheet = book.getWorksheet(f.hoja); assert.ok(sheet);
          assert.equal(sheet.getCell(f.celda_etiqueta).value, f.etiqueta);
          assert.equal(sheet.getCell(f.celda_valor).value, all.get(f.etiqueta)?.valor ?? null);
        }
      } else {
        assert.equal(generated.ok, false);
        if (loaded.formato === "portal") assert.match(await readFile(join(directory, "out", caso, "valores-portal.md"), "utf8"), /Formato no soportado/);
      }
      const pack = data(await armar_paquete.execute({ caso }, ctx), packageSchema);
      assert.equal(pack.listo_para_firma, pack.formulario_disponible && pack.checklist.every(s => s.estado === "presente"));
      for (const support of pack.checklist) {
        if (support.estado !== "ausente") assert.equal(support.estado, support.vigencia_hasta && support.vigencia_hasta < ctx.referenceDate! ? "vencido" : "presente");
      }
      const packageFiles = await readdir(join(directory, "out", caso, "paquete"));
      assert.ok(packageFiles.includes("checklist.md") && packageFiles.includes("borrador-correo.md"));
      if (loaded.formato === "xlsx") assert.deepEqual(await readFile(join(directory, "out", caso, "paquete", "formulario.xlsx")), await readFile(join(directory, "out", caso, "formulario.xlsx")));
      const master = JSON.parse(await readFile(join(fixtureRoot, "reto-01", "repositorio", "maestro.json"), "utf8")) as { banco: Record<string, string> };
      const email = await readFile(join(directory, "out", caso, "paquete", "borrador-correo.md"), "utf8");
      for (const key of ["nombre", "numero_cuenta", "swift", "tipo_cuenta"]) { const value = master.banco[key]; assert.ok(value); assert.equal(email.includes(value), false); }
      console.log(`${caso}: llenos=${mapped.llenos.length}; faltantes=${mapped.faltantes.length}; confirmar=${mapped.requiere_confirmacion.length}; formulario=${generated.ok}; listo_para_firma=${pack.listo_para_firma}; soportes=${pack.checklist.map(s => `${s.tipo}:${s.estado}`).join(",")}`);
    } catch (error) { failures++; console.error(`${caso}: FALLÓ`, error instanceof Error ? error.message : "Error"); }
  }
  assert.equal(parse(await leer_solicitud.execute({ caso: "caso-inexistente" }, ctx)).ok, false);
  assert.equal(parse(await leer_solicitud.execute({ caso: "../repositorio" }, ctx)).ok, false);
  const caso = "hn-agroexport-sula";
  const early = data(await armar_paquete.execute({ caso }, { ...ctx, referenceDate: "2026-08-31" }), packageSchema);
  assert.equal(early.listo_para_firma, true, "Campo faltante no bloquea; soporte vigente el día de vencimiento");
  const expired = data(await armar_paquete.execute({ caso }, { ...ctx, referenceDate: "2026-09-01" }), packageSchema);
  assert.equal(expired.listo_para_firma, false);
  assert.ok(expired.checklist.some(s => s.tipo === "parafiscales" && s.estado === "vencido"));
  await armar_paquete.execute({ caso }, ctx); // Restaurar resultados a la fecha de la demo.
  const badBank = await mapear_campos.execute({ caso, campos: [{ etiqueta: "Número de cuenta" }] }, ctx);
  assert.equal(parse(badBank).ok, false, "No se divulgan campos bancarios no solicitados");
  const missing = data(await mapear_campos.execute({ caso, campos: [{ etiqueta: "Referencias comerciales" }] }, ctx), mappingSchema);
  assert.equal(missing.faltantes.length, 1);
  await armar_paquete.execute({ caso }, ctx); // Restaurar reporte completo.
  // Alterar solo copias de fixtures para verificar fallos de entrada.
  const sandbox = join(directory, "out", "pruebas");
  await mkdir(sandbox);
  await cp(fixtureRoot, join(sandbox, "fixtures"), { recursive: true });
  const isolated = { ...ctx, directory: sandbox };
  const corrupt = join(sandbox, "fixtures", "reto-01", "casos", caso, "plantilla-celdas.json");
  await writeFile(corrupt, "{corrupto");
  assert.equal(parse(await leer_solicitud.execute({ caso }, isolated)).ok, false);
  await cp(join(fixtureRoot, "reto-01", "casos", caso, "plantilla-celdas.json"), corrupt);
  const original = data(await leer_solicitud.execute({ caso }, ctx), z.object({ campos: z.array(z.object({ etiqueta: z.string() }).passthrough()) }));
  const canonical = data(await mapear_campos.execute({ caso, campos: original.campos }, ctx), z.object(generar_formulario.args).shape.mapeo);
  const altered = structuredClone(canonical);
  assert.ok(altered.llenos[0]);
  altered.llenos[0].valor = "valor alterado sin fuente";
  assert.equal(parse(await generar_formulario.execute({ caso, mapeo: altered }, ctx)).ok, false);
  await rm(join(sandbox, "fixtures", "reto-01", "repositorio", "soportes", "rut-2026.txt"));
  const absent = data(await armar_paquete.execute({ caso }, { ...isolated, referenceDate: "2026-08-31" }), packageSchema);
  assert.equal(absent.listo_para_firma, false);
  assert.ok(absent.checklist.some(s => s.tipo === "rut" && s.estado === "ausente"));
  assert.equal(parse(await leer_solicitud.execute({ caso }, { ...ctx, referenceDate: "2026-02-30" })).ok, false);
  const logs = (await readFile(join(directory, "out", "log.jsonl"), "utf8")).trim().split("\n").map(line => JSON.parse(line) as unknown);
  for (const line of logs) z.object({ ts: z.string(), herramienta: z.string(), ok: z.boolean(), resumen: z.string() }).parse(line);
  for (const name of cases) assert.ok((await readFile(join(directory, "out", name, "log.jsonl"), "utf8")).length > 0);
  assert.deepEqual(await hashes(fixtureRoot), before, "Fixtures inmutables");
  assert.equal(failures, 0, "Todos los casos deben pasar");
  console.log("OK: Excel, paquetes, logs, fixtures inmutables, caso inexistente, traversal, datos bancarios, faltantes, vencimiento, JSON corrupto, mapeo alterado, soporte ausente y fecha inválida.");
}
run().catch(error => { console.error(error instanceof Error ? error.message : "Falló la demo"); process.exitCode = 1; });
