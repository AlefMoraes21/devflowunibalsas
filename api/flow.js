import {processPolicy,isDirectRegistration,requiresEssay} from "./processes.js";
import {enemAverage,enemYears} from "./enem.js";
import {portalConfirmsDelivery} from "./proof-binding.js";
import {promptText} from "./prompt-text.js";
import {createJobEngine} from "./jobs.js";
import {validationSummary} from "./diagnostics.js";
import {createProofRouter} from "./prova-route.js";
import { createAssessment, claimDelivery, ResultadoIncerto } from "./avaliacao.js";
import { createMatricula, SCREENS as MATRICULA_SCREENS, FORM_FIELDS as MATRICULA_FIELDS, USER_FIELDS as MATRICULA_USER_FIELDS, ACTIONS as MATRICULA_ACTIONS, validCpf } from "./matricula.js";
import { listDocuments, saveDocument } from "./documentos.js";
import crypto from "crypto";
import { AsyncLocalStorage } from "node:async_hooks";

const flowContext = new AsyncLocalStorage();
const FLOW_RESPONSE_BUDGET_MS = 9500;

const FORM_DEFAULTS = {
  ESCOLHA_PROCESSO: { processo_id: "" },
  DADOS_BASICOS: {
    nome: "",
    possui_nome_social: false,
    nome_social: "",
    email: "",
    data_nascimento: "",
    celular: "",
    genero: "",
    aceite_privacidade: false
  },
  CURSO_INTERESSE: {
    curso_id: "",
    turno_id: "",
    numero_inscricao_enem: "",
    ano_enem: "",
    nota_natureza_enem: "",
    nota_humanas_enem: "",
    nota_matematica_enem: "",
    nota_linguagens_enem: "",
    nota_redacao_enem: "",
    media_enem: ""
  },
  DOCUMENTOS_ENEM: { documento_enem: [] },
  QUASE_LA: {
    cpf: "",
    nacionalidade: "10",
    concluiu_ensino_medio: "",
    possui_deficiencia: "",
    tipos_deficiencia: [],
    deficiencia_outra: "",
    como_conheceu: "",
    como_conheceu_outro: ""
  },
  TELA_ORIENTACAO_PROVA: {},
  TELA_REDACAO: { texto_redacao: "" },
  CONFIRMACAO: {},
};

const SCREEN_KEYS = {
  ESCOLHA_PROCESSO: [
    "processo_seletivo_id",
    "tem_processos",
    "mensagem_vazio",
    "erro",
    "tem_erro",
    "estado",
    "valor_processo_id"
  ],
  DADOS_BASICOS: [
    "data_maxima_nascimento",
    "titulo_etapa",
    "erro",
    "tem_erro",
    "estado",
    "valor_nome",
    "valor_possui_nome_social",
    "valor_nome_social",
    "valor_email",
    "valor_data_nascimento",
    "valor_celular",
    "valor_genero",
    "valor_aceite_privacidade"
  ],
  CURSO_INTERESSE: [
    "cursos",
    "turnos",
    "turno_visivel",
    "erro",
    "eh_nota_enem",
    "anos_enem",
    "tem_erro",
    "estado",
    "valor_curso_id",
    "valor_turno_id",
    "valor_numero_inscricao_enem",
    "valor_ano_enem",
    "valor_nota_natureza_enem",
    "valor_nota_humanas_enem",
    "valor_nota_matematica_enem",
    "valor_nota_linguagens_enem",
    "valor_nota_redacao_enem",
    "valor_media_enem"
  ],
  DOCUMENTOS_ENEM: ["erro", "tem_erro", "estado"],
  QUASE_LA: [
    "origens",
    "erro",
    "tem_erro",
    "estado",
    "valor_cpf",
    "valor_nacionalidade",
    "valor_concluiu_ensino_medio",
    "valor_possui_deficiencia",
    "valor_tipos_deficiencia",
    "valor_deficiencia_outra",
    "valor_como_conheceu",
    "valor_como_conheceu_outro"
  ],
  TELA_ORIENTACAO_PROVA: ["tema_redacao", "texto_motivador", "estado", "erro", "tem_erro"],
  TELA_REDACAO: ["tema_redacao", "erro", "tem_erro", "estado", "valor_texto_redacao"],
  CONFIRMACAO: ["titulo", "mensagem", "inscricao_id"],
  PENDENTE: ["mensagem", "inscricao_id", "titulo"],
};

for(const screen of ["QUASE_LA","TELA_ORIENTACAO_PROVA","TELA_REDACAO"]){SCREEN_KEYS[screen].push("processando","editavel","acao_rodape","rotulo_rodape","mensagem_processamento","job_id","titulo_processamento")}

FORM_DEFAULTS.CURSO_ENEM=FORM_DEFAULTS.CURSO_INTERESSE;
SCREEN_KEYS.CURSO_ENEM=[...SCREEN_KEYS.CURSO_INTERESSE,"processando","editavel","acao_rodape","rotulo_rodape","mensagem_processamento","job_id","titulo_processamento"];

FORM_DEFAULTS.CURSO_INGRESSO=FORM_DEFAULTS.CURSO_INTERESSE;
SCREEN_KEYS.CURSO_INGRESSO=[...SCREEN_KEYS.CURSO_ENEM];

// Telas da continuação (login do candidato e matrícula).
Object.assign(SCREEN_KEYS, MATRICULA_SCREENS);
Object.assign(FORM_DEFAULTS, MATRICULA_FIELDS);
const SEALED_SCREENS = ["ESCOLHA_PROCESSO", "DADOS_BASICOS", "CURSO_INTERESSE", "CURSO_ENEM", "CURSO_INGRESSO", "DOCUMENTOS_ENEM", "QUASE_LA", "TELA_ORIENTACAO_PROVA", "TELA_REDACAO", ...Object.keys(MATRICULA_SCREENS)];
const PROXIMOS_PASSOS = "\n\nQuando houver uma nova etapa (resultado, pré-matrícula, documentos, contrato), abra este atendimento e escolha \"Já sou inscrito\" com seu CPF e data de nascimento.";
// Primeira tela: nova inscrição ou login de quem já se inscreveu (CPF + data de nascimento).
FORM_DEFAULTS.ESCOLHA_PROCESSO = { processo_id: "", modo: "nova", login: "" };
const PROCESSO_INDISPONIVEL = { id: "indisponivel", title: "Nenhum processo disponível" };
SCREEN_KEYS.ESCOLHA_PROCESSO.push("valor_modo", "valor_login", "data_maxima_nascimento");

const USER_FIELDS = new Set([
  "aceite_privacidade",
  "ano_enem",
  "celular",
  "como_conheceu",
  "como_conheceu_outro",
  "concluiu_ensino_medio",
  "cpf",
  "curso_id",
  "data_nascimento",
  "deficiencia_outra",
  "documento_enem",
  "email",
  "genero",
  "nacionalidade",
  "nome",
  "nome_social",
  "nota_humanas_enem",
  "nota_linguagens_enem",
  "nota_matematica_enem",
  "nota_natureza_enem",
  "nota_redacao_enem",
  "media_enem",
  "numero_inscricao_enem",
  "possui_deficiencia",
  "possui_nome_social",
  "processo_id",
  "processo_seletivo_id",
  "tipos_deficiencia",
  "turno_id",
  "texto_redacao",
  ...MATRICULA_USER_FIELDS,
]);

const RUBEUS_BASE_URL = "https://admin.portal.apprbs.com.br/api/v1";
const PORTAL_ID = 257;
const RUBEUS_TIMEOUT_MS = 6500;
const RUBEUS_FINAL_SUBMIT_TIMEOUT_MS = 9000;

const NACIONALIDADES_ESTATICAS = [
  { id: "10", title: "Brasileira" },
  { id: "20", title: "Naturalizado Brasileiro" },
  { id: "50", title: "Outros" }
];

const ORIGENS_PADRAO = [
  { id: "01", title: "Site oficial da instituição" },
  { id: "02", title: "Pesquisa no Google" },
  { id: "03", title: "Redes sociais (Instagram, Facebook...)" },
  { id: "04", title: "Anúncios patrocinados" },
  { id: "05", title: "Indicação de amigos ou familiares" },
  { id: "06", title: "Divulgação na escola ou empresa" },
  { id: "07", title: "Feiras, palestras ou eventos" },
  { id: "08", title: "Contato comercial (WhatsApp/Tel)" },
  { id: "09", title: "Materiais impressos (cartazes/outdoors)" },
  { id: "10", title: "Outro" }
];

const PROCESSO_NOTA_ENEM_ID = "20386";
const ANOS_ENEM = [
  "2026", "2025", "2024", "2023", "2022", "2021", "2020", "2019", "2018",
  "2017", "2016", "2015", "2014", "2013", "2012", "2011", "2010"
].map(a => ({ id: a, title: a }));

function isNotaEnemProcess(id) {
  return toStringValue(id) === PROCESSO_NOTA_ENEM_ID;
}

function isNotaEnemContext(d = {}) {
  return isNotaEnemProcess(d.processo_seletivo_id) || toBoolean(d.eh_nota_enem);
}

function enemFieldId(v, f) {
  return toStringValue(v, String(f));
}

function normalizeEnemRegistration(v) {
  const d = String(v ?? "").replace(/\D/g, "");
  if (d.length < 12 || d.length > 15) {
    throw new Error("A inscrição do ENEM deve ter de 12 a 15 números.");
  }
  return d;
}

function normalizeEnemScore(v, name) {
  const n = String(v ?? "").trim().replace(",", ".");
  if (!/^\d+(?:\.\d+)?$/.test(n)) {
    throw new Error(`${name} deve ser numérico.`);
  }
  const s = Number(n);
  if (!Number.isFinite(s) || s < 0 || s > 1000) {
    throw new Error(`${name} deve estar entre 0 e 1000.`);
  }
  return n;
}

function calcMediaEnemAuto(data) {
  try {
    const n = v => String(v ?? "").trim() === "" ? NaN : Number(String(v).replace(",", ".").trim());
    const notas = [
      n(data.nota_natureza_enem),
      n(data.nota_humanas_enem),
      n(data.nota_matematica_enem),
      n(data.nota_linguagens_enem),
      n(data.nota_redacao_enem)
    ];
    if (notas.some(v => !Number.isFinite(v))) {
      return null;
    }
    return Math.round(notas.reduce((a, b) => a + b, 0) / 5);
  } catch {
    return null;
  }
}

function requirePrivateKey() {
  if (!process.env.FLOW_PRIVATE_KEY) {
    throw new Error("FLOW_PRIVATE_KEY não configurada.");
  }
}

function normalizeText(v = "") {
  return String(v).normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
}

function toBoolean(v) {
  return v === true || v === "true" || v === 1 || v === "1";
}

function toStringValue(v, f = "") {
  if (v === null || v === undefined) {
    return f;
  }
  return String(v);
}

function normalizeNationality(v) {
  const id = toStringValue(v, "10");
  if (!NACIONALIDADES_ESTATICAS.some(i => i.id === id)) {
    throw new Error("Nacionalidade inválida.");
  }
  return id;
}

function toInteger(v, n) {
  const p = Number(String(v));
  if (!Number.isInteger(p) || p <= 0) {
    throw new Error(`Valor inválido para ${n}.`);
  }
  return p;
}

function normalizeCpf(v) {
  const d = String(v ?? "").replace(/\D/g, "");
  if (d.length !== 11) {
    throw new Error("CPF deve ter 11 dígitos.");
  }
  if (/^(\d)\1{10}$/.test(d)) {
    throw new Error("CPF inválido.");
  }
  for (const size of [9, 10]) {
    let sum = 0;
    for (let i = 0; i < size; i++) {
      sum += Number(d[i]) * (size + 1 - i);
    }
    if (((sum * 10) % 11) % 10 !== Number(d[size])) {
      throw new Error("CPF inválido.");
    }
  }
  return d;
}

// O site oficial (máscara do formulário) envia o celular apenas com dígitos: DDD + número.
function formatBrazilianPhone(v) {
  let d = String(v ?? "").replace(/\D/g, "");
  if ((d.length === 12 || d.length === 13) && d.startsWith("55")) {
    d = d.slice(2);
  }
  return d;
}

function fieldItem(id, val) {
  if (id === null || id === undefined || id === "") {
    return null;
  }
  return { field_id: toInteger(id, "field_id"), value: val };
}

function compactFields(f) {
  return f.filter(Boolean);
}

function getFormInputs(form) {
  return form?.content?.inputs ?? [];
}

function getFormButtons(form) {
  return form?.content?.buttons ?? [];
}

function findInput(form, labels = [], fallbackId = null) {
  const nl = labels.map(normalizeText);
  const inputs = getFormInputs(form);
  const byLabel = inputs.find(i => nl.includes(normalizeText(i.label)));
  if (byLabel) {
    return byLabel;
  }
  if (fallbackId !== null) {
    return inputs.find(i => Number(i.field_id) === Number(fallbackId)) ?? null;
  }
  return null;
}

function findButton(form, pref = ["Avançar", "Concluir", "Iniciar"]) {
  const buttons = getFormButtons(form);
  const norm = pref.map(normalizeText);
  const b = buttons.find(i => norm.some(p => normalizeText(i.label).includes(p))) ??
            buttons.find(i => normalizeText(i.label) !== "voltar");
  return b ?? null;
}

function findQueryForField(form, fieldId) {
  return (form?.querys ?? []).find(q => (q.fields ?? []).some(i => Number(i.field) === Number(fieldId))) ?? null;
}

function requireInput(input, name) {
  if (!input?.field_id) {
    throw new Error(`O campo "${name}" não foi localizado.`);
  }
  return input;
}

function flowOptions(options = []) {
  return options.map(o => ({
    id: toStringValue(o.value),
    title: toStringValue(o.label).replace(/-+$/g, "").trim().slice(0, 30)
  }));
}

function extractDataSourceOptions(r) {
  if (Array.isArray(r?.data)) {
    return r.data;
  }
  if (Array.isArray(r?.data?.options)) {
    return r.data.options;
  }
  return [];
}

function currentIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

async function downloadWhatsAppMedia(mediaId, token) {
  const metaGraphUrl = `https://graph.facebook.com/v21.0/${mediaId}`;
  const graphRes = await fetch(metaGraphUrl, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!graphRes.ok) {
    throw new Error("Falha ao recuperar URL do documento.");
  }
  const graphData = await graphRes.json();
  const fileRes = await fetch(graphData.url, {
    headers: { Authorization: `Bearer ${token}` }
  });
  return Buffer.from(await fileRes.arrayBuffer());
}

async function rubeusRequest(path, { method = "GET", body, timeoutMs = RUBEUS_TIMEOUT_MS } = {}) {
  if(flowContext.getStore()?.worker)timeoutMs=Math.max(timeoutMs,60000);
  const rawToken = process.env.RBS_TOKEN.trim().replace(/^Bearer\s+/i, "");
  const headers = { Authorization: `Bearer ${rawToken}` };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  const context = flowContext.getStore();
  const remaining = context ? context.deadline - Date.now() - 150 : timeoutMs;
  if (remaining < 300) {
    throw new Error("A consulta demorou.");
  }

  const began=Date.now();
  console.info(JSON.stringify({event:"rubeus_begin",path:path.split("?")[0]}));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.min(timeoutMs, remaining));
  const mutation = path === "/start" || path === "/submit";
  if (mutation && context) {
    context.write = { status: "sending", path };
  }

  try {
    const response = await fetch(`${RUBEUS_BASE_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal
    });
    const raw=await response.text();
    let json;
    try{json=JSON.parse(raw)}catch{
      console.warn(JSON.stringify({event:"rubeus_non_json",path:path.split("?")[0],http:response.status,contentType:response.headers.get("content-type"),redirected:response.redirected,ms:Date.now()-began}));
      throw new Error(`[RUBEUS_RESPOSTA] ${path.split("?")[0]} retornou resposta não JSON (HTTP ${response.status}).`);
    }
    console.info(JSON.stringify({event:"rubeus_end",request_id:context?.request_id,action:context?.request?.data?.acao,path:path.split("?")[0],http:response.status,success:json?.success===true,ms:Date.now()-began}));
    if (!response.ok || json?.success !== true) {
      const explanation=response.status===422?validationSummary(json,body):"Sem confirmação da operação.";
      console.warn(JSON.stringify({event:"rubeus_rejected",request_id:context?.request_id,action:context?.request?.data?.acao,path:path.split("?")[0],http:response.status,details:explanation}));
      if (mutation && context && (response.status===422||(response.status===403&&isDirectRegistration(context.request?.data?.processo_seletivo_id)))) {
        context.write = null;
      }
      throw new Error(`[RUBEUS_ERRO] ${path.split("?")[0]} não confirmou a operação (HTTP ${response.status}). ${response.status===422?explanation:""}`);
    }
    if (mutation && context) {
      context.write = { status: "received", path, result: json };
    }
    return json;
  } catch (e) {
    console.warn(JSON.stringify({event:"rubeus_error",request_id:context?.request_id,action:context?.request?.data?.acao,path:path.split("?")[0],kind:e.name,ms:Date.now()-began}));
    if (e.name === "AbortError") {
      throw new Error("O Rubeus não respondeu no prazo.");
    }
    throw e;
  } finally {
    clearTimeout(timeout);
  }
}

// -----------------------------------------------------------------------------
// INTEGRAÇÃO DINÂMICA COM O MÓDULO DE AVALIAÇÃO DA UNIBALSAS
// -----------------------------------------------------------------------------

function assessmentClient(){return createAssessment({maxRequestMs:flowContext.getStore()?.worker?30000:4500,observe:event=>console.info(JSON.stringify({event:"flow_assessment",...event})),remaining:()=>flowContext.getStore().deadline-Date.now(),markWrite:w=>{flowContext.getStore().write=w}})}
const proofRouter=createProofRouter({api:rubeusRequest,getForm,submitForm,remaining:()=>{const context=flowContext.getStore();return context?context.deadline-Date.now():120000}});
async function linkDaInscricao(data){return proofRouter.prepare(data)}
const academicId=id=>{try{return processPolicy(id).academicId}catch{return null}};
const matricula=createMatricula({api:rubeusRequest,getForm,submitForm,getDataSource,render:(screen,data)=>responseForScreen(screen,data),academicId,docs:{listDocuments,saveDocument}});

async function listProcesses() {
  const r = await rubeusRequest(`/selective-processes?portal=${PORTAL_ID}`);
  return (r.data ?? []).map(p => ({ id: String(p.id), title: String(p.name) }));
}

// Sessão do candidato já inscrito, carregada no estado selado (nunca vinda do cliente).
const cpfDigits = v => String(v ?? "").replace(/\D/g, "");
const sessaoDe = d => ({ token: toStringValue(d.token), applyment_id: toStringValue(d.applyment_id), person_id: toStringValue(d.person_id), processo_seletivo_id: toStringValue(d.processo_seletivo_id), cpf: cpfDigits(d.cpf) });
function validarLogin(data) {
  const cpf = cpfDigits(data.login);
  if (!validCpf(cpf)) throw new Error("Informe o CPF usado na inscrição (11 números).");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(data.data_nascimento ?? ""))) throw new Error("Informe sua data de nascimento.");
  return cpf;
}

// Depois da inscrição/redação: painel de acompanhamento sem fechar o Flow.
// Se o portal ainda não responder para esta sessão, mantém a confirmação tradicional.
async function acompanhamento(data, confirmation) {
  try {
    return await matricula.status(sessaoDe(data), "", "ACOMPANHAMENTO", { mensagem: confirmation.mensagem });
  } catch (e) {
    console.warn(JSON.stringify({ event: "acompanhamento_indisponivel", applicationId: toStringValue(data.applyment_id), message: e.message }));
    return responseForScreen("CONFIRMACAO", confirmation);
  }
}

async function routeMatricula(screen, action, data) {
  try {
    switch (action) {
      case "encerrar":
        return matricula.finish(data);
      case "enviar_documento":
        return await matricula.sendDocument(data);
      case "atualizar_portal":
        if (screen === "ETAPA_PORTAL" || screen === "DOCUMENTOS_INSCRICAO") return await matricula.advance(screen, sessaoDe(data));
        return await matricula.status(sessaoDe(data), "", screen === "ACOMPANHAMENTO" ? "ACOMPANHAMENTO" : "PORTAL_STATUS", screen === "ACOMPANHAMENTO" ? { mensagem: data.mensagem } : {});
      case "continuar_etapa":
        if (!data.proxima) return await matricula.status(sessaoDe(data));
        return await matricula.open(sessaoDe(data), data.proxima);
      case "buscar_cep":
        return responseForScreen(screen, { ...data, values: { ...data, ...(await matricula.cep(data)) }, erro: "" });
      case "buscar_cidade": {
        const list = await matricula.cities(data);
        return responseForScreen(screen, { ...data, cidades_natal: list, cidade_visivel: true, values: { ...data, cidade_natal: list.length === 1 ? list[0].id : "" }, erro: "" });
      }
      case "buscar_escola": {
        const list = await matricula.schools(data);
        return responseForScreen(screen, { ...data, escolas: list, escola_visivel: true, values: { ...data, escola: list.length === 1 ? list[0].id : "" }, erro: "" });
      }
      case "enviar_responsavel": case "enviar_endereco": case "enviar_resp_dados": case "enviar_identidade": case "enviar_cupom": {
        const token = await matricula.send(screen, data);
        console.info(JSON.stringify({ event: "matricula_step", screen, applicationId: toStringValue(data.applyment_id), step: toStringValue(data.etapa_passo), sent: Boolean(token) }));
        return await matricula.advance(screen, { ...sessaoDe(data), token: token ?? data.token });
      }
    }
  } catch (e) {
    const p = pendingAfterWrite(data);
    if (p) return p;
    const { arquivo, ...safe } = data; // mídia do DocumentPicker não entra no estado selado
    if (["PORTAL_STATUS", "ACOMPANHAMENTO", "ETAPA_PORTAL"].includes(screen)) return responseForScreen(screen, { ...safe, erro: e.message });
    return responseForScreen(screen, { ...safe, values: safe, erro: e.message });
  }
  return { data: { status: "active" } };
}

async function startApplication(id) {
  return rubeusRequest("/start", {
    method: "POST",
    body: { process: toInteger(id, "processo_seletivo_id") }
  });
}

async function getForm(target, local, token) {
  return rubeusRequest("/form", {
    method: "POST",
    body: {
      target: toInteger(target, "target"),
      local: toStringValue(local, "step"),
      token: toStringValue(token)
    }
  });
}

async function submitForm(button, data, token, timeoutMs = RUBEUS_TIMEOUT_MS) {
  return rubeusRequest("/submit", {
    method: "POST",
    timeoutMs,
    body: {
      button: toInteger(button, "button_id"),
      validate_on_server: true,
      data,
      token: toStringValue(token)
    }
  });
}

async function getDataSource({ datasource, target, filter = [], nextFields = [], token }) {
  return rubeusRequest("/data-source", {
    method: "POST",
    body: {
      datasource: toStringValue(datasource),
      target: toInteger(target, "target do data-source"),
      filter,
      nextFields: nextFields.map(i => toInteger(i, "nextFields")),
      token: toStringValue(token)
    }
  });
}

function buildBasicScreenData(formResponse, processId) {
  const form = formResponse?.data?.form;
  const token = formResponse?.token ?? formResponse?.data?.token;

  const nome = requireInput(findInput(form, ["Nome completo"], 38544), "Nome completo");
  const possui = requireInput(findInput(form, ["Possuo nome social"], 38606), "Possuo nome social");
  const nomeSocial = requireInput(findInput(form, ["Nome social"], 38607), "Nome social");
  const email = requireInput(findInput(form, ["E-mail", "Email"], 38545), "E-mail");
  const nasc = requireInput(findInput(form, ["Data de nascimento"], 38566), "Data de nascimento");
  const cel = requireInput(findInput(form, ["Celular"], 38546), "Celular");
  const genero = requireInput(findInput(form, ["Gênero", "Genero"], 38564), "Gênero");
  const consent = requireInput(findInput(form, ["Aceite da LGPD"], 38679), "Aceite");
  const idps = requireInput(findInput(form, ["IDPS"], 38548), "IDPS");
  const lgpdA = requireInput(findInput(form, ["LGPD - Assinatura"], 38707), "LGPD A");
  const lgpdB = requireInput(findInput(form, ["LGPD - Base legal"], 38708), "LGPD B");
  const generoR = requireInput(findInput(form, ["Gênero Rubeus", "Genero Rubeus"], 38565), "Gênero Rubeus");
  const button = findButton(form, ["Avançar"]);

  return {
    token: String(token),
    target: String(form.id),
    local: String(form.local),
    button_id: String(button.button),
    campo_nome_id: String(nome.field_id),
    campo_possui_nome_social_id: String(possui.field_id),
    campo_nome_social_id: String(nomeSocial.field_id),
    campo_email_id: String(email.field_id),
    campo_data_nascimento_id: String(nasc.field_id),
    campo_celular_id: String(cel.field_id),
    campo_genero_id: String(genero.field_id),
    campo_consentimento_id: String(consent.field_id),
    campo_idps_id: String(idps.field_id),
    campo_lgpd_assinatura_id: String(lgpdA.field_id),
    campo_lgpd_base_legal_id: String(lgpdB.field_id),
    campo_genero_rubeus_id: String(generoR.field_id),
    idps_valor: isDirectRegistration(processId) ? (toStringValue(idps.value).trim() || processPolicy(processId).academicId) : toStringValue(idps.value, processPolicy(processId).academicId),
    lgpd_assinatura_valor: toStringValue(lgpdA.value, "1"),
    lgpd_base_legal_valor: toStringValue(lgpdB.value, "4"),
    data_maxima_nascimento: currentIsoDate(),
    titulo_etapa: String(formResponse?.data?.stage?.steps?.find(s => Number(s.id) === Number(form.id))?.name ?? "Dados básicos"),
    processo_seletivo_id: isNotaEnemProcess(processId) ? PROCESSO_NOTA_ENEM_ID : toStringValue(processId),
    eh_nota_enem: isNotaEnemProcess(processId),
    erro: ""
  };
}

async function buildCourseScreenData(formResponse, processId) {
  const form = formResponse?.data?.form;
  const token = formResponse?.token ?? formResponse?.data?.token;

  const curso = requireInput(findInput(form, ["Curso"], 38627), "Curso");
  const turno = requireInput(findInput(form, ["Turno"], 38547), "Turno");
  const area = requireInput(findInput(form, ["IDAREAINTERESSE"], 38553), "IDAREAINTERESSE");
  const oferta = requireInput(findInput(form, ["CODOFERTA"], 38552), "CODOFERTA");
  const coligada = requireInput(findInput(form, ["CODCOLIGADA"], 38611), "CODCOLIGADA");
  const filial = requireInput(findInput(form, ["CODFILIAL"], 38612), "CODFILIAL");
  const tipo = requireInput(findInput(form, ["CODTIPOCURSO"], 38610), "CODTIPOCURSO");
  const button = findButton(form, ["Avançar"]);
  const query = findQueryForField(form, curso.field_id);
  const notaEnem = !isDirectRegistration(processId) && (getFormInputs(form).some(i => Number(i.field_id) === 38556) || isNotaEnemProcess(processId));

  const polo = notaEnem ? requireInput(findInput(form, ["CODPOLO"], 38550), "CODPOLO") : findInput(form, ["CODPOLO"], 38550);
  const eNum = notaEnem ? requireInput(findInput(form, ["Número de inscrição do ENEM"], 38556), "Número") : null;
  const eAno = notaEnem ? requireInput(findInput(form, ["Ano de realização do ENEM"], 38557), "Ano") : null;
  const eNat = notaEnem ? requireInput(findInput(form, ["Nota de ciências da natureza do ENEM"], 38563), "Natureza") : null;
  const eHum = notaEnem ? requireInput(findInput(form, ["Nota de ciências humanas do ENEM"], 38562), "Humanas") : null;
  const eMat = notaEnem ? requireInput(findInput(form, ["Nota de matemática do ENEM"], 38561), "Matemática") : null;
  const eLing = notaEnem ? requireInput(findInput(form, ["Nota de linguagens do ENEM"], 38560), "Linguagens") : null;
  const eRed = notaEnem ? requireInput(findInput(form, ["Nota da redação do ENEM"], 38559), "Redação") : null;
  const eMed = notaEnem ? requireInput(findInput(form, ["Média de notas do ENEM"], 38558), "Média") : null;

  const nextFields = (query.fields ?? []).map(i => Number(i.field)).filter(id => id !== Number(curso.field_id));
  const courseOptionsResponse = await getDataSource({
    datasource: query.query_data,
    target: curso.field_id,
    filter: [],
    nextFields,
    token
  });

  return {
    token: String(token),
    target: String(form.id),
    local: String(form.local),
    button_id: String(button.button),
    datasource: String(query.query_data),
    campo_curso_id: String(curso.field_id),
    campo_turno_id: String(turno.field_id),
    campo_area_interesse_id: String(area.field_id),
    campo_oferta_id: String(oferta.field_id),
    campo_polo_id: toStringValue(polo?.field_id),
    campo_coligada_id: String(coligada.field_id),
    campo_filial_id: String(filial.field_id),
    campo_tipo_curso_id: String(tipo.field_id),
    cursos: flowOptions(extractDataSourceOptions(courseOptionsResponse)),
    turnos: [],
    turno_visivel: false,
    curso_selecionado: "",
    turno_selecionado: "",
    area_interesse_valor: "",
    oferta_valor: "",
    polo_valor: "",
    coligada_valor: "",
    filial_valor: "",
    tipo_curso_valor: "",
    processo_seletivo_id: toStringValue(processId),
    eh_nota_enem: notaEnem,
    campo_enem_numero_id: toStringValue(eNum?.field_id),
    campo_enem_ano_id: toStringValue(eAno?.field_id),
    campo_enem_natureza_id: toStringValue(eNat?.field_id),
    campo_enem_humanas_id: toStringValue(eHum?.field_id),
    campo_enem_matematica_id: toStringValue(eMat?.field_id),
    campo_enem_linguagens_id: toStringValue(eLing?.field_id),
    campo_enem_redacao_id: toStringValue(eRed?.field_id),
    campo_enem_media_id: toStringValue(eMed?.field_id),
    anos_enem: notaEnem?enemYears(eAno,ANOS_ENEM):ANOS_ENEM,
    erro: ""
  };
}

function buildAlmostThereScreenData(formResponse, prev, dataAnterior = {}) {
  const form = formResponse?.data?.form;
  const token = formResponse?.token ?? formResponse?.data?.token ?? dataAnterior.token;

  const cpf = findInput(form, ["CPF"], 38567);
  const nac = findInput(form, ["Nacionalidade"], 38780);
  const em = findInput(form, ["Você já concluiu o ensino médio?"], 251544);
  const def = findInput(form, ["Possui alguma deficiência?"], 38575);
  const aud = findInput(form, ["Auditiva"], 38577);
  const fala = findInput(form, ["Fala"], 38578);
  const fis = findInput(form, ["Física", "Fisica"], 38576);
  const intel = findInput(form, ["Intelectual"], 38580);
  const vis = findInput(form, ["Visual"], 38579);
  const ment = findInput(form, ["Mental"], 38581);
  const out = findInput(form, ["Outras deficiências"], 38582);
  const outT = findInput(form, ["Deficiência motivo outras TOTVS"], 38583);
  const orig = findInput(form, ["Como você ficou sabendo sobre este processo seletivo?"], 319427);
  const origO = findInput(form, ["Outro:"], 319428);
  const button = form ? findButton(form, ["Concluir"]) : null;

  const redirect = prev?.data?.redirect ?? {};
  if(isDirectRegistration(dataAnterior.processo_seletivo_id)){
    if(!form?.id||!button?.button||(getFormButtons(form).filter(b=>normalizeText(b.label)==="concluir").length!==1))throw new Error("Não foi possível confirmar o formulário final deste processo. Use Retomar inscrição; seus dados não serão reenviados.");
    if(Number(prev?.data?.next)&&Number(form.id)!==Number(prev.data.next))throw new Error("O formulário retornado não corresponde à próxima etapa desta inscrição.");
    for(const [field,label] of [[cpf,"CPF"],[nac,"Nacionalidade"],[em,"Ensino médio"],[def,"Deficiência"],[orig,"Origem"]])requireInput(field,label);
  }
  if(isNotaEnemContext(dataAnterior)&&(!form?.id||!button?.button))throw new Error("Não foi possível confirmar o formulário final do ENEM. A operação não será reenviada automaticamente.");

  return {
    token: String(token),
    target: String(form?.id || "300663"),
    local: String(form?.local || "step"),
    button_id: String(button?.button || "3940366"),
    person_id: toStringValue(redirect.person_id || dataAnterior.person_id),
    applyment_id: toStringValue(redirect.applyment_id || dataAnterior.applyment_id),
    campo_cpf_id: String(cpf?.field_id || 38567),
    campo_nacionalidade_id: String(nac?.field_id || 38780),
    campo_ensino_medio_id: String(em?.field_id || 251544),
    campo_deficiencia_id: String(def?.field_id || 38575),
    campo_def_auditiva_id: String(aud?.field_id || 38577),
    campo_def_fala_id: String(fala?.field_id || 38578),
    campo_def_fisica_id: String(fis?.field_id || 38576),
    campo_def_intelectual_id: String(intel?.field_id || 38580),
    campo_def_visual_id: String(vis?.field_id || 38579),
    campo_def_mental_id: String(ment?.field_id || 38581),
    campo_def_outras_id: String(out?.field_id || 38582),
    campo_def_outras_texto_id: String(outT?.field_id || 38583),
    campo_origem_id: String(orig?.field_id || 319427),
    campo_origem_outro_id: String(origO?.field_id || 319428),
    origens: ORIGENS_PADRAO,
    processo_seletivo_id: toStringValue(dataAnterior.processo_seletivo_id),
    eh_nota_enem: toBoolean(dataAnterior.eh_nota_enem),
    erro: ""
  };
}

function stateKey() {
  return crypto.createHash("sha256")
    .update(process.env.FLOW_PRIVATE_KEY.replace(/\\n/g, "\n"))
    .update("unibalsas-flow-state-v1")
    .digest();
}

function sealState(screen, data) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", stateKey(), iv);
  const value = Buffer.concat([
    cipher.update(JSON.stringify({ screen, exp: Date.now() + 10800000, data })),
    cipher.final()
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), value]).toString("base64url");
}

function openState(value, screen) {
  try {
    const raw = Buffer.from(value ?? "", "base64url");
    const decipher = crypto.createDecipheriv("aes-256-gcm", stateKey(), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    const result = JSON.parse(
      Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8")
    );
    if (result.exp < Date.now() || result.screen !== screen) {
      throw new Error();
    }
    return result.data;
  } catch {
    throw new Error("Esta etapa expirou. Por favor, reabra.");
  }
}

function responseForScreen(screen, data) {
  if(screen==="CURSO_INTERESSE"&&isDirectRegistration(data.processo_seletivo_id))screen="CURSO_INGRESSO";
  if(screen==="CURSO_INTERESSE"&&isNotaEnemContext(data))screen="CURSO_ENEM";
  const entered = flowContext.getStore()?.request?.data ?? {};
  const values = { ...entered, ...data.values };
  const actionByScreen={CURSO_INGRESSO:"avancar_curso_ingresso",CURSO_ENEM:"avancar_curso_interesse",QUASE_LA:"enviar_informacoes_complementares",TELA_ORIENTACAO_PROVA:"iniciar_redacao",TELA_REDACAO:"enviar_redacao"};
  const labelByScreen={CURSO_INGRESSO:"Continuar",CURSO_ENEM:"Continuar",QUASE_LA:"Concluir inscrição",TELA_ORIENTACAO_PROVA:"Iniciar redação",TELA_REDACAO:"Enviar redação"};
  const next = {processando:false,editavel:true,job_id:"",mensagem_processamento:"",acao_rodape:actionByScreen[screen]??"",rotulo_rodape:labelByScreen[screen]??"Continuar", ...data, erro: data.erro ?? "", tem_erro: Boolean(data.erro) };
  // Navigation belongs to the destination screen, never to the previous form.
  if(actionByScreen[screen]){
    if(next.processando&&next.job_id){next.acao_rodape="consultar_tarefa";next.rotulo_rodape="Verificar andamento";next.editavel=false}
    else{next.processando=false;next.editavel=true;next.job_id="";next.acao_rodape=actionByScreen[screen];next.rotulo_rodape=labelByScreen[screen]}
  }
  if(screen==="TELA_ORIENTACAO_PROVA"&&data.proof_resume_required&&!(next.processando&&next.job_id)){
    next.acao_rodape="conferir_prova_existente";next.rotulo_rodape="Conferir prova existente";
  }
  if(screen==="TELA_ORIENTACAO_PROVA"&&data.prepared_existing&&!(next.processando&&next.job_id))next.rotulo_rodape="Continuar para redação";
  if(screen==="CURSO_ENEM"&&data.continuacao_enem&&!(next.processando&&next.job_id)){
    next.editavel=false;next.acao_rodape="retomar_etapa_enem";next.rotulo_rodape="Retomar inscrição";
    next.mensagem_processamento="Suas notas foram recebidas. Vamos consultar a próxima etapa sem enviá-las novamente.";
  }
  if(screen==="CURSO_INGRESSO"&&data.continuacao_ingresso&&!(next.processando&&next.job_id)){
    next.editavel=false;next.acao_rodape="retomar_etapa_ingresso";next.rotulo_rodape="Retomar inscrição";
    next.mensagem_processamento="Seu curso foi recebido. Vamos consultar a próxima etapa sem enviar os dados novamente.";
  }
  next.titulo_processamento=screen==="CURSO_INGRESSO"?"Só um instante ⏳ Gravando seu curso":screen==="CURSO_ENEM"?"Só um instante ⏳ Gravando suas notas":screen==="QUASE_LA"?"Só um instante ⏳ Concluindo sua inscrição":screen==="TELA_ORIENTACAO_PROVA"?"Só um instante ⏳ Preparando sua prova":"Só um instante ⏳ Enviando sua redação";
  if(screen==="TELA_REDACAO"&&data.recibo_avaliacao)next.titulo_processamento="Conferindo atualização da redação";
  if(screen==="TELA_REDACAO"&&data.recibo_avaliacao&&!(next.processando&&next.job_id)){
    next.processando=true;next.editavel=false;next.job_id="";next.acao_rodape="verificar_entrega";next.rotulo_rodape="Verificar atualização";next.titulo_processamento="Redação recebida";
    next.mensagem_processamento=data.mensagem_processamento||"A avaliação recebeu sua redação. Estamos conferindo a atualização da mesma inscrição no portal. Este botão não reenvia o texto.";
  }
  if (screen === "PENDENTE") {
    next.titulo ??= "Vamos conferir";
  }

  for (const [name, fallback] of Object.entries(FORM_DEFAULTS[screen] ?? {})) {
    next["valor_" + name] = values[name] ?? fallback;
  }

  if (screen === "CURSO_INTERESSE") {
    next.valor_curso_id = data.curso_selecionado ?? values.curso_id ?? "";
    next.valor_turno_id = data.turno_selecionado ?? values.turno_id ?? "";
    next.curso_selecionado ??= next.valor_curso_id;
    next.turno_selecionado ??= next.valor_turno_id;
  }

  if (screen === "ESCOLHA_PROCESSO") {
    next.processos_disponiveis = (data.processo_seletivo_id ?? []).map(p => p.id);
  }

  const trusted = Object.fromEntries(
    Object.entries(next).filter(([k]) => !k.startsWith("valor_") && k !== "estado" && k !== "values")
  );

  if (SEALED_SCREENS.includes(screen)) {
    next.estado = sealState(screen, trusted);
  }

  return {
    screen,
    data: Object.fromEntries(
      (SCREEN_KEYS[screen] ?? []).map(k => [
        k,
        next[k] ?? (
          k.startsWith("valor_") ? "" :
          k === "tem_erro" || k === "turno_visivel" || k === "eh_nota_enem" || k === "tem_processos" || k === "cidade_visivel" || k === "escola_visivel" ? false :
          ["cursos", "turnos", "anos_enem", "origens", "opcoes_responsavel", "ufs", "cidades_natal", "racas", "estados_civis", "anos", "escolas"].includes(k) ? [] : ""
        )
      ])
    )
  };
}

function pendingAfterWrite(data) {
  const write = flowContext.getStore()?.write;
  if (!write) {
    return null;
  }

  return responseForScreen("PENDENTE", {
    titulo: "Conferir processamento",
    mensagem: write.status === "received"
      ? "O Rubeus recebeu a operação, mas a próxima etapa ainda não foi confirmada. Confira a situação no Portal do candidato antes de repetir."
      : "A operação foi enviada, mas não foi possível confirmar o resultado. Confira a situação no Portal do candidato antes de repetir.",
    inscricao_id: toStringValue(write.result?.data?.redirect?.applyment_id ?? data.applyment_id)
  });
}

function validateBasic(data) {
  if (String(data.nome ?? "").trim().split(/\s+/).length < 2) {
    throw new Error("Informe nome e sobrenome.");
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(data.email ?? "").trim())) {
    throw new Error("Confira seu e-mail.");
  }
  const date = String(data.data_nascimento ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > currentIsoDate() || date < "1920-01-01") {
    throw new Error("Confira sua data de nascimento.");
  }
  if (!["M", "F"].includes(data.genero)) {
    throw new Error("Selecione seu gênero.");
  }
  const phone = String(data.celular ?? "").replace(/\D/g, "").replace(/^55(?=\d{10,11}$)/, "");
  if (!/^\d{10,11}$/.test(phone)) {
    throw new Error("Informe o celular com DDD.");
  }
  if (!toBoolean(data.aceite_privacidade)) {
    throw new Error("Aceite a Política de Privacidade.");
  }
  if (toBoolean(data.possui_nome_social) && !String(data.nome_social ?? "").trim()) {
    throw new Error("Informe seu nome social.");
  }
}

function validateFinal(data) {
  normalizeCpf(data.cpf);
  normalizeNationality(data.nacionalidade);
  if (!["Sim", "Não"].includes(data.concluiu_ensino_medio)) {
    throw new Error("Informe se concluiu o ensino médio.");
  }
  if (!["T", "F"].includes(data.possui_deficiencia)) {
    throw new Error("Informe se possui deficiência.");
  }
  if (!(data.origens ?? []).some(o => o.id === data.como_conheceu)) {
    throw new Error("Selecione como ficou sabendo sobre o processo seletivo.");
  }
  if (data.como_conheceu === "10" && !String(data.como_conheceu_outro ?? "").trim()) {
    throw new Error("Especifique como nos conheceu.");
  }
}

function basicRetryData(data, message) {
  return {
    ...data,
    data_maxima_nascimento: currentIsoDate(),
    titulo_etapa: "Dados básicos",
    erro: message
  };
}

function courseRetryData(data, message) {
  return {
    ...data,
    cursos: Array.isArray(data.cursos) && data.cursos.length > 0 ? data.cursos : [],
    turnos: Array.isArray(data.turnos) ? data.turnos : [],
    turno_visivel: Boolean(data.turno_visivel),
    curso_selecionado: toStringValue(data.curso_id ?? data.curso_selecionado),
    turno_selecionado: toStringValue(data.turno_id ?? data.turno_selecionado),
    anos_enem: ANOS_ENEM,
    erro: message
  };
}

function fastAlmostThereRetryData(data, message) {
  return {
    ...data,
    origens: Array.isArray(data.origens) ? data.origens : ORIGENS_PADRAO,
    processo_seletivo_id: toStringValue(data.processo_seletivo_id),
    eh_nota_enem: toBoolean(data.eh_nota_enem),
    erro: message || "Não foi possível concluir."
  };
}

async function routeFlowRequest(requestData) {
  const action = requestData?.action;
  let data = requestData?.data ?? {};
  const customAction = data?.acao;

  if (action === "data_exchange" && !data.error && customAction !== "recarregar_processos") {
    if ([
      "selecionar_processo",
      "enviar_dados_basicos",
      "buscar_turnos",
      "calcular_media",
      "retomar_etapa_enem",
      "avancar_curso_interesse",
      "avancar_curso_ingresso",
      "retomar_etapa_ingresso",
      "enviar_curso",
      "enviar_documento_enem",
      "enviar_informacoes_complementares",
      "iniciar_redacao",
      "conferir_prova_existente",
      "enviar_redacao",
      "verificar_entrega"
    ].includes(customAction) || MATRICULA_ACTIONS.has(customAction)) {
      const trusted = openState(data.estado, requestData.screen);
      const user = Object.fromEntries(Object.entries(data).filter(([k]) => USER_FIELDS.has(k)));
      data = { ...trusted, ...user, acao: customAction };
      if (customAction !== "selecionar_processo") {
        data.processo_seletivo_id = trusted.processo_seletivo_id;
      }
      requestData.data = data;
    }
  }

  if (action === "ping") {
    return { data: { status: "active" } };
  }

  if (action === "INIT" || (action === "data_exchange" && customAction === "recarregar_processos")) {
    try {
      const processes = await listProcesses();
      return responseForScreen("ESCOLHA_PROCESSO", {
        processo_seletivo_id: processes.length ? processes : [PROCESSO_INDISPONIVEL],
        tem_processos: processes.length > 0,
        mensagem_vazio: "Não há processos seletivos abertos.",
        data_maxima_nascimento: currentIsoDate(),
        erro: ""
      });
    } catch {
      return responseForScreen("ESCOLHA_PROCESSO", {
        processo_seletivo_id: [PROCESSO_INDISPONIVEL],
        tem_processos: false,
        mensagem_vazio: "Não conseguimos carregar os processos.",
        data_maxima_nascimento: currentIsoDate(),
        erro: "Não conseguimos carregar os processos abertos agora. Se você já se inscreveu, escolha \"Já sou inscrito\"."
      });
    }
  }

  if (action === "BACK") {
    return responseForScreen("PENDENTE", {
      mensagem: "Continue pela última etapa aberta.",
      inscricao_id: toStringValue(data.applyment_id)
    });
  }

  if (data.error) {
    return { data: { acknowledged: true } };
  }

  if (action !== "data_exchange") {
    return { data: { status: "active" } };
  }

  if (MATRICULA_ACTIONS.has(customAction)) {
    return routeMatricula(requestData.screen, customAction, data);
  }

  switch (customAction) {
    case "selecionar_processo": {
      try {
        const raw = data.processo_seletivo_id ?? data.processo_id;
        if (data.modo === "continuar") {
          const cpf = validarLogin(data);
          const session = await matricula.login(cpf, data.data_nascimento);
          return await matricula.status({ ...session, cpf });
        }
        processPolicy(raw);
        if (!raw) {
          throw new Error("Selecione um processo seletivo.");
        }
        const start = await startApplication(raw);
        const form = await getForm(start.data.next, start.data.local, start.token);
        return responseForScreen("DADOS_BASICOS", buildBasicScreenData(form, raw));
      } catch (e) {
        const p = pendingAfterWrite(data);
        if (p) return p;
        let procs = [];
        try {
          procs = await listProcesses();
        } catch {}
        return responseForScreen("ESCOLHA_PROCESSO", {
          processo_seletivo_id: procs.length ? procs : [PROCESSO_INDISPONIVEL],
          tem_processos: procs.length > 0,
          mensagem_vazio: "Sem processos.",
          data_maxima_nascimento: currentIsoDate(),
          values: { modo: data.modo, login: data.login, processo_id: data.modo === "continuar" ? "" : data.processo_seletivo_id },
          erro: e.message
        });
      }
    }

    case "enviar_dados_basicos": {
      try {
        validateBasic(data);
        const possui = toBoolean(data.possui_nome_social);
        const genero = toStringValue(data.genero);

        const fields = compactFields([
          fieldItem(data.campo_nome_id, toStringValue(data.nome).trim()),
          fieldItem(data.campo_possui_nome_social_id, possui),
          ...(possui ? [fieldItem(data.campo_nome_social_id, toStringValue(data.nome_social).trim())] : []),
          fieldItem(data.campo_email_id, toStringValue(data.email).trim()),
          fieldItem(data.campo_data_nascimento_id, toStringValue(data.data_nascimento)),
          fieldItem(data.campo_celular_id, formatBrazilianPhone(data.celular)),
          fieldItem(data.campo_genero_id, genero),
          fieldItem(data.campo_consentimento_id, toBoolean(data.aceite_privacidade)),
          fieldItem(data.campo_idps_id, toStringValue(data.idps_valor, processPolicy(data.processo_seletivo_id).academicId)),
          fieldItem(data.campo_lgpd_assinatura_id, toStringValue(data.lgpd_assinatura_valor, "1")),
          fieldItem(data.campo_lgpd_base_legal_id, toStringValue(data.lgpd_base_legal_valor, "4")),
          fieldItem(data.campo_genero_rubeus_id, genero === "M" ? "1" : "2")
        ]);

        const submit = await submitForm(data.button_id, fields, data.token);
        const next = await getForm(submit.data.next, submit.data.local, submit.data.token ?? data.token);
        return responseForScreen("CURSO_INTERESSE", await buildCourseScreenData(next, data.processo_seletivo_id));
      } catch (e) {
        const p = pendingAfterWrite(data);
        if (p) return p;
        return responseForScreen("DADOS_BASICOS", basicRetryData(data, e.message));
      }
    }

    case "buscar_turnos":
    case "avancar_curso_interesse":
    case "avancar_curso_ingresso": {
      try {
        if (customAction === "buscar_turnos" || data.curso_id !== data.curso_selecionado || !toBoolean(data.turno_visivel) || (data.turnos ?? []).length === 0) {
          if (!(data.cursos??[]).some(c=>c.id===data.curso_id)) {
            throw new Error("Selecione um curso para ver os turnos.");
          }
          const tech = [
            data.campo_area_interesse_id,
            data.campo_oferta_id,
            data.campo_polo_id,
            data.campo_coligada_id,
            data.campo_filial_id,
            data.campo_tipo_curso_id
          ].filter(Boolean);

          const shiftsResponse = await getDataSource({
            datasource: data.datasource,
            target: data.campo_turno_id,
            filter: [{ field: toInteger(data.campo_curso_id, "campo_curso_id"), values: toStringValue(data.curso_id) }],
            nextFields: tech,
            token: data.token
          });

          const shifts = flowOptions(extractDataSourceOptions(shiftsResponse));
          if (shifts.length === 0) {
            throw new Error("Nenhum turno disponível para o curso selecionado.");
          }
          const nextOptions = shiftsResponse?.data?.nextOptions ?? {};

          return responseForScreen("CURSO_INTERESSE", {
            ...data,
            cursos: data.cursos ?? [],
            turnos: shifts,
            turno_visivel: true,
            curso_selecionado: toStringValue(data.curso_id),
            turno_selecionado: shifts.length === 1 ? shifts[0].id : "",
            area_interesse_valor: toStringValue(nextOptions[toStringValue(data.campo_area_interesse_id)]?.value),
            oferta_valor: toStringValue(nextOptions[toStringValue(data.campo_oferta_id)]?.value),
            polo_valor: toStringValue(nextOptions[toStringValue(data.campo_polo_id)]?.value, isNotaEnemContext(data) ? "01" : ""),
            coligada_valor: toStringValue(nextOptions[toStringValue(data.campo_coligada_id)]?.value),
            filial_valor: toStringValue(nextOptions[toStringValue(data.campo_filial_id)]?.value),
            tipo_curso_valor: toStringValue(nextOptions[toStringValue(data.campo_tipo_curso_id)]?.value),
            anos_enem: data.anos_enem??ANOS_ENEM,
            erro: ""
          });
        }

        if (!data.curso_id || !(data.turnos ?? []).some(t => t.id === data.turno_id)) {
          throw new Error("Selecione o turno correspondente.");
        }

        const notaEnem = isNotaEnemContext(data);
        const campoPoloId = notaEnem ? toStringValue(data.campo_polo_id, "38550") : toStringValue(data.campo_polo_id);
        const poloValor = notaEnem ? toStringValue(data.polo_valor, "01") : toStringValue(data.polo_valor);
        const mediaCalculada = calcMediaEnemAuto(data);
        const mediaFinal = notaEnem?enemAverage(data):mediaCalculada;
        if(notaEnem&&!(data.anos_enem??ANOS_ENEM).some(y=>String(y.id)===String(data.ano_enem)))throw new Error("Selecione um ano de ENEM disponível.");

        const fields = compactFields([
          fieldItem(data.campo_curso_id, toStringValue(data.curso_id)),
          fieldItem(data.campo_turno_id, toStringValue(data.turno_id)),
          ...(notaEnem ? [
            fieldItem(enemFieldId(data.campo_enem_numero_id, 38556), normalizeEnemRegistration(data.numero_inscricao_enem)),
            fieldItem(enemFieldId(data.campo_enem_ano_id, 38557), toStringValue(data.ano_enem)),
            fieldItem(enemFieldId(data.campo_enem_natureza_id, 38563), normalizeEnemScore(data.nota_natureza_enem, "Ciências da Natureza")),
            fieldItem(enemFieldId(data.campo_enem_humanas_id, 38562), normalizeEnemScore(data.nota_humanas_enem, "Ciências Humanas")),
            fieldItem(enemFieldId(data.campo_enem_matematica_id, 38561), normalizeEnemScore(data.nota_matematica_enem, "Matemática")),
            fieldItem(enemFieldId(data.campo_enem_linguagens_id, 38560), normalizeEnemScore(data.nota_linguagens_enem, "Linguagens")),
            fieldItem(enemFieldId(data.campo_enem_redacao_id, 38559), normalizeEnemScore(data.nota_redacao_enem, "Redação")),
            fieldItem(enemFieldId(data.campo_enem_media_id, 38558), mediaFinal !== null ? mediaFinal : normalizeEnemScore(data.media_enem, "Média"))
          ] : []),
          fieldItem(data.campo_area_interesse_id, toStringValue(data.area_interesse_valor)),
          fieldItem(data.campo_oferta_id, toStringValue(data.oferta_valor)),
          fieldItem(campoPoloId, poloValor),
          fieldItem(data.campo_coligada_id, toStringValue(data.coligada_valor)),
          fieldItem(data.campo_filial_id, toStringValue(data.filial_valor)),
          fieldItem(data.campo_tipo_curso_id, toStringValue(data.tipo_curso_valor))
        ]);

        const submit = await submitForm(data.button_id, fields, data.token);
        const nextToken = submit.token ?? submit.data?.token ?? data.token;
        const redirect = submit?.data?.redirect ?? {};


        if(notaEnem){
          flowContext.getStore().audit={enemContinuation:{next:submit.data.next,local:submit.data.local,token:nextToken,processo_seletivo_id:data.processo_seletivo_id}};
          console.info(JSON.stringify({event:"enem_course_received",process:data.processo_seletivo_id,next:submit.data.next}));
        }
        if(isDirectRegistration(data.processo_seletivo_id)){
          flowContext.getStore().audit={ingressoContinuation:{next:submit.data.next,local:submit.data.local,token:nextToken,processo_seletivo_id:data.processo_seletivo_id}};
          console.info(JSON.stringify({event:"ingresso_course_received",process:data.processo_seletivo_id,next:submit.data.next}));
        }
        let nextForm = null;
        try {
          nextForm = await getForm(submit.data.next, submit.data.local, nextToken);
        } catch (formErr) {
          console.warn("Aviso: getForm demorou, avançando com mapeamento resiliente:", formErr.message);
        }

        return responseForScreen("QUASE_LA", buildAlmostThereScreenData(nextForm, submit, (notaEnem||isDirectRegistration(data.processo_seletivo_id))?{...data,token:nextToken}:data));
      } catch (e) {
        const p = pendingAfterWrite(data);
        if (p) return p;
        return responseForScreen("CURSO_INTERESSE", courseRetryData(data, e.message));
      }
    }

    case "retomar_etapa_ingresso": {
      const next=data.continuacao_ingresso;
      if(!isDirectRegistration(data.processo_seletivo_id)||!next||String(next.processo_seletivo_id)!==String(data.processo_seletivo_id))throw new Error("Retomada não autorizada nesta etapa.");
      flowContext.getStore().audit={ingressoContinuation:next};
      try{
        const form=await getForm(next.next,next.local,next.token);
        return responseForScreen("QUASE_LA",buildAlmostThereScreenData(form,{data:{next:next.next,local:next.local}},{...data,token:next.token}));
      }catch(e){return responseForScreen("CURSO_INGRESSO",{...data,erro:e.message})}
    }
    case "retomar_etapa_enem": {
      if(!isNotaEnemContext(data)||!data.continuacao_enem||String(data.continuacao_enem.processo_seletivo_id)!==String(data.processo_seletivo_id))throw new Error("Retomada não autorizada nesta etapa.");
      const next=data.continuacao_enem;
      flowContext.getStore().audit={enemContinuation:next};
      try{
        const form=await getForm(next.next,next.local,next.token);
        if(Number(form.data?.form?.id)!==Number(next.next))throw new Error("O Rubeus não retornou a etapa esperada do ENEM.");
        return responseForScreen("QUASE_LA",buildAlmostThereScreenData(form,{data:{next:next.next,local:next.local}},{...data,token:next.token}));
      }catch(e){return responseForScreen("CURSO_ENEM",{...data,erro:e.message})}
    }
    case "calcular_media": {
      if(!isNotaEnemContext(data))return responseForScreen("CURSO_INTERESSE",courseRetryData(data,"Esta ação pertence ao ENEM."));
      try{
        const media=enemAverage(data,{checkTyped:false});
        return responseForScreen("CURSO_INTERESSE",{...data,values:{...data,media_enem:media},erro:""});
      }catch(e){return responseForScreen("CURSO_INTERESSE",courseRetryData(data,e.message))}
    }
    case "enviar_documento_enem": {
      return responseForScreen("PENDENTE",{titulo:"Documentos do ENEM",mensagem:"Conclua o envio dos documentos pelo Portal do candidato. O recebimento no Rubeus ainda não foi confirmado por este canal.",inscricao_id:toStringValue(data.applyment_id)});
    }

    case "enviar_informacoes_complementares": {
      try {
        validateFinal(data);
        const has = toStringValue(data.possui_deficiencia) === "T";
        const sel = Array.isArray(data.tipos_deficiencia) ? data.tipos_deficiencia.map(String) : [];
        const selected = t => has && sel.includes(t);
        const other = selected("outras");

        const fields = compactFields([
          fieldItem(data.campo_cpf_id, normalizeCpf(data.cpf)),
          fieldItem(data.campo_nacionalidade_id, normalizeNationality(data.nacionalidade)),
          fieldItem(data.campo_ensino_medio_id, toStringValue(data.concluiu_ensino_medio)),
          fieldItem(data.campo_deficiencia_id, has ? "T" : "F"),
          ...(has ? [fieldItem(data.campo_def_auditiva_id, selected("auditiva"))] : []),
          ...(has ? [fieldItem(data.campo_def_fala_id, selected("fala"))] : []),
          ...(has ? [fieldItem(data.campo_def_fisica_id, selected("fisica"))] : []),
          ...(has ? [fieldItem(data.campo_def_intelectual_id, selected("intelectual"))] : []),
          ...(has ? [fieldItem(data.campo_def_visual_id, selected("visual"))] : []),
          ...(has ? [fieldItem(data.campo_def_mental_id, selected("mental"))] : []),
          ...(has ? [fieldItem(data.campo_def_outras_id, other)] : []),
          ...(other ? [fieldItem(data.campo_def_outras_texto_id, toStringValue(data.deficiencia_outra).trim())] : []),
          fieldItem(data.campo_origem_id, toStringValue(data.como_conheceu)),
          ...(toStringValue(data.como_conheceu) === "10" ? [fieldItem(data.campo_origem_outro_id, toStringValue(data.como_conheceu_outro).trim())] : [])
        ]);

        const submitResult=await submitForm(data.button_id,fields,data.token,RUBEUS_FINAL_SUBMIT_TIMEOUT_MS);
        const redirect=submitResult?.data?.redirect??{};
        if(!redirect.applyment_id)throw new Error("A inscrição ainda não foi confirmada pelo Rubeus.");
        // Somente o vestibular validado avança para a redação.
        if (requiresEssay(data.processo_seletivo_id)) {
          return responseForScreen("TELA_ORIENTACAO_PROVA", {
            ...data,
            // O tema é sorteado pelo módulo de avaliação e só é lido em iniciar_redacao.
            tema_redacao: "",
            texto_motivador: "",
            applyment_id: String(redirect.applyment_id),
            token: submitResult.data?.token??data.token,
            erro: "",
            tem_erro: false
          });
        }

        if(isDirectRegistration(data.processo_seletivo_id)){
          console.info(JSON.stringify({event:"ingresso_registration",applicationId:String(redirect.applyment_id),process:data.processo_seletivo_id,confirmed:true}));
          return await acompanhamento({...data,token:submitResult.token??submitResult.data?.token??data.token,applyment_id:String(redirect.applyment_id)},{titulo:"Obrigado pelo seu cadastro!",mensagem:`Sua inscrição de ${processPolicy(data.processo_seletivo_id).name} foi concluída. Protocolo: ${redirect.applyment_id}.\nNossos consultores entrarão em contato com você em breve.${PROXIMOS_PASSOS}`,inscricao_id:String(redirect.applyment_id)});
        }
        if(!isNotaEnemContext(data))throw new Error("Este processo não possui um destino de conclusão validado.");
        console.info(JSON.stringify({event:"enem_registration",applicationId:String(redirect.applyment_id),process:data.processo_seletivo_id,confirmed:true}));
        return await acompanhamento({...data,token:submitResult.token??submitResult.data?.token??data.token,applyment_id:String(redirect.applyment_id)}, {
          titulo: "Obrigado pelo seu cadastro!",
          mensagem: `Sua inscrição pelo ENEM foi concluída. Protocolo: ${redirect.applyment_id}.\nNossos consultores entrarão em contato com você em breve. A validação das notas e os documentos são acompanhados no Portal do candidato.${PROXIMOS_PASSOS}`,
          inscricao_id: String(redirect.applyment_id || "")
        });
      } catch (e) {
        const p = pendingAfterWrite(data);
        if (p) return p;
        return responseForScreen("QUASE_LA", fastAlmostThereRetryData(data, e.message));
      }
    }

    case "conferir_prova_existente": {
      if(!data.proof_resume_required)throw new Error("Conferência não autorizada nesta etapa.");
      try{
        const prepared=await proofRouter.resume(data);
        return responseForScreen("TELA_ORIENTACAO_PROVA",{...data,token:prepared.token,prepared_existing:prepared,proof_resume_required:false,erro:"",tem_erro:false});
      }catch(e){
        console.warn(JSON.stringify({event:"flow_error",action:"conferir_prova_existente",message:e.message,write:null}));
        return responseForScreen("TELA_ORIENTACAO_PROVA",{...data,erro:e.message,proof_resume_required:true});
      }
    }
    case "iniciar_redacao": {
      try {
        if(isDirectRegistration(data.processo_seletivo_id))throw new Error("Este processo não utiliza a redação deste Flow. Confira a conclusão da inscrição no portal; não é necessário realizar uma prova por aqui.");
        if(data.proof_resume_required)throw new Error("Confira a prova existente antes de continuar.");
        const prepared=data.prepared_existing??await linkDaInscricao(data);
        if(data.prepared_existing)await proofRouter.verify(data,prepared.binding);
        data.token=prepared.token??data.token;
        const sessao=await assessmentClient().init(prepared.link);
        if(String(sessao.exam.IDEXECPROVA).toUpperCase()!==prepared.binding.executionCode.toUpperCase())throw new Error("[PROVA_VINCULO] A avaliação abriu uma execução diferente da execução atual da inscrição.");
        sessao.binding=prepared.binding;
        await proofRouter.verify(data,sessao.binding);
        const tema=promptText(sessao.exam.questoes[0].enunciado);
        return responseForScreen("TELA_REDACAO",{...data,sessao_avaliacao:sessao,tema_redacao:tema,erro:"",tem_erro:false});
      }catch(e){
        console.warn(JSON.stringify({event:"flow_error",action:"iniciar_redacao",message:e.message,write:flowContext.getStore()?.write?.status??null}));
        const uncertain=pendingAfterWrite(data);if(uncertain)return uncertain;
        return responseForScreen("TELA_ORIENTACAO_PROVA",{...data,erro:e.message,tem_erro:true});
      }
    }
    case "enviar_redacao": {
      let receipt=data.recibo_avaliacao;
      try {
        if(receipt)return await followReceipt(data,receipt);
        const texto=String(data.texto_redacao??"").trim();
        if(texto.length<50)throw new Error("Por favor, desenvolva mais a sua redação antes de enviar.");
        if(!data.sessao_avaliacao?.exam)throw new Error("Sessão de prova não encontrada.");
        await proofRouter.verify(data,data.sessao_avaliacao.binding);
        await claimDelivery(data.sessao_avaliacao);
        receipt=await assessmentClient().send(data.sessao_avaliacao,texto);
        flowContext.getStore().audit={binding:data.sessao_avaliacao.binding,receipt:flowContext.getStore().write?.receipt};
        console.info(JSON.stringify({event:"proof_receipt",applicationId:String(data.applyment_id),executionId:receipt.id,executionCode:receipt.IDEXECPROVA,finalized:receipt.finalizada,sentAt:receipt.data_envio}));
        return await followReceipt(data,receipt);
      }catch(e){
        if(receipt)return receiptScreen(data,receipt,e.message);
        if(e instanceof ResultadoIncerto)return responseForScreen("PENDENTE",{titulo:"Conferir entrega",mensagem:e.message,inscricao_id:toStringValue(data.applyment_id)});
        return responseForScreen("TELA_REDACAO",{...data,erro:e.message,tem_erro:true});
      }
    }
    case "verificar_entrega":{
      if(!data.recibo_avaliacao)throw new Error("Recibo de entrega não encontrado.");
      return followReceipt(data,data.recibo_avaliacao);
    }

    default:
      return { data: { status: "active" } };
  }
}

function receiptScreen(data,receipt,error=""){
 return responseForScreen("TELA_REDACAO",{...data,recibo_avaliacao:receipt,processando:false,job_id:"",erro:error,mensagem_processamento:"A avaliação confirmou o recebimento. Estamos conferindo a atualização da mesma inscrição no portal. Verificar a atualização não envia a redação novamente."});
}
async function followReceipt(data,receipt){
 try{
  const checked=await proofRouter.verify(data,data.sessao_avaliacao?.binding);
  flowContext.getStore().audit={binding:data.sessao_avaliacao.binding,receipt:flowContext.getStore().write?.receipt??data.recibo_avaliacao,portal:checked.portal};
  console.info(JSON.stringify({event:"proof_portal_check",applicationId:String(data.applyment_id),confirmed:portalConfirmsDelivery(checked.portal)}));
  if(portalConfirmsDelivery(checked.portal))return await acompanhamento(data,{titulo:"Redação enviada",mensagem:`A entrega foi confirmada para a inscrição ${data.applyment_id}. Situação no portal: ${promptText(checked.portal.stages[0]?.feedback??"")}.\nO resultado sai após a correção.${PROXIMOS_PASSOS}`,inscricao_id:String(data.applyment_id)});
  return receiptScreen(data,receipt);
 }catch(e){return receiptScreen(data,receipt,e.message)}
}

function decryptRequest(body, privateKey) {
  const { encrypted_flow_data, encrypted_aes_key, initial_vector } = body ?? {};
  if (!encrypted_flow_data || !encrypted_aes_key || !initial_vector) {
    throw new Error("Payload incompleto.");
  }

  const aesKey = crypto.privateDecrypt(
    {
      key: privateKey,
      passphrase: process.env.FLOW_PASSPHRASE || undefined,
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: "sha256"
    },
    Buffer.from(encrypted_aes_key, "base64")
  );

  const iv = Buffer.from(initial_vector, "base64");
  const encryptedData = Buffer.from(encrypted_flow_data, "base64");
  const authTag = encryptedData.subarray(-16);
  const data = encryptedData.subarray(0, -16);

  const decipher = crypto.createDecipheriv("aes-128-gcm", aesKey, iv);
  decipher.setAuthTag(authTag);

  const decrypted = decipher.update(data, undefined, "utf8") + decipher.final("utf8");
  return { requestData: JSON.parse(decrypted), aesKey, iv };
}

function encryptResponse(payload, aesKey, iv) {
  const flippedIv = Buffer.from(iv.map(b => b ^ 0xff));
  const cipher = crypto.createCipheriv("aes-128-gcm", aesKey, flippedIv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  return Buffer.concat([encrypted, cipher.getAuthTag()]).toString("base64");
}

const jobEngine=createJobEngine({
  openState,render:responseForScreen,
  run:(request,worker=false)=>{
    const context={request_id:crypto.randomUUID(),deadline:Date.now()+(worker?120000:FLOW_RESPONSE_BUDGET_MS),request,write:null,worker};
    return flowContext.run(context,async()=>{const response=await routeFlowRequest(request);return worker?{response,audit:{...context.audit,...(context.write?.receipt?{receipt:context.write.receipt}:{})}}:response})
  }
});
export async function workerHandler(req,res){
  try{return res.status(await jobEngine.worker(req.body?.id,req.headers["x-flow-worker-signature"])).send("")}
  catch(error){console.error(JSON.stringify({event:"flow_worker_error",kind:error.name,message:error.message}));return res.status(500).send("")}
}

export default async function handler(req, res) {
  if (req.method === "GET") {
    return res.status(200).json({ status: "ok", version: "unibalsas-cloudrun-jornada-1.6.0" });
  }
  if (req.method !== "POST") {
    return res.status(405).send("Method not allowed");
  }

  const appSecret = process.env.META_APP_SECRET || process.env.APP_SECRET;
  if (appSecret) {
    const raw = Buffer.isBuffer(req.rawBody)
      ? req.rawBody
      : typeof req.rawBody === "string"
      ? Buffer.from(req.rawBody)
      : null;

    if (!raw) {
      return res.status(503).send("rawBody não preservado no servidor.");
    }
    const sig = req.headers?.["x-hub-signature-256"];
    if (!/^sha256=[a-f0-9]{64}$/i.test(sig ?? "")) {
      return res.status(432).send("Assinatura inválida.");
    }
    const expected = crypto.createHmac("sha256", appSecret).update(raw).digest();
    const received = Buffer.from(sig.slice(7), "hex");
    if (!crypto.timingSafeEqual(expected, received)) {
      return res.status(432).send("Assinatura inválida.");
    }
  }

  let aesKey, iv, requestData;
  try {
    requirePrivateKey();
    const privateKey = process.env.FLOW_PRIVATE_KEY.replace(/\\n/g, "\n");
    const dec = decryptRequest(req.body, privateKey);
    requestData = dec.requestData;
    aesKey = dec.aesKey;
    iv = dec.iv;

    const payload = await flowContext.run(
      { request_id:crypto.randomUUID(),deadline: Date.now() + FLOW_RESPONSE_BUDGET_MS, request: requestData, write: null },
      () => jobEngine.route(requestData)
    );

    const enc = encryptResponse(payload, aesKey, iv);
    res.setHeader("Content-Type", "text/plain");
    return res.status(200).send(enc);
  } catch (err) {
    if (aesKey && iv) {
      const current=["QUASE_LA","TELA_ORIENTACAO_PROVA","TELA_REDACAO"].includes(requestData?.screen)?requestData.screen:"PENDENTE";
      let trusted={};try{trusted=openState(requestData?.data?.estado,current)}catch{}
      const p=responseForScreen(current,{...trusted,values:requestData?.data,erro:err.message||"Não foi possível consultar o processamento.",mensagem:"Não foi possível carregar esta etapa.",inscricao_id:""});
      const enc = encryptResponse(p, aesKey, iv);
      res.setHeader("Content-Type", "text/plain");
      return res.status(200).send(enc);
    }
    return res.status(421).send("Erro na descriptografia do payload.");
  }
}
export {routeFlowRequest,flowContext,sealState,openState,responseForScreen};
