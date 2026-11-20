// Varredura de tarefas perdidas (2.17.5): Firestore (datas fora da criptografia), fila da matrícula e a rota.
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.FLOW_PRIVATE_KEY = 'unit-reconciliar';
process.env.FLOW_PROJECT_ID = 'unit';
process.env.RBS_TOKEN = 'unit';
const { createStore, unpack } = await import('../api/cloud-store.js');
const { reconciliarHandler, quemChamou } = await import('../api/flow.js');
const { createEtapa2 } = await import('../api/etapa2-matricula.js');

const MIN = 60000;

test('Firestore: só a próxima ação e a data da falha ficam fora da criptografia', async () => {
  const enviados = [];
  const store = createStore({ request: async (url, o = {}) => { enviados.push({ url, ...o }); return { status: 200, json: { updateTime: 'v1' } }; } });
  const base = { cpf: '39184720514', expires: Date.UTC(2026, 11, 1) };
  await store.create('a', base, 'inscricoesFila');
  await store.create('b', { ...base, status: 'pendente', proxima_acao_em: Date.UTC(2026, 10, 20, 12) }, 'inscricoesFila');
  await store.create('c', { ...base, status: 'falhou', falhou_em: Date.UTC(2026, 10, 20, 13) }, 'inscricoesFila');
  const campos = enviados.map(e => e.body.fields);
  assert.deepEqual(Object.keys(campos[0]).sort(), ['blob', 'expireAt']);
  assert.equal(campos[1].proximaAcaoEm.timestampValue, '2026-11-20T12:00:00.000Z');
  assert.equal(campos[2].falhouEm.timestampValue, '2026-11-20T13:00:00.000Z');
  assert.ok(!JSON.stringify(enviados).includes('39184720514'), 'CPF nunca em texto aberto');
  assert.equal(unpack(campos[1].blob.stringValue).cpf, '39184720514');
});

test('Firestore: consulta da varredura usa runQuery (data menor que o limite, mais antigas primeiro)', async () => {
  let pedido;
  const gravado = [];
  const escritor = createStore({ request: async (url, o) => { gravado.push(o.body.fields); return { status: 200, json: {} }; } });
  await escritor.create('x', { status: 'pendente', proxima_acao_em: 1, expires: 2 }, 'matriculaFila');
  const store = createStore({ request: async (url, o) => {
    pedido = { url, ...o };
    return { status: 200, json: [{ readTime: 'r' }, { document: { name: 'projects/unit/databases/d/documents/matriculaFila/abc', fields: gravado[0], updateTime: 'v9' } }] };
  } });
  const r = await store.query('matriculaFila', 'proximaAcaoEm', Date.UTC(2026, 10, 20), 50);
  assert.match(pedido.url, /\/documents:runQuery$/);
  const q = pedido.body.structuredQuery;
  assert.deepEqual(q.from, [{ collectionId: 'matriculaFila' }]);
  assert.equal(q.where.fieldFilter.op, 'LESS_THAN');
  assert.equal(q.where.fieldFilter.value.timestampValue, '2026-11-20T00:00:00.000Z');
  assert.equal(q.limit, 50);
  assert.deepEqual(r, [{ id: 'abc', record: { status: 'pendente', proxima_acao_em: 1, expires: 2 }, version: 'v9' }]);
  await assert.rejects(store.query('matriculaFila', 'blob', 1), /inválido/);
});

function memoria() {
  const db = new Map(); let v = 0; const k = (c, id) => c + '/' + id;
  return {
    async get(id, c) { const x = db.get(k(c, id)); return x ? { record: structuredClone(x.record), version: x.version } : null; },
    async create(id, record, c) { if (db.has(k(c, id))) return false; db.set(k(c, id), { record: structuredClone(record), version: 'v' + (++v) }); return true; },
    async update(id, record, version, c) { const x = db.get(k(c, id)); if (!x || x.version !== version) return false; db.set(k(c, id), { record: structuredClone(record), version: 'v' + (++v) }); return true; },
    async query(c, campo, antes, limite = 100) {
      const nome = { proximaAcaoEm: 'proxima_acao_em', falhouEm: 'falhou_em' }[campo];
      return [...db].filter(([key, x]) => key.startsWith(c + '/') && Number.isFinite(x.record[nome]) && (campo !== 'falhouEm' || x.record.status === 'falhou') && x.record[nome] < antes)
        .slice(0, limite).map(([key, x]) => ({ id: key.slice(c.length + 1), record: structuredClone(x.record), version: x.version }));
    }
  };
}

test('Matrícula: tarefa perdida é religada; concluída só perde a marca; falhou só reabre quando pedido', async () => {
  let agora = Date.now();
  const store = memoria(), fila = [];
  const E = createEtapa2({ store, enqueue: async (id, o) => { fila.push({ id, ...o }); }, sealState: () => '', openState: () => ({}), matricula: {}, clock: () => agora, log: () => {} });
  const F = 'matriculaFila', base = { blocos: {}, enviados: {}, tentativas: 0, expires: agora + 1e9 };
  await store.create('perdida', { ...base, status: 'pendente', proxima_acao_em: agora }, F);
  await store.create('ocupada', { ...base, status: 'pendente', proxima_acao_em: agora, rodando_ate: agora + 60 * MIN }, F);
  await store.create('feita', { ...base, status: 'concluida', proxima_acao_em: agora }, F);
  await store.create('falhou', { ...base, status: 'falhou', tentativas: 20, falhou_em: agora }, F);
  agora += 11 * MIN;
  assert.deepEqual(await E.reconciliar({ simular: true }), { reenviadas: 1, limpas: 1, ocupadas: 1, reabertas: 0 });
  assert.equal(fila.length, 0);
  assert.deepEqual(await E.reconciliar(), { reenviadas: 1, limpas: 1, ocupadas: 1, reabertas: 0 });
  assert.deepEqual(fila.map(t => [t.id, t.tipo]), [['perdida', 'etapa2']]);
  assert.equal((await store.get('perdida', F)).record.proxima_acao_em, agora, 'religada: marca renovada');
  assert.equal((await store.get('feita', F)).record.proxima_acao_em, null);
  assert.equal((await store.get('falhou', F)).record.status, 'falhou');
  assert.equal((await E.reconciliar({ reabrirFalhas: true })).reabertas, 1);
  const r = (await store.get('falhou', F)).record;
  assert.equal(r.status, 'pendente'); assert.equal(r.tentativas, 0); assert.equal(r.falhou_em, null);
  assert.deepEqual(fila.at(-1), { id: 'falhou', tipo: 'etapa2' });
});

test('Matrícula: execução que termina tira a marca; falha passageira marca a hora da próxima tentativa', async () => {
  let agora = Date.now();
  const store = memoria(), fila = [];
  const F = 'matriculaFila';
  const matricula = {
    login: async () => ({ token: 't' }),
    portal: async () => ({ token: 't', processo_seletivo_id: '1', stages: [{ title: 'Contrato', feedback: { conclusive: 1 }, cta_link: null }] })
  };
  const E = createEtapa2({ store, enqueue: async (id, o) => { fila.push({ id, ...o }); }, sealState: () => '', openState: () => ({}), matricula, clock: () => agora, log: () => {} });
  await store.create('m1', { blocos: {}, enviados: {}, status: 'pendente', tentativas: 0, proxima_acao_em: agora, expires: agora + 1e9 }, F);
  assert.equal(await E.worker('m1'), 204);
  const r = (await store.get('m1', F)).record;
  assert.equal(r.status, 'concluida'); assert.equal(r.proxima_acao_em, null);
  // Falha passageira: a marca passa a ser a hora da próxima tentativa.
  await store.create('m2', { blocos: {}, enviados: {}, status: 'pendente', tentativas: 0, expires: agora + 1e9 }, F);
  matricula.portal = async () => { throw new Error('Rubeus fora do ar'); };
  await E.worker('m2');
  const r2 = (await store.get('m2', F)).record;
  assert.equal(r2.tentativas, 1); assert.equal(r2.proxima_acao_em, agora + 30000);
  assert.deepEqual(fila.at(-1), { id: 'm2', tipo: 'etapa2', atrasoSeg: 30 });
});

test('Rota /internal/reconciliar: sem login autorizado devolve 403 e não varre nada', async () => {
  const chamadas = [];
  const filas = { etapa1: { reconciliar: async o => { chamadas.push(['etapa1', o]); return { reenviadas: 2 }; } }, etapa2: { reconciliar: async o => { chamadas.push(['etapa2', o]); throw new Error('x'); } } };
  const resposta = () => { const r = { code: 0, body: null }; r.status = c => { r.code = c; return r; }; r.send = b => { r.body = b; return r; }; r.json = b => { r.body = b; return r; }; return r; };
  let res = resposta();
  await reconciliarHandler({ method: 'POST', headers: {}, body: {} }, res, { autenticar: async () => null, filas });
  assert.equal(res.code, 403); assert.equal(chamadas.length, 0);
  res = resposta();
  await reconciliarHandler({ method: 'GET', headers: {} }, res, { autenticar: async () => 'a@b', filas });
  assert.equal(res.code, 405);
  res = resposta();
  const original = console.error; console.error = () => {};
  try { await reconciliarHandler({ method: 'POST', headers: { authorization: 'Bearer x' }, body: { simular: true, reabrir_falhas: 'sim' } }, res, { autenticar: async () => 'a@b', filas }); }
  finally { console.error = original; }
  assert.equal(res.code, 200);
  assert.deepEqual(chamadas, [['etapa1', { simular: true, reabrirFalhas: false }], ['etapa2', { simular: true, reabrirFalhas: false }]], 'só true liga as opções');
  assert.deepEqual(res.body.resultado, { etapa1: { reenviadas: 2 }, etapa2: { erro: true } }, 'erro numa fila não impede a outra');
});

test('Rota /internal/reconciliar: aceita só ID token do Google de e-mail listado', async () => {
  const origem = 'https://servico-unit.a.run.app/';
  const info = j => async url => { assert.match(url, /^https:\/\/oauth2\.googleapis\.com\/tokeninfo\?id_token=/); return { ok: true, json: async () => j }; };
  const valido = { iss: 'https://accounts.google.com', email: 'Agendador@unit.iam.gserviceaccount.com', email_verified: 'true', aud: 'https://servico-unit.a.run.app' };
  const emails = 'agendador@unit.iam.gserviceaccount.com, equipe@example.com';
  assert.equal(await quemChamou('Bearer tok', { fetcher: info(valido), emails, origem }), 'agendador@unit.iam.gserviceaccount.com');
  assert.equal(await quemChamou('Bearer tok', { fetcher: info({ ...valido, email: 'equipe@example.com', aud: '32555940559.apps.googleusercontent.com' }), emails, origem }), 'equipe@example.com', 'gcloud auth print-identity-token');
  assert.equal(await quemChamou('Bearer tok', { fetcher: info({ ...valido, aud: 'https://outro.run.app' }), emails, origem }), null, 'token feito para outro serviço');
  assert.equal(await quemChamou('Bearer tok', { fetcher: info({ ...valido, email: 'intruso@example.com' }), emails, origem }), null);
  assert.equal(await quemChamou('Bearer tok', { fetcher: info({ ...valido, email_verified: 'false' }), emails, origem }), null);
  assert.equal(await quemChamou('Bearer tok', { fetcher: info({ ...valido, iss: 'https://evil.example' }), emails, origem }), null);
  assert.equal(await quemChamou('Bearer tok', { fetcher: info(valido), emails: '', origem }), null, 'sem RECONCILIAR_EMAILS a rota fica fechada');
  assert.equal(await quemChamou('', { fetcher: info(valido), emails, origem }), null);
  assert.equal(await quemChamou('Bearer tok', { fetcher: async () => ({ ok: false }), emails, origem }), null, 'token vencido ou inválido');
});
