import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.FLOW_PRIVATE_KEY ??= 'unit-p1-key';
process.env.RBS_TOKEN ??= 'unit';
const { createMatricula, portalScreenData } = await import('../api/matricula.js');
const { routeFlowRequest, flowContext, sealState, openState } = await import('../api/flow.js');

const ufs = [{ id: 'MA', title: 'Maranhão' }];
const cidades = [{ id: '01400', title: 'Balsas' }];
const endereco = { rua: 'Rua Ficticia de Teste', numero: '100', complemento: '', bairro: 'Centro', cidade: 'Balsas', uf: 'MA', estado_natal: 'MA', cidade_natal: '01400' };

function matriculaCapturando() {
  const sent = [];
  const m = createMatricula({
    api: async () => ({}), getForm: async () => ({}), getDataSource: async () => ({}), render: (screen, data) => ({ screen, data }),
    submitForm: async (button, fields) => { sent.push({ button, fields }); return { data: {} }; }
  });
  return { m, sent };
}

// Site (passo 300666, 10/11/2026): 38568 CEP só dígitos, junto com o endereço.
test('endereço: CEP vai no campo 38568, só dígitos, como no site', async () => {
  const { m, sent } = matriculaCapturando();
  await m.send('ENDERECO', {
    ...endereco, cep: '65800-000', ufs, cidades_natal: cidades, button_id: '3940407', token: 't',
    campos: { cep: '38568', rua: '38569', numero: '38570', complemento: '38572', bairro: '38571', cidade: '38574', uf: '38573', estado_natal: '38641', cidade_natal: '38640' }
  });
  const f = Object.fromEntries(sent[0].fields.map(x => [String(x.field_id), x.value]));
  assert.equal(f['38568'], '65800000');
  assert.equal(f['38569'], 'Rua Ficticia de Teste');
  assert.equal(f['38640'], '01400');
});

test('endereço: CEP incompleto é recusado antes de gravar', async () => {
  const { m, sent } = matriculaCapturando();
  await assert.rejects(m.send('ENDERECO', { ...endereco, cep: '6580', ufs, cidades_natal: cidades, button_id: '1', token: 't', campos: { cep: '38568', rua: '38569' } }), /CEP/);
  assert.equal(sent.length, 0);
});

test('endereço sem campo CEP no formulário continua funcionando', async () => {
  const { m, sent } = matriculaCapturando();
  await m.send('ENDERECO', { ...endereco, cep: '', ufs, cidades_natal: cidades, button_id: '1', token: 't', campos: { rua: '38569' } });
  assert.equal(sent.length, 1);
});

test('dados do responsável: o CPF enviado é o do responsável (cpf_informado), não o do candidato', async () => {
  const { m, sent } = matriculaCapturando();
  await m.send('RESP_DADOS', {
    ...endereco, nome: 'Responsavel Teste', email: 'resp@example.com', data_nascimento: '1970-01-01', celular: '99988880003', cep: '65800000',
    cpf: '39184720514', cpf_informado: '111.444.777-35', ufs, cidades_natal: cidades, button_id: '1', token: 't',
    campos: { cpf: '38688', cep: '9001', rua: '38714', nome: '38710' }
  });
  const f = Object.fromEntries(sent[0].fields.map(x => [String(x.field_id), x.value]));
  assert.equal(f['38688'], '11144477735');
  assert.equal(f['9001'], '65800000');
});

test('dados do responsável: CPF do responsável vazio é recusado mesmo com sessão logada', async () => {
  const { m, sent } = matriculaCapturando();
  await assert.rejects(m.send('RESP_DADOS', {
    ...endereco, nome: 'R', email: 'r@example.com', data_nascimento: '1970-01-01', celular: '99988880003',
    cpf: '39184720514', cpf_informado: '', ufs, cidades_natal: cidades, button_id: '1', token: 't', campos: { cpf: '38688' }
  }), /CPF/);
  assert.equal(sent.length, 0);
});

// Flow roda no Blip (sem assinatura da Meta): o CPF do cliente não pode trocar a identidade selada.
test('estado selado: cpf enviado pelo cliente não substitui o CPF do candidato', async () => {
  const previous = globalThis.fetch;
  let submitted = null;
  globalThis.fetch = async (input, options = {}) => {
    const u = new URL(String(input));
    if (u.pathname.endsWith('/submit')) { submitted = JSON.parse(options.body); throw new Error('para aqui'); }
    throw new Error('inesperado ' + u.pathname);
  };
  try {
    const estado = sealState('RESP_DADOS', {
      cpf: '39184720514', token: 'sess', applyment_id: '1', person_id: '2', processo_seletivo_id: '20383',
      button_id: '77', campos: { cpf: '38688', nome: '38710', rua: '38714' }, ufs, cidades_natal: cidades
    });
    const mk = cpf => ({ screen: 'RESP_DADOS', action: 'data_exchange', flow_token: 'f-p1', data: {
      acao: 'enviar_resp_dados', estado, ...endereco, nome: 'Responsavel Teste', email: 'resp@example.com',
      data_nascimento: '1970-01-01', celular: '99988880003', cep: '65800000', cpf
    } });
    const request = mk('111.444.777-35');
    const run = req => flowContext.run({ request: req, worker: true, write: null, deadline: Date.now() + 60000 }, () => routeFlowRequest(req));
    await run(request);
    assert.ok(submitted, 'o /submit deveria ter sido chamado');
    const f = Object.fromEntries(submitted.data.map(x => [String(x.field_id), x.value]));
    assert.equal(f['38688'], '11144477735', 'o Rubeus recebe o CPF do responsável');

    // Erro de validação (CPF inválido): nada é gravado e a tela volta com o estado do candidato.
    submitted = null;
    const res = await run(mk('123'));
    assert.equal(submitted, null);
    assert.equal(res.screen, 'RESP_DADOS');
    assert.match(res.data.erro, /CPF/);
    const s = openState(res.data.estado, res.screen);
    assert.equal(s.cpf, '39184720514', 'a sessão continua com o CPF do candidato');
    assert.equal(res.data.valor_cpf, '123', 'a tela reexibe o CPF digitado');
  } finally { globalThis.fetch = previous; }
});

test('contrato: orientação de download, GOV.BR e e-mail (sem "aceite no portal")', () => {
  const d = portalScreenData('Contrato', 300669);
  assert.match(d.mensagem, /download do contrato/);
  assert.match(d.mensagem, /GOV\.BR/);
  assert.match(d.mensagem, /centraldematriculaub@unibalsas\.edu\.br/);
  assert.doesNotMatch(d.mensagem, /aceite/);
  assert.equal(d.link_portal, 'https://vestibular.unibalsas.edu.br/presencial/passo/300669');
});

// Dados básicos na fila: o segundo toque com estado novo só verifica o job, nunca reenvia.
test('dados básicos na fila: segundo toque verifica o mesmo job (sem novo envio)', async () => {
  process.env.FLOW_PRIVATE_KEY = 'unit-p1-jobs';
  process.env.RBS_TOKEN = 'unit';
  const { createJobEngine } = await import('../api/jobs.js');
  const { responseForScreen, openState: open, sealState: seal } = await import('../api/flow.js');
  const records = new Map();
  const store = {
    async create(id, record) { if (records.has(id)) return false; records.set(id, { record: structuredClone(record), version: 1 }); return true; },
    async get(id) { return structuredClone(records.get(id) ?? null); },
    async update(id, record, version) { const p = records.get(id); if (p.version !== version) return false; records.set(id, { record: structuredClone(record), version: version + 1 }); return true; }
  };
  const enqueued = [];
  let envios = 0;
  const { workerSignature } = await import('../api/cloud-store.js');
  const engine = createJobEngine({ store, enqueue: async id => { enqueued.push(id); }, run: async () => { envios++; return { screen: 'CURSO_INGRESSO', data: {} }; }, render: responseForScreen, openState: open, waitMs: 0 });
  const estado = seal('DADOS_BASICOS', { processo_seletivo_id: '20383', token: 't', button_id: '1' });
  const req = { screen: 'DADOS_BASICOS', action: 'data_exchange', flow_token: 'f-jobs', data: { acao: 'enviar_dados_basicos', estado, nome: 'Teste', email: 'a@example.com', data_nascimento: '2000-01-01', celular: '11900000000', genero: 'F', aceite_privacidade: true } };
  const first = await engine.route(req);
  assert.match(first.data.job_id, /^[a-f0-9]{64}$/, 'a tela em processamento precisa devolver o job_id');
  // Estado novo (o IV muda a cada tela), mesmo botão "Avançar".
  const again = { ...req, data: { ...req.data, estado: first.data.estado } };
  const second = await engine.route(again);
  assert.equal(second.data.job_id, first.data.job_id);
  // O worker confere o estado do job: mesmo sendo chamado duas vezes, o envio ao Rubeus roda uma vez.
  await engine.worker(first.data.job_id, workerSignature(first.data.job_id));
  await engine.worker(first.data.job_id, workerSignature(first.data.job_id));
  assert.equal(envios, 1, 'o envio ao Rubeus não pode rodar duas vezes');
});
