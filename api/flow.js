import crypto from 'crypto';

const RUBEUS_BASE_URL = 'https://admin.portal.apprbs.com.br/api/v1';
const PORTAL_ID = 257;
const MAX_FLOW_DROPDOWN_OPTIONS = 200;

const FALLBACK_PROCESSES = [
  { id: '18713', title: 'Vestibular Online - Cursos presenciais - 2026/2' },
  { id: '18716', title: 'Transferência - 2026/2' },
  { id: '18715', title: 'Portador de Diploma - 2026/2' },
  { id: '18714', title: 'Nota do ENEM - 2026/2' }
];

function requirePrivateKey() {
  if (!process.env.FLOW_PRIVATE_KEY) {
    throw new Error('A variável FLOW_PRIVATE_KEY não foi configurada.');
  }
}

function normalizeText(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function toBoolean(value) {
  return value === true || value === 'true' || value === 1 || value === '1';
}

function toStringValue(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  return String(value);
}

function toInteger(value, fieldName) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isInteger(parsed)) {
    throw new Error(`Valor inválido para ${fieldName}.`);
  }
  return parsed;
}

function formatCpf(value) {
  const digits = String(value ?? '').replace(/\D/g, '').slice(0, 11);
  if (digits.length !== 11) return String(value ?? '');
  return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
}

function formatBrazilianPhone(value) {
  let digits = String(value ?? '').replace(/\D/g, '');

  if ((digits.length === 12 || digits.length === 13) && digits.startsWith('55')) {
    digits = digits.slice(2);
  }

  if (digits.length === 11) {
    return digits.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3');
  }

  if (digits.length === 10) {
    return digits.replace(/(\d{2})(\d{4})(\d{4})/, '($1) $2-$3');
  }

  return String(value ?? '');
}

function fieldItem(fieldId, value) {
  if (fieldId === null || fieldId === undefined || fieldId === '') return null;
  return {
    field_id: toInteger(fieldId, 'field_id'),
    value
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
    normalizedLabels.includes(normalizeText(input.label))
  );

  if (byLabel) return byLabel;

  if (fallbackId !== null) {
    return inputs.find((input) => Number(input.field_id) === Number(fallbackId)) ?? null;
  }

  return null;
}

function findButton(form, preferredLabels = ['Avançar', 'Concluir']) {
  const buttons = getFormButtons(form);
  const normalized = preferredLabels.map(normalizeText);

  const button = buttons.find((item) => normalized.includes(normalizeText(item.label)))
    ?? buttons.find((item) => normalizeText(item.label) !== 'voltar');

  if (!button?.button) {
    throw new Error('A Rubeus não retornou o botão de avanço do formulário.');
  }

  return button;
}

function findQueryForField(form, fieldId) {
  return (form?.querys ?? []).find((query) =>
    (query.fields ?? []).some((item) => Number(item.field) === Number(fieldId))
  ) ?? null;
}

function requireInput(input, name) {
  if (!input?.field_id) {
    throw new Error(`O campo "${name}" não foi localizado no formulário da Rubeus.`);
  }
  return input;
}

function flowOptions(options = []) {
  return options.map((option) => ({
    id: toStringValue(option.value),
    title: toStringValue(option.label).replace(/-+$/g, '').trim()
  }));
}

function extractDataSourceOptions(response) {
  if (Array.isArray(response?.data)) return response.data;
  if (Array.isArray(response?.data?.options)) return response.data.options;
  return [];
}

function prioritizeNationalities(options) {
  const priorities = ['10', '20', '50'];
  const byValue = new Map(options.map((item) => [String(item.value), item]));
  const prioritized = priorities.map((value) => byValue.get(value)).filter(Boolean);
  const remaining = options.filter((item) => !priorities.includes(String(item.value)));

  const limited = [...prioritized, ...remaining].slice(0, MAX_FLOW_DROPDOWN_OPTIONS);

  if (options.length > MAX_FLOW_DROPDOWN_OPTIONS) {
    console.warn(
      `A Rubeus retornou ${options.length} nacionalidades. ` +
      `O WhatsApp Flow aceita até ${MAX_FLOW_DROPDOWN_OPTIONS} itens em um Dropdown; ` +
      'a lista foi limitada mantendo Brasileira, Naturalizado Brasileiro e Outros no início.'
    );
  }

  return limited;
}

function currentIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

async function rubeusRequest(path, { method = 'GET', body } = {}) {
  if (!process.env.RBS_TOKEN) {
    throw new Error('A variável RBS_TOKEN não foi configurada.');
  }

  // Saneia o token: remove "Bearer", quebras de linha, espaços e repetições
  let rawToken = String(process.env.RBS_TOKEN || '').trim();
  // Se colaram "Bearer XXX", remove o prefixo
  rawToken = rawToken.replace(/^Bearer\s+/i, '');
  // Remove quebras de linha, espaços e aspas
  rawToken = rawToken.replace(/[\r\n\s'"]+/g, '');
  // Se por acidente colaram o token 2-3x seguidos, pega só os primeiros 64-128 chars hex
  // Token da Rubeus normalmente tem 64 chars hex. Se tiver 128 ou 192 (2x ou 3x), corta.
  if (rawToken.length > 128 && /^[a-f0-9]+$/i.test(rawToken)) {
    rawToken = rawToken.slice(0, 64);
  }
  if (!rawToken) {
    throw new Error('RBS_TOKEN está vazio após saneamento. Verifique a variável de ambiente.');
  }

  const headers = {
    Authorization: `Bearer ${rawToken}`
  };

  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(`${RUBEUS_BASE_URL}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });

  const raw = await response.text();
  let json;

  try {
    json = raw ? JSON.parse(raw) : {};
  } catch {
    json = { message: raw || 'Resposta inválida da Rubeus.' };
  }

  if (!response.ok) {
    throw new Error(
      json?.message || `A Rubeus respondeu com status HTTP ${response.status}.`
    );
  }

  if (json?.success === false) {
    throw new Error(json?.message || 'A operação não pôde ser concluída na Rubeus.');
  }

  return json;
}

async function listProcesses() {
  const response = await rubeusRequest(`/selective-processes?portal=${PORTAL_ID}`);
  const processes = (response.data ?? []).map((process) => ({
    id: String(process.id),
    title: String(process.name)
  }));

  if (processes.length === 0) {
    throw new Error('A Rubeus não retornou processos seletivos ativos.');
  }

  return processes;
}

async function startApplication(processId) {
  return rubeusRequest('/start', {
    method: 'POST',
    body: {
      process: toInteger(processId, 'processo_seletivo_id')
    }
  });
}

async function getForm(target, local, token) {
  return rubeusRequest('/form', {
    method: 'POST',
    body: {
      target: toInteger(target, 'target'),
      local: toStringValue(local, 'step'),
      token: toStringValue(token)
    }
  });
}

async function submitForm(button, data, token) {
  return rubeusRequest('/submit', {
    method: 'POST',
    body: {
      button: toInteger(button, 'button_id'),
      validate_on_server: true,
      data,
      token: toStringValue(token)
    }
  });
}

async function getDataSource({ datasource, target, filter = [], nextFields = [], token }) {
  return rubeusRequest('/data-source', {
    method: 'POST',
    body: {
      datasource: toStringValue(datasource),
      target: toInteger(target, 'target do data-source'),
      filter,
      nextFields: nextFields.map((item) => toInteger(item, 'nextFields')),
      token: toStringValue(token)
    }
  });
}

function buildBasicScreenData(formResponse) {
  const form = formResponse?.data?.form;
  const token = formResponse?.token;

  if (!form || !token) {
    throw new Error('A Rubeus não retornou o formulário de dados básicos.');
  }

  const nome = requireInput(findInput(form, ['Nome completo'], 38544), 'Nome completo');
  const possuiNomeSocial = requireInput(
    findInput(form, ['Possuo nome social'], 38606),
    'Possuo nome social'
  );
  const nomeSocial = requireInput(findInput(form, ['Nome social'], 38607), 'Nome social');
  const email = requireInput(findInput(form, ['E-mail', 'Email'], 38545), 'E-mail');
  const nascimento = requireInput(
    findInput(form, ['Data de nascimento'], 38566),
    'Data de nascimento'
  );
  const celular = requireInput(findInput(form, ['Celular'], 38546), 'Celular');
  const genero = requireInput(findInput(form, ['Gênero', 'Genero'], 38564), 'Gênero');
  const consentimento = requireInput(
    findInput(form, ['Aceite da LGPD'], 38679),
    'Aceite da LGPD'
  );
  const idps = requireInput(findInput(form, ['IDPS'], 38548), 'IDPS');
  const lgpdAssinatura = requireInput(
    findInput(form, ['LGPD - Assinatura'], 38707),
    'LGPD - Assinatura'
  );
  const lgpdBaseLegal = requireInput(
    findInput(form, ['LGPD - Base legal'], 38708),
    'LGPD - Base legal'
  );
  const generoRubeus = requireInput(
    findInput(form, ['Gênero Rubeus', 'Genero Rubeus'], 38565),
    'Gênero Rubeus'
  );
  const button = findButton(form, ['Avançar']);

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
    idps_valor: toStringValue(idps.value, '217'),
    lgpd_assinatura_valor: toStringValue(lgpdAssinatura.value, '1'),
    lgpd_base_legal_valor: toStringValue(lgpdBaseLegal.value, '4'),
    data_maxima_nascimento: currentIsoDate(),
    titulo_etapa: String(formResponse?.data?.stage?.steps?.find(
      (step) => Number(step.id) === Number(form.id)
    )?.name ?? 'Dados básicos'),
    erro: ''
  };
}

async function buildCourseScreenData(formResponse) {
  const form = formResponse?.data?.form;
  const token = formResponse?.token;

  if (!form || !token) {
    throw new Error('A Rubeus não retornou o formulário de curso de interesse.');
  }

  const curso = requireInput(findInput(form, ['Curso'], 38627), 'Curso');
  const turno = requireInput(findInput(form, ['Turno'], 38547), 'Turno');
  const area = requireInput(findInput(form, ['IDAREAINTERESSE'], 38553), 'IDAREAINTERESSE');
  const oferta = requireInput(findInput(form, ['CODOFERTA'], 38552), 'CODOFERTA');
  const coligada = requireInput(findInput(form, ['CODCOLIGADA'], 38611), 'CODCOLIGADA');
  const filial = requireInput(findInput(form, ['CODFILIAL'], 38612), 'CODFILIAL');
  const tipoCurso = requireInput(findInput(form, ['CODTIPOCURSO'], 38610), 'CODTIPOCURSO');
  const button = findButton(form, ['Avançar']);
  const query = findQueryForField(form, curso.field_id);

  if (!query?.query_data) {
    throw new Error('A fonte de dados de cursos não foi localizada na Rubeus.');
  }

  const nextFields = (query.fields ?? [])
    .map((item) => Number(item.field))
    .filter((fieldId) => fieldId !== Number(curso.field_id));

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
    campo_coligada_id: String(coligada.field_id),
    campo_filial_id: String(filial.field_id),
    campo_tipo_curso_id: String(tipoCurso.field_id),
    cursos: flowOptions(extractDataSourceOptions(courseOptionsResponse)),
    turnos: [],
    turno_visivel: false,
    curso_selecionado: '',
    turno_selecionado: '',
    area_interesse_valor: '',
    oferta_valor: '',
    coligada_valor: '',
    filial_valor: '',
    tipo_curso_valor: '',
    erro: ''
  };
}

async function buildAlmostThereScreenData(formResponse, previousSubmitResponse) {
  const form = formResponse?.data?.form;
  const token = formResponse?.token;

  if (!form || !token) {
    throw new Error('A Rubeus não retornou o formulário final da inscrição.');
  }

  const cpf = requireInput(findInput(form, ['CPF'], 38567), 'CPF');
  const nacionalidade = requireInput(
    findInput(form, ['Nacionalidade'], 38780),
    'Nacionalidade'
  );
  const ensinoMedio = requireInput(
    findInput(form, ['Você já concluiu o ensino médio?'], 251544),
    'Conclusão do ensino médio'
  );
  const deficiencia = requireInput(
    findInput(form, ['Possui alguma deficiência?'], 38575),
    'Possui alguma deficiência?'
  );
  const auditiva = requireInput(findInput(form, ['Auditiva'], 38577), 'Auditiva');
  const fala = requireInput(findInput(form, ['Fala'], 38578), 'Fala');
  const fisica = requireInput(findInput(form, ['Física', 'Fisica'], 38576), 'Física');
  const intelectual = requireInput(findInput(form, ['Intelectual'], 38580), 'Intelectual');
  const visual = requireInput(findInput(form, ['Visual'], 38579), 'Visual');
  const mental = requireInput(findInput(form, ['Mental'], 38581), 'Mental');
  const outras = requireInput(
    findInput(form, ['Outras deficiências', 'Outras deficiencias'], 38582),
    'Outras deficiências'
  );
  const outrasTexto = requireInput(
    findInput(form, ['Deficiência motivo outras TOTVS', 'Deficiencia motivo outras TOTVS'], 38583),
    'Descrição de outra deficiência'
  );
  const origem = requireInput(
    findInput(form, ['Como você ficou sabendo sobre este processo seletivo?'], 319427),
    'Como ficou sabendo'
  );
  const origemOutro = requireInput(findInput(form, ['Outro:'], 319428), 'Outro canal');
  const button = findButton(form, ['Concluir']);

  const nationalityQuery = findQueryForField(form, nacionalidade.field_id);
  const originQuery = findQueryForField(form, origem.field_id);

  if (!nationalityQuery?.query_data || !originQuery?.query_data) {
    throw new Error('As fontes de nacionalidade ou origem não foram localizadas.');
  }

  const [nationalitiesResponse, originsResponse] = await Promise.all([
    getDataSource({
      datasource: nationalityQuery.query_data,
      target: nacionalidade.field_id,
      filter: [],
      nextFields: [],
      token
    }),
    getDataSource({
      datasource: originQuery.query_data,
      target: origem.field_id,
      filter: [],
      nextFields: [],
      token
    })
  ]);

  const nationalityOptions = prioritizeNationalities(
    extractDataSourceOptions(nationalitiesResponse)
  );

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
    datasource_nacionalidade: String(nationalityQuery.query_data),
    datasource_origem: String(originQuery.query_data),
    nacionalidades: flowOptions(nationalityOptions),
    origens: flowOptions(extractDataSourceOptions(originsResponse)),
    nacionalidade_padrao: toStringValue(nacionalidade.value, '10'),
    erro: ''
  };
}

function responseForScreen(screen, data) {
  return { screen, data };
}

function basicRetryData(data, message) {
  return {
    token: toStringValue(data.token),
    target: toStringValue(data.target),
    local: toStringValue(data.local, 'step'),
    button_id: toStringValue(data.button_id),
    campo_nome_id: toStringValue(data.campo_nome_id),
    campo_possui_nome_social_id: toStringValue(data.campo_possui_nome_social_id),
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
    idps_valor: toStringValue(data.idps_valor, '217'),
    lgpd_assinatura_valor: toStringValue(data.lgpd_assinatura_valor, '1'),
    lgpd_base_legal_valor: toStringValue(data.lgpd_base_legal_valor, '4'),
    data_maxima_nascimento: currentIsoDate(),
    titulo_etapa: 'Dados básicos',
    erro: message
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
      data.campo_coligada_id,
      data.campo_filial_id,
      data.campo_tipo_curso_id
    ].filter(Boolean);

    const requests = [
      getDataSource({
        datasource: data.datasource,
        target: data.campo_curso_id,
        filter: [],
        nextFields: [data.campo_turno_id, ...technicalFields].filter(Boolean),
        token: data.token
      })
    ];

    if (courseId) {
      requests.push(
        getDataSource({
          datasource: data.datasource,
          target: data.campo_turno_id,
          filter: [
            {
              field: toInteger(data.campo_curso_id, 'campo_curso_id'),
              values: courseId
            }
          ],
          nextFields: technicalFields,
          token: data.token
        })
      );
    }

    const [coursesResponse, shiftsResponse] = await Promise.all(requests);
    courses = flowOptions(extractDataSourceOptions(coursesResponse));

    if (shiftsResponse) {
      shifts = flowOptions(extractDataSourceOptions(shiftsResponse));
      nextOptions = shiftsResponse?.data?.nextOptions ?? {};
    }
  } catch (error) {
    console.error('Não foi possível recarregar cursos/turnos:', error);
  }

  const optionValue = (fieldId, existingValue) =>
    toStringValue(
      nextOptions[toStringValue(fieldId)]?.value,
      toStringValue(existingValue)
    );

  return {
    token: toStringValue(data.token),
    target: toStringValue(data.target),
    local: toStringValue(data.local, 'step'),
    button_id: toStringValue(data.button_id),
    datasource: toStringValue(data.datasource),
    campo_curso_id: toStringValue(data.campo_curso_id),
    campo_turno_id: toStringValue(data.campo_turno_id),
    campo_area_interesse_id: toStringValue(data.campo_area_interesse_id),
    campo_oferta_id: toStringValue(data.campo_oferta_id),
    campo_coligada_id: toStringValue(data.campo_coligada_id),
    campo_filial_id: toStringValue(data.campo_filial_id),
    campo_tipo_curso_id: toStringValue(data.campo_tipo_curso_id),
    cursos: courses,
    turnos: shifts,
    turno_visivel: shifts.length > 0,
    curso_selecionado: courseId,
    turno_selecionado: toStringValue(
      data.turno_id ?? data.turno_selecionado,
      shifts.length === 1 ? shifts[0].id : ''
    ),
    area_interesse_valor: optionValue(
      data.campo_area_interesse_id,
      data.area_interesse_valor
    ),
    oferta_valor: optionValue(data.campo_oferta_id, data.oferta_valor),
    coligada_valor: optionValue(data.campo_coligada_id, data.coligada_valor),
    filial_valor: optionValue(data.campo_filial_id, data.filial_valor),
    tipo_curso_valor: optionValue(
      data.campo_tipo_curso_id,
      data.tipo_curso_valor
    ),
    erro: message
  };
}

async function almostThereRetryData(data, message) {
  let nacionalidades = [{ id: '10', title: 'Brasileira' }];
  let origens = [
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

  try {
    const [nationalitiesResponse, originsResponse] = await Promise.all([
      getDataSource({
        datasource: data.datasource_nacionalidade,
        target: data.campo_nacionalidade_id,
        filter: [],
        nextFields: [],
        token: data.token
      }),
      getDataSource({
        datasource: data.datasource_origem,
        target: data.campo_origem_id,
        filter: [],
        nextFields: [],
        token: data.token
      })
    ]);

    nacionalidades = flowOptions(
      prioritizeNationalities(extractDataSourceOptions(nationalitiesResponse))
    );
    origens = flowOptions(extractDataSourceOptions(originsResponse));
  } catch (error) {
    console.error('Não foi possível recarregar nacionalidades/origens:', error);
  }

  return {
    token: toStringValue(data.token),
    target: toStringValue(data.target),
    local: toStringValue(data.local, 'step'),
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
    datasource_nacionalidade: toStringValue(data.datasource_nacionalidade),
    datasource_origem: toStringValue(data.datasource_origem),
    nacionalidades,
    origens,
    nacionalidade_padrao: toStringValue(data.nacionalidade, '10'),
    erro: message
  };
}

async function routeFlowRequest(requestData) {
  const action = requestData?.action;
  const data = requestData?.data ?? {};
  const customAction = data?.acao;

  if (action === 'ping') {
    return { data: { status: 'active' } };
  }

  if (action === 'INIT') {
    try {
      const processes = await listProcesses();
      return responseForScreen('ESCOLHA_PROCESSO', {
        processo_seletivo_id: processes,
        erro: ''
      });
    } catch (error) {
      console.error('Falha ao listar processos na Rubeus:', error);
      return responseForScreen('ESCOLHA_PROCESSO', {
        processo_seletivo_id: FALLBACK_PROCESSES,
        erro: ''
      });
    }
  }

  if (action === 'BACK') {
    return { data: { status: 'active' } };
  }

  if (action !== 'data_exchange') {
    return { data: { status: 'active' } };
  }

  switch (customAction) {
    case 'selecionar_processo': {
      try {
        // Aceita tanto o nome novo (processo_id) quanto o antigo para compatibilidade
        const rawProcessId = data.processo_seletivo_id ?? data.processo_id ?? data.form?.processo_id ?? data.form?.processo_seletivo_id;
        console.log('selecionar_processo raw:', rawProcessId, 'full data:', JSON.stringify(data).slice(0,500));
        if (!rawProcessId || String(rawProcessId).trim() === '') {
          throw new Error('Selecione um processo seletivo antes de continuar.');
        }
        const startResponse = await startApplication(rawProcessId);
        const formResponse = await getForm(
          startResponse.data.next,
          startResponse.data.local,
          startResponse.token
        );

        return responseForScreen('DADOS_BASICOS', buildBasicScreenData(formResponse));
      } catch (error) {
        console.error('Erro ao iniciar inscrição:', error);
        let processes = FALLBACK_PROCESSES;
        try {
          processes = await listProcesses();
        } catch {}

        return responseForScreen('ESCOLHA_PROCESSO', {
          processo_seletivo_id: processes,
          erro: error.message
        });
      }
    }

    case 'enviar_dados_basicos': {
      try {
        const possuiNomeSocial = toBoolean(data.possui_nome_social);
        const genero = toStringValue(data.genero);

        const fields = compactFields([
          fieldItem(data.campo_nome_id, toStringValue(data.nome).trim()),
          fieldItem(data.campo_possui_nome_social_id, possuiNomeSocial),
          fieldItem(
            data.campo_nome_social_id,
            possuiNomeSocial ? toStringValue(data.nome_social).trim() : ''
          ),
          fieldItem(data.campo_email_id, toStringValue(data.email).trim()),
          fieldItem(data.campo_data_nascimento_id, toStringValue(data.data_nascimento)),
          fieldItem(data.campo_celular_id, formatBrazilianPhone(data.celular)),
          fieldItem(data.campo_genero_id, genero),
          fieldItem(data.campo_consentimento_id, toBoolean(data.aceite_privacidade)),
          fieldItem(data.campo_idps_id, toStringValue(data.idps_valor, '217')),
          fieldItem(
            data.campo_lgpd_assinatura_id,
            toStringValue(data.lgpd_assinatura_valor, '1')
          ),
          fieldItem(
            data.campo_lgpd_base_legal_id,
            toStringValue(data.lgpd_base_legal_valor, '4')
          ),
          fieldItem(data.campo_genero_rubeus_id, genero)
        ]);

        const submitResponse = await submitForm(data.button_id, fields, data.token);
        const nextFormResponse = await getForm(
          submitResponse.data.next,
          submitResponse.data.local,
          submitResponse.data.token ?? data.token
        );

        return responseForScreen(
          'CURSO_INTERESSE',
          await buildCourseScreenData(nextFormResponse)
        );
      } catch (error) {
        console.error('Erro ao enviar dados básicos:', error);
        return responseForScreen('DADOS_BASICOS', basicRetryData(data, error.message));
      }
    }

    case 'buscar_turnos': {
      try {
        const technicalFields = [
          data.campo_area_interesse_id,
          data.campo_oferta_id,
          data.campo_coligada_id,
          data.campo_filial_id,
          data.campo_tipo_curso_id
        ];

        const [coursesResponse, shiftsResponse] = await Promise.all([
          getDataSource({
            datasource: data.datasource,
            target: data.campo_curso_id,
            filter: [],
            nextFields: [
              data.campo_turno_id,
              ...technicalFields
            ],
            token: data.token
          }),
          getDataSource({
            datasource: data.datasource,
            target: data.campo_turno_id,
            filter: [
              {
                field: toInteger(data.campo_curso_id, 'campo_curso_id'),
                values: toStringValue(data.curso_id)
              }
            ],
            nextFields: technicalFields,
            token: data.token
          })
        ]);

        const shifts = flowOptions(extractDataSourceOptions(shiftsResponse));
        const nextOptions = shiftsResponse?.data?.nextOptions ?? {};

        return responseForScreen('CURSO_INTERESSE', {
          token: toStringValue(data.token),
          target: toStringValue(data.target),
          local: toStringValue(data.local, 'step'),
          button_id: toStringValue(data.button_id),
          datasource: toStringValue(data.datasource),
          campo_curso_id: toStringValue(data.campo_curso_id),
          campo_turno_id: toStringValue(data.campo_turno_id),
          campo_area_interesse_id: toStringValue(data.campo_area_interesse_id),
          campo_oferta_id: toStringValue(data.campo_oferta_id),
          campo_coligada_id: toStringValue(data.campo_coligada_id),
          campo_filial_id: toStringValue(data.campo_filial_id),
          campo_tipo_curso_id: toStringValue(data.campo_tipo_curso_id),
          cursos: flowOptions(extractDataSourceOptions(coursesResponse)),
          turnos: shifts,
          turno_visivel: shifts.length > 0,
          curso_selecionado: toStringValue(data.curso_id),
          turno_selecionado: shifts.length === 1 ? shifts[0].id : '',
          area_interesse_valor: toStringValue(
            nextOptions[toStringValue(data.campo_area_interesse_id)]?.value
          ),
          oferta_valor: toStringValue(
            nextOptions[toStringValue(data.campo_oferta_id)]?.value
          ),
          coligada_valor: toStringValue(
            nextOptions[toStringValue(data.campo_coligada_id)]?.value
          ),
          filial_valor: toStringValue(
            nextOptions[toStringValue(data.campo_filial_id)]?.value
          ),
          tipo_curso_valor: toStringValue(
            nextOptions[toStringValue(data.campo_tipo_curso_id)]?.value
          ),
          erro: ''
        });
      } catch (error) {
        console.error('Erro ao buscar turnos:', error);
        return responseForScreen(
          'CURSO_INTERESSE',
          await courseRetryData(data, error.message)
        );
      }
    }

    case 'enviar_curso': {
      try {
        const fields = compactFields([
          fieldItem(data.campo_curso_id, toStringValue(data.curso_id)),
          fieldItem(data.campo_turno_id, toStringValue(data.turno_id)),
          fieldItem(
            data.campo_area_interesse_id,
            toStringValue(data.area_interesse_valor)
          ),
          fieldItem(data.campo_oferta_id, toStringValue(data.oferta_valor)),
          fieldItem(data.campo_coligada_id, toStringValue(data.coligada_valor)),
          fieldItem(data.campo_filial_id, toStringValue(data.filial_valor)),
          fieldItem(data.campo_tipo_curso_id, toStringValue(data.tipo_curso_valor))
        ]);

        const submitResponse = await submitForm(data.button_id, fields, data.token);
        const nextToken = submitResponse.data.token ?? data.token;
        const nextFormResponse = await getForm(
          submitResponse.data.next,
          submitResponse.data.local,
          nextToken
        );

        return responseForScreen(
          'QUASE_LA',
          await buildAlmostThereScreenData(nextFormResponse, submitResponse)
        );
      } catch (error) {
        console.error('Erro ao enviar curso:', error);
        return responseForScreen(
          'CURSO_INTERESSE',
          await courseRetryData(data, error.message)
        );
      }
    }

    case 'enviar_informacoes_complementares': {
      try {
        const hasDisability = toStringValue(data.possui_deficiencia) === 'T';
        const selectedTypes = Array.isArray(data.tipos_deficiencia)
          ? data.tipos_deficiencia.map(String)
          : [];
        const selected = (type) => hasDisability && selectedTypes.includes(type);
        const selectedOther = selected('outras');

        const fields = compactFields([
          fieldItem(data.campo_cpf_id, formatCpf(data.cpf)),
          fieldItem(data.campo_nacionalidade_id, toStringValue(data.nacionalidade, '10')),
          fieldItem(
            data.campo_ensino_medio_id,
            toStringValue(data.concluiu_ensino_medio)
          ),
          fieldItem(data.campo_deficiencia_id, hasDisability ? 'T' : 'F'),
          fieldItem(data.campo_def_auditiva_id, selected('auditiva')),
          fieldItem(data.campo_def_fala_id, selected('fala')),
          fieldItem(data.campo_def_fisica_id, selected('fisica')),
          fieldItem(data.campo_def_intelectual_id, selected('intelectual')),
          fieldItem(data.campo_def_visual_id, selected('visual')),
          fieldItem(data.campo_def_mental_id, selected('mental')),
          fieldItem(data.campo_def_outras_id, selectedOther),
          fieldItem(
            data.campo_def_outras_texto_id,
            selectedOther ? toStringValue(data.deficiencia_outra).trim() : ''
          ),
          fieldItem(data.campo_origem_id, toStringValue(data.como_conheceu)),
          fieldItem(
            data.campo_origem_outro_id,
            toStringValue(data.como_conheceu) === '10'
              ? toStringValue(data.como_conheceu_outro).trim()
              : ''
          )
        ]);

        const submitResponse = await submitForm(data.button_id, fields, data.token);
        const redirect = submitResponse?.data?.redirect ?? {};
        const applicationId = toStringValue(
          redirect.applyment_id ?? data.applyment_id,
          'não informado'
        );

        return responseForScreen('CONFIRMACAO', {
          titulo: 'Inscrição concluída!',
          mensagem: 'Seus dados foram enviados com sucesso para a UniBalsas.',
          inscricao_id: applicationId
        });
      } catch (error) {
        console.error('Erro ao concluir inscrição:', error);
        return responseForScreen(
          'QUASE_LA',
          await almostThereRetryData(data, error.message)
        );
      }
    }

    default:
      return { data: { status: 'active' } };
  }
}

function decryptRequest(body, privateKey) {
  const { encrypted_flow_data, encrypted_aes_key, initial_vector } = body ?? {};

  if (!encrypted_flow_data || !encrypted_aes_key || !initial_vector) {
    throw new Error('Payload criptografado do WhatsApp Flow incompleto.');
  }

  const aesKey = crypto.privateDecrypt(
    {
      key: privateKey,
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: 'sha256'
    },
    Buffer.from(encrypted_aes_key, 'base64')
  );

  const iv = Buffer.from(initial_vector, 'base64');
  const encryptedData = Buffer.from(encrypted_flow_data, 'base64');
  const authTag = encryptedData.subarray(-16);
  const data = encryptedData.subarray(0, -16);

  const decipher = crypto.createDecipheriv('aes-128-gcm', aesKey, iv);
  decipher.setAuthTag(authTag);

  const decrypted =
    decipher.update(data, undefined, 'utf8') + decipher.final('utf8');

  return {
    requestData: JSON.parse(decrypted),
    aesKey,
    iv
  };
}

function encryptResponse(responsePayload, aesKey, iv) {
  const flippedIv = Buffer.from(iv.map((byte) => byte ^ 0xff));
  const cipher = crypto.createCipheriv('aes-128-gcm', aesKey, flippedIv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(responsePayload), 'utf8'),
    cipher.final()
  ]);

  return Buffer.concat([encrypted, cipher.getAuthTag()]).toString('base64');
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(200).send('ok');
  }

  if (req.method !== 'POST') {
    return res.status(405).send('Method not allowed');
  }

  try {
    requirePrivateKey();

    const privateKey = process.env.FLOW_PRIVATE_KEY.replace(/\\n/g, '\n');
    const { requestData, aesKey, iv } = decryptRequest(req.body, privateKey);

    console.log('FLOW REQUEST:', {
      action: requestData?.action,
      screen: requestData?.screen,
      customAction: requestData?.data?.acao
    });

    const responsePayload = await routeFlowRequest(requestData);
    const encryptedResponse = encryptResponse(responsePayload, aesKey, iv);

    res.setHeader('Content-Type', 'text/plain');
    return res.status(200).send(encryptedResponse);
  } catch (error) {
    console.error('FLOW ERROR:', error);
    return res.status(500).send(error.message);
  }
}
