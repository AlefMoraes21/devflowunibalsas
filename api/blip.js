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
