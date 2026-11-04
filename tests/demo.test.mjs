import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { once } from 'node:events';
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, relative, resolve } from 'node:path';
import ExcelJS from 'exceljs';
import { Agent } from '../dist/src/agent.js';
import { createApp } from '../dist/src/app.js';
import { selectProvider } from '../dist/src/llm/provider.js';

let directory, server, base, nativeFetch;
const referenceDate = '2026-11-03';
const readJson = async path => JSON.parse(await readFile(path, 'utf8'));
before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'reto01-demo-'));
  for (const folder of ['fixtures', 'agent', 'src/knowledge', 'web']) await cp(resolve(folder), join(directory, folder), { recursive: true });
  const selected = selectProvider({ LLM_PROVIDER: 'demo' }, 1000);
  assert.equal(selected.configured, true); assert.equal(selected.model, null);
  const agent = await Agent.create({ directory, maxIterations: 25, maxSessionTokens: 100000, maxTotalTokens: 2000000, maxOutputTokens: 4096, maxSessions: 30, referenceDate }, selected.adapter);
  server = createApp(agent, { directory, ...selected, secrets: ['SECRETO_DE_PRUEBA'] }).listen(0, '127.0.0.1');
  await once(server, 'listening'); base = `http://127.0.0.1:${server.address().port}`;
  nativeFetch = globalThis.fetch;
  globalThis.fetch = (url, init) => {
    assert.ok(String(url).startsWith(base + '/'), 'El modo demo no debe llamar a servicios externos');
    return nativeFetch(url, init);
  };
});
after(async () => {
  globalThis.fetch = nativeFetch;
  if (server) await new Promise(resolve => server.close(resolve));
  assert.ok(basename(directory).startsWith('reto01-demo-'));
  assert.equal(relative(resolve(tmpdir()), directory), basename(directory));
  await rm(directory, { recursive: true, force: true });
});
async function chat(message, sessionId) {
  const response = await fetch(`${base}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message, ...(sessionId ? { sessionId } : {}) }) });
  return { status: response.status, body: await response.json() };
}
const results = new Map();
const counts = { 'co-industrias-delta': [17, 0, 0], 'ec-corp-andina': [13, 1, 1], 'hn-agroexport-sula': [9, 1, 1], 'pa-logistica-istmo': [8, 0, 1] };

test('health y recursos de frontend identifican demostración sin clave ni modelo', async () => {
  assert.deepEqual(await (await fetch(`${base}/api/health`)).json(), { ok: true, provider: 'demo', model: null, configured: true, demonstration: true });
  for (const path of ['/', '/app.js', '/styles.css']) assert.equal((await fetch(`${base}${path}`)).status, 200);
  assert.match(await (await fetch(`${base}/app.js`)).text(), /MODO DEMOSTRACIÓN/);
  assert.equal((await fetch(`${base}/.env`)).status, 404);
});

test('los cuatro casos producen resultados reales, trazabilidad, Excel y checklist', async () => {
  const master = await readJson(join(directory, 'fixtures/reto-01/repositorio/maestro.json'));
  const index = await readJson(join(directory, 'fixtures/reto-01/repositorio/soportes/index.json'));
  for (const [caso, expected] of Object.entries(counts)) {
    const { status, body } = await chat(`Procesa el caso "${caso}". No envíes nada todavía.`);
    assert.equal(status, 200); assert.match(body.reply, /Sin LLM ni API externa/);
    assert.equal(body.needsConfirmation, true);
    assert.equal(body.tokens.actual, 0);
    assert.deepEqual(body.toolCalls.map(c => c.name), ['proveedor_leer_solicitud', 'proveedor_mapear_campos', 'proveedor_generar_formulario', 'proveedor_armar_paquete']);
    const [loaded, mapping, form, pack] = body.toolCalls.map(c => JSON.parse(c.result));
    assert.equal(loaded.ok, true); assert.equal(mapping.ok, true); assert.equal(pack.ok, true);
    const mapped = mapping.data;
    assert.deepEqual([mapped.llenos.length, mapped.faltantes.length, mapped.requiere_confirmacion.length], expected);
    for (const field of [...mapped.llenos, ...mapped.requiere_confirmacion]) {
      const actualSource = field.ruta_maestro.split('.').reduce((value, key) => value[key], master);
      assert.equal(field.valor, actualSource, `${caso}: ${field.etiqueta} debe proceder del maestro`);
    }
    assert.deepEqual(await readJson(join(directory, 'out', caso, 'mapeo.json')), mapped);
    const sheetFields = loaded.data.campos;
    if (loaded.data.formato === 'xlsx') {
      assert.equal(form.ok, true);
      const workbook = new ExcelJS.Workbook(); await workbook.xlsx.readFile(join(directory, form.data.ruta));
      assert.deepEqual(workbook.worksheets.map(s => s.name).sort(), [...new Set(sheetFields.map(c => c.hoja))].sort());
      for (const cell of sheetFields) {
        const field = [...mapped.llenos, ...mapped.faltantes, ...mapped.requiere_confirmacion].find(f => f.etiqueta === cell.etiqueta);
        assert.equal(workbook.getWorksheet(cell.hoja).getCell(cell.celda_etiqueta).value, cell.etiqueta);
        assert.equal(workbook.getWorksheet(cell.hoja).getCell(cell.celda_valor).value, field.valor);
      }
    } else {
      assert.equal(form.ok, false);
      assert.match(body.reply, loaded.data.formato === 'pdf' ? /PDF P1 pendiente/ : /formato no soportado/);
      assert.equal((await readdir(join(directory, 'out', caso))).includes('formulario.pdf'), false);
    }
    assert.equal(pack.data.listo_para_firma, false);
    const checklist = await readFile(join(directory, 'out', caso, 'paquete', 'checklist.md'), 'utf8');
    assert.match(checklist, /2026-11-03/);
    for (const support of pack.data.checklist) {
      const source = index.find(i => i.tipo === support.tipo);
      assert.equal(support.estado, !source ? 'ausente' : source.vigencia_hasta && source.vigencia_hasta < referenceDate ? 'vencido' : 'presente');
      assert.ok(checklist.includes(`${support.tipo}: ${support.estado}`));
      if (source) assert.deepEqual(await readFile(join(directory, 'out', caso, 'paquete', source.archivo)), await readFile(join(directory, 'fixtures/reto-01/repositorio/soportes', source.archivo)));
    }
    for (const f of mapped.faltantes) assert.ok(checklist.includes(f.etiqueta));
    const email = await readFile(join(directory, 'out', caso, 'paquete', 'borrador-correo.md'), 'utf8');
    for (const key of ['nombre', 'numero_cuenta', 'swift', 'tipo_cuenta']) assert.equal(email.includes(master.banco[key]), false);
    assert.equal(body.reply.includes(master.banco.numero_cuenta), false);
    results.set(caso, body);
  }
});

test('sesiones, confirmación y envío bloqueado no repiten herramientas ni fabrican acciones', async () => {
  const first = results.get('co-industrias-delta'); assert.ok(first);
  const confirmed = await chat('Sí, confirmo', first.sessionId);
  assert.match(confirmed.body.reply, /Revisión reconocida/);
  assert.equal(confirmed.body.toolCalls.length, 4); assert.equal(confirmed.body.needsConfirmation, false);
  const again = await chat('sí', first.sessionId);
  assert.match(again.body.reply, /No había una confirmación pendiente/);
  const denied = await chat('envía', first.sessionId);
  assert.match(denied.body.reply, /no están implementados/);
  assert.equal((await readdir(join(directory, 'out/co-industrias-delta'))).includes('ENVIO-SIMULADO.md'), false);
  const session = await (await fetch(`${base}/api/sessions/${first.sessionId}`)).json();
  assert.equal(session.history.filter(e => e.role === 'tool').length, 4);
  assert.equal((await chat('hola', '00000000-0000-4000-8000-000000000000')).status, 404);
});

test('errores y traversal quedan auditados y la misma sesión se recupera', async () => {
  const failed = await chat('Procesa el caso "caso-inexistente"');
  assert.equal(failed.status, 200);
  assert.equal(failed.body.toolCalls.length, 1);
  assert.match(failed.body.reply, /inexistente/);
  const badPath = await chat('Procesa el caso "../repositorio"', failed.body.sessionId);
  assert.match(badPath.body.reply, /Argumentos inválidos/);
  const recovered = await chat('Procesa el caso "hn-agroexport-sula"', failed.body.sessionId);
  assert.equal(recovered.body.toolCalls.length, 6);
  assert.match(recovered.body.reply, /Referencias comerciales/);
  const logs = (await readFile(join(directory, 'out/log.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
  assert.ok(logs.some(e => !e.ok));
  for (const e of logs) assert.ok(e.ts && e.herramienta && e.resumen && e.sessionId);
  const secret = await chat('hola SECRETO_DE_PRUEBA');
  assert.equal(JSON.stringify(secret.body).includes('SECRETO_DE_PRUEBA'), false);
});

test('soporte eliminado y plantilla corrupta se prueban solo en copias aisladas', async () => {
  const rut = join(directory, 'fixtures/reto-01/repositorio/soportes/rut-2026.txt');
  await rm(rut);
  const absent = await chat('Procesa el caso "co-industrias-delta"');
  assert.match(absent.body.reply, /rut: ausente/);
  assert.equal((await readdir(join(directory, 'out/co-industrias-delta/paquete'))).includes('rut-2026.txt'), false, 'no conservar un soporte obsoleto de otra ejecución');
  const template = join(directory, 'fixtures/reto-01/casos/co-industrias-delta/plantilla-celdas.json');
  await writeFile(template, '{corrupto');
  const corrupt = await chat('Procesa el caso "co-industrias-delta"');
  assert.match(corrupt.body.reply, /JSON corrupto/);
  assert.equal(corrupt.body.toolCalls.length, 1);
});
