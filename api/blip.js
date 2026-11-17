// Aviso ativo pelo Blip (API Active Campaign: POST {BLIP_API_URL}/commands, uri /campaign/full).
// Sem BLIP_API_URL ou BLIP_BOT_KEY o aviso não é enviado: só registra no log (fallback seguro).
//
// Variáveis no Cloud Run:
//   BLIP_API_URL            ex.: https://<contrato>.http.msging.net
//   BLIP_BOT_KEY            chave do bot roteador (só a chave, sem "Key ")
//   BLIP_TEMPLATE_REDACAO   nome do template aprovado com o botão do Flow da redação
//   BLIP_FLOW_ID, BLIP_STATE_ID, BLIP_MASTERSTATE   (opcionais) para onde o bot leva a resposta
// O link de acesso (flow_token) vai em contextVariables.flow_token e como parâmetro "2" do template;
// o template/bot do Blip precisa usá-lo como flow_token do botão do Flow.
import crypto from 'node:crypto';

export function blipConfigurado(env = process.env) {
  return Boolean(env.BLIP_API_URL && env.BLIP_BOT_KEY && env.BLIP_TEMPLATE_REDACAO);
}

export function telefoneBlip(celular) {
  let d = String(celular ?? '').replace(/\D/g, '');
  if (d.length === 10 || d.length === 11) d = '55' + d;
  return /^55\d{10,11}$/.test(d) ? '+' + d : '';
}

// ------------------------------------------------------------------ avisos das etapas 2 a 4
// Templates aprovados na Meta em 16/11/2026 (Utilidade, pt_BR):
//   unibalsas_atualizacao_processo  {{1}} nome · {{2}} processo · {{3}} o que aconteceu · {{4}} próximo passo (+ botão do Flow)
//   unibalsas_cobranca_matricula    {{1}} nome · {{2}} valor sem "R$" (+ Copiar código Pix / Abrir link de pagamento)
// A cobrança leva o order_details (Pix dinâmico do TOTVS + link do portal) em audience.messageParams["#payment#"].
// Variáveis: BLIP_API_URL, BLIP_BOT_KEY, PIX_CHAVE (CNPJ do recebedor); opcionais BLIP_TEMPLATE_ATUALIZACAO,
// BLIP_TEMPLATE_COBRANCA, PIX_RECEBEDOR, PAGAMENTO_LINK, AVISOS_DESLIGADOS=1 (para tudo).
export const TEMPLATE_ATUALIZACAO = 'unibalsas_atualizacao_processo';
export const TEMPLATE_COBRANCA = 'unibalsas_cobranca_matricula';
const primeiro = nome => String(nome ?? '').trim().split(/\s+/)[0] || 'candidato';
const titulo = s => s.toLowerCase().replace(/(^|\s)\p{L}/gu, m => m.toUpperCase());
// Variável de template da Meta: sem quebra de linha, tabulação ou mais de 4 espaços seguidos.
const variavel = v => String(v ?? '').replace(/[\r\n\t]+/g, ' ').replace(/ {4,}/g, ' ').trim();
export const reaisDe = centavos => (Number(centavos) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function createAvisosBlip({ env = process.env, fetcher = fetch, log = e => console.info(JSON.stringify(e)) } = {}) {
  const ligado = () => env.AVISOS_DESLIGADOS !== '1' && Boolean(env.BLIP_API_URL && env.BLIP_BOT_KEY);
  const chavePix = () => String(env.PIX_CHAVE ?? '').replace(/\D/g, '');
  const configurado = { atualizacao: () => ligado(), cobranca: () => ligado() && chavePix().length === 14 };

  async function campanha(tipo, recipient, nome, params, extras = {}) {
    const campaign = { name: `${tipo}-${crypto.randomUUID()}`, campaignType: 'Individual' };
    if (env.BLIP_FLOW_ID) campaign.flowId = env.BLIP_FLOW_ID;
    if (env.BLIP_STATE_ID) campaign.stateId = env.BLIP_STATE_ID;
    if (env.BLIP_MASTERSTATE) campaign.masterstate = env.BLIP_MASTERSTATE;
    const template = tipo === 'cobranca' ? env.BLIP_TEMPLATE_COBRANCA || TEMPLATE_COBRANCA : env.BLIP_TEMPLATE_ATUALIZACAO || TEMPLATE_ATUALIZACAO;
    const body = {
      id: crypto.randomUUID(), to: 'postmaster@activecampaign.msging.net', method: 'set', uri: '/campaign/full',
      type: 'application/vnd.iris.activecampaign.full-campaign+json',
      resource: {
        campaign,
        audience: { recipient, name: nome, messageParams: { ...Object.fromEntries(params), ...extras } },
        message: { messageTemplate: template, messageTemplateLanguage: 'pt_BR', messageParams: params.map(([k]) => k), channelType: 'WhatsApp' }
      }
    };
    try {
      const r = await fetcher(String(env.BLIP_API_URL).replace(/\/+$/, '') + '/commands', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Key ' + String(env.BLIP_BOT_KEY).replace(/^Key\s+/i, '') },
        body: JSON.stringify(body), signal: AbortSignal.timeout(15000)
      });
      let j = {}; try { j = await r.json(); } catch {}
      const ok = r.ok && (j.status === undefined || j.status === 'success');
      log({ event: 'blip_aviso', tipo, enviado: ok, http: r.status, status: j.status ?? null, motivo: ok ? undefined : String(j.reason?.description ?? '').slice(0, 160) || undefined });
      return ok;
    } catch (e) {
      log({ event: 'blip_aviso', tipo, enviado: false, motivo: e.name });
      return false;
    }
  }

  // Aviso de etapa (template genérico). Devolve true só se o Blip aceitou.
  async function atualizacao({ celular, nome, processo, situacao, proximo }) {
    if (!configurado.atualizacao()) { log({ event: 'blip_aviso', tipo: 'atualizacao', enviado: false, motivo: 'nao_configurado' }); return false; }
    const recipient = telefoneBlip(celular);
    if (!recipient) { log({ event: 'blip_aviso', tipo: 'atualizacao', enviado: false, motivo: 'telefone_invalido' }); return false; }
    return campanha('atualizacao', recipient, primeiro(nome), [['nome', titulo(primeiro(nome))], ['processo', variavel(processo)], ['situacao', variavel(situacao)], ['proximo', variavel(proximo)]]);
  }

  // Cobrança da taxa de matrícula: Pix dinâmico gerado no TOTVS + link do portal (cartão).
  async function cobranca({ celular, nome, centavos, codigoPix, referencia, recebedor }) {
    if (!configurado.cobranca()) { log({ event: 'blip_aviso', tipo: 'cobranca', enviado: false, motivo: 'nao_configurado' }); return false; }
    const recipient = telefoneBlip(celular);
    if (!recipient) { log({ event: 'blip_aviso', tipo: 'cobranca', enviado: false, motivo: 'telefone_invalido' }); return false; }
    const valor = Math.round(Number(centavos));
    if (!(valor > 0) || !codigoPix) { log({ event: 'blip_aviso', tipo: 'cobranca', enviado: false, motivo: 'sem_valor_ou_pix' }); return false; }
    const quantia = { value: valor, offset: 100 };
    const pedido = {
      reference_id: String(referencia ?? '').replace(/[^\w-]/g, '').slice(0, 35) || 'mat-' + crypto.randomUUID().slice(0, 8),
      type: 'digital-goods', payment_type: 'br', currency: 'BRL', total_amount: quantia,
      payment_settings: [
        { type: 'pix_dynamic_code', pix_dynamic_code: { code: codigoPix, merchant_name: String(env.PIX_RECEBEDOR || recebedor || 'UniBalsas').slice(0, 25), key: chavePix(), key_type: 'CNPJ' } },
        { type: 'payment_link', payment_link: { uri: env.PAGAMENTO_LINK || 'https://vestibular.unibalsas.edu.br/presencial' } }
      ],
      order: { status: 'pending', subtotal: quantia, items: [{ retailer_id: 'taxa-matricula', name: 'Taxa de matrícula 2027/1', amount: quantia, quantity: 1 }] }
    };
    return campanha('cobranca', recipient, primeiro(nome), [['nome', titulo(primeiro(nome))], ['valor', reaisDe(valor)]], { '#payment#': JSON.stringify(pedido) });
  }

  return { atualizacao, cobranca, configurado };
}

export async function avisarRedacaoLiberada({ celular, nome, flowToken }, { env = process.env, fetcher = fetch, log = e => console.info(JSON.stringify(e)) } = {}) {
  if (!blipConfigurado(env)) { log({ event: 'blip_aviso', enviado: false, motivo: 'nao_configurado' }); return false; }
  const recipient = telefoneBlip(celular);
  if (!recipient) { log({ event: 'blip_aviso', enviado: false, motivo: 'telefone_invalido' }); return false; }
  const primeiroNome = String(nome ?? '').trim().split(/\s+/)[0] || 'candidato';
  const campaign = { name: `redacao-${crypto.randomUUID()}`, campaignType: 'Individual' };
  if (env.BLIP_FLOW_ID) campaign.flowId = env.BLIP_FLOW_ID;
  if (env.BLIP_STATE_ID) campaign.stateId = env.BLIP_STATE_ID;
  if (env.BLIP_MASTERSTATE) campaign.masterstate = env.BLIP_MASTERSTATE;
  const body = {
    id: crypto.randomUUID(),
    to: 'postmaster@activecampaign.msging.net',
    method: 'set',
    uri: '/campaign/full',
    type: 'application/vnd.iris.activecampaign.full-campaign+json',
    resource: {
      campaign,
      audience: { recipient, messageParams: { '1': primeiroNome, '2': flowToken }, contextVariables: { flow_token: flowToken } },
      message: { messageTemplate: env.BLIP_TEMPLATE_REDACAO, messageParams: ['1', '2'], channelType: 'WhatsApp' }
    }
  };
  try {
    const r = await fetcher(String(env.BLIP_API_URL).replace(/\/+$/, '') + '/commands', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Key ' + String(env.BLIP_BOT_KEY).replace(/^Key\s+/i, '') },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000)
    });
    let j = {}; try { j = await r.json(); } catch {}
    const ok = r.ok && (j.status === undefined || j.status === 'success');
    log({ event: 'blip_aviso', enviado: ok, http: r.status, status: j.status ?? null });
    return ok;
  } catch (e) {
    log({ event: 'blip_aviso', enviado: false, motivo: e.name });
    return false;
  }
}
