import { test } from 'node:test';
import assert from 'node:assert/strict';

// Releitura rápida nos testes (produção: 3 s, até 10 vezes).
process.env.PROOF_BINDING_DELAY_MS = '1';
process.env.FLOW_PRIVATE_KEY = 'unit-pre-carga';
process.env.FLOW_PROJECT_ID = 'unit';
process.env.RBS_TOKEN = 'unit';
const { routeFlowRequest, flowContext, sealState, openState } = await import('../api/flow.js');

// Simula Rubeus (API oficial), portal do candidato e plataforma de avaliação.
// codigoPronto: a partir de qual leitura do formulário o IDEXECPROVA já existe (Infinity = nunca).
// falhaPortal: o portal do candidato (consultado antes do Iniciar prova) fora do ar.
function ambiente({ codigoPronto = 1, falhaPortal = false } = {}) {
  const c = { inscricao: 0, iniciarProva: 0, leituras: 0, creates: 0 };
  const snapshot = () => {
    c.leituras++;
    const codigo = c.leituras >= codigoPronto ? 'CURRENT' : null;
    const content = [
      { type: 'text', field_id: 110, label: 'IDEXECPROVA', value_now: codigo },
      { type: 'text', field_id: 111, label: 'IDPROVAINSCRITO', value_now: '99' },
      { type: 'button', id: 1000, label: 'Iniciar prova', forwardData: [{ link: 'https://avaliacao.apprubeus.com.br/api/avaliacao/linkProva', parameters: [
        { name: 'chave', field_id: 112, parameter_type_id: 1 }, { name: 'codigoContato', field_id: 113, parameter_type_id: 1 },
        { name: 'codigoOferta', field_id: 114, parameter_type_id: 1 }, { name: 'idExecProva', field_id: 110, parameter_type_id: 1 }] }] }
    ];
    return { id: 33, applicantData: [{ field_id: 112, value: 'unit-key' }, { field_id: 113, value: '42' }, { field_id: 114, value: 'unit-offer' }], content };
  };
  const exam = { id: 777, avaliacao_id: 10, crm_id: 94, crm_contato_id: 4, crm_curso_id: 5, IDEXECPROVA: 'CURRENT', codUsuarioPS: null, finalizada: 0, tempoRestante: 120, nome: 'Redação', questoes: [{ id: 6, enunciado: '<p>Tema de teste.</p>' }] };
  const fetch = async (input, options = {}) => {
    const u = new URL(String(input)), body = options.body ? JSON.parse(options.body) : null;
    if (u.hostname === 'admin.portal.apprbs.com.br') {
      if (u.pathname.endsWith('/stages')) return Response.json({ success: true, data: [{ id: 32, title: 'Prova online' }] });
      if (u.pathname.endsWith('/steps')) return Response.json({ success: true, data: [{ id: 33 }] });
      if (u.pathname.endsWith('/form')) return Response.json({ success: true, data: { form: { content: { buttons: [{ button: 1000, label: 'Iniciar prova' }], inputs: [{ field_id: 110, label: 'IDEXECPROVA', value: 'STALE' }] } } } });
      assert.ok(u.pathname.endsWith('/submit'));
      if (Number(body.button) === 1000) { c.iniciarProva++; return Response.json({ success: true, data: { token: 'tok-prova' } }); }
      c.inscricao++; return Response.json({ success: true, data: { redirect: { applyment_id: '123' } } });
    }
    if (u.hostname === 'vestibular.unibalsas.edu.br') {
      if (u.pathname.includes('getApplymentDataByStep')) return Response.json({ success: true, data: { steps: { currentStep: snapshot() } } });
      if (falhaPortal) return Response.json({ success: false }, { status: 500 });
      return Response.json({ success: true, data: { applyments: [{ current_process: 1, applyment_id: 123 }], applyment_information: { selective_process_id: 20383 }, stages: [{ title: 'Prova online', feedback: { complementary_text: 'Prova disponível' } }] } });
    }
    if (u.pathname.endsWith('/linkProva')) return new Response(null, { status: 302, headers: { location: 'https://avaliacao.apprubeus.com.br/execucao/inicio/unit-key/4/5/CURRENT/' } });
    if (u.pathname.includes('/configuracao/execucao/')) return Response.json({ success: true, data: {} }, { headers: { 'set-cookie': 'lumen_session=unit; Path=/' } });
    if (u.pathname.includes('/create/')) { c.creates++; return Response.json({ success: true, data: { token: 'unit-exam' } }); }
    if (u.pathname.includes('/consulta/')) return Response.json({ success: true, data: exam });
    throw new Error('inesperado ' + u.href);
  };
  return { c, fetch };
}

const run = (screen, acao, estado, user = {}) => {
  const req = { screen, action: 'data_exchange', flow_token: 'f-pre', data: { acao, estado, ...user } };
  return flowContext.run({ request: req, deadline: Date.now() + 120000, worker: true, write: null }, () => routeFlowRequest(req));
};
const quaseLa = () => sealState('QUASE_LA', {
  processo_seletivo_id: '20383', token: 'unit', button_id: '3940366',
  campo_cpf_id: '38567', campo_nacionalidade_id: '38780', campo_ensino_medio_id: '251544', campo_deficiencia_id: '38575', campo_origem_id: '319427',
  origens: [{ id: '01', title: 'Site oficial' }]
});
const concluir = estado => run('QUASE_LA', 'enviar_informacoes_complementares', estado, { cpf: '391.847.205-14', nacionalidade: '10', concluiu_ensino_medio: 'Sim', possui_deficiencia: 'F', como_conheceu: '01' });

test('inscrição concluída já deixa a redação pronta; Iniciar redação abre sem acionar o botão de novo', async () => {
  const { c, fetch } = ambiente({ codigoPronto: 3 });
  const original = globalThis.fetch; globalThis.fetch = fetch;
  try {
    const orientacao = await concluir(quaseLa());
    assert.equal(orientacao.screen, 'TELA_ORIENTACAO_PROVA');
    assert.equal(orientacao.data.erro, '');
    assert.equal(orientacao.data.rotulo_rodape, 'Iniciar redação');
    const s = openState(orientacao.data.estado, orientacao.screen);
    assert.equal(s.prova_pre_carregada, true);
    assert.equal(s.prepared_existing.binding.executionCode, 'CURRENT');
    assert.equal(c.inscricao, 1);
    assert.equal(c.iniciarProva, 1);
    assert.equal(c.creates, 0, 'o cronômetro (create/) não pode começar antes do candidato abrir');

    const redacao = await run('TELA_ORIENTACAO_PROVA', 'iniciar_redacao', orientacao.data.estado);
    assert.equal(redacao.screen, 'TELA_REDACAO');
    assert.equal(redacao.data.tema_redacao, 'Tema de teste.');
    assert.equal(c.iniciarProva, 1, 'o Iniciar prova não pode ser enviado duas vezes');
    assert.equal(c.creates, 1);
  } finally { globalThis.fetch = original; }
});

test('pré-carga falha depois do Iniciar prova: inscrição confirmada e o próximo toque só confere a prova', async () => {
  const { c, fetch } = ambiente({ codigoPronto: Infinity });
  const original = globalThis.fetch; globalThis.fetch = fetch;
  try {
    const orientacao = await concluir(quaseLa());
    assert.equal(orientacao.screen, 'TELA_ORIENTACAO_PROVA');
    const s = openState(orientacao.data.estado, orientacao.screen);
    assert.equal(s.applyment_id, '123', 'a inscrição continua confirmada');
    assert.equal(s.proof_resume_required, true);
    assert.ok(!s.prova_pre_carregada);
    assert.equal(orientacao.data.acao_rodape, 'conferir_prova_existente');
    assert.equal(c.iniciarProva, 1);
  } finally { globalThis.fetch = original; }
});

test('pré-carga falha antes do Iniciar prova: inscrição confirmada e o toque segue o caminho normal', async () => {
  const { c, fetch } = ambiente({ falhaPortal: true });
  const original = globalThis.fetch; globalThis.fetch = fetch;
  try {
    const orientacao = await concluir(quaseLa());
    assert.equal(orientacao.screen, 'TELA_ORIENTACAO_PROVA');
    const s = openState(orientacao.data.estado, orientacao.screen);
    assert.equal(s.applyment_id, '123');
    assert.ok(!s.proof_resume_required);
    assert.ok(!s.prova_pre_carregada);
    assert.equal(orientacao.data.acao_rodape, 'iniciar_redacao');
    assert.equal(c.iniciarProva, 0);
  } finally { globalThis.fetch = original; }
});
