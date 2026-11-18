import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAvisosBlip, reaisDe, chavePixDe } from '../api/blip.js';
import { lerPassoPagamento, dadosDoPix, centavosDoPagamento, pixValido, pixDoPopup, recebedorDoPix, contatoDaResposta } from '../api/portal-site.js';

import { PIX, passoPagamento } from './pagamento-fixture.js';

test('Pagamento: lê o passo como o site (botão do Pix pela lógica "P", valores do TOTVS, nome e celular)', () => {
  const p = lerPassoPagamento(passoPagamento());
  assert.equal(p.botao, 3940437); assert.equal(p.botao_relacionado, 226402); assert.equal(p.stage_id, 261005);
  assert.equal(p.valores[38656], '544149', 'IDBOLETO vem do value_now');
  assert.equal(centavosDoPagamento(p), 39000);
  assert.deepEqual(contatoDaResposta(passoPagamento()), { nome: 'MARIA DA SILVA', celular: '99988880001' });
  const dados = dadosDoPix(p);
  assert.deepEqual(dados.filter(x => x.field_id).map(x => [x.field_id, x.component_id, x.key, x.type, x.value]), [
    [38702, null, 38702, 'radio', 'P'], [38656, null, 38656, 'textfield', '544149'], [53443, null, 53443, 'textfield', '390.00'],
    [38661, null, 38661, 'textfield', 'R$ 390,00'], [38658, null, 38658, 'textfield', '39000']]);
  assert.deepEqual(dados.filter(x => !x.field_id).map(x => x.component_id), [3940705, 3940707], 'textos do passo, como o site');
});

test('Pix: valida o BR Code, lê o popup 1016 e o nome do recebedor', () => {
  assert.equal(pixValido(PIX), PIX);
  assert.equal(pixValido('qualquer coisa'), '');
  assert.equal(pixDoPopup({ data: { applicantData: [{ field_id: 50900, value: 'data:image/png;base64,AAA' }, { field_id: 50901, value: PIX }] } }), PIX);
  assert.throws(() => pixDoPopup({ data: { applicantData: [] } }));
  assert.equal(recebedorDoPix(PIX), 'UNIBALSAS');
  assert.equal(reaisDe(39000), '390,00');
});

function blipFalso(resposta = { status: 'success' }) {
  const enviados = [], logs = [];
  const fetcher = async (url, op) => { enviados.push({ url, op, body: JSON.parse(op.body) }); return { ok: true, status: 202, json: async () => resposta }; };
  return { enviados, logs, log: e => logs.push(e), fetcher };
}
const ENV = { BLIP_API_URL: 'https://contrato.http.msging.net/', BLIP_BOT_KEY: 'Key abc', PIX_CHAVE: '07.344.774/0001-89' };

test('Blip: cobrança com o template de pagamento, Pix dinâmico + link do portal no #payment#', async () => {
  const b = blipFalso();
  const A = createAvisosBlip({ env: ENV, fetcher: b.fetcher, log: b.log });
  assert.equal(A.configurado.cobranca(), true);
  const ok = await A.cobranca({ celular: '99988880001', nome: 'MARIA DA SILVA', centavos: 39000, codigoPix: PIX, referencia: 'mat-544149', recebedor: 'UNIBALSAS' });
  assert.equal(ok, true);
  const { url, op, body } = b.enviados[0];
  assert.equal(url, 'https://contrato.http.msging.net/commands');
  assert.equal(op.headers.Authorization, 'Key abc');
  assert.equal(body.uri, '/campaign/full'); assert.equal(body.to, 'postmaster@activecampaign.msging.net');
  const r = body.resource;
  assert.equal(r.campaign.campaignType, 'Individual');
  assert.equal(r.audience.recipient, '5599988880001');
  assert.equal(r.message.messageTemplate, 'unibalsas_cobranca_matricula');
  assert.deepEqual(r.message.messageParams, ['nome', 'valor']);
  assert.equal(r.audience.messageParams.nome, 'Maria'); assert.equal(r.audience.messageParams.valor, '390,00');
  const pedido = JSON.parse(r.audience.messageParams['#payment#']);
  assert.equal(pedido.reference_id, 'mat-544149'); assert.equal(pedido.payment_type, 'br'); assert.equal(pedido.currency, 'BRL');
  assert.deepEqual(pedido.total_amount, { value: 39000, offset: 100 });
  assert.deepEqual(pedido.payment_settings[0], { type: 'pix_dynamic_code', pix_dynamic_code: { code: PIX, merchant_name: 'UNIBALSAS', key: '07344774000189', key_type: 'CNPJ' } });
  assert.deepEqual(pedido.payment_settings[1], { type: 'payment_link', payment_link: { link: 'https://vestibular.unibalsas.edu.br/presencial' } });
  assert.equal(pedido.order.items[0].amount.value, 39000);
  assert.ok(!JSON.stringify(b.logs).includes('99988880001'), 'celular não vai para o log');
});

test('Blip: aviso de etapa com o template genérico (4 variáveis, sem quebra de linha)', async () => {
  const b = blipFalso();
  const A = createAvisosBlip({ env: ENV, fetcher: b.fetcher, log: b.log });
  assert.equal(await A.atualizacao({ celular: '(99) 98888-0001', nome: 'maria', processo: 'matrícula', situacao: 'Documentos\naprovados.', proximo: 'baixe o contrato.' }), true);
  const r = b.enviados[0].body.resource;
  assert.equal(r.message.messageTemplate, 'unibalsas_atualizacao_processo');
  assert.deepEqual(r.message.messageParams, ['nome', 'processo', 'situacao', 'proximo']);
  assert.deepEqual(r.audience.messageParams, { nome: 'Maria', processo: 'matrícula', situacao: 'Documentos aprovados.', proximo: 'baixe o contrato.' });
});

test('Blip: sem chaves (ou sem a chave Pix) não envia nada; recusa do Blip conta como falha', async () => {
  const b = blipFalso();
  assert.equal(await createAvisosBlip({ env: {}, fetcher: b.fetcher, log: b.log }).atualizacao({ celular: '99988880001', nome: 'A' }), false);
  const semPix = createAvisosBlip({ env: { ...ENV, PIX_CHAVE: '' }, fetcher: b.fetcher, log: b.log });
  assert.equal(await semPix.cobranca({ celular: '99988880001', nome: 'A', centavos: 100, codigoPix: PIX }), false, 'sem chave (nem da cobrança nem de reserva) não envia');
  assert.equal(await createAvisosBlip({ env: { ...ENV, AVISOS_DESLIGADOS: '1' }, fetcher: b.fetcher, log: b.log }).configurado.atualizacao(), false);
  assert.equal(b.enviados.length, 0);
  const recusa = blipFalso({ status: 'failure', reason: { description: 'template not found' } });
  assert.equal(await createAvisosBlip({ env: ENV, fetcher: recusa.fetcher, log: recusa.log }).atualizacao({ celular: '99988880001', nome: 'A', processo: 'x', situacao: 'y', proximo: 'z' }), false);
});

test('Chave Pix: aleatória (EVP) da UniBalsas, CNPJ, CPF, e-mail e telefone; inválida não liga a cobrança', () => {
  assert.deepEqual(chavePixDe('86AEE95C-2F75-4364-B44D-D595946644C2'), { key: '86aee95c-2f75-4364-b44d-d595946644c2', tipo: 'EVP' });
  assert.deepEqual(chavePixDe('07.344.774/0001-89'), { key: '07344774000189', tipo: 'CNPJ' });
  assert.deepEqual(chavePixDe('123.456.789-09'), { key: '12345678909', tipo: 'CPF' });
  assert.deepEqual(chavePixDe('pix@exemplo.com.br'), { key: 'pix@exemplo.com.br', tipo: 'EMAIL' });
  assert.deepEqual(chavePixDe('+55 (99) 99999-0000'), { key: '+5599999990000', tipo: 'PHONE' });
  assert.equal(chavePixDe('xyz'), null);
});

test('Cobrança: a chave Pix vem da cobrança do próprio Pix (sistema); só o número de teste recebe com AVISOS_SO_PARA', async () => {
  const b = blipFalso();
  const blip = createAvisosBlip({ env: { ...ENV, PIX_CHAVE: '', AVISOS_SO_PARA: '5599988880001' }, fetcher: b.fetcher, log: b.log });
  assert.equal(await blip.cobranca({ celular: '99988880001', nome: 'MARIA', centavos: 100, codigoPix: PIX, chave: '86aee95c-2f75-4364-b44d-d595946644c2' }), true);
  const pedido = JSON.parse(b.enviados.at(-1).body.resource.audience.messageParams['#payment#']);
  assert.deepEqual(pedido.payment_settings[0].pix_dynamic_code, { code: PIX, merchant_name: 'UniBalsas', key: '86aee95c-2f75-4364-b44d-d595946644c2', key_type: 'EVP' });
  assert.deepEqual(pedido.total_amount, { value: 100, offset: 100 });
  const n = b.enviados.length;
  assert.equal(await blip.cobranca({ celular: '99911112222', nome: 'JOSE', centavos: 100, codigoPix: PIX, chave: '86aee95c-2f75-4364-b44d-d595946644c2' }), false);
  assert.equal(b.enviados.length, n, 'fora da lista de teste: nada sai');
  assert.ok(b.logs.some(l => l.motivo === 'fora_da_lista_teste'));
});

test('Chave da cobrança: lê a chave do JWS na URL do Pix (campo 26.25), também com HTTP 410 (Pix já pago)', async () => {
  const { chaveDaCobrancaPix, urlDaCobrancaPix } = await import('../api/portal-site.js');
  const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const jws = b64({ alg: 'PS256' }) + '.' + b64({ chave: '86aee95c-2f75-4364-b44d-d595946644c2', status: 'CONCLUIDA' }) + '.assinatura';
  const codigo = '00020101021226' + '81' + '0014br.gov.bcb.pix' + '25' + '59' + 'api.rendimento.com.br/q/v2/e232f8c45a864473aa804f375f31df76abcdefghijkl'.slice(0, 59) + '5204000053039865802BR5913UNIBALSAS EDU6006Balsas62070503***6304ABCD';
  const url = urlDaCobrancaPix(codigo);
  assert.match(url, /^https:\/\/api\.rendimento\.com\.br\/q\/v2\//);
  let pedido = '';
  const chave = await chaveDaCobrancaPix(codigo, async u => { pedido = u; return { text: async () => '{"Notifications":[{"Message":"Erro: ' + jws + '"}]}' }; });
  assert.equal(pedido, url); assert.equal(chave, '86aee95c-2f75-4364-b44d-d595946644c2');
  assert.equal(await chaveDaCobrancaPix(codigo, async () => { throw new Error('fora'); }), '');
  assert.equal(await chaveDaCobrancaPix('qualquer'), '');
});
