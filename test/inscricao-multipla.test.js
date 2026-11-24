// Mais de uma inscrição no mesmo CPF (2.17.8): o portal abre numa delas. Cada worker entra na inscrição dele
// (troca como o seletor "Processos abertos" do site), a inscrição nova avisa quando já existe outra e o LOGIN
// pergunta qual acompanhar. Com uma inscrição só, nada muda.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import crypto from 'node:crypto';

process.env.FLOW_PRIVATE_KEY = 'unit-multipla';
process.env.FLOW_PROJECT_ID = 'unit';
process.env.RBS_TOKEN = 'unit';
// As telas novas ligam depois de o JSON estar na Meta (TELAS_INSCRICAO_MULTIPLA=on); o conserto dos workers vale sempre.
process.env.TELAS_INSCRICAO_MULTIPLA = 'on';
const { sealState, openState, flowContext } = await import('../api/flow.js');
const { createEtapa1 } = await import('../api/etapa1-fila.js');
const { createEtapa2 } = await import('../api/etapa2-matricula.js');
const { validCpf } = await import('../api/matricula.js');
const { docsInscricao, tituloProcesso } = await import('../api/processes.js');
const { createPortalSite, tituloInscricao } = await import('../api/portal-site.js');

const FLOW = JSON.parse(readFileSync(new URL('../flows/etapa1-vestibular.json', import.meta.url), 'utf8'));
const hash = v => crypto.createHash('sha256').update(String(v)).digest('hex');
const CURSOS = [{ id: '1-20', title: 'DIREITO' }];
const TURNOS = { '1-20': [{ id: '6', title: 'NOTURNO' }] };
const USER = new Set(['nome', 'email', 'data_nascimento', 'celular', 'genero', 'aceite_privacidade', 'possui_nome_social', 'nome_social', 'curso_id', 'turno_id', 'cpf', 'nacionalidade', 'concluiu_ensino_medio', 'possui_deficiencia', 'tipos_deficiencia', 'deficiencia_outra', 'como_conheceu', 'como_conheceu_outro', 'processo_seletivo_id']);
const NASC = '1990-02-03';
const BASICOS = { nome: 'Manuela Valentina Teste', email: 'manuela@example.com', data_nascimento: NASC, celular: '(68) 99996-6749', genero: 'F', aceite_privacidade: true, possui_nome_social: false };
const FINAL = { cpf: '391.847.205-14', nacionalidade: '10', concluiu_ensino_medio: 'Sim', possui_deficiencia: 'F', como_conheceu: '01' };
const MIDIA = n => [{ file_name: `doc-${n}.pdf`, media_id: 'm' + n, cdn_url: 'https://cdn.example/' + n, encryption_metadata: { encryption_key: 'k' } }];
// Inscrições da pessoa no portal (person-applyment), já no formato de portalSite.inscricoes.
const VESTIBULAR = { applyment_id: '777', processo: '20383', titulo: 'Vestibular Online - Cursos presenciais - 2027/1 - PRODUÇÃO PUBLICITÁRIA', curso: 'PRODUÇÃO PUBLICITÁRIA', atual: true };
const TRANSFERENCIA = { applyment_id: '901', processo: '20385', titulo: 'Transferência - 2027/1 - AGRONOMIA', curso: 'AGRONOMIA', atual: false };

function memoria() {
  const db = new Map(); let v = 0; const k = (c, id) => c + '/' + id;
  return {
    db,
    async get(id, c = 'x') { const x = db.get(k(c, id)); return x ? { record: structuredClone(x.record), version: x.version } : null; },
    async create(id, record, c = 'x') { if (db.has(k(c, id))) return false; db.set(k(c, id), { record: structuredClone(record), version: 'v' + (++v) }); return true; },
    async update(id, record, version, c = 'x') { const x = db.get(k(c, id)); if (!x || x.version !== version) return false; db.set(k(c, id), { record: structuredClone(record), version: 'v' + (++v) }); return true; }
  };
}

function rubeusInscricao(applyment = '901') {
  const tela = (screen, data) => ({ screen, data: { estado: sealState(screen, data) } });
  return async req => {
    const a = req.data.acao;
    if (a === 'selecionar_processo') return tela('DADOS_BASICOS', {});
    if (a === 'enviar_dados_basicos') return tela('CURSO_INGRESSO', { cursos: CURSOS, turnos: [] });
    if (a === 'buscar_turnos') return tela('CURSO_INGRESSO', { cursos: CURSOS, turnos: TURNOS[req.data.curso_id] });
    if (a === 'avancar_curso_ingresso' || a === 'avancar_curso_interesse') return tela('QUASE_LA', {});
    if (a === 'enviar_informacoes_complementares') return tela('ACOMPANHAMENTO', { applyment_id: applyment });
    throw new Error('inesperado ' + a);
  };
}

// Portal do candidato: abre na inscrição "atual" (a do Vestibular); com applyment_id, entra na pedida.
function portalFalso({ lista = [VESTIBULAR, TRANSFERENCIA], lento = false } = {}) {
  const estado = { entradas: [], lotes: [], status: {}, atual: (lista.find(a => a.atual) ?? lista[0])?.applyment_id ?? '' };
  const processoDe = id => lista.find(a => a.applyment_id === id)?.processo ?? '20383';
  const portalSite = {
    async entrar(cpf, nasc, opts = {}) {
      assert.equal(cpf, '39184720514'); assert.equal(nasc, NASC);
      estado.entradas.push(opts.applyment_id ?? '');
      const aberta = opts.applyment_id || estado.atual;
      return { token: 't', session_id: 's', applyment_id: aberta };
    },
    async inscricoes() { if (lento) await new Promise(() => {}); return lista.map(a => ({ ...a })); },
    async inscricao(s) {
      const processo = processoDe(s.applyment_id);
      // Vestibular: sem "Documentos inscrição" (é o caso da Manuela: o worker da Transferência via estas etapas).
      if (processo === '20383') return { processo, stages: [{ title: 'Inscrição', feedback: { complementary_text: 'Concluída', conclusive: 1 } }, { title: 'Prova online', feedback: { complementary_text: 'Aprovado', conclusive: 1 } }] };
      return { processo, stages: [{ title: 'Inscrição', feedback: { complementary_text: 'Concluída', conclusive: 1 } }, { title: 'Documentos inscrição', feedback: { complementary_text: 'Pendentes', conclusive: 0, cta_text: 'Verificar' }, cta_link: 'presencial/passo/300696' }] };
    },
    async passoDocumentos(_s, passo, proc) {
      assert.equal(passo, 300696); assert.equal(proc, '20385');
      return { passo: 300696, stage_id: 1, componente: 2, campo: 3, botao: 4, botao_relacionado: 5, max_mb: 5,
        docs: docsInscricao('20385').map(d => ({ codigo: d.codigo, titulo: d.titulo, obrigatorio: d.obrigatorio, chaverm: null, status: estado.status[d.codigo] ?? null, path: null })) };
    },
    async enviarDocumentos({ processo, arquivos }) { estado.lotes.push({ processo, codigos: arquivos.map(a => a.codigo) }); for (const a of arquivos) estado.status[a.codigo] = '1'; return { success: true }; },
    async pagina() { return { data: { page: { applicantData: [] } } }; }
  };
  return { portalSite, estado };
}

// Rubeus oficial (LOGIN e worker da matrícula): o login abre na inscrição atual; o /portal recebe o applyment_id.
function matriculaFalsa(portal, { ignoraApplyment = false } = {}) {
  const chamadas = [];
  return {
    chamadas,
    async login(cpf, nasc) { assert.equal(cpf, '39184720514'); assert.equal(nasc, NASC); return { token: 'tok', applyment_id: portal.estado.atual, person_id: '1' }; },
    async portal(s) {
      chamadas.push(s.applyment_id);
      const p = await portal.portalSite.inscricao({ applyment_id: ignoraApplyment ? portal.estado.atual : s.applyment_id });
      return { token: 'tok2', processo_seletivo_id: p.processo, stages: p.stages };
    }
  };
}

function montar(opcoes = {}) {
  const store = memoria();
  const fila = [];
  const portal = portalFalso(opcoes);
  const matricula = matriculaFalsa(portal, opcoes);
  const logs = [];
  const ref = {};
  const e1 = createEtapa1({
    store, enqueue: async (id, o) => { fila.push({ id, ...o }); },
    runStep: rubeusInscricao(), sealState, openState,
    validateBasic: () => {}, validateFinal: d => { if (!(d.origens ?? []).some(o => o.id === d.como_conheceu)) throw new Error('Selecione como ficou sabendo.'); },
    origens: [{ id: '01', title: 'Site oficial' }], hoje: () => '2026-11-24',
    requiresEssay: id => String(id) === '20383', academicId: () => '225', userFields: USER,
    sleep: async () => {}, log: e => logs.push(e), esperaProvaMs: 0, estabilidadeMs: 0,
    docsInscricao, portalSite: portal.portalSite, baixarMidia: async m => Buffer.from('%PDF ' + m.media_id), esperaDocsInscricaoMs: 0,
    aoEnviarDocsInscricao: dados => ref.e2.iniciarVigiaInscricao(dados),
    tituloProcesso, abrirLogin: a => ref.e2.abrirLogin(a), esperaInscricoesMs: opcoes.esperaInscricoesMs ?? 3500
  });
  const e2 = createEtapa2({
    store, enqueue: async (id, o) => fila.push({ id, ...o }), sealState, openState, validCpf, log: e => logs.push(e),
    matricula, portalSite: portal.portalSite, tituloProcesso, listaInscricoesMs: opcoes.listaInscricoesMs ?? 3500,
    entrarNosDocsInscricao: a => e1.entrarNosDocsInscricao(a), entrarNaProva: a => e1.entrarNaProva(a)
  });
  ref.e2 = e2;
  return { e1, e2, store, fila, portal, matricula, logs };
}
async function cache(store, processo) { await store.create('etapa1-' + processo, { cursos: CURSOS, turnos: TURNOS, atualizado: Date.now(), expires: Date.now() + 1e9 }, 'flowCache'); }

function confere(origem, r) {
  if (r.screen === 'SUCCESS') return r;
  const tela = FLOW.screens.find(s => s.id === r.screen);
  assert.ok(tela, 'tela existe: ' + r.screen);
  assert.ok(origem === r.screen || FLOW.routing_model[origem].includes(r.screen), `${origem} → ${r.screen}`);
  assert.deepEqual(Object.keys(r.data).sort(), Object.keys(tela.data ?? {}).sort(), 'chaves de ' + r.screen);
  for (const [k, v] of Object.entries(r.data)) assert.equal(Array.isArray(v) ? 'array' : typeof v, tela.data[k].type, `${r.screen}.${k}`);
  for (const o of r.data.opcoes ?? []) { assert.ok(o.title.length <= 30, 'título até 30: ' + o.title); assert.deepEqual(Object.keys(o).sort(), ['description', 'id', 'title']); }
  return r;
}
async function toque(M, screen, acao, estado, user = {}, ft = 'ft-m') {
  const req = { screen, action: 'data_exchange', flow_token: ft, data: { acao, ...(estado ? { estado } : {}), ...user } };
  const r = await flowContext.run({ request: req, deadline: Date.now() + 9500, write: null }, async () => (await M.e2.route(req)) ?? (await M.e1.route(req)));
  return confere(screen, r);
}
// Inscrição até o "Concluir" da Estamos quase lá.
async function ateConcluir(M, processo = '20385') {
  const dados = await toque(M, 'INSC_INICIO', 'e1_iniciar', undefined, { processo_seletivo_id: processo });
  const curso = await toque(M, 'INSC_DADOS', 'enviar_dados_basicos', dados.data.estado, BASICOS);
  const quase = await toque(M, curso.screen, 'escolher_curso', curso.data.estado, { curso_id: 'direito' });
  return toque(M, 'INSC_QUASE_LA', 'enviar_informacoes_complementares', quase.data.estado, FINAL);
}

// ---------------------------------------------------------------- portal (api/portal-site.js)
function fetchFalso({ confirma = true } = {}) {
  const pedidos = [];
  let atual = 777;
  const ok = data => new Response(JSON.stringify({ success: true, data }), { status: 200 });
  const fetcher = async (url, init) => {
    const rota = String(url).split('/api/applyment/')[1];
    const corpo = JSON.parse(init.body);
    pedidos.push({ rota, corpo });
    if (rota === 'settings') return ok({ token: 'tk' });
    if (rota === 'login-portal') return ok({ applyment_id: 777, person_id: 1, session_id: 's' });
    if (rota === 'change-current-applyment') { if (confirma) atual = corpo.applyment_id; return ok({ stages: [] }); }
    if (rota === 'person-applyment') return ok([
      { id: 20383, name: 'Vestibular Online - Cursos presenciais - 2027/1', title: null, course: 'PRODUÇÃO PUBLICITÁRIA', applyment_id: 777, current_process: atual === 777 ? 1 : 0 },
      { id: 20385, name: 'Transferência - 2027/1', title: null, course: 'AGRONOMIA - NOTURNO-', applyment_id: 901, current_process: atual === 901 ? 1 : 0 }
    ]);
    throw new Error('rota inesperada ' + rota);
  };
  return { fetcher, pedidos };
}

test('Portal: sem applyment_id (ou já na inscrição pedida) o login é o de sempre; com outra, troca como o seletor do site e confere', async () => {
  let f = fetchFalso();
  let site = createPortalSite({ fetcher: f.fetcher, log: () => {} });
  assert.equal((await site.entrar('391.847.205-14', NASC)).applyment_id, '777');
  assert.equal((await site.entrar('391.847.205-14', NASC, { applyment_id: '777' })).applyment_id, '777');
  assert.deepEqual(f.pedidos.map(p => p.rota), ['settings', 'login-portal', 'settings', 'login-portal'], 'nenhuma troca quando não precisa');

  f = fetchFalso();
  site = createPortalSite({ fetcher: f.fetcher, log: () => {} });
  const s = await site.entrar('391.847.205-14', NASC, { applyment_id: '901' });
  assert.equal(s.applyment_id, '901');
  assert.deepEqual(f.pedidos.map(p => p.rota), ['settings', 'login-portal', 'change-current-applyment', 'person-applyment']);
  assert.deepEqual(f.pedidos[2].corpo, { applyment_id: 901, token: 'tk' }, 'mesmo corpo do site');

  // O portal não trocou: erro (o worker tenta de novo), nunca segue na inscrição errada.
  f = fetchFalso({ confirma: false });
  site = createPortalSite({ fetcher: f.fetcher, log: () => {} });
  await assert.rejects(site.entrar('391.847.205-14', NASC, { applyment_id: '901' }), /não abriu a inscrição pedida/);
});

test('Portal: lista de inscrições com o rótulo do site (title, ou "processo - curso")', async () => {
  const f = fetchFalso();
  const site = createPortalSite({ fetcher: f.fetcher, log: () => {} });
  const lista = await site.inscricoes(await site.entrar('391.847.205-14', NASC));
  assert.deepEqual(lista.map(a => [a.applyment_id, a.processo, a.atual]), [['777', '20383', true], ['901', '20385', false]]);
  assert.equal(lista[0].titulo, 'Vestibular Online - Cursos presenciais - 2027/1 - PRODUÇÃO PUBLICITÁRIA');
  assert.equal(tituloInscricao({ title: 'Título próprio', name: 'X', course: 'Y' }), 'Título próprio');
  assert.equal(tituloInscricao({ name: 'Transferência - 2027/1' }), 'Transferência - 2027/1');
});

// ---------------------------------------------------------------- caso da Manuela (worker de documentos)
test('Caso Manuela: com o Vestibular aberto no portal, o worker da Transferência entra na inscrição dela e entrega os documentos', async () => {
  const M = montar();
  await cache(M.store, '20385');
  const aviso = await ateConcluir(M);
  assert.equal(aviso.screen, 'INSC_JA_INSCRITO');
  const concl = await toque(M, 'INSC_JA_INSCRITO', 'decidir_inscricao', aviso.data.estado, { inscricao: 'nova' });
  assert.equal(concl.screen, 'INSC_CONCLUIDA');
  const status = await toque(M, 'INSC_CONCLUIDA', 'abrir_portal', concl.data.estado);
  const a = await toque(M, 'INSC_STATUS', 'verificar_documentos', status.data.estado);
  const b = await toque(M, 'INSC_DOC_A', 'enviar_documento_inscricao', a.data.estado, { arquivo: MIDIA(28) });
  const c = await toque(M, 'INSC_DOC_B', 'enviar_documento_inscricao', b.data.estado, { arquivo: [] });
  await toque(M, 'INSC_DOC_C', 'enviar_documento_inscricao', c.data.estado, { arquivo: [] });
  const id = M.fila[0].id;
  await M.e1.worker(id);
  const rec = (await M.store.get(id, 'inscricoesFila')).record;
  assert.equal(rec.status, 'concluida', 'documentos entregues (antes: "Documentos inscrição ainda não apareceu" em loop)');
  assert.deepEqual(M.portal.estado.lotes, [{ processo: '20385', codigos: ['28'] }]);
  assert.ok(M.portal.estado.entradas.includes('901'), 'entrou no portal pedindo a inscrição da Transferência');
});

// ---------------------------------------------------------------- aviso na inscrição nova
test('Aviso: CPF com Vestibular no portal → "já possui inscrição", com o nome, o processo e o curso', async () => {
  const M = montar({ lista: [VESTIBULAR] });
  await cache(M.store, '20385');
  const r = await ateConcluir(M);
  assert.equal(r.screen, 'INSC_JA_INSCRITO');
  assert.match(r.data.mensagem, /^Olá, Manuela! Identificamos que você já possui uma inscrição em Vestibular Online 2027\/1, no curso PRODUÇÃO PUBLICITÁRIA\./);
  assert.match(r.data.mensagem, /realmente quer fazer uma nova inscrição em Transferência 2027\/1\?/);
  assert.deepEqual(r.data.opcoes.map(o => o.id), ['seguir_0', 'nova']);
  assert.equal(r.data.opcoes[1].description, 'Transferência 2027/1 · DIREITO');
  const rec = (await M.store.get(M.fila[0].id, 'inscricoesFila')).record;
  assert.equal(rec.concluida_em, undefined, 'nada concluído antes da resposta');
  assert.equal(r.data.mensagem.includes('391'), false, 'sem CPF na tela');
  // Sem escolha válida: fica na mesma tela.
  const nada = await toque(M, 'INSC_JA_INSCRITO', 'decidir_inscricao', r.data.estado, { inscricao: 'outra' });
  assert.equal(nada.screen, 'INSC_JA_INSCRITO'); assert.match(nada.data.erro, /Escolha uma das opções/);
});

test('Aviso: "Seguir com a inscrição atual" não cria a nova e abre a existente pelo LOGIN', async () => {
  const M = montar({ lista: [VESTIBULAR] });
  await cache(M.store, '20385');
  const r = await ateConcluir(M);
  const fim = await toque(M, 'INSC_JA_INSCRITO', 'decidir_inscricao', r.data.estado, { inscricao: 'seguir_0' });
  assert.ok(['MATR_PORTAL', 'MATR_STATUS', 'INSC_PORTAL', 'MATR_FIM'].includes(fim.screen), fim.screen);
  assert.deepEqual(M.matricula.chamadas, ['777'], 'status da inscrição escolhida');
  const m = (await M.store.get(hash('matr:777'), 'matriculaFila')).record;
  assert.equal(m.applyment_id, '777'); assert.equal(m.processo_inscricao, '20383');
  const nova = (await M.store.get(M.fila[0].id, 'inscricoesFila')).record;
  assert.equal(nova.concluida_em, undefined, 'a nova não foi concluída');
  assert.equal(await M.store.get(hash('etapa1:20385:39184720514'), 'inscricoesCpf'), null, 'CPF não ficou marcado na Transferência');
});

test('Aviso: inscrição feita pelo Flow há pouco (ainda fora do portal) também conta; falhou não conta', async () => {
  const M = montar({ lista: [] });
  await cache(M.store, '20385');
  await M.store.create('fila-vest', { id: 'fila-vest', processo: '20383', status: 'inscrita', respostas: { curso_id: 'publicidade' } }, 'inscricoesFila');
  await M.store.create(hash('etapa1:20383:39184720514'), { fila_id: 'fila-vest' }, 'inscricoesCpf');
  const r = await ateConcluir(M);
  assert.equal(r.screen, 'INSC_JA_INSCRITO');
  assert.match(r.data.mensagem, /Vestibular Online 2027\/1, no curso PRODUÇÃO PUBLICITÁRIA/);
  // Sem número da inscrição ainda: "Seguir" orienta o LOGIN, sem abrir nada.
  const fim = await toque(M, 'INSC_JA_INSCRITO', 'decidir_inscricao', r.data.estado, { inscricao: 'seguir_0' });
  assert.equal(fim.screen, 'INSC_FIM'); assert.match(fim.data.mensagem, /Já sou inscrito/);

  const M2 = montar({ lista: [] });
  await cache(M2.store, '20385');
  await M2.store.create('fila-vest', { id: 'fila-vest', processo: '20383', status: 'falhou', respostas: {} }, 'inscricoesFila');
  await M2.store.create(hash('etapa1:20383:39184720514'), { fila_id: 'fila-vest' }, 'inscricoesCpf');
  assert.equal((await ateConcluir(M2)).screen, 'INSC_CONCLUIDA');
});

test('Sem outra inscrição (ou portal lento): o Concluir segue igual a antes', async () => {
  const M = montar({ lista: [] });
  await cache(M.store, '20385');
  assert.equal((await ateConcluir(M)).screen, 'INSC_CONCLUIDA');

  const L = montar({ lento: true, esperaInscricoesMs: 50 });
  await cache(L.store, '20385');
  const t0 = Date.now();
  assert.equal((await ateConcluir(L)).screen, 'INSC_CONCLUIDA', 'sem resposta do portal: não bloqueia');
  assert.ok(Date.now() - t0 < 2000);
});

test('Aviso: inscrição no mesmo processo continua com a regra de duplicada de antes (sem o aviso novo)', async () => {
  const M = montar({ lista: [TRANSFERENCIA] });
  await cache(M.store, '20385');
  assert.equal((await ateConcluir(M)).screen, 'INSC_CONCLUIDA', 'a do mesmo processo não entra no aviso');
});

// ---------------------------------------------------------------- LOGIN
test('LOGIN: com duas inscrições pergunta qual acompanhar e abre a escolhida', async () => {
  const M = montar();
  const escolha = await toque(M, 'MATR_LOGIN', 'entrar', null, { login: FINAL.cpf, data_nascimento: NASC });
  assert.equal(escolha.screen, 'MATR_ESCOLHA');
  assert.deepEqual(escolha.data.opcoes, [
    { id: '777', title: 'Vestibular Online 2027/1', description: 'PRODUÇÃO PUBLICITÁRIA' },
    { id: '901', title: 'Transferência 2027/1', description: 'AGRONOMIA' }
  ]);
  const vazio = await toque(M, 'MATR_ESCOLHA', 'escolher_inscricao', escolha.data.estado, { inscricao: '123' });
  assert.equal(vazio.screen, 'MATR_ESCOLHA'); assert.match(vazio.data.erro, /Escolha uma das inscrições/);
  const r = await toque(M, 'MATR_ESCOLHA', 'escolher_inscricao', escolha.data.estado, { inscricao: '901' });
  assert.ok(['MATR_PORTAL', 'MATR_STATUS', 'INSC_DOC_A', 'MATR_FIM'].includes(r.screen), r.screen);
  assert.deepEqual(M.matricula.chamadas, ['901'], 'o status lido é o da Transferência');
  const m = (await M.store.get(hash('matr:901'), 'matriculaFila')).record;
  assert.equal(m.applyment_id, '901'); assert.equal(m.processo_inscricao, '20385');
  assert.equal(m.ultimo_status.processo, '20385');
});

test('LOGIN: com uma inscrição só (ou lista lenta), o caminho é o de sempre', async () => {
  const M = montar({ lista: [VESTIBULAR] });
  const r = await toque(M, 'MATR_LOGIN', 'entrar', null, { login: FINAL.cpf, data_nascimento: NASC });
  assert.notEqual(r.screen, 'MATR_ESCOLHA');
  assert.deepEqual(M.matricula.chamadas, ['777']);
  assert.equal((await M.store.get(hash('matr:777'), 'matriculaFila')).record.processo_inscricao, undefined);

  const L = montar({ lento: true, listaInscricoesMs: 50 });
  const r2 = await toque(L, 'MATR_LOGIN', 'entrar', null, { login: FINAL.cpf, data_nascimento: NASC });
  assert.notEqual(r2.screen, 'MATR_ESCOLHA', 'sem a lista a tempo: abre a que o Rubeus abrir');
});

// ---------------------------------------------------------------- worker da matrícula (Rubeus oficial)
test('Matrícula: o worker lê o status da inscrição da fila e recusa se o portal devolver outro processo', async () => {
  const M = montar();
  const id = hash('matr:901');
  await M.store.create(id, { id, applyment_id: '901', login: '39184720514', data_nascimento: NASC, insc_vigia: { processo: '20385' }, blocos: {}, enviados: {}, status: 'pendente' }, 'matriculaFila');
  await M.e2.atualizarStatus(id);
  assert.deepEqual(M.matricula.chamadas, ['901']);
  assert.equal((await M.store.get(id, 'matriculaFila')).record.ultimo_status.processo, '20385');

  // Portal que ignora o applyment_id e abre o Vestibular: nada é gravado como se fosse a Transferência.
  const R = montar({ ignoraApplyment: true });
  await R.store.create(id, { id, applyment_id: '901', login: '39184720514', data_nascimento: NASC, insc_vigia: { processo: '20385' }, blocos: {}, enviados: {}, status: 'pendente' }, 'matriculaFila');
  await assert.rejects(R.e2.atualizarStatus(id), /outra inscrição/);
  assert.equal((await R.store.get(id, 'matriculaFila')).record.ultimo_status, undefined);
});

test('Flow JSON: telas novas declaradas e rotas sem volta', () => {
  const ids = FLOW.screens.map(s => s.id);
  assert.ok(ids.includes('INSC_JA_INSCRITO') && ids.includes('MATR_ESCOLHA'));
  assert.ok(FLOW.routing_model.INSC_QUASE_LA.includes('INSC_JA_INSCRITO'));
  assert.ok(FLOW.routing_model.MATR_LOGIN.includes('MATR_ESCOLHA'));
  // Sem ciclo: a partir das telas novas não se volta a elas.
  const alcanca = (de, alvo, vistos = new Set()) => (FLOW.routing_model[de] ?? []).some(p => p === alvo || (!vistos.has(p) && (vistos.add(p), alcanca(p, alvo, vistos))));
  assert.equal(alcanca('INSC_JA_INSCRITO', 'INSC_JA_INSCRITO'), false);
  assert.equal(alcanca('MATR_ESCOLHA', 'MATR_ESCOLHA'), false);
  assert.equal(alcanca('MATR_ESCOLHA', 'MATR_LOGIN'), false);
});

test('Telas novas desligadas (JSON ainda não publicado na Meta): inscrição e LOGIN como antes; o worker continua entrando na inscrição certa', async () => {
  process.env.TELAS_INSCRICAO_MULTIPLA = 'off';
  try {
    const M = montar();
    await cache(M.store, '20385');
    const concl = await ateConcluir(M);
    assert.equal(concl.screen, 'INSC_CONCLUIDA', 'sem o aviso');
    const login = await toque(M, 'MATR_LOGIN', 'entrar', null, { login: FINAL.cpf, data_nascimento: NASC });
    assert.notEqual(login.screen, 'MATR_ESCOLHA', 'sem a escolha');
    const status = await toque(M, 'INSC_CONCLUIDA', 'abrir_portal', concl.data.estado);
    const a = await toque(M, 'INSC_STATUS', 'verificar_documentos', status.data.estado);
    const b = await toque(M, 'INSC_DOC_A', 'enviar_documento_inscricao', a.data.estado, { arquivo: MIDIA(28) });
    const c = await toque(M, 'INSC_DOC_B', 'enviar_documento_inscricao', b.data.estado, { arquivo: [] });
    await toque(M, 'INSC_DOC_C', 'enviar_documento_inscricao', c.data.estado, { arquivo: [] });
    await M.e1.worker(M.fila[0].id);
    assert.equal((await M.store.get(M.fila[0].id, 'inscricoesFila')).record.status, 'concluida', 'documentos entregues na Transferência');
  } finally { process.env.TELAS_INSCRICAO_MULTIPLA = 'on'; }
});
