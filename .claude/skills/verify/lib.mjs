// Cliente "Meta": criptografa como o WhatsApp Flows e confere a resposta contra o JSON do Flow publicado.
import crypto from 'node:crypto';
import fs from 'node:fs';
const DIR = new URL('.', import.meta.url);
const pub = fs.readFileSync(new URL('pub.pem', DIR), 'utf8');
const REPO = process.env.VERIFY_REPO;
const FLOW = JSON.parse(fs.readFileSync(REPO + '/flows/etapa1-vestibular.json', 'utf8'));
const SCREENS = Object.fromEntries(FLOW.screens.map(s => [s.id, s]));
export const BASE = 'http://127.0.0.1:' + (process.env.PORT || 8080);
export const CTRL = 'http://127.0.0.1:' + (process.env.CONTROL_PORT || 8099);

export async function call(screen, action, data = {}, flow_token = 'verify-token-1', path = '/api/flow') {
  const aes = crypto.randomBytes(16), iv = crypto.randomBytes(16);
  const body = JSON.stringify({ version: '3.0', action, screen, data, flow_token });
  const c = crypto.createCipheriv('aes-128-gcm', aes, iv);
  const enc = Buffer.concat([c.update(body, 'utf8'), c.final(), c.getAuthTag()]);
  const key = crypto.publicEncrypt({ key: pub, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, aes);
  const t0 = Date.now();
  const r = await fetch(BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ encrypted_flow_data: enc.toString('base64'), encrypted_aes_key: key.toString('base64'), initial_vector: iv.toString('base64') }) });
  const ms = Date.now() - t0;
  const txt = await r.text();
  if (r.status !== 200) return { http: r.status, ms, raw: txt };
  const buf = Buffer.from(txt, 'base64');
  const d = crypto.createDecipheriv('aes-128-gcm', aes, Buffer.from(iv.map(b => b ^ 0xff)));
  d.setAuthTag(buf.subarray(-16));
  const out = JSON.parse(Buffer.concat([d.update(buf.subarray(0, -16)), d.final()]).toString());
  return { http: 200, ms, ...out, problemas: conferir(out) };
}

// A resposta só pode trazer as chaves declaradas no "data" da tela e com o tipo declarado.
function conferir(out) {
  if (!out?.screen || out.screen === 'SUCCESS') return [];
  const s = SCREENS[out.screen];
  if (!s) return ['tela inexistente no JSON: ' + out.screen];
  const decl = s.data ?? {};
  const p = [];
  for (const [k, v] of Object.entries(out.data ?? {})) {
    if (!(k in decl)) { p.push('chave não declarada: ' + k); continue; }
    const t = decl[k].type, real = Array.isArray(v) ? 'array' : typeof v;
    if (t && t !== real) p.push(`tipo de ${k}: JSON=${t} resposta=${real}`);
  }
  for (const k of Object.keys(decl)) if (!(k in (out.data ?? {}))) p.push('chave declarada ausente: ' + k);
  return p;
}

export function mostrar(rotulo, r, extra = []) {
  const d = r.data ?? {};
  const resumo = {};
  for (const [k, v] of Object.entries(d)) {
    if (k === 'estado') continue;
    if (Array.isArray(v)) resumo[k] = v.length > 6 ? `[${v.length} itens]` : v.map(x => x.title ?? x['main-content']?.title ?? x);
    else if (typeof v === 'string' && v.length > 160) resumo[k] = v.slice(0, 160) + '…';
    else resumo[k] = v;
  }
  for (const k of extra) resumo[k] = d[k];
  console.log(`\n### ${rotulo}\n→ http ${r.http} · ${r.ms} ms · tela ${r.screen ?? '-'}${r.problemas?.length ? ' · PROBLEMAS: ' + r.problemas.join('; ') : ' · contrato do JSON ok'}`);
  if (r.raw) console.log(r.raw.slice(0, 300));
  console.log(JSON.stringify(resumo, null, 1).slice(0, 2500));
}
export const ctrl = async (p, body) => (await fetch(CTRL + p, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {})).json();
