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
    async update(id, record, version, c = 'x') { const x = db.get(k(c, id)); if (!x || x.version !== version) return false; db.set(k(c, id), { record: structuredClone(record), version: 'v' + (++v) }); return true; }
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

function montar(opts) {
  const store = memoria();
  const fila = [];
  const docsEnviados = [];
  const r = rubeusFalso(opts);
  const E = createEtapa2({ store, enqueue: async (id, o) => fila.push({ id, ...o }), sealState, openState, matricula: r.matricula, validCpf,
    buscarCep: async () => ({ cep: '65800-000', rua: 'Rua Teste', bairro: 'Centro', cidade: 'Balsas', uf: 'MA' }), log: () => {},
    docs: { saveDocument: async a => { docsEnviados.push(a); return { primaryKey: 'pk' }; } }, academicId: id => (String(id) === '20383' ? '223' : null), esperaDocsMs: 0 });
  return { E, store, fila, docsEnviados, ...r };
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
    assert.match(JSON.stringify(t.layout), /"type":"Image"/, `${t.id} tem imagem no topo`);
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
  assert.equal(ok.screen, 'MATR_PORTAL'); assert.match(ok.data.resumo, /Prova online/);
  const s = openState(ok.data.estado, 'MATR_PORTAL');
  assert.equal((await store.get(s.fila_id, 'matriculaFila')).record.applyment_id, '555');
  const c = montar({ prova: 'Aguardando correção', conclusivo: 0, semMatricula: true });
  const espera = await toque(c.E, 'MATR_LOGIN', 'entrar', null, { login: CPF, data_nascimento: NASC });
  // Aguardando correção: a tela inicial é o status do portal; o botão só fecha o Flow.
  assert.equal(espera.screen, 'MATR_PORTAL'); assert.match(espera.data.resumo, /⏱ Prova online: Aguardando correção/);
  assert.equal(espera.data.botao, 'Fechar');
  const fechou = await toque(c.E, 'MATR_PORTAL', 'continuar', espera.data.estado);
  assert.equal(fechou.screen, 'SUCCESS');
});

test('Portal ao logar de novo: o botão leva à primeira subetapa que falta, com o texto do botão do site', async () => {
  const { E } = montar();
  const p1 = await toque(E, 'MATR_LOGIN', 'entrar', null, { login: CPF, data_nascimento: NASC });
  assert.equal(p1.data.botao, 'Continuar');
  const resp = await toque(E, 'MATR_PORTAL', 'continuar', p1.data.estado);
  assert.equal(resp.screen, 'MATR_RESPONSAVEL');
  const end = await toque(E, 'MATR_RESPONSAVEL', 'enviar_responsavel', resp.data.estado, { responsavel: 'Eu' });
  await toque(E, 'MATR_ENDERECO', 'enviar_endereco', end.data.estado, END);
  // Fechou o Flow depois do endereço e entrou de novo: continua na identidade.
  const p2 = await toque(E, 'MATR_LOGIN', 'entrar', null, { login: CPF, data_nascimento: NASC });
  const ident = await toque(E, 'MATR_PORTAL', 'continuar', p2.data.estado);
  assert.equal(ident.screen, 'MATR_IDENTIDADE');
  // Regras da próxima tela.
  const rows = t => ({ next: { title: t, action: 'Verificar' }, rows: [{ title: 'Pré-matrícula', conclusive: true }] });
  assert.equal(proximaTela(rows('Documentos matrícula'), { responsavel: { responsavel: 'Eu' } }).tela, DOCS[0].tela);
  assert.equal(proximaTela(rows('Documentos matrícula'), { responsavel: { responsavel: 'Eu' }, documentos: { completo: true } }).tela, null, 'documentos já enviados: em análise');
  assert.equal(proximaTela(rows('Contrato'), {}).tela, null, 'contrato ainda fora do Flow: só o status');
  assert.equal(proximaTela(null, {}, true).tela, 'MATR_RESP_DADOS', 'portal lento: decide pelo Firestore');
  assert.equal(proximaTela(null, { responsavel: { responsavel: 'Outro' }, resp_dados: {} }).tela, 'MATR_ENDERECO');
});

test('Escola: busca pelo nome na lista do site (cache), escolhe e o worker envia o código da lista', async () => {
  const { E, fila, envios, listasCarregadas } = montar();
  const portal = await toque(E, 'MATR_LOGIN', 'entrar', null, { login: CPF, data_nascimento: NASC });
  const resp = await toque(E, 'MATR_PORTAL', 'continuar', portal.data.estado);
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
  assert.match(sem.data.erro, /Buscar escola/);
  assert.equal(sem.data.tem_escolas, true, 'a lista continua na tela');
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
  const resp = await toque(r.E, 'MATR_PORTAL', 'continuar', portal.data.estado);
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
  const { E, store, fila, envios, docsEnviados } = montar();
  const portal = await toque(E, 'MATR_LOGIN', 'entrar', null, { login: CPF, data_nascimento: NASC });
  const resp = await toque(E, 'MATR_PORTAL', 'continuar', portal.data.estado);
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
  assert.deepEqual(docsEnviados.map(d => d.codDocumento), [1, 5, 8, 46], 'documentos por último, na ordem do portal');
  assert.ok(docsEnviados.every(d => d.cpf === '39184720514' && d.idps === '223'));
  const rec = (await store.get(id, 'matriculaFila')).record;
  assert.equal(rec.status, 'concluida');
  assert.equal(rec.blocos.documentos.arquivos, undefined, 'referências dos arquivos apagadas depois do envio');
});

test('Documentos esperam a calma depois da identidade antes de ir ao sistema acadêmico', async () => {
  const store = memoria(); const fila = []; const docsEnviados = [];
  const r = rubeusFalso();
  let agora = Date.now();
  const E = createEtapa2({ store, enqueue: async (id, o) => fila.push({ id, ...o }), sealState, openState, matricula: r.matricula, validCpf, log: () => {}, clock: () => agora,
    docs: { saveDocument: async a => { docsEnviados.push(a); return {}; } }, academicId: () => '223', esperaDocsMs: 120000 });
  const portal = await toque(E, 'MATR_LOGIN', 'entrar', null, { login: CPF, data_nascimento: NASC });
  const resp = await toque(E, 'MATR_PORTAL', 'continuar', portal.data.estado);
  const end = await toque(E, 'MATR_RESPONSAVEL', 'enviar_responsavel', resp.data.estado, { responsavel: 'Eu' });
  const ident = await toque(E, 'MATR_ENDERECO', 'enviar_endereco', end.data.estado, END);
  let tela = await toque(E, 'MATR_IDENTIDADE', 'enviar_identidade', ident.data.estado, IDENT);
  for (const d of DOCS) tela = await toque(E, d.tela, 'enviar_documento', tela.data.estado, { arquivo: d.obrigatorio ? MEDIA(d.id) : [] });
  await E.worker(fila[0].id);
  assert.equal(docsEnviados.length, 0, 'identidade acabou de ir: espera');
  assert.ok(fila.at(-1).atrasoSeg > 0);
  agora += 120001;
  await E.worker(fila[0].id);
  assert.equal(docsEnviados.length, 3);
});

test('Menor de 18 anos: pula a escolha e vai direto à ficha do responsável; regras de seleção', async () => {
  const hoje = new Date();
  const menor = `${hoje.getFullYear() - 16}-01-01`;
  const r = rubeusFalso();
  r.matricula.login = async () => ({ token: 't', applyment_id: '777' });
  const store = memoria();
  const E2 = createEtapa2({ store, enqueue: async () => {}, sealState, openState, matricula: r.matricula, validCpf, log: () => {} });
  const portal = await toque(E2, 'MATR_LOGIN', 'entrar', null, { login: CPF, data_nascimento: menor });
  const dados = await toque(E2, 'MATR_PORTAL', 'continuar', portal.data.estado);
  assert.equal(dados.screen, 'MATR_RESP_DADOS');
  const id = openState(dados.data.estado, 'MATR_RESP_DADOS').fila_id;
  const rec = await store.get(id, 'matriculaFila');
  assert.equal(rec.record.blocos.responsavel.responsavel, 'Outro');
  assert.equal(escolherOpcao([{ id: 'S', title: 'Solteiro' }], 'Solteiro(a)', { prefixo: 5 }), 'S');
  assert.equal(escolherOpcao([{ id: '1', title: 'Balsas' }, { id: '2', title: 'Balsas do Sul' }], 'balsas'), '1');
  assert.equal(idade('2000-12-31', new Date('2026-12-30')), 25);
});

test('Documentos: idps fora da tabela é descoberto na API (nunca 0); fila que falhou reabre ao entrar de novo', async () => {
  const store = memoria(); const fila = []; const docsEnviados = []; const consultas = [];
  const r = rubeusFalso();
  const E = createEtapa2({ store, enqueue: async (id, o) => fila.push({ id, ...o }), sealState, openState, matricula: r.matricula, validCpf, log: () => {},
    docs: {
      findInscription: async (idps, cpf) => { consultas.push(String(idps)); if (String(idps) !== '223' || cpf !== '39184720514') throw new Error('400'); return {}; },
      saveDocument: async a => { docsEnviados.push(a); return {}; }
    },
    academicId: () => null, idpsConhecidos: ['224', '223', '225'], esperaDocsMs: 0 });
  const portal = await toque(E, 'MATR_LOGIN', 'entrar', null, { login: CPF, data_nascimento: NASC });
  const resp = await toque(E, 'MATR_PORTAL', 'continuar', portal.data.estado);
  const end = await toque(E, 'MATR_RESPONSAVEL', 'enviar_responsavel', resp.data.estado, { responsavel: 'Eu' });
  const ident = await toque(E, 'MATR_ENDERECO', 'enviar_endereco', end.data.estado, END);
  let tela = await toque(E, 'MATR_IDENTIDADE', 'enviar_identidade', ident.data.estado, IDENT);
  for (const d of DOCS) tela = await toque(E, d.tela, 'enviar_documento', tela.data.estado, { arquivo: d.obrigatorio ? MEDIA(d.id) : [] });
  const id = fila[0].id;
  // Simula a fila que esgotou as tentativas com o idps errado.
  const f = await store.get(id, 'matriculaFila');
  await store.update(id, { ...f.record, status: 'falhou', tentativas: 6 }, f.version, 'matriculaFila');
  await E.worker(id);
  assert.equal(docsEnviados.length, 0, 'fila que falhou não roda sozinha');
  const n = fila.length;
  await toque(E, 'MATR_LOGIN', 'entrar', null, { login: CPF, data_nascimento: NASC });
  assert.equal(fila.length, n + 1, 'entrar de novo reabre e agenda o worker');
  await E.worker(id);
  assert.deepEqual(consultas, ['224', '223']);
  assert.equal(docsEnviados.length, 3);
  assert.ok(docsEnviados.every(d => d.idps === '223'), 'idps descoberto, nunca 0');
  const rec = (await store.get(id, 'matriculaFila')).record;
  assert.equal(rec.status, 'concluida'); assert.equal(rec.idps, '223');
});
