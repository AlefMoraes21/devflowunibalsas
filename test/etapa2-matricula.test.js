import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

process.env.FLOW_PRIVATE_KEY = 'unit-etapa2';
process.env.FLOW_PROJECT_ID = 'unit';
process.env.RBS_TOKEN = 'unit';
const { sealState, openState, flowContext } = await import('../api/flow.js');
const { createEtapa2, escolherOpcao, idade, DOCS, proximaTela, buscarEscolas, opcaoEscola, SEM_ESCOLA } = await import('../api/etapa2-matricula.js');
const { validCpf } = await import('../api/matricula.js');

// Um único Flow: a etapa 2 está no mesmo JSON da etapa 1.
const FLOW = JSON.parse(readFileSync(new URL('../flows/etapa1-vestibular.json', import.meta.url), 'utf8'));
const CPF = '391.847.205-14';
const NASC = '2000-05-10';
const MEDIA = id => [{ file_name: `doc${id}.pdf`, media_id: 'm' + id, cdn_url: 'https://cdn.example/' + id, encryption_metadata: { encryption_key: 'k' } }];

function memoria() {
  const db = new Map(); let v = 0; const k = (c, id) => c + '/' + id;
  return {
    async get(id, c = 'x') { const x = db.get(k(c, id)); return x ? { record: structuredClone(x.record), version: x.version } : null; },
    async create(id, record, c = 'x') { if (db.has(k(c, id))) return false; db.set(k(c, id), { record: structuredClone(record), version: 'v' + (++v) }); return true; },
    async update(id, record, version, c = 'x') { const x = db.get(k(c, id)); if (!x || x.version !== version) return false; db.set(k(c, id), { record: structuredClone(record), version: 'v' + (++v) }); return true; },
    // Chegou a hora da tarefa agendada (o Cloud Tasks só entrega no horário marcado).
    naHora(t = Date.now()) { for (const x of db.values()) for (const tipo of Object.keys(x.record.vigia_proxima ?? {})) x.record.vigia_proxima[tipo] = Math.min(x.record.vigia_proxima[tipo], t); }
  };
}

// Rubeus simulado: o portal libera um passo por vez; cada /submit conclui o passo atual. Depois da
// identidade vem "Documentos matrícula".
function rubeusFalso({ prova = 'Aprovado', conclusivo = 1, semMatricula = false } = {}) {
  const passos = ['RESP_FINANCEIRO', 'ENDERECO', 'IDENTIDADE'];
  let atual = 0;
  const envios = [];
  const listasCarregadas = { n: 0 };
  const listas = {
    opcoes_responsavel: [{ id: '1', title: 'Eu' }, { id: '2', title: 'Outro' }],
    ufs: [{ id: 'MA', title: 'MA' }],
    racas: [{ id: '01', title: 'Branca' }, { id: '03', title: 'Parda' }],
    estados_civis: [{ id: 'S', title: 'Solteiro' }, { id: 'C', title: 'Casado' }]
  };
  const matricula = {
    async login(cpf, nasc) { if (cpf !== '39184720514' || nasc !== NASC) throw new Error('não'); return { token: 'tok', applyment_id: '555', person_id: '1' }; },
    async portal() { return { token: 'tok2', processo_seletivo_id: '20383', stages: [
      { title: 'Inscrição', feedback: { complementary_text: 'Concluída', conclusive: 1 } },
      { title: 'Prova online', feedback: { complementary_text: prova, conclusive: conclusivo } },
      ...(semMatricula ? [] : [{ title: atual < passos.length ? 'Pré-matrícula' : 'Documentos matrícula', feedback: { complementary_text: 'Pendente', conclusive: 0, cta_text: 'Continuar' }, cta_link: '/passo/30066' + atual }])
    ] }; },
    async open(sessao) {
      const tela = passos[atual];
      assert.ok(tela, 'documentos não abrem formulário: vão pela API da UniBalsas');
      return { screen: tela, data: { estado: sealState(tela, { ...sessao, ...listas, campos: { escola: '1', ano_conclusao: '2' }, formulario: {} }) } };
    },
    async cities(d) { assert.equal(d.estado_natal, 'MA'); return [{ id: '0907', title: 'Balsas' }, { id: '0908', title: 'Balsas do Sul' }]; },
    async schools() { return [{ id: 'E1', title: 'Escola Estadual Teste' }]; },
    async schoolOptions() { listasCarregadas.n++; return ESCOLAS_RUBEUS; },
    async send(tela, dados) { envios.push({ tela, dados }); atual++; return { token: 'tok3' }; }
  };
  return { matricula, envios, listasCarregadas, avancar: () => atual++ };
}
const ESCOLAS_RUBEUS = [
  { id: 'E1', title: 'Escola Estadual Teste - Escola Estadual Teste' },
  { id: 'E2', title: 'C DE ENSINO MEDIO ROSARIO DE MARIA NINA COSTA - C DE ENSINO MEDIO ROSARIO DE MARIA NINA COSTA' },
  { id: 'E3', title: 'Colégio Dom Bosco - Colégio Dom Bosco' }
];

// Portal do candidato simulado (caminho do site): login, processo, passo de documentos e "Enviar".
function siteFalso({ jaNoPortal = [] } = {}) {
  const enviados = new Set(jaNoPortal);
  const lotes = [];
  const passo = () => ({ passo: 300671, stage_id: 261006, componente: 3940446, campo: 38733, botao: 3940449, botao_relacionado: 174896, max_mb: 5,
    docs: DOCS.map(d => ({ codigo: d.id, titulo: d.titulo, obrigatorio: d.obrigatorio, chaverm: `1;79;27.1.1;${d.id}`, status: enviados.has(d.id) ? '1' : null, path: null, adicional: null, adicional2: null })) });
  const portalSite = {
    async entrar(cpf, nasc) { assert.equal(cpf, '39184720514'); assert.equal(nasc, NASC); return { token: 't', session_id: 's', applyment_id: '555' }; },
    async inscricao() { return { processo: '20383', stages: [] }; },
    async passoDocumentos(_s, id, processo) { assert.equal(processo, '20383'); return passo(); },
    async enviarDocumentos({ processo, arquivos }) { lotes.push({ processo, codigos: arquivos.map(a => a.codigo), tipos: arquivos.map(a => a.tipo) }); for (const a of arquivos) enviados.add(a.codigo); return { success: true }; }
  };
  return { portalSite, lotes, baixarMidia: async m => Buffer.from('PDF ' + m.media_id) };
}

function montar(opts) {
  const store = memoria();
  const fila = [];
  const site = siteFalso();
  const r = rubeusFalso(opts);
  const E = createEtapa2({ store, enqueue: async (id, o) => fila.push({ id, ...o }), sealState, openState, matricula: r.matricula, validCpf,
    buscarCep: async () => ({ cep: '65800-000', rua: 'Rua Teste', bairro: 'Centro', cidade: 'Balsas', uf: 'MA' }), log: () => {},
    portalSite: site.portalSite, baixarMidia: site.baixarMidia, esperaDocsMs: 0 });
  return { E, store, fila, lotes: site.lotes, ...r };
}
// Contrato com o JSON publicado: chaves e tipos da resposta iguais aos declarados, e rota válida.
function confere(origem, r) {
  if (r.screen === 'SUCCESS') { assert.ok(r.data.extension_message_response.params.flow_token); return r; }
  const tela = FLOW.screens.find(s => s.id === r.screen);
  assert.ok(tela, 'tela existe: ' + r.screen);
  assert.ok(origem === r.screen || FLOW.routing_model[origem].includes(r.screen), `${origem} → ${r.screen}`);
  assert.deepEqual(Object.keys(r.data).sort(), Object.keys(tela.data ?? {}).sort(), 'chaves de ' + r.screen);
  for (const [k, v] of Object.entries(r.data)) assert.equal(Array.isArray(v) ? 'array' : typeof v, tela.data[k].type, `${r.screen}.${k}`);
  return r;
}
const toque = (E, screen, acao, estado, user = {}) => {
  const req = { screen, action: 'data_exchange', flow_token: 'ft2', data: { acao, ...(estado ? { estado } : {}), ...user } };
  return flowContext.run({ request: req, deadline: Date.now() + 9500 }, async () => confere(screen, await E.route(req)));
};
// Tela de status (lista de etapas, igual ao portal): toca na primeira etapa aberta (ou na que bate com o título).
const continuar = (E, tela, re = null) => {
  if (tela.screen === 'MATR_PORTAL') return toque(E, 'MATR_PORTAL', 'continuar', tela.data.estado);
  const it = tela.data.etapas.find(i => (re ? re.test(i['main-content'].title) : i.end));
  assert.ok(it, 'etapa na lista');
  return toque(E, 'MATR_STATUS', it['on-click-action'].payload.acao, it['on-click-action'].payload.estado);
};
const filaDe = tela => openState(tela.screen === 'MATR_PORTAL' ? tela.data.estado : tela.data.etapas[0]['on-click-action'].payload.estado, tela.screen).fila_id;
const textoStatus = tela => tela.data.etapas.map(i => `${i['main-content'].title}: ${i['main-content'].metadata}${i.end ? ' [' + i.end.title + ']' : ''}`).join('\n');
const END = { cep: '65800000', rua: 'Rua A', numero: '10', bairro: 'Centro', cidade: 'Balsas', uf: 'MA', estado_natal: 'MA', cidade_natal: 'Balsas' };
const IDENT = { rg: 'MA-123456', orgao_emissor: 'ssp', uf_rg: 'MA', cor_raca: 'parda', estado_civil: 'solteiro_a', ano_conclusao: '', busca_escola: '', escola: '' };

test('Um único Flow: tela inicial da inscrição tem o link "Já sou inscrito" para o login da etapa 2', () => {
  const ids = FLOW.screens.map(s => s.id);
  assert.ok(ids.includes('INSC_INICIO') && ids.includes('MATR_LOGIN'));
  assert.ok(FLOW.routing_model.INSC_INICIO.includes('MATR_LOGIN'));
  const inicio = JSON.stringify(FLOW.screens.find(s => s.id === 'INSC_INICIO').layout);
  assert.match(inicio, /Já sou inscrito/);
  assert.match(inicio, /"name":"MATR_LOGIN"/);
  for (const t of FLOW.screens.filter(s => s.id.startsWith('MATR_'))) {
    assert.match(t.id, /^[A-Za-z_]+$/);
    // A lista de status (NavigationList) não aceita outros componentes na tela.
    if (t.id !== 'MATR_STATUS') assert.match(JSON.stringify(t.layout), /"type":"Image"/, `${t.id} tem imagem no topo`);
    const pickers = (JSON.stringify(t.layout).match(/"type":"DocumentPicker"/g) ?? []).length;
    assert.ok(pickers <= 1, 'um seletor de arquivo por tela');
  }
  assert.doesNotMatch(JSON.stringify(FLOW), /"input-type":"number"/);
  assert.equal(DOCS.filter(d => d.obrigatorio).length, 3);
});

test('Login: CPF + nascimento abre o portal; dados errados não seguem; prova em correção aguarda', async () => {
  const { E, store } = montar();
  const errado = await toque(E, 'MATR_LOGIN', 'entrar', null, { login: CPF, data_nascimento: '1999-01-01' });
  assert.equal(errado.screen, 'MATR_LOGIN'); assert.match(errado.data.erro, /Não encontramos/);
  const ok = await toque(E, 'MATR_LOGIN', 'entrar', null, { login: CPF, data_nascimento: NASC });
  assert.equal(ok.screen, 'MATR_STATUS'); assert.match(textoStatus(ok), /Prova online/);
  const s = { fila_id: filaDe(ok) };
  assert.equal((await store.get(s.fila_id, 'matriculaFila')).record.applyment_id, '555');
  const c = montar({ prova: 'Aguardando correção', conclusivo: 0, semMatricula: true });
  const espera = await toque(c.E, 'MATR_LOGIN', 'entrar', null, { login: CPF, data_nascimento: NASC });
  // Aguardando correção: a tela inicial é o status do portal; o botão só fecha o Flow.
  assert.equal(espera.screen, 'MATR_STATUS'); assert.match(textoStatus(espera), /❗ Prova online: Aguardando correção$/m);
  assert.ok(!espera.data.etapas.some(i => i.end), 'nenhuma etapa aberta: sem botão, como no site');
  const mesma = await continuar(c.E, espera, /Prova/);
  assert.equal(mesma.screen, 'MATR_STATUS', 'tocar numa etapa sem ação só mostra o status');
});

test('Portal ao logar de novo: o botão leva à primeira subetapa que falta, com o texto do botão do site', async () => {
  const { E } = montar();
  const p1 = await toque(E, 'MATR_LOGIN', 'entrar', null, { login: CPF, data_nascimento: NASC });
  assert.match(textoStatus(p1), /Pré-matrícula: Pendente \[Continuar\]/);
  const resp = await continuar(E, p1);
  assert.equal(resp.screen, 'MATR_RESPONSAVEL');
  const end = await toque(E, 'MATR_RESPONSAVEL', 'enviar_responsavel', resp.data.estado, { responsavel: 'Eu' });
  await toque(E, 'MATR_ENDERECO', 'enviar_endereco', end.data.estado, END);
  // Fechou o Flow depois do endereço e entrou de novo: continua na identidade.
  const p2 = await toque(E, 'MATR_LOGIN', 'entrar', null, { login: CPF, data_nascimento: NASC });
  const ident = await continuar(E, p2);
  assert.equal(ident.screen, 'MATR_IDENTIDADE');
  // Regras da próxima tela.
  const rows = t => ({ next: { title: t, action: 'Verificar' }, rows: [{ title: 'Pré-matrícula', conclusive: true }] });
  assert.equal(proximaTela(rows('Documentos matrícula'), { responsavel: { responsavel: 'Eu' } }).tela, DOCS[0].tela);
  assert.equal(proximaTela(rows('Documentos matrícula'), { responsavel: { responsavel: 'Eu' }, documentos: { completo: true } }).tela, null, 'documentos já enviados: em análise');
  assert.deepEqual(proximaTela(rows('Contrato'), {}), { tela: 'CONTR_TERMOS', botao: 'Verificar' }, 'etapa 3: contrato');
  assert.equal(proximaTela(null, {}, true).tela, 'MATR_RESP_DADOS', 'portal lento: decide pelo Firestore');
  assert.equal(proximaTela(null, { responsavel: { responsavel: 'Outro' }, resp_dados: {} }).tela, 'MATR_ENDERECO');
});

test('Escola: busca pelo nome na lista do site (cache), escolhe e o worker envia o código da lista', async () => {
  const { E, fila, envios, listasCarregadas } = montar();
  const portal = await toque(E, 'MATR_LOGIN', 'entrar', null, { login: CPF, data_nascimento: NASC });
  const resp = await continuar(E, portal);
  const end = await toque(E, 'MATR_RESPONSAVEL', 'enviar_responsavel', resp.data.estado, { responsavel: 'Eu' });
  const ident = await toque(E, 'MATR_ENDERECO', 'enviar_endereco', end.data.estado, END);
  // O worker envia responsável e endereço e, ao abrir a identidade, guarda a lista de escolas.
  await E.worker(fila[0].id);
  assert.equal(listasCarregadas.n, 1);
  const curta = await toque(E, 'MATR_IDENTIDADE', 'buscar_escola', ident.data.estado, { ...IDENT, busca_escola: 'ro' });
  assert.match(curta.data.erro, /3 letras/);
  const busca = await toque(E, 'MATR_IDENTIDADE', 'buscar_escola', ident.data.estado, { ...IDENT, busca_escola: 'rosario maria' });
  assert.equal(busca.data.tem_escolas, true);
  assert.deepEqual(busca.data.escolas.map(o => o.id), ['E2', SEM_ESCOLA]);
  assert.ok(busca.data.escolas.every(o => o.title.length <= 30));
  assert.equal(listasCarregadas.n, 1, 'busca usa o cache');
  const sem = await toque(E, 'MATR_IDENTIDADE', 'enviar_identidade', busca.data.estado, { ...IDENT, busca_escola: 'rosario maria' });
  assert.equal(sem.screen, DOCS[0].tela, 'nome digitado sem escolher na lista não trava (vai o nome, como antes)');
  const docs = await toque(E, 'MATR_IDENTIDADE', 'enviar_identidade', busca.data.estado, { ...IDENT, busca_escola: 'rosario maria', escola: 'E2' });
  assert.equal(docs.screen, DOCS[0].tela);
  await E.worker(fila[0].id);
  const id = envios.find(e => e.tela === 'IDENTIDADE');
  assert.equal(id.dados.escola, 'E2');
  assert.deepEqual(id.dados.escolas.map(o => o.id), ['E2']);
  assert.equal(buscarEscolas(ESCOLAS_RUBEUS, 'dom bosco')[0].id, 'E3');
  assert.deepEqual(opcaoEscola(ESCOLAS_RUBEUS[0]), { id: 'E1', title: 'Escola Estadual Teste' });
});

test('Escola sem cache: a busca abre a identidade no Rubeus uma vez e guarda a lista; "Não encontrei" fica em branco', async () => {
  const r = montar();
  const portal = await toque(r.E, 'MATR_LOGIN', 'entrar', null, { login: CPF, data_nascimento: NASC });
  const resp = await continuar(r.E, portal);
  const end = await toque(r.E, 'MATR_RESPONSAVEL', 'enviar_responsavel', resp.data.estado, { responsavel: 'Eu' });
  const ident = await toque(r.E, 'MATR_ENDERECO', 'enviar_endereco', end.data.estado, END);
  r.avancar(); r.avancar(); // o worker já enviou responsável e endereço; a identidade é o passo liberado
  const busca = await toque(r.E, 'MATR_IDENTIDADE', 'buscar_escola', ident.data.estado, { ...IDENT, busca_escola: 'escola estadual' });
  assert.deepEqual(busca.data.escolas.map(o => o.id), ['E1', SEM_ESCOLA]);
  assert.equal(r.listasCarregadas.n, 1);
  const nada = await toque(r.E, 'MATR_IDENTIDADE', 'enviar_identidade', busca.data.estado, { ...IDENT, busca_escola: 'escola estadual', escola: SEM_ESCOLA });
  assert.equal(nada.screen, DOCS[0].tela);
});

test('Etapa 2 completa: subetapas e documentos gravam no Firestore e avançam na hora; o worker envia ao Rubeus em ordem e os documentos por último', async () => {
  const { E, store, fila, envios, lotes } = montar();
  const portal = await toque(E, 'MATR_LOGIN', 'entrar', null, { login: CPF, data_nascimento: NASC });
  const resp = await continuar(E, portal);
  const end = await toque(E, 'MATR_RESPONSAVEL', 'enviar_responsavel', resp.data.estado, { responsavel: 'Eu' });
  assert.equal(end.screen, 'MATR_ENDERECO');
  const id = fila[0].id;
  await E.worker(id);
  assert.deepEqual(envios.map(e => e.tela), ['RESP_FINANCEIRO'], 'responsável já vai enquanto o candidato preenche o endereço');
  assert.equal(envios[0].dados.responsavel, '1');
  const cep = await toque(E, 'MATR_ENDERECO', 'buscar_cep', end.data.estado, { cep: '65800000' });
  assert.equal(cep.data.valor_rua, 'Rua Teste');
  const ident = await toque(E, 'MATR_ENDERECO', 'enviar_endereco', end.data.estado, END);
  let tela = await toque(E, 'MATR_IDENTIDADE', 'enviar_identidade', ident.data.estado, IDENT);
  assert.equal(tela.screen, DOCS[0].tela, 'ano de conclusão em branco é aceito (opcional no site)');
  // Documentos: obrigatório sem arquivo não avança; opcionais podem ficar em branco.
  for (const d of DOCS) {
    assert.equal(tela.screen, d.tela);
    if (d.obrigatorio) {
      const sem = await toque(E, d.tela, 'enviar_documento', tela.data.estado, { arquivo: [] });
      assert.match(sem.data.erro, /Anexe/);
    }
    tela = await toque(E, d.tela, 'enviar_documento', tela.data.estado, { arquivo: d.obrigatorio || d.id === '1' ? MEDIA(d.id) : [] });
  }
  assert.equal(tela.screen, 'MATR_FIM');
  assert.match(tela.data.mensagem, /48 horas úteis/);
  await E.worker(id);
  assert.deepEqual(envios.map(e => e.tela), ['RESP_FINANCEIRO', 'ENDERECO', 'IDENTIDADE']);
  assert.equal(envios[1].dados.cidade_natal, '0907');
  assert.equal(envios[2].dados.cor_raca, '03'); assert.equal(envios[2].dados.rg, 'MA-123456');
  assert.deepEqual(lotes, [{ processo: '20383', codigos: ['1', '5', '8', '46'], tipos: ['application/pdf', 'application/pdf', 'application/pdf', 'application/pdf'] }],
    'documentos por último, num único Enviar do passo do site, na ordem do portal');
  const rec = (await store.get(id, 'matriculaFila')).record;
  assert.equal(rec.status, 'concluida');
  assert.equal(rec.blocos.documentos.arquivos, undefined, 'referências dos arquivos apagadas depois do envio');
});

test('Documentos esperam a calma depois da identidade antes de ir ao sistema acadêmico', async () => {
  const store = memoria(); const fila = []; const site = siteFalso(); const docsEnviados = site.lotes;
  const r = rubeusFalso();
  let agora = Date.now();
  const E = createEtapa2({ store, enqueue: async (id, o) => fila.push({ id, ...o }), sealState, openState, matricula: r.matricula, validCpf, log: () => {}, clock: () => agora,
    portalSite: site.portalSite, baixarMidia: site.baixarMidia, esperaDocsMs: 120000 });
  const portal = await toque(E, 'MATR_LOGIN', 'entrar', null, { login: CPF, data_nascimento: NASC });
  const resp = await continuar(E, portal);
  const end = await toque(E, 'MATR_RESPONSAVEL', 'enviar_responsavel', resp.data.estado, { responsavel: 'Eu' });
  const ident = await toque(E, 'MATR_ENDERECO', 'enviar_endereco', end.data.estado, END);
  let tela = await toque(E, 'MATR_IDENTIDADE', 'enviar_identidade', ident.data.estado, IDENT);
  for (const d of DOCS) tela = await toque(E, d.tela, 'enviar_documento', tela.data.estado, { arquivo: d.obrigatorio ? MEDIA(d.id) : [] });
  await E.worker(fila[0].id);
  assert.equal(docsEnviados.length, 0, 'identidade acabou de ir: espera');
  assert.ok(fila.at(-1).atrasoSeg > 0);
  agora += 120001;
  await E.worker(fila[0].id);
  assert.deepEqual(docsEnviados[0].codigos, ['5', '8', '46']);
});

test('Menor de 18 anos: pula a escolha e vai direto à ficha do responsável; regras de seleção', async () => {
  const hoje = new Date();
  const menor = `${hoje.getFullYear() - 16}-01-01`;
  const r = rubeusFalso();
  r.matricula.login = async () => ({ token: 't', applyment_id: '777' });
  const store = memoria();
  const E2 = createEtapa2({ store, enqueue: async () => {}, sealState, openState, matricula: r.matricula, validCpf, log: () => {} });
  const portal = await toque(E2, 'MATR_LOGIN', 'entrar', null, { login: CPF, data_nascimento: menor });
  const dados = await continuar(E2, portal);
  assert.equal(dados.screen, 'MATR_RESP_DADOS');
  const id = openState(dados.data.estado, 'MATR_RESP_DADOS').fila_id;
  const rec = await store.get(id, 'matriculaFila');
  assert.equal(rec.record.blocos.responsavel.responsavel, 'Outro');
  assert.equal(escolherOpcao([{ id: 'S', title: 'Solteiro' }], 'Solteiro(a)', { prefixo: 5 }), 'S');
  assert.equal(escolherOpcao([{ id: '1', title: 'Balsas' }, { id: '2', title: 'Balsas do Sul' }], 'balsas'), '1');
  assert.equal(idade('2000-12-31', new Date('2026-12-30')), 25);
});

test('Documentos pelo caminho do site: fila que falhou reabre ao entrar de novo; documento já no portal não é reenviado', async () => {
  const store = memoria(); const fila = [];
  const site = siteFalso({ jaNoPortal: ['5'] });
  const r = rubeusFalso();
  const E = createEtapa2({ store, enqueue: async (id, o) => fila.push({ id, ...o }), sealState, openState, matricula: r.matricula, validCpf, log: () => {},
    portalSite: site.portalSite, baixarMidia: site.baixarMidia, esperaDocsMs: 0 });
  const portal = await toque(E, 'MATR_LOGIN', 'entrar', null, { login: CPF, data_nascimento: NASC });
  const resp = await continuar(E, portal);
  const end = await toque(E, 'MATR_RESPONSAVEL', 'enviar_responsavel', resp.data.estado, { responsavel: 'Eu' });
  const ident = await toque(E, 'MATR_ENDERECO', 'enviar_endereco', end.data.estado, END);
  let tela = await toque(E, 'MATR_IDENTIDADE', 'enviar_identidade', ident.data.estado, IDENT);
  for (const d of DOCS) tela = await toque(E, d.tela, 'enviar_documento', tela.data.estado, { arquivo: d.obrigatorio ? MEDIA(d.id) : [] });
  const id = fila[0].id;
  const f = await store.get(id, 'matriculaFila');
  await store.update(id, { ...f.record, status: 'falhou', tentativas: 6 }, f.version, 'matriculaFila');
  await E.worker(id);
  assert.equal(site.lotes.length, 0, 'fila que falhou não roda sozinha');
  const n = fila.length;
  await toque(E, 'MATR_LOGIN', 'entrar', null, { login: CPF, data_nascimento: NASC });
  assert.equal(fila.length, n + 1, 'entrar de novo reabre e agenda o worker');
  await E.worker(id);
  assert.deepEqual(site.lotes.map(l => l.codigos), [['8', '46']], 'o Histórico (5) já estava em análise no portal');
  const rec = (await store.get(id, 'matriculaFila')).record;
  assert.equal(rec.status, 'concluida');
  assert.deepEqual(Object.keys(rec.enviados_docs).sort(), ['46', '5', '8']);
});

test('Passo de documentos do site: leitura da estrutura real e corpo do "Enviar" igual ao do site', async () => {
  const { lerPassoDocumentos, montarEnvio } = await import('../api/portal-site.js');
  const linha = (c, d, o) => ({ CODTIPODOCUMENTO: c, DESCRICAODOCUMENTO: d, OBRIGATORIO: o, CHAVERM: `1;80;27.1.9;${c}`, STATUS: null });
  // Estrutura conferida ao vivo em 16/11/2026 (getApplymentDataByStep/300671), valores pessoais trocados.
  const resp = { success: true, data: { steps: { currentStep: { id: 300671, stage_id: 261006, content: [
    { id: 3940442, type: 'text' },
    { id: 3940443, type: 'container', container_content: [{ id: 3940444, type: 'text' },
      { id: 3940446, type: 'upload', field_id_related_to_component: 38733, type_file_field_id_to_save_upload: 38733, upload_max_size: 5, related_component_id: 174895,
        upload_content: [linha('1', 'CARTEIRA DE IDENTIDADE', '0'), linha('5', 'HISTÓRICO ENSINO MÉDIO', '1'), linha('46', 'DECLARAÇÃO DE CONCLUSÃO ENSINO MÉDIO', '1')] }] },
    { id: 3940447, type: 'container', container_content: [
      { id: 3940448, type: 'button', label: 'Portal do candidato', store_data: 0, related_component_id: 174878 },
      { id: 3940449, type: 'button', label: 'Enviar', store_data: 1, related_component_id: 174896 }] }
  ] } } } };
  const passo = lerPassoDocumentos(resp);
  assert.equal(passo.botao, 3940449); assert.equal(passo.botao_relacionado, 174896);
  assert.equal(passo.componente, 3940446); assert.equal(passo.campo, 38733); assert.equal(passo.stage_id, 261006);
  assert.deepEqual(passo.docs.map(d => [d.codigo, d.obrigatorio]), [['1', false], ['5', true], ['46', true]]);
  const { fd, data } = montarEnvio({ passo, sessao: { token: 'tk', session_id: 'sid' }, processo: '20383',
    arquivos: [{ codigo: '5', bytes: Buffer.from('a'), nome: 'hist.pdf', tipo: 'application/pdf' }, { codigo: '46', bytes: Buffer.from('b'), nome: 'decl.png', tipo: 'image/png' }] });
  assert.equal(fd.get('button_id'), '3940449'); assert.equal(fd.get('related_component_id'), '174896');
  assert.equal(fd.get('last_place_id'), '300671'); assert.equal(fd.get('stage_id'), '261006'); assert.equal(fd.get('selective_process_id'), '20383');
  assert.equal(fd.get('domainParams'), 'presencial'); assert.equal(fd.get('rbParams'), 'null'); assert.equal(fd.get('token'), 'tk');
  assert.equal(fd.get('file_0').name, 'hist.pdf'); assert.equal(fd.get('file_1').type, 'image/png');
  const itens = data[0].value;
  assert.equal(data[0].field_id, 38733); assert.equal(data[0].component_id, 3940446); assert.equal(data[0].type, 'upload');
  assert.deepEqual(itens.map(i => i.value), [null, ['file_0'], ['file_1']], 'numeração das partes na ordem da lista');
  assert.deepEqual(itens.map(i => i.files.length), [0, 1, 1]);
  assert.equal(itens[1].CHAVERM, '1;80;27.1.9;5'); assert.equal(itens[1].title, 'HISTÓRICO ENSINO MÉDIO');
  assert.equal(JSON.parse(fd.get('data'))[0].value[2].CODIGO, '46');
});

// Rubeus com o contrato liberado (próxima etapa: Contrato, botão Verificar).
function rubeusContrato({ lento = false } = {}) {
  const r = rubeusFalso();
  r.matricula.portal = async () => {
    if (lento) await new Promise(res => setTimeout(res, 50));
    return { token: 'tok2', processo_seletivo_id: '999', stages: [
      { title: 'Inscrição', feedback: { complementary_text: 'Concluída', conclusive: 1 } },
      { title: 'Documentos matrícula', feedback: { complementary_text: 'Entregues', conclusive: 1 } },
      { title: 'Contrato', feedback: { complementary_text: 'Pendente', conclusive: 0, cta_text: 'Verificar' }, cta_link: 'presencial/passo/300669' }
    ] };
  };
  return r;
}
// Portal do candidato (site) no passo do contrato, com a estrutura conferida ao vivo em 16/11/2026.
function siteContrato() {
  const cliques = [];
  const passoResp = { success: true, data: { steps: { currentStep: { id: 300669, stage_id: 261004, content: [
    { id: 3940421, type: 'container', container_content: [
      { id: 3940422, type: 'text' },
      { id: 3940423, type: 'container', container_content: [{ id: 3940424, type: 'button', label: 'Clique aqui para fazer o download do contrato', related_component_id: 174890 }] },
      { id: 3940425, type: 'container', container_content: [{ id: 3127756, field_id: 38635, field_settings_id: 3127756, key: '38635', type: 'checkbox', ps_table: 1, label: 'Declaro que li e estou de acordo com o contrato apresentado.' }] },
      { id: 3940427, type: 'container', container_content: [{ id: 3940428, type: 'button', label: 'Portal do candidato', related_component_id: 174878 }] }] },
    { id: 3940430, type: 'container', container_content: [
      { id: 3127757, field_id: 38636, field_settings_id: 3127757, key: '38636', type: 'text', ps_table: 1, label: 'Data de assinatura do contrato' },
      { id: 3127758, field_id: 52136, field_settings_id: 3127758, key: '52136', type: 'text', ps_table: 1, label: 'IP de aceite' }] }
  ] } } } };
  const pdf = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(200, 32)]);
  const portalSite = {
    async entrar(cpf) { assert.equal(cpf, '39184720514'); return { token: 't', session_id: 's', applyment_id: '555' }; },
    async inscricao() { return { processo: '20383', stages: [{ title: 'Contrato', cta_link: 'presencial/passo/300669' }] }; },
    async passoBruto(_s, passo, processo) { assert.equal(passo, 300669); assert.equal(processo, '20383'); return passoResp; },
    async clicar(a) { cliques.push(a); return { success: true, data: { place_id: 765, place_type_id: 6, stage_id: 261004 } }; },
    async popup({ popupId, stageId }) { assert.equal(popupId, 765); assert.equal(stageId, 261004); return { success: true, data: { applicantData: [{ field_id: 52138, value: pdf.toString('base64') }] } }; }
  };
  return { portalSite, cliques, pdf, passoResp };
}

test('Etapa 3: contrato liberado abre a tela do site com link exclusivo; o link gera o contrato no portal e devolve o PDF', async () => {
  const store = memoria(); const fila = [];
  const site = siteContrato();
  const E = createEtapa2({ store, enqueue: async (id, o) => fila.push({ id, ...o }), sealState, openState, matricula: rubeusContrato().matricula, validCpf, log: () => {},
    portalSite: site.portalSite, urlPublica: 'https://run.example' });
  const portal = await toque(E, 'MATR_LOGIN', 'entrar', null, { login: CPF, data_nascimento: NASC });
  assert.equal(portal.screen, 'MATR_STATUS'); assert.match(textoStatus(portal), /❗ Contrato: Pendente \[Verificar\]/);
  const termos = await continuar(E, portal);
  assert.equal(termos.screen, 'CONTR_TERMOS');
  const m = termos.data.link_contrato.match(/^https:\/\/run\.example\/contrato\/([a-f0-9]{48})$/);
  assert.ok(m, 'link exclusivo no Cloud Run');
  const pdf = await E.baixarContrato(m[1], '200.1.2.3');
  assert.deepEqual(pdf, site.pdf);
  const c = site.cliques[0];
  assert.equal(c.passo.botao, 3940424); assert.equal(c.passo.botao_relacionado, 174890); assert.equal(c.passo.stage_id, 261004);
  assert.deepEqual(c.data.map(x => [x.field_id, x.component_id, x.key, x.type, x.value]), [
    [38635, null, 38635, 'checkbox', false], [38636, null, 38636, 'textfield', ''], [52136, null, 52136, 'textfield', '200.1.2.3'],
    [null, 3940422, '', 'content', '']], 'igual ao site: aceite falso, data vazia, IP de quem abriu e os textos do passo');
  await assert.rejects(E.baixarContrato('0'.repeat(48), '1.1.1.1'), /expirou/);
  await assert.rejects(E.baixarContrato('xyz', '1.1.1.1'), /inválido/);
});

test('Portal lento no login: mostra "Atualizar", busca o status em segundo plano e depois leva à etapa certa', async () => {
  const store = memoria(); const fila = [];
  const r = rubeusContrato();
  const lento = { ...r.matricula, portal: async () => { throw new Error('lento'); } };
  const E = createEtapa2({ store, enqueue: async (id, o) => fila.push({ id, ...o }), sealState, openState, matricula: lento, validCpf, log: () => {},
    portalSite: siteContrato().portalSite, urlPublica: 'https://run.example' });
  const p1 = await toque(E, 'MATR_LOGIN', 'entrar', null, { login: CPF, data_nascimento: NASC });
  assert.equal(p1.data.botao, 'Atualizar'); assert.match(p1.data.resumo, /buscando/);
  assert.equal(fila.at(-1).tipo, 'etapa2_status');
  const ainda = await continuar(E, p1);
  assert.equal(ainda.data.botao, 'Atualizar', 'sem status ainda: continua aguardando');
  // A tarefa em segundo plano lê o portal e guarda o status.
  const E2 = createEtapa2({ store, enqueue: async () => {}, sealState, openState, matricula: r.matricula, validCpf, log: () => {} });
  await E2.atualizarStatus(fila.at(-1).id);
  const p2 = await continuar(E, ainda);
  assert.equal(p2.screen, 'MATR_STATUS'); assert.match(textoStatus(p2), /Contrato: Pendente \[Verificar\]/);
  const termos = await continuar(E, p2);
  assert.equal(termos.screen, 'CONTR_TERMOS');
});

test('Contrato: leitura do passo e PDF do popup (portal-site)', async () => {
  const { lerPassoContrato, dadosDoContrato, pdfDoPopup } = await import('../api/portal-site.js');
  const passo = lerPassoContrato(siteContrato().passoResp);
  assert.equal(passo.botao, 3940424); assert.equal(passo.passo, 300669);
  assert.equal(dadosDoContrato(passo, '9.9.9.9').find(x => x.field_id === 52136).value, '9.9.9.9');
  assert.throws(() => pdfDoPopup({ data: { applicantData: [{ field_id: 52138, value: Buffer.from('não é pdf').toString('base64') }] } }), /PDF/);
});

test('Etapa 3 em segundo plano: o vigia espera a liberação, gera o contrato no Run e o link abre o PDF pronto, sem novo clique', async () => {
  const store = memoria(); const fila = [];
  const site = siteContrato();
  let liberado = false;
  const inscricao = site.portalSite.inscricao;
  site.portalSite.inscricao = async (...a) => (liberado ? inscricao(...a) : { processo: '20383', stages: [{ title: 'Contrato', cta_link: null }] });
  let agora = Date.now();
  const E = createEtapa2({ store, enqueue: async (id, o) => fila.push({ id, ...o }), sealState, openState, matricula: rubeusContrato().matricula, validCpf, log: () => {},
    portalSite: site.portalSite, urlPublica: 'https://run.example', clock: () => agora });
  const portal = await toque(E, 'MATR_LOGIN', 'entrar', null, { login: CPF, data_nascimento: NASC });
  const id = filaDe(portal);
  // Ainda em análise: confere de novo mais tarde.
  store.naHora(agora); await E.vigiarContrato(id);
  assert.equal(site.cliques.length, 0);
  assert.equal(fila.at(-1).tipo, 'etapa3_vigia'); assert.equal(fila.at(-1).atrasoSeg, 600, 'confere de novo em 10 minutos');
  // Equipe aprovou: o vigia vê a liberação, espera ~2 min (calma) e então gera o contrato
  // (IP vazio: não há navegador do candidato) e guarda.
  liberado = true;
  store.naHora(agora); await E.vigiarContrato(id);
  assert.equal(site.cliques.length, 0, 'acabou de liberar: espera o Rubeus processar');
  assert.equal(fila.at(-1).tipo, 'etapa3_vigia'); assert.ok(fila.at(-1).atrasoSeg > 60 && fila.at(-1).atrasoSeg <= 120);
  agora += 120001;
  const n = fila.length;
  store.naHora(agora); await E.vigiarContrato(id);
  assert.equal(site.cliques.length, 1);
  assert.equal(site.cliques[0].data.find(x => x.field_id === 52136).value, '');
  assert.deepEqual(fila.slice(n).map(f => f.tipo), ['etapa4_vigia'], 'pronto: o vigia do contrato para e passa a vigiar o pagamento/matrícula');
  // O candidato entra, toca em Verificar e abre o link: PDF na hora, sem clicar de novo no portal.
  const termos = await continuar(E, portal);
  assert.equal(termos.screen, 'CONTR_TERMOS');
  const token = termos.data.link_contrato.split('/').pop();
  const pdf = await E.baixarContrato(token, '200.1.2.3');
  assert.deepEqual(pdf, site.pdf);
  assert.equal(site.cliques.length, 1, 'usou o contrato já gerado');
});

test('Documentos entregues: o vigia do contrato é agendado', async () => {
  const { E, fila } = montar();
  const portal = await toque(E, 'MATR_LOGIN', 'entrar', null, { login: CPF, data_nascimento: NASC });
  const resp = await continuar(E, portal);
  const end = await toque(E, 'MATR_RESPONSAVEL', 'enviar_responsavel', resp.data.estado, { responsavel: 'Eu' });
  const ident = await toque(E, 'MATR_ENDERECO', 'enviar_endereco', end.data.estado, END);
  let tela = await toque(E, 'MATR_IDENTIDADE', 'enviar_identidade', ident.data.estado, IDENT);
  for (const d of DOCS) tela = await toque(E, d.tela, 'enviar_documento', tela.data.estado, { arquivo: d.obrigatorio ? MEDIA(d.id) : [] });
  await E.worker(fila[0].id);
  assert.ok(fila.some(f => f.tipo === 'etapa3_vigia' && f.atrasoSeg > 0));
});

test('Link aberto enquanto o Run gera o contrato: espera o PDF pronto, sem gerar em paralelo', async () => {
  const store = memoria(); const fila = [];
  const site = siteContrato();
  let outraGeracao = null;
  const E = createEtapa2({ store, enqueue: async (id, o) => fila.push({ id, ...o }), sealState, openState, matricula: rubeusContrato().matricula, validCpf, log: () => {},
    portalSite: site.portalSite, urlPublica: 'https://run.example', esperaContratoMs: 10000,
    dormir: async () => { if (outraGeracao) { await outraGeracao(); outraGeracao = null; } } });
  const portal = await toque(E, 'MATR_LOGIN', 'entrar', null, { login: CPF, data_nascimento: NASC });
  const id = filaDe(portal);
  const termos = await continuar(E, portal);
  assert.equal(fila.at(-1).tipo, 'etapa3_gerar', 'tocar em Verificar já pede a geração');
  // A geração pedida está em andamento (trava no Firestore) quando o candidato abre o link.
  const f = await store.get(id, 'matriculaFila');
  await store.update(id, { ...f.record, contrato_gerando_ate: Date.now() + 60000 }, f.version, 'matriculaFila');
  outraGeracao = async () => {
    const a = await store.get(id, 'matriculaFila');
    await store.update(id, { ...a.record, contrato_gerando_ate: 0 }, a.version, 'matriculaFila');
    await store.create(id, { pdf: site.pdf.toString('base64'), criado: Date.now(), expires: Date.now() + 86400000 }, 'contratos');
  };
  const pdf = await E.baixarContrato(termos.data.link_contrato.split('/').pop(), '1.2.3.4');
  assert.deepEqual(pdf, site.pdf);
  assert.equal(site.cliques.length, 0, 'não gerou de novo em paralelo');
  // E o vigia não gera por cima de uma geração em andamento.
  const g = await store.get(id, 'matriculaFila');
  await store.update(id, { ...g.record, contrato_gerando_ate: Date.now() + 60000 }, g.version, 'matriculaFila');
  await store.update(id, { pdf: '', expires: 0 }, (await store.get(id, 'contratos')).version, 'contratos');
  store.naHora(); await E.vigiarContrato(id, { imediato: true });
  assert.equal(site.cliques.length, 0);
});

test('Status igual ao portal: uma linha por etapa, botão só nas abertas; etapa ainda fora do Flow mostra a orientação do site', async () => {
  const store = memoria();
  const r = rubeusFalso();
  r.matricula.portal = async () => ({ token: 't', processo_seletivo_id: '20383', stages: [
    { title: 'Inscrição', feedback: { complementary_text: 'Concluída', conclusive: 1 } },
    { title: 'Contrato', feedback: { complementary_text: 'Concluído', conclusive: 1 } },
    { title: 'Pagamento - Taxa de matrícula', feedback: { complementary_text: 'Pendente', conclusive: 0, cta_text: 'Pagar' }, cta_link: 'presencial/passo/300670' },
    { title: 'Matriculado', feedback: { complementary_text: 'Existem pendências', conclusive: 0 } }
  ] });
  const E = createEtapa2({ store, enqueue: async () => {}, sealState, openState, matricula: r.matricula, validCpf, log: () => {} });
  const st = await toque(E, 'MATR_LOGIN', 'entrar', null, { login: CPF, data_nascimento: NASC });
  assert.equal(st.screen, 'MATR_STATUS');
  assert.equal(textoStatus(st), '✅ Inscrição: Concluída\n✅ Contrato: Concluído\n❗ Pagamento - Taxa de matrícul: Pendente [Pagar]\n❗ Matriculado: Existem pendências');
  const pag = await continuar(E, st);
  assert.equal(pag.screen, 'MATR_FIM'); assert.match(pag.data.mensagem, /Estamos finalizando! .*Pix ou Cartão de crédito/s);
  const nada = await continuar(E, st, /Matriculado/);
  assert.equal(nada.screen, 'MATR_STATUS');
});

test('Etapa final: o vigia registra o pagamento liberado e a matrícula concluída (Pagamento Recebido / Matriculado Parabéns!)', async () => {
  const store = memoria(); const fila = [];
  let fase = 'pendente';
  const etapas = () => [
    { title: 'Contrato', feedback: { complementary_text: 'Assinado', conclusive: 1, cta_text: 'Verificar' }, cta_link: 'presencial/passo/300669' },
    fase === 'pendente'
      ? { title: 'Pagamento', feedback: { complementary_text: 'Pendente', conclusive: 0, cta_text: 'Verificar' }, cta_link: 'presencial/passo/300670' }
      : { title: 'Pagamento', feedback: { complementary_text: 'Recebido', conclusive: 1, cta_text: 'null' }, cta_link: 'presencial/passo/300670' },
    fase === 'pendente'
      ? { title: 'Matriculado', feedback: { complementary_text: 'Existem pendências', conclusive: 0 } }
      : { title: 'Matriculado', feedback: { complementary_text: 'Parabéns!', conclusive: 1 } }
  ];
  const site = siteContrato();
  site.portalSite.inscricao = async () => ({ processo: '20383', stages: etapas() });
  const E = createEtapa2({ store, enqueue: async (id, o) => fila.push({ id, ...o }), sealState, openState, matricula: rubeusContrato().matricula, validCpf, log: () => {},
    portalSite: site.portalSite, urlPublica: 'https://run.example' });
  const portal = await toque(E, 'MATR_LOGIN', 'entrar', null, { login: CPF, data_nascimento: NASC });
  const id = filaDe(portal);
  // Contrato já assinado no portal: o vigia do contrato não gera de novo e passa para o vigia final.
  store.naHora(); await E.vigiarContrato(id);
  assert.equal(site.cliques.length, 0, 'contrato assinado não é gerado de novo');
  assert.equal(fila.at(-1).tipo, 'etapa4_vigia');
  store.naHora(); await E.vigiarFinal(id);
  let rec = (await store.get(id, 'matriculaFila')).record;
  assert.ok(rec.pagamento_liberado_em, 'pagamento liberado registrado (momento da mensagem de pagamento)');
  assert.ok(!rec.matricula_concluida_em);
  assert.equal(fila.at(-1).tipo, 'etapa4_vigia'); assert.equal(fila.at(-1).atrasoSeg, 3600);
  // Pago: Pagamento Recebido e Matriculado Parabéns! — a jornada termina.
  fase = 'pago';
  const n = fila.length;
  store.naHora(); await E.vigiarFinal(id);
  rec = (await store.get(id, 'matriculaFila')).record;
  assert.ok(rec.matricula_concluida_em, 'matrícula concluída registrada');
  assert.equal(fila.length, n, 'concluída: o vigia para');
  // Status no Flow: as duas linhas com ✅, igual ao site.
  const st = await toque(E, 'MATR_LOGIN', 'entrar', null, { login: CPF, data_nascimento: NASC });
  assert.equal(st.screen, 'MATR_STATUS');
});

test('Avisos (Blip): contrato liberado avisa uma vez; pagamento liberado gera o Pix e manda a cobrança; matrícula concluída avisa', async () => {
  const { PIX, passoPagamento } = await import('./pagamento-fixture.js');
  const store = memoria(); const fila = [];
  let agora = Date.UTC(2026, 10, 16, 12);
  const enviados = [];
  const avisos = {
    configurado: { atualizacao: () => true, cobranca: () => true },
    async atualizacao(d) { enviados.push({ tipo: 'atualizacao', ...d }); return true; },
    async cobranca(d) { enviados.push({ tipo: 'cobranca', ...d }); return true; }
  };
  const site = siteContrato();
  site.passoResp.data.steps.currentStep.applicantData = [{ field_id: 38544, value: 'MARIA DA SILVA' }, { field_id: 38546, value: '99988880001' }];
  let fase = 'contrato';
  const etapas = () => [
    { title: 'Contrato', feedback: fase === 'contrato' ? { complementary_text: 'Pendente', conclusive: 0, cta_text: 'Verificar' } : { complementary_text: 'Assinado', conclusive: 1, cta_text: 'Verificar' }, cta_link: 'presencial/passo/300669' },
    fase === 'pago' ? { title: 'Pagamento', feedback: { complementary_text: 'Recebido', conclusive: 1, cta_text: 'null' }, cta_link: 'presencial/passo/300670' }
      : { title: 'Pagamento', feedback: { complementary_text: 'Pendente', conclusive: 0, cta_text: fase === 'contrato' ? 'null' : 'Verificar' }, cta_link: 'presencial/passo/300670' },
    { title: 'Matriculado', feedback: fase === 'pago' ? { complementary_text: 'Parabéns!', conclusive: 1 } : { complementary_text: 'Existem pendências', conclusive: 0 } }
  ];
  const cliquesPix = [];
  site.portalSite.inscricao = async () => ({ processo: '20383', stages: etapas() });
  site.portalSite.passoBruto = async (_s, passo) => (passo === 300670 ? passoPagamento() : site.passoResp);
  const clicarContrato = site.portalSite.clicar, popupContrato = site.portalSite.popup;
  site.portalSite.clicar = async a => (a.passo.passo === 300670 ? (cliquesPix.push(a), { success: true, data: { place_id: 1016, place_type_id: 6, stage_id: 261005 } }) : clicarContrato(a));
  site.portalSite.popup = async a => (a.popupId === 1016 ? { success: true, data: { applicantData: [{ field_id: 50901, value: PIX }] } } : popupContrato(a));
  const E = createEtapa2({ store, enqueue: async (id, o) => fila.push({ id, ...o }), sealState, openState, matricula: rubeusContrato().matricula, validCpf, log: () => {},
    portalSite: site.portalSite, urlPublica: 'https://run.example', clock: () => agora, avisos });
  const id = filaDe(await toque(E, 'MATR_LOGIN', 'entrar', null, { login: CPF, data_nascimento: NASC }));
  // Aqui o vigia começou com os documentos ainda em análise (quem já vê o contrato aberto no login não recebe o aviso).
  { const a = await store.get(id, 'matriculaFila'); assert.ok(a.record.avisos.contrato_liberado); delete a.record.avisos; await store.update(id, a.record, a.version, 'matriculaFila'); }

  // Contrato liberado: calma de ~2 min, gera e avisa (documentos aprovados → baixar o contrato).
  store.naHora(agora); await E.vigiarContrato(id);
  assert.equal(enviados.length, 0, 'na calma ainda não avisa');
  agora += 3 * 60000;
  store.naHora(agora); await E.vigiarContrato(id);
  assert.equal(enviados.length, 1);
  assert.equal(enviados[0].tipo, 'atualizacao'); assert.equal(enviados[0].celular, '99988880001'); assert.match(enviados[0].situacao, /documentos .* aprovados/);
  store.naHora(agora); await E.vigiarContrato(id);
  assert.equal(enviados.length, 1, 'aviso do contrato sai uma vez só');

  // Contrato assinado e Pagamento com "Verificar": gera o Pix como o site e manda a cobrança.
  fase = 'pagamento';
  store.naHora(agora); await E.vigiarFinal(id);
  assert.equal(cliquesPix.length, 1);
  assert.equal(cliquesPix[0].passo.botao, 3940437);
  assert.equal(cliquesPix[0].data.find(x => x.field_id === 38702).value, 'P');
  const cob = enviados.at(-1);
  assert.equal(cob.tipo, 'cobranca'); assert.equal(cob.codigoPix, PIX); assert.equal(cob.centavos, 39000); assert.equal(cob.referencia, 'mat-544149'); assert.equal(cob.recebedor, 'UNIBALSAS');
  let rec = (await store.get(id, 'matriculaFila')).record;
  assert.ok(rec.pagamento_liberado_em && rec.cobranca_enviada_em);
  store.naHora(agora); await E.vigiarFinal(id);
  assert.equal(enviados.filter(e => e.tipo === 'cobranca').length, 1, 'cobrança sai uma vez só');
  assert.equal(cliquesPix.length, 1, 'não gera outro Pix');

  // Pago: matrícula concluída → aviso final, e o vigia para.
  fase = 'pago';
  const n = fila.length;
  store.naHora(agora); await E.vigiarFinal(id);
  assert.match(enviados.at(-1).situacao, /matrícula está concluída/);
  assert.equal(fila.length, n, 'concluída: o vigia para');
  store.naHora(agora); await E.vigiarFinal(id);
  assert.equal(enviados.filter(e => /concluída/.test(e.situacao ?? '')).length, 1);
});

test('Avisos (Blip): cobrança que falha tenta de novo em 10 min, reaproveitando o mesmo Pix', async () => {
  const { PIX, passoPagamento } = await import('./pagamento-fixture.js');
  const store = memoria(); const fila = [];
  let falhar = true; const enviados = [];
  const avisos = { configurado: { atualizacao: () => true, cobranca: () => true }, async atualizacao() { return true; },
    async cobranca(d) { enviados.push(d); return !falhar; } };
  const site = siteContrato();
  let pix = 0;
  site.portalSite.inscricao = async () => ({ processo: '20383', stages: [
    { title: 'Contrato', feedback: { complementary_text: 'Assinado', conclusive: 1 }, cta_link: 'presencial/passo/300669' },
    { title: 'Pagamento', feedback: { complementary_text: 'Pendente', conclusive: 0, cta_text: 'Verificar' }, cta_link: 'presencial/passo/300670' }] });
  site.portalSite.passoBruto = async () => passoPagamento();
  site.portalSite.clicar = async () => { pix++; return { success: true, data: { place_id: 1016, place_type_id: 6, stage_id: 261005 } }; };
  site.portalSite.popup = async () => ({ success: true, data: { applicantData: [{ field_id: 50901, value: PIX }] } });
  const E = createEtapa2({ store, enqueue: async (id, o) => fila.push({ id, ...o }), sealState, openState, matricula: rubeusContrato().matricula, validCpf, log: () => {},
    portalSite: site.portalSite, urlPublica: 'https://run.example', avisos });
  const id = filaDe(await toque(E, 'MATR_LOGIN', 'entrar', null, { login: CPF, data_nascimento: NASC }));
  store.naHora(); await E.vigiarFinal(id);
  assert.equal(fila.at(-1).atrasoSeg, 600);
  falhar = false;
  store.naHora(); await E.vigiarFinal(id);
  assert.equal(enviados.length, 2); assert.equal(pix, 1, 'mesmo Pix na nova tentativa');
  assert.equal(fila.at(-1).atrasoSeg, 3600);
});

test('Vigia da redação: aguarda a correção e avisa "aprovada, matrícula liberada" uma vez só', async () => {
  const store = memoria(); const fila = []; const enviados = [];
  let fase = 'enviada';
  const avisos = { configurado: { atualizacao: () => true, cobranca: () => true }, async atualizacao(d) { enviados.push(d); return true; }, async cobranca() { return true; } };
  const stages = () => [
    { title: 'Inscrição', feedback: { complementary_text: 'Concluída', conclusive: 1 } },
    fase === 'aprovada' ? { title: 'Prova online', feedback: { complementary_text: 'Aprovado', conclusive: 1 } }
      : { title: 'Prova online', feedback: { complementary_text: fase === 'enviada' ? 'Pendente' : 'Aguardando correção', conclusive: 0, cta_text: fase === 'enviada' ? 'Realizar prova' : 'null' }, cta_link: 'presencial/passo/300663' },
    { title: 'Resp. financeiro menor 18', feedback: fase === 'aprovada' ? { complementary_text: 'Pendente', conclusive: 0, cta_text: 'Verificar' } : { complementary_text: 'Pendente', conclusive: 0, cta_text: 'null' }, cta_link: 'presencial/passo/300676' }
  ];
  const portalSite = { async entrar() { return { token: 't' }; }, async inscricao() { return { processo: '20383', stages: stages() }; } };
  const E = createEtapa2({ store, enqueue: async (id, o) => fila.push({ id, ...o }), sealState, openState, matricula: rubeusContrato().matricula, validCpf, log: () => {}, portalSite, avisos });
  assert.equal(await E.iniciarVigiaRedacao({ login: '391.847.205-14', data_nascimento: NASC, celular: '(99) 98888-0001', nome: 'Maria' }), true);
  const id = fila.at(-1).id;
  assert.equal(fila.at(-1).tipo, 'redacao_vigia'); assert.equal(fila.at(-1).atrasoSeg, 600);
  // Logo após o envio o portal ainda pode mostrar a prova pendente com o botão: não é reprovação.
  store.naHora(); await E.vigiarRedacao(id);
  assert.equal(enviados.length, 0);
  fase = 'correcao';
  store.naHora(); await E.vigiarRedacao(id);
  assert.equal(enviados.length, 0);
  fase = 'aprovada';
  store.naHora(); await E.vigiarRedacao(id);
  assert.equal(enviados.length, 1);
  assert.equal(enviados[0].celular, '99988880001'); assert.match(enviados[0].situacao, /aprovado/); assert.match(enviados[0].proximo, /responsável financeiro/);
  const n = fila.length;
  store.naHora(); await E.vigiarRedacao(id);
  assert.equal(enviados.length, 1, 'aviso sai uma vez'); assert.equal(fila.length, n, 'vigia para');
});

test('Vigia da redação: reprovada (sai da correção sem concluir e volta o botão) avisa que pode refazer', async () => {
  const store = memoria(); const fila = []; const enviados = [];
  let fase = 'correcao';
  const avisos = { configurado: { atualizacao: () => true }, async atualizacao(d) { enviados.push(d); return true; } };
  const portalSite = { async entrar() { return { token: 't' }; }, async inscricao() { return { processo: '20383', stages: [
    { title: 'Prova online', feedback: fase === 'correcao' ? { complementary_text: 'Aguardando correção', conclusive: 0, cta_text: 'null' } : { complementary_text: 'Reprovado', conclusive: 0, cta_text: 'Realizar prova' }, cta_link: 'presencial/passo/300663' }] }; },
    async pagina() { return { data: { page: { applicantData: [{ field_id: 38544, value: 'JOÃO' }, { field_id: 38546, value: '99988880002' }] } } }; } };
  const E = createEtapa2({ store, enqueue: async (id, o) => fila.push({ id, ...o }), sealState, openState, matricula: rubeusContrato().matricula, validCpf, log: () => {}, portalSite, avisos });
  // Entrou pelo login (sem celular guardado): o celular vem da página "Meus dados".
  await E.iniciarVigiaRedacao({ login: '39184720514', data_nascimento: NASC });
  const id = fila.at(-1).id;
  store.naHora(); await E.vigiarRedacao(id);
  fase = 'reprovada';
  store.naHora(); await E.vigiarRedacao(id);
  assert.equal(enviados.length, 1);
  assert.equal(enviados[0].celular, '99988880002'); assert.match(enviados[0].situacao, /não atingiu/);
});

// ------------------------------------------------------------------ vigias: uma corrente, sem perda, para todos (2.12.1)
test('Vigias: abrir o contrato várias vezes não multiplica correntes; tarefa de corrente antiga sai sem reagendar; execução em paralelo é adiada', async () => {
  const store = memoria(); const fila = [];
  const site = siteContrato();
  let agora = Date.UTC(2026, 10, 17, 12);
  const E = createEtapa2({ store, enqueue: async (id, o) => fila.push({ id, ...o }), sealState, openState, matricula: rubeusContrato().matricula, validCpf, log: () => {},
    portalSite: site.portalSite, urlPublica: 'https://run.example', clock: () => agora });
  const id = filaDe(await toque(E, 'MATR_LOGIN', 'entrar', null, { login: CPF, data_nascimento: NASC }));
  const conta = tipo => fila.filter(f => f.tipo === tipo).length;
  assert.equal(conta('etapa3_vigia'), 1, 'o login liga o vigia do contrato uma vez');
  // O candidato abre o contrato 3 vezes e o PDF guardado some (vencido): gera de novo, mas a corrente final é uma só.
  for (let i = 0; i < 3; i++) {
    await E.vigiarContrato(id, { imediato: true });
    const c = await store.get(id, 'contratos');
    await store.update(id, { ...c.record, expires: 0 }, c.version, 'contratos');
    agora += 60000;
  }
  assert.equal(site.cliques.length, 3);
  assert.equal(conta('etapa4_vigia'), 1, 'uma corrente do vigia final');
  assert.equal(conta('etapa3_vigia'), 1, 'pedido do candidato não cria corrente do contrato');
  // Tarefa que chega antes do horário agendado é de corrente antiga: não confere nem reagenda.
  const n = fila.length;
  assert.equal(await E.vigiarFinal(id), 204);
  assert.equal(fila.length, n);
  // Outra conferência em andamento: 503 (o Cloud Tasks entrega de novo depois), sem rodar em paralelo.
  store.naHora(agora);
  const a = await store.get(id, 'matriculaFila');
  await store.update(id, { ...a.record, final_rodando_ate: agora + 60000 }, a.version, 'matriculaFila');
  assert.equal(await E.vigiarFinal(id), 503);
  assert.equal(fila.length, n);
  // Trava vencida: confere e segue a corrente.
  agora += 61000;
  assert.equal(await E.vigiarFinal(id), 204);
  assert.equal(fila.length, n + 1); assert.equal(fila.at(-1).tipo, 'etapa4_vigia');
  assert.equal((await store.get(id, 'matriculaFila')).record.final_rodando_ate, 0, 'trava liberada no fim');
});

test('Vigias: falha passageira do Cloud Tasks não encerra a corrente; falha repetida pede nova entrega; o registro não expira no meio', async () => {
  const store = memoria(); const fila = []; let falhas = 0;
  const site = siteContrato();
  site.portalSite.inscricao = async () => ({ processo: '20383', stages: [{ title: 'Contrato', cta_link: null }] }); // ainda em análise
  let agora = Date.UTC(2026, 10, 17, 12);
  const erros = []; const erroOriginal = console.error; console.error = m => erros.push(m);
  try {
    const E = createEtapa2({ store, enqueue: async (id, o) => { if (falhas > 0) { falhas--; throw new Error('tasks fora'); } fila.push({ id, ...o }); }, sealState, openState,
      matricula: rubeusContrato().matricula, validCpf, log: () => {}, portalSite: site.portalSite, urlPublica: 'https://run.example', clock: () => agora });
    const id = filaDe(await toque(E, 'MATR_LOGIN', 'entrar', null, { login: CPF, data_nascimento: NASC }));
    // Uma falha: tenta de novo na hora e a corrente segue.
    falhas = 1; let n = fila.length;
    store.naHora(agora); assert.equal(await E.vigiarContrato(id), 204);
    assert.equal(fila.length, n + 1); assert.equal(fila.at(-1).tipo, 'etapa3_vigia');
    // Duas falhas seguidas: erro de agendamento (o worker devolve 500 e o Cloud Tasks repete a tarefa).
    agora += 600000; falhas = 2; n = fila.length;
    await assert.rejects(() => E.vigiarContrato(id), e => e.agendar === true);
    assert.equal(fila.length, n);
    assert.match(erros.join('\n'), /vigia_atencao/);
    assert.ok(!erros.join('\n').includes('39184720514'), 'sem CPF no alerta');
    // A repetição da mesma tarefa passa e reagenda.
    assert.equal(await E.vigiarContrato(id), 204);
    assert.equal(fila.length, n + 1);
    const rec = (await store.get(id, 'matriculaFila')).record;
    assert.ok(rec.expires >= rec.vigia_proxima.etapa3_vigia + 7 * 86400000, 'prazo do registro acompanha o vigia');
  } finally { console.error = erroOriginal; }
});

test('Login liga o vigia certo também para quem não entregou os documentos pelo Flow, sem duplicar', async () => {
  const montar = stages => {
    const store = memoria(); const fila = [];
    const r = rubeusFalso();
    r.matricula.portal = async () => ({ token: 'tok2', processo_seletivo_id: '20383', stages });
    const E = createEtapa2({ store, enqueue: async (id, o) => fila.push({ id, ...o }), sealState, openState, matricula: r.matricula, validCpf, log: () => {},
      portalSite: siteContrato().portalSite, urlPublica: 'https://run.example' });
    const entrar = () => toque(E, 'MATR_LOGIN', 'entrar', null, { login: CPF, data_nascimento: NASC });
    return { store, fila, entrar };
  };
  const ok = (title, texto = 'Concluída') => ({ title, feedback: { complementary_text: texto, conclusive: 1 } });
  const parada = (title, texto) => ({ title, feedback: { complementary_text: texto, conclusive: 0 } });
  const abertaEm = (title, passo) => ({ title, feedback: { complementary_text: 'Pendente', conclusive: 0, cta_text: 'Verificar' }, cta_link: 'presencial/passo/' + passo });

  // Documentos em análise (enviados pelo site): vigia do contrato, uma vez.
  let c = montar([ok('Inscrição'), ok('Pré-matrícula'), parada('Documentos matrícula', 'Em análise'), parada('Contrato', 'Aguardando documentação')]);
  let id = filaDe(await c.entrar());
  await c.entrar();
  assert.deepEqual(c.fila.map(f => [f.tipo, f.atrasoSeg]), [['etapa3_vigia', 600]]);
  assert.ok(!(await c.store.get(id, 'matriculaFila')).record.avisos?.contrato_liberado, 'vai avisar quando os documentos forem aprovados');

  // Contrato assinado e pagamento pendente: vigia final (cobrança), uma vez.
  c = montar([ok('Inscrição'), ok('Documentos matrícula', 'Aprovados'), ok('Contrato', 'Assinado'), abertaEm('Pagamento', 300670), parada('Matriculado', 'Existem pendências')]);
  id = filaDe(await c.entrar());
  await c.entrar();
  assert.deepEqual(c.fila.map(f => f.tipo), ['etapa4_vigia']);
  assert.ok((await c.store.get(id, 'matriculaFila')).record.final_vigiando);

  // Ainda preenchendo a matrícula: nenhum vigia.
  c = montar([ok('Inscrição'), abertaEm('Pré-matrícula', 300676), parada('Documentos matrícula', 'Pendente'), parada('Contrato', 'Aguardando documentação')]);
  await c.entrar();
  assert.deepEqual(c.fila.filter(f => /vigia/.test(f.tipo)), []);

  // Matrícula concluída: nenhum vigia.
  c = montar([ok('Inscrição'), ok('Documentos matrícula'), ok('Contrato'), ok('Pagamento', 'Recebido'), ok('Matriculado', 'Parabéns!')]);
  await c.entrar();
  assert.deepEqual(c.fila.filter(f => /vigia/.test(f.tipo)), []);
});

// ------------------------------------------------------------------ 2.12.2: C9, C4, C5
test('C9: worker ocupado reagenda em 30 s; login retoma bloco gravado sem worker', async () => {
  const { E, store, fila } = montar();
  const portal = await toque(E, 'MATR_LOGIN', 'entrar', null, { login: CPF, data_nascimento: NASC });
  const resp = await continuar(E, portal);
  await toque(E, 'MATR_RESPONSAVEL', 'enviar_responsavel', resp.data.estado, { responsavel: 'Eu' });
  const id = fila.find(f => f.tipo === 'etapa2').id;
  // Trava ativa: a tarefa não some, volta em 30 s.
  let a = await store.get(id, 'matriculaFila');
  await store.update(id, { ...a.record, rodando_ate: Date.now() + 60000 }, a.version, 'matriculaFila');
  let n = fila.length;
  assert.equal(await E.worker(id), 204);
  assert.deepEqual(fila.slice(n).map(f => [f.tipo, f.atrasoSeg]), [['etapa2', 30]]);
  // Agendamento perdido (trava vencida, bloco sem envio): entrar de novo agenda o envio.
  a = await store.get(id, 'matriculaFila');
  await store.update(id, { ...a.record, rodando_ate: 0 }, a.version, 'matriculaFila');
  n = fila.length;
  await toque(E, 'MATR_LOGIN', 'entrar', null, { login: CPF, data_nascimento: NASC });
  assert.ok(fila.slice(n).some(f => f.tipo === 'etapa2'), 'login retoma o envio');
  // Tudo enviado: login não agenda de novo.
  await E.worker(id);
  n = fila.length;
  await toque(E, 'MATR_LOGIN', 'entrar', null, { login: CPF, data_nascimento: NASC });
  assert.ok(!fila.slice(n).some(f => f.tipo === 'etapa2'), 'sem envio repetido');
});

test('C4: Rubeus fora do ar mostra "indisponível"; dados errados continuam "não encontramos"; uma escrita no login', async () => {
  for (const [erro, esperado] of [
    [new Error('fetch failed'), /indisponível/],
    [new Error('A consulta demorou.'), /indisponível/],
    [new Error('[RUBEUS_ERRO] /login não confirmou a operação (HTTP 502). '), /indisponível/],
    [new Error('[RUBEUS_ERRO] /login não confirmou a operação (HTTP 401). '), /Não encontramos/],
    [new Error('Não encontramos uma inscrição com esses dados.'), /Não encontramos/]
  ]) {
    const store = memoria();
    const E = createEtapa2({ store, enqueue: async () => {}, sealState, openState, validCpf, log: () => {},
      matricula: { ...rubeusFalso().matricula, login: async () => { throw erro; } } });
    const t = await toque(E, 'MATR_LOGIN', 'entrar', null, { login: CPF, data_nascimento: NASC });
    assert.equal(t.screen, 'MATR_LOGIN'); assert.match(t.data.erro, esperado, erro.message);
  }
  // Login com portal em dia: fila + último status gravados juntos (uma escrita).
  const store = memoria(); let escritas = 0;
  const create = store.create.bind(store), update = store.update.bind(store);
  store.create = (...a) => { escritas++; return create(...a); };
  store.update = (...a) => { escritas++; return update(...a); };
  const E = createEtapa2({ store, enqueue: async () => {}, sealState, openState, validCpf, log: () => {}, matricula: rubeusFalso().matricula });
  const id = filaDe(await toque(E, 'MATR_LOGIN', 'entrar', null, { login: CPF, data_nascimento: NASC }));
  assert.equal(escritas, 1);
  assert.ok((await store.get(id, 'matriculaFila')).record.ultimo_status?.stages?.length);
});

test('C5: aviso ou cobrança que esgota as tentativas gera alerta etapa_aviso_atencao, sem CPF nem celular', async () => {
  const { PIX, passoPagamento } = await import('./pagamento-fixture.js');
  const store = memoria(); const fila = [];
  let agora = Date.UTC(2026, 10, 16, 12);
  const avisos = { configurado: { atualizacao: () => true, cobranca: () => true }, atualizacao: async () => false, cobranca: async () => false };
  const site = siteContrato();
  site.passoResp.data.steps.currentStep.applicantData = [{ field_id: 38544, value: 'MARIA DA SILVA' }, { field_id: 38546, value: '99988880001' }];
  site.portalSite.inscricao = async () => ({ processo: '20383', stages: [
    { title: 'Contrato', feedback: { complementary_text: 'Assinado', conclusive: 1, cta_text: 'Verificar' }, cta_link: 'presencial/passo/300669' },
    { title: 'Pagamento', feedback: { complementary_text: 'Pendente', conclusive: 0, cta_text: 'Verificar' }, cta_link: 'presencial/passo/300670' },
    { title: 'Matriculado', feedback: { complementary_text: 'Existem pendências', conclusive: 0 } }] });
  site.portalSite.passoBruto = async (_s, passo) => (passo === 300670 ? passoPagamento() : site.passoResp);
  site.portalSite.clicar = async () => ({ success: true, data: { place_id: 1016, place_type_id: 6, stage_id: 261005 } });
  site.portalSite.popup = async () => ({ success: true, data: { applicantData: [{ field_id: 50901, value: PIX }] } });
  const erros = []; const erroOriginal = console.error; console.error = m => erros.push(String(m));
  try {
    const E = createEtapa2({ store, enqueue: async (id, o) => fila.push({ id, ...o }), sealState, openState, matricula: rubeusContrato().matricula, validCpf, log: () => {},
      portalSite: site.portalSite, urlPublica: 'https://run.example', clock: () => agora, avisos });
    const id = filaDe(await toque(E, 'MATR_LOGIN', 'entrar', null, { login: CPF, data_nascimento: NASC }));
    for (let i = 0; i < 6; i++) { store.naHora(agora); await E.vigiarFinal(id); agora += 3600000; }
    const alertas = erros.filter(e => e.includes('etapa_aviso_atencao'));
    assert.equal(alertas.length, 1, 'um alerta, na 5ª falha');
    assert.match(alertas[0], /cobranca/);
    assert.ok(!alertas[0].includes('39184720514') && !alertas[0].includes('99988880001'));
  } finally { console.error = erroOriginal; }
});

test('C10: toque em "Pagamento" com a cobrança pelo WhatsApp: agenda o Pix em 5 s; depois de enviado, avisa que foi por mensagem', async () => {
  const store = memoria(); const fila = [];
  const r = rubeusFalso();
  r.matricula.portal = async () => ({ token: 't', processo_seletivo_id: '20383', stages: [
    { title: 'Contrato', feedback: { complementary_text: 'Concluído', conclusive: 1 } },
    { title: 'Pagamento - Taxa de matrícula', feedback: { complementary_text: 'Pendente', conclusive: 0, cta_text: 'Pagar' }, cta_link: 'presencial/passo/300670' },
    { title: 'Matriculado', feedback: { complementary_text: 'Existem pendências', conclusive: 0 } }
  ] });
  const avisos = { configurado: { atualizacao: () => true, cobranca: () => true }, atualizacao: async () => true, cobranca: async () => true };
  const E = createEtapa2({ store, enqueue: async (id, o) => fila.push({ id, ...o }), sealState, openState, matricula: r.matricula, validCpf, log: () => {}, avisos });
  const st = await toque(E, 'MATR_LOGIN', 'entrar', null, { login: CPF, data_nascimento: NASC });
  const id = filaDe(st);
  const n = fila.length;
  const pag = await continuar(E, st);
  assert.equal(pag.screen, 'MATR_FIM'); assert.match(pag.data.mensagem, /Pix .*em instantes/);
  assert.deepEqual(fila.slice(n).map(f => [f.tipo, f.atrasoSeg]), [['etapa4_vigia', 5]]);
  const a = await store.get(id, 'matriculaFila');
  await store.update(id, { ...a.record, cobranca_enviada_em: Date.now() }, a.version, 'matriculaFila');
  const depois = await continuar(E, st);
  assert.match(depois.data.mensagem, /Enviamos o Pix .*por mensagem/);
  assert.equal(fila.length, n + 1, 'não agenda de novo');
});
