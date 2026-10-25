import crypto from 'crypto';

const RUBEUS_BASE_URL = 'https://admin.portal.apprbs.com.br/api/v1';
const PORTAL_ID = 257;
const RUBEUS_TIMEOUT_MS = 6000;
const RUBEUS_FINAL_SUBMIT_TIMEOUT_MS = 9200;

const NACIONALIDADES_ESTATICAS = [
  { id: '10', title: 'Brasileira' },
  { id: '20', title: 'Naturalizado Brasileiro' },
  { id: '30', title: 'Estrangeira' },
  { id: '50', title: 'Outros' }
];

const FALLBACK_ORIGINS = [
  { id: '01', title: 'Site oficial da instituição' },
  { id: '02', title: 'Pesquisa no próprio Google' },
  { id: '03', title: 'Redes sociais' },
  { id: '04', title: 'Anúncios patrocinados' },
  { id: '05', title: 'Indicação de amigos ou familiares' },
  { id: '06', title: 'Divulgação na escola ou empresa' },
  { id: '07', title: 'Feiras, palestras ou eventos' },
  { id: '08', title: 'Contato do time comercial' },
  { id: '09', title: 'Materiais impressos' },
  { id: '10', title: 'Outro' }
];

const PROCESSO_NOTA_ENEM_ID = '18714';
const ANOS_ENEM = ['2025','2024','2023','2022','2021','2020','2019','2018','2017','2016','2015','2014','2013','2012','2011','2010'].map((ano) => ({ id: ano, title: ano }));

function isNotaEnemProcess(processId) { return toStringValue(processId) === PROCESSO_NOTA_ENEM_ID; }
function isNotaEnemContext(data = {}) { return isNotaEnemProcess(data.processo_seletivo_id) || toBoolean(data.eh_nota_enem); }
function enemFieldId(value, fallback) { return toStringValue(value, String(fallback)); }
function normalizeEnemRegistration(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (digits.length < 12 || digits.length > 15) throw new Error('O número de inscrição do ENEM deve conter de 12 a 15 números.');
  return digits;
}
function normalizeEnemScore(value, fieldName) {
  const normalized = String(value ?? '').trim().replace(',', '.');
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) throw new Error(`${fieldName} deve conter somente números.`);
  const score = Number(normalized);
  if (!Number.isFinite(score) || score < 0 || score > 1000) throw new Error(`${fieldName} deve estar entre 0 e 1000.`);
  return normalized;
}
function calculateEnemAverage(scores) {
  const numericScores = scores.map((score) => Number(score));
  const total = numericScores.reduce((sum, score) => sum + score, 0);
  return String(Math.round(((total / 5) + Number.EPSILON) * 100) / 100);
}
function requirePrivateKey() { if (!process.env.FLOW_PRIVATE_KEY) throw new Error('FLOW_PRIVATE_KEY não configurada.'); }
function normalizeText(value = '') { return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase(); }
function toBoolean(value) { return value === true || value === 'true' || value === 1 || value === '1'; }
function toStringValue(value, fallback = '') { if (value === null || value === undefined) return fallback; return String(value); }
function normalizeNationality(value) {
  const id = toStringValue(value, '10');
  if (!NACIONALIDADES_ESTATICAS.some((item) => item.id === id)) throw new Error('Nacionalidade inválida.');
  return id;
}
function toInteger(value, fieldName) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isInteger(parsed)) throw new Error(`Valor inválido para ${fieldName}.`);
  return parsed;
}
function normalizeCpf(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (digits.length !== 11) throw new Error('O CPF deve conter exatamente 11 números.');
  return digits;
}
function formatBrazilianPhone(value) {
  let digits = String(value ?? '').replace(/\D/g, '');
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith('55')) digits = digits.slice(2);
  if (digits.length === 11) return digits.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3');
  if (digits.length === 10) return digits.replace(/(\d{2})(\d{4})(\d{4})/, '($1) $2-$3');
  return String(value ?? '');
}
function fieldItem(fieldId, value) { if (fieldId === '' || fieldId === null || fieldId === undefined) return null; return { field_id: toInteger(fieldId, 'field_id'), value }; }
function compactFields(fields) { return fields.filter(Boolean); }
function getFormInputs(form) { return form?.content?.inputs ?? []; }
function getFormButtons(form) { return form?.content?.buttons ?? []; }
function findInput(form, labels = [], fallbackId = null) {
  const nLabels = labels.map(normalizeText);
  const inputs = getFormInputs(form);
  const byLabel = inputs.find((input) => nLabels.includes(normalizeText(input.label)));
  if (byLabel) return byLabel;
  if (fallbackId !== null) return inputs.find((input) => Number(input.field_id) === Number(fallbackId)) ?? null;
  return null;
}
function findButton(form, labels = ['Avançar', 'Concluir']) {
  const buttons = getFormButtons(form);
  const nLabels = labels.map(normalizeText);
  const button = buttons.find((item) => nLabels.includes(normalizeText(item.label))) ?? buttons.find((item) => normalizeText(item.label) !== 'voltar');
  if (!button?.button) throw new Error('A Rubeus não retornou o botão de avanço.');
  return button;
}
function findQueryForField(form, fieldId) { return (form?.querys ?? []).find((q) => (q.fields ?? []).some((item) => Number(item.field) === Number(fieldId))) ?? null; }
function requireInput(input, name) { if (!input?.field_id) throw new Error(`O campo "${name}" não foi localizado na Rubeus.`); return input; }
function flowOptions(options = []) { return options.map((option) => ({ id: toStringValue(option.value), title: toStringValue(option.label).replace(/-+$/g, '').trim() })); }
function extractDataSourceOptions(response) { if (Array.isArray(response?.data)) return response.data; if (Array.isArray(response?.data?.options)) return response.data.options; return []; }
function currentIsoDate() { return new Date().toISOString().slice(0, 10); }

async function rubeusRequest(path, { method = 'GET', body, timeoutMs = RUBEUS_TIMEOUT_MS } = {}) {
  if (!process.env.RBS_TOKEN) throw new Error('RBS_TOKEN não configurado.');
  let rawToken = String(process.env.RBS_TOKEN || '').trim().replace(/^Bearer\s+/i, '').replace(/[\r\n\s'"]+/g, '');
  if (rawToken.length > 128 && /^[a-f0-9]+$/i.test(rawToken)) rawToken = rawToken.slice(0, 64);
  const headers = { Authorization: `Bearer ${rawToken}` };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${RUBEUS_BASE_URL}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal });
    const raw = await response.text(); let json; try { json = raw ? JSON.parse(raw) : {}; } catch { json = { message: raw }; }
    if (!response.ok || json?.success === false) throw new Error(json?.message || `Rubeus status ${response.status}`);
    return json;
  } finally { clearTimeout(timeout); }
}
async function listProcesses() { const r = await rubeusRequest(`/selective-processes?portal=${PORTAL_ID}`); return (r.data ?? []).map((p) => ({ id: String(p.id), title: String(p.name) })); }
async function startApplication(processId) { return rubeusRequest('/start', { method: 'POST', body: { process: toInteger(processId, 'processo_seletivo_id') } }); }
async function getForm(target, local, token) { return rubeusRequest('/form', { method: 'POST', body: { target: toInteger(target, 'target'), local: toStringValue(local, 'step'), token: toStringValue(token) } }); }
async function submitForm(button, data, token, timeoutMs = RUBEUS_TIMEOUT_MS) { return rubeusRequest('/submit', { method: 'POST', timeoutMs, body: { button: toInteger(button, 'button_id'), validate_on_server: true, data, token: toStringValue(token) } }); }
async function getDataSource({ datasource, target, filter = [], nextFields = [], token }) { return rubeusRequest('/data-source', { method: 'POST', body: { datasource: toStringValue(datasource), target: toInteger(target, 'target do data-source'), filter, nextFields: nextFields.map((item) => toInteger(item, 'nextFields')), token: toStringValue(token) } }); }

function buildBasicScreenData(formResponse, processId) {
  const form = formResponse?.data?.form; const token = formResponse?.token;
  const nome = requireInput(findInput(form, ['Nome completo'], 38544), 'Nome completo');
  const possuiNomeSocial = requireInput(findInput(form, ['Possuo nome social'], 38606), 'Possuo nome social');
  const nomeSocial = requireInput(findInput(form, ['Nome social'], 38607), 'Nome social');
  const email = requireInput(findInput(form, ['E-mail', 'Email'], 38545), 'E-mail');
  const nascimento = requireInput(findInput(form, ['Data de nascimento'], 38566), 'Data de nascimento');
  const celular = requireInput(findInput(form, ['Celular'], 38546), 'Celular');
  const genero = requireInput(findInput(form, ['Gênero', 'Genero'], 38564), 'Gênero');
  const consentimento = requireInput(findInput(form, ['Aceite da LGPD'], 38679), 'Aceite da LGPD');
  const idps = requireInput(findInput(form, ['IDPS'], 38548), 'IDPS');
  const lgpdAssinatura = requireInput(findInput(form, ['LGPD - Assinatura'], 38707), 'LGPD - Assinatura');
  const lgpdBaseLegal = requireInput(findInput(form, ['LGPD - Base legal'], 38708), 'LGPD - Base legal');
  const generoRubeus = requireInput(findInput(form, ['Gênero Rubeus', 'Genero Rubeus'], 38565), 'Gênero Rubeus');
  const button = findButton(form, ['Avançar']);
  return {
    token: String(token), target: String(form.id), local: String(form.local), button_id: String(button.button),
    campo_nome_id: String(nome.field_id), campo_possui_nome_social_id: String(possuiNomeSocial.field_id),
    campo_nome_social_id: String(nomeSocial.field_id), campo_email_id: String(email.field_id),
    campo_data_nascimento_id: String(nascimento.field_id), campo_celular_id: String(celular.field_id),
    campo_genero_id: String(genero.field_id), campo_consentimento_id: String(consentimento.field_id),
    campo_idps_id: String(idps.field_id), campo_lgpd_assinatura_id: String(lgpdAssinatura.field_id),
    campo_lgpd_base_legal_id: String(lgpdBaseLegal.field_id), campo_genero_rubeus_id: String(generoRubeus.field_id),
    idps_valor: toStringValue(idps.value, '217'), lgpd_assinatura_valor: toStringValue(lgpdAssinatura.value, '1'),
    lgpd_base_legal_valor: toStringValue(lgpdBaseLegal.value, '4'), data_maxima_nascimento: currentIsoDate(),
    titulo_etapa: 'Dados básicos', processo_seletivo_id: toStringValue(processId), eh_nota_enem: isNotaEnemProcess(processId), erro: ''
  };
}

async function buildCourseScreenData(formResponse, processId) {
  const form = formResponse?.data?.form; const token = formResponse?.token;
  const curso = requireInput(findInput(form, ['Curso'], 38627), 'Curso');
  const turno = requireInput(findInput(form, ['Turno'], 38547), 'Turno');
  const area = requireInput(findInput(form, ['IDAREAINTERESSE'], 38553), 'IDAREAINTERESSE');
  const oferta = requireInput(findInput(form, ['CODOFERTA'], 38552), 'CODOFERTA');
  const coligada = requireInput(findInput(form, ['CODCOLIGADA'], 38611), 'CODCOLIGADA');
  const filial = requireInput(findInput(form, ['CODFILIAL'], 38612), 'CODFILIAL');
  const tipoCurso = requireInput(findInput(form, ['CODTIPOCURSO'], 38610), 'CODTIPOCURSO');
  const button = findButton(form, ['Avançar']);
  const query = findQueryForField(form, curso.field_id);
  const nextFields = (query.fields ?? []).map((item) => Number(item.field)).filter((f) => f !== Number(curso.field_id));
  const courseOptionsResponse = await getDataSource({ datasource: query.query_data, target: curso.field_id, filter: [], nextFields, token });
  return {
    token: String(token), target: String(form.id), local: String(form.local), button_id: String(button.button),
    datasource: String(query.query_data), campo_curso_id: String(curso.field_id), campo_turno_id: String(turno.field_id),
    campo_area_interesse_id: String(area.field_id), campo_oferta_id: String(oferta.field_id),
    campo_polo_id: '38550', campo_coligada_id: String(coligada.field_id),
    campo_filial_id: String(filial.field_id), campo_tipo_curso_id: String(tipoCurso.field_id),
    cursos: flowOptions(extractDataSourceOptions(courseOptionsResponse)), turnos: [], turno_visivel: false,
    curso_selecionado: '', turno_selecionado: '', area_interesse_valor: '', oferta_valor: '', polo_valor: isNotaEnemProcess(processId) ? '01' : '', coligada_valor: '', filial_valor: '', tipo_curso_valor: '',
    processo_seletivo_id: toStringValue(processId), eh_nota_enem: isNotaEnemProcess(processId), erro: ''
  };
}

async function buildEnemScreenData(formResponse, processId) {
  const form = formResponse?.data?.form; const token = formResponse?.token;
  if (!form || !token) throw new Error('A Rubeus não retornou o formulário de notas do ENEM.');
  const numero = requireInput(findInput(form, ['Número de inscrição do ENEM'], 38556), 'Número de inscrição do ENEM');
  const ano = requireInput(findInput(form, ['Ano de realização do ENEM'], 38557), 'Ano de realização do ENEM');
  const natureza = requireInput(findInput(form, ['Nota de ciências da natureza do ENEM'], 38563), 'Nota de ciências da natureza do ENEM');
  const humanas = requireInput(findInput(form, ['Nota de ciências humanas do ENEM'], 38562), 'Nota de ciências humanas do ENEM');
  const matematica = requireInput(findInput(form, ['Nota de matemática do ENEM'], 38561), 'Nota de matemática do ENEM');
  const linguagens = requireInput(findInput(form, ['Nota de linguagens do ENEM'], 38560), 'Nota de linguagens do ENEM');
  const redacao = requireInput(findInput(form, ['Nota da redação do ENEM'], 38559), 'Nota da redação do ENEM');
  const media = findInput(form, ['Média de notas do ENEM'], 38558);
  const button = findButton(form, ['Avançar']);
  return {
    token: String(token), target: String(form.id), local: String(form.local), button_id: String(button.button),
    campo_enem_numero_id: String(numero.field_id), campo_enem_ano_id: String(ano.field_id),
    campo_enem_natureza_id: String(natureza.field_id), campo_enem_humanas_id: String(humanas.field_id),
    campo_enem_matematica_id: String(matematica.field_id), campo_enem_linguagens_id: String(linguagens.field_id),
    campo_enem_redacao_id: String(redacao.field_id), campo_enem_media_id: String(media?.field_id ?? '38558'),
    anos_enem: Array.isArray(ano?.data) && ano.data.length > 0 ? ano.data.map((item) => ({ id: toStringValue(item.value), title: toStringValue(item.display) })) : ANOS_ENEM,
    processo_seletivo_id: toStringValue(processId), eh_nota_enem: true, erro: ''
  };
}

async function buildAlmostThereScreenData(formResponse, previousSubmitResponse) {
  const form = formResponse?.data?.form; const token = formResponse?.token;
  const cpf = requireInput(findInput(form, ['CPF'], 38567), 'CPF');
  const nacionalidade = requireInput(findInput(form, ['Nacionalidade'], 38780), 'Nacionalidade');
  const ensinoMedio = requireInput(findInput(form, ['Você já concluiu o ensino médio?'], 251544), 'Conclusão do ensino médio');
  const deficiencia = requireInput(findInput(form, ['Possui alguma deficiência?'], 38575), 'Possui alguma deficiência?');
  const auditiva = requireInput(findInput(form, ['Auditiva'], 38577), 'Auditiva');
  const fala = requireInput(findInput(form, ['Fala'], 38578), 'Fala');
  const fisica = requireInput(findInput(form, ['Física'], 38576), 'Física');
  const intelectual = requireInput(findInput(form, ['Intelectual'], 38580), 'Intelectual');
  const visual = requireInput(findInput(form, ['Visual'], 38579), 'Visual');
  const mental = requireInput(findInput(form, ['Mental'], 38581), 'Mental');
  const outras = requireInput(findInput(form, ['Outras deficiências'], 38582), 'Outras deficiências');
  const outrasTexto = requireInput(findInput(form, ['Deficiência motivo outras 【entity-TOTVS¦canonical_name=TOTVS】'], 38583), 'Descrição de outra deficiência');
  const origem = requireInput(findInput(form, ['Como você ficou sabendo sobre este processo seletivo?'], 319427), 'Como ficou sabendo');
  const origemOutro = requireInput(findInput(form, ['Outro:'], 319428), 'Outro canal');
  const button = findButton(form, ['Concluir']);
  const originQuery = findQueryForField(form, origem.field_id);
  let origens = FALLBACK_ORIGINS;
  if (originQuery?.query_data) {
    try {
      const originsResponse = await getDataSource({ datasource: originQuery.query_data, target: origem.field_id, filter: [], nextFields: [], token });
      const dynamicOrigins = flowOptions(extractDataSourceOptions(originsResponse));
      if (dynamicOrigins.length > 0) origens = dynamicOrigins;
    } catch {}
  }
  const redirect = previousSubmitResponse?.data?.redirect ?? {};
  return {
    token: String(token), target: String(form.id), local: String(form.local), button_id: String(button.button),
    person_id: toStringValue(redirect.person_id), applyment_id: toStringValue(redirect.applyment_id),
    campo_cpf_id: String(cpf.field_id), campo_nacionalidade_id: String(nacionalidade.field_id),
    campo_ensino_medio_id: String(ensinoMedio.field_id), campo_deficiencia_id: String(deficiencia.field_id),
    campo_def_auditiva_id: String(auditiva.field_id), campo_def_fala_id: String(fala.field_id),
    campo_def_fisica_id: String(fisica.field_id), campo_def_intelectual_id: String(intelectual.field_id),
    campo_def_visual_id: String(visual.field_id), campo_def_mental_id: String(mental.field_id),
    campo_def_outras_id: String(outras.field_id), campo_def_outras_texto_id: String(outrasTexto.field_id),
    campo_origem_id: String(origem.field_id), campo_origem_outro_id: String(origemOutro.field_id),
    datasource_origem: toStringValue(originQuery?.query_data), origens, erro: ''
  };
}
function responseForScreen(screen, data) { return { screen, data }; }
function basicRetryData(data, message) {
  return {
    token: toStringValue(data.token), target: toStringValue(data.target), local: toStringValue(data.local, 'step'),
    button_id: toStringValue(data.button_id), campo_nome_id: toStringValue(data.campo_nome_id),
    campo_possui_nome_social_id: toStringValue(data.campo_possui_nome_social_id), campo_nome_social_id: toStringValue(data.campo_nome_social_id),
    campo_email_id: toStringValue(data.campo_email_id), campo_data_nascimento_id: toStringValue(data.campo_data_nascimento_id),
    campo_celular_id: toStringValue(data.campo_celular_id), campo_genero_id: toStringValue(data.campo_genero_id),
    campo_consentimento_id: toStringValue(data.campo_consentimento_id), campo_idps_id: toStringValue(data.campo_idps_id),
    campo_lgpd_assinatura_id: toStringValue(data.campo_lgpd_assinatura_id), campo_lgpd_base_legal_id: toStringValue(data.campo_lgpd_base_legal_id),
    campo_genero_rubeus_id: toStringValue(data.campo_genero_rubeus_id), idps_valor: toStringValue(data.idps_valor, '217'),
    lgpd_assinatura_valor: toStringValue(data.lgpd_assinatura_valor, '1'), lgpd_base_legal_valor: toStringValue(data.lgpd_base_legal_valor, '4'),
    data_maxima_nascimento: currentIsoDate(), titulo_etapa: 'Dados básicos',
    processo_seletivo_id: toStringValue(data.processo_seletivo_id), eh_nota_enem: isNotaEnemProcess(data.processo_seletivo_id), erro: message
  };
}
async function courseRetryData(data, message) {
  let courses = []; let shifts = []; let nextOptions = {}; const courseId = toStringValue(data.curso_id ?? data.curso_selecionado);
  try {
    const technicalFields = [data.campo_area_interesse_id, data.campo_oferta_id, data.campo_polo_id, data.campo_coligada_id, data.campo_filial_id, data.campo_tipo_curso_id].filter(Boolean);
    const reqs = [getDataSource({ datasource: data.datasource, target: data.campo_curso_id, filter: [], nextFields: [data.campo_turno_id, ...technicalFields].filter(Boolean), token: data.token })];
    if (courseId) reqs.push(getDataSource({ datasource: data.datasource, target: data.campo_turno_id, filter: [{ field: toInteger(data.campo_curso_id, 'campo_curso_id'), values: courseId }], nextFields: technicalFields, token: data.token }));
    const [coursesResponse, shiftsResponse] = await Promise.all(reqs);
    courses = flowOptions(extractDataSourceOptions(coursesResponse));
    if (shiftsResponse) { shifts = flowOptions(extractDataSourceOptions(shiftsResponse)); nextOptions = shiftsResponse?.data?.nextOptions ?? {}; }
  } catch {}
  const optionValue = (fieldId, existingValue) => toStringValue(nextOptions[toStringValue(fieldId)]?.value, toStringValue(existingValue));
  return {
    token: toStringValue(data.token), target: toStringValue(data.target), local: toStringValue(data.local, 'step'),
    button_id: toStringValue(data.button_id), datasource: toStringValue(data.datasource),
    campo_curso_id: toStringValue(data.campo_curso_id), campo_turno_id: toStringValue(data.campo_turno_id),
    campo_area_interesse_id: toStringValue(data.campo_area_interesse_id), campo_oferta_id: toStringValue(data.campo_oferta_id),
    campo_polo_id: toStringValue(data.campo_polo_id), campo_coligada_id: toStringValue(data.campo_coligada_id),
    campo_filial_id: toStringValue(data.campo_filial_id), campo_tipo_curso_id: toStringValue(data.campo_tipo_curso_id),
    cursos: courses, turnos: shifts, turno_visivel: shifts.length > 0, curso_selecionado: courseId,
    turno_selecionado: toStringValue(data.turno_id ?? data.turno_selecionado, shifts.length === 1 ? shifts[0].id : ''),
    area_interesse_valor: optionValue(data.campo_area_interesse_id, data.area_interesse_valor),
    oferta_valor: optionValue(data.campo_oferta_id, data.oferta_valor),
    polo_valor: toStringValue(nextOptions[toStringValue(data.campo_polo_id)]?.value, isNotaEnemContext(data) ? '01' : toStringValue(data.polo_valor)),
    coligada_valor: optionValue(data.campo_coligada_id, data.coligada_valor), filial_valor: optionValue(data.campo_filial_id, data.filial_valor),
    tipo_curso_valor: optionValue(data.campo_tipo_curso_id, data.tipo_curso_valor),
    processo_seletivo_id: toStringValue(data.processo_seletivo_id), eh_nota_enem: isNotaEnemContext(data), erro: message
  };
}
async function enemRetryData(data, message) {
  return {
    token: toStringValue(data.token), target: toStringValue(data.target), local: toStringValue(data.local, 'step'),
    button_id: toStringValue(data.button_id),
    campo_enem_numero_id: enemFieldId(data.campo_enem_numero_id, 38556), campo_enem_ano_id: enemFieldId(data.campo_enem_ano_id, 38557),
    campo_enem_natureza_id: enemFieldId(data.campo_enem_natureza_id, 38563), campo_enem_humanas_id: enemFieldId(data.campo_enem_humanas_id, 38562),
    campo_enem_matematica_id: enemFieldId(data.campo_enem_matematica_id, 38561), campo_enem_linguagens_id: enemFieldId(data.campo_enem_linguagens_id, 38560),
    campo_enem_redacao_id: enemFieldId(data.campo_enem_redacao_id, 38559), campo_enem_media_id: enemFieldId(data.campo_enem_media_id, 38558),
    anos_enem: ANOS_ENEM, processo_seletivo_id: toStringValue(data.processo_seletivo_id), eh_nota_enem: true, erro: message
  };
}
function fastAlmostThereRetryData(data, message) {
  return {
    token: toStringValue(data.token), target: toStringValue(data.target), local: toStringValue(data.local, 'step'),
    button_id: toStringValue(data.button_id), person_id: toStringValue(data.person_id), applyment_id: toStringValue(data.applyment_id),
    campo_cpf_id: toStringValue(data.campo_cpf_id), campo_nacionalidade_id: toStringValue(data.campo_nacionalidade_id),
    campo_ensino_medio_id: toStringValue(data.campo_ensino_medio_id), campo_deficiencia_id: toStringValue(data.campo_deficiencia_id),
    campo_def_auditiva_id: toStringValue(data.campo_def_auditiva_id), campo_def_fala_id: toStringValue(data.campo_def_fala_id),
    campo_def_fisica_id: toStringValue(data.campo_def_fisica_id), campo_def_intelectual_id: toStringValue(data.campo_def_intelectual_id),
    campo_def_visual_id: toStringValue(data.campo_def_visual_id), campo_def_mental_id: toStringValue(data.campo_def_mental_id),
    campo_def_outras_id: toStringValue(data.campo_def_outras_id), campo_def_outras_texto_id: toStringValue(data.campo_def_outras_texto_id),
    campo_origem_id: toStringValue(data.campo_origem_id), campo_origem_outro_id: toStringValue(data.campo_origem_outro_id),
    datasource_origem: toStringValue(data.datasource_origem), origens: FALLBACK_ORIGINS,
    erro: message || 'Não foi possível concluir a inscrição.'
  };
}

async function routeFlowRequest(requestData) {
  const action = requestData?.action; const data = requestData?.data ?? {}; const customAction = data?.acao;
  if (action === 'ping') return { data: { status: 'active' } };
  if (action === 'INIT') {
    try {
      const processes = await listProcesses();
      if (processes.length === 0) {
        return responseForScreen('ESCOLHA_PROCESSO', { processo_seletivo_id: [], tem_processos: false, mensagem_vazio: 'Não há nenhum processo seletivo disponível para inscrição no momento.', erro: '' });
      }
      return responseForScreen('ESCOLHA_PROCESSO', { processo_seletivo_id: processes, tem_processos: true, mensagem_vazio: '', erro: '' });
    } catch {
      return responseForScreen('ESCOLHA_PROCESSO', { processo_seletivo_id: [], tem_processos: false, mensagem_vazio: 'Não há nenhum processo seletivo disponível no momento.', erro: '' });
    }
  }
  if (action === 'BACK') return { data: { status: 'active' } };
  if (action !== 'data_exchange') return { data: { status: 'active' } };

  switch (customAction) {
    case 'encerrar_sem_processos': {
      return responseForScreen('SEM_PROCESSOS', { mensagem: 'Não há nenhum processo seletivo disponível para inscrição no momento. Em breve abriremos novas turmas.' });
    }
    case 'selecionar_processo': {
      try {
        const rawProcessId = data.processo_seletivo_id ?? data.processo_id;
        if (!rawProcessId) throw new Error('Selecione um processo seletivo.');
        const startResponse = await startApplication(rawProcessId);
        const formResponse = await getForm(startResponse.data.next, startResponse.data.local, startResponse.token);
        return responseForScreen('DADOS_BASICOS', buildBasicScreenData(formResponse, rawProcessId));
      } catch (error) {
        const processes = await listProcesses();
        if (processes.length === 0) {
          return responseForScreen('ESCOLHA_PROCESSO', { processo_seletivo_id: [], tem_processos: false, mensagem_vazio: 'Não há nenhum processo seletivo disponível no momento.', erro: '' });
        }
        return responseForScreen('ESCOLHA_PROCESSO', { processo_seletivo_id: processes, tem_processos: true, mensagem_vazio: '', erro: error.message });
      }
    }
    case 'enviar_dados_basicos': {
      try {
        const possuiNomeSocial = toBoolean(data.possui_nome_social); const genero = toStringValue(data.genero);
        const fields = compactFields([
          fieldItem(data.campo_nome_id, toStringValue(data.nome).trim()),
          fieldItem(data.campo_possui_nome_social_id, possuiNomeSocial),
          fieldItem(data.campo_nome_social_id, possuiNomeSocial ? toStringValue(data.nome_social).trim() : ''),
          fieldItem(data.campo_email_id, toStringValue(data.email).trim()),
          fieldItem(data.campo_data_nascimento_id, toStringValue(data.data_nascimento)),
          fieldItem(data.campo_celular_id, formatBrazilianPhone(data.celular)),
          fieldItem(data.campo_genero_id, genero), fieldItem(data.campo_consentimento_id, toBoolean(data.aceite_privacidade)),
          fieldItem(data.campo_idps_id, toStringValue(data.idps_valor, '217')),
          fieldItem(data.campo_lgpd_assinatura_id, toStringValue(data.lgpd_assinatura_valor, '1')),
          fieldItem(data.campo_lgpd_base_legal_id, toStringValue(data.lgpd_base_legal_valor, '4')),
          fieldItem(data.campo_genero_rubeus_id, genero)
        ]);
        const submitResponse = await submitForm(data.button_id, fields, data.token);
        const nextFormResponse = await getForm(submitResponse.data.next, submitResponse.data.local, submitResponse.data.token ?? data.token);
        return responseForScreen('CURSO_INTERESSE', await buildCourseScreenData(nextFormResponse, data.processo_seletivo_id));
      } catch (error) {
        return responseForScreen('DADOS_BASICOS', basicRetryData(data, error.message));
      }
    }
    case 'buscar_turnos': {
      try {
        const technicalFields = [data.campo_area_interesse_id, data.campo_oferta_id, data.campo_polo_id, data.campo_coligada_id, data.campo_filial_id, data.campo_tipo_curso_id].filter(Boolean);
        const [coursesResponse, shiftsResponse] = await Promise.all([
          getDataSource({ datasource: data.datasource, target: data.campo_curso_id, filter: [], nextFields: [data.campo_turno_id, ...technicalFields], token: data.token }),
          getDataSource({ datasource: data.datasource, target: data.campo_turno_id, filter: [{ field: toInteger(data.campo_curso_id, 'campo_curso_id'), values: toStringValue(data.curso_id) }], nextFields: technicalFields, token: data.token })
        ]);
        const courseOptions = flowOptions(extractDataSourceOptions(coursesResponse));
        const shifts = flowOptions(extractDataSourceOptions(shiftsResponse));
        const nextOptions = shiftsResponse?.data?.nextOptions ?? {};
        if (shifts.length === 0) throw new Error('Nenhum turno foi encontrado para o curso selecionado.');
        return responseForScreen('CURSO_INTERESSE', {
          token: toStringValue(data.token), target: toStringValue(data.target), local: toStringValue(data.local, 'step'),
          button_id: toStringValue(data.button_id), datasource: toStringValue(data.datasource),
          campo_curso_id: toStringValue(data.campo_curso_id), campo_turno_id: toStringValue(data.campo_turno_id),
          campo_area_interesse_id: toStringValue(data.campo_area_interesse_id), campo_oferta_id: toStringValue(data.campo_oferta_id),
          campo_polo_id: toStringValue(data.campo_polo_id), campo_coligada_id: toStringValue(data.campo_coligada_id),
          campo_filial_id: toStringValue(data.campo_filial_id), campo_tipo_curso_id: toStringValue(data.campo_tipo_curso_id),
          cursos: courseOptions, turnos: shifts, turno_visivel: true, curso_selecionado: toStringValue(data.curso_id),
          turno_selecionado: shifts.length === 1 ? shifts[0].id : '',
          area_interesse_valor: toStringValue(nextOptions[toStringValue(data.campo_area_interesse_id)]?.value),
          oferta_valor: toStringValue(nextOptions[toStringValue(data.campo_oferta_id)]?.value),
          polo_valor: toStringValue(nextOptions[toStringValue(data.campo_polo_id)]?.value, isNotaEnemContext(data) ? '01' : ''),
          coligada_valor: toStringValue(nextOptions[toStringValue(data.campo_coligada_id)]?.value),
          filial_valor: toStringValue(nextOptions[toStringValue(data.campo_filial_id)]?.value),
          tipo_curso_valor: toStringValue(nextOptions[toStringValue(data.campo_tipo_curso_id)]?.value),
          processo_seletivo_id: toStringValue(data.processo_seletivo_id), eh_nota_enem: isNotaEnemContext(data), erro: ''
        });
      } catch (error) {
        return responseForScreen('CURSO_INTERESSE', await courseRetryData(data, error.message));
      }
    }
    case 'enviar_curso': {
      try {
        const notaEnem = isNotaEnemContext(data);
        const fields = compactFields([
          fieldItem(data.campo_curso_id, toStringValue(data.curso_id)),
          fieldItem(data.campo_turno_id, toStringValue(data.turno_id)),
          fieldItem(data.campo_area_interesse_id, toStringValue(data.area_interesse_valor)),
          fieldItem(data.campo_oferta_id, toStringValue(data.oferta_valor)),
          fieldItem(toStringValue(data.campo_polo_id, '38550'), notaEnem ? '01' : toStringValue(data.polo_valor)),
          fieldItem(data.campo_coligada_id, toStringValue(data.coligada_valor)),
          fieldItem(data.campo_filial_id, toStringValue(data.filial_valor)),
          fieldItem(data.campo_tipo_curso_id, toStringValue(data.tipo_curso_valor))
        ]);
        const submitResponse = await submitForm(data.button_id, fields, data.token);
        const nextToken = submitResponse.data.token ?? data.token;
        const nextFormResponse = await getForm(submitResponse.data.next, submitResponse.data.local, nextToken);
        if (notaEnem) {
          return responseForScreen('DADOS_ENEM', await buildEnemScreenData(nextFormResponse, data.processo_seletivo_id));
        } else {
          return responseForScreen('QUASE_LA', await buildAlmostThereScreenData(nextFormResponse, submitResponse));
        }
      } catch (error) {
        console.error('Erro ao enviar curso:', error);
        return responseForScreen('CURSO_INTERESSE', await courseRetryData(data, error.message));
      }
    }
    case 'enviar_notas_enem': {
      try {
        const notas = {
          natureza: normalizeEnemScore(data.nota_natureza_enem, 'Nota de ciências da natureza'),
          humanas: normalizeEnemScore(data.nota_humanas_enem, 'Nota de ciências humanas'),
          matematica: normalizeEnemScore(data.nota_matematica_enem, 'Nota de matemática'),
          linguagens: normalizeEnemScore(data.nota_linguagens_enem, 'Nota de linguagens'),
          redacao: normalizeEnemScore(data.nota_redacao_enem, 'Nota da redação')
        };
        const media = calculateEnemAverage([notas.natureza, notas.humanas, notas.matematica, notas.linguagens, notas.redacao]);
        const fields = compactFields([
          fieldItem(data.campo_enem_numero_id, normalizeEnemRegistration(data.numero_inscricao_enem)),
          fieldItem(data.campo_enem_ano_id, toStringValue(data.ano_enem)),
          fieldItem(data.campo_enem_natureza_id, notas.natureza),
          fieldItem(data.campo_enem_humanas_id, notas.humanas),
          fieldItem(data.campo_enem_matematica_id, notas.matematica),
          fieldItem(data.campo_enem_linguagens_id, notas.linguagens),
          fieldItem(data.campo_enem_redacao_id, notas.redacao),
          fieldItem(data.campo_enem_media_id, media)
        ]);
        const submitResponse = await submitForm(data.button_id, fields, data.token);
        const nextFormResponse = await getForm(submitResponse.data.next, submitResponse.data.local, submitResponse.data.token ?? data.token);
        return responseForScreen('QUASE_LA', await buildAlmostThereScreenData(nextFormResponse, submitResponse));
      } catch (error) {
        console.error('Erro ao enviar notas ENEM:', error);
        return responseForScreen('DADOS_ENEM', await enemRetryData(data, error.message));
      }
    }
    case 'enviar_informacoes_complementares': {
      try {
        const hasDisability = toStringValue(data.possui_deficiencia) === 'T';
        const selectedTypes = Array.isArray(data.tipos_deficiencia) ? data.tipos_deficiencia.map(String) : [];
        const selected = (type) => hasDisability && selectedTypes.includes(type);
        const fields = compactFields([
          fieldItem(data.campo_cpf_id, normalizeCpf(data.cpf)),
          fieldItem(data.campo_nacionalidade_id, normalizeNationality(data.nacionalidade)),
          fieldItem(data.campo_ensino_medio_id, toStringValue(data.concluiu_ensino_medio)),
          fieldItem(data.campo_deficiencia_id, hasDisability ? 'T' : 'F'),
          fieldItem(data.campo_def_auditiva_id, selected('auditiva')), fieldItem(data.campo_def_fala_id, selected('fala')),
          fieldItem(data.campo_def_fisica_id, selected('fisica')), fieldItem(data.campo_def_intelectual_id, selected('intelectual')),
          fieldItem(data.campo_def_visual_id, selected('visual')), fieldItem(data.campo_def_mental_id, selected('mental')),
          fieldItem(data.campo_def_outras_id, selected('outras')),
          fieldItem(data.campo_def_outras_texto_id, selected('outras') ? toStringValue(data.deficiencia_outra).trim() : ''),
          fieldItem(data.campo_origem_id, toStringValue(data.como_conheceu)),
          fieldItem(data.campo_origem_outro_id, toStringValue(data.como_conheceu) === '10' ? toStringValue(data.como_conheceu_outro).trim() : '')
        ]);
        const submitResponse = await submitForm(data.button_id, fields, data.token, RUBEUS_FINAL_SUBMIT_TIMEOUT_MS);
        const redirect = submitResponse?.data?.redirect ?? {};
        return responseForScreen('CONFIRMACAO', { titulo: 'Inscrição concluída!', mensagem: 'Seus dados foram enviados com sucesso para a UniBalsas.', inscricao_id: toStringValue(redirect.applyment_id ?? data.applyment_id, 'não informado') });
      } catch (error) {
        return responseForScreen('QUASE_LA', fastAlmostThereRetryData(data, error.message));
      }
    }
    default: return { data: { status: 'active' } };
  }
}

function decryptRequest(body, privateKey) {
  const { encrypted_flow_data, encrypted_aes_key, initial_vector } = body ?? {};
  const aesKey = crypto.privateDecrypt({ key: privateKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, Buffer.from(encrypted_aes_key, 'base64'));
  const iv = Buffer.from(initial_vector, 'base64');
  const encryptedData = Buffer.from(encrypted_flow_data, 'base64');
  const authTag = encryptedData.subarray(-16);
  const decipher = crypto.createDecipheriv('aes-128-gcm', aesKey, iv);
  decipher.setAuthTag(authTag);
  const decrypted = decipher.update(encryptedData.subarray(0, -16), undefined, 'utf8') + decipher.final('utf8');
  return { requestData: JSON.parse(decrypted), aesKey, iv };
}
function encryptResponse(responsePayload, aesKey, iv) {
  const flippedIv = Buffer.from(iv.map((byte) => byte ^ 0xff));
  const cipher = crypto.createCipheriv('aes-128-gcm', aesKey, flippedIv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(responsePayload), 'utf8'), cipher.final()]);
  return Buffer.concat([encrypted, cipher.getAuthTag()]).toString('base64');
}

export default async function handler(req, res) {
  if (req.method === 'GET') return res.status(200).json({ status: 'ok', version: 'final-v6-enem-separado' });
  if (req.method !== 'POST') return res.status(405).send('Method not allowed');
  let aesKey; let iv; let requestData;
  try {
    requirePrivateKey();
    const privateKey = process.env.FLOW_PRIVATE_KEY.replace(/\\n/g, '\n');
    const decrypted = decryptRequest(req.body, privateKey);
    requestData = decrypted.requestData; aesKey = decrypted.aesKey; iv = decrypted.iv;
    const responsePayload = await routeFlowRequest(requestData);
    const encryptedResponse = encryptResponse(responsePayload, aesKey, iv);
    res.setHeader('Content-Type', 'text/plain');
    return res.status(200).send(encryptedResponse);
  } catch (error) {
    console.error('FLOW ERROR:', error);
    if (aesKey && iv) {
      const data = requestData?.data ?? {};
      let responsePayload = { data: { status: 'active' } };
      if (requestData?.screen === 'QUASE_LA') responsePayload = responseForScreen('QUASE_LA', fastAlmostThereRetryData(data, error.message));
      if (requestData?.screen === 'DADOS_ENEM') responsePayload = responseForScreen('DADOS_ENEM', await enemRetryData(data, error.message));
      const encryptedResponse = encryptResponse(responsePayload, aesKey, iv);
      res.setHeader('Content-Type', 'text/plain');
      return res.status(200).send(encryptedResponse);
    }
    return res.status(500).send('Erro');
  }
}
