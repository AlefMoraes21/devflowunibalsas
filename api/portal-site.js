// Portal do candidato (vestibular.unibalsas.edu.br) pelo mesmo caminho do site: API interna
// /api/applyment/* do Rubeus, usada pelo navegador. Engenharia reversa: ENGENHARIA-REVERSA-VESTIBULAR-2027.md
// (seções 8, 10 e 15) e ENGENHARIA-REVERSA-VESTIBULAR-DOCUMENTOS-MATRICULA.md; estrutura do passo conferida
// ao vivo em 16/11/2026 (getApplymentDataByStep/300671).
//
// Documentos de matrícula: o site faz UM "Enviar" (button-click multipart) com as partes binárias
// file_0…file_n e, no campo do componente de upload, a lista de documentos do passo; cada documento
// enviado leva files:[{}] e value:["file_k"]; os demais vão com value:null. O Rubeus grava no RM (SDOCALUNO).
//
// Nada de CPF, data de nascimento, token ou session_id nos logs.
import crypto from "node:crypto";

export const SITE_URL = "https://vestibular.unibalsas.edu.br";
const API = SITE_URL + "/api/applyment/";
const DOMAIN = "vestibular.unibalsas.edu.br/presencial";
const MIME = { pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png" };

const str = v => (v === null || v === undefined ? "" : String(v));

// Lê o passo de documentos (getApplymentDataByStep) e devolve só o que o envio precisa.
export function lerPassoDocumentos(resp) {
  const cs = resp?.data?.steps?.currentStep;
  if (!cs) throw new Error("Passo de documentos sem conteúdo.");
  const todos = [];
  (function achatar(lista) { for (const c of lista ?? []) { todos.push(c); achatar(c.container_content); } })(cs.content);
  const upload = todos.find(c => c.type === "upload");
  // Botão que grava (store_data) — no Vestibular, "Envia documentos de matrícula" (3940449, rótulo "Enviar").
  const botao = todos.find(c => c.type === "button" && Number(c.store_data) === 1) ?? todos.find(c => c.type === "button" && /enviar/i.test(str(c.label)));
  if (!upload || !botao) throw new Error("Passo de documentos sem o componente de envio.");
  const linhas = Array.isArray(upload.upload_content) ? upload.upload_content : [];
  return {
    passo: Number(cs.id), stage_id: Number(cs.stage_id),
    componente: Number(upload.id),
    campo: Number(upload.field_id_related_to_component ?? upload.type_file_field_id_to_save_upload),
    botao: Number(botao.id), botao_relacionado: Number(botao.related_component_id),
    max_mb: Number(upload.upload_max_size) || 5,
    docs: linhas.map(r => ({
      codigo: str(r.CODTIPODOCUMENTO), titulo: str(r.DESCRICAODOCUMENTO), obrigatorio: str(r.OBRIGATORIO) === "1",
      chaverm: r.CHAVERM ?? null, status: r.STATUSENVIO ?? r.STATUS ?? null, path: r.PATHARQUIVO ?? null,
      adicional: r.ADICIONAL ?? null, adicional2: r.ADICIONAL2 ?? null
    }))
  };
}

// Botão de etapa (cta_link) em formato que o Run não conhece. Formatos observados no portal: "presencial/passo/<n>"
// (abre o passo) e "presencial/feedback/<n>" (só a situação). Outro formato = o portal mudou: não concluir nada.
export const linkDesconhecido = link => { const s = str(link).trim(); return Boolean(s) && !/passo\/\d+/.test(s) && !/feedback\/\d+/.test(s); };

// Status de cada documento no portal: 1 = em análise, 2 = recusado, 3 = aceito; vazio = não enviado.
export const jaEnviado = d => ["1", "3"].includes(str(d?.status));

// Corpo do "Enviar" igual ao do site. arquivos: [{ codigo, bytes (Buffer), nome, tipo }].
export function montarEnvio({ passo, sessao, processo, arquivos }) {
  const parte = new Map(arquivos.map((a, i) => [a.codigo, "file_" + i]));
  const lista = passo.docs.map(d => ({
    CODIGO: d.codigo, title: d.titulo, STATUSENVIO: d.status, PATHARQUIVO: d.path, CHAVERM: d.chaverm,
    ADICIONAL: d.adicional, ADICIONAL2: d.adicional2,
    files: parte.has(d.codigo) ? [{}] : [], value: parte.has(d.codigo) ? [parte.get(d.codigo)] : null
  }));
  const data = [{ field_id: passo.campo, key: passo.campo, component_id: passo.componente, type: "upload", field_settings_id: null, value: lista }];
  const fd = corpoClique({ sessao, passo, processo, data });
  arquivos.forEach((a, i) => fd.append("file_" + i, new Blob([a.bytes], { type: a.tipo }), a.nome));
  return { fd, data };
}

export function tipoDoArquivo(nome) {
  const ext = str(nome).split(".").pop().toLowerCase();
  return MIME[ext] ?? null;
}

export function createPortalSite({ fetcher = fetch, log = e => console.info(JSON.stringify(e)) } = {}) {
  async function post(caminho, corpo, { timeoutMs = 30000, multipart = false } = {}) {
    const inicio = Date.now();
    const rota = caminho.replace(/\/\d+$/, "/{passo}");
    let r;
    try {
      r = await fetcher(API + caminho, {
        method: "POST",
        headers: { Accept: "application/json", Origin: SITE_URL, Referer: SITE_URL + "/presencial/portal-inscrito", ...(multipart ? {} : { "Content-Type": "application/json" }) },
        body: multipart ? corpo : JSON.stringify(corpo),
        signal: AbortSignal.timeout(timeoutMs)
      });
    } catch (e) {
      log({ event: "portal_site", rota, erro: String(e?.name ?? e?.message ?? e).slice(0, 60), ms: Date.now() - inicio });
      throw new Error("O Portal do candidato não respondeu.");
    }
    const texto = await r.text().catch(() => "");
    let json = null; try { json = JSON.parse(texto); } catch {}
    log({ event: "portal_site", rota, http: r.status, success: json?.success ?? null, ms: Date.now() - inicio });
    if (!r.ok || json?.success !== true) {
      const msg = typeof json?.data === "string" ? json.data : typeof json?.message === "string" ? json.message : "";
      throw new Error(`Portal do candidato recusou ${rota} (HTTP ${r.status})${msg ? ": " + msg.slice(0, 140) : ""}`);
    }
    return json;
  }

  // Sessão do candidato, como o navegador: settings → login-portal (CPF + nascimento DDMMAAAA, sem captcha).
  async function entrar(cpf, nascimentoIso) {
    const s = await post("settings", { domain: DOMAIN });
    const token = s?.data?.token;
    if (!token) throw new Error("Portal do candidato sem token de sessão.");
    const [y, m, d] = str(nascimentoIso).split("-");
    const l = await post("login-portal", { domain: DOMAIN, user_data: { token_captcha: "", typeLogin: str(cpf).replace(/\D/g, ""), dataNascimento: `${d}${m}${y}` }, token, substitute_id: null, session_id: null });
    return { token, session_id: l?.data?.session_id ?? null, applyment_id: str(l?.data?.applyment_id), person_id: str(l?.data?.person_id) };
  }

  // Processo seletivo da inscrição (o mesmo que o portal mostra) e as etapas. O site leva ~16 s aqui.
  async function inscricao(sessao) {
    const r = await post("register-portal-data", { token: sessao.token, domain: DOMAIN, return_applyments: 1 }, { timeoutMs: 60000 });
    const lista = Array.isArray(r?.data?.applyments) ? r.data.applyments : [];
    const atual = lista.find(a => str(a.applyment_id) === sessao.applyment_id) ?? lista.find(a => str(a.current_process) === "1") ?? lista[0];
    return { processo: str(atual?.id), stages: r?.data?.stages ?? [] };
  }

  async function processo(sessao) {
    const r = await post("person-applyment", { token: sessao.token, domain: DOMAIN }, { timeoutMs: 20000 });
    const lista = Array.isArray(r?.data) ? r.data : [];
    const atual = lista.find(a => str(a.applyment_id) === sessao.applyment_id) ?? lista.find(a => str(a.current_process) === "1") ?? lista[0];
    return str(atual?.id);
  }

  async function passoDocumentos(sessao, passo, processo) {
    return lerPassoDocumentos(await post(`getApplymentDataByStep/${Number(passo)}`, { execute_stage_query: 1, token: sessao.token, process_id: Number(processo) }));
  }

  async function enviarDocumentos({ sessao, passo, processo, arquivos }) {
    const { fd } = montarEnvio({ passo, sessao, processo, arquivos });
    return post("button-click", fd, { multipart: true, timeoutMs: 90000 });
  }

  async function passoBruto(sessao, passo, processo) {
    return post(`getApplymentDataByStep/${Number(passo)}`, { execute_stage_query: 1, token: sessao.token, process_id: Number(processo) });
  }

  // Clique num botão do passo (multipart, igual ao site), sem arquivos.
  async function clicar({ sessao, passo, processo, data }) {
    return post("button-click", corpoClique({ sessao, passo, processo, data }), { multipart: true, timeoutMs: 90000 });
  }

  async function popup({ sessao, popupId, stageId }) {
    return post("popup", { popup_id: Number(popupId), stage: { stage_id: Number(stageId) }, token: sessao.token }, { timeoutMs: 60000 });
  }

  // Página do portal (place_type_id 4). 432 = "Meus dados" (nome, celular…), conferida em 16/11/2026.
  async function pagina(sessao, pageId, processo) {
    return post("page", { page_id: String(pageId), process_id: String(processo), stage_id: null, token: sessao.token }, { timeoutMs: 30000 });
  }

  return { entrar, inscricao, processo, passoDocumentos, enviarDocumentos, passoBruto, clicar, popup, pagina };
}

// Valores do candidato que o portal devolve junto com o passo ou a página (applicantData: field_id → value).
// Nos passos, campo oculto sem applicantData pode vir só em value_now do componente.
function dadosDoCandidato(resp) {
  const base = resp?.data?.steps?.currentStep ?? resp?.data?.page ?? resp?.data ?? {};
  const mapa = new Map();
  for (const x of base.applicantData ?? []) if (x?.field_id != null && x.value !== null && x.value !== undefined && x.value !== "") mapa.set(Number(x.field_id), x.value);
  return { base, mapa };
}
export const CAMPOS_CONTATO = { nome: 38544, celular: 38546 };
// Nome e celular do candidato (campos 38544 e 38546, os mesmos do passo de dados básicos).
export function contatoDaResposta(resp) {
  const { mapa } = dadosDoCandidato(resp);
  const nome = str(mapa.get(CAMPOS_CONTATO.nome)).trim(), celular = str(mapa.get(CAMPOS_CONTATO.celular)).replace(/\D/g, "");
  return nome || celular ? { nome, celular } : null;
}

// Passo do pagamento (300670 no Vestibular, 300701 na Transferência; conferido ao vivo em 16/11/2026).
// Botões com lógica pelo meio de pagamento (rádio 38702): "P" Pix (grava, popup 1016), "C" cartão, "B" boleto.
// Campos ocultos do TOTVS: 38656 IDBOLETO, 53443 valor Pix, 38661 valor formatado, 38658 taxa em centavos.
export const CAMPOS_PAGAMENTO = { idBoleto: 38656, valorPix: 53443, valorFormatado: 38661, centavos: 38658, meio: 38702, pixQr: 50900, pixCodigo: 50901 };
export function lerPassoPagamento(resp) {
  const cs = resp?.data?.steps?.currentStep;
  if (!cs) throw new Error("Passo do pagamento sem conteúdo.");
  const todos = [];
  (function achatar(lista) { for (const c of lista ?? []) { todos.push(c); achatar(c.container_content); } })(cs.content);
  const { mapa } = dadosDoCandidato(resp);
  const valores = {};
  for (const c of todos) if (c.field_id) {
    const v = mapa.has(Number(c.field_id)) ? mapa.get(Number(c.field_id)) : c.value_now ?? c.data_value ?? "";
    valores[Number(c.field_id)] = str(v);
  }
  for (const [k, v] of mapa) if (!(k in valores)) valores[k] = str(v);
  const botaoDe = letra => todos.find(c => c.type === "button" && (c.logics ?? []).some(l => str(l?.fixed_value) === letra));
  const pix = botaoDe("P");
  if (!pix) throw new Error("Passo do pagamento sem o botão do Pix.");
  const campos = todos.filter(c => c.field_id).map(c => ({ field_id: Number(c.field_id), field_settings_id: c.field_settings_id ?? null, type: c.type, ps_table: c.ps_table ?? null, rubeus_table: c.rubeus_table ?? null }));
  const conteudos = todos.filter(c => !c.field_id && (c.type === "text" || c.type === "html") && Number(c.logic_enabled) !== 1)
    .map(c => ({ component_id: c.id, key: str(c.key), type: c.type === "html" ? "htmlelement" : "content" }));
  return { passo: Number(cs.id), stage_id: Number(cs.stage_id), botao: Number(pix.id), botao_relacionado: Number(pix.related_component_id), campos, conteudos, valores };
}

// Valor da taxa em centavos: o do Pix (53443, "390.00") quando houver; senão a taxa em centavos (38658).
export function centavosDoPagamento(passo) {
  const v = passo?.valores ?? {};
  const pix = str(v[CAMPOS_PAGAMENTO.valorPix]).replace(/[^\d.,]/g, "");
  if (pix) {
    const n = Number(pix.includes(",") ? pix.replace(/\./g, "").replace(",", ".") : pix);
    if (Number.isFinite(n) && n > 0) return Math.round(n * 100);
  }
  const c = Number(str(v[CAMPOS_PAGAMENTO.centavos]).replace(/\D/g, ""));
  return c > 0 ? c : 0;
}

// Igual ao site no "Realizar pagamento" do Pix: campos com component_id nulo, key numérica, o rádio com "P"
// e os textos visíveis do passo com valor vazio.
export function dadosDoPix(passo) {
  const campos = passo.campos.map(c => ({
    field_id: c.field_id, field_settings_id: c.field_settings_id, component_id: null, key: c.field_id,
    value: c.field_id === CAMPOS_PAGAMENTO.meio ? "P" : str(passo.valores?.[c.field_id]),
    rubeus_table: c.rubeus_table, ps_table: c.ps_table, type: c.type === "radio" ? "radio" : "textfield"
  })).filter(c => ![CAMPOS_PAGAMENTO.pixQr, CAMPOS_PAGAMENTO.pixCodigo].includes(c.field_id));
  const conteudos = (passo.conteudos ?? []).map(c => ({ field_id: null, field_settings_id: null, component_id: c.component_id, key: c.key, value: "", type: c.type }));
  return [...campos, ...conteudos];
}

// BR Code do Pix (copia e cola): começa com 000201 e termina no CRC (6304 + 4 hexadecimais).
export function pixValido(codigo) {
  const c = str(codigo).trim();
  return /^000201[\x20-\x7e]{20,}6304[0-9A-Fa-f]{4}$/.test(c) ? c : "";
}
// Copia e cola do popup "Totvs Pagamento Instântaneo" (1016): campo 50901.
export function pixDoPopup(resp) {
  const item = (resp?.data?.applicantData ?? []).find(x => Number(x.field_id) === CAMPOS_PAGAMENTO.pixCodigo);
  const c = pixValido(item?.value);
  if (!c) throw new Error("O portal não devolveu o código Pix.");
  return c;
}
// Campos do BR Code (TLV): tag de 2 dígitos + tamanho de 2 dígitos + valor.
function tlvPix(texto) {
  const c = str(texto), out = {};
  for (let i = 0; i + 4 <= c.length;) {
    const tag = c.slice(i, i + 2), n = Number(c.slice(i + 2, i + 4));
    if (!Number.isFinite(n)) break;
    out[tag] = c.slice(i + 4, i + 4 + n);
    i += 4 + n;
  }
  return out;
}
// URL da cobrança do Pix dinâmico (campo 26, subcampo 25), ex.: api.rendimento.com.br/q/v2/{id}.
export function urlDaCobrancaPix(codigo) {
  const u = tlvPix(tlvPix(codigo)["26"] ?? "")["25"] ?? "";
  return /^[\w.-]+\.[a-z]{2,}\/[\x21-\x7e]+$/i.test(u) ? "https://" + u : "";
}
// Chave Pix do recebedor, lida da própria cobrança (o JWS que o app do banco lê na URL do Pix). Vem do sistema,
// nunca fixa no código: a da UniBalsas no Banco Rendimento é aleatória (EVP). Sem resposta, devolve "".
export async function chaveDaCobrancaPix(codigo, fetcher = fetch) {
  const url = urlDaCobrancaPix(codigo);
  if (!url) return "";
  try {
    const r = await fetcher(url, { signal: AbortSignal.timeout(8000) });
    const corpo = await r.text();
    for (const m of corpo.matchAll(/eyJ[\w-]+\.(eyJ[\w-]+)\.[\w-]+/g)) {
      try {
        const j = JSON.parse(Buffer.from(m[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
        if (typeof j?.chave === "string" && j.chave.trim()) return j.chave.trim();
      } catch {}
    }
  } catch {}
  return "";
}
// Nome do recebedor dentro do BR Code (campo 59).
export function recebedorDoPix(codigo) {
  const c = str(codigo);
  for (let i = 0; i + 4 <= c.length;) {
    const tag = c.slice(i, i + 2), n = Number(c.slice(i + 2, i + 4));
    if (!Number.isFinite(n)) break;
    if (tag === "59") return c.slice(i + 4, i + 4 + n).trim();
    i += 4 + n;
  }
  return "";
}

// Corpo multipart do button-click (campos de controle iguais ao site). data: lista de campos do passo.
export function corpoClique({ sessao, passo, processo, data }) {
  const fd = new FormData();
  const campos = {
    formio_comp_id: "e" + crypto.randomBytes(4).toString("hex").slice(0, 6),
    stage_id: passo.stage_id, selective_process_id: processo, domainParams: "presencial",
    last_place_id: passo.passo, last_place_type_id: 1, button_id: passo.botao, related_component_id: passo.botao_relacionado,
    data: JSON.stringify(data), rbParams: null, token: sessao.token, substitute_id: null, session_id: sessao.session_id ?? null,
    hostClient: null, contact_id_crm: null
  };
  for (const [k, v] of Object.entries(campos)) fd.append(k, v === null ? "null" : String(v));
  return fd;
}

// Passo do contrato (300669 no Vestibular): botão "Clique aqui para fazer o download do contrato" e os campos
// que o site envia junto (aceite 38635 = false, data de assinatura 38636 = "", IP de aceite 52136 = IP de quem clica).
export function lerPassoContrato(resp) {
  const cs = resp?.data?.steps?.currentStep;
  if (!cs) throw new Error("Passo do contrato sem conteúdo.");
  const todos = [];
  (function achatar(lista) { for (const c of lista ?? []) { todos.push(c); achatar(c.container_content); } })(cs.content);
  const botao = todos.find(c => c.type === "button" && /download.*contrato|contrato/i.test(str(c.label)) && !/portal/i.test(str(c.label)));
  if (!botao) throw new Error("Passo do contrato sem o botão de download.");
  const campos = todos.filter(c => c.field_id).map(c => ({
    field_id: Number(c.field_id), field_settings_id: c.field_settings_id ?? null, type: c.type, ps_table: c.ps_table ?? null, rubeus_table: c.rubeus_table ?? null, label: str(c.label)
  }));
  // Componentes de texto visíveis (sem lógica de exibição) também vão no clique, com valor vazio, como o site faz.
  const conteudos = todos.filter(c => !c.field_id && (c.type === "text" || c.type === "html") && Number(c.logic_enabled) !== 1)
    .map(c => ({ component_id: c.id, key: str(c.key), type: c.type === "html" ? "htmlelement" : "content" }));
  return { passo: Number(cs.id), stage_id: Number(cs.stage_id), botao: Number(botao.id), botao_relacionado: Number(botao.related_component_id), campos, conteudos };
}

// Igual ao site: nos campos, component_id nulo, key numérica e tipo do Form.io (checkbox/textfield).
export function dadosDoContrato(passo, ip) {
  const campos = passo.campos.map(c => ({
    field_id: c.field_id, field_settings_id: c.field_settings_id, component_id: null, key: c.field_id,
    value: c.type === "checkbox" ? false : /\bip\b/i.test(c.label) ? str(ip) : "",
    rubeus_table: c.rubeus_table, ps_table: c.ps_table, type: c.type === "checkbox" ? "checkbox" : "textfield"
  }));
  const conteudos = (passo.conteudos ?? []).map(c => ({ field_id: null, field_settings_id: null, component_id: c.component_id, key: c.key, value: "", type: c.type }));
  return [...campos, ...conteudos];
}

// PDF do contrato: o site lê o base64 do campo 52138 na resposta do popup "Contrato gerado".
export function pdfDoPopup(resp, campo = 52138) {
  const item = (resp?.data?.applicantData ?? []).find(x => Number(x.field_id) === Number(campo));
  const b64 = str(item?.value).replace(/^data:[^,]*,/, "");
  const pdf = Buffer.from(b64, "base64");
  if (pdf.length < 100 || pdf.subarray(0, 5).toString("latin1") !== "%PDF-") throw new Error("O portal não devolveu o PDF do contrato.");
  return pdf;
}
