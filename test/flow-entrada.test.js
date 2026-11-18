// Entrada única do Cloud Run (/api/flow), com a criptografia da Meta: só as telas do Flow 2.13+.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';

const keys = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
process.env.FLOW_PRIVATE_KEY = keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
process.env.META_APP_SECRET = 'unit-app-secret';
const { default: handler, workerHandler } = await import('../api/flow.js');
const FLOW = JSON.parse(readFileSync(new URL('../flows/etapa1-vestibular.json', import.meta.url), 'utf8'));

const resposta = () => ({ code: 0, body: '', status(c) { this.code = c; return this; }, send(b) { this.body = b; return this; }, json(b) { this.body = JSON.stringify(b); return this; }, setHeader() {} });
async function chamar(pedido, { assinar = true } = {}) {
  const aes = crypto.randomBytes(16), iv = crypto.randomBytes(16), c = crypto.createCipheriv('aes-128-gcm', aes, iv);
  const enc = Buffer.concat([c.update(JSON.stringify({ version: '3.0', flow_token: 'unit', ...pedido })), c.final(), c.getAuthTag()]);
  const body = { encrypted_flow_data: enc.toString('base64'), encrypted_aes_key: crypto.publicEncrypt({ key: keys.publicKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, aes).toString('base64'), initial_vector: iv.toString('base64') };
  const rawBody = Buffer.from(JSON.stringify(body));
  const headers = assinar ? { 'x-hub-signature-256': 'sha256=' + crypto.createHmac('sha256', process.env.META_APP_SECRET).update(rawBody).digest('hex') } : {};
  const res = resposta();
  await handler({ method: 'POST', body, rawBody, headers, url: '/api/flow' }, res);
  if (res.code !== 200) return { http: res.code };
  const b = Buffer.from(res.body, 'base64'), d = crypto.createDecipheriv('aes-128-gcm', aes, Buffer.from(iv.map(x => x ^ 255)));
  d.setAuthTag(b.subarray(-16));
  return JSON.parse(Buffer.concat([d.update(b.subarray(0, -16)), d.final()]).toString());
}

test('entrada única: ping, INIT, tela inicial e tela do Flow antigo, sempre com telas que existem no JSON', async () => {
  const ids = new Set(FLOW.screens.map(s => s.id));
  assert.deepEqual(await chamar({ action: 'ping' }), { data: { status: 'active' } });
  const init = await chamar({ action: 'INIT' });
  assert.equal(init.screen, 'INSC_INICIO', 'INIT sem link de redação abre a tela inicial');
  const dados = await chamar({ action: 'data_exchange', screen: 'INSC_INICIO', data: { acao: 'e1_iniciar', processo_seletivo_id: '20385' } });
  assert.equal(dados.screen, 'INSC_DADOS');
  const antigo = await chamar({ action: 'data_exchange', screen: 'ESCOLHA_PROCESSO', data: { acao: 'selecionar_processo' } });
  assert.equal(antigo.screen, 'INSC_FIM', 'tela do Flow antigo não volta mais ao motor antigo');
  for (const r of [init, dados, antigo]) assert.ok(ids.has(r.screen), r.screen);
  assert.deepEqual(await chamar({ action: 'data_exchange', screen: 'INSC_DADOS', data: { error: 'x', error_message: 'y' } }), { data: { acknowledged: true } });
});

test('assinatura da Meta obrigatória quando META_APP_SECRET existe; GET mostra a versão', async () => {
  assert.equal((await chamar({ action: 'ping' }, { assinar: false })).http, 432);
  const res = resposta();
  await handler({ method: 'GET', url: '/api/flow' }, res);
  assert.match(res.body, /unibalsas-cloudrun-jornada-2.16.5/);
});

test('worker: tarefa sem tipo conhecido (Flow antigo) é descartada sem repetir', async () => {
  const res = resposta();
  await workerHandler({ body: { id: 'a'.repeat(64) }, headers: {} }, res);
  assert.equal(res.code, 204);
});
