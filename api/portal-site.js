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
  const fd = new FormData();
  const campos = {
    formio_comp_id: "e" + crypto.randomBytes(4).toString("hex").slice(0, 6),
    stage_id: passo.stage_id, selective_process_id: processo, domainParams: "presencial",
    last_place_id: passo.passo, last_place_type_id: 1, button_id: passo.botao, related_component_id: passo.botao_relacionado,
    data: JSON.stringify(data), rbParams: null, token: sessao.token, substitute_id: null, session_id: sessao.session_id ?? null,
    hostClient: null, contact_id_crm: null
  };
  for (const [k, v] of Object.entries(campos)) fd.append(k, v === null ? "null" : String(v));
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

  async function passoDocumentos(sessao, passo, processo) {
    return lerPassoDocumentos(await post(`getApplymentDataByStep/${Number(passo)}`, { execute_stage_query: 1, token: sessao.token, process_id: Number(processo) }));
  }

  async function enviarDocumentos({ sessao, passo, processo, arquivos }) {
    const { fd } = montarEnvio({ passo, sessao, processo, arquivos });
    return post("button-click", fd, { multipart: true, timeoutMs: 90000 });
  }

  return { entrar, inscricao, passoDocumentos, enviarDocumentos };
}
