import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.FLOW_PRIVATE_KEY ??= 'unit-turnos-key';
process.env.RBS_TOKEN ??= 'unit';
const { flowOptions, routeFlowRequest, flowContext } = await import('../api/flow.js');

// O WhatsApp reinicia o Flow quando um Dropdown recebe id repetido, id vazio ou título vazio.
test('opções de curso/turno: descarta repetidas, vazias e sem título', () => {
  const out = flowOptions([
    { value: '6', label: 'NOTURNO-' },
    { value: '6', label: 'NOTURNO' },
    { value: '', label: 'SEM ID' },
    { value: '7', label: '   ' },
    { value: '16', label: 'NOTURNO' },
    null
  ]);
  assert.deepEqual(out, [{ id: '6', title: 'NOTURNO' }, { id: '16', title: 'NOTURNO' }]);
  assert.equal(new Set(out.map(o => o.id)).size, out.length);
});

test('opções: título limitado a 30 caracteres', () => {
  const [o] = flowOptions([{ value: '1-450', label: 'ANÁLISE E DESENVOLVIMENTO DE SISTEMAS' }]);
  assert.ok(o.title.length <= 30);
});

test('aviso de erro do WhatsApp é registrado e reconhecido', async () => {
  const logs = [];
  const original = console.warn;
  console.warn = msg => logs.push(String(msg));
  try {
    const request = { screen: 'CURSO_INTERESSE', action: 'data_exchange', flow_token: 'f-err', data: { error: 'INVALID_SCREEN', error_message: 'Dropdown duplicate id' } };
    const res = await flowContext.run({ request, worker: false, write: null, deadline: Date.now() + 60000 }, () => routeFlowRequest(request));
    assert.deepEqual(res, { data: { acknowledged: true } });
  } finally { console.warn = original; }
  const evento = logs.map(l => { try { return JSON.parse(l); } catch { return null; } }).find(e => e?.event === 'flow_client_error');
  assert.ok(evento, 'o aviso precisa aparecer no log');
  assert.equal(evento.screen, 'CURSO_INTERESSE');
  assert.equal(evento.error, 'INVALID_SCREEN');
});
