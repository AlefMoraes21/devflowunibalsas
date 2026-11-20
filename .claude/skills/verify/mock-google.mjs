// Preload: simula metadata/Firestore/Cloud Tasks do Google e um CDN de mídia, em memória.
// Rubeus/portal/ViaCEP seguem reais. Blip fica sem configuração (só log).
import http from 'node:http';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

const REPO = process.env.VERIFY_REPO;
const { pack, unpack, workerSignature } = await import(pathToFileURL(REPO + '/api/cloud-store.js').href);

const realFetch = globalThis.fetch;
const docs = new Map(); // key col/id -> {fields, updateTime}
const tasks = [];
const media = new Map();
const outside = [];
let seq = 0;
const nextTime = () => new Date(Date.UTC(2026, 0, 1) + (++seq)).toISOString().replace('Z', `${String(seq).padStart(6, '0')}Z`);
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url);
  const method = (init.method || 'GET').toUpperCase();
  if (url.hostname === 'metadata.google.internal') return json(200, { access_token: 'local', expires_in: 3600 });
  // ID token do Google: "verify-<email>" vale para esse e-mail (audiência do gcloud); o resto é recusado.
  if (url.hostname === 'oauth2.googleapis.com' && url.pathname === '/tokeninfo') {
    const t = url.searchParams.get('id_token') ?? '';
    outside.push({ host: url.hostname, path: '/tokeninfo', shim: true });
    if (!t.startsWith('verify-')) return json(400, { error: 'invalid_token' });
    return json(200, { iss: 'https://accounts.google.com', email: t.slice(7).replace('_at_', '@'), email_verified: 'true', aud: '32555940559.apps.googleusercontent.com' });
  }
  if (url.hostname === 'firestore.googleapis.com' && url.pathname.endsWith(':runQuery')) {
    const q = JSON.parse(init.body).structuredQuery;
    const col = q.from[0].collectionId, campo = q.where.fieldFilter.field.fieldPath, antes = q.where.fieldFilter.value.timestampValue;
    const out = [...docs].filter(([k, d]) => k.startsWith(col + '/') && d.fields[campo] && d.fields[campo].timestampValue < antes)
      .sort((a, b) => a[1].fields[campo].timestampValue.localeCompare(b[1].fields[campo].timestampValue)).slice(0, q.limit ?? 100)
      .map(([k, d]) => ({ document: { name: 'projects/local/databases/local/documents/' + k, fields: d.fields, updateTime: d.updateTime }, readTime: nextTime() }));
    return json(200, out.length ? out : [{ readTime: nextTime() }]);
  }
  if (url.hostname === 'firestore.googleapis.com') {
    const parts = url.pathname.split('/documents/')[1].split('/');
    if (method === 'POST') {
      const key = parts[0] + '/' + url.searchParams.get('documentId');
      if (docs.has(key)) return json(409, { error: { status: 'ALREADY_EXISTS' } });
      const body = JSON.parse(init.body);
      const d = { fields: body.fields, updateTime: nextTime() };
      docs.set(key, d); return json(200, d);
    }
    const key = parts[0] + '/' + parts[1];
    if (method === 'GET') return docs.has(key) ? json(200, docs.get(key)) : json(404, { error: { status: 'NOT_FOUND' } });
    if (method === 'PATCH') {
      const want = url.searchParams.get('currentDocument.updateTime');
      const cur = docs.get(key);
      if (!cur || (want && cur.updateTime !== want)) return json(400, { error: { status: 'FAILED_PRECONDITION' } });
      const d = { fields: JSON.parse(init.body).fields, updateTime: nextTime() };
      docs.set(key, d); return json(200, d);
    }
  }
  if (url.hostname === 'cloudtasks.googleapis.com') {
    const t = JSON.parse(init.body).task;
    const body = JSON.parse(Buffer.from(t.httpRequest.body, 'base64').toString());
    tasks.push({ name: t.name.split('/').pop(), body, headers: t.httpRequest.headers, scheduleTime: t.scheduleTime ?? null, at: new Date().toISOString() });
    return json(200, {});
  }
  if (url.hostname === 'mock-cdn.test') {
    const b = media.get(url.pathname.slice(1));
    return b ? new Response(b, { status: 200, headers: { 'Content-Type': 'application/octet-stream' } }) : new Response('', { status: 404 });
  }
  // API de parceiro do Rubeus (precisa do RBS_TOKEN, que só existe no Cloud Run): login e /portal
  // respondidos com os dados REAIS do site (login-portal + register-portal-data) do mesmo candidato.
  if (url.hostname === 'admin.portal.apprbs.com.br') {
    const site = (globalThis.__site ??= (await import(pathToFileURL(REPO + '/api/portal-site.js').href)).createPortalSite());
    const sessoes = (globalThis.__sessoes ??= new Map());
    const p = url.pathname.replace('/api/v1', '');
    const b = init.body ? JSON.parse(init.body) : {};
    outside.push({ host: url.hostname, method, path: p, shim: true });
    if (p === '/login') {
      const [cpf, data] = b.user_data.map(x => x.value);
      const [d, m, y] = data.split('/');
      const s = await site.entrar(cpf, `${y}-${m}-${d}`);
      if (!s.applyment_id || !s.session_id) return json(401, { success: false });
      sessoes.set(s.token + ':' + s.applyment_id, s);
      return json(200, { success: true, data: { token: s.token + ':' + s.applyment_id, person_id: s.person_id, applyment_id: s.applyment_id } });
    }
    if (p === '/portal') {
      const s = sessoes.get(b.token);
      if (!s) return json(401, { success: false });
      const t0 = Date.now();
      const { processo, stages } = await site.inscricao(s);
      outside.push({ shim_portal_ms: Date.now() - t0 });
      return json(200, { success: true, data: { current_process: { id: processo, stages } } });
    }
    return json(404, { success: false });
  }
  if (/msging\.net|blip/i.test(url.hostname)) { outside.push({ host: url.hostname, method, blocked: true }); return json(500, { blocked: true }); }
  outside.push({ host: url.hostname, method, path: url.pathname.slice(0, 80) });
  return realFetch(input, init);
};

// Mesmos campos que api/cloud-store.js grava (só datas fora da criptografia).
const iso = v => ({ timestampValue: new Date(v).toISOString() });
const campos = rec => ({ blob: { stringValue: pack(rec) }, expireAt: iso(rec.expires ?? Date.now() + 86400000),
  ...(Number.isFinite(rec.proxima_acao_em) ? { proximaAcaoEm: iso(rec.proxima_acao_em) } : {}),
  ...(rec.status === 'falhou' && Number.isFinite(rec.falhou_em) ? { falhouEm: iso(rec.falhou_em) } : {}) });

function makeMedia(name, plain) {
  const key = crypto.randomBytes(32), hmacKey = crypto.randomBytes(32), iv = crypto.randomBytes(16);
  const c = crypto.createCipheriv('aes-256-cbc', key, iv);
  const ct = Buffer.concat([c.update(plain), c.final()]);
  const mac = crypto.createHmac('sha256', hmacKey).update(Buffer.concat([iv, ct])).digest().subarray(0, 10);
  const file = Buffer.concat([ct, mac]);
  const id = crypto.randomBytes(8).toString('hex');
  media.set(id, file);
  const b = x => x.toString('base64');
  return { file_name: name, media_id: id, cdn_url: `https://mock-cdn.test/${id}`, encryption_metadata: { encrypted_hash: b(crypto.createHash('sha256').update(file).digest()), iv: b(iv), encryption_key: b(key), hmac_key: b(hmacKey), plaintext_hash: b(crypto.createHash('sha256').update(plain).digest()) } };
}

const PORT = Number(process.env.PORT || 8080);
http.createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c);
  const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
  const u = new URL(req.url, 'http://x');
  const send = (s, b) => { res.writeHead(s, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(b, null, 1)); };
  try {
    if (u.pathname === '/tasks') return send(200, tasks.map((t, i) => ({ i, tipo: t.body.tipo ?? 'job', id: t.body.id.slice(0, 10), scheduleTime: t.scheduleTime, at: t.at })));
    if (u.pathname === '/dispatch') {
      const i = tasks.findIndex(t => (body.tipo ? t.body.tipo === body.tipo : true) && (body.id ? t.body.id.startsWith(body.id) : true));
      if (i < 0) return send(404, { erro: 'sem tarefa' });
      const [t] = tasks.splice(i, 1);
      const t0 = Date.now();
      const r = await realFetch(`http://127.0.0.1:${PORT}/internal/flow-worker`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Flow-Worker-Signature': t.headers['X-Flow-Worker-Signature'] }, body: JSON.stringify(t.body) });
      return send(200, { tipo: t.body.tipo, id: t.body.id.slice(0, 10), http: r.status, ms: Date.now() - t0 });
    }
    if (u.pathname === '/store') {
      const col = u.searchParams.get('col');
      const out = [];
      for (const [k, d] of docs) if (!col || k.startsWith(col + '/')) out.push({ key: k.split('/')[0] + '/' + k.split('/')[1].slice(0, 10), fora: Object.keys(d.fields), record: unpack(d.fields.blob.stringValue) });
      return send(200, out);
    }
    if (u.pathname === '/put') {
      const rec = body.record;
      docs.set(body.col + '/' + body.id, { fields: campos(rec), updateTime: nextTime() });
      return send(200, { ok: true });
    }
    // Faz o tempo passar para a varredura: recua em `ms` a próxima ação (e a data da falha) da coleção.
    if (u.pathname === '/age') {
      let n = 0;
      for (const [k, d] of docs) if (k.startsWith(body.col + '/')) {
        const rec = unpack(d.fields.blob.stringValue);
        if (Number.isFinite(rec.proxima_acao_em)) rec.proxima_acao_em -= body.ms;
        if (Number.isFinite(rec.falhou_em)) rec.falhou_em -= body.ms;
        docs.set(k, { fields: campos(rec), updateTime: nextTime() }); n++;
      }
      return send(200, { ok: true, n });
    }
    if (u.pathname === '/clear-tasks') { const n = tasks.length; tasks.length = 0; return send(200, { ok: true, removidas: n }); }
    if (u.pathname === '/task') { tasks.push({ name: 'manual', body: { id: body.id, tipo: body.tipo }, headers: { 'X-Flow-Worker-Signature': workerSignature(body.id) }, scheduleTime: null, at: new Date().toISOString() }); return send(200, { ok: true }); }
    if (u.pathname === '/env') { Object.assign(process.env, body); return send(200, { ok: true }); }
    if (u.pathname === '/media') return send(200, makeMedia(body.name || 'teste.pdf', Buffer.from(body.text || '%PDF-1.4\n% teste\n')));
    if (u.pathname === '/outside') return send(200, outside);
    send(404, {});
  } catch (e) { send(500, { erro: String(e?.stack ?? e) }); }
}).listen(Number(process.env.CONTROL_PORT || 8099), '127.0.0.1');
console.log('[mock-google] ativo');
