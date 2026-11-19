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
function rubeusFalso({ finalErro = '', finalPendente = false, turnoAusente = false, execucoes = ['EX1'] } = {}) {
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
    if (a === 'conferir_prova_existente') { const ex = execucoes.length > 1 ? execucoes.shift() : execucoes[0]; return tela('TELA_ORIENTACAO_PROVA', { prepared_existing: { binding: { executionCode: ex, proofId: '1' } } }); }
    if (a === 'iniciar_redacao') return tela('TELA_REDACAO', { tema_redacao: TEMA });
    if (a === 'enviar_redacao') { assert.equal(req.data.texto_redacao, TEXTO); return tela('TELA_REDACAO', { recibo_avaliacao: { id: 1 } }); }
    if (a === 'verificar_entrega') return { screen: 'CONFIRMACAO', data: { titulo: 'Redação enviada ✅' } };
    throw new Error('inesperado ' + a);
  }
  return { chamadas, runStep };
}

function montar({ store = memoria(), rubeus = rubeusFalso(), rm = false } = {}) {
  const fila = [];
  const avisos = [], redacoes = [];
  const e1 = createEtapa1({
    store, enqueue: async (id, o) => { fila.push({ id, ...o }); },
    runStep: rubeus.runStep, sealState, openState,
    validateBasic: d => { if (!String(d.nome ?? '').includes(' ')) throw new Error('Informe nome e sobrenome.'); },
    validateFinal: d => { if (!/^\d{3}\.\d{3}\.\d{3}-\d{2}$/.test(d.cpf ?? '')) throw new Error('CPF inválido.'); if (!(d.origens ?? []).some(o => o.id === d.como_conheceu)) throw new Error('Selecione como ficou sabendo.'); },
    origens: [{ id: '01', title: 'Site oficial' }], hoje: () => '2026-11-15',
    requiresEssay: id => String(id) === '20383', academicId: () => '223', userFields: USER,
    jaInscritoNoRm: async () => rm, sleep: async () => {}, log: () => {}, esperaProvaMs: 0, estabilidadeMs: 0,
    ehEnem: id => String(id) === '20386', anosEnem: [{ id: '2025', title: '2025' }],
    validateEnem: d => { if (!/^\d{12,15}$/.test(String(d.numero_inscricao_enem ?? ''))) throw new Error('A inscrição do ENEM deve ter de 12 a 15 números.'); },
    avisar: async dados => { avisos.push(dados); return true; },
    aoConfirmarRedacao: async dados => { redacoes.push(dados); }
  });
  return { e1, store, fila, rubeus, avisos, redacoes };
}
const cacheCompleto = store => store.create('etapa1-20383', { cursos: CURSOS, turnos: TURNOS, tema: TEMA, atualizado: Date.now(), expires: Date.now() + 1e9 }, 'flowCache');

// Uma requisição do Flow passando pela rota instantânea (como no handler).
async function toque(e1, screen, acao, estado, user = {}, flow_token = 'ft-1') {
  const req = { screen, action: 'data_exchange', flow_token, data: { acao, estado, ...user } };
  return flowContext.run({ request: req, deadline: Date.now() + 9500, write: null }, () => e1.route(req));
}

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
  assert.doesNotMatch(texto, /consultar_tarefa|Verificar andamento/);
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
  assert.deepEqual(curso.data.cursos.find(c => c.id === 'ads'), { id: 'ads', title: 'ADS', description: 'Turno: Noturno' }, 'turno único na descrição do curso');
  const quase = await e1(E, 'INSC_CURSO', 'escolher_curso', curso.data.estado, { curso_id: 'ads' });
  assert.equal(quase.screen, 'INSC_QUASE_LA');
  return quase;
}
// Como no site: Obrigado pelo seu cadastro → Portal do candidato → Avaliação online → instruções.
async function ateOrientacao(concl) {
  const E = ateOrientacao.E;
  const portal = await e1(E, 'INSC_CONCLUIDA', 'abrir_portal', concl.data.estado, {}, 'ft-e1');
  assert.equal(portal.screen, 'INSC_PORTAL');
  const aval = await e1(E, 'INSC_PORTAL', 'realizar_prova', portal.data.estado, {}, 'ft-e1');
  assert.equal(aval.screen, 'INSC_AVALIACAO');
  return e1(E, 'INSC_AVALIACAO', 'iniciar_prova', aval.data.estado, {}, 'ft-e1');
}
const SUCCESS = r => { assert.equal(r.screen, 'SUCCESS'); return r.data.extension_message_response.params; };

test('Etapa 1: cada tela grava no Google; Concluir fecha o Flow na hora com dados_recebidos', async () => {
  const { e1: E, store, fila, rubeus, avisos } = montar();
  ateOrientacao.E = E;
  await cacheCompleto(store);
  const quase = await etapa1(E);
  assert.equal(quase.data.eh_nota_enem, false);
  const concl = confere('INSC_QUASE_LA', await toque(E, 'INSC_QUASE_LA', 'enviar_informacoes_complementares', quase.data.estado, FINAL, 'ft-e1'));
  assert.equal(concl.screen, 'INSC_CONCLUIDA', 'Vestibular: tela "Obrigado pelo seu cadastro!" com Realizar prova');
  const orient = await ateOrientacao(concl);
  assert.equal(orient.screen, 'INSC_ORIENTACAO', 'Portal do candidato → Avaliação online disponível → instruções');
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
  ateOrientacao.E = E;
  await cacheCompleto(store);
  const quase = await etapa1(E);
  await toque(E, 'INSC_QUASE_LA', 'enviar_informacoes_complementares', quase.data.estado, FINAL, 'ft-e1');
  const id = fila[0].id;
  await E.worker(id);
  const token = avisos[0].flowToken;
  assert.equal(await E.route({ action: 'INIT', flow_token: 'desconhecido' }), null, 'token desconhecido: o handler abre a tela inicial');
  const red = confere('INSC_REDACAO', await flowContext.run({ request: {}, deadline: Date.now() + 9500 }, () => E.route({ action: 'INIT', flow_token: token })));
  assert.equal(red.screen, 'INSC_REDACAO'); assert.equal(red.data.tema_redacao, TEMA);
  const curta = await toque(E, 'INSC_REDACAO', 'enviar_redacao', red.data.estado, { texto_redacao: 'curto' }, token);
  assert.equal(curta.screen, 'INSC_REDACAO'); assert.match(curta.data.erro, /desenvolva/);
  const fim = confere('INSC_REDACAO', await toque(E, 'INSC_REDACAO', 'enviar_redacao', red.data.estado, { texto_redacao: TEXTO }, token));
  assert.equal(fim.screen, 'INSC_FINALIZADA', 'tela "Parabéns! Você finalizou a sua prova" com Fechar');
  assert.equal(rubeus.chamadas.length, 5, 'envio da redação não esperou o Rubeus');
  await E.worker(id);
  assert.equal((await store.get(id, 'inscricoesFila')).record.status, 'concluida');
  assert.deepEqual(rubeus.chamadas.slice(5), ['conferir_prova_existente', 'conferir_prova_existente', 'iniciar_redacao', 'enviar_redacao', 'verificar_entrega']);
  const deNovo = await flowContext.run({ request: {}, deadline: Date.now() + 9500 }, () => E.route({ action: 'INIT', flow_token: token }));
  assert.equal(deNovo.screen, 'INSC_FIM', 'link usado de novo: avisa que a redação já foi enviada');
});

test('Curso com turno único: "Turno: Noturno" na descrição da opção e o Avançar segue direto; com 2 turnos abre a tela do Turno — nos 4 processos', async () => {
  for (const processo of ['20383', '20385', '20384', '20386']) {
    const { e1: E, store, fila } = montar();
    await store.create('etapa1-' + processo, { cursos: CURSOS, turnos: TURNOS, tema: TEMA, atualizado: Date.now(), expires: Date.now() + 1e9 }, 'flowCache');
    const dados = await e1(E, 'INSC_INICIO', 'e1_iniciar', undefined, { processo_seletivo_id: processo });
    const curso = await e1(E, 'INSC_DADOS', 'enviar_dados_basicos', dados.data.estado, BASICOS);
    const enem = processo === '20386';
    assert.equal(curso.screen, enem ? 'INSC_CURSO_ENEM' : 'INSC_CURSO', processo);
    assert.deepEqual(curso.data.cursos, [{ id: 'ads', title: 'ADS', description: 'Turno: Noturno' }, { id: 'dir', title: 'Direito' }], 'turno único na descrição; 2 turnos, só o curso');
    const extra = enem ? ENEM : {};
    const semCurso = await e1(E, curso.screen, 'escolher_curso', curso.data.estado, { curso_id: '', ...extra });
    assert.equal(semCurso.screen, curso.screen); assert.match(semCurso.data.erro, /curso/);
    // Turno único: o Avançar grava curso + turno e segue.
    const quase = await e1(E, curso.screen, 'escolher_curso', curso.data.estado, { curso_id: 'ads', ...extra });
    assert.equal(quase.screen, 'INSC_QUASE_LA', processo + ': Avançar segue direto');
    assert.equal(quase.data.eh_nota_enem, enem);
    const r = (await store.get(fila[0].id, 'inscricoesFila')).record.respostas;
    assert.equal(r.curso_id, 'ads'); assert.equal(r.turno_id, 'not', 'turno único gravado');
    // Dois turnos: tela própria do turno.
    const turno = await e1(E, curso.screen, 'escolher_curso', curso.data.estado, { curso_id: 'dir', ...extra });
    assert.equal(turno.screen, 'INSC_TURNO'); assert.equal(turno.data.curso_nome, 'Direito'); assert.equal(turno.data.turnos.length, 2);
    const semTurno = await e1(E, 'INSC_TURNO', 'escolher_turno', turno.data.estado, { turno_id: '' });
    assert.equal(semTurno.screen, 'INSC_TURNO'); assert.match(semTurno.data.erro, /turno/);
    const quase2 = await e1(E, 'INSC_TURNO', 'escolher_turno', turno.data.estado, { turno_id: 'mat' });
    assert.equal(quase2.screen, 'INSC_QUASE_LA');
  }
  const json = JSON.stringify(FLOW_E1.screens.filter(x => /^INSC_(CURSO|TURNO)/.test(x.id)));
  assert.doesNotMatch(json, /on-select-action/, 'listas sem ação ao selecionar');
  assert.doesNotMatch(json, /"type":"If"/, 'sem If nas telas de curso e turno (WhatsApp Web)');
  assert.deepEqual(FLOW_E1.routing_model.INSC_CURSO, ['INSC_TURNO', 'INSC_QUASE_LA', 'INSC_FIM']);
  assert.deepEqual(FLOW_E1.routing_model.INSC_TURNO, ['INSC_QUASE_LA', 'INSC_FIM']);
  // WhatsApp Web: lista dinâmica sem valor inicial (igual à lista do processo, que funciona).
  for (const id of ['INSC_CURSO', 'INSC_CURSO_ENEM', 'INSC_TURNO']) {
    const form = FLOW_E1.screens.find(x => x.id === id).layout.children[0];
    for (const k of ['curso_id', 'turno_id', 'ano_enem']) assert.ok(!(k in (form['init-values'] ?? {})), id + ': sem valor inicial em ' + k);
  }
});

test('WhatsApp Web: nenhuma lista com opções do servidor tem valor inicial (em todo o Flow)', () => {
  const walk = (c, o = []) => { for (const x of c ?? []) { o.push(x); walk(x.children, o); walk(x.then, o); walk(x.else, o); } return o; };
  const achados = [];
  for (const s of FLOW_E1.screens) for (const fm of walk(s.layout.children).filter(c => c.type === 'Form')) {
    const iv = fm['init-values'] ?? {};
    for (const c of walk(fm.children)) if (typeof c['data-source'] === 'string' && c.name in iv) achados.push(s.id + '.' + c.name);
  }
  assert.deepEqual(achados, []);
});

test('Curso com nome maior que 30 caracteres: título cortado (limite da Meta) e nome inteiro na descrição', async () => {
  const { e1: E, store } = montar();
  const longo = 'TECNOLOGIA EM ANÁLISE E DESENVOLVIMENTO DE SISTEMAS';
  await store.create('etapa1-20385', { cursos: [{ id: 'ads', title: longo }], turnos: { ads: [{ id: 'not', title: 'NOTURNO' }] }, tema: TEMA, atualizado: Date.now(), expires: Date.now() + 1e9 }, 'flowCache');
  const dados = await e1(E, 'INSC_INICIO', 'e1_iniciar', undefined, { processo_seletivo_id: '20385' });
  const curso = await e1(E, 'INSC_DADOS', 'enviar_dados_basicos', dados.data.estado, BASICOS);
  const op = curso.data.cursos[0];
  assert.ok(op.title.length <= 30, op.title); assert.ok(op.title.endsWith('…'));
  assert.equal(op.description, longo + ' · Turno: Noturno');
  const quase = await e1(E, 'INSC_CURSO', 'escolher_curso', curso.data.estado, { curso_id: 'ads' });
  assert.equal(quase.screen, 'INSC_QUASE_LA');
});

test('Etapa 1 ENEM: notas na tela do curso (igual ao site); o worker envia o curso com as notas e conclui sem redação', async () => {
  const { e1: E, store, fila, rubeus, avisos } = montar();
  await store.create('etapa1-20386', { cursos: CURSOS, turnos: TURNOS, tema: TEMA, atualizado: Date.now(), expires: Date.now() + 1e9 }, 'flowCache');
  const dados = await e1(E, 'INSC_INICIO', 'e1_iniciar', undefined, { processo_seletivo_id: '20386' });
  const curso = await e1(E, 'INSC_DADOS', 'enviar_dados_basicos', dados.data.estado, BASICOS);
  assert.equal(curso.screen, 'INSC_CURSO_ENEM'); assert.equal(curso.data.anos_enem.length, 1);
  const id = fila[0].id;
  // Nota inválida: fica na tela do curso, com o que já foi digitado.
  const semNotas = await e1(E, 'INSC_CURSO_ENEM', 'escolher_curso', curso.data.estado, { curso_id: 'ads', numero_inscricao_enem: '123' });
  assert.equal(semNotas.screen, 'INSC_CURSO_ENEM'); assert.match(semNotas.data.erro, /ENEM/); assert.equal(semNotas.data.valor_numero_inscricao_enem, '123');
  await E.worker(id);
  assert.equal((await store.get(id, 'inscricoesFila')).record.passo, 'turnos', 'espera curso, turno e notas');
  assert.ok(!rubeus.chamadas.includes('avancar_curso_interesse'));
  const quase = await e1(E, 'INSC_CURSO_ENEM', 'escolher_curso', curso.data.estado, { curso_id: 'ads', ...ENEM });
  assert.equal(quase.screen, 'INSC_QUASE_LA'); assert.equal(quase.data.eh_nota_enem, true);
  assert.equal((await store.get(id, 'inscricoesFila')).record.respostas.numero_inscricao_enem, ENEM.numero_inscricao_enem, 'notas guardadas com o curso');
  const okEnem = await toque(E, 'INSC_QUASE_LA', 'enviar_informacoes_complementares', quase.data.estado, FINAL, 'ft-e1');
  SUCCESS(okEnem);
  await E.worker(id);
  const rec = (await store.get(id, 'inscricoesFila')).record;
  assert.equal(rec.status, 'concluida'); assert.equal(rec.applyment_id, '888');
  assert.equal(avisos.length, 0, 'sem redação, sem aviso da etapa 2');
});

test('Flow INSC: o worker avança no Rubeus só até onde o candidato já preencheu', async () => {
  const { e1: E, store, fila, rubeus } = montar();
  ateOrientacao.E = E;
  await cacheCompleto(store);
  const dados = await e1(E, 'INSC_INICIO', 'e1_iniciar', undefined, { processo_seletivo_id: '20383' });
  const curso = await e1(E, 'INSC_DADOS', 'enviar_dados_basicos', dados.data.estado, BASICOS);
  const id = fila[0].id;
  await E.worker(id);
  assert.deepEqual(rubeus.chamadas, ['selecionar_processo', 'enviar_dados_basicos']);
  await e1(E, 'INSC_CURSO', 'escolher_curso', curso.data.estado, { curso_id: 'ads' });
  await E.worker(id);
  assert.equal((await store.get(id, 'inscricoesFila')).record.passo, 'final', 'para antes da conclusão, esperando o CPF');
});

test('Flow INSC: sem cache, a tela de curso espera o worker trazer os cursos do Rubeus', async () => {
  const store = memoria();
  const rubeus = rubeusFalso();
  let E;
  const pend = [];
  E = createEtapa1({ store, enqueue: async id => { pend.push(E.worker(id)); }, runStep: rubeus.runStep, sealState, openState, validateBasic: () => {}, validateFinal: () => {}, origens: [{ id: '01', title: 'Site' }], hoje: () => '2026-11-15', requiresEssay: id => String(id) === '20383', academicId: () => '223', userFields: USER, sleep: () => new Promise(r => setTimeout(r, 5)), log: () => {} });
  const dados = await e1(E, 'INSC_INICIO', 'e1_iniciar', undefined, { processo_seletivo_id: '20383' });
  const curso = await e1(E, 'INSC_DADOS', 'enviar_dados_basicos', dados.data.estado, BASICOS);
  assert.deepEqual(curso.data.cursos.map(c => c.id), CURSOS.map(c => c.id));
  const t = await e1(E, 'INSC_CURSO', 'escolher_curso', curso.data.estado, { curso_id: 'dir' });
  assert.equal(t.screen, 'INSC_TURNO'); assert.equal(t.data.turnos.length, 2);
  await Promise.all(pend);
  assert.equal(await toque(E, 'ESCOLHA_PROCESSO', 'selecionar_processo', sealState('ESCOLHA_PROCESSO', { processos_disponiveis: ['20383'] }), { processo_seletivo_id: '20383' }), null, 'tela que não é INSC_* não é da etapa 1');
});

test('Blip: sem configuração não envia; com configuração monta a campanha individual sem expor o telefone no log', async () => {
  const { avisarRedacaoLiberada, telefoneBlip } = await import('../api/blip.js');
  const logs = [];
  assert.equal(await avisarRedacaoLiberada({ celular: '99999990000', nome: 'Ana', flowToken: 't' }, { env: {}, log: e => logs.push(e) }), false);
  assert.equal(logs[0].motivo, 'nao_configurado');
  assert.equal(telefoneBlip('(99) 99999-0000'), '5599999990000');
  let enviado;
  const ok = await avisarRedacaoLiberada({ celular: '99999990000', nome: 'Ana Clara Teste', flowToken: 'tok-123' }, {
    env: { BLIP_API_URL: 'https://contrato.http.msging.net/', BLIP_BOT_KEY: 'k' },
    fetcher: async (url, o) => { enviado = { url, o, body: JSON.parse(o.body) }; return Response.json({ status: 'success' }); },
    log: e => logs.push(e)
  });
  assert.equal(ok, true);
  assert.equal(enviado.url, 'https://contrato.http.msging.net/commands');
  assert.equal(enviado.o.headers.Authorization, 'Key k');
  assert.equal(enviado.body.uri, '/campaign/full');
  assert.equal(enviado.body.resource.campaign.campaignType, 'Individual');
  assert.equal(enviado.body.resource.audience.recipient, '5599999990000');
  assert.equal(enviado.body.resource.audience.contextVariables.flow_token, 'tok-123');
  assert.equal(enviado.body.resource.message.messageTemplate, 'unibalsas_atualizacao_processo');
  assert.deepEqual(enviado.body.resource.message.messageParams, ['nome', 'processo', 'situacao', 'proximo']);
  assert.equal(enviado.body.resource.audience.messageParams.nome, 'Ana');
  assert.match(enviado.body.resource.audience.messageParams.situacao, /redação já está liberada/);
  assert.doesNotMatch(JSON.stringify(logs), /99999990000|tok-123/);
});

test('Realizar prova logo após concluir: abre a redação na hora; o worker inscreve e entrega sem mandar aviso', async () => {
  const { e1: E, store, fila, rubeus, avisos } = montar();
  ateOrientacao.E = E;
  await cacheCompleto(store);
  const quase = await etapa1(E);
  const concl = await toque(E, 'INSC_QUASE_LA', 'enviar_informacoes_complementares', quase.data.estado, FINAL, 'ft-e1');
  const orient = await ateOrientacao(concl);
  const red = confere('INSC_ORIENTACAO', await toque(E, 'INSC_ORIENTACAO', 'iniciar_redacao', orient.data.estado, {}, 'ft-e1'));
  assert.equal(red.screen, 'INSC_REDACAO'); assert.equal(red.data.tema_redacao, TEMA);
  assert.equal(rubeus.chamadas.length, 0);
  assert.equal((await toque(E, 'INSC_REDACAO', 'enviar_redacao', red.data.estado, { texto_redacao: TEXTO }, 'ft-e1')).screen, 'INSC_FINALIZADA');
  await E.worker(fila[0].id);
  const rec = (await store.get(fila[0].id, 'inscricoesFila')).record;
  assert.equal(rec.status, 'concluida');
  assert.equal(avisos.length, 0, 'já fez a prova: não recebe o aviso de prova liberada');
});

test('Mesmo flow_token (prévia da WABA ou mensagem reaberta): cada Iniciar inscrição é uma inscrição nova', async () => {
  const { e1: E, store, fila } = montar();
  ateOrientacao.E = E;
  await cacheCompleto(store);
  const a = await e1(E, 'INSC_INICIO', 'e1_iniciar', undefined, { processo_seletivo_id: '20383' }, 'mesmo');
  await e1(E, 'INSC_DADOS', 'enviar_dados_basicos', a.data.estado, BASICOS, 'mesmo');
  const b = await e1(E, 'INSC_INICIO', 'e1_iniciar', undefined, { processo_seletivo_id: '20383' }, 'mesmo');
  await e1(E, 'INSC_DADOS', 'enviar_dados_basicos', b.data.estado, { ...BASICOS, nome: 'Bruno Lima Teste' }, 'mesmo');
  const ids = [...new Set(fila.map(f => f.id))];
  assert.equal(ids.length, 2);
  assert.equal((await store.get(ids[0], 'inscricoesFila')).record.respostas.nome, BASICOS.nome, 'a primeira não é sobrescrita');
});

test('Redação com calma: espera a prova da inscrição ficar estável antes de enviar', async () => {
  const rubeus = rubeusFalso({ execucoes: ['PROVISORIA', 'DEFINITIVA', 'DEFINITIVA', 'DEFINITIVA'] });
  const store = memoria();
  const fila = [];
  let agora = Date.now();
  const E = createEtapa1({ store, enqueue: async (id, o) => fila.push({ id, ...o }), runStep: rubeus.runStep, sealState, openState,
    validateBasic: () => {}, validateFinal: () => {}, origens: [{ id: '01', title: 'Site' }], hoje: () => '2026-11-15', requiresEssay: id => String(id) === '20383', academicId: () => '223', userFields: USER,
    sleep: async () => {}, log: () => {}, clock: () => agora, esperaProvaMs: 600000, estabilidadeMs: 60000 });
  await cacheCompleto(store);
  ateOrientacao.E = E;
  const quase = await etapa1(E);
  await toque(E, 'INSC_QUASE_LA', 'enviar_informacoes_complementares', quase.data.estado, FINAL, 'ft-e1');
  const id = fila[0].id;
  await E.worker(id);
  const red = await (async () => { const concl = await toque(E, 'INSC_QUASE_LA', 'enviar_informacoes_complementares', quase.data.estado, FINAL, 'ft-e1'); const o = await ateOrientacao(concl); return toque(E, 'INSC_ORIENTACAO', 'iniciar_redacao', o.data.estado, {}, 'ft-e1'); })();
  await toque(E, 'INSC_REDACAO', 'enviar_redacao', red.data.estado, { texto_redacao: TEXTO }, 'ft-e1');
  await E.worker(id);
  assert.ok(!rubeus.chamadas.includes('enviar_redacao'), 'não envia antes da prova assentar (10 min após a inscrição)');
  assert.ok(fila.at(-1).atrasoSeg > 0, 'reagenda para depois da espera');
  agora += 600001;
  await E.worker(id);
  assert.ok(!rubeus.chamadas.includes('enviar_redacao'), 'execução mudou entre as duas leituras: espera de novo');
  agora += 600001;
  await E.worker(id);
  assert.equal((await store.get(id, 'inscricoesFila')).record.status, 'concluida');
  assert.equal(rubeus.chamadas.filter(a => a === 'enviar_redacao').length, 1);
});

// Worker da etapa 1 pelas telas INSC_* (o mesmo envio ao Rubeus para os 4 processos).
async function concluirInsc(E, flow = 'ft-e1') {
  ateOrientacao.E = E;
  const quase = await etapa1(E);
  return toque(E, 'INSC_QUASE_LA', 'enviar_informacoes_complementares', quase.data.estado, FINAL, flow);
}
test('CPF já inscrito (RM ou outra sessão) mostra a mensagem do site', async () => {
  const a = montar({ rm: true });
  await cacheCompleto(a.store);
  const r1 = await concluirInsc(a.e1);
  assert.equal(r1.screen, 'INSC_QUASE_LA'); assert.equal(r1.data.erro, DUPLICADA_MSG);
  const b = montar();
  await cacheCompleto(b.store);
  assert.equal((await concluirInsc(b.e1)).screen, 'INSC_CONCLUIDA');
  const r3 = await concluirInsc(b.e1, 'ft-outra');
  assert.equal(r3.data.erro, DUPLICADA_MSG, 'mesmo CPF em outra sessão');
});

test('Rubeus acusa inscrição existente no envio: fica marcada como duplicada, sem nova tentativa', async () => {
  const { e1: E, store, fila } = montar({ rubeus: rubeusFalso({ finalErro: 'Você já possui inscrição neste processo seletivo.' }) });
  await cacheCompleto(store);
  await concluirInsc(E);
  const id = fila[0].id, antes = fila.length;
  await E.worker(id);
  assert.equal((await store.get(id, 'inscricoesFila')).record.status, 'duplicada');
  assert.equal(fila.length, antes, 'não reagenda');
});

test('resultado incerto na conclusão: vai para conferência e nunca reenvia', async () => {
  const rubeus = rubeusFalso({ finalPendente: true });
  const { e1: E, store, fila } = montar({ rubeus });
  await cacheCompleto(store);
  await concluirInsc(E);
  await E.worker(fila[0].id);
  await E.worker(fila[0].id);
  assert.equal((await store.get(fila[0].id, 'inscricoesFila')).record.status, 'conferir');
  assert.equal(rubeus.chamadas.filter(a => a === 'enviar_informacoes_complementares').length, 1);
});

test('falha passageira antes da conclusão: reagenda e recomeça numa sessão nova', async () => {
  const rubeus = rubeusFalso({ turnoAusente: true });
  const { e1: E, store, fila } = montar({ rubeus });
  await cacheCompleto(store);
  await concluirInsc(E);
  const antes = fila.length;
  await E.worker(fila[0].id);
  const rec = (await store.get(fila[0].id, 'inscricoesFila')).record;
  assert.equal(rec.status, 'pendente'); assert.equal(rec.passo, 'inicio'); assert.equal(rec.tentativas, 1);
  assert.equal(fila.length, antes + 1); assert.ok(fila.at(-1).atrasoSeg > 0);
  assert.ok(!rubeus.chamadas.includes('enviar_informacoes_complementares'));
});
