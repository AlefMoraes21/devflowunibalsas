import { chaveDaCobrancaPix } from './portal-site.js';
// Aviso ativo pelo Blip (API Active Campaign: POST {BLIP_API_URL}/commands, uri /campaign/full).
// Sem BLIP_API_URL ou BLIP_BOT_KEY o aviso não é enviado: só registra no log (fallback seguro).
//
// Variáveis no Cloud Run:
//   BLIP_API_URL            ex.: https://<contrato>.http.msging.net
//   BLIP_BOT_KEY            chave do bot roteador (só a chave, sem "Key ")
//   BLIP_FLOW_ID, BLIP_STATE_ID, BLIP_MASTERSTATE   (opcionais) para onde o bot leva a resposta
// O link de acesso (flow_token) vai em contextVariables.flow_token e como parâmetro "2" do template;
// o template/bot do Blip precisa usá-lo como flow_token do botão do Flow.
import crypto from 'node:crypto';

export function blipConfigurado(env = process.env) {
  return env.AVISOS_DESLIGADOS !== '1' && Boolean(env.BLIP_API_URL && env.BLIP_BOT_KEY);
}

export function telefoneBlip(celular) {
  let d = String(celular ?? '').replace(/\D/g, '');
  if (d.length === 10 || d.length === 11) d = '55' + d;
  // Sem "+", como no disparo que já funciona no Blip da UniBalsas (recipient "5599...").
  return /^55\d{10,11}$/.test(d) ? d : '';
}

// ------------------------------------------------------------------ avisos das etapas 2 a 4
// Templates aprovados na Meta em 16/11/2026 (Utilidade, pt_BR):
//   unibalsas_atualizacao_processo  {{1}} nome · {{2}} processo · {{3}} o que aconteceu · {{4}} próximo passo (+ botão do Flow)
//   unibalsas_cobranca_matricula    {{1}} nome · {{2}} valor sem "R$" (+ Copiar código Pix / Abrir link de pagamento)
// A cobrança leva o order_details (Pix dinâmico do TOTVS + link do portal) em audience.messageParams["#payment#"].
// Variáveis: BLIP_API_URL, BLIP_BOT_KEY, PIX_CHAVE (chave Pix do recebedor aceita pelo Blip: CNPJ, CPF, e-mail ou +55 telefone; usada quando a da cobrança é aleatória/EVP); opcionais BLIP_TEMPLATE_ATUALIZACAO,
// BLIP_TEMPLATE_COBRANCA, PIX_RECEBEDOR, PAGAMENTO_LINK, AVISOS_DESLIGADOS=1 (para tudo), AVISOS_SO_PARA (lista de
// números de teste: só eles recebem), BLIP_FLOW_ID / BLIP_STATE_ID / BLIP_MASTERSTATE (direcionamento da resposta).
export const TEMPLATE_ATUALIZACAO = 'unibalsas_atualizacao_processo';
// Template de pagamento validado no Blip em 18/11/2026 (corpo testado no Postman, chegou com os botões).
export const TEMPLATE_COBRANCA = 'unibalsas_cobranca_matriculav1';
const primeiro = nome => String(nome ?? '').trim().split(/\s+/)[0] || 'candidato';
const titulo = s => s.toLowerCase().replace(/(^|\s)\p{L}/gu, m => m.toUpperCase());
// Variável de template da Meta: sem quebra de linha, tabulação ou mais de 4 espaços seguidos.
const variavel = v => String(v ?? '').replace(/[\r\n\t]+/g, ' ').replace(/ {4,}/g, ' ').trim();
export const reaisDe = centavos => (Number(centavos) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Chave Pix do recebedor, como o order_details pede (key + key_type). A da UniBalsas no Banco Rendimento é aleatória
// (EVP), lida da cobrança do próprio Pix do TOTVS em 18/11/2026. Aceita também CNPJ, CPF, e-mail e telefone.
export function chavePixDe(valor) {
  const v = String(valor ?? '').trim();
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) return { key: v.toLowerCase(), tipo: 'EVP' };
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) return { key: v.toLowerCase(), tipo: 'EMAIL' };
  if (/^\+55\d{10,11}$/.test(v.replace(/[\s()-]/g, ''))) return { key: v.replace(/[\s()-]/g, ''), tipo: 'PHONE' };
  const d = v.replace(/\D/g, '');
  if (d.length === 14) return { key: d, tipo: 'CNPJ' };
  if (d.length === 11) return { key: d, tipo: 'CPF' };
  return null;
}

export function createAvisosBlip({ env = process.env, fetcher = fetch, log = e => console.info(JSON.stringify(e)) } = {}) {
  const ligado = () => env.AVISOS_DESLIGADOS !== '1' && Boolean(env.BLIP_API_URL && env.BLIP_BOT_KEY);
  const chavePix = () => chavePixDe(env.PIX_CHAVE);
  // A chave Pix vem da cobrança de cada Pix (sistema); PIX_CHAVE é só a reserva se a cobrança não responder.
  const configurado = { atualizacao: () => ligado(), cobranca: () => ligado() };

  async function campanha(tipo, recipient, nome, params, extras = {}, contexto = null) {
    // Fase de teste: AVISOS_SO_PARA="5599...,5511..." manda só para esses números (o resto fica no log).
    const soPara = String(env.AVISOS_SO_PARA ?? '').split(',').map(n => n.replace(/\D/g, '')).filter(Boolean);
    if (soPara.length && !soPara.includes(String(recipient).replace(/\D/g, ''))) {
      log({ event: 'blip_aviso', tipo, enviado: false, motivo: 'fora_da_lista_teste' });
      return false;
    }
    const campaign = { name: `${tipo}-${crypto.randomUUID()}`, campaignType: 'Individual', channelType: 'WhatsApp' };
    if (env.BLIP_FLOW_ID) campaign.flowId = env.BLIP_FLOW_ID;
    if (env.BLIP_STATE_ID) campaign.stateId = env.BLIP_STATE_ID;
    if (env.BLIP_MASTERSTATE) campaign.masterstate = env.BLIP_MASTERSTATE;
    const template = tipo === 'cobranca' ? env.BLIP_TEMPLATE_COBRANCA || TEMPLATE_COBRANCA : env.BLIP_TEMPLATE_ATUALIZACAO || TEMPLATE_ATUALIZACAO;
    const body = {
      id: crypto.randomUUID(), to: 'postmaster@activecampaign.msging.net', method: 'set', uri: '/campaign/full',
      type: 'application/vnd.iris.activecampaign.full-campaign+json',
      resource: {
        campaign,
        audience: { recipient, ...(tipo === 'cobranca' ? {} : { name: nome }), messageParams: { ...Object.fromEntries(params), ...extras }, ...(contexto ? { contextVariables: contexto } : {}) },
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
  async function atualizacao({ celular, nome, processo, situacao, proximo }, contexto = null) {
    if (!configurado.atualizacao()) { log({ event: 'blip_aviso', tipo: 'atualizacao', enviado: false, motivo: 'nao_configurado' }); return false; }
    const recipient = telefoneBlip(celular);
    if (!recipient) { log({ event: 'blip_aviso', tipo: 'atualizacao', enviado: false, motivo: 'telefone_invalido' }); return false; }
    return campanha('atualizacao', recipient, primeiro(nome), [['nome', titulo(primeiro(nome))], ['processo', variavel(processo)], ['situacao', variavel(situacao)], ['proximo', variavel(proximo)]], {}, contexto);
  }

  // Cobrança da taxa de matrícula: Pix dinâmico gerado no TOTVS + link do portal (cartão).
  async function cobranca({ celular, nome, centavos, codigoPix, referencia, recebedor, chave = '' }) {
    if (!configurado.cobranca()) { log({ event: 'blip_aviso', tipo: 'cobranca', enviado: false, motivo: 'nao_configurado' }); return false; }
    const recipient = telefoneBlip(celular);
    if (!recipient) { log({ event: 'blip_aviso', tipo: 'cobranca', enviado: false, motivo: 'telefone_invalido' }); return false; }
    const valor = Math.round(Number(centavos));
    if (!(valor > 0) || !codigoPix) { log({ event: 'blip_aviso', tipo: 'cobranca', enviado: false, motivo: 'sem_valor_ou_pix' }); return false; }
    // O Blip só aceita key_type CNPJ, CPF, EMAIL ou PHONE ("Tipos de Chave PIX" do artigo order_details): com
    // "EVP" (chave aleatória) o botão de pagamento chega vazio à Meta (#131008 "'action' cannot be null").
    // A chave da cobrança vale se for de um desses tipos; senão, a do recebedor em PIX_CHAVE (CNPJ da UniBalsas).
    // O pagamento segue pelo código Pix dinâmico do TOTVS (mesma conta).
    const daCobranca = chavePixDe(chave || await chaveDaCobrancaPix(codigoPix, fetcher));
    const chaveRecebedor = daCobranca && daCobranca.tipo !== 'EVP' ? daCobranca : chavePix() ?? daCobranca;
    if (!chaveRecebedor) { log({ event: 'blip_aviso', tipo: 'cobranca', enviado: false, motivo: 'sem_chave_pix' }); return false; }
    const quantia = { value: valor, offset: 100 };
    const pedido = {
      reference_id: String(referencia ?? '').replace(/[^\w-]/g, '').slice(0, 35) || 'mat-' + crypto.randomUUID().slice(0, 8),
      type: 'digital-goods', payment_type: 'br', currency: 'BRL', total_amount: quantia,
      payment_settings: [
        { type: 'pix_dynamic_code', pix_dynamic_code: { code: codigoPix, merchant_name: String(env.PIX_RECEBEDOR || recebedor || 'UniBalsas').slice(0, 25), key: chaveRecebedor.key, key_type: chaveRecebedor.tipo } },
        // "uri" (formato da Meta), como no corpo validado; com "link" o botão não é montado.
        { type: 'payment_link', payment_link: { uri: env.PAGAMENTO_LINK || 'https://vestibular.unibalsas.edu.br/presencial' } }
      ],
      order: { status: 'pending', subtotal: quantia, tax: { value: 0, offset: 100 }, items: [{ retailer_id: 'taxa-matricula', name: 'Taxa de matricula 2027/1', amount: quantia, quantity: 1 }] }
    };
    return campanha('cobranca', recipient, primeiro(nome), [['nome', titulo(primeiro(nome))], ['valor', reaisDe(valor)]], { '#payment#': JSON.stringify(pedido) });
  }

  return { atualizacao, cobranca, configurado };
}

// Aviso da etapa 1 (inscrição concluída, redação liberada): o mesmo template das outras etapas
// (unibalsas_atualizacao_processo: nome, processo, o que aconteceu, próximo passo + botão do Flow), com a trava
// AVISOS_SO_PARA. O flow_token vai em contextVariables para o bot do Blip abrir o Flow já na redação.
export async function avisarRedacaoLiberada({ celular, nome, flowToken }, { env = process.env, fetcher = fetch, log = e => console.info(JSON.stringify(e)) } = {}) {
  return createAvisosBlip({ env, fetcher, log }).atualizacao({ celular, nome, processo: 'inscrição',
    situacao: 'Sua inscrição foi concluída e a prova de redação já está liberada.',
    proximo: 'toque no botão abaixo e faça a sua redação aqui pelo WhatsApp.' }, { flow_token: flowToken });
}
