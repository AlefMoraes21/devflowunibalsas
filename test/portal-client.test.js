import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPortalClient, PortalClientError } from '../api/portal-client.js';

const cpf = '11144477735';
const session = () => ({ token: 'portal-settings-token', domain: 'vestibular.unibalsas.edu.br/presencial', domainParams: 'presencial', cpf, person_id: '9985265', applyment_id: '14083470', processo_seletivo_id: '20383', cookies: {} });
const identity = () => ({ person_id: '9985265', applyment_id: '14083470', CPF: cpf });
const fields = [{ type: 'text', label: 'CPF ou EMAIL', formControlName: 'typeLogin' }, { type: 'date', label: 'Data de Nascimento', formControlName: 'dataNascimento' }];

function fixture(overrides = {}) {
  const calls = [];
  const fetcher = async (url, options) => {
    const path = new URL(String(url)).pathname;
    assert.equal(new URL(String(url)).origin, 'https://vestibular.unibalsas.edu.br');
    assert.equal(options.method, 'POST');
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal instanceof AbortSignal);
    calls.push({ path, options, body: options.body instanceof FormData ? options.body : JSON.parse(options.body) });
    if (overrides[path]) return overrides[path](calls.at(-1));
    if (path.endsWith('/settings/')) return Response.json({ success: true, data: { token: 'portal-settings-token' } });
    if (path.endsWith('/login-info')) return Response.json({ success: true, data: { fields } });
    if (path.endsWith('/login-portal')) return Response.json({ success: true, data: { ...identity(), session_id: 'distinct-session-id', selective_process_id: '20383' } });
    if (path.endsWith('/check-login')) return Response.json({ success: true, data: identity() });
    if (path.includes('/getApplymentDataByStep/')) return Response.json({ success: true, data: { steps: { currentStep: { id: '300671', selective_process_id: '20383', content: {} } } } });
    if (path.endsWith('/register-portal-data')) return Response.json({ success: true, data: { session: true, stages: [] } });
    if (path.endsWith('/button-click')) return Response.json({ success: true, data: { same_place: true } });
    throw new Error('Unexpected fixture request');
  };
  return { calls, client: createPortalClient({ fetcher, timeoutMs: 1000 }) };
}

function uploadForm() {
  const form = new FormData();
  form.set('token', 'untrusted-token');
  form.set('selective_process_id', '20383');
  form.set('button_id', '3940449');
  form.set('last_place_id', '300671');
  form.set('data', JSON.stringify([{ type: 'upload', value: [{ CODIGO: 'fixture-id', value: ['file_0'] }] }]));
  form.set('file_0', new Blob(['%PDF-1.7\nmock'], { type: 'application/pdf' }), 'teste.pdf');
  return form;
}

test('portal login follows dynamic fields and preserves settings token instead of session_id', async () => {
  const f = fixture(), result = await f.client.login('111.444.777-35', '2007-03-15');
  assert.deepEqual(f.calls.map(c => c.path), ['/api/applyment/settings/', '/api/applyment/login-info', '/api/applyment/login-portal', '/api/applyment/check-login']);
  assert.deepEqual(f.calls[0].body, { domain: session().domain, token: null });
  assert.deepEqual(f.calls[1].body, { domain: session().domain, token: 'portal-settings-token' });
  assert.deepEqual(f.calls[2].body, {
    domain: session().domain, user_data: { token_captcha: '', typeLogin: cpf, dataNascimento: '15/03/2007' }, error_captcha: false,
    token: 'portal-settings-token', substitute_id: null, session_id: null, hostClient: null
  });
  assert.deepEqual(f.calls[3].body, { token: 'portal-settings-token' });
  assert.equal(result.token, 'portal-settings-token');
  assert.equal(result.session_id, 'distinct-session-id');
  assert.equal(result.person_id, '9985265');
  assert.equal(result.applyment_id, '14083470');
  assert.equal(result.processo_seletivo_id, '20383');
  assert.equal(result.cpf, cpf);
  assert.ok(!JSON.stringify(result).includes('2007-03-15'));
});

test('cookie jar captures same-origin cookies, sends XSRF and ignores foreign domains', async () => {
  const f = fixture({ '/api/applyment/settings/': () => {
    const headers = new Headers();
    headers.append('Set-Cookie', 'laravel_session=opaque; Path=/; Secure; HttpOnly');
    headers.append('Set-Cookie', 'XSRF-TOKEN=token%2Fvalue; Path=/; Secure');
    headers.append('Set-Cookie', 'foreign=secret; Domain=evil.example; Path=/');
    headers.append('Set-Cookie', 'private=other; Path=/administrativo');
    return Response.json({ success: true, data: { token: 'portal-settings-token' } }, { headers });
  } });
  const result = await f.client.login(cpf, '2007-03-15');
  assert.match(f.calls[1].options.headers.Cookie, /laravel_session=opaque/);
  assert.equal(f.calls[1].options.headers['X-XSRF-TOKEN'], 'token/value');
  assert.ok(!f.calls[1].options.headers.Cookie.includes('foreign'));
  assert.ok(!f.calls[1].options.headers.Cookie.includes('private'));
  assert.equal(result.cookies.laravel_session.value, 'opaque');
  assert.equal(result.cookies.foreign, undefined);
});

test('cookie deletion and rotation persist in the returned serializable session', async () => {
  const f = fixture({ '/api/applyment/login-info': () => {
    const headers = new Headers();
    headers.append('Set-Cookie', 'old=gone; Path=/; Max-Age=0');
    headers.append('Set-Cookie', 'fresh=new; Path=/; Secure');
    return Response.json({ success: true, data: { fields } }, { headers });
  }, '/api/applyment/settings/': () => Response.json({ success: true, data: { token: 'portal-settings-token' } }, { headers: { 'Set-Cookie': 'old=previous; Path=/' } }) });
  const result = await f.client.login(cpf, '2007-03-15');
  assert.equal(result.cookies.old, undefined);
  assert.equal(result.cookies.fresh.value, 'new');
  assert.match(f.calls[2].options.headers.Cookie, /fresh=new/);
  assert.ok(!f.calls[2].options.headers.Cookie.includes('old='));
  assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
});

test('active CAPTCHA stops login without attempting a bypass', async () => {
  const f = fixture({ '/api/applyment/settings/': () => Response.json({ success: true, data: { token: 'portal-settings-token', captcha: { active: true, captcha_portal_active: true } } }) });
  await assert.rejects(f.client.login(cpf, '2007-03-15'), error => error.code === 'PORTAL_CAPTCHA_REQUIRED');
  assert.equal(f.calls.length, 1);
});

test('LGPD response requires the supported consent step', async () => {
  const f = fixture({ '/api/applyment/login-portal': () => Response.json({ success: true, data: { ...identity(), lgpd_popup: { id: 'fixture' } } }) });
  await assert.rejects(f.client.login(cpf, '2007-03-15'), error => error.code === 'PORTAL_LGPD_REQUIRED');
  assert.equal(f.calls.length, 3);
});

test('invalid CPF or calendar date is rejected before network access', async () => {
  const f = fixture();
  for (const [doc, birth] of [['1', '2007-03-15'], ['00000000000', '2007-03-15'], [cpf, '2007-02-29'], [cpf, '15/03/2007']]) {
    await assert.rejects(f.client.login(doc, birth), error => error.code === 'PORTAL_INVALID_LOGIN');
  }
  assert.equal(f.calls.length, 0);
});

test('login rejects unknown dynamic fields instead of inventing parameters', async () => {
  const f = fixture({ '/api/applyment/login-info': () => Response.json({ success: true, data: { fields: [...fields, { type: 'text', label: 'Senha', formControlName: 'password' }] } }) });
  await assert.rejects(f.client.login(cpf, '2007-03-15'), error => error.code === 'PORTAL_LOGIN_STEP_REQUIRED');
  assert.equal(f.calls.length, 2);
});

test('login requires consistent person, application and CPF from check-login', async () => {
  for (const changed of [{ applyment_id: '999' }, { person_id: '999' }, { CPF: '52998224725' }, { person_id: undefined }, { applyment_id: undefined }]) {
    const f = fixture({ '/api/applyment/check-login': () => Response.json({ success: true, data: { ...identity(), ...changed } }) });
    await assert.rejects(f.client.login(cpf, '2007-03-15'), error => error.code === 'PORTAL_BINDING_MISMATCH');
  }
});

test('readStep checks session and exact step then returns updated session with raw JSON', async () => {
  const f = fixture(), original = session();
  const result = await f.client.readStep(original, { stepId: '300671', processId: '20383' });
  assert.equal(result.json.data.steps.currentStep.id, '300671');
  assert.deepEqual(f.calls.map(c => c.path), ['/api/applyment/check-login', '/api/applyment/getApplymentDataByStep/300671']);
  assert.deepEqual(f.calls[1].body, { execute_stage_query: 1, token: original.token, process_id: '20383' });
  assert.equal(result.session.processo_seletivo_id, '20383');
  assert.notEqual(result.session, original);
});

test('readStep rejects a different process or returned step', async () => {
  const f = fixture();
  await assert.rejects(f.client.readStep(session(), { stepId: '300671', processId: '20385' }), error => error.code === 'PORTAL_BINDING_MISMATCH');
  assert.equal(f.calls.length, 0);
  for (const changed of [{ id: '300665' }, { selective_process_id: '20385' }]) {
    const g = fixture({ '/api/applyment/getApplymentDataByStep/300671': () => Response.json({ success: true, data: { steps: { currentStep: { id: '300671', selective_process_id: '20383', ...changed } } } }) });
    await assert.rejects(g.client.readStep(session(), { stepId: '300671', processId: '20383' }), error => error.code === 'PORTAL_BINDING_MISMATCH');
  }
});

test('readPortal uses the portal contract and rejects expired session', async () => {
  const f = fixture();
  const result = await f.client.readPortal(session());
  assert.deepEqual(f.calls[1].body, { token: session().token, domain: session().domain, substitute_id: null, session_id: null, hostClient: null, contact_id_crm: null, return_applyments: true });
  assert.equal(result.json.data.session, true);
  const g = fixture({ '/api/applyment/register-portal-data': () => Response.json({ success: true, data: { session: false } }) });
  await assert.rejects(g.client.readPortal(session()), error => error.code === 'PORTAL_AUTH_REQUIRED');
});

test('multipart upload binds session token, keeps bytes and lets runtime generate boundary', async () => {
  const f = fixture(), form = uploadForm(), result = await f.client.submitUpload(session(), form);
  assert.equal(result.json.success, true);
  assert.equal(f.calls.length, 2);
  const call = f.calls[1];
  assert.equal(call.path, '/api/applyment/button-click');
  assert.equal(call.options.headers['Content-Type'], undefined);
  assert.equal(call.body.get('token'), session().token);
  assert.equal(call.body.get('file_0').name, 'teste.pdf');
  assert.equal(await call.body.get('file_0').text(), '%PDF-1.7\nmock');
  assert.match(call.body.get('data'), /file_0/);
});

test('upload rechecks person binding before any write', async () => {
  const f = fixture({ '/api/applyment/check-login': () => Response.json({ success: true, data: { ...identity(), applyment_id: '999' } }) });
  await assert.rejects(f.client.submitUpload(session(), uploadForm()), error => error.code === 'PORTAL_BINDING_MISMATCH');
  assert.equal(f.calls.length, 1);
});

test('success:true with data.upload exposes file errors and requires reconciliation', async () => {
  const f = fixture({ '/api/applyment/button-click': () => Response.json({ success: true, data: { upload: { component_id: '38733', errors: [{ file_name: 'file_0', error: 'Formato inválido' }] } } }) });
  await assert.rejects(f.client.submitUpload(session(), uploadForm()), error => {
    assert.ok(error instanceof PortalClientError);
    assert.equal(error.code, 'PORTAL_UPLOAD_REJECTED');
    assert.equal(error.uncertain, true);
    assert.equal(error.details.errors[0].file_name, 'file_0');
    return true;
  });
  assert.equal(f.calls.filter(c => c.path.endsWith('/button-click')).length, 1);
});

test('LGPD popup returned after upload remains uncertain and never retries the POST', async () => {
  const f = fixture({ '/api/applyment/button-click': () => Response.json({ success: true, data: { lgpd_popup: { id: 'fixture' } } }) });
  await assert.rejects(f.client.submitUpload(session(), uploadForm()), error => {
    assert.equal(error.code, 'PORTAL_LGPD_REQUIRED');
    assert.equal(error.uncertain, true);
    return true;
  });
  assert.equal(f.calls.filter(c => c.path.endsWith('/button-click')).length, 1);
});

test('upload timeout, malformed JSON, false success or server error is uncertain without retry', async () => {
  for (const response of [
    () => { throw new DOMException('timed out', 'TimeoutError'); },
    () => new Response('<html>upstream failure</html>'),
    () => Response.json({ success: false, data: 'Resultado não confirmado' }),
    () => Response.json({ error: 'upstream' }, { status: 502 })
  ]) {
    const f = fixture({ '/api/applyment/button-click': response });
    await assert.rejects(f.client.submitUpload(session(), uploadForm()), error => error.uncertain === true && error.code === 'PORTAL_WRITE_UNCERTAIN');
    assert.equal(f.calls.filter(c => c.path.endsWith('/button-click')).length, 1);
  }
});

test('HTTP 403 before write returns a typed auth error and retains cookie changes', async () => {
  const f = fixture({ '/api/applyment/check-login': () => Response.json({ success: false }, { status: 403, headers: { 'Set-Cookie': 'fresh=updated; Path=/' } }) });
  await assert.rejects(f.client.submitUpload(session(), uploadForm()), error => {
    assert.equal(error.code, 'PORTAL_AUTH_REQUIRED');
    assert.equal(error.uncertain, false);
    assert.equal(error.session.cookies.fresh.value, 'updated');
    return true;
  });
  assert.equal(f.calls.length, 1);
});

test('invalid serialized session or form never sends credentials or files', async () => {
  const f = fixture();
  await assert.rejects(f.client.readPortal({ ...session(), domain: 'evil.example' }), error => error.code === 'PORTAL_AUTH_REQUIRED');
  await assert.rejects(f.client.readStep(session(), { stepId: '../secret', processId: '20383' }), error => error.code === 'PORTAL_INVALID_REQUEST');
  const wrong = uploadForm(); wrong.set('selective_process_id', '20385');
  await assert.rejects(f.client.submitUpload(session(), wrong), error => error.code === 'PORTAL_BINDING_MISMATCH');
  assert.equal(f.calls.length, 0);
});
