import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

process.env.FLOW_PRIVATE_KEY = 'unit-etapa2';
process.env.FLOW_PROJECT_ID = 'unit';
process.env.RBS_TOKEN = 'unit';
const { sealState, openState, flowContext } = await import('../api/flow.js');
const { createEtapa2, escolherOpcao, idade } = await import('../api/etapa2-matricula.js');
const { validCpf } = await import('../api/matricula.js');

const FLOW = JSON.parse(readFileSync(new URL('../flows/etapa2-matricula.json', import.meta.url), 'utf8'));
const CPF = '391.847.205-14';
const NASC = '2000-05-10';

function memoria() {
  const db = new Map(); let v = 0; const k = (c, id) => c + '/' + id;
  return {
    async get(id, c = 'x') { const x = db.get(k(c, id)); return x ? { record: structuredClone(x.record), version: x.version } : null; },
    async create(id, record, c = 'x') { if (db.has(k(c, id))) return false; db.set(k(c, id), { record: structuredClone(record), version: 'v' + (++v) }); return true; },
    async update(id, record, version, c = 'x') { const x = db.get(k(c, id)); if (!x || x.version !== version) return false; db.set(k(c, id), { record: structuredClone(record), version: 'v' + (++v) }); return true; }
  };
}

// Rubeus simulado: o portal libera um passo por vez; cada /submit conclui o passo atual.
function rubeusFalso({ prova = 'Aprovado', conclusivo = 1 } = {}) {
  const passos = ['RESP_FINANCEIRO', 'ENDERECO', 'IDENTIDADE', 'CUPOM', 'DOCUMENTOS_INSCRICAO'];
  let atual = 0;
  const envios = [];
  const listas = {
    opcoes_responsavel: [{ id: '1', title: 'Eu' }, { id: '2', title: 'Outro' }],
    ufs: [{ id: '21', title: 'Maranhão (MA)' }, { id: 'MA', title: 'MA' }].slice(1),
    racas: [{ id: '01', title: 'Branca' }, { id: '03', title: 'Parda' }],
    estados_civis: [{ id: 'S', title: 'Solteiro' }, { id: 'C', title: 'Casado' }]
  };
  const matricula = {
    async login(cpf, nasc) { if (cpf !== '39184720514' || nasc !== NASC) throw new Error('não'); return { token: 'tok', applyment_id: '555', person_id: '1' }; },
    async portal() { return { token: 'tok2', processo_seletivo_id: '20383', stages: [
      { title: 'Inscrição', feedback: { complementary_text: 'Concluída', conclusive: 1 } },
      { title: 'Prova online', feedback: { complementary_text: prova, conclusive: conclusivo } },
      { title: 'Matrícula', feedback: { complementary_text: 'Pendente', conclusive: 0, cta_text: 'Continuar' }, cta_link: '/passo/30066' + atual }
    ] }; },
    async open(sessao, next) {
      const tela = passos[atual];
      return { screen: tela, data: { estado: sealState(tela, { ...sessao, ...listas, campos: { escola: '1', ano_conclusao: '2' }, formulario: {} }) } };
    },
    async cities(d) { assert.equal(d.estado_natal, 'MA'); return [{ id: '0907', title: 'Balsas' }, { id: '0908', title: 'Balsas do Sul' }]; },
    async schools() { return [{ id: 'E1', title: 'Escola Estadual Teste' }]; },
    async send(tela, dados) { envios.push({ tela, dados }); atual++; return { token: 'tok3' }; }
  };
  return { matricula, envios };
}

function montar(opts) {
  const store = memoria();
  const fila = [];
  const r = rubeusFalso(opts);
  const E = createEtapa2({ store, enqueue: async (id, o) => fila.push({ id, ...o }), sealState, openState, matricula: r.matricula, validCpf,
    buscarCep: async () => ({ cep: '65800-000', rua: 'Rua Teste', bairro: 'Centro', cidade: 'Balsas', uf: 'MA' }), log: () => {} });
  return { E, store, fila, ...r };
}
// Contrato com o JSON publicado: chaves e tipos da resposta iguais aos declarados, e rota válida.
function confere(origem, r) {
  const tela = FLOW.screens.find(s => s.id === r.screen);
  assert.ok(tela, 'tela existe: ' + r.screen);
  assert.ok(origem === r.screen || FLOW.routing_model[origem].includes(r.screen), `${origem} → ${r.screen}`);
  assert.deepEqual(Object.keys(r.data).sort(), Object.keys(tela.data ?? {}).sort(), 'chaves de ' + r.screen);
  for (const [k, v] of Object.entries(r.data)) assert.equal(typeof v, tela.data[k].type, `${r.screen}.${k}`);
  return r;
}
const toque = (E, screen, acao, estado, user = {}) => {
  const req = { screen, action: 'data_exchange', flow_token: 'ft2', data: { acao, ...(estado ? { estado } : {}), ...user } };
  return flowContext.run({ request: req, deadline: Date.now() + 9500 }, async () => confere(screen, await E.route(req)));
};
const END = { cep: '65800000', rua: 'Rua A', numero: '10', bairro: 'Centro', cidade: 'Balsas', uf: 'MA', estado_natal: 'MA', cidade_natal: 'Balsas' };
const IDENT = { rg: 'MA-123456', orgao_emissor: 'ssp', uf_rg: 'MA', cor_raca: 'parda', estado_civil: 'solteiro_a', ano_conclusao: '2018', escola: 'Escola Estadual Teste' };

test('Flow da etapa 2: JSON válido para a Meta (ids, rotas, dados declarados, imagens no topo)', () => {
  assert.equal(FLOW.version, '7.3');
  const ids = FLOW.screens.map(s => s.id);
  for (const id of ids) assert.match(id, /^[A-Za-z_]+$/);
  for (const [de, para] of Object.entries(FLOW.routing_model)) { assert.ok(ids.includes(de)); for (const p of para) { assert.ok(ids.includes(p)); assert.ok(!FLOW.routing_model[p].includes(de), 'sem rota de volta'); } }
  for (const t of FLOW.screens) {
    const usados = [...JSON.stringify(t.layout).matchAll(/\$\{data\.([a-z_]+)\}/g)].map(m => m[1]);
    for (const u of usados) assert.ok(t.data && u in t.data, `${t.id} usa data.${u}`);
    assert.match(JSON.stringify(t.layout), /"type":"Image"/, `${t.id} tem imagem no topo`);
  }
  assert.doesNotMatch(JSON.stringify(FLOW), /Verificar andamento|consultar_tarefa/);
  // A Meta exige init-values do mesmo tipo do campo: TextInput numérico não aceita valor inicial em texto.
  assert.doesNotMatch(JSON.stringify(FLOW), /"input-type":"number"/);
});

test('Login: CPF + nascimento abre o portal; dados errados ou redação em correção não seguem', async () => {
  const { E, store } = montar();
  const errado = await toque(E, 'MATR_INICIO', 'entrar', null, { cpf: CPF, data_nascimento: '1999-01-01' });
  assert.equal(errado.screen, 'MATR_LOGIN'); assert.match(errado.data.erro, /Não encontramos/);
  const ok = await toque(E, 'MATR_INICIO', 'entrar', null, { cpf: CPF, data_nascimento: NASC });
  assert.equal(ok.screen, 'MATR_PORTAL'); assert.match(ok.data.resumo, /Prova online/);
  const s = openState(ok.data.estado, 'MATR_PORTAL');
  assert.equal((await store.get(s.fila_id, 'matriculaFila')).record.applyment_id, '555');
  const c = montar({ prova: 'Aguardando correção', conclusivo: 0 });
  const espera = await toque(c.E, 'MATR_INICIO', 'entrar', null, { cpf: CPF, data_nascimento: NASC });
  assert.equal(espera.screen, 'MATR_FIM'); assert.match(espera.data.titulo, /correção/);
});

test('Subetapas: cada uma grava no Firestore e avança na hora; o worker envia ao Rubeus em ordem', async () => {
  const { E, store, fila, envios } = montar();
  const portal = await toque(E, 'MATR_INICIO', 'entrar', null, { cpf: CPF, data_nascimento: NASC });
  const resp = await toque(E, 'MATR_PORTAL', 'continuar', portal.data.estado);
  assert.equal(resp.screen, 'MATR_RESPONSAVEL');
  const end = await toque(E, 'MATR_RESPONSAVEL', 'enviar_responsavel', resp.data.estado, { responsavel: 'Eu' });
  assert.equal(end.screen, 'MATR_ENDERECO', 'maior de 18 e "Eu": vai direto ao endereço');
  const id = fila[0].id;
  // O worker já envia o responsável enquanto o candidato preenche o endereço, e espera o próximo bloco.
  await E.worker(id);
  assert.deepEqual(envios.map(e => e.tela), ['RESP_FINANCEIRO']);
  assert.equal(envios[0].dados.responsavel, '1', 'texto "Eu" convertido para o código do formulário');
  assert.equal((await store.get(id, 'matriculaFila')).record.passo, 'aguardando_endereco');
  const cep = await toque(E, 'MATR_ENDERECO', 'buscar_cep', end.data.estado, { cep: '65800000' });
  assert.equal(cep.data.valor_rua, 'Rua Teste'); assert.equal(cep.data.valor_uf, 'MA');
  const semNumero = await toque(E, 'MATR_ENDERECO', 'enviar_endereco', end.data.estado, { ...END, numero: '' });
  assert.match(semNumero.data.erro, /número/);
  const ident = await toque(E, 'MATR_ENDERECO', 'enviar_endereco', end.data.estado, END);
  assert.equal(ident.screen, 'MATR_IDENTIDADE');
  const fim = await toque(E, 'MATR_IDENTIDADE', 'enviar_identidade', ident.data.estado, IDENT);
  assert.equal(fim.screen, 'MATR_FIM');
  assert.ok(fila.length >= 3, 'cada subetapa agenda o worker');
  await E.worker(id);
  assert.deepEqual(envios.map(e => e.tela), ['RESP_FINANCEIRO', 'ENDERECO', 'IDENTIDADE']);
  const e = envios[1].dados, i = envios[2].dados;
  assert.equal(e.estado_natal, 'MA'); assert.equal(e.cidade_natal, '0907', 'cidade natal pelo nome exato');
  assert.equal(i.cor_raca, '03'); assert.equal(i.estado_civil, 'S'); assert.equal(i.escola, 'E1'); assert.equal(i.rg, 'MA-123456', 'RG como digitado');
  const rec = (await store.get(id, 'matriculaFila')).record;
  assert.equal(rec.status, 'concluida', 'passo de cupom (se aparecer no portal) segue sem cupom');
});

test('Menor de 18 anos: pede os dados do responsável; regras de seleção', async () => {
  const { E } = montar();
  const hoje = new Date();
  const menor = `${hoje.getFullYear() - 16}-01-01`;
  const r = rubeusFalso();
  r.matricula.login = async () => ({ token: 't', applyment_id: '777' });
  const E2 = createEtapa2({ store: memoria(), enqueue: async () => {}, sealState, openState, matricula: r.matricula, validCpf, log: () => {} });
  const portal = await toque(E2, 'MATR_INICIO', 'entrar', null, { cpf: CPF, data_nascimento: menor });
  const resp = await toque(E2, 'MATR_PORTAL', 'continuar', portal.data.estado);
  const dados = await toque(E2, 'MATR_RESPONSAVEL', 'enviar_responsavel', resp.data.estado, { responsavel: 'Eu' });
  assert.equal(dados.screen, 'MATR_RESP_DADOS');
  assert.equal(escolherOpcao([{ id: 'S', title: 'Solteiro' }], 'Solteiro(a)', { prefixo: 5 }), 'S');
  assert.equal(escolherOpcao([{ id: '1', title: 'Balsas' }, { id: '2', title: 'Balsas do Sul' }], 'balsas'), '1');
  assert.equal(idade('2000-12-31', new Date('2026-12-30')), 25);
  void E;
});
