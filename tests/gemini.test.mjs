import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, relative, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { GoogleGenAI } from '@google/genai';
import { Agent } from '../dist/src/agent.js';
import { createApp } from '../dist/src/app.js';
import { GeminiAdapter } from '../dist/src/llm/gemini.js';
import { OpenAIAdapter } from '../dist/src/llm/openai.js';
import { selectProvider } from '../dist/src/llm/provider.js';
import { definitions } from '../dist/src/tools/registry.js';

let directory;
before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'reto01-gemini-'));
  for (const folder of ['fixtures', 'agent', 'src/knowledge', 'web']) await cp(resolve(folder), join(directory, folder), { recursive: true });
});
after(async () => {
  assert.ok(basename(directory).startsWith('reto01-gemini-'));
  assert.equal(relative(resolve(tmpdir()), directory), basename(directory));
  await rm(directory, { recursive: true, force: true });
});
const answer = parts => ({ candidates: [{ content: { role: 'model', parts }, finishReason: 'STOP' }], usageMetadata: { totalTokenCount: 12 } });
const fn = (name, args, id) => answer([{ thought: true, text: 'Razonamiento interno controlado' }, { functionCall: { name, args, ...(id ? { id } : {}) }, thoughtSignature: 'c2lnbmF0dXJl' }]);
const model = 'gemini-unit-test';
const cfg = { apiKey: 'clave-controlada', model, timeoutMs: 3000 };

test('selección: solo exige la clave del proveedor activo y conserva OpenAI', () => {
  assert.equal(selectProvider({}, 1000).provider, 'openai');
  const google = selectProvider({ LLM_PROVIDER: 'gemini', GEMINI_API_KEY: 'google-test', GEMINI_MODEL: model }, 1000);
  assert.equal(google.configured, true);
  assert.ok(google.adapter instanceof GeminiAdapter);
  assert.equal(selectProvider({ LLM_PROVIDER: 'gemini', OPENAI_API_KEY: 'openai-test', OPENAI_MODEL: 'modelo-prueba' }, 1000).configured, false);
  const openai = selectProvider({ LLM_PROVIDER: 'openai', OPENAI_API_KEY: 'openai-test', OPENAI_MODEL: 'modelo-prueba' }, 1000);
  assert.ok(openai.adapter instanceof OpenAIAdapter);
  assert.throws(() => selectProvider({ LLM_PROVIDER: 'desconocido' }, 1000));
});

test('SDK oficial + HTTP chat + Gemini controlado ejecutan las cuatro P0 reales', async () => {
  let metadata = 0; let probes = 0; let normal = 0; let failed;
  const caso = 'co-industrias-delta';
  const service = createServer(async (req, res) => {
    try {
      assert.equal(req.headers['x-goog-api-key'], cfg.apiKey);
      if (req.method === 'GET') {
        metadata++;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ name: `models/${model}`, supportedGenerationMethods: ['generateContent'] }));
        return;
      }
      let text = ''; for await (const chunk of req) text += chunk;
      const body = JSON.parse(text);
      let output;
      if (body.toolConfig.functionCallingConfig.mode === 'ANY') {
        probes++; output = fn('verificar_capacidad', {}, 'probe');
      } else {
        normal++;
        assert.ok(body.systemInstruction);
        assert.equal(body.tools[0].functionDeclarations[0].name, definitions[0].name);
        assert.deepEqual(body.tools[0].functionDeclarations[0].parametersJsonSchema, definitions[0].parameters);
        if (normal === 1) output = fn('proveedor_leer_solicitud', { caso }, 'g1');
        else {
          const previous = body.contents.at(-2);
          assert.equal(previous.role, 'model');
          assert.equal(previous.parts[1].thoughtSignature, 'c2lnbmF0dXJl');
          const result = body.contents.at(-1).parts[0].functionResponse;
          assert.equal(result.id, `g${normal - 1}`);
          assert.equal(result.response.ok, true);
          if (normal === 2) output = fn('proveedor_mapear_campos', { caso, campos: result.response.data.campos }, 'g2');
          else if (normal === 3) output = fn('proveedor_generar_formulario', { caso, mapeo: result.response.data }, 'g3');
          else if (normal === 4) output = fn('proveedor_armar_paquete', { caso }, 'g4');
          else output = answer([{ text: JSON.stringify({ reply: 'Revisa los resultados de las herramientas.', needsConfirmation: false }) }]);
        }
      }
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(output));
    } catch (error) { failed = error; res.statusCode = 500; res.end('{}'); }
  }).listen(0, '127.0.0.1');
  await once(service, 'listening');
  const sdk = new GoogleGenAI({ apiKey: cfg.apiKey, vertexai: false, httpOptions: { baseUrl: `http://127.0.0.1:${service.address().port}`, retryOptions: { attempts: 1 } } });
  const adapter = new GeminiAdapter(cfg, sdk);
  const agent = await Agent.create({ directory, maxIterations: 10, maxSessionTokens: 200000, maxTotalTokens: 500000, maxOutputTokens: 4096, maxSessions: 5 }, adapter);
  const server = createApp(agent, { directory, provider: 'gemini', model, configured: true, secrets: [cfg.apiKey] }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const res = await fetch(`${base}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: `Procesa ${caso}` }) });
    const body = await res.json();
    if (failed) throw failed;
    assert.equal(res.status, 200, body.reply);
    assert.equal(body.toolCalls.length, 4);
    assert.equal(body.needsConfirmation, true);
    assert.equal(metadata, 1); assert.equal(probes, 1); assert.equal(normal, 5, JSON.stringify(body.tokens));
    assert.equal(body.tokens.actual, 72); // 5 respuestas de negocio + 1 sonda.
    assert.equal(JSON.stringify(body).includes('c2lnbmF0dXJl'), false);
    assert.equal(JSON.stringify(body).includes('Razonamiento interno'), false);
    assert.equal(JSON.stringify(body).includes(cfg.apiKey), false);
    assert.deepEqual(await (await fetch(`${base}/api/health`)).json(), { ok: true, provider: 'gemini', model, configured: true });
    for (const path of ['out/log.jsonl', `out/${caso}/log.jsonl`]) assert.equal((await readFile(join(directory, path), 'utf8')).trim().split('\n').length, 4);
    assert.ok((await readFile(join(directory, 'out', caso, 'formulario.xlsx'))).length > 1000);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await new Promise(resolve => service.close(resolve));
  }
});

test('sin IDs Gemini: correlaciona por nombre, conserva firmas y agrupa respuestas paralelas', async () => {
  let stage = 0;
  const client = { models: {
    get: async () => ({ name: `models/${model}`, supportedActions: ['generateContent'] }),
    generateContent: async params => {
      stage++;
      if (stage === 1) return fn('verificar_capacidad', {});
      if (stage === 2) return answer([{ functionCall: { name: 'primera', args: {} }, thoughtSignature: 'first' }, { functionCall: { name: 'segunda', args: {} } }]);
      const last = params.contents.at(-1);
      assert.equal(last.parts.length, 2);
      assert.equal(last.parts[0].functionResponse.name, 'primera');
      assert.equal(last.parts[0].functionResponse.id, undefined);
      assert.equal(last.parts[1].functionResponse.name, 'segunda');
      assert.equal(params.contents.at(-2).parts[0].thoughtSignature, 'first');
      return answer([{ text: '{"reply":"Listo","needsConfirmation":false}' }]);
    },
  } };
  const adapter = new GeminiAdapter(cfg, client);
  const initial = [{ role: 'system', content: 'Solo JSON' }, { role: 'user', content: 'Prueba' }];
  const response = await adapter.enviar(initial, definitions, { maxOutputTokens: 1000 });
  assert.equal(new Set(response.toolCalls.map(c => c.id)).size, 2);
  const result = await adapter.enviar([...initial, { role: 'assistant', content: '', toolCalls: response.toolCalls, continuation: response.continuation }, ...response.toolCalls.map(c => ({ role: 'tool', content: '{"ok":true}', toolCallId: c.id }))], definitions, { maxOutputTokens: 1000 });
  assert.match(result.content, /Listo/);
});

test('verificación rechaza modelos/capacidades inválidos y sanitiza errores SDK', async () => {
  const unsupported = new GeminiAdapter(cfg, { models: { get: async () => ({ name: 'models/x', supportedActions: ['embedContent'] }), generateContent: async () => { throw new Error('No debe llamar'); } } });
  await assert.rejects(unsupported.verifyModel(), /no admite generateContent/);
  const noCalls = new GeminiAdapter(cfg, { models: { get: async () => ({ name: 'models/x', supportedActions: ['generateContent'] }), generateContent: async () => answer([{ text: 'Sin llamada' }]) } });
  await assert.rejects(noCalls.verifyModel(), /No se pudo verificar function calling/);
  for (const status of [400, 401, 403, 404, 429, 500]) {
    const adapter = new GeminiAdapter(cfg, { models: { get: async () => { throw Object.assign(new Error(cfg.apiKey), { status }); }, generateContent: async () => { throw new Error('Inalcanzable'); } } });
    await assert.rejects(adapter.verifyModel(), error => !error.message.includes(cfg.apiKey));
  }
  const timeout = new GeminiAdapter(cfg, { models: { get: async () => { throw new DOMException('privado', 'TimeoutError'); }, generateContent: async () => { throw new Error('Inalcanzable'); } } });
  await assert.rejects(timeout.verifyModel(), /tiempo de espera/);
});

test('reinicia el servidor con ambos LLM_PROVIDER; no requiere claves del otro', async () => {
  for (const provider of ['openai', 'gemini']) {
    const reserve = createServer().listen(0, '127.0.0.1'); await once(reserve, 'listening');
    const port = reserve.address().port; await new Promise(resolve => reserve.close(resolve));
    const child = spawn(process.execPath, ['dist/src/server.js'], { cwd: resolve('.'), windowsHide: true, env: { ...process.env, PORT: String(port), LLM_PROVIDER: provider, OPENAI_API_KEY: '', GEMINI_API_KEY: '', OPENAI_MODEL: '', GEMINI_MODEL: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('No arrancó el servidor')), 10000);
        child.once('error', error => { clearTimeout(timer); reject(error); });
        child.once('exit', code => { clearTimeout(timer); reject(new Error(`Salida inesperada ${code}`)); });
        child.stdout.on('data', chunk => { if (chunk.toString().includes('Servidor disponible')) { clearTimeout(timer); resolve(); } });
      });
      const health = await (await fetch(`http://127.0.0.1:${port}/api/health`)).json();
      assert.deepEqual(health, { ok: true, provider, model: null, configured: false });
    } finally { child.kill(); await once(child, 'exit'); }
  }
});
