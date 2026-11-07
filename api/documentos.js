// Documentos de inscrição pelo WhatsApp (DocumentPicker) usando a API da UniBalsas
// documentada em unibalsas.odoo.com/knowledge (artigos 743–746):
//   GET  /blip/inscritos/{idps}/{cpf}          → NUMEROINSCRICAO, CODCOLIGADA
//   GET  /rm/documents?codColigada&idps          → [{CODDOCUMENTO, DESCRICAO}]
//   POST /blip/documents?codColigada&idps&numeroInscricao&codDocumento&nomeArquivo  {base64}
// Limite do corpo: 1 MiB (≈ 750 KB de arquivo). O RM grava ENTREGUE=F; a conferência é manual.
import crypto from "node:crypto";

export const UB_API = process.env.UNIBALSAS_API_URL || "https://api.unibalsas.edu.br";
export const MAX_FILE_BYTES = 740 * 1024;
const MIME = { pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png" };

async function ub(path, { method = "GET", body, timeoutMs = 8000, fetcher = fetch } = {}) {
  const r = await fetcher(UB_API + path, {
    method, headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(timeoutMs)
  });
  let json = null; try { json = await r.json(); } catch {}
  console.info(JSON.stringify({ event: "unibalsas_api", path: path.split("?")[0].replace(/\/\d{11}$/, "/<cpf>"), http: r.status }));
  return { ok: r.ok, status: r.status, json };
}

export async function listDocuments(idps, codColigada = 1, opts) {
  const r = await ub(`/rm/documents?codColigada=${Number(codColigada)}&idps=${Number(idps)}`, opts);
  if (!r.ok) throw new Error("Não foi possível consultar os documentos do processo agora.");
  return (r.json?.resultado ?? []).map(d => ({ id: String(d.CODDOCUMENTO), title: String(d.DESCRICAO).slice(0, 30), descricao: String(d.DESCRICAO) }));
}

export async function findInscription(idps, cpf, opts) {
  const r = await ub(`/blip/inscritos/${Number(idps)}/${String(cpf).replace(/\D/g, "")}`, opts);
  if (r.status === 404) throw new Error("Ainda não localizamos sua inscrição no sistema acadêmico. Aguarde alguns minutos e tente novamente.");
  if (!r.ok) throw new Error("Não foi possível consultar sua inscrição agora. Tente novamente em instantes.");
  const rows = Array.isArray(r.json) ? r.json : [r.json];
  const row = rows.find(x => String(x?.IDPS) === String(idps)) ?? rows[0];
  if (!row?.NUMEROINSCRICAO) throw new Error("Sua inscrição ainda não tem número no sistema acadêmico.");
  return { numeroInscricao: String(row.NUMEROINSCRICAO), codColigada: String(row.CODCOLIGADA ?? 1) };
}

export function safeFileName(name, fallback = "documento.pdf") {
  const base = String(name ?? "").split(/[\\/]/).pop().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  const ext = base.split(".").pop()?.toLowerCase();
  return base && MIME[ext] ? base.slice(-80) : fallback;
}

// Descriptografia da mídia do DocumentPicker (WhatsApp Flows, "Media upload"):
// cdn_file = AES-256-CBC(ciphertext) + HMAC-SHA256(hmac_key, iv + ciphertext)[0..10]
export function decryptMedia(cdnFile, meta) {
  const buf = Buffer.from(cdnFile);
  const b64 = v => Buffer.from(String(v ?? ""), "base64");
  if (!crypto.timingSafeEqual(crypto.createHash("sha256").update(buf).digest(), b64(meta.encrypted_hash))) throw new Error("Arquivo recebido não confere. Envie novamente.");
  const ciphertext = buf.subarray(0, buf.length - 10), mac = buf.subarray(buf.length - 10), iv = b64(meta.iv);
  const expected = crypto.createHmac("sha256", b64(meta.hmac_key)).update(Buffer.concat([iv, ciphertext])).digest().subarray(0, 10);
  if (!crypto.timingSafeEqual(mac, expected)) throw new Error("Arquivo recebido não confere. Envie novamente.");
  const decipher = crypto.createDecipheriv("aes-256-cbc", b64(meta.encryption_key), iv);
  const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  if (!crypto.timingSafeEqual(crypto.createHash("sha256").update(plain).digest(), b64(meta.plaintext_hash))) throw new Error("Arquivo recebido não confere. Envie novamente.");
  return plain;
}

export async function downloadMedia(media, { fetcher = fetch, timeoutMs = 8000 } = {}) {
  const url = new URL(String(media?.cdn_url ?? ""));
  if (url.protocol !== "https:") throw new Error("Arquivo inválido. Envie novamente.");
  const r = await fetcher(url.href, { signal: AbortSignal.timeout(timeoutMs) });
  if (!r.ok) throw new Error("Não conseguimos baixar o arquivo enviado. Envie novamente.");
  return decryptMedia(Buffer.from(await r.arrayBuffer()), media.encryption_metadata ?? {});
}

export async function saveDocument({ idps, cpf, codDocumento, media, fetcher = fetch }) {
  if (!Array.isArray(media) || media.length !== 1) throw new Error("Anexe um arquivo para enviar.");
  const file = await downloadMedia(media[0], { fetcher });
  if (file.length > MAX_FILE_BYTES) throw new Error("Arquivo maior que 740 KB. Envie uma foto ou PDF menor (ex.: foto em qualidade média).");
  const insc = await findInscription(idps, cpf, { fetcher });
  const nome = safeFileName(media[0].file_name);
  const q = new URLSearchParams({ codColigada: insc.codColigada, idps: String(idps), numeroInscricao: insc.numeroInscricao, codDocumento: String(codDocumento), nomeArquivo: nome });
  const r = await ub(`/blip/documents?${q}`, { method: "POST", body: { base64: file.toString("base64") }, timeoutMs: 15000, fetcher });
  if (r.status === 413) throw new Error("Arquivo grande demais. Envie um arquivo menor que 740 KB.");
  if (r.status === 503) throw new Error("O sistema acadêmico está recebendo muitos envios. Aguarde um minuto e envie novamente.");
  if (!r.ok || r.json?.status !== "ok") throw new Error("O sistema acadêmico não confirmou o recebimento. Confira no Portal do candidato antes de reenviar.");
  return { primaryKey: String(r.json.primaryKey ?? ""), nomeArquivo: nome };
}
