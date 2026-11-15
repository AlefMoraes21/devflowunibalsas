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
const USER = new Set(['nome', 'email', 'data_nascimento', 'celular', 'genero', 'aceite_privacidade', 'possui_nome_social', 'nome_social', 'curso_id', 'turno_id', 'cpf', 'nacionalidade', 'concluiu_ensino_medio', 'possui_deficiencia', 'tipos_deficiencia', 'deficiencia_outra', 'como_conheceu', 'como_conheceu_outro', 'texto_redacao', 'processo_seletivo_id', 'numero_inscricao_enem', 'ano_enem', 'nota_natureza_enem', 'nota_humanas_enem', 'nota_matematica_enem', 'nota_linguagens_enem', 'nota_redacao_enem']);
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
    if (a === 'avancar_curso_interesse') { assert.equal(req.data.turno_id, 'not'); return tela('QUASE_LA', { sem_redacao: Boolean(req.data.numero_inscricao_enem) }); }
    if (a === 'enviar_informacoes_complementares') {
      assert.equal(req.data.cpf, FINAL.cpf);
      if (finalPendente) return { screen: 'PENDENTE', data: { mensagem: 'incerto' } };
      if (finalErro) return tela('QUASE_LA', { erro: finalErro });
      if (req.data.estado && openState(req.data.estado, req.screen).sem_redacao) return tela('ACOMPANHAMENTO', { applyment_id: '888' });
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
  const avisos = [];
  const e1 = createEtapa1({
    ativo: () => true, store, enqueue: async (id, o) => { fila.push({ id, ...o }); },
    runStep: rubeus.runStep, sealState, openState, render: responseForScreen,
    validateBasic: d => { if (!String(d.nome ?? '').includes(' ')) throw new Error('Informe nome e sobrenome.'); },
    validateFinal: d => { if (!/^\d{3}\.\d{3}\.\d{3}-\d{2}$/.test(d.cpf ?? '')) throw new Error('CPF inválido.'); if (!(d.origens ?? []).some(o => o.id === d.como_conheceu)) throw new Error('Selecione como ficou sabendo.'); },
    origens: [{ id: '01', title: 'Site oficial' }], hoje: () => '2026-11-15',
    requiresEssay: id => String(id) === '20383', academicId: () => '223', userFields: USER,
    jaInscritoNoRm: async () => rm, sleep: async () => {}, log: () => {},
    ehEnem: id => String(id) === '20386', anosEnem: [{ id: '2025', title: '2025' }],
    validateEnem: d => { if (!/^\d{12,15}$/.test(String(d.numero_inscricao_enem ?? ''))) throw new Error('A inscrição do ENEM deve ter de 12 a 15 números.'); },
    avisar: async dados => { avisos.push(dados); return true; }
  });
  return { e1, store, fila, rubeus, avisos };
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

// ---------------------------------------------------------------- Flow próprio da etapa 1 (INSC_*)
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
  // Regras do editor da Meta: id de tela só com letras e "_"; limites de texto dos componentes.
  for (const id of ids) assert.match(id, /^[A-Za-z_]+$/, "id de tela inválido: " + id);
  for (const id of Object.keys(FLOW_E1.routing_model)) assert.match(id, /^[A-Za-z_]+$/);
  const comps = [];
  const andar = n => { if (Array.isArray(n)) n.forEach(andar); else if (n && typeof n === "object") { if (n.type) comps.push(n); Object.values(n).forEach(andar); } };
  andar(FLOW_E1.screens.map(t => t.layout));
  for (const c of comps) {
    if (c.type === "OptIn") assert.ok(c.label.length <= 120, "OptIn até 120: " + c.label);
    if (c.type === "Footer") assert.ok(c.label.length <= 35, "Footer até 35: " + c.label);
    if (c["helper-text"]) assert.ok(c["helper-text"].length <= 80, "helper-text até 80");
    if (Array.isArray(c["data-source"])) for (const o of c["data-source"]) assert.ok(o.title.length <= 30);
  }
  const texto = JSON.stringify(FLOW_E1);
  assert.doesNotMatch(texto, /consultar_tarefa|Verificar andamento|Já sou inscrito|data_nascimento.*login/);
  for (const t of FLOW_E1.screens) {
    const usados = [...JSON.stringify(t.layout).matchAll(/\$\{data\.([a-z_]+)\}/g)].map(m => m[1]);
    for (const u of usados) assert.ok(t.data && u in t.data, `${t.id} usa data.${u} declarado`);
  }
});

const ENEM = { numero_inscricao_enem: '123456789012', ano_enem: '2025', nota_natureza_enem: '600', nota_humanas_enem: '600', nota_matematica_enem: '600', nota_linguagens_enem: '600', nota_redacao_enem: '800' };
async function etapa1(E, processo = '20383', extra = {}) {
  const dados = await e1(E, 'INSC_INICIO', 'e1_iniciar', undefined, { processo_seletivo_id: processo });
  assert.equal(dados.screen, 'INSC_DADOS');
  const curso = await e1(E, 'INSC_DADOS', 'enviar_dados_basicos', dados.data.estado, BASICOS);
  assert.equal(curso.screen, 'INSC_CURSO');
  const t = await e1(E, 'INSC_CURSO', 'buscar_turnos', curso.data.estado, { curso_id: 'ads' });
  assert.equal(t.data.valor_turno_id, 'not', 'turno único já vem marcado');
  const quase = await e1(E, 'INSC_CURSO', 'escolher_curso', t.data.estado, { curso_id: 'ads', turno_id: 'not' });
  assert.equal(quase.screen, 'INSC_QUASE_LA');
  return quase;
}
const SUCCESS = r => { assert.equal(r.screen, 'SUCCESS'); return r.data.extension_message_response.params; };

test('Etapa 1: cada tela grava no Google; Concluir fecha o Flow na hora com dados_recebidos', async () => {
  const { e1: E, store, fila, rubeus, avisos } = montar();
  await cacheCompleto(store);
  const quase = await etapa1(E);
  assert.equal(quase.data.eh_nota_enem, false);
  const concl = confere('INSC_QUASE_LA', await toque(E, 'INSC_QUASE_LA', 'enviar_informacoes_complementares', quase.data.estado, FINAL, 'ft-e1'));
  assert.equal(concl.screen, 'INSC_CONCLUIDA', 'Vestibular: tela "Obrigado pelo seu cadastro!" com Realizar prova');
  const params = SUCCESS(await toque(E, 'INSC_CONCLUIDA', 'sair', concl.data.estado, {}, 'ft-e1'));
  assert.equal(params.status, 'dados_recebidos'); assert.equal(params.flow_token, 'ft-e1'); assert.ok(params.protocolo_fila);
  assert.equal(rubeus.chamadas.length, 0, 'o Flow não esperou o Rubeus');
  const id = fila[0].id;
  assert.equal((await store.get(id, 'inscricoesFila')).record.respostas.celular, BASICOS.celular, 'telefone guardado para o aviso');
  await E.worker(id);
  const rec = (await store.get(id, 'inscricoesFila')).record;
  assert.equal(rec.status, 'inscrita'); assert.equal(rec.passo, 'redacao'); assert.equal(rec.prova_vinculada, true); assert.equal(rec.aviso_redacao, 'enviado');
  assert.deepEqual(rubeus.chamadas, ['selecionar_processo', 'enviar_dados_basicos', 'buscar_turnos', 'avancar_curso_interesse', 'enviar_informacoes_complementares']);
  assert.ok(!rubeus.chamadas.includes('iniciar_redacao'), 'a prova não é aberta (cronômetro) antes do candidato');
  assert.equal(avisos.length, 1); assert.equal(avisos[0].celular, BASICOS.celular); assert.ok(avisos[0].flowToken.length >= 20);
});

test('Etapa 2: o INIT com o link do aviso abre direto a redação; Enviar fecha o Flow e o worker entrega', async () => {
  const { e1: E, store, fila, rubeus, avisos } = montar();
  await cacheCompleto(store);
  const quase = await etapa1(E);
  await toque(E, 'INSC_QUASE_LA', 'enviar_informacoes_complementares', quase.data.estado, FINAL, 'ft-e1');
  const id = fila[0].id;
  await E.worker(id);
  const token = avisos[0].flowToken;
  assert.equal(await E.route({ action: 'INIT', flow_token: 'desconhecido' }), null, 'token desconhecido segue o Flow antigo');
  const red = confere('INSC_REDACAO', await flowContext.run({ request: {}, deadline: Date.now() + 9500 }, () => E.route({ action: 'INIT', flow_token: token })));
  assert.equal(red.screen, 'INSC_REDACAO'); assert.equal(red.data.tema_redacao, TEMA);
  const curta = await toque(E, 'INSC_REDACAO', 'enviar_redacao', red.data.estado, { texto_redacao: 'curto' }, token);
  assert.equal(curta.screen, 'INSC_REDACAO'); assert.match(curta.data.erro, /desenvolva/);
  const params = SUCCESS(await toque(E, 'INSC_REDACAO', 'enviar_redacao', red.data.estado, { texto_redacao: TEXTO }, token));
  assert.equal(params.status, 'redacao_recebida');
  assert.equal(rubeus.chamadas.length, 5, 'envio da redação não esperou o Rubeus');
  await E.worker(id);
  assert.equal((await store.get(id, 'inscricoesFila')).record.status, 'concluida');
  assert.deepEqual(rubeus.chamadas.slice(5), ['iniciar_redacao', 'enviar_redacao', 'verificar_entrega']);
  const deNovo = await flowContext.run({ request: {}, deadline: Date.now() + 9500 }, () => E.route({ action: 'INIT', flow_token: token }));
  assert.equal(deNovo.screen, 'INSC_FIM', 'link usado de novo: avisa que a redação já foi enviada');
});

test('Etapa 1 ENEM: notas na última tela; o worker só envia o curso com as notas e conclui sem redação', async () => {
  const { e1: E, store, fila, rubeus, avisos } = montar();
  await store.create('etapa1-20386', { cursos: CURSOS, turnos: TURNOS, tema: TEMA, atualizado: Date.now(), expires: Date.now() + 1e9 }, 'flowCache');
  const quase = await etapa1(E, '20386');
  assert.equal(quase.data.eh_nota_enem, true); assert.equal(quase.data.anos_enem.length, 1);
  const id = fila[0].id;
  await E.worker(id);
  assert.equal((await store.get(id, 'inscricoesFila')).record.passo, 'curso', 'espera as notas antes de gravar o curso');
  assert.ok(!rubeus.chamadas.includes('avancar_curso_interesse'));
  const semNotas = await toque(E, 'INSC_QUASE_LA', 'enviar_informacoes_complementares', quase.data.estado, FINAL, 'ft-e1');
  assert.equal(semNotas.screen, 'INSC_QUASE_LA'); assert.match(semNotas.data.erro, /ENEM/);
  const okEnem = await toque(E, 'INSC_QUASE_LA', 'enviar_informacoes_complementares', quase.data.estado, { ...FINAL, ...ENEM }, 'ft-e1');
  assert.equal(okEnem.data.erro, undefined, okEnem.data.erro);
  SUCCESS(okEnem);
  await E.worker(id);
  const rec = (await store.get(id, 'inscricoesFila')).record;
  assert.equal(rec.status, 'concluida'); assert.equal(rec.applyment_id, '888');
  assert.equal(avisos.length, 0, 'sem redação, sem aviso da etapa 2');
});

test('Flow INSC: o worker avança no Rubeus só até onde o candidato já preencheu', async () => {
  const { e1: E, store, fila, rubeus } = montar();
  await cacheCompleto(store);
  const dados = await e1(E, 'INSC_INICIO', 'e1_iniciar', undefined, { processo_seletivo_id: '20383' });
  const curso = await e1(E, 'INSC_DADOS', 'enviar_dados_basicos', dados.data.estado, BASICOS);
  const id = fila[0].id;
  await E.worker(id);
  assert.deepEqual(rubeus.chamadas, ['selecionar_processo', 'enviar_dados_basicos']);
  const t = await e1(E, 'INSC_CURSO', 'buscar_turnos', curso.data.estado, { curso_id: 'ads' });
  await e1(E, 'INSC_CURSO', 'escolher_curso', t.data.estado, { curso_id: 'ads', turno_id: 'not' });
  await E.worker(id);
  assert.equal((await store.get(id, 'inscricoesFila')).record.passo, 'final', 'para antes da conclusão, esperando o CPF');
});

test('Flow INSC: sem cache, a tela de curso espera o worker trazer os cursos do Rubeus', async () => {
  const store = memoria();
  const rubeus = rubeusFalso();
  let E;
  const pend = [];
  E = createEtapa1({ ativo: () => false, store, enqueue: async id => { pend.push(E.worker(id)); }, runStep: rubeus.runStep, sealState, openState, render: responseForScreen, validateBasic: () => {}, validateFinal: () => {}, origens: [{ id: '01', title: 'Site' }], hoje: () => '2026-11-15', requiresEssay: id => String(id) === '20383', academicId: () => '223', userFields: USER, sleep: () => new Promise(r => setTimeout(r, 5)), log: () => {} });
  const dados = await e1(E, 'INSC_INICIO', 'e1_iniciar', undefined, { processo_seletivo_id: '20383' });
  const curso = await e1(E, 'INSC_DADOS', 'enviar_dados_basicos', dados.data.estado, BASICOS);
  assert.deepEqual(curso.data.cursos, CURSOS);
  const t = await e1(E, 'INSC_CURSO', 'buscar_turnos', curso.data.estado, { curso_id: 'dir' });
  assert.equal(t.data.turnos.length, 2);
  await Promise.all(pend);
  assert.equal(await toque(E, 'ESCOLHA_PROCESSO', 'selecionar_processo', sealState('ESCOLHA_PROCESSO', { processos_disponiveis: ['20383'] }), { processo_seletivo_id: '20383' }), null, 'Flow antigo segue igual');
});

test('Blip: sem configuração não envia; com configuração monta a campanha individual sem expor o telefone no log', async () => {
  const { avisarRedacaoLiberada, telefoneBlip } = await import('../api/blip.js');
  const logs = [];
  assert.equal(await avisarRedacaoLiberada({ celular: '99999990000', nome: 'Ana', flowToken: 't' }, { env: {}, log: e => logs.push(e) }), false);
  assert.equal(logs[0].motivo, 'nao_configurado');
  assert.equal(telefoneBlip('(99) 99999-0000'), '+5599999990000');
  let enviado;
  const ok = await avisarRedacaoLiberada({ celular: '99999990000', nome: 'Ana Clara Teste', flowToken: 'tok-123' }, {
    env: { BLIP_API_URL: 'https://contrato.http.msging.net/', BLIP_BOT_KEY: 'k', BLIP_TEMPLATE_REDACAO: 'redacao_liberada' },
    fetcher: async (url, o) => { enviado = { url, o, body: JSON.parse(o.body) }; return Response.json({ status: 'success' }); },
    log: e => logs.push(e)
  });
  assert.equal(ok, true);
  assert.equal(enviado.url, 'https://contrato.http.msging.net/commands');
  assert.equal(enviado.o.headers.Authorization, 'Key k');
  assert.equal(enviado.body.uri, '/campaign/full');
  assert.equal(enviado.body.resource.campaign.campaignType, 'Individual');
  assert.equal(enviado.body.resource.audience.recipient, '+5599999990000');
  assert.equal(enviado.body.resource.audience.contextVariables.flow_token, 'tok-123');
  assert.doesNotMatch(JSON.stringify(logs), /99999990000|tok-123/);
});

test('endpoint /api/flow/etapa1: INIT abre INSC_INICIO e nunca devolve tela do Flow antigo', async () => {
  const { e1: E, store } = montar();
  await cacheCompleto(store);
  const init = await E.endpoint({ action: 'INIT', flow_token: 'x' });
  assert.equal(init.screen, 'INSC_INICIO');
  assert.deepEqual(await E.endpoint({ action: 'ping' }), { data: { status: 'active' } });
  const antigo = await E.endpoint({ action: 'data_exchange', screen: 'ESCOLHA_PROCESSO', data: { acao: 'selecionar_processo' } });
  assert.equal(antigo.screen, 'INSC_FIM');
});

test('Realizar prova logo após concluir: abre a redação na hora; o worker inscreve e entrega sem mandar aviso', async () => {
  const { e1: E, store, fila, rubeus, avisos } = montar();
  await cacheCompleto(store);
  const quase = await etapa1(E);
  const concl = await toque(E, 'INSC_QUASE_LA', 'enviar_informacoes_complementares', quase.data.estado, FINAL, 'ft-e1');
  const red = confere('INSC_CONCLUIDA', await toque(E, 'INSC_CONCLUIDA', 'iniciar_redacao', concl.data.estado, {}, 'ft-e1'));
  assert.equal(red.screen, 'INSC_REDACAO'); assert.equal(red.data.tema_redacao, TEMA);
  assert.equal(rubeus.chamadas.length, 0);
  assert.equal(SUCCESS(await toque(E, 'INSC_REDACAO', 'enviar_redacao', red.data.estado, { texto_redacao: TEXTO }, 'ft-e1')).status, 'redacao_recebida');
  await E.worker(fila[0].id);
  const rec = (await store.get(fila[0].id, 'inscricoesFila')).record;
  assert.equal(rec.status, 'concluida');
  assert.equal(avisos.length, 0, 'já fez a prova: não recebe o aviso de prova liberada');
});
