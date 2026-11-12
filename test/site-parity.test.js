import {test} from 'node:test';
import assert from 'node:assert/strict';
import {routeFlowRequest,flowContext,sealState} from '../api/flow.js';

// Paridade com o site oficial (capturado em 10/11/2026, passo 300661, botão 3940350).
// O site envia: nome, e-mail, celular SÓ DÍGITOS, IDPS "223", gênero M/F, gênero Rubeus 1/2,
// nascimento AAAA-MM-DD, possui nome social false, aceite LGPD true, LGPD assinatura "1", base legal "4".
test('dados básicos: payload do /submit igual ao observado no site oficial', async () => {
  process.env.FLOW_PRIVATE_KEY = 'unit-parity-key';
  process.env.RBS_TOKEN = 'unit';
  const previous = globalThis.fetch;
  let captured = null;
  globalThis.fetch = async (input, options = {}) => {
    const u = new URL(String(input));
    if (u.pathname.endsWith('/submit')) {
      captured = JSON.parse(options.body);
      throw new Error('para aqui: só interessa o corpo enviado');
    }
    throw new Error('chamada inesperada: ' + u.pathname);
  };
  try {
    const estado = sealState('DADOS_BASICOS', {
      processo_seletivo_id: '20383', token: 'basic-token', button_id: '3940350',
      campo_nome_id: '38544', campo_possui_nome_social_id: '38606', campo_nome_social_id: '38605',
      campo_email_id: '38545', campo_data_nascimento_id: '38566', campo_celular_id: '38546',
      campo_genero_id: '38564', campo_consentimento_id: '38679', campo_idps_id: '38548',
      campo_lgpd_assinatura_id: '38707', campo_lgpd_base_legal_id: '38708', campo_genero_rubeus_id: '38565'
    });
    const request = {
      screen: 'DADOS_BASICOS', action: 'data_exchange', flow_token: 'flow-parity',
      data: {
        acao: 'enviar_dados_basicos', estado, nome: 'Helena Ribeiro Duarte Teste',
        email: 'helena.ribeiro.teste@example.com', data_nascimento: '2005-03-15',
        celular: '(99) 98888-0002', genero: 'F', aceite_privacidade: true
      }
    };
    await flowContext.run({request, worker: false, write: null, deadline: Date.now() + 60000}, () => routeFlowRequest(request));
    assert.ok(captured, 'o /submit deveria ter sido chamado');
    assert.equal(String(captured.button), '3940350');
    const f = Object.fromEntries(captured.data.map(x => [String(x.field_id), x.value]));
    assert.equal(f['38544'], 'Helena Ribeiro Duarte Teste');
    assert.equal(f['38545'], 'helena.ribeiro.teste@example.com');
    assert.equal(f['38546'], '99988880002', 'celular deve ir só com dígitos, como no site');
    assert.equal(f['38548'], '223');
    assert.equal(f['38564'], 'F');
    assert.equal(String(f['38565']), '2');
    assert.equal(f['38566'], '2005-03-15');
    assert.equal(f['38606'], false);
    assert.equal(f['38679'], true);
    assert.equal(f['38707'], '1');
    assert.equal(f['38708'], '4');
  } finally {
    globalThis.fetch = previous;
  }
});

// Passo 300662 (botão 3940360) e 300663 (botão 3940366), capturados no envio real do site em 10/11/2026.
// Passo 3 do site: 38567 CPF só dígitos, 38575 "F", 38780 "10", 251544 "Sim", 319427 "01" (+ 38609 vazio oculto).
test('estamos quase lá: payload do /submit igual ao observado no site oficial', async () => {
  process.env.FLOW_PRIVATE_KEY = 'unit-parity-key';
  process.env.RBS_TOKEN = 'unit';
  const previous = globalThis.fetch;
  let captured = null;
  globalThis.fetch = async (input, options = {}) => {
    const u = new URL(String(input));
    if (u.pathname.endsWith('/submit')) {
      captured = JSON.parse(options.body);
      throw new Error('para aqui: só interessa o corpo enviado');
    }
    throw new Error('chamada inesperada: ' + u.pathname);
  };
  try {
    const estado = sealState('QUASE_LA', {
      processo_seletivo_id: '20383', token: 'final-token', button_id: '3940366',
      campo_cpf_id: '38567', campo_nacionalidade_id: '38780', campo_ensino_medio_id: '251544',
      campo_deficiencia_id: '38575', campo_origem_id: '319427', campo_origem_outro_id: '319428',
      origens: [{id: '01', title: 'Site oficial'}, {id: '10', title: 'Outro'}]
    });
    const request = {
      screen: 'QUASE_LA', action: 'data_exchange', flow_token: 'flow-parity',
      data: {
        acao: 'enviar_informacoes_complementares', estado, cpf: '391.847.205-14', nacionalidade: '10',
        concluiu_ensino_medio: 'Sim', possui_deficiencia: 'F', como_conheceu: '01'
      }
    };
    await flowContext.run({request, worker: false, write: null, deadline: Date.now() + 60000}, () => routeFlowRequest(request));
    assert.ok(captured, 'o /submit deveria ter sido chamado');
    assert.equal(String(captured.button), '3940366');
    const f = Object.fromEntries(captured.data.map(x => [String(x.field_id), x.value]));
    assert.equal(f['38567'], '39184720514');
    assert.equal(f['38780'], '10');
    assert.equal(f['251544'], 'Sim');
    assert.equal(f['38575'], 'F');
    assert.equal(f['319427'], '01');
    assert.equal(f['319428'], undefined, 'texto "Outro" só vai quando a origem é 10');
  } finally {
    globalThis.fetch = previous;
  }
});
