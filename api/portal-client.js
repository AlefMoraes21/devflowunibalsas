// Cliente do portal publicado, identificado nos chunks 2700/7435/1994/5509.
// Não usa nem tenta converter o token da API oficial /api/v1.
const ORIGIN = 'https://vestibular.unibalsas.edu.br';
const DOMAIN = 'vestibular.unibalsas.edu.br/presencial';
const DOMAIN_PARAMS = 'presencial';
const HOST = new URL(ORIGIN).hostname;
const MESSAGE = 'Não foi possível consultar sua matrícula agora. Tente novamente em instantes.';

export class PortalClientError extends Error {
  constructor(code, message = MESSAGE, { status, uncertain = false, session, details } = {}) {
    super(message);
    this.name = 'PortalClientError';
    this.code = code;
    this.uncertain = uncertain;
    if (status !== undefined) this.status = status;
    if (session) this.session = structuredClone(session);
    if (details) this.details = details;
  }
}

function integer(value) {
  const text = String(value ?? '');
  if (!/^\d+$/.test(text) || Number(text) < 1 || Number(text) > 2147483647) return null;
  return String(Number(text));
}

function authenticated(session) {
  if (!session || session.domain !== DOMAIN || session.domainParams !== DOMAIN_PARAMS ||
      typeof session.token !== 'string' || !session.token || session.token.length > 8192 ||
      !integer(session.person_id) || !integer(session.applyment_id) || !/^\d{11}$/.test(session.cpf ?? '')) {
    throw new PortalClientError('PORTAL_AUTH_REQUIRED', 'Entre novamente para consultar sua matrícula.');
  }
  return structuredClone(session);
}

function requireInteractive(json, session, write = false) {
  const data = json?.data;
  if (data?.lgpd_popup || data?.lgpdCheckData?.lgpd_popup) {
    // A popup returned after button-click is not proof that no document was saved.
    throw new PortalClientError('PORTAL_LGPD_REQUIRED', 'Precisamos do seu consentimento no Portal do candidato antes de continuar.', { session, uncertain: write });
  }
}

function checkIdentity(data, session, { requireBoth = false, processId } = {}) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new PortalClientError('PORTAL_INVALID_RESPONSE', MESSAGE, { session });
  }
  for (const field of ['person_id', 'applyment_id']) {
    if ((requireBoth && !integer(data[field])) || (data[field] !== undefined && integer(data[field]) !== integer(session[field]))) {
      throw new PortalClientError('PORTAL_BINDING_MISMATCH', 'Não conseguimos confirmar a inscrição desta sessão. Entre novamente.', { session });
    }
  }
  const returnedCpf = data.cpf ?? data.CPF;
  if (returnedCpf !== undefined && String(returnedCpf).replace(/\D/g, '') !== session.cpf) {
    throw new PortalClientError('PORTAL_BINDING_MISMATCH', 'Não conseguimos confirmar o CPF desta inscrição. Entre novamente.', { session });
  }
  const returnedProcess = data.selective_process_id ?? data.processo_seletivo_id ?? data.process_id;
  if (returnedProcess !== undefined && returnedProcess !== null && processId && integer(returnedProcess) !== integer(processId)) {
    throw new PortalClientError('PORTAL_BINDING_MISMATCH', 'O processo retornado não corresponde à sua inscrição. Entre novamente.', { session });
  }
}

function captureCookies(headers, session, now = Date.now()) {
  const jar = session.cookies ??= {};
  const values = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : [];
  for (const raw of values) {
    const parts = raw.split(';'), first = parts.shift(), equal = first.indexOf('=');
    if (equal < 1) continue;
    const name = first.slice(0, equal).trim(), value = first.slice(equal + 1).trim();
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) || ['__proto__', 'constructor', 'prototype'].includes(name) || /[\r\n;]/.test(value) || value.length > 8192) continue;
    const cookie = { value, path: '/', secure: false };
    let allowed = true;
    for (const part of parts) {
      const position = part.indexOf('='), key = (position < 0 ? part : part.slice(0, position)).trim().toLowerCase();
      const attribute = position < 0 ? '' : part.slice(position + 1).trim();
      if (key === 'domain') {
        const domain = attribute.replace(/^\./, '').toLowerCase();
        if (!(HOST === domain || HOST.endsWith('.' + domain))) allowed = false;
      } else if (key === 'path' && attribute.startsWith('/')) cookie.path = attribute;
      else if (key === 'secure') cookie.secure = true;
      else if (key === 'max-age' && /^-?\d+$/.test(attribute)) cookie.maxAge = Number(attribute);
      else if (key === 'expires' && Number.isFinite(Date.parse(attribute))) cookie.expires = Date.parse(attribute);
    }
    if (!allowed) continue;
    if (cookie.maxAge !== undefined) cookie.expires = now + cookie.maxAge * 1000;
    delete cookie.maxAge;
    if ((cookie.expires ?? Infinity) <= now) delete jar[name];
    else if (Object.keys(jar).length < 100 || name in jar) jar[name] = cookie;
  }
}

function cookieHeaders(session, path) {
  const headers = {}, now = Date.now(), jar = session.cookies ?? {};
  const matches = [];
  for (const [name, cookie] of Object.entries(jar)) {
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) || typeof cookie?.value !== 'string' || /[\r\n;]/.test(cookie.value)) continue;
    if ((cookie.expires ?? Infinity) <= now) continue;
    const prefix = cookie.path || '/';
    if (path !== prefix && !path.startsWith(prefix.endsWith('/') ? prefix : prefix + '/')) continue;
    matches.push(`${name}=${cookie.value}`);
    if (name === 'XSRF-TOKEN') {
      try { const token = decodeURIComponent(cookie.value); if (!/[\r\n]/.test(token)) headers['X-XSRF-TOKEN'] = token; } catch {}
    }
  }
  const cookies = matches.join('; ');
  if (cookies.length > 16384) throw new PortalClientError('PORTAL_AUTH_REQUIRED', 'Sua sessão precisa ser renovada. Entre novamente.');
  if (cookies) headers.Cookie = cookies;
  return headers;
}

function birthDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? ''));
  if (!match) throw new PortalClientError('PORTAL_INVALID_LOGIN', 'Informe sua data de nascimento.');
  const [, year, month, day] = match, date = new Date(`${year}-${month}-${day}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== `${year}-${month}-${day}`) {
    throw new PortalClientError('PORTAL_INVALID_LOGIN', 'Confira sua data de nascimento.');
  }
  return `${day}/${month}/${year}`;
}

function loginValues(fields, cpf, birth) {
  if (!Array.isArray(fields) || !fields.length) throw new PortalClientError('PORTAL_INVALID_RESPONSE', 'O portal não disponibilizou os campos de acesso.');
  const values = { token_captcha: '' };
  let loginFound = false, birthFound = false;
  for (const field of fields) {
    const key = field?.formControlName;
    if (typeof key !== 'string' || !/^[A-Za-z][A-Za-z0-9_]*$/.test(key) || ['constructor', 'prototype', '__proto__', 'token_captcha'].includes(key)) {
      throw new PortalClientError('PORTAL_INVALID_RESPONSE', 'Os campos de acesso do portal precisam de conferência.');
    }
    const label = String(field.label ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    if (field.type === 'date' || key === 'dataNascimento' || /nasc/.test(label)) {
      if (birthFound) throw new PortalClientError('PORTAL_INVALID_RESPONSE');
      values[key] = birth; birthFound = true;
    } else if (field.type === 'cpf' || key === 'typeLogin' || /cpf|login|e-mail|email/.test(label)) {
      if (loginFound) throw new PortalClientError('PORTAL_INVALID_RESPONSE');
      values[key] = cpf; loginFound = true;
    } else throw new PortalClientError('PORTAL_LOGIN_STEP_REQUIRED', 'Seu acesso precisa de uma etapa adicional no Portal do candidato.');
  }
  if (!loginFound || !birthFound) throw new PortalClientError('PORTAL_INVALID_RESPONSE', 'Não foi possível identificar os campos de CPF e nascimento no portal.');
  return values;
}

export function createPortalClient({ fetcher = (...args) => fetch(...args), timeoutMs = 20000 } = {}) {
  async function request(session, endpoint, { body, form, write = false } = {}) {
    // Paths are private constants below: this client never sends its jar to another origin.
    const path = `/api/applyment/${endpoint}`;
    let response, json;
    const headers = { Accept: 'application/json', Origin: ORIGIN, Referer: `${ORIGIN}/${DOMAIN_PARAMS}/`, ...cookieHeaders(session, path) };
    if (!form) headers['Content-Type'] = 'application/json';
    try {
      response = await fetcher(ORIGIN + path, {
        method: 'POST', headers, body: form ?? JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs), redirect: 'error'
      });
      captureCookies(response.headers, session);
      if (response.redirected) throw new Error('Unexpected redirect');
      json = await response.json();
    } catch {
      throw new PortalClientError(write ? 'PORTAL_WRITE_UNCERTAIN' : 'PORTAL_UNAVAILABLE',
        write ? 'Não conseguimos confirmar o envio. Vamos conferir antes de enviar novamente.' : MESSAGE,
        { status: response?.status, uncertain: write, session });
    }
    if (!response.ok) {
      const uncertain = write && ![400, 401, 403, 404, 413, 422, 429].includes(response.status);
      throw new PortalClientError(uncertain ? 'PORTAL_WRITE_UNCERTAIN' : [401, 403].includes(response.status) ? 'PORTAL_AUTH_REQUIRED' : 'PORTAL_REQUEST_REJECTED',
        uncertain ? 'Não conseguimos confirmar o envio. Vamos conferir antes de enviar novamente.' : [401, 403].includes(response.status) ? 'Sua sessão de matrícula expirou. Entre novamente.' : 'O portal não aceitou esta operação. Confira sua matrícula antes de tentar novamente.',
        { status: response.status, uncertain, session });
    }
    if (!json || typeof json !== 'object' || Array.isArray(json) || typeof json.success !== 'boolean') {
      throw new PortalClientError(write ? 'PORTAL_WRITE_UNCERTAIN' : 'PORTAL_INVALID_RESPONSE', MESSAGE, { status: response.status, uncertain: write, session });
    }
    requireInteractive(json, session, write);
    if (json.data?.session === false || json.data?.session_error) {
      throw new PortalClientError('PORTAL_AUTH_REQUIRED', 'Sua sessão de matrícula expirou. Entre novamente.', { session, status: response.status });
    }
    if (write && json.data?.upload) {
      const upload = json.data.upload;
      const details = {
        component_id: String(upload.component_id ?? '').slice(0, 100),
        errors: (Array.isArray(upload.errors) ? upload.errors : []).map(error => ({ file_name: String(error?.file_name ?? '').slice(0, 100), error: String(error?.error ?? '').slice(0, 400) }))
      };
      // A batch can contain partial writes. Reconcile by reading before retrying.
      throw new PortalClientError('PORTAL_UPLOAD_REJECTED', 'O portal apontou um problema no arquivo. Vamos conferir o recebimento antes de tentar novamente.', { status: response.status, uncertain: true, session, details });
    }
    if (!json.success) {
      throw new PortalClientError(write ? 'PORTAL_WRITE_UNCERTAIN' : 'PORTAL_REQUEST_REJECTED', write ? 'Não conseguimos confirmar o envio. Vamos conferir antes de enviar novamente.' : MESSAGE, { status: response.status, uncertain: write, session });
    }
    return { json, session };
  }

  async function checkLogin(session, processId) {
    const result = await request(session, 'check-login', { body: { token: session.token } });
    checkIdentity(result.json.data, session, { requireBoth: true, processId });
    return result;
  }

  async function login(cpf, birth) {
    cpf = String(cpf ?? '').replace(/\D/g, '');
    if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) throw new PortalClientError('PORTAL_INVALID_LOGIN', 'Informe o CPF usado na inscrição.');
    const birthValue = birthDate(birth);
    const session = { token: '', domain: DOMAIN, domainParams: DOMAIN_PARAMS, cpf, cookies: {} };
    const settings = await request(session, 'settings/', { body: { domain: DOMAIN, token: null } });
    const config = settings.json.data;
    if (typeof config?.token !== 'string' || !config.token || config.token.length > 8192) throw new PortalClientError('PORTAL_INVALID_RESPONSE', MESSAGE, { session });
    session.token = config.token;
    if (config.captcha?.active && config.captcha?.captcha_portal_active) {
      throw new PortalClientError('PORTAL_CAPTCHA_REQUIRED', 'Este acesso precisa de uma verificação de segurança no Portal do candidato.', { session });
    }
    const info = await request(session, 'login-info', { body: { domain: DOMAIN, token: session.token } });
    const userData = loginValues(info.json.data?.fields, cpf, birthValue);
    const result = await request(session, 'login-portal', { body: {
      domain: DOMAIN, user_data: userData, error_captcha: false, token: session.token,
      substitute_id: null, session_id: null, hostClient: null
    } });
    const data = result.json.data;
    if (!integer(data?.person_id) || !integer(data?.applyment_id)) throw new PortalClientError('PORTAL_AUTH_REQUIRED', 'Não encontramos uma inscrição com esses dados.', { session });
    session.person_id = integer(data.person_id);
    session.applyment_id = integer(data.applyment_id);
    session.session_id = data.session_id === undefined || data.session_id === null ? null : String(data.session_id);
    if (data.selective_process_id !== undefined && data.selective_process_id !== null) {
      if (!integer(data.selective_process_id)) throw new PortalClientError('PORTAL_BINDING_MISMATCH', MESSAGE, { session });
      session.processo_seletivo_id = integer(data.selective_process_id);
    }
    checkIdentity(data, session);
    await checkLogin(session, session.processo_seletivo_id);
    return session;
  }

  async function readStep(input, { stepId, processId } = {}) {
    const session = authenticated(input), step = integer(stepId), process = integer(processId);
    if (!step || !process) throw new PortalClientError('PORTAL_INVALID_REQUEST', 'Não foi possível identificar a etapa da matrícula.');
    if (session.processo_seletivo_id && integer(session.processo_seletivo_id) !== process) throw new PortalClientError('PORTAL_BINDING_MISMATCH', MESSAGE, { session });
    await checkLogin(session, process);
    const result = await request(session, `getApplymentDataByStep/${step}`, { body: { execute_stage_query: 1, token: session.token, process_id: process } });
    const current = result.json.data?.steps?.currentStep;
    if (!current || integer(current.id) !== step) throw new PortalClientError('PORTAL_BINDING_MISMATCH', 'O portal retornou outra etapa. Atualize sua matrícula.', { session });
    checkIdentity(result.json.data, session, { processId: process });
    checkIdentity(current, session, { processId: process });
    session.processo_seletivo_id = process;
    return result;
  }

  async function readPortal(input) {
    const session = authenticated(input);
    await checkLogin(session, session.processo_seletivo_id);
    const result = await request(session, 'register-portal-data', { body: {
      token: session.token, domain: DOMAIN, substitute_id: null, session_id: null,
      hostClient: null, contact_id_crm: null, return_applyments: true
    } });
    checkIdentity(result.json.data, session, { processId: session.processo_seletivo_id });
    return result;
  }

  async function submitUpload(input, form) {
    const session = authenticated(input);
    if (!(form instanceof FormData)) throw new PortalClientError('PORTAL_INVALID_REQUEST', 'Selecione o documento para enviar.');
    const process = integer(form.get('selective_process_id'));
    if (!process || (session.processo_seletivo_id && process !== integer(session.processo_seletivo_id))) throw new PortalClientError('PORTAL_BINDING_MISMATCH', MESSAGE, { session });
    if (!integer(form.get('button_id')) || !integer(form.get('last_place_id'))) throw new PortalClientError('PORTAL_INVALID_REQUEST', 'Não foi possível identificar o envio desta etapa.');
    await checkLogin(session, process);
    form.set('token', session.token);
    return request(session, 'button-click', { form, write: true });
  }

  return { login, readStep, readPortal, submitUpload };
}
