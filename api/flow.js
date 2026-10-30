import crypto from "crypto";
import { AsyncLocalStorage } from "node:async_hooks";
const flowContext = new AsyncLocalStorage();
const FLOW_RESPONSE_BUDGET_MS = 8500;
const FORM_DEFAULTS = {
  ESCOLHA_PROCESSO: { processo_id: "" },
  SEM_PROCESSOS: {},
  DADOS_BASICOS: {
    nome: "",
    possui_nome_social: false,
    nome_social: "",
    email: "",
    data_nascimento: "",
    celular: "",
    genero: "",
    aceite_privacidade: false,
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
  },
  QUASE_LA: {
    cpf: "",
    nacionalidade: "10",
    concluiu_ensino_medio: "",
    possui_deficiencia: "",
    tipos_deficiencia: [],
    deficiencia_outra: "",
    como_conheceu: "",
    como_conheceu_outro: "",
  },
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
    "valor_processo_id",
  ],
  SEM_PROCESSOS: ["mensagem"],
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
    "valor_aceite_privacidade",
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
  ],
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
    "valor_como_conheceu_outro",
  ],
  CONFIRMACAO: ["titulo", "mensagem", "inscricao_id"],
  PENDENTE: ["mensagem", "inscricao_id", "titulo"],
};
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
  "numero_inscricao_enem",
  "possui_deficiencia",
  "possui_nome_social",
  "processo_id",
  "processo_seletivo_id",
  "tipos_deficiencia",
  "turno_id",
]);

const RUBEUS_BASE_URL = "https://admin.portal.apprbs.com.br/api/v1";
const PORTAL_ID = 257;
const RUBEUS_TIMEOUT_MS = 6000;
const RUBEUS_FINAL_SUBMIT_TIMEOUT_MS = 8000;

const NACIONALIDADES_ESTATICAS = [
  { id: "10", title: "Brasileira" },
  { id: "20", title: "Naturalizado Brasileiro" },
  { id: "50", title: "Outros" },
];

const FALLBACK_ORIGINS = [
  { id: "01", title: "Site oficial da instituição" },
  { id: "02", title: "Pesquisa no próprio Google" },
  { id: "03", title: "Redes sociais" },
  { id: "04", title: "Anúncios patrocinados" },
  { id: "05", title: "Indicação de amigos ou familiares" },
  { id: "06", title: "Divulgação na escola ou empresa" },
  { id: "07", title: "Feiras, palestras ou eventos" },
  { id: "08", title: "Contato do time comercial" },
  { id: "09", title: "Materiais impressos" },
  { id: "10", title: "Outro" },
];

const PROCESSO_NOTA_ENEM_ID = "20386";

const ANOS_ENEM = [
  "2025",
  "2024",
  "2023",
  "2022",
  "2021",
  "2020",
  "2019",
  "2018",
  "2017",
  "2016",
  "2015",
  "2014",
  "2013",
  "2012",
  "2011",
  "2010",
].map((ano) => ({ id: ano, title: ano }));

function isNotaEnemProcess(processId) {
  return toStringValue(processId) === PROCESSO_NOTA_ENEM_ID;
}

function isNotaEnemContext(data = {}) {
  return (
    isNotaEnemProcess(data.processo_seletivo_id) && toBoolean(data.eh_nota_enem)
  );
}

function enemFieldId(value, fallback) {
  return toStringValue(value, String(fallback));
}

function normalizeEnemRegistration(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (digits.length < 12 || digits.length > 15) {
    throw new Error(
      "O número de inscrição do ENEM deve conter de 12 a 15 números.",
    );
  }
  return digits;
}

function normalizeEnemScore(value, fieldName) {
  const normalized = String(value ?? "")
    .trim()
    .replace(",", ".");
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) {
    throw new Error(`${fieldName} deve conter somente números.`);
  }
  const score = Number(normalized);
  if (!Number.isFinite(score) || score < 0 || score > 1000) {
    throw new Error(`${fieldName} deve estar entre 0 e 1000.`);
  }
  return normalized;
}

function calcMediaEnemAuto(data) {
  try {
    const n = (v) =>
      String(v ?? "").trim() === ""
        ? NaN
        : Number(String(v).replace(",", ".").trim());
    const notas = [
      n(data.nota_natureza_enem),
      n(data.nota_humanas_enem),
      n(data.nota_matematica_enem),
      n(data.nota_linguagens_enem),
      n(data.nota_redacao_enem),
    ];
    if (notas.some((v) => !Number.isFinite(v))) return null;
    return Math.round(notas.reduce((a, b) => a + b, 0) / 5);
  } catch {
    return null;
  }
}

function requirePrivateKey() {
  if (!process.env.FLOW_PRIVATE_KEY) {
    throw new Error("A variável FLOW_PRIVATE_KEY não foi configurada.");
  }
}

function normalizeText(value = "") {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function toBoolean(value) {
  return value === true || value === "true" || value === 1 || value === "1";
}

function toStringValue(value, fallback = "") {
  if (value === null || value === undefined) return fallback;
  return String(value);
}

function normalizeNationality(value) {
  const nationalityId = toStringValue(value, "10");
  const isAllowed = NACIONALIDADES_ESTATICAS.some(
    (item) => item.id === nationalityId,
  );
  if (!isAllowed) {
    throw new Error("Nacionalidade inválida.");
  }
  return nationalityId;
}

function toInteger(value, fieldName) {
  const parsed = Number(String(value));
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Valor inválido para ${fieldName}.`);
  }
  return parsed;
}

function normalizeCpf(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (digits.length !== 11) {
    throw new Error("O CPF deve conter exatamente 11 números.");
  }
  if (/^(\d)\1{10}$/.test(digits)) throw new Error("CPF inválido.");
  for (const size of [9, 10]) {
    let sum = 0;
    for (let i = 0; i < size; i++) sum += Number(digits[i]) * (size + 1 - i);
    if (((sum * 10) % 11) % 10 !== Number(digits[size]))
      throw new Error("CPF inválido.");
  }
  return digits;
}

function formatBrazilianPhone(value) {
  let digits = String(value ?? "").replace(/\D/g, "");
  if (
    (digits.length === 12 || digits.length === 13) &&
    digits.startsWith("55")
  ) {
    digits = digits.slice(2);
  }
  if (digits.length === 11) {
    return digits.replace(/(\d{2})(\d{5})(\d{4})/, "($1) $2-$3");
  }
  if (digits.length === 10) {
    return digits.replace(/(\d{2})(\d{4})(\d{4})/, "($1) $2-$3");
  }
  return String(value ?? "");
}

function fieldItem(fieldId, value) {
  if (fieldId === null || fieldId === undefined || fieldId === "") return null;
  return {
    field_id: toInteger(fieldId, "field_id"),
    value,
  };
}

function compactFields(fields) {
  return fields.filter(Boolean);
}

function getFormInputs(form) {
  return form?.content?.inputs ?? [];
}

function getFormButtons(form) {
  return form?.content?.buttons ?? [];
}

function findInput(form, labels = [], fallbackId = null) {
  const normalizedLabels = labels.map(normalizeText);
  const inputs = getFormInputs(form);
  const byLabel = inputs.find((input) =>
    normalizedLabels.includes(normalizeText(input.label)),
  );
  if (byLabel) return byLabel;
  if (fallbackId !== null) {
    return (
      inputs.find((input) => Number(input.field_id) === Number(fallbackId)) ??
      null
    );
  }
  return null;
}

function findButton(form, preferredLabels = ["Avançar", "Concluir"]) {
  const buttons = getFormButtons(form);
  const normalized = preferredLabels.map(normalizeText);
  const button =
    buttons.find((item) => normalized.includes(normalizeText(item.label))) ??
    buttons.find((item) => normalizeText(item.label) !== "voltar");
  if (!button?.button) {
    throw new Error("A Rubeus não retornou o botão de avanço do formulário.");
  }
  return button;
}

function findQueryForField(form, fieldId) {
  return (
    (form?.querys ?? []).find((query) =>
      (query.fields ?? []).some(
        (item) => Number(item.field) === Number(fieldId),
      ),
    ) ?? null
  );
}

function requireInput(input, name) {
  if (!input?.field_id) {
    throw new Error(
      `O campo "${name}" não foi localizado no formulário da Rubeus.`,
    );
  }
  return input;
}

function flowOptions(options = []) {
  return options.map((option) => ({
    id: toStringValue(option.value),
    title: toStringValue(option.label).replace(/-+$/g, "").trim().slice(0, 30),
  }));
}

function extractDataSourceOptions(response) {
  if (Array.isArray(response?.data)) return response.data;
  if (Array.isArray(response?.data?.options)) return response.data.options;
  return [];
}

function currentIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

async function rubeusRequest(
  path,
  { method = "GET", body, timeoutMs = RUBEUS_TIMEOUT_MS } = {},
) {
  if (!process.env.RBS_TOKEN) {
    throw new Error("A variável RBS_TOKEN não foi configurada.");
  }
  const rawToken = process.env.RBS_TOKEN.trim().replace(/^Bearer\s+/i, "");
  if (!rawToken || /\s/.test(rawToken))
    throw new Error("Confira RBS_TOKEN na configuração do serviço.");
  const headers = { Authorization: `Bearer ${rawToken}` };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  const context = flowContext.getStore();
  const remaining = context ? context.deadline - Date.now() - 150 : timeoutMs;
  if (remaining < 300)
    throw new Error("A consulta demorou. Tente novamente em alguns instantes.");
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    Math.min(timeoutMs, remaining),
  );
  const mutation = path === "/start" || path === "/submit";
  if (mutation && context) context.write = { status: "sending", path };
  try {
    const response = await fetch(`${RUBEUS_BASE_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const raw = await response.text();
    let json;
    try {
      json = JSON.parse(raw);
    } catch {
      throw new Error("O Rubeus retornou uma resposta inválida.");
    }
    if (!response.ok || json?.success !== true) {
      const validation =
        mutation &&
        response.ok &&
        Array.isArray(json?.errors) &&
        json.errors.length > 0;
      if (validation && context) context.write = null;
      const error = new Error(
        validation
          ? "Confira os dados preenchidos. O Rubeus retornou erros de validação."
          : "Não foi possível confirmar a operação no Rubeus.",
      );
      error.validation = validation;
      throw error;
    }
    if (mutation && context)
      context.write = { status: "received", path, result: json };
    return json;
  } catch (error) {
    if (error.name === "AbortError")
      throw new Error("O Rubeus não respondeu dentro do prazo desta etapa.");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function listProcesses() {
  const response = await rubeusRequest(
    `/selective-processes?portal=${PORTAL_ID}`,
  );
  const processes = (response.data ?? []).map((process) => ({
    id: String(process.id),
    title: String(process.name).slice(0, 30),
    description: String(process.name),
  }));
  return processes;
}

async function startApplication(processId) {
  return rubeusRequest("/start", {
    method: "POST",
    body: { process: toInteger(processId, "processo_seletivo_id") },
  });
}

async function getForm(target, local, token) {
  return rubeusRequest("/form", {
    method: "POST",
    body: {
      target: toInteger(target, "target"),
      local: toStringValue(local, "step"),
      token: toStringValue(token),
    },
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
      token: toStringValue(token),
    },
  });
}

async function getDataSource({
  datasource,
  target,
  filter = [],
  nextFields = [],
  token,
}) {
  return rubeusRequest("/data-source", {
    method: "POST",
    body: {
      datasource: toStringValue(datasource),
      target: toInteger(target, "target do data-source"),
      filter,
      nextFields: nextFields.map((item) => toInteger(item, "nextFields")),
      token: toStringValue(token),
    },
  });
}

function buildBasicScreenData(formResponse, processId) {
  const form = formResponse?.data?.form;
  const token = formResponse?.token ?? formResponse?.data?.token;
  if (!form || !token) {
    throw new Error("A Rubeus não retornou o formulário de dados básicos.");
  }
  const nome = requireInput(
    findInput(form, ["Nome completo"], 38544),
    "Nome completo",
  );
  const possuiNomeSocial = requireInput(
    findInput(form, ["Possuo nome social"], 38606),
    "Possuo nome social",
  );
  const nomeSocial = requireInput(
    findInput(form, ["Nome social"], 38607),
    "Nome social",
  );
  const email = requireInput(
    findInput(form, ["E-mail", "Email"], 38545),
    "E-mail",
  );
  const nascimento = requireInput(
    findInput(form, ["Data de nascimento"], 38566),
    "Data de nascimento",
  );
  const celular = requireInput(findInput(form, ["Celular"], 38546), "Celular");
  const genero = requireInput(
    findInput(form, ["Gênero", "Genero"], 38564),
    "Gênero",
  );
  const consentimento = requireInput(
    findInput(form, ["Aceite da LGPD"], 38679),
    "Aceite da LGPD",
  );
  const idps = requireInput(findInput(form, ["IDPS"], 38548), "IDPS");
  const lgpdAssinatura = requireInput(
    findInput(form, ["LGPD - Assinatura"], 38707),
    "LGPD - Assinatura",
  );
  const lgpdBaseLegal = requireInput(
    findInput(form, ["LGPD - Base legal"], 38708),
    "LGPD - Base legal",
  );
  const generoRubeus = requireInput(
    findInput(form, ["Gênero Rubeus", "Genero Rubeus"], 38565),
    "Gênero Rubeus",
  );
  const button = findButton(form, ["Avançar"]);
  const notaEnem = isNotaEnemProcess(processId);

  return {
    token: String(token),
    target: String(form.id),
    local: String(form.local),
    button_id: String(button.button),
    campo_nome_id: String(nome.field_id),
    campo_possui_nome_social_id: String(possuiNomeSocial.field_id),
    campo_nome_social_id: String(nomeSocial.field_id),
    campo_email_id: String(email.field_id),
    campo_data_nascimento_id: String(nascimento.field_id),
    campo_celular_id: String(celular.field_id),
    campo_genero_id: String(genero.field_id),
    campo_consentimento_id: String(consentimento.field_id),
    campo_idps_id: String(idps.field_id),
    campo_lgpd_assinatura_id: String(lgpdAssinatura.field_id),
    campo_lgpd_base_legal_id: String(lgpdBaseLegal.field_id),
    campo_genero_rubeus_id: String(generoRubeus.field_id),
    // Fallback IDPS 2027/1; o valor retornado pelo /form tem prioridade.
    idps_valor: toStringValue(
      idps.value,
      isNotaEnemProcess(processId) ? "226" : "223",
    ),
    lgpd_assinatura_valor: toStringValue(lgpdAssinatura.value, "1"),
    lgpd_base_legal_valor: toStringValue(lgpdBaseLegal.value, "4"),
    data_maxima_nascimento: currentIsoDate(),
    titulo_etapa: String(
      formResponse?.data?.stage?.steps?.find(
        (step) => Number(step.id) === Number(form.id),
      )?.name ?? "Dados básicos",
    ),
    processo_seletivo_id: notaEnem
      ? PROCESSO_NOTA_ENEM_ID
      : toStringValue(processId),
    eh_nota_enem: isNotaEnemProcess(processId),
    erro: "",
  };
}

async function buildCourseScreenData(formResponse, processId) {
  const form = formResponse?.data?.form;
  const token = formResponse?.token ?? formResponse?.data?.token;
  if (!form || !token) {
    throw new Error(
      "A Rubeus não retornou o formulário de curso de interesse.",
    );
  }
  const curso = requireInput(findInput(form, ["Curso"], 38627), "Curso");
  const turno = requireInput(findInput(form, ["Turno"], 38547), "Turno");
  const area = requireInput(
    findInput(form, ["IDAREAINTERESSE"], 38553),
    "IDAREAINTERESSE",
  );
  const oferta = requireInput(
    findInput(form, ["CODOFERTA"], 38552),
    "CODOFERTA",
  );
  const coligada = requireInput(
    findInput(form, ["CODCOLIGADA"], 38611),
    "CODCOLIGADA",
  );
  const filial = requireInput(
    findInput(form, ["CODFILIAL"], 38612),
    "CODFILIAL",
  );
  const tipoCurso = requireInput(
    findInput(form, ["CODTIPOCURSO"], 38610),
    "CODTIPOCURSO",
  );
  const button = findButton(form, ["Avançar"]);
  const query = findQueryForField(form, curso.field_id);
  if (!query?.query_data) {
    throw new Error("A fonte de dados de cursos não foi localizada na Rubeus.");
  }
  const notaEnem = getFormInputs(form).some(
    (i) =>
      Number(i.field_id) === 38556 ||
      normalizeText(i.label).includes("inscricao do enem"),
  );
  const polo = notaEnem
    ? requireInput(findInput(form, ["CODPOLO"], 38550), "CODPOLO")
    : findInput(form, ["CODPOLO"], 38550);
  const enemNumero = notaEnem
    ? requireInput(
        findInput(
          form,
          ["Número de inscrição do ENEM", "Numero de inscrição do ENEM"],
          38556,
        ),
        "Número de inscrição do ENEM",
      )
    : null;
  const enemAno = notaEnem
    ? requireInput(
        findInput(
          form,
          ["Ano de realização do ENEM", "Ano de realizacao do ENEM"],
          38557,
        ),
        "Ano de realização do ENEM",
      )
    : null;
  const enemNatureza = notaEnem
    ? requireInput(
        findInput(
          form,
          [
            "Nota de ciências da natureza do ENEM",
            "Nota de ciencias da natureza do ENEM",
          ],
          38563,
        ),
        "Nota de ciências da natureza do ENEM",
      )
    : null;
  const enemHumanas = notaEnem
    ? requireInput(
        findInput(
          form,
          [
            "Nota de ciências humanas do ENEM",
            "Nota de ciencias humanas do ENEM",
          ],
          38562,
        ),
        "Nota de ciências humanas do ENEM",
      )
    : null;
  const enemMatematica = notaEnem
    ? requireInput(
        findInput(
          form,
          ["Nota de matemática do ENEM", "Nota de matematica do ENEM"],
          38561,
        ),
        "Nota de matemática do ENEM",
      )
    : null;
  const enemLinguagens = notaEnem
    ? requireInput(
        findInput(form, ["Nota de linguagens do ENEM"], 38560),
        "Nota de linguagens do ENEM",
      )
    : null;
  const enemRedacao = notaEnem
    ? requireInput(
        findInput(
          form,
          ["Nota da redação do ENEM", "Nota da redacao do ENEM"],
          38559,
        ),
        "Nota da redação do ENEM",
      )
    : null;
  const enemMedia = notaEnem
    ? requireInput(
        findInput(
          form,
          ["Média de notas do ENEM", "Media de notas do ENEM"],
          38558,
        ),
        "Média de notas do ENEM",
      )
    : null;
  const nextFields = (query.fields ?? [])
    .map((item) => Number(item.field))
    .filter((fieldId) => fieldId !== Number(curso.field_id));
  const courseOptionsResponse = await getDataSource({
    datasource: query.query_data,
    target: curso.field_id,
    filter: [],
    nextFields,
    token,
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
    campo_tipo_curso_id: String(tipoCurso.field_id),
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
    campo_enem_numero_id: toStringValue(enemNumero?.field_id),
    campo_enem_ano_id: toStringValue(enemAno?.field_id),
    campo_enem_natureza_id: toStringValue(enemNatureza?.field_id),
    campo_enem_humanas_id: toStringValue(enemHumanas?.field_id),
    campo_enem_matematica_id: toStringValue(enemMatematica?.field_id),
    campo_enem_linguagens_id: toStringValue(enemLinguagens?.field_id),
    campo_enem_redacao_id: toStringValue(enemRedacao?.field_id),
    campo_enem_media_id: toStringValue(enemMedia?.field_id),
    anos_enem: notaEnem
      ? Array.isArray(enemAno?.data) && enemAno.data.length > 0
        ? enemAno.data.map((item) => ({
            id: toStringValue(item.value),
            title: toStringValue(item.display),
          }))
        : ANOS_ENEM
      : [],
    erro: "",
  };
}

async function buildAlmostThereScreenData(
  formResponse,
  previousSubmitResponse,
) {
  const form = formResponse?.data?.form;
  const token = formResponse?.token ?? formResponse?.data?.token;
  if (!form || !token) {
    throw new Error("A Rubeus não retornou o formulário final da inscrição.");
  }
  const cpf = requireInput(findInput(form, ["CPF"], 38567), "CPF");
  const nacionalidade = requireInput(
    findInput(form, ["Nacionalidade"], 38780),
    "Nacionalidade",
  );
  const ensinoMedio = requireInput(
    findInput(form, ["Você já concluiu o ensino médio?"], 251544),
    "Conclusão do ensino médio",
  );
  const deficiencia = requireInput(
    findInput(form, ["Possui alguma deficiência?"], 38575),
    "Possui alguma deficiência?",
  );
  const auditiva = requireInput(
    findInput(form, ["Auditiva"], 38577),
    "Auditiva",
  );
  const fala = requireInput(findInput(form, ["Fala"], 38578), "Fala");
  const fisica = requireInput(
    findInput(form, ["Física", "Fisica"], 38576),
    "Física",
  );
  const intelectual = requireInput(
    findInput(form, ["Intelectual"], 38580),
    "Intelectual",
  );
  const visual = requireInput(findInput(form, ["Visual"], 38579), "Visual");
  const mental = requireInput(findInput(form, ["Mental"], 38581), "Mental");
  const outras = requireInput(
    findInput(form, ["Outras deficiências", "Outras deficiencias"], 38582),
    "Outras deficiências",
  );
  const outrasTexto = requireInput(
    findInput(
      form,
      ["Deficiência motivo outras TOTVS", "Deficiencia motivo outras TOTVS"],
      38583,
    ),
    "Descrição de outra deficiência",
  );
  const origem = requireInput(
    findInput(
      form,
      ["Como você ficou sabendo sobre este processo seletivo?"],
      319427,
    ),
    "Como ficou sabendo",
  );
  const origemOutro = requireInput(
    findInput(form, ["Outro:"], 319428),
    "Outro canal",
  );
  const button = findButton(form, ["Concluir"]);
  const originQuery = findQueryForField(form, origem.field_id);
  let origens = FALLBACK_ORIGINS;
  if (originQuery?.query_data) {
    try {
      const originsResponse = await getDataSource({
        datasource: originQuery.query_data,
        target: origem.field_id,
        filter: [],
        nextFields: [],
        token,
      });
      const dynamicOrigins = flowOptions(
        extractDataSourceOptions(originsResponse),
      );
      if (dynamicOrigins.length > 0) origens = dynamicOrigins;
    } catch (error) {}
  }
  const redirect = previousSubmitResponse?.data?.redirect ?? {};
  return {
    token: String(token),
    target: String(form.id),
    local: String(form.local),
    button_id: String(button.button),
    person_id: toStringValue(redirect.person_id),
    applyment_id: toStringValue(redirect.applyment_id),
    campo_cpf_id: String(cpf.field_id),
    campo_nacionalidade_id: String(nacionalidade.field_id),
    campo_ensino_medio_id: String(ensinoMedio.field_id),
    campo_deficiencia_id: String(deficiencia.field_id),
    campo_def_auditiva_id: String(auditiva.field_id),
    campo_def_fala_id: String(fala.field_id),
    campo_def_fisica_id: String(fisica.field_id),
    campo_def_intelectual_id: String(intelectual.field_id),
    campo_def_visual_id: String(visual.field_id),
    campo_def_mental_id: String(mental.field_id),
    campo_def_outras_id: String(outras.field_id),
    campo_def_outras_texto_id: String(outrasTexto.field_id),
    campo_origem_id: String(origem.field_id),
    campo_origem_outro_id: String(origemOutro.field_id),
    datasource_origem: toStringValue(originQuery?.query_data),
    origens,
    erro: "",
  };
}

function stateKey() {
  return crypto
    .createHash("sha256")
    .update(process.env.FLOW_PRIVATE_KEY.replace(/\\n/g, "\n"))
    .update("unibalsas-flow-state-v1")
    .digest();
}
function sealState(screen, data) {
  const iv = crypto.randomBytes(12),
    cipher = crypto.createCipheriv("aes-256-gcm", stateKey(), iv);
  const value = Buffer.concat([
    cipher.update(JSON.stringify({ screen, exp: Date.now() + 3600000, data })),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), value]).toString("base64url");
}
function openState(value, screen) {
  try {
    const raw = Buffer.from(value ?? "", "base64url"),
      decipher = crypto.createDecipheriv(
        "aes-256-gcm",
        stateKey(),
        raw.subarray(0, 12),
      );
    decipher.setAuthTag(raw.subarray(12, 28));
    const result = JSON.parse(
      Buffer.concat([
        decipher.update(raw.subarray(28)),
        decipher.final(),
      ]).toString("utf8"),
    );
    if (result.exp < Date.now() || result.screen !== screen) throw new Error();
    return result.data;
  } catch {
    throw new Error(
      "Esta etapa expirou ou foi alterada. Reabra a inscrição pelo WhatsApp.",
    );
  }
}
function responseForScreen(screen, data) {
  const entered = flowContext.getStore()?.request?.data ?? {};
  const values = { ...entered, ...data.values };
  const next = { ...data, erro: data.erro ?? "", tem_erro: Boolean(data.erro) };
  if (screen === "PENDENTE") next.titulo ??= "Vamos conferir sua inscrição";
  for (const [name, fallback] of Object.entries(FORM_DEFAULTS[screen] ?? {}))
    next["valor_" + name] = values[name] ?? fallback;
  if (screen === "CURSO_INTERESSE") {
    next.valor_curso_id = data.curso_selecionado ?? values.curso_id ?? "";
    next.valor_turno_id = data.turno_selecionado ?? values.turno_id ?? "";
    next.curso_selecionado ??= next.valor_curso_id;
    next.turno_selecionado ??= next.valor_turno_id;
  }
  if (screen === "ESCOLHA_PROCESSO")
    next.processos_disponiveis = (data.processo_seletivo_id ?? []).map(
      (p) => p.id,
    );
  const trusted = Object.fromEntries(
    Object.entries(next).filter(
      ([key]) =>
        !key.startsWith("valor_") && key !== "estado" && key !== "values",
    ),
  );
  if (
    [
      "ESCOLHA_PROCESSO",
      "DADOS_BASICOS",
      "CURSO_INTERESSE",
      "QUASE_LA",
    ].includes(screen)
  )
    next.estado = sealState(screen, trusted);
  return {
    screen,
    data: Object.fromEntries(
      (SCREEN_KEYS[screen] ?? []).map((key) => [key, next[key]]),
    ),
  };
}
function pendingAfterWrite(data) {
  const write = flowContext.getStore()?.write;
  if (!write) return null;
  const finalStep = data.acao === "enviar_informacoes_complementares";
  return responseForScreen("PENDENTE", {
    titulo: finalStep
      ? "Obrigado por preencher seus dados!"
      : "Vamos conferir sua inscrição",
    mensagem: finalStep
      ? "Aguarde a confirmação da sua inscrição pela UniBalsas. Nossos consultores orientarão você sobre os próximos passos."
      : write.status === "received"
        ? "O Rubeus recebeu o envio, mas não foi possível confirmar a próxima etapa nesta tela. Entre em contato com a UniBalsas para conferir e continuar sua inscrição."
        : "O Rubeus demorou para responder. O envio pode ter sido recebido. Entre em contato com a UniBalsas para conferir sua inscrição antes de tentar novamente.",
    inscricao_id: toStringValue(
      write.result?.data?.redirect?.applyment_id ?? data.applyment_id,
    ),
  });
}
function validateBasic(data) {
  if (
    String(data.nome ?? "")
      .trim()
      .split(/\s+/).length < 2
  )
    throw new Error("Informe nome e sobrenome.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(data.email ?? "").trim()))
    throw new Error("Confira seu e-mail.");
  const date = String(data.data_nascimento ?? "");
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !Number.isFinite(Date.parse(date)) ||
    new Date(date).toISOString().slice(0, 10) !== date ||
    date > currentIsoDate() ||
    date < "1920-01-01"
  )
    throw new Error("Confira sua data de nascimento.");
  if (!["M", "F"].includes(data.genero))
    throw new Error("Selecione seu gênero.");
  const phone = String(data.celular ?? "")
    .replace(/\D/g, "")
    .replace(/^55(?=\d{10,11}$)/, "");
  if (!/^\d{10,11}$/.test(phone)) throw new Error("Informe o celular com DDD.");
  if (!toBoolean(data.aceite_privacidade))
    throw new Error("É necessário aceitar a Política de Privacidade.");
  if (
    toBoolean(data.possui_nome_social) &&
    !String(data.nome_social ?? "").trim()
  )
    throw new Error("Informe seu nome social.");
}
function validateFinal(data) {
  normalizeCpf(data.cpf);
  normalizeNationality(data.nacionalidade);
  if (!["Sim", "Não"].includes(data.concluiu_ensino_medio))
    throw new Error("Informe se concluiu o ensino médio.");
  if (!["T", "F"].includes(data.possui_deficiencia))
    throw new Error("Informe se possui deficiência.");
  if (
    !(data.origens ?? FALLBACK_ORIGINS).some((o) => o.id === data.como_conheceu)
  )
    throw new Error("Selecione como conheceu a instituição.");
  if (
    data.como_conheceu === "10" &&
    !String(data.como_conheceu_outro ?? "").trim()
  )
    throw new Error("Informe o outro canal.");
  if (data.possui_deficiencia === "T") {
    if (
      !Array.isArray(data.tipos_deficiencia) ||
      !data.tipos_deficiencia.length ||
      data.tipos_deficiencia.some(
        (k) =>
          ![
            "auditiva",
            "fala",
            "fisica",
            "intelectual",
            "visual",
            "mental",
            "outras",
          ].includes(k),
      )
    )
      throw new Error("Selecione o tipo de deficiência.");
    if (
      data.tipos_deficiencia.includes("outras") &&
      !String(data.deficiencia_outra ?? "").trim()
    )
      throw new Error("Descreva a outra deficiência.");
  }
}

function basicRetryData(data, message) {
  return {
    token: toStringValue(data.token),
    target: toStringValue(data.target),
    local: toStringValue(data.local, "step"),
    button_id: toStringValue(data.button_id),
    campo_nome_id: toStringValue(data.campo_nome_id),
    campo_possui_nome_social_id: toStringValue(
      data.campo_possui_nome_social_id,
    ),
    campo_nome_social_id: toStringValue(data.campo_nome_social_id),
    campo_email_id: toStringValue(data.campo_email_id),
    campo_data_nascimento_id: toStringValue(data.campo_data_nascimento_id),
    campo_celular_id: toStringValue(data.campo_celular_id),
    campo_genero_id: toStringValue(data.campo_genero_id),
    campo_consentimento_id: toStringValue(data.campo_consentimento_id),
    campo_idps_id: toStringValue(data.campo_idps_id),
    campo_lgpd_assinatura_id: toStringValue(data.campo_lgpd_assinatura_id),
    campo_lgpd_base_legal_id: toStringValue(data.campo_lgpd_base_legal_id),
    campo_genero_rubeus_id: toStringValue(data.campo_genero_rubeus_id),
    // Fallback IDPS atualizado para 2027/1; prioriza valor do formulário.
    idps_valor: toStringValue(
      data.idps_valor,
      isNotaEnemProcess(data.processo_seletivo_id) ? "226" : "223",
    ),
    lgpd_assinatura_valor: toStringValue(data.lgpd_assinatura_valor, "1"),
    lgpd_base_legal_valor: toStringValue(data.lgpd_base_legal_valor, "4"),
    data_maxima_nascimento: currentIsoDate(),
    titulo_etapa: "Dados básicos",
    processo_seletivo_id: toStringValue(data.processo_seletivo_id),
    eh_nota_enem:
      toBoolean(data.eh_nota_enem) ||
      isNotaEnemProcess(data.processo_seletivo_id),
    erro: message,
  };
}

async function courseRetryData(data, message) {
  let courses = [];
  let shifts = [];
  let nextOptions = {};
  const courseId = toStringValue(data.curso_id ?? data.curso_selecionado);
  try {
    const technicalFields = [
      data.campo_area_interesse_id,
      data.campo_oferta_id,
      data.campo_polo_id,
      data.campo_coligada_id,
      data.campo_filial_id,
      data.campo_tipo_curso_id,
    ].filter(Boolean);
    const requests = [
      getDataSource({
        datasource: data.datasource,
        target: data.campo_curso_id,
        filter: [],
        nextFields: [data.campo_turno_id, ...technicalFields].filter(Boolean),
        token: data.token,
      }),
    ];
    if (courseId) {
      requests.push(
        getDataSource({
          datasource: data.datasource,
          target: data.campo_turno_id,
          filter: [
            {
              field: toInteger(data.campo_curso_id, "campo_curso_id"),
              values: courseId,
            },
          ],
          nextFields: technicalFields,
          token: data.token,
        }),
      );
    }
    const [coursesResponse, shiftsResponse] = await Promise.all(requests);
    courses = flowOptions(extractDataSourceOptions(coursesResponse));
    if (shiftsResponse) {
      shifts = flowOptions(extractDataSourceOptions(shiftsResponse));
      nextOptions = shiftsResponse?.data?.nextOptions ?? {};
    }
  } catch (error) {}
  const optionValue = (fieldId, existingValue) =>
    toStringValue(
      nextOptions[toStringValue(fieldId)]?.value,
      toStringValue(existingValue),
    );
  return {
    token: toStringValue(data.token),
    target: toStringValue(data.target),
    local: toStringValue(data.local, "step"),
    button_id: toStringValue(data.button_id),
    datasource: toStringValue(data.datasource),
    campo_curso_id: toStringValue(data.campo_curso_id),
    campo_turno_id: toStringValue(data.campo_turno_id),
    campo_area_interesse_id: toStringValue(data.campo_area_interesse_id),
    campo_oferta_id: toStringValue(data.campo_oferta_id),
    campo_polo_id: toStringValue(data.campo_polo_id),
    campo_coligada_id: toStringValue(data.campo_coligada_id),
    campo_filial_id: toStringValue(data.campo_filial_id),
    campo_tipo_curso_id: toStringValue(data.campo_tipo_curso_id),
    cursos: courses,
    turnos: shifts,
    turno_visivel: shifts.length > 0,
    curso_selecionado: courseId,
    turno_selecionado: toStringValue(
      data.turno_id ?? data.turno_selecionado,
      shifts.length === 1 ? shifts[0].id : "",
    ),
    area_interesse_valor: optionValue(
      data.campo_area_interesse_id,
      data.area_interesse_valor,
    ),
    oferta_valor: optionValue(data.campo_oferta_id, data.oferta_valor),
    // FIX CODPOLO - garante 01 para ENEM
    polo_valor: toStringValue(
      nextOptions[toStringValue(data.campo_polo_id)]?.value,
      isNotaEnemContext(data)
        ? toStringValue(data.polo_valor, "01")
        : toStringValue(data.polo_valor),
    ),
    coligada_valor: optionValue(data.campo_coligada_id, data.coligada_valor),
    filial_valor: optionValue(data.campo_filial_id, data.filial_valor),
    tipo_curso_valor: optionValue(
      data.campo_tipo_curso_id,
      data.tipo_curso_valor,
    ),
    processo_seletivo_id: isNotaEnemContext(data)
      ? PROCESSO_NOTA_ENEM_ID
      : toStringValue(data.processo_seletivo_id),
    eh_nota_enem: isNotaEnemContext(data),
    campo_enem_numero_id: enemFieldId(data.campo_enem_numero_id, 38556),
    campo_enem_ano_id: enemFieldId(data.campo_enem_ano_id, 38557),
    campo_enem_natureza_id: enemFieldId(data.campo_enem_natureza_id, 38563),
    campo_enem_humanas_id: enemFieldId(data.campo_enem_humanas_id, 38562),
    campo_enem_matematica_id: enemFieldId(data.campo_enem_matematica_id, 38561),
    campo_enem_linguagens_id: enemFieldId(data.campo_enem_linguagens_id, 38560),
    campo_enem_redacao_id: enemFieldId(data.campo_enem_redacao_id, 38559),
    campo_enem_media_id: enemFieldId(data.campo_enem_media_id, 38558),
    anos_enem: ANOS_ENEM,
    erro: message,
  };
}

async function shiftRetryData(data, message) {
  let shifts = [];
  let nextOptions = {};
  try {
    const technicalFields = [
      data.campo_area_interesse_id,
      data.campo_oferta_id,
      data.campo_polo_id,
      data.campo_coligada_id,
      data.campo_filial_id,
      data.campo_tipo_curso_id,
    ].filter(Boolean);
    const shiftsResponse = await getDataSource({
      datasource: data.datasource,
      target: data.campo_turno_id,
      filter: [
        {
          field: toInteger(data.campo_curso_id, "campo_curso_id"),
          values: toStringValue(data.curso_id),
        },
      ],
      nextFields: technicalFields,
      token: data.token,
    });
    shifts = flowOptions(extractDataSourceOptions(shiftsResponse));
    nextOptions = shiftsResponse?.data?.nextOptions ?? {};
  } catch (error) {}
  const optionValue = (fieldId, existingValue) =>
    toStringValue(
      nextOptions[toStringValue(fieldId)]?.value,
      toStringValue(existingValue),
    );
  return {
    token: toStringValue(data.token),
    target: toStringValue(data.target),
    local: toStringValue(data.local, "step"),
    button_id: toStringValue(data.button_id),
    datasource: toStringValue(data.datasource),
    campo_curso_id: toStringValue(data.campo_curso_id),
    campo_turno_id: toStringValue(data.campo_turno_id),
    campo_area_interesse_id: toStringValue(data.campo_area_interesse_id),
    campo_oferta_id: toStringValue(data.campo_oferta_id),
    campo_polo_id: toStringValue(data.campo_polo_id),
    campo_coligada_id: toStringValue(data.campo_coligada_id),
    campo_filial_id: toStringValue(data.campo_filial_id),
    campo_tipo_curso_id: toStringValue(data.campo_tipo_curso_id),
    curso_id: toStringValue(data.curso_id),
    curso_nome: toStringValue(data.curso_nome, "Curso selecionado"),
    turnos: shifts,
    area_interesse_valor: optionValue(
      data.campo_area_interesse_id,
      data.area_interesse_valor,
    ),
    oferta_valor: optionValue(data.campo_oferta_id, data.oferta_valor),
    polo_valor: toStringValue(
      nextOptions[toStringValue(data.campo_polo_id)]?.value,
      isNotaEnemContext(data)
        ? toStringValue(data.polo_valor, "01")
        : toStringValue(data.polo_valor),
    ),
    coligada_valor: optionValue(data.campo_coligada_id, data.coligada_valor),
    filial_valor: optionValue(data.campo_filial_id, data.filial_valor),
    tipo_curso_valor: optionValue(
      data.campo_tipo_curso_id,
      data.tipo_curso_valor,
    ),
    processo_seletivo_id: isNotaEnemContext(data)
      ? PROCESSO_NOTA_ENEM_ID
      : toStringValue(data.processo_seletivo_id),
    eh_nota_enem: isNotaEnemContext(data),
    campo_enem_numero_id: enemFieldId(data.campo_enem_numero_id, 38556),
    campo_enem_ano_id: enemFieldId(data.campo_enem_ano_id, 38557),
    campo_enem_natureza_id: enemFieldId(data.campo_enem_natureza_id, 38563),
    campo_enem_humanas_id: enemFieldId(data.campo_enem_humanas_id, 38562),
    campo_enem_matematica_id: enemFieldId(data.campo_enem_matematica_id, 38561),
    campo_enem_linguagens_id: enemFieldId(data.campo_enem_linguagens_id, 38560),
    campo_enem_redacao_id: enemFieldId(data.campo_enem_redacao_id, 38559),
    campo_enem_media_id: enemFieldId(data.campo_enem_media_id, 38558),
    anos_enem: ANOS_ENEM,
    erro: message,
  };
}

function fastAlmostThereRetryData(data, message) {
  return {
    token: toStringValue(data.token),
    target: toStringValue(data.target),
    local: toStringValue(data.local, "step"),
    button_id: toStringValue(data.button_id),
    person_id: toStringValue(data.person_id),
    applyment_id: toStringValue(data.applyment_id),
    campo_cpf_id: toStringValue(data.campo_cpf_id),
    campo_nacionalidade_id: toStringValue(data.campo_nacionalidade_id),
    campo_ensino_medio_id: toStringValue(data.campo_ensino_medio_id),
    campo_deficiencia_id: toStringValue(data.campo_deficiencia_id),
    campo_def_auditiva_id: toStringValue(data.campo_def_auditiva_id),
    campo_def_fala_id: toStringValue(data.campo_def_fala_id),
    campo_def_fisica_id: toStringValue(data.campo_def_fisica_id),
    campo_def_intelectual_id: toStringValue(data.campo_def_intelectual_id),
    campo_def_visual_id: toStringValue(data.campo_def_visual_id),
    campo_def_mental_id: toStringValue(data.campo_def_mental_id),
    campo_def_outras_id: toStringValue(data.campo_def_outras_id),
    campo_def_outras_texto_id: toStringValue(data.campo_def_outras_texto_id),
    campo_origem_id: toStringValue(data.campo_origem_id),
    campo_origem_outro_id: toStringValue(data.campo_origem_outro_id),
    datasource_origem: toStringValue(data.datasource_origem),
    origens: FALLBACK_ORIGINS,
    erro:
      message ||
      "Não foi possível concluir a inscrição. Revise os dados e tente novamente.",
  };
}

async function almostThereRetryData(data, message) {
  let origens = FALLBACK_ORIGINS;
  if (data.datasource_origem) {
    try {
      const originsResponse = await getDataSource({
        datasource: data.datasource_origem,
        target: data.campo_origem_id,
        filter: [],
        nextFields: [],
        token: data.token,
      });
      const dynamicOrigins = flowOptions(
        extractDataSourceOptions(originsResponse),
      );
      if (dynamicOrigins.length > 0) origens = dynamicOrigins;
    } catch (error) {}
  }
  return {
    token: toStringValue(data.token),
    target: toStringValue(data.target),
    local: toStringValue(data.local, "step"),
    button_id: toStringValue(data.button_id),
    person_id: toStringValue(data.person_id),
    applyment_id: toStringValue(data.applyment_id),
    campo_cpf_id: toStringValue(data.campo_cpf_id),
    campo_nacionalidade_id: toStringValue(data.campo_nacionalidade_id),
    campo_ensino_medio_id: toStringValue(data.campo_ensino_medio_id),
    campo_deficiencia_id: toStringValue(data.campo_deficiencia_id),
    campo_def_auditiva_id: toStringValue(data.campo_def_auditiva_id),
    campo_def_fala_id: toStringValue(data.campo_def_fala_id),
    campo_def_fisica_id: toStringValue(data.campo_def_fisica_id),
    campo_def_intelectual_id: toStringValue(data.campo_def_intelectual_id),
    campo_def_visual_id: toStringValue(data.campo_def_visual_id),
    campo_def_mental_id: toStringValue(data.campo_def_mental_id),
    campo_def_outras_id: toStringValue(data.campo_def_outras_id),
    campo_def_outras_texto_id: toStringValue(data.campo_def_outras_texto_id),
    campo_origem_id: toStringValue(data.campo_origem_id),
    campo_origem_outro_id: toStringValue(data.campo_origem_outro_id),
    datasource_origem: toStringValue(data.datasource_origem),
    origens,
    erro: message,
  };
}

async function routeFlowRequest(requestData) {
  const action = requestData?.action;
  let data = requestData?.data ?? {};
  const customAction = data?.acao;
  if (
    action === "data_exchange" &&
    !data.error &&
    customAction !== "recarregar_processos"
  ) {
    if (
      [
        "selecionar_processo",
        "enviar_dados_basicos",
        "buscar_turnos",
        "enviar_curso",
        "enviar_informacoes_complementares",
      ].includes(customAction)
    ) {
      const trusted = openState(data.estado, requestData.screen);
      const user = Object.fromEntries(
        Object.entries(data).filter(([key]) => USER_FIELDS.has(key)),
      );
      data = { ...trusted, ...user, acao: customAction };
      // Selection is a user value here; on later screens process comes from sealed state.
      if (customAction !== "selecionar_processo")
        data.processo_seletivo_id = trusted.processo_seletivo_id;
      requestData.data = data;
    }
  }

  if (action === "ping") {
    return { data: { status: "active" } };
  }

  if (
    action === "INIT" ||
    (action === "data_exchange" && customAction === "recarregar_processos")
  ) {
    try {
      const processes = await listProcesses();
      return responseForScreen("ESCOLHA_PROCESSO", {
        processo_seletivo_id: processes,
        tem_processos: processes.length > 0,
        mensagem_vazio:
          "Não há nenhum processo seletivo disponível para inscrição no momento.",
        erro: "",
      });
    } catch (error) {
      return responseForScreen("ESCOLHA_PROCESSO", {
        processo_seletivo_id: [],
        tem_processos: false,
        mensagem_vazio:
          "Não conseguimos consultar os processos agora. Toque em Atualizar opções.",
        erro: "Consulta indisponível no momento.",
      });
    }
  }

  if (action === "BACK") {
    return responseForScreen("PENDENTE", {
      mensagem:
        "Para preservar sua inscrição, continue pela última etapa aberta. Se precisar alterar dados já enviados, entre em contato com a UniBalsas.",
      inscricao_id: toStringValue(data.applyment_id),
    });
  }

  if (data.error) return { data: { acknowledged: true } };

  if (action !== "data_exchange") {
    return { data: { status: "active" } };
  }

  switch (customAction) {
    case "encerrar_sem_processos": {
      return responseForScreen("SEM_PROCESSOS", {
        mensagem:
          "Não há nenhum processo seletivo disponível para inscrição no momento.",
      });
    }

    case "selecionar_processo": {
      try {
        const rawProcessId =
          data.processo_seletivo_id ??
          data.processo_id ??
          data.form?.processo_id ??
          data.form?.processo_seletivo_id;
        if (!rawProcessId || String(rawProcessId).trim() === "") {
          throw new Error("Selecione um processo seletivo antes de continuar.");
        }
        if (!(data.processos_disponiveis ?? []).includes(String(rawProcessId)))
          throw new Error("Selecione um processo disponível.");
        const startResponse = await startApplication(rawProcessId);
        const formResponse = await getForm(
          startResponse.data.next,
          startResponse.data.local,
          startResponse.token,
        );
        return responseForScreen(
          "DADOS_BASICOS",
          buildBasicScreenData(formResponse, rawProcessId),
        );
      } catch (error) {
        const pending = pendingAfterWrite(data);
        if (pending) return pending;
        let processes = [];
        try {
          processes = await listProcesses();
        } catch {}
        return responseForScreen("ESCOLHA_PROCESSO", {
          processo_seletivo_id: processes,
          tem_processos: processes.length > 0,
          mensagem_vazio:
            "Não há nenhum processo seletivo disponível para inscrição no momento.",
          erro: error.message,
        });
      }
    }

    case "enviar_dados_basicos": {
      try {
        validateBasic(data);
        const possuiNomeSocial = toBoolean(data.possui_nome_social);
        const genero = toStringValue(data.genero);
        const fields = compactFields([
          fieldItem(data.campo_nome_id, toStringValue(data.nome).trim()),
          fieldItem(data.campo_possui_nome_social_id, possuiNomeSocial),
          ...(possuiNomeSocial
            ? [
                fieldItem(
                  data.campo_nome_social_id,
                  toStringValue(data.nome_social).trim(),
                ),
              ]
            : []),
          fieldItem(data.campo_email_id, toStringValue(data.email).trim()),
          fieldItem(
            data.campo_data_nascimento_id,
            toStringValue(data.data_nascimento),
          ),
          fieldItem(data.campo_celular_id, formatBrazilianPhone(data.celular)),
          fieldItem(data.campo_genero_id, genero),
          fieldItem(
            data.campo_consentimento_id,
            toBoolean(data.aceite_privacidade),
          ),
          fieldItem(
            data.campo_idps_id,
            toStringValue(
              data.idps_valor,
              isNotaEnemProcess(data.processo_seletivo_id) ? "226" : "223",
            ),
          ),
          fieldItem(
            data.campo_lgpd_assinatura_id,
            toStringValue(data.lgpd_assinatura_valor, "1"),
          ),
          fieldItem(
            data.campo_lgpd_base_legal_id,
            toStringValue(data.lgpd_base_legal_valor, "4"),
          ),
          fieldItem(data.campo_genero_rubeus_id, genero === "M" ? "1" : "2"),
        ]);
        const submitResponse = await submitForm(
          data.button_id,
          fields,
          data.token,
        );
        const nextFormResponse = await getForm(
          submitResponse.data.next,
          submitResponse.data.local,
          submitResponse.data.token ?? data.token,
        );
        return responseForScreen(
          "CURSO_INTERESSE",
          await buildCourseScreenData(
            nextFormResponse,
            data.processo_seletivo_id,
          ),
        );
      } catch (error) {
        const pending = pendingAfterWrite(data);
        if (pending) return pending;
        return responseForScreen(
          "DADOS_BASICOS",
          basicRetryData(data, error.message),
        );
      }
    }

    case "buscar_turnos": {
      try {
        const technicalFields = [
          data.campo_area_interesse_id,
          data.campo_oferta_id,
          data.campo_polo_id,
          data.campo_coligada_id,
          data.campo_filial_id,
          data.campo_tipo_curso_id,
        ].filter(Boolean);
        const [coursesResponse, shiftsResponse] = await Promise.all([
          getDataSource({
            datasource: data.datasource,
            target: data.campo_curso_id,
            filter: [],
            nextFields: [data.campo_turno_id, ...technicalFields],
            token: data.token,
          }),
          getDataSource({
            datasource: data.datasource,
            target: data.campo_turno_id,
            filter: [
              {
                field: toInteger(data.campo_curso_id, "campo_curso_id"),
                values: toStringValue(data.curso_id),
              },
            ],
            nextFields: technicalFields,
            token: data.token,
          }),
        ]);
        const courseOptions = flowOptions(
          extractDataSourceOptions(coursesResponse),
        );
        const shifts = flowOptions(extractDataSourceOptions(shiftsResponse));
        const nextOptions = shiftsResponse?.data?.nextOptions ?? {};
        const selectedCourseId = toStringValue(data.curso_id);
        if (shifts.length === 0) {
          throw new Error(
            "Nenhum turno foi encontrado para o curso selecionado.",
          );
        }
        return responseForScreen("CURSO_INTERESSE", {
          token: toStringValue(data.token),
          target: toStringValue(data.target),
          local: toStringValue(data.local, "step"),
          button_id: toStringValue(data.button_id),
          datasource: toStringValue(data.datasource),
          campo_curso_id: toStringValue(data.campo_curso_id),
          campo_turno_id: toStringValue(data.campo_turno_id),
          campo_area_interesse_id: toStringValue(data.campo_area_interesse_id),
          campo_oferta_id: toStringValue(data.campo_oferta_id),
          campo_polo_id: toStringValue(data.campo_polo_id),
          campo_coligada_id: toStringValue(data.campo_coligada_id),
          campo_filial_id: toStringValue(data.campo_filial_id),
          campo_tipo_curso_id: toStringValue(data.campo_tipo_curso_id),
          cursos: courseOptions,
          turnos: shifts,
          turno_visivel: true,
          curso_selecionado: selectedCourseId,
          turno_selecionado: shifts.length === 1 ? shifts[0].id : "",
          area_interesse_valor: toStringValue(
            nextOptions[toStringValue(data.campo_area_interesse_id)]?.value,
          ),
          oferta_valor: toStringValue(
            nextOptions[toStringValue(data.campo_oferta_id)]?.value,
          ),
          polo_valor: toStringValue(
            nextOptions[toStringValue(data.campo_polo_id)]?.value,
            isNotaEnemContext(data) ? "01" : "",
          ),
          coligada_valor: toStringValue(
            nextOptions[toStringValue(data.campo_coligada_id)]?.value,
          ),
          filial_valor: toStringValue(
            nextOptions[toStringValue(data.campo_filial_id)]?.value,
          ),
          tipo_curso_valor: toStringValue(
            nextOptions[toStringValue(data.campo_tipo_curso_id)]?.value,
          ),
          processo_seletivo_id: isNotaEnemContext(data)
            ? PROCESSO_NOTA_ENEM_ID
            : toStringValue(data.processo_seletivo_id),
          eh_nota_enem: isNotaEnemContext(data),
          campo_enem_numero_id: enemFieldId(data.campo_enem_numero_id, 38556),
          campo_enem_ano_id: enemFieldId(data.campo_enem_ano_id, 38557),
          campo_enem_natureza_id: enemFieldId(
            data.campo_enem_natureza_id,
            38563,
          ),
          campo_enem_humanas_id: enemFieldId(data.campo_enem_humanas_id, 38562),
          campo_enem_matematica_id: enemFieldId(
            data.campo_enem_matematica_id,
            38561,
          ),
          campo_enem_linguagens_id: enemFieldId(
            data.campo_enem_linguagens_id,
            38560,
          ),
          campo_enem_redacao_id: enemFieldId(data.campo_enem_redacao_id, 38559),
          campo_enem_media_id: enemFieldId(data.campo_enem_media_id, 38558),
          anos_enem: ANOS_ENEM,
          erro: "",
        });
      } catch (error) {
        return responseForScreen(
          "CURSO_INTERESSE",
          await courseRetryData(data, error.message),
        );
      }
    }

    case "enviar_curso": {
      try {
        if (
          !data.curso_id ||
          data.curso_id !== data.curso_selecionado ||
          !(data.turnos ?? []).some((t) => t.id === data.turno_id)
        )
          throw new Error("Busque novamente o turno do curso escolhido.");
        const notaEnem = isNotaEnemContext(data);

        const campoPoloId = notaEnem
          ? toStringValue(data.campo_polo_id, "38550")
          : toStringValue(data.campo_polo_id);
        const poloValor = notaEnem
          ? toStringValue(data.polo_valor, "01")
          : toStringValue(data.polo_valor);
        const mediaCalculada = calcMediaEnemAuto(data);
        const mediaFinal =
          mediaCalculada ??
          (data.media_enem
            ? Number(String(data.media_enem).replace(",", "."))
            : null);

        const fields = compactFields([
          fieldItem(data.campo_curso_id, toStringValue(data.curso_id)),
          fieldItem(data.campo_turno_id, toStringValue(data.turno_id)),
          ...(notaEnem
            ? [
                fieldItem(
                  enemFieldId(data.campo_enem_numero_id, 38556),
                  normalizeEnemRegistration(data.numero_inscricao_enem),
                ),
                fieldItem(
                  enemFieldId(data.campo_enem_ano_id, 38557),
                  toStringValue(data.ano_enem),
                ),
                fieldItem(
                  enemFieldId(data.campo_enem_natureza_id, 38563),
                  normalizeEnemScore(
                    data.nota_natureza_enem,
                    "Nota de ciências da natureza",
                  ),
                ),
                fieldItem(
                  enemFieldId(data.campo_enem_humanas_id, 38562),
                  normalizeEnemScore(
                    data.nota_humanas_enem,
                    "Nota de ciências humanas",
                  ),
                ),
                fieldItem(
                  enemFieldId(data.campo_enem_matematica_id, 38561),
                  normalizeEnemScore(
                    data.nota_matematica_enem,
                    "Nota de matemática",
                  ),
                ),
                fieldItem(
                  enemFieldId(data.campo_enem_linguagens_id, 38560),
                  normalizeEnemScore(
                    data.nota_linguagens_enem,
                    "Nota de linguagens",
                  ),
                ),
                fieldItem(
                  enemFieldId(data.campo_enem_redacao_id, 38559),
                  normalizeEnemScore(data.nota_redacao_enem, "Nota da redação"),
                ),
                fieldItem(
                  enemFieldId(data.campo_enem_media_id, 38558),
                  mediaFinal !== null
                    ? mediaFinal
                    : normalizeEnemScore(
                        data.media_enem,
                        "Média das notas do ENEM",
                      ),
                ),
              ]
            : []),
          fieldItem(
            data.campo_area_interesse_id,
            toStringValue(data.area_interesse_valor),
          ),
          fieldItem(data.campo_oferta_id, toStringValue(data.oferta_valor)),
          fieldItem(campoPoloId, poloValor),
          fieldItem(data.campo_coligada_id, toStringValue(data.coligada_valor)),
          fieldItem(data.campo_filial_id, toStringValue(data.filial_valor)),
          fieldItem(
            data.campo_tipo_curso_id,
            toStringValue(data.tipo_curso_valor),
          ),
        ]);

        const submitResponse = await submitForm(
          data.button_id,
          fields,
          data.token,
        );
        const nextToken = submitResponse.data.token ?? data.token;
        const nextFormResponse = await getForm(
          submitResponse.data.next,
          submitResponse.data.local,
          nextToken,
        );
        return responseForScreen(
          "QUASE_LA",
          await buildAlmostThereScreenData(nextFormResponse, submitResponse),
        );
      } catch (error) {
        const pending = pendingAfterWrite(data);
        if (pending) return pending;
        return responseForScreen(
          "CURSO_INTERESSE",
          await courseRetryData(data, error.message),
        );
      }
    }

    case "enviar_informacoes_complementares": {
      try {
        validateFinal(data);
        const hasDisability = toStringValue(data.possui_deficiencia) === "T";
        const selectedTypes = Array.isArray(data.tipos_deficiencia)
          ? data.tipos_deficiencia.map(String)
          : [];
        const selected = (type) =>
          hasDisability && selectedTypes.includes(type);
        const selectedOther = selected("outras");
        const fields = compactFields([
          fieldItem(data.campo_cpf_id, normalizeCpf(data.cpf)),
          fieldItem(
            data.campo_nacionalidade_id,
            normalizeNationality(data.nacionalidade),
          ),
          fieldItem(
            data.campo_ensino_medio_id,
            toStringValue(data.concluiu_ensino_medio),
          ),
          fieldItem(data.campo_deficiencia_id, hasDisability ? "T" : "F"),
          ...(hasDisability
            ? [fieldItem(data.campo_def_auditiva_id, selected("auditiva"))]
            : []),
          ...(hasDisability
            ? [fieldItem(data.campo_def_fala_id, selected("fala"))]
            : []),
          ...(hasDisability
            ? [fieldItem(data.campo_def_fisica_id, selected("fisica"))]
            : []),
          ...(hasDisability
            ? [
                fieldItem(
                  data.campo_def_intelectual_id,
                  selected("intelectual"),
                ),
              ]
            : []),
          ...(hasDisability
            ? [fieldItem(data.campo_def_visual_id, selected("visual"))]
            : []),
          ...(hasDisability
            ? [fieldItem(data.campo_def_mental_id, selected("mental"))]
            : []),
          ...(hasDisability
            ? [fieldItem(data.campo_def_outras_id, selectedOther)]
            : []),
          ...(selectedOther
            ? [
                fieldItem(
                  data.campo_def_outras_texto_id,
                  toStringValue(data.deficiencia_outra).trim(),
                ),
              ]
            : []),
          fieldItem(data.campo_origem_id, toStringValue(data.como_conheceu)),
          ...(toStringValue(data.como_conheceu) === "10"
            ? [
                fieldItem(
                  data.campo_origem_outro_id,
                  toStringValue(data.como_conheceu_outro).trim(),
                ),
              ]
            : []),
        ]);
        const submitResponse = await submitForm(
          data.button_id,
          fields,
          data.token,
          RUBEUS_FINAL_SUBMIT_TIMEOUT_MS,
        );
        const redirect = submitResponse?.data?.redirect ?? {};
        if (
          submitResponse.data?.local !== "external_link" ||
          !redirect.applyment_id ||
          (data.applyment_id &&
            String(redirect.applyment_id) !== String(data.applyment_id))
        )
          throw new Error(
            "O Rubeus ainda não confirmou o término desta inscrição.",
          );
        const applicationId = String(redirect.applyment_id);
        return responseForScreen("CONFIRMACAO", {
          titulo: "Obrigado pelo seu cadastro!",
          mensagem: "Nossos consultores entrarão em contato com você em breve.",
          inscricao_id: applicationId,
        });
      } catch (error) {
        const pending = pendingAfterWrite(data);
        if (pending) return pending;
        return responseForScreen(
          "QUASE_LA",
          fastAlmostThereRetryData(data, error.message),
        );
      }
    }

    default:
      return { data: { status: "active" } };
  }
}

function decryptRequest(body, privateKey) {
  const { encrypted_flow_data, encrypted_aes_key, initial_vector } = body ?? {};
  if (!encrypted_flow_data || !encrypted_aes_key || !initial_vector) {
    throw new Error("Payload criptografado do WhatsApp Flow incompleto.");
  }
  const aesKey = crypto.privateDecrypt(
    {
      key: privateKey,
      passphrase: process.env.FLOW_PASSPHRASE || undefined,
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: "sha256",
    },
    Buffer.from(encrypted_aes_key, "base64"),
  );
  const iv = Buffer.from(initial_vector, "base64");
  const encryptedData = Buffer.from(encrypted_flow_data, "base64");
  const authTag = encryptedData.subarray(-16);
  const data = encryptedData.subarray(0, -16);
  const decipher = crypto.createDecipheriv("aes-128-gcm", aesKey, iv);
  decipher.setAuthTag(authTag);
  const decrypted =
    decipher.update(data, undefined, "utf8") + decipher.final("utf8");
  return { requestData: JSON.parse(decrypted), aesKey, iv };
}

function encryptResponse(responsePayload, aesKey, iv) {
  const flippedIv = Buffer.from(iv.map((byte) => byte ^ 0xff));
  const cipher = crypto.createCipheriv("aes-128-gcm", aesKey, flippedIv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(responsePayload), "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([encrypted, cipher.getAuthTag()]).toString("base64");
}

export default async function handler(req, res) {
  if (req.method === "GET") {
    return res.status(200).json({ status: "ok", version: "ajuste-direto-v1" });
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
    if (!raw)
      return res
        .status(503)
        .send(
          "O servidor precisa preservar req.rawBody para validar a assinatura.",
        );
    const signature = req.headers?.["x-hub-signature-256"];
    if (!/^sha256=[a-f0-9]{64}$/i.test(signature ?? ""))
      return res.status(432).send("Assinatura inválida.");
    const expected = crypto
      .createHmac("sha256", appSecret)
      .update(raw)
      .digest();
    const received = Buffer.from(signature.slice(7), "hex");
    if (!crypto.timingSafeEqual(expected, received))
      return res.status(432).send("Assinatura inválida.");
  }
  let aesKey;
  let iv;
  let requestData;
  try {
    requirePrivateKey();
    const privateKey = process.env.FLOW_PRIVATE_KEY.replace(/\\n/g, "\n");
    const decrypted = decryptRequest(req.body, privateKey);
    requestData = decrypted.requestData;
    aesKey = decrypted.aesKey;
    iv = decrypted.iv;

    const responsePayload = await flowContext.run(
      {
        deadline: Date.now() + FLOW_RESPONSE_BUDGET_MS,
        request: requestData,
        write: null,
      },
      () => routeFlowRequest(requestData),
    );
    const encryptedResponse = encryptResponse(responsePayload, aesKey, iv);
    res.setHeader("Content-Type", "text/plain");
    return res.status(200).send(encryptedResponse);
  } catch (error) {
    if (aesKey && iv) {
      const data = requestData?.data ?? {};
      const screen = requestData?.screen;
      let responsePayload;
      responsePayload = responseForScreen("PENDENTE", {
        mensagem:
          "Não foi possível abrir esta etapa com segurança. Entre em contato com a UniBalsas para continuar sua inscrição.",
        inscricao_id: "",
      });
      const encryptedResponse = encryptResponse(responsePayload, aesKey, iv);
      res.setHeader("Content-Type", "text/plain");
      return res.status(200).send(encryptedResponse);
    }
    return res
      .status(421)
      .send("Não foi possível descriptografar a requisição do Flow.");
  }
}
