import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.FLOW_PRIVATE_KEY ??= 'unit-troca-curso';
process.env.RBS_TOKEN ??= 'unit';
const { routeFlowRequest, flowContext, sealState, openState } = await import('../api/flow.js');

// Cenário real (13/11/2026): curso A com turno carregado; o candidato troca para DIREITO e o Rubeus
// não devolve turno. A tela mostrava o erro com o turno do curso anterior, e o Continuar gravaria
// DIREITO com a oferta do outro curso.
test('troca para curso sem turno: limpa turno e oferta, e o Continuar não grava nada', async () => {
  const previous = globalThis.fetch;
  let submits = 0;
  globalThis.fetch = async (input, options = {}) => {
    const u = new URL(String(input));
    if (u.pathname.endsWith('/data-source')) return Response.json({ success: true, data: [] });
    if (u.pathname.endsWith('/submit')) { submits++; return Response.json({ success: true, data: {} }); }
    throw new Error('inesperado ' + u.pathname);
  };
  const run = req => flowContext.run({ request: req, worker: false, write: null, deadline: Date.now() + 60000 }, () => routeFlowRequest(req));
  try {
    const cursos = [{ id: '1-450', title: 'ADS' }, { id: '1-20', title: 'DIREITO' }];
    const estado = sealState('CURSO_INTERESSE', {
      processo_seletivo_id: '20383', token: 't', button_id: '3940360', datasource: 'ds',
      campo_curso_id: '38627', campo_turno_id: '38547', campo_oferta_id: '38552', campo_area_interesse_id: '38553',
      cursos, turnos: [{ id: '6', title: 'NOTURNO' }], turno_visivel: true,
      curso_selecionado: '1-450', turno_selecionado: '6', oferta_valor: '1-223-493', area_interesse_valor: '493'
    });
    const troca = { screen: 'CURSO_INTERESSE', action: 'data_exchange', flow_token: 'f-troca', data: { acao: 'buscar_turnos', estado, curso_id: '1-20' } };
    const tela = await run(troca);
    assert.equal(tela.screen, 'CURSO_INTERESSE');
    assert.match(tela.data.erro, /Nenhum turno/);
    assert.deepEqual(tela.data.turnos, [], 'não pode sobrar o turno do curso anterior');
    assert.equal(tela.data.turno_visivel, false);
    assert.equal(tela.data.valor_turno_id, '');
    const s = openState(tela.data.estado, tela.screen);
    assert.equal(s.oferta_valor, '', 'a oferta do curso anterior não pode ficar guardada');
    assert.equal(s.area_interesse_valor, '');

    // Continuar com o turno antigo: precisa buscar de novo e recusar, sem gravar.
    const avancar = { screen: 'CURSO_INTERESSE', action: 'data_exchange', flow_token: 'f-troca', data: { acao: 'avancar_curso_interesse', estado: tela.data.estado, curso_id: '1-20', turno_id: '6' } };
    const depois = await run(avancar);
    assert.equal(submits, 0, 'não pode gravar curso com oferta de outro curso');
    assert.equal(depois.screen, 'CURSO_INTERESSE');
    assert.match(depois.data.erro, /Nenhum turno/);
  } finally { globalThis.fetch = previous; }
});

// Cenário da WABA (13/11/2026): DIREITO já com NOTURNO carregado; uma nova busca do mesmo curso volta
// vazia. A tela mostrava "Nenhum turno disponível" junto com o turno. Agora mantém o turno, sem erro,
// e o Continuar segue gravando normalmente (como no app e na WABA).
test('mesmo curso, nova busca vazia: mantém o turno, sem erro, e o Continuar grava', async () => {
  const previous = globalThis.fetch;
  let submits = 0, sentToken = null;
  globalThis.fetch = async (input, options = {}) => {
    const u = new URL(String(input));
    if (u.pathname.endsWith('/data-source')) return Response.json({ success: true, data: [] });
    if (u.pathname.endsWith('/submit')) { submits++; sentToken = JSON.parse(options.body).token; throw new Error('para aqui'); }
    throw new Error('inesperado ' + u.pathname);
  };
  const run = req => flowContext.run({ request: req, worker: false, write: null, deadline: Date.now() + 60000 }, () => routeFlowRequest(req));
  try {
    const estado = sealState('CURSO_INTERESSE', {
      processo_seletivo_id: '20383', token: 't-sessao', button_id: '3940360', datasource: 'ds',
      campo_curso_id: '38627', campo_turno_id: '38547', campo_oferta_id: '38552',
      cursos: [{ id: '1-20', title: 'DIREITO' }], turnos: [{ id: '6', title: 'NOTURNO' }], turno_visivel: true,
      curso_selecionado: '1-20', turno_selecionado: '6', oferta_valor: '1-223-500'
    });
    const tela = await run({ screen: 'CURSO_INTERESSE', action: 'data_exchange', flow_token: 'f-mesmo', data: { acao: 'buscar_turnos', estado, curso_id: '1-20' } });
    assert.equal(tela.data.erro, '', 'não pode mostrar erro falso');
    assert.deepEqual(tela.data.turnos, [{ id: '6', title: 'NOTURNO' }]);
    assert.equal(tela.data.valor_turno_id, '6');
    assert.equal(openState(tela.data.estado, tela.screen).oferta_valor, '1-223-500');

    await run({ screen: 'CURSO_INTERESSE', action: 'data_exchange', flow_token: 'f-mesmo', data: { acao: 'avancar_curso_interesse', estado: tela.data.estado, curso_id: '1-20', turno_id: '6' } });
    assert.equal(submits, 1, 'o Continuar deve gravar normalmente');
    assert.equal(sentToken, 't-sessao');
  } finally { globalThis.fetch = previous; }
});

test('token novo devolvido pelo data-source passa a ser usado no envio', async () => {
  const previous = globalThis.fetch;
  let sentToken = null;
  globalThis.fetch = async (input, options = {}) => {
    const u = new URL(String(input));
    if (u.pathname.endsWith('/data-source')) return Response.json({ success: true, token: 't-novo', data: [{ value: '6', label: 'NOTURNO' }], nextOptions: { 38552: { value: '1-223-500' } } });
    if (u.pathname.endsWith('/submit')) { sentToken = JSON.parse(options.body).token; throw new Error('para aqui'); }
    throw new Error('inesperado ' + u.pathname);
  };
  const run = req => flowContext.run({ request: req, worker: false, write: null, deadline: Date.now() + 60000 }, () => routeFlowRequest(req));
  try {
    const estado = sealState('CURSO_INTERESSE', { processo_seletivo_id: '20383', token: 't-antigo', button_id: '3940360', datasource: 'ds', campo_curso_id: '38627', campo_turno_id: '38547', campo_oferta_id: '38552', cursos: [{ id: '1-20', title: 'DIREITO' }] });
    const tela = await run({ screen: 'CURSO_INTERESSE', action: 'data_exchange', flow_token: 'f-token', data: { acao: 'buscar_turnos', estado, curso_id: '1-20' } });
    assert.equal(tela.data.erro, '');
    await run({ screen: 'CURSO_INTERESSE', action: 'data_exchange', flow_token: 'f-token', data: { acao: 'avancar_curso_interesse', estado: tela.data.estado, curso_id: '1-20', turno_id: '6' } });
    assert.equal(sentToken, 't-novo');
  } finally { globalThis.fetch = previous; }
});
