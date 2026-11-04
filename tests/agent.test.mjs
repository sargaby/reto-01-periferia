import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { once } from 'node:events';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, relative, resolve } from 'node:path';
import { Agent } from '../dist/src/agent.js';
import { createApp } from '../dist/src/app.js';
import { OpenAIAdapter } from '../dist/src/llm/openai.js';
import { definitions } from '../dist/src/tools/registry.js';

let directory;
before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'reto01-agent-'));
  for (const folder of ['fixtures', 'agent', 'src/knowledge', 'web']) await cp(resolve(folder), join(directory, folder), { recursive: true });
});
after(async () => {
  assert.ok(basename(directory).startsWith('reto01-agent-'));
  assert.equal(relative(resolve(tmpdir()), directory), basename(directory));
  await rm(directory, { recursive: true, force: true });
});
const config = overrides => ({ directory, maxIterations: 12, maxSessionTokens: 1000000, maxTotalTokens: 5000000, maxOutputTokens: 4096, maxSessions: 20, ...overrides });
const final = (reply = 'Revisión terminada.', needsConfirmation = false) => ({ content: JSON.stringify({ reply, needsConfirmation }), toolCalls: [], totalTokens: 50 });
const call = (name, args, id = 'call-1') => ({ content: null, toolCalls: [{ id, name, arguments: typeof args === 'string' ? args : JSON.stringify(args) }], totalTokens: 50 });
function script(steps) {
  let count = 0;
  return { get count() { return count; }, async enviar(messages, tools, options) {
    assert.ok(tools.some(t => t.name === 'proveedor_leer_solicitud'));
    assert.ok(options.maxOutputTokens > 0);
    const step = steps[count++];
    assert.ok(step, 'El agente llamó al modelo más veces de lo esperado');
    return typeof step === 'function' ? step(messages) : step;
  } };
}
const lastResult = messages => JSON.parse(messages.filter(m => m.role === 'tool').at(-1).content);

test('ciclo completo usa las cuatro P0 reales, historial y auditoría', async () => {
  const caso = 'co-industrias-delta';
  const adapter = script([
    call('proveedor_leer_solicitud', { caso }),
    messages => call('proveedor_mapear_campos', { caso, campos: lastResult(messages).data.campos }, 'call-2'),
    messages => call('proveedor_generar_formulario', { caso, mapeo: lastResult(messages).data }, 'call-3'),
    messages => { assert.equal(lastResult(messages).data.formato, 'xlsx'); return call('proveedor_armar_paquete', { caso }, 'call-4'); },
    final(),
  ]);
  const agent = await Agent.create(config({ maxSessionTokens: 100000 }), adapter);
  const response = await agent.chat(`Procesa ${caso}`);
  assert.equal(response.status, 200);
  assert.equal(response.body.toolCalls.length, 4);
  assert.equal(response.body.needsConfirmation, true);
  assert.match(response.body.reply, /¿Confirmas/);
  assert.equal(agent.getSession(response.body.sessionId).history.length, 6);
  for (const file of ['out/log.jsonl', `out/${caso}/log.jsonl`]) {
    const log = (await readFile(join(directory, file), 'utf8')).trim().split('\n').map(JSON.parse);
    assert.equal(log.length, 4);
  }
});

test('confirmación depende del turno inmediato y no habilita acciones externas', async () => {
  const adapter = script([final('Revisa el paquete.', true), messages => {
    assert.match(messages[1].content, /actual: true/); return final('Revisión reconocida.');
  }, messages => { assert.match(messages[1].content, /actual: false/); return final(); }]);
  const agent = await Agent.create(config(), adapter);
  const first = await agent.chat('Revisar');
  await agent.chat('Sí, confirmo', first.body.sessionId);
  await agent.chat('sí', first.body.sessionId);
  assert.equal(definitions.some(t => /envio|firma|portal/.test(t.name)), false);
  const interrupted = script([final('Revisa.', true), final(), messages => { assert.match(messages[1].content, /actual: false/); return final(); }]);
  const other = await Agent.create(config(), interrupted);
  const pending = await other.chat('Revisar');
  await other.chat('Otra consulta', pending.body.sessionId);
  await other.chat('sí', pending.body.sessionId);
});

test('argumentos inválidos, JSON corrupto y herramientas no disponibles se devuelven al modelo', async () => {
  const adapter = script([
    call('proveedor_leer_solicitud', { caso: '../escape' }),
    messages => { assert.equal(lastResult(messages).ok, false); return call('proveedor_leer_solicitud', '{incorrecto', 'bad-json'); },
    messages => { assert.equal(lastResult(messages).ok, false); return call('proveedor_simular_envio', { caso: 'co-industrias-delta', confirmado: true }, 'forbidden'); },
    messages => { assert.match(lastResult(messages).error, /no disponible/); return final(); },
  ]);
  const agent = await Agent.create(config(), adapter);
  const response = await agent.chat('Prueba de validación');
  assert.equal(response.status, 200);
  assert.equal(response.body.toolCalls.length, 3);
});

test('límite de iteraciones, presupuestos por sesión y global, y recuperación tras error', async () => {
  const limited = await Agent.create(config({ maxIterations: 1 }), script([call('proveedor_leer_solicitud', { caso: 'caso-inexistente' })]));
  assert.match((await limited.chat('Procesa')).body.reply, /límite de iteraciones/);
  const budgetAdapter = script([]);
  const budget = await Agent.create(config({ maxSessionTokens: 1 }), budgetAdapter);
  assert.match((await budget.chat('Hola')).body.reply, /presupuesto/);
  assert.equal(budgetAdapter.count, 0);
  const global = await Agent.create(config({ maxTotalTokens: 1 }), script([]));
  assert.match((await global.chat('Hola')).body.reply, /presupuesto/);
  const recovery = await Agent.create(config(), script([() => { throw new Error('Timeout controlado de prueba'); }, final()]));
  const failed = await recovery.chat('Hola');
  assert.equal(failed.status, 502);
  assert.equal((await recovery.chat('Reintentar', failed.body.sessionId)).status, 200);
});

test('rechaza solicitudes concurrentes y limita sesiones nuevas', async () => {
  let release;
  const adapter = { enviar: () => new Promise(resolve => { release = resolve; }) };
  const agent = await Agent.create(config({ maxSessions: 1 }), adapter);
  const pending = agent.chat('Hola');
  assert.equal((await agent.chat('Segundo mensaje')).status, 409);
  release(final());
  const first = await pending;
  assert.equal(first.status, 200);
  assert.equal((await agent.chat('Nueva sesión')).status, 429);
});

test('HTTP: health, frontend, validación, sesiones, falta de clave y errores JSON', async () => {
  const agent = await Agent.create(config());
  const server = createApp(agent, { directory, configured: false, model: null }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const health = await (await fetch(`${base}/api/health`)).json();
    assert.deepEqual(health, { ok: true, provider: 'openai', model: null, configured: false });
    assert.match(await (await fetch(base)).text(), /chat-form/);
    const post = body => fetch(`${base}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    assert.equal((await post('{')).status, 400);
    assert.equal((await post(JSON.stringify({ message: '' }))).status, 400);
    const missing = await post(JSON.stringify({ message: 'Procesa un caso' }));
    assert.equal(missing.status, 503);
    const session = await missing.json();
    assert.equal((await fetch(`${base}/api/sessions/${session.sessionId}`)).status, 200);
    assert.equal((await fetch(`${base}/api/sessions/invalid`)).status, 400);
    assert.equal((await fetch(`${base}/api/sessions/00000000-0000-4000-8000-000000000000`)).status, 404);
    assert.equal((await post(JSON.stringify({ sessionId: session.sessionId, message: 'Reintentar' }))).status, 503);
    assert.equal((await fetch(`${base}/.env`)).status, 404);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('adaptador OpenAI: contrato HTTP real, sin exponer errores del proveedor', async () => {
  const config = { apiKey: 'clave-solo-prueba', model: 'modelo-solo-prueba', timeoutMs: 1000 };
  const stub = async (url, init) => {
    assert.equal(url, 'https://api.openai.com/v1/chat/completions');
    assert.equal(init.headers.Authorization, 'Bearer clave-solo-prueba');
    const body = JSON.parse(init.body);
    assert.equal(body.max_completion_tokens, 123);
    assert.equal(body.tools[0].type, 'function');
    assert.equal(body.messages[0].tool_calls[0].function.arguments, '{"caso":"x"}');
    assert.equal(body.messages[1].tool_call_id, 'call-1');
    return Response.json({ choices: [{ finish_reason: 'tool_calls', message: { content: null, tool_calls: [{ id: 'c2', type: 'function', function: { name: 'proveedor_leer_solicitud', arguments: '{invalid' } }] } }], usage: { total_tokens: 10 } });
  };
  const adapter = new OpenAIAdapter(config, stub);
  const result = await adapter.enviar([{ role: 'assistant', content: '', toolCalls: [{ id: 'call-1', name: 'proveedor_leer_solicitud', arguments: '{"caso":"x"}' }] }, { role: 'tool', toolCallId: 'call-1', content: '{"ok":true}' }], definitions, { maxOutputTokens: 123 });
  assert.equal(result.toolCalls[0].arguments, '{invalid');
  for (const status of [401, 429, 500]) {
    const broken = new OpenAIAdapter(config, async () => new Response('clave-solo-prueba', { status }));
    await assert.rejects(broken.enviar([], definitions, { maxOutputTokens: 100 }), error => !error.message.includes('clave-solo-prueba'));
  }
  const timeout = new OpenAIAdapter(config, async () => { throw new DOMException('secret', 'TimeoutError'); });
  await assert.rejects(timeout.enviar([], definitions, { maxOutputTokens: 100 }), /tiempo de espera/);
});
