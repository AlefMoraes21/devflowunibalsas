import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.FLOW_PRIVATE_KEY = 'unit-etapa1';
process.env.FLOW_PROJECT_ID = 'unit';
process.env.RBS_TOKEN = 'unit';
const { sealState, openState, responseForScreen, flowContext } = await import('../api/flow.js');
const { createEtapa1, DUPLICADA_MSG } = await import('../api/etapa1-fila.js');

const CURSOS = [{ id: 'ads', title: 'ADS' }, { id: 'dir', title: 'Direito' }];
const TURNOS = { ads: [{ id: 'not', title: 'Noturno' }], dir: [{ id: 'mat', title: 'Matutino' }, { id: 'not', title: 'Noturno' }] };
const TEMA = 'O papel da educação na redução das desigualdades sociais.';
const USER = new Set(['nome', 'email', 'data_nascimento', 'celular', 'genero', 'aceite_privacidade', 'possui_nome_social', 'nome_social', 'curso_id', 'turno_id', 'cpf', 'nacionalidade', 'concluiu_ensino_medio', 'possui_deficiencia', 'tipos_deficiencia', 'deficiencia_outra', 'como_conheceu', 'como_conheceu_outro', 'texto_redacao', 'processo_seletivo_id']);
const BASICOS = { nome: 'Ana Clara Teste', email: 'ana.teste@example.com', data_nascimento: '2005-03-15', celular: '99999990000', genero: 'F', aceite_privacidade: true, possui_nome_social: false };
const FINAL = { cpf: '391.847.205-14', nacionalidade: '10', concluiu_ensino_medio: 'Sim', possui_deficiencia: 'F', como_conheceu: '01' };
const TEXTO = 'Um texto de teste com desenvolvimento suficiente para a redação ser aceita pelo Flow.';

function memoria() {
  const db = new Map(); let v = 0; const k = (c, id) => c + '/' + id;
  return {
    db,
    async get(id, c = 'flowJobs') { const x = db.get(k(c, id)); return x ? { record: structuredClone(x.record), version: x.version } : null; },
    async create(id, record, c = 'flowJobs') { if (db.has(k(c, id))) return false; db.set(k(c, id), { record: structuredClone(record), version: 'v' + (++v) }); return true; },
    async update(id, record, version, c = 'flowJobs') { const x = db.get(k(c, id)); if (!x || x.version !== version) return false; db.set(k(c, id), { record: structuredClone(record), version: 'v' + (++v) }); return true; }
  };
}

// Simula o caminho síncrono (o que o worker repete no Rubeus) com telas seladas de verdade.
function rubeusFalso({ finalErro = '', finalPendente = false, turnoAusente = false } = {}) {
  const chamadas = [];
  const tela = (screen, data) => ({ screen, data: { estado: sealState(screen, data), ...(screen === 'CONFIRMACAO' ? { titulo: 'ok' } : {}) } });
  async function runStep(req) {
    const a = req.data.acao; chamadas.push(a);
    if (a === 'selecionar_processo') return tela('DADOS_BASICOS', { token: 't1' });
    if (a === 'enviar_dados_basicos') { assert.equal(req.data.nome, BASICOS.nome); return tela('CURSO_INTERESSE', { cursos: CURSOS, turnos: [] }); }
    if (a === 'buscar_turnos') return tela('CURSO_INTERESSE', { cursos: CURSOS, turnos: turnoAusente ? [] : TURNOS[req.data.curso_id], erro: turnoAusente ? 'Nenhum turno disponível para o curso selecionado.' : '' });
    if (a === 'avancar_curso_interesse') { assert.equal(req.data.turno_id, 'not'); return tela('QUASE_LA', {}); }
    if (a === 'enviar_informacoes_complementares') {
      assert.equal(req.data.cpf, FINAL.cpf);
      if (finalPendente) return { screen: 'PENDENTE', data: { mensagem: 'incerto' } };
      if (finalErro) return tela('QUASE_LA', { erro: finalErro });
      return tela('TELA_ORIENTACAO_PROVA', { applyment_id: '777', prova_pre_carregada: true });
    }
    if (a === 'iniciar_redacao') return tela('TELA_REDACAO', { tema_redacao: TEMA });
    if (a === 'enviar_redacao') { assert.equal(req.data.texto_redacao, TEXTO); return tela('TELA_REDACAO', { recibo_avaliacao: { id: 1 } }); }
    if (a === 'verificar_entrega') return { screen: 'CONFIRMACAO', data: { titulo: 'Redação enviada ✅' } };
    throw new Error('inesperado ' + a);
  }
  return { chamadas, runStep };
}

function montar({ store = memoria(), rubeus = rubeusFalso(), rm = false } = {}) {
  const fila = [];
  const e1 = createEtapa1({
    ativo: () => true, store, enqueue: async (id, o) => { fila.push({ id, ...o }); },
    runStep: rubeus.runStep, sealState, openState, render: responseForScreen,
    validateBasic: d => { if (!String(d.nome ?? '').includes(' ')) throw new Error('Informe nome e sobrenome.'); },
    validateFinal: d => { if (!/^\d{3}\.\d{3}\.\d{3}-\d{2}$/.test(d.cpf ?? '')) throw new Error('CPF inválido.'); if (!(d.origens ?? []).some(o => o.id === d.como_conheceu)) throw new Error('Selecione como ficou sabendo.'); },
    origens: [{ id: '01', title: 'Site oficial' }], hoje: () => '2026-11-15',
    requiresEssay: id => String(id) === '20383', academicId: () => '223', userFields: USER,
    jaInscritoNoRm: async () => rm, sleep: async () => {}, log: () => {}
  });
  return { e1, store, fila, rubeus };
}
const cacheCompleto = store => store.create('etapa1-20383', { cursos: CURSOS, turnos: TURNOS, tema: TEMA, atualizado: Date.now(), expires: Date.now() + 1e9 }, 'flowCache');

// Uma requisição do Flow passando pela rota instantânea (como no handler).
async function toque(e1, screen, acao, estado, user = {}, flow_token = 'ft-1') {
  const req = { screen, action: 'data_exchange', flow_token, data: { acao, estado, ...user } };
  return flowContext.run({ request: req, deadline: Date.now() + 9500, write: null }, () => e1.route(req));
}
async function ateRedacao(e1) {
  const inicio = sealState('ESCOLHA_PROCESSO', { processos_disponiveis: ['20383'] });
  const basicos = await toque(e1, 'ESCOLHA_PROCESSO', 'selecionar_processo', inicio, { processo_seletivo_id: '20383' });
  assert.equal(basicos.screen, 'DADOS_BASICOS');
  const curso = await toque(e1, 'DADOS_BASICOS', 'enviar_dados_basicos', basicos.data.estado, BASICOS);
  assert.equal(curso.screen, 'CURSO_INTERESSE');
  assert.deepEqual(curso.data.cursos, CURSOS);
  const turnos = await toque(e1, 'CURSO_INTERESSE', 'buscar_turnos', curso.data.estado, { curso_id: 'ads' });
  assert.equal(turnos.data.turno_visivel, true);
  assert.equal(turnos.data.valor_turno_id, 'not', 'turno único já vem selecionado');
  const quase = await toque(e1, 'CURSO_INTERESSE', 'avancar_curso_interesse', turnos.data.estado, { curso_id: 'ads', turno_id: 'not' });
  assert.equal(quase.screen, 'QUASE_LA');
  return quase;
}

test('cache incompleto: segue o caminho síncrono de sempre', async () => {
  const { e1 } = montar();
  const r = await toque(e1, 'ESCOLHA_PROCESSO', 'selecionar_processo', sealState('ESCOLHA_PROCESSO', { processos_disponiveis: ['20383'] }), { processo_seletivo_id: '20383' });
  assert.equal(r, null);
});

test('jornada instantânea sem Rubeus; o worker repete os passos e conclui', async () => {
  const { e1, store, fila, rubeus } = montar();
  await cacheCompleto(store);
  const quase = await ateRedacao(e1);
  assert.equal(rubeus.chamadas.length, 0, 'nenhuma tela chamou o Rubeus');

  const orient = await toque(e1, 'QUASE_LA', 'enviar_informacoes_complementares', quase.data.estado, FINAL);
  assert.equal(orient.screen, 'TELA_ORIENTACAO_PROVA');
  assert.equal(orient.data.rotulo_rodape, 'Iniciar redação');
  assert.equal(fila.length, 1);
  const id = fila[0].id;

  // Worker roda a inscrição antes da redação chegar e para esperando o texto.
  await e1.worker(id);
  let rec = (await store.get(id, 'inscricoesFila')).record;
  assert.equal(rec.status, 'inscrita');
  assert.equal(rec.applyment_id, '777');
  assert.deepEqual(rubeus.chamadas, ['selecionar_processo', 'enviar_dados_basicos', 'buscar_turnos', 'avancar_curso_interesse', 'enviar_informacoes_complementares']);

  const red = await toque(e1, 'TELA_ORIENTACAO_PROVA', 'iniciar_redacao', orient.data.estado);
  assert.equal(red.screen, 'TELA_REDACAO');
  assert.equal(red.data.tema_redacao, TEMA);
  const fim = await toque(e1, 'TELA_REDACAO', 'enviar_redacao', red.data.estado, { texto_redacao: TEXTO });
  assert.equal(fim.screen, 'CONFIRMACAO');
  assert.doesNotMatch(fim.data.mensagem, /Já sou inscrito|data de nascimento/);

  await e1.worker(id);
  rec = (await store.get(id, 'inscricoesFila')).record;
  assert.equal(rec.status, 'concluida');
  assert.equal(rec.respostas, null, 'dados pessoais apagados depois da entrega');
  assert.equal(rec.redacao, null);
  assert.deepEqual(rubeus.chamadas.slice(5), ['iniciar_redacao', 'enviar_redacao', 'verificar_entrega']);
});

test('redação curta é recusada na hora e nada é guardado', async () => {
  const { e1, store } = montar();
  await cacheCompleto(store);
  const quase = await ateRedacao(e1);
  const orient = await toque(e1, 'QUASE_LA', 'enviar_informacoes_complementares', quase.data.estado, FINAL);
  const red = await toque(e1, 'TELA_ORIENTACAO_PROVA', 'iniciar_redacao', orient.data.estado);
  const r = await toque(e1, 'TELA_REDACAO', 'enviar_redacao', red.data.estado, { texto_redacao: 'curto' });
  assert.equal(r.screen, 'TELA_REDACAO');
  assert.match(r.data.erro, /desenvolva mais/);
});

test('CPF já inscrito (RM ou outra sessão) mostra a mensagem do site', async () => {
  const a = montar({ rm: true });
  await cacheCompleto(a.store);
  const q1 = await ateRedacao(a.e1);
  const r1 = await toque(a.e1, 'QUASE_LA', 'enviar_informacoes_complementares', q1.data.estado, FINAL);
  assert.equal(r1.screen, 'QUASE_LA');
  assert.equal(r1.data.erro, DUPLICADA_MSG);

  const b = montar();
  await cacheCompleto(b.store);
  const q2 = await ateRedacao(b.e1);
  assert.equal((await toque(b.e1, 'QUASE_LA', 'enviar_informacoes_complementares', q2.data.estado, FINAL)).screen, 'TELA_ORIENTACAO_PROVA');
  // Mesmo toque reenviado pelo WhatsApp (mesma sessão): não é duplicidade.
  assert.equal((await toque(b.e1, 'QUASE_LA', 'enviar_informacoes_complementares', q2.data.estado, FINAL)).screen, 'TELA_ORIENTACAO_PROVA');
  const q3 = await ateRedacao(b.e1);
  const r3 = await toque(b.e1, 'QUASE_LA', 'enviar_informacoes_complementares', q3.data.estado, FINAL, 'ft-outra');
  assert.equal(r3.data.erro, DUPLICADA_MSG);
});

test('Rubeus acusa inscrição existente no envio: fica marcada como duplicada, sem nova tentativa', async () => {
  const { e1, store, fila } = montar({ rubeus: rubeusFalso({ finalErro: 'Você já possui inscrição neste processo seletivo.' }) });
  await cacheCompleto(store);
  const q = await ateRedacao(e1);
  await toque(e1, 'QUASE_LA', 'enviar_informacoes_complementares', q.data.estado, FINAL);
  await e1.worker(fila[0].id);
  const rec = (await store.get(fila[0].id, 'inscricoesFila')).record;
  assert.equal(rec.status, 'duplicada');
  assert.equal(fila.length, 1, 'não reagenda');
});

test('resultado incerto na conclusão: vai para conferência e nunca reenvia', async () => {
  const rubeus = rubeusFalso({ finalPendente: true });
  const { e1, store, fila } = montar({ rubeus });
  await cacheCompleto(store);
  const q = await ateRedacao(e1);
  await toque(e1, 'QUASE_LA', 'enviar_informacoes_complementares', q.data.estado, FINAL);
  await e1.worker(fila[0].id);
  await e1.worker(fila[0].id);
  const rec = (await store.get(fila[0].id, 'inscricoesFila')).record;
  assert.equal(rec.status, 'conferir');
  assert.equal(rubeus.chamadas.filter(a => a === 'enviar_informacoes_complementares').length, 1);
});

test('falha passageira antes da conclusão: reagenda e recomeça numa sessão nova', async () => {
  const rubeus = rubeusFalso({ turnoAusente: true });
  const { e1, store, fila } = montar({ rubeus });
  await cacheCompleto(store);
  const q = await ateRedacao(e1);
  await toque(e1, 'QUASE_LA', 'enviar_informacoes_complementares', q.data.estado, FINAL);
  await e1.worker(fila[0].id);
  const rec = (await store.get(fila[0].id, 'inscricoesFila')).record;
  assert.equal(rec.status, 'pendente');
  assert.equal(rec.passo, 'inicio');
  assert.equal(rec.tentativas, 1);
  assert.equal(fila.length, 2);
  assert.ok(fila[1].atrasoSeg > 0);
  assert.ok(!rubeus.chamadas.includes('enviar_informacoes_complementares'));
});

// ---------------------------------------------------------------- Flow próprio da etapa 1 (E1_*)
import { readFileSync } from 'node:fs';
const FLOW_E1 = JSON.parse(readFileSync(new URL('../flows/etapa1-vestibular.json', import.meta.url), 'utf8'));
const telaE1 = id => FLOW_E1.screens.find(s => s.id === id);
// Contrato com o JSON publicado: a resposta tem exatamente as chaves declaradas e a tela é uma rota válida.
function confere(origem, r) {
  const tela = telaE1(r.screen);
  assert.ok(tela, 'tela existe no Flow: ' + r.screen);
  assert.ok(FLOW_E1.routing_model[origem].includes(r.screen) || origem === r.screen, `${origem} → ${r.screen} está no routing_model`);
  assert.deepEqual(Object.keys(r.data).sort(), Object.keys(tela.data ?? {}).sort(), 'chaves de ' + r.screen);
  for (const [k, v] of Object.entries(r.data)) {
    const tipo = tela.data[k].type;
    assert.equal(Array.isArray(v) ? 'array' : typeof v, tipo, `${r.screen}.${k} é ${tipo}`);
  }
  return r;
}
async function e1(e, screen, acao, estado, user = {}, ft = 'ft-e1') { return confere(screen, await toque(e, screen, acao, estado, user, ft)); }

test('Flow E1: JSON válido para a Meta (rotas, ações e chaves)', () => {
  assert.equal(FLOW_E1.version, '7.3');
  const ids = FLOW_E1.screens.map(s => s.id);
  for (const [de, para] of Object.entries(FLOW_E1.routing_model)) { assert.ok(ids.includes(de)); for (const p of para) assert.ok(ids.includes(p)); }
  const texto = JSON.stringify(FLOW_E1);
  assert.doesNotMatch(texto, /consultar_tarefa|Verificar andamento|Já sou inscrito|data_nascimento.*login/);
  for (const t of FLOW_E1.screens) {
    const usados = [...JSON.stringify(t.layout).matchAll(/\$\{data\.([a-z_]+)\}/g)].map(m => m[1]);
    for (const u of usados) assert.ok(t.data && u in t.data, `${t.id} usa data.${u} declarado`);
  }
});

test('Flow E1: jornada completa instantânea, curso e turno na mesma tela, sem Rubeus', async () => {
  const { e1: E, store, fila, rubeus } = montar();
  await cacheCompleto(store);
  const dados = await e1(E, 'E1_INICIO', 'e1_iniciar', undefined);
  assert.equal(dados.screen, 'E1_DADOS');
  const erro = await e1(E, 'E1_DADOS', 'enviar_dados_basicos', dados.data.estado, { ...BASICOS, nome: 'Ana' });
  assert.equal(erro.screen, 'E1_DADOS'); assert.equal(erro.data.valor_nome, 'Ana'); assert.equal(erro.data.tem_erro, true);
  const curso = await e1(E, 'E1_DADOS', 'enviar_dados_basicos', dados.data.estado, BASICOS);
  assert.equal(curso.screen, 'E1_CURSO'); assert.equal(curso.data.turno_visivel, false);
  const dir = await e1(E, 'E1_CURSO', 'buscar_turnos', curso.data.estado, { curso_id: 'dir' });
  assert.equal(dir.screen, 'E1_CURSO'); assert.equal(dir.data.turno_visivel, true); assert.equal(dir.data.turnos.length, 2); assert.equal(dir.data.valor_turno_id, '');
  const ads = await e1(E, 'E1_CURSO', 'buscar_turnos', dir.data.estado, { curso_id: 'ads' });
  assert.equal(ads.data.valor_turno_id, 'not', 'turno único já vem marcado');
  const semTurno = await e1(E, 'E1_CURSO', 'escolher_curso', dir.data.estado, { curso_id: 'dir' });
  assert.match(semTurno.data.erro, /turno/);
  // Trocou de curso e tocou Continuar com o turno do curso anterior: recarrega os turnos, não avança.
  const trocou = await e1(E, 'E1_CURSO', 'escolher_curso', ads.data.estado, { curso_id: 'dir', turno_id: 'not' });
  assert.equal(trocou.screen, 'E1_CURSO');
  const quase = await e1(E, 'E1_CURSO', 'escolher_curso', ads.data.estado, { curso_id: 'ads', turno_id: 'not' });
  assert.equal(quase.screen, 'E1_QUASE_LA'); assert.ok(quase.data.origens.length);
  const orient = await e1(E, 'E1_QUASE_LA', 'enviar_informacoes_complementares', quase.data.estado, FINAL);
  assert.equal(orient.screen, 'E1_ORIENTACAO');
  const red = await e1(E, 'E1_ORIENTACAO', 'iniciar_redacao', orient.data.estado);
  assert.equal(red.data.tema_redacao, TEMA);
  const fim = await e1(E, 'E1_REDACAO', 'enviar_redacao', red.data.estado, { texto_redacao: TEXTO });
  assert.equal(fim.screen, 'E1_FIM');
  assert.equal(rubeus.chamadas.length, 0, 'nenhuma tela esperou o Rubeus');
  await E.worker(fila[0].id);
  assert.equal((await store.get(fila[0].id, 'inscricoesFila')).record.status, 'concluida');
});

test('Flow E1: sem cache, encerra com aviso (sem tela quebrada); funciona com a chave ETAPA1_FILA desligada', async () => {
  const store = memoria();
  const fila = [];
  const E = createEtapa1({ ativo: () => false, store, enqueue: async id => fila.push(id), runStep: async () => { throw new Error('x'); }, sealState, openState, render: responseForScreen, validateBasic: () => {}, validateFinal: () => {}, origens: [{ id: '01', title: 'Site' }], hoje: () => '2026-11-15', requiresEssay: id => String(id) === '20383', academicId: () => '223', userFields: USER, log: () => {} });
  const fim = await e1(E, 'E1_INICIO', 'e1_iniciar', undefined);
  assert.equal(fim.screen, 'E1_FIM');
  await cacheCompleto(store);
  assert.equal((await e1(E, 'E1_INICIO', 'e1_iniciar', undefined)).screen, 'E1_DADOS');
  // Flow antigo continua no caminho síncrono com a chave desligada.
  assert.equal(await toque(E, 'ESCOLHA_PROCESSO', 'selecionar_processo', sealState('ESCOLHA_PROCESSO', { processos_disponiveis: ['20383'] }), { processo_seletivo_id: '20383' }), null);
});
