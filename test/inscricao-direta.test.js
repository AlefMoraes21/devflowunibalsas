// Transferência, Portador e Nota do ENEM (2.13.0): etapa 1 = inscrição + documentos de inscrição, igual ao site
// (ENGENHARIA-FLOW-INSCRICAO-DIRETA.md). Flow → Firestore → worker (caminho do site) → vigia da análise → LOGIN.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

process.env.FLOW_PRIVATE_KEY = 'unit-direta';
process.env.FLOW_PROJECT_ID = 'unit';
process.env.RBS_TOKEN = 'unit';
const { sealState, openState, responseForScreen, flowContext } = await import('../api/flow.js');
const { createEtapa1 } = await import('../api/etapa1-fila.js');
const { createEtapa2, avaliarInscricao, ehDocsInscricao } = await import('../api/etapa2-matricula.js');
const { summarizeStages, validCpf } = await import('../api/matricula.js');
const { docsInscricao, tituloProcesso, temDocsInscricao } = await import('../api/processes.js');
const { ICONES } = await import('../api/icones.js');

const FLOW = JSON.parse(readFileSync(new URL('../flows/etapa1-vestibular.json', import.meta.url), 'utf8'));
const CURSOS = [{ id: 'dir', title: 'Direito' }];
const TURNOS = { dir: [{ id: 'not', title: 'Noturno' }] };
const USER = new Set(['nome', 'email', 'data_nascimento', 'celular', 'genero', 'aceite_privacidade', 'possui_nome_social', 'nome_social', 'curso_id', 'turno_id', 'cpf', 'nacionalidade', 'concluiu_ensino_medio', 'possui_deficiencia', 'tipos_deficiencia', 'deficiencia_outra', 'como_conheceu', 'como_conheceu_outro', 'processo_seletivo_id', 'numero_inscricao_enem', 'ano_enem', 'nota_natureza_enem', 'nota_humanas_enem', 'nota_matematica_enem', 'nota_linguagens_enem', 'nota_redacao_enem', 'media_enem']);
const BASICOS = { nome: 'Rebeca Teste Drumond', email: 'rebeca@example.com', data_nascimento: '1959-04-13', celular: '(68) 99996-6749', genero: 'F', aceite_privacidade: true, possui_nome_social: false };
const FINAL = { cpf: '391.847.205-14', nacionalidade: '10', concluiu_ensino_medio: 'Sim', possui_deficiencia: 'F', como_conheceu: '01' };
const ENEM = { numero_inscricao_enem: '999999999999', ano_enem: '2025', nota_natureza_enem: '600.5', nota_humanas_enem: '620', nota_matematica_enem: '580', nota_linguagens_enem: '640', nota_redacao_enem: '700' };
const MIDIA = n => [{ file_name: `doc-${n}.pdf`, media_id: 'm' + n, cdn_url: 'https://cdn.example/' + n, encryption_metadata: { encryption_key: 'k' } }];

function memoria() {
  const db = new Map(); let v = 0; const k = (c, id) => c + '/' + id;
  return {
    db,
    async get(id, c = 'x') { const x = db.get(k(c, id)); return x ? { record: structuredClone(x.record), version: x.version } : null; },
    async create(id, record, c = 'x') { if (db.has(k(c, id))) return false; db.set(k(c, id), { record: structuredClone(record), version: 'v' + (++v) }); return true; },
    async update(id, record, version, c = 'x') { const x = db.get(k(c, id)); if (!x || x.version !== version) return false; db.set(k(c, id), { record: structuredClone(record), version: 'v' + (++v) }); return true; },
    naHora(t = Date.now()) { for (const x of db.values()) for (const tipo of Object.keys(x.record.vigia_proxima ?? {})) x.record.vigia_proxima[tipo] = Math.min(x.record.vigia_proxima[tipo], t); }
  };
}

// Rubeus da inscrição (o que o worker repete): processo direto termina em ACOMPANHAMENTO, sem prova.
function rubeusInscricao() {
  const chamadas = [];
  const tela = (screen, data) => ({ screen, data: { estado: sealState(screen, data) } });
  async function runStep(req) {
    const a = req.data.acao; chamadas.push({ a, data: req.data });
    if (a === 'selecionar_processo') return tela('DADOS_BASICOS', {});
    if (a === 'enviar_dados_basicos') return tela('CURSO_INGRESSO', { cursos: CURSOS, turnos: [] });
    if (a === 'buscar_turnos') {
      // Como o runStep real: o estado só abre na mesma tela em que foi selado (CURSO_INGRESSO / CURSO_ENEM).
      openState(req.data.estado, req.screen);
      return tela('CURSO_INGRESSO', { cursos: CURSOS, turnos: TURNOS[req.data.curso_id] });
    }
    if (a === 'avancar_curso_ingresso' || a === 'avancar_curso_interesse') return tela('QUASE_LA', {});
    if (a === 'enviar_informacoes_complementares') return tela('ACOMPANHAMENTO', { applyment_id: '901' });
    throw new Error('inesperado ' + a);
  }
  return { chamadas, runStep };
}

// Portal do candidato (caminho do site): etapas e passo de documentos de inscrição do processo.
function portalFalso(processo, { statusInicial = {}, etapas = null } = {}) {
  const lista = docsInscricao(processo);
  const status = { ...statusInicial };
  const lotes = [];
  let fase = 'pendentes';
  const docsRow = () => fase === 'pendentes' || fase === 'recusado'
    ? { title: 'Documentos inscrição', feedback: { complementary_text: 'Pendentes', conclusive: 0, cta_text: 'Verificar' }, cta_link: 'presencial/passo/300696' }
    : { title: 'Documentos inscrição', feedback: { complementary_text: 'Em análise', conclusive: fase === 'aprovado' ? 1 : 0, cta_text: null }, cta_link: null };
  const estado = {
    get fase() { return fase; }, set fase(f) { fase = f; },
    statusOpcao: '0', status, lotes, entradas: 0
  };
  const portalSite = {
    async entrar(cpf, nasc) { estado.entradas++; assert.equal(cpf, '39184720514'); assert.equal(nasc, BASICOS.data_nascimento); return { token: 't', session_id: 's', applyment_id: '901' }; },
    async inscricao() {
      const st = etapas ? etapas(fase) : [
        { title: 'Inscrição', feedback: { complementary_text: 'Concluída', conclusive: 1 }, cta_link: 'presencial/feedback/920259' },
        ...(processo === '20386' ? [{ title: 'Checando as notas', feedback: { complementary_text: 'Validando', conclusive: 0, cta_text: 'null' }, cta_link: 'presencial/passo/300719' }] : []),
        docsRow(),
        ...(fase === 'aprovado' ? [{ title: 'Seleção resp. financeiro', feedback: { complementary_text: 'Pendente', conclusive: 0, cta_text: 'Verificar' }, cta_link: 'presencial/passo/300706' }] : [])
      ];
      return { processo, stages: st };
    },
    async passoDocumentos(_s, passo, proc) {
      assert.equal(passo, 300696); assert.equal(proc, processo);
      return { passo: 300696, stage_id: 261028, componente: 3940672, campo: 38633, botao: 3940675, botao_relacionado: 174882, max_mb: 5,
        docs: lista.map(d => ({ codigo: d.codigo, titulo: d.titulo.toUpperCase(), obrigatorio: d.obrigatorio, chaverm: null, status: status[d.codigo] ?? null, path: null, adicional: null, adicional2: null })) };
    },
    async enviarDocumentos({ processo: proc, arquivos }) { lotes.push({ processo: proc, codigos: arquivos.map(a => a.codigo), tipos: arquivos.map(a => a.tipo) }); for (const a of arquivos) status[a.codigo] = '1'; return { success: true }; },
    async passoBruto(_s, passo) { assert.equal(passo, 300719); return { data: { steps: { currentStep: { applicantData: [{ field_id: 38623, value: estado.statusOpcao }, { field_id: 38544, value: 'JUAN TESTE' }, { field_id: 38546, value: '(68) 99877-3655' }], content: [] } } } }; },
    async pagina() { return { data: { page: { applicantData: [{ field_id: 38544, value: 'Rebeca' }, { field_id: 38546, value: '68999966749' }] } } }; }
  };
  return { portalSite, estado };
}

function montar(processo, opcoes = {}) {
  const store = memoria();
  const fila = [];
  const rubeus = rubeusInscricao();
  const portal = portalFalso(processo, opcoes);
  const enviados = [];
  const avisos = { configurado: { atualizacao: () => true, cobranca: () => false }, async atualizacao(d) { enviados.push(d); return true; } };
  const ref = {};
  const e1 = createEtapa1({
    store, enqueue: async (id, o) => { fila.push({ id, ...o }); },
    runStep: rubeus.runStep, sealState, openState,
    validateBasic: () => {}, validateFinal: d => { if (!(d.origens ?? []).some(o => o.id === d.como_conheceu)) throw new Error('Selecione como ficou sabendo.'); },
    origens: [{ id: '01', title: 'Site oficial' }], hoje: () => '2026-11-17',
    requiresEssay: id => String(id) === '20383', academicId: () => '225', userFields: USER,
    sleep: async () => {}, log: () => {}, esperaProvaMs: 0, estabilidadeMs: 0,
    ehEnem: id => String(id) === '20386', anosEnem: [{ id: '2025', title: '2025' }],
    validateEnem: d => { if (!/^\d{12,15}$/.test(String(d.numero_inscricao_enem ?? ''))) throw new Error('A inscrição do ENEM deve ter de 12 a 15 números.'); },
    mediaEnem: d => (['nota_natureza_enem', 'nota_humanas_enem', 'nota_matematica_enem', 'nota_linguagens_enem', 'nota_redacao_enem'].reduce((s, k) => s + Number(d[k]), 0) / 5).toFixed(2),
    docsInscricao, portalSite: portal.portalSite, baixarMidia: async m => { if ((opcoes.midiaRuim ?? []).includes(m.media_id)) throw new Error('Arquivo inválido. Envie novamente.'); return Buffer.from('%PDF ' + m.media_id); }, esperaDocsInscricaoMs: 0,
    aoEnviarDocsInscricao: dados => ref.e2.iniciarVigiaInscricao(dados)
  });
  const e2 = createEtapa2({
    store, enqueue: async (id, o) => fila.push({ id, ...o }), sealState, openState, validCpf, log: () => {},
    matricula: {
      async login(cpf, nasc) { assert.equal(nasc, BASICOS.data_nascimento); return { token: 'tok', applyment_id: '901', person_id: '1' }; },
      async portal() { const p = await portal.portalSite.inscricao(); return { token: 'tok2', processo_seletivo_id: p.processo, stages: p.stages }; }
    },
    portalSite: portal.portalSite, avisos, entrarNosDocsInscricao: a => e1.entrarNosDocsInscricao(a), tituloProcesso
  });
  ref.e2 = e2;
  return { e1, e2, store, fila, rubeus, portal, enviados };
}
async function cache(store, processo) { await store.create('etapa1-' + processo, { cursos: CURSOS, turnos: TURNOS, atualizado: Date.now(), expires: Date.now() + 1e9 }, 'flowCache'); }

// Contrato com o JSON publicado: chaves e tipos iguais aos declarados e rota válida no routing_model.
function confere(origem, r) {
  if (r.screen === 'SUCCESS') return r;
  const tela = FLOW.screens.find(s => s.id === r.screen);
  assert.ok(tela, 'tela existe: ' + r.screen);
  assert.ok(origem === r.screen || FLOW.routing_model[origem].includes(r.screen), `${origem} → ${r.screen}`);
  assert.deepEqual(Object.keys(r.data).sort(), Object.keys(tela.data ?? {}).sort(), 'chaves de ' + r.screen);
  for (const [k, v] of Object.entries(r.data)) assert.equal(Array.isArray(v) ? 'array' : typeof v, tela.data[k].type, `${r.screen}.${k}`);
  return r;
}
async function toque(M, screen, acao, estado, user = {}, ft = 'ft-d') {
  const req = { screen, action: 'data_exchange', flow_token: ft, data: { acao, ...(estado ? { estado } : {}), ...user } };
  const r = await flowContext.run({ request: req, deadline: Date.now() + 9500, write: null }, async () => (await M.e2.route(req)) ?? (await M.e1.route(req)));
  return confere(screen, r);
}
async function inscrever(M, processo) {
  const dados = await toque(M, 'INSC_INICIO', 'e1_iniciar', undefined, { processo_seletivo_id: processo });
  const curso = await toque(M, 'INSC_DADOS', 'enviar_dados_basicos', dados.data.estado, BASICOS);
  const enem = processo === '20386';
  assert.equal(curso.screen, enem ? 'INSC_CURSO_ENEM' : 'INSC_CURSO');
  const t = await toque(M, curso.screen, 'buscar_turnos', curso.data.estado, { curso_id: 'dir', ...(enem ? ENEM : {}) });
  const quase = await toque(M, curso.screen, 'escolher_curso', t.data.estado, { curso_id: 'dir', turno_id: 'not', ...(enem ? ENEM : {}) });
  assert.equal(quase.screen, 'INSC_QUASE_LA');
  const concl = await toque(M, 'INSC_QUASE_LA', 'enviar_informacoes_complementares', quase.data.estado, FINAL);
  assert.equal(concl.screen, 'INSC_CONCLUIDA', 'Obrigado pelo seu cadastro!');
  const status = await toque(M, 'INSC_CONCLUIDA', 'abrir_portal', concl.data.estado);
  assert.equal(status.screen, 'INSC_STATUS');
  return { status, quase };
}

test('Processos: documentos de inscrição por processo (1º obrigatório) e o Vestibular sem documentos de inscrição', () => {
  assert.deepEqual(docsInscricao('20385').map(d => d.codigo), ['28', '29', '27']);
  assert.deepEqual(docsInscricao('20384').map(d => d.codigo), ['10', '17', '26']);
  assert.deepEqual(docsInscricao('20386').map(d => d.codigo), ['25']);
  for (const p of ['20385', '20384', '20386']) assert.deepEqual(docsInscricao(p).map(d => d.obrigatorio), docsInscricao(p).map((_, i) => i === 0));
  assert.equal(temDocsInscricao('20383'), false);
  assert.equal(tituloProcesso('20386'), 'Nota do ENEM 2027/1');
});

test('Flow JSON: telas novas com logo, um seletor por tela, 1º documento obrigatório, rotas sem volta', () => {
  const tela = id => FLOW.screens.find(s => s.id === id);
  for (const id of ['INSC_CURSO_ENEM', 'INSC_STATUS', 'INSC_DOC_A', 'INSC_DOC_B', 'INSC_DOC_C', 'INSC_DOCS_FIM']) assert.ok(tela(id), id);
  const comps = t => { const out = []; const andar = n => { if (Array.isArray(n)) n.forEach(andar); else if (n && typeof n === 'object') { if (n.type) out.push(n); Object.values(n).forEach(andar); } }; andar(t.layout); return out; };
  for (const [id, min] of [['INSC_DOC_A', 1], ['INSC_DOC_B', 0], ['INSC_DOC_C', 0]]) {
    const pickers = comps(tela(id)).filter(c => c.type === 'DocumentPicker');
    assert.equal(pickers.length, 1); assert.equal(pickers[0]['min-uploaded-documents'], min);
    assert.ok(comps(tela(id)).some(c => c.type === 'Image'), 'logo Documentos de inscrição');
  }
  assert.ok(comps(tela('INSC_STATUS')).some(c => c.type === 'Image'), 'logo do Portal');
  assert.ok(comps(tela('INSC_CURSO_ENEM')).some(c => c.name === 'nota_redacao_enem'));
  assert.ok(!comps(tela('INSC_QUASE_LA')).some(c => c.name === 'numero_inscricao_enem'), 'V3: ENEM fora da Estamos quase lá');
  assert.ok(FLOW.routing_model.MATR_STATUS.includes('INSC_DOC_A'), 'LOGIN abre os documentos de inscrição');
  const fimDocs = tela('INSC_DOCS_FIM');
  assert.equal(fimDocs.terminal, true); assert.deepEqual(Object.keys(fimDocs.data), ['eh_nota_enem']);
  const textos = comps(fimDocs).map(c => c.text ?? c.label);
  for (const t of ['✅ Inscrição', '⏳ Documentos inscrição', 'Em análise', 'Concluir']) assert.ok(textos.includes(t), t);
  assert.equal(comps(fimDocs).find(c => c.type === 'Footer')['on-click-action'].name, 'complete');
  assert.ok(FLOW.screens.find(s => s.id === 'MATR_STATUS').data.etapas.items.properties.start, 'ícone de status declarado');
});

test('Transferência: Concluir → Obrigado → Portal (Pendentes) → 3 documentos → Enviar volta ao status (Em análise); worker envia pelo site e liga o vigia', async () => {
  const M = montar('20385');
  await cache(M.store, '20385');
  const { status } = await inscrever(M, '20385');
  assert.equal(status.data.eh_nota_enem, false);
  assert.equal(M.rubeus.chamadas.length, 0, 'nenhuma tela esperou o Rubeus');
  const a = await toque(M, 'INSC_STATUS', 'verificar_documentos', status.data.estado);
  assert.equal(a.screen, 'INSC_DOC_A'); assert.equal(a.data.titulo_doc, 'Histórico acadêmico *'); assert.equal(a.data.botao, 'Avançar');
  assert.match(a.data.legenda_doc, /Obrigatório\. Documento 1 de 3/);
  const semArquivo = await toque(M, 'INSC_DOC_A', 'enviar_documento_inscricao', a.data.estado, { arquivo: [] });
  assert.equal(semArquivo.screen, 'INSC_DOC_A'); assert.match(semArquivo.data.erro, /Anexe o arquivo/);
  const b = await toque(M, 'INSC_DOC_A', 'enviar_documento_inscricao', a.data.estado, { arquivo: MIDIA(28) });
  assert.equal(b.screen, 'INSC_DOC_B'); assert.match(b.data.legenda_doc, /Opcional/);
  const c = await toque(M, 'INSC_DOC_B', 'enviar_documento_inscricao', b.data.estado, { arquivo: [] });
  assert.equal(c.screen, 'INSC_DOC_C'); assert.equal(c.data.botao, 'Enviar');
  const fim = await toque(M, 'INSC_DOC_C', 'enviar_documento_inscricao', c.data.estado, { arquivo: MIDIA(27) });
  assert.equal(fim.screen, 'INSC_DOCS_FIM', 'depois do Enviar: status do portal, como no site'); assert.deepEqual(Object.keys(fim.data), ['eh_nota_enem']); assert.equal(fim.data.eh_nota_enem, false);

  const id = M.fila[0].id;
  await M.e1.worker(id);
  const rec = (await M.store.get(id, 'inscricoesFila')).record;
  assert.equal(rec.status, 'concluida'); assert.equal(rec.passo, 'fim');
  assert.equal(rec.respostas, null, 'dados pessoais não ficam'); assert.equal(rec.via_login, null); assert.equal(rec.docs_inscricao.arquivos, undefined, 'referências dos arquivos não ficam');
  assert.deepEqual(M.portal.estado.lotes, [{ processo: '20385', codigos: ['28', '27'], tipos: ['application/pdf', 'application/pdf'] }], 'um único Enviar, como no site');
  assert.ok(M.rubeus.chamadas.some(x => x.a === 'avancar_curso_ingresso'));
  // Vigia da análise ligado no registro do LOGIN, com o status salvo (V1) e o contato da inscrição.
  const mid = M.fila.find(x => x.tipo === 'inscricao_vigia').id;
  const m = (await M.store.get(mid, 'matriculaFila')).record;
  assert.equal(m.applyment_id, '901'); assert.equal(m.login, '39184720514'); assert.equal(m.contato.celular, '68999966749');
  assert.ok(m.ultimo_status.stages.length >= 2); assert.ok(m.insc_vigia.desde);
});

test('Worker: repetição segura (documento já em análise no portal não é reenviado) e calma após o Concluir', async () => {
  const M = montar('20384', { statusInicial: { '10': '1' } });
  await cache(M.store, '20384');
  const { status } = await inscrever(M, '20384');
  const a = await toque(M, 'INSC_STATUS', 'verificar_documentos', status.data.estado);
  assert.equal(a.data.titulo_doc, 'Diploma de graduação *');
  const b = await toque(M, 'INSC_DOC_A', 'enviar_documento_inscricao', a.data.estado, { arquivo: MIDIA(10) });
  const c = await toque(M, 'INSC_DOC_B', 'enviar_documento_inscricao', b.data.estado, { arquivo: MIDIA(17) });
  await toque(M, 'INSC_DOC_C', 'enviar_documento_inscricao', c.data.estado, { arquivo: [] });
  await M.e1.worker(M.fila[0].id);
  assert.deepEqual(M.portal.estado.lotes.map(l => l.codigos), [['17']]);
});

test('Docs de inscrição com anexo que não abre (Flow em rascunho): envia os bons, descarta o ruim e reabre a etapa sem loop', async () => {
  const M = montar('20385', { midiaRuim: ['m28'] });
  await cache(M.store, '20385');
  const { status } = await inscrever(M, '20385');
  const a = await toque(M, 'INSC_STATUS', 'verificar_documentos', status.data.estado);
  const b = await toque(M, 'INSC_DOC_A', 'enviar_documento_inscricao', a.data.estado, { arquivo: MIDIA(28) });
  const c = await toque(M, 'INSC_DOC_B', 'enviar_documento_inscricao', b.data.estado, { arquivo: [] });
  await toque(M, 'INSC_DOC_C', 'enviar_documento_inscricao', c.data.estado, { arquivo: MIDIA(27) });
  const id = M.fila[0].id;
  const erros = []; const original = console.error; console.error = m => erros.push(String(m));
  try { await M.e1.worker(id); } finally { console.error = original; }
  assert.deepEqual(M.portal.estado.lotes.map(l => l.codigos), [['27']], 'o anexo bom vai ao portal');
  const rec = (await M.store.get(id, 'inscricoesFila')).record;
  assert.equal(rec.docs_inscricao.completo, false, 'reabre: o toque em Documentos inscrição abre as telas de novo');
  assert.ok(!rec.docs_inscricao.arquivos['28']); assert.deepEqual(rec.docs_refazer, ['28']);
  assert.notEqual(rec.status, 'falhou'); assert.ok(!rec.tentativas, 'não conta como erro do sistema');
  assert.ok(erros.some(e => e.includes('docs_refazer')), 'a equipe vê o alerta no log');
});

test('Docs de inscrição recebidos antes de o portal mostrar a etapa: o worker espera (não desiste em 6) e entrega quando aparece', async () => {
  let liberado = false;
  const inscricao = { title: 'Inscrição', feedback: { complementary_text: 'Concluída', conclusive: 1 }, cta_link: 'presencial/feedback/920259' };
  const docs = { title: 'Documentos inscrição', feedback: { complementary_text: 'Pendentes', conclusive: 0, cta_text: 'Verificar' }, cta_link: 'presencial/passo/300696' };
  const M = montar('20385', { etapas: () => liberado ? [inscricao, docs] : [inscricao] });
  await cache(M.store, '20385');
  const { status } = await inscrever(M, '20385');
  const a = await toque(M, 'INSC_STATUS', 'verificar_documentos', status.data.estado);
  const b = await toque(M, 'INSC_DOC_A', 'enviar_documento_inscricao', a.data.estado, { arquivo: MIDIA(28) });
  const c = await toque(M, 'INSC_DOC_B', 'enviar_documento_inscricao', b.data.estado, { arquivo: [] });
  await toque(M, 'INSC_DOC_C', 'enviar_documento_inscricao', c.data.estado, { arquivo: MIDIA(27) });
  const id = M.fila[0].id;
  const erros = []; const original = console.error; console.error = m => erros.push(String(m));
  try { for (let i = 0; i < 8; i++) await M.e1.worker(id); } finally { console.error = original; }
  let rec = (await M.store.get(id, 'inscricoesFila')).record;
  assert.equal(rec.status, 'inscrita', 'continua esperando o portal'); assert.equal(rec.tentativas, 8);
  assert.equal(erros.filter(e => e.includes('docs_nao_liberado')).length, 1, 'um alerta só, na 6ª espera');
  const esperas = M.fila.filter(x => x.id === id && x.atrasoSeg).map(x => x.atrasoSeg);
  assert.ok(esperas.length && esperas.every(s => s <= 600), 'reagenda em até 10 min');
  assert.equal(M.portal.estado.lotes.length, 0);
  liberado = true;
  await M.e1.worker(id);
  rec = (await M.store.get(id, 'inscricoesFila')).record;
  assert.equal(rec.status, 'concluida');
  assert.deepEqual(M.portal.estado.lotes.map(l => l.codigos), [['28', '27']]);
});

test('Cache de turnos sem pré-carga (ENEM/Transf./Portador): o worker lê os turnos na tela de curso do processo e a tela do Flow libera o turno', async () => {
  const M = montar('20386');
  const dados = await toque(M, 'INSC_INICIO', 'e1_iniciar', undefined, { processo_seletivo_id: '20386' });
  await toque(M, 'INSC_DADOS', 'enviar_dados_basicos', dados.data.estado, BASICOS);
  const erros = []; const original = console.error; console.error = m => erros.push(String(m));
  try { await M.e1.worker(M.fila[0].id); } finally { console.error = original; }
  const c = (await M.store.get('etapa1-20386', 'flowCache')).record;
  assert.ok(Object.keys(c.turnos ?? {}).length > 0, 'turnos no cache (antes: com_turno 0, a candidata ficava presa)');
  assert.ok(!erros.some(e => e.includes('sem_turnos')));
});

test('ENEM: Portal mostra "Checando as notas: Validando"; um documento (boletim) e volta ao status com as notas', async () => {
  const M = montar('20386');
  await cache(M.store, '20386');
  const { status, quase } = await inscrever(M, '20386');
  assert.equal(quase.data.resumo_enem, 'Média das notas do ENEM: 628,10');
  assert.equal(status.data.eh_nota_enem, true);
  const a = await toque(M, 'INSC_STATUS', 'verificar_documentos', status.data.estado);
  assert.equal(a.data.titulo_doc, 'Boletim nota ENEM *'); assert.equal(a.data.botao, 'Enviar');
  const fim = await toque(M, 'INSC_DOC_A', 'enviar_documento_inscricao', a.data.estado, { arquivo: MIDIA(25) });
  assert.equal(fim.screen, 'INSC_DOCS_FIM'); assert.equal(fim.data.eh_nota_enem, true, 'status mostra Checando as notas: Validando');
  await M.e1.worker(M.fila[0].id);
  const curso = M.rubeus.chamadas.find(x => x.a === 'avancar_curso_ingresso');
  assert.equal(curso.data.numero_inscricao_enem, ENEM.numero_inscricao_enem, 'notas vão junto com o curso');
  assert.deepEqual(M.portal.estado.lotes.map(l => l.codigos), [['25']]);
});

test('LOGIN: status com ícones; "Documentos inscrição: Pendentes [Verificar]" abre as telas de documento da etapa 1', async () => {
  const M = montar('20385');
  const st = await toque(M, 'MATR_LOGIN', 'entrar', null, { login: FINAL.cpf, data_nascimento: BASICOS.data_nascimento });
  assert.equal(st.screen, 'MATR_STATUS');
  const [insc, docs] = st.data.etapas;
  assert.equal(insc.start.image, ICONES.ok); assert.equal(insc['main-content'].title, 'Inscrição');
  assert.equal(docs.start.image, ICONES.pendente); assert.equal(docs.end.title, 'Verificar');
  const a = await toque(M, 'MATR_STATUS', 'abrir_etapa', docs['on-click-action'].payload.estado);
  assert.equal(a.screen, 'INSC_DOC_A'); assert.equal(a.data.titulo_doc, 'Histórico acadêmico *');
  const b = await toque(M, 'INSC_DOC_A', 'enviar_documento_inscricao', a.data.estado, { arquivo: MIDIA(28) });
  const c = await toque(M, 'INSC_DOC_B', 'enviar_documento_inscricao', b.data.estado, { arquivo: [] });
  await toque(M, 'INSC_DOC_C', 'enviar_documento_inscricao', c.data.estado, { arquivo: [] });
  const job = M.fila.find(x => x.tipo === 'etapa1');
  await M.e1.worker(job.id);
  assert.deepEqual(M.portal.estado.lotes.map(l => l.codigos), [['28']]);
  // Em análise: o próximo LOGIN mostra o relógio e liga o vigia (sem botão).
  M.portal.estado.fase = 'analise';
  const st2 = await toque(M, 'MATR_LOGIN', 'entrar', null, { login: FINAL.cpf, data_nascimento: BASICOS.data_nascimento });
  assert.equal(st2.data.etapas[1].start.image, ICONES.analise); assert.equal(st2.data.etapas[1].end.title, 'Aguarde');
  const vista = await toque(M, 'MATR_STATUS', 'abrir_etapa', st2.data.etapas[1]['on-click-action'].payload.estado);
  assert.equal(vista.screen, 'MATR_STATUS', 'aguardando a equipe: só o status, como no site');
});

test('Vigia da inscrição: em análise aguarda; recusa pede só os recusados (um aviso); aprovado avisa e para', async () => {
  const M = montar('20385');
  M.portal.estado.fase = 'analise';
  assert.equal(await M.e2.iniciarVigiaInscricao({ applyment_id: '901', processo: '20385', login: '39184720514', data_nascimento: BASICOS.data_nascimento, contato: { nome: 'Rebeca', celular: '68999966749' }, stages: [] }), true);
  const id = M.fila.at(-1).id;
  assert.equal(M.fila.at(-1).tipo, 'inscricao_vigia');
  M.store.naHora(); await M.e2.vigiarInscricao(id);
  assert.equal(M.enviados.length, 0);
  M.portal.estado.fase = 'recusado'; M.portal.estado.status['28'] = '2';
  M.store.naHora(); await M.e2.vigiarInscricao(id);
  assert.equal(M.enviados.length, 1); assert.match(M.enviados[0].situacao, /recusado/); assert.match(M.enviados[0].processo, /Transferência 2027\/1/);
  M.store.naHora(); await M.e2.vigiarInscricao(id);
  assert.equal(M.enviados.length, 1, 'a mesma recusa não gera outro aviso');
  // LOGIN: o botão pede só o documento recusado.
  const st = await toque(M, 'MATR_LOGIN', 'entrar', null, { login: FINAL.cpf, data_nascimento: BASICOS.data_nascimento });
  const docs = st.data.etapas.find(i => ehDocsInscricao(i['main-content'].title));
  const a = await toque(M, 'MATR_STATUS', 'abrir_etapa', docs['on-click-action'].payload.estado);
  assert.equal(a.data.titulo_doc, 'Histórico acadêmico *'); assert.match(a.data.legenda_doc, /Recusado na análise: envie de novo\. Documento 1 de 1/);
  const semArquivo = await toque(M, 'INSC_DOC_A', 'enviar_documento_inscricao', a.data.estado, { arquivo: [] });
  assert.match(semArquivo.data.erro, /Anexe o arquivo/, 'recusado é obrigatório no reenvio');
  // Aprovado: próxima etapa liberada → aviso e o vigia para.
  M.portal.estado.fase = 'aprovado';
  M.store.naHora(); await M.e2.vigiarInscricao(id);
  assert.equal(M.enviados.length, 2); assert.match(M.enviados[1].situacao, /aprovado/);
  const n = M.fila.length;
  M.store.naHora(); await M.e2.vigiarInscricao(id);
  assert.equal(M.enviados.length, 2); assert.equal(M.fila.length, n, 'vigia parou');
  assert.equal((await M.store.get(id, 'matriculaFila')).record.insc_vigia.resultado, 'aprovado');
});

test('Vigia do ENEM: campo 38623 = 3 → desclassificado (texto do site), um aviso e para', async () => {
  const M = montar('20386');
  M.portal.estado.fase = 'analise';
  await M.e2.iniciarVigiaInscricao({ applyment_id: '901', processo: '20386', login: '39184720514', data_nascimento: BASICOS.data_nascimento, contato: null, stages: [] });
  const id = M.fila.at(-1).id;
  M.store.naHora(); await M.e2.vigiarInscricao(id);
  assert.equal(M.enviados.length, 0, '38623 = 0: validando');
  M.portal.estado.statusOpcao = '3';
  M.store.naHora(); await M.e2.vigiarInscricao(id);
  assert.equal(M.enviados.length, 1); assert.match(M.enviados[0].situacao, /insuficiência de nota/); assert.match(M.enviados[0].proximo, /nova inscrição/);
  assert.equal(M.enviados[0].celular, '68998773655', 'contato lido do próprio passo');
  M.store.naHora(); await M.e2.vigiarInscricao(id);
  assert.equal(M.enviados.length, 1);
});

test('avaliarInscricao: regras do resultado', () => {
  const s = rows => summarizeStages(rows);
  const insc = { title: 'Inscrição', feedback: { complementary_text: 'Concluída', conclusive: 1 } };
  const docs = (t, c = 0, cta = null) => ({ title: 'Documentos inscrição', feedback: { complementary_text: t, conclusive: c, cta_text: cta }, cta_link: cta ? 'presencial/passo/1' : null });
  assert.equal(avaliarInscricao(s([insc, docs('Em análise')])), null);
  assert.equal(avaliarInscricao(s([insc, docs('Pendentes', 0, 'Verificar')])), 'recusado');
  assert.equal(avaliarInscricao(s([insc, docs('Aprovado', 1), { title: 'Seleção resp. financeiro', feedback: { complementary_text: 'Pendente', cta_text: 'Verificar' }, cta_link: 'presencial/passo/2' }])), 'aprovado');
  assert.equal(avaliarInscricao(s([insc, docs('Em análise')]), { statusOpcao: '3' }), 'desclassificado');
  assert.equal(avaliarInscricao(s([insc, docs('Em análise')]), { statusOpcao: '5' }), null, 'aprovado nas notas, documentos ainda em análise');
  assert.equal(avaliarInscricao(s([insc, docs('Aprovado', 1)]), { statusOpcao: '5' }), 'aprovado');
});

test('Vestibular protegido: Concluir segue para a prova (INSC_PORTAL), sem telas de documentos de inscrição', async () => {
  const M = montar('20383');
  await cache(M.store, '20383');
  const dados = await toque(M, 'INSC_INICIO', 'e1_iniciar', undefined, { processo_seletivo_id: '20383' });
  const curso = await toque(M, 'INSC_DADOS', 'enviar_dados_basicos', dados.data.estado, BASICOS);
  assert.equal(curso.screen, 'INSC_CURSO');
  const t = await toque(M, 'INSC_CURSO', 'buscar_turnos', curso.data.estado, { curso_id: 'dir' });
  const quase = await toque(M, 'INSC_CURSO', 'escolher_curso', t.data.estado, { curso_id: 'dir', turno_id: 'not' });
  assert.equal(quase.data.eh_nota_enem, false); assert.equal(quase.data.resumo_enem, '');
  const concl = await toque(M, 'INSC_QUASE_LA', 'enviar_informacoes_complementares', quase.data.estado, FINAL);
  const portal = await toque(M, 'INSC_CONCLUIDA', 'abrir_portal', concl.data.estado);
  assert.equal(portal.screen, 'INSC_PORTAL', 'Prova online, como antes');
});
