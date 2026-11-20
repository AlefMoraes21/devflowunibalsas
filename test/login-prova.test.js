import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

process.env.FLOW_PRIVATE_KEY = 'unit-login-prova';
process.env.FLOW_PROJECT_ID = 'unit';
process.env.RBS_TOKEN = 'unit';
const { sealState, openState, responseForScreen, flowContext } = await import('../api/flow.js');
const { createEtapa1 } = await import('../api/etapa1-fila.js');
const { createEtapa2 } = await import('../api/etapa2-matricula.js');
const { validCpf } = await import('../api/matricula.js');

const FLOW = JSON.parse(readFileSync(new URL('../flows/etapa1-vestibular.json', import.meta.url), 'utf8'));
const CPF = '391.847.205-14', NASC = '2000-05-10';
const TEMA = 'Tema fixo da redação.';
const TEXTO = 'Um texto de teste com desenvolvimento suficiente para a redação ser aceita pelo Flow e pelo servidor.';

function memoria() {
  const db = new Map(); let v = 0; const k = (c, id) => c + '/' + id;
  return {
    async get(id, c = 'x') { const x = db.get(k(c, id)); return x ? { record: structuredClone(x.record), version: x.version } : null; },
    async create(id, record, c = 'x') { if (db.has(k(c, id))) return false; db.set(k(c, id), { record: structuredClone(record), version: 'v' + (++v) }); return true; },
    async update(id, record, version, c = 'x') { const x = db.get(k(c, id)); if (!x || x.version !== version) return false; db.set(k(c, id), { record: structuredClone(record), version: 'v' + (++v) }); return true; }
  };
}
function confere(origem, r) {
  const tela = FLOW.screens.find(s => s.id === r.screen);
  assert.ok(tela, 'tela existe: ' + r.screen);
  assert.ok(origem === r.screen || FLOW.routing_model[origem].includes(r.screen), `${origem} → ${r.screen}`);
  assert.deepEqual(Object.keys(r.data).sort(), Object.keys(tela.data ?? {}).sort());
  return r;
}

test('LOGIN com a prova disponível: leva à redação; o Cloud Run inicia a prova no Rubeus, espera e envia', async () => {
  const store = memoria(); const fila = []; const chamadas = [];
  let agora = Date.now(), provaIniciada = false;
  const tela = (screen, data) => ({ screen, data: { estado: sealState(screen, data) } });
  const E1 = createEtapa1({
    store, enqueue: async (id, o) => fila.push({ id, ...o }), sealState, openState,
    validateBasic: () => {}, validateFinal: () => {}, origens: [], hoje: () => '2026-11-15', requiresEssay: () => true, academicId: () => '223', userFields: new Set(['texto_redacao']),
    sleep: async () => {}, log: () => {}, clock: () => agora, esperaProvaMs: 600000, estabilidadeMs: 0,
    loginRubeus: async (login, nasc) => { assert.equal(login, '39184720514'); assert.equal(nasc, NASC); return { token: 'tok-login', person_id: '1' }; },
    prepararProva: async data => { assert.equal(data.token, 'tok-login'); assert.equal(data.applyment_id, '555'); provaIniciada = true; },
    runStep: async req => {
      const a = req.data.acao; chamadas.push(a);
      if (a === 'conferir_prova_existente') {
        assert.equal(openState(req.data.estado, req.screen).token, 'tok-login', 'usa a sessão do login');
        if (!provaIniciada) return tela('TELA_ORIENTACAO_PROVA', { erro: '[PROVA_VINCULO] O parâmetro idExecProva não foi confirmado pelo formulário atual.' });
        return tela('TELA_ORIENTACAO_PROVA', { prepared_existing: { binding: { executionCode: 'EX', proofId: '9' } } });
      }
      if (a === 'iniciar_redacao') return tela('TELA_REDACAO', { tema_redacao: TEMA });
      if (a === 'enviar_redacao') { assert.equal(req.data.texto_redacao, TEXTO); return tela('TELA_REDACAO', { recibo_avaliacao: { id: 1 } }); }
      if (a === 'verificar_entrega') return { screen: 'CONFIRMACAO', data: {} };
      throw new Error('inesperado ' + a);
    }
  });
  await store.create('etapa1-20383', { cursos: [{ id: 'a', title: 'A' }], turnos: { a: [{ id: 'n', title: 'N' }] }, tema: TEMA, atualizado: agora, expires: agora + 1e9 }, 'flowCache');
  const matricula = {
    login: async () => ({ token: 't', applyment_id: '555' }),
    portal: async () => ({ token: 't', processo_seletivo_id: '20383', stages: [
      { title: 'Inscrição', feedback: { complementary_text: 'Concluída', conclusive: 1 } },
      { title: 'Prova online', feedback: { complementary_text: 'Prova disponível', conclusive: 0, cta_text: 'Realizar prova' }, cta_link: '/passo/300664' }
    ] })
  };
  const E2 = createEtapa2({ store, enqueue: async () => {}, sealState, openState, matricula, validCpf, log: () => {}, entrarNaProva: a => E1.entrarNaProva(a) });
  const toque = async (E, screen, acao, estado, user = {}) => {
    const req = { screen, action: 'data_exchange', flow_token: 'ft-login', data: { acao, ...(estado ? { estado } : {}), ...user } };
    return confere(screen, await flowContext.run({ request: req, deadline: Date.now() + 9500 }, () => E.route(req)));
  };
  const portal = await toque(E2, 'MATR_LOGIN', 'entrar', null, { login: CPF, data_nascimento: NASC });
  assert.equal(portal.screen, 'INSC_PORTAL', 'próximo passo no portal é a prova: vai para "Realizar prova"');
  const aval = await toque(E1, 'INSC_PORTAL', 'realizar_prova', portal.data.estado);
  const orient = await toque(E1, 'INSC_AVALIACAO', 'iniciar_prova', aval.data.estado);
  const red = await toque(E1, 'INSC_ORIENTACAO', 'iniciar_redacao', orient.data.estado);
  assert.equal(red.screen, 'INSC_REDACAO'); assert.equal(red.data.tema_redacao, TEMA);
  const fim = await toque(E1, 'INSC_REDACAO', 'enviar_redacao', red.data.estado, { texto_redacao: TEXTO });
  assert.equal(fim.screen, 'INSC_FINALIZADA');
  assert.equal(chamadas.length, 0, 'nenhuma tela esperou o Rubeus');
  const id = fila[0].id;
  await E1.worker(id);
  assert.equal(provaIniciada, true, 'prova nunca aberta: o Cloud Run aciona o Iniciar prova');
  assert.ok(!chamadas.includes('enviar_redacao'), 'e espera a calma antes de enviar');
  agora += 600001;
  await E1.worker(id);
  assert.deepEqual(chamadas.slice(-3), ['iniciar_redacao', 'enviar_redacao', 'verificar_entrega']);
  assert.equal((await store.get(id, 'inscricoesFila')).record.status, 'concluida');
});

// 2.17.3: a sessão guardada (estado selado) vale 3 h; com 72 h de tentativas, ela pode vencer no meio.
test('Sessão da inscrição expirada: a redação ainda não enviada entra de novo pelo CPF e é entregue; a já enviada vai para a equipe', async () => {
  const store = memoria(); const fila = []; const chamadas = [];
  const agora = Date.now();
  const tela = (screen, data) => ({ screen, data: { estado: sealState(screen, data) } });
  const E1 = createEtapa1({
    store, enqueue: async (id, o) => fila.push({ id, ...o }), sealState, openState,
    validateBasic: () => {}, validateFinal: () => {}, origens: [], hoje: () => '2026-11-15', requiresEssay: () => true, academicId: () => '223', userFields: new Set(['texto_redacao']),
    sleep: async () => {}, log: () => {}, clock: () => agora, esperaProvaMs: 600000, estabilidadeMs: 0,
    loginRubeus: async (login, nasc) => { assert.equal(login, '39184720514'); assert.equal(nasc, NASC); chamadas.push('login'); return { token: 'tok-login', person_id: '1' }; },
    prepararProva: async () => { throw new Error('a prova já foi iniciada na inscrição'); },
    runStep: async req => {
      const a = req.data.acao; chamadas.push(a);
      if (a === 'conferir_prova_existente') { assert.equal(openState(req.data.estado, req.screen).token, 'tok-login', 'usa a sessão nova'); return tela('TELA_ORIENTACAO_PROVA', { prepared_existing: { binding: { executionCode: 'EX', proofId: '9' } } }); }
      if (a === 'iniciar_redacao') return tela('TELA_REDACAO', { tema_redacao: TEMA });
      if (a === 'enviar_redacao') { assert.equal(req.data.texto_redacao, TEXTO); return tela('TELA_REDACAO', { recibo_avaliacao: { id: 1 } }); }
      if (a === 'verificar_entrega') return { screen: 'CONFIRMACAO', data: {} };
      throw new Error('inesperado ' + a);
    }
  });
  const base = { processo: '20383', flow: 'x', respostas: { cpf: CPF, data_nascimento: NASC, nome: 'Teste', celular: '99999999999' }, redacao: TEXTO, status: 'inscrita', applyment_id: '555', inscrita_em: agora - 4 * 3600000, tentativas: 0, criado: agora, expires: agora + 1e9 };
  await store.create('r1', { id: 'r1', ...base, passo: 'redacao_enviar', ck: { screen: 'TELA_REDACAO', estado: 'expirado' } }, 'inscricoesFila');
  await E1.worker('r1');
  const r1 = (await store.get('r1', 'inscricoesFila')).record;
  assert.equal(r1.status, 'concluida', 'entregue com a sessão nova');
  assert.deepEqual(chamadas.filter(a => a !== 'conferir_prova_existente'), ['login', 'iniciar_redacao', 'enviar_redacao', 'verificar_entrega']);
  assert.ok(!r1.tentativas, 'sessão vencida não conta como falha');

  chamadas.length = 0;
  await store.create('r2', { id: 'r2', ...base, passo: 'entrega', ck: { screen: 'TELA_REDACAO', estado: 'expirado' } }, 'inscricoesFila');
  const original = console.error; console.error = () => {};
  try { await E1.worker('r2'); } finally { console.error = original; }
  const r2 = (await store.get('r2', 'inscricoesFila')).record;
  assert.equal(r2.status, 'conferir', 'já enviada: a equipe confere, sem 72 h de tentativas inúteis');
  assert.equal(chamadas.length, 0, 'nada é reenviado');
});

// 2.17.4: reprovado que refaz a prova pelo LOGIN não fica preso em "Redação enviada".
test('Refazer a redação pelo LOGIN: prova liberada de novo abre a redação; entrega recente continua como enviada', async () => {
  const { createHash } = await import('node:crypto');
  const idProva = createHash('sha256').update('login-prova:555').digest('hex');
  for (const [minutosDesdeEntrega, telaEsperada] of [[120, 'INSC_REDACAO'], [10, 'INSC_FIM']]) {
    const store = memoria(); const fila = []; const agora = Date.now();
    const E1 = createEtapa1({
      store, enqueue: async (id, o) => fila.push({ id, ...o }), sealState, openState,
      validateBasic: () => {}, validateFinal: () => {}, origens: [], hoje: () => '2026-11-15', requiresEssay: () => true, academicId: () => '223', userFields: new Set(['texto_redacao']),
      sleep: async () => {}, log: () => {}, clock: () => agora, runStep: async () => { throw new Error('sem Rubeus neste teste'); }
    });
    await store.create('etapa1-20383', { cursos: [{ id: 'a', title: 'A' }], turnos: {}, tema: TEMA, atualizado: agora, expires: agora + 1e9 }, 'flowCache');
    await store.create(idProva, { id: idProva, processo: '20383', flow: 'antigo', applyment_id: '555', status: 'concluida', passo: 'fim', respostas: null, redacao: null, concluida_em: agora - minutosDesdeEntrega * 60000, criado: agora - 1e8, expires: agora + 1e9 }, 'inscricoesFila');
    const matricula = {
      login: async () => ({ token: 't', applyment_id: '555' }),
      portal: async () => ({ token: 't', processo_seletivo_id: '20383', stages: [
        { title: 'Inscrição', feedback: { complementary_text: 'Concluída', conclusive: 1 } },
        { title: 'Prova online', feedback: { complementary_text: 'Prova disponível', conclusive: 0, cta_text: 'Realizar prova' }, cta_link: '/passo/300664' }
      ] })
    };
    const E2 = createEtapa2({ store, enqueue: async () => {}, sealState, openState, matricula, validCpf, log: () => {}, entrarNaProva: a => E1.entrarNaProva(a) });
    const toque = async (E, screen, acao, estado, user = {}) => {
      const req = { screen, action: 'data_exchange', flow_token: 'ft-refazer', data: { acao, ...(estado ? { estado } : {}), ...user } };
      return confere(screen, await flowContext.run({ request: req, deadline: Date.now() + 9500 }, () => E.route(req)));
    };
    const portal = await toque(E2, 'MATR_LOGIN', 'entrar', null, { login: CPF, data_nascimento: NASC });
    assert.equal(portal.screen, 'INSC_PORTAL');
    const aval = await toque(E1, 'INSC_PORTAL', 'realizar_prova', portal.data.estado);
    const orient = await toque(E1, 'INSC_AVALIACAO', 'iniciar_prova', aval.data.estado);
    const red = await toque(E1, 'INSC_ORIENTACAO', 'iniciar_redacao', orient.data.estado);
    assert.equal(red.screen, telaEsperada, `${minutosDesdeEntrega} min depois da entrega`);
    if (telaEsperada === 'INSC_REDACAO') {
      assert.equal(red.data.tema_redacao, TEMA);
      const fim = await toque(E1, 'INSC_REDACAO', 'enviar_redacao', red.data.estado, { texto_redacao: TEXTO });
      assert.equal(fim.screen, 'INSC_FINALIZADA');
      const rec = (await store.get(idProva, 'inscricoesFila')).record;
      assert.equal(rec.status, 'inscrita'); assert.equal(rec.passo, 'redacao'); assert.equal(rec.redacao, TEXTO); assert.equal(rec.refazer, 1);
    } else assert.match(red.data.titulo, /Redação enviada/);
  }
});
