// Documentos de inscrição: artigos 743–746 da Central de Ajuda UniBalsas.
// O endpoint /blip/documents grava ENTREGUE=F; isso não representa aprovação.
import crypto from "node:crypto";

export const UB_API = process.env.UNIBALSAS_API_URL || "https://api.unibalsas.edu.br";
// 740 KiB -> 1,010,348 bytes de JSON Base64, abaixo de 1 MiB na API acadêmica.
export const MAX_FILE_BYTES = 740 * 1024;
export const MAX_PORTAL_FILE_BYTES = 5 * 1024 * 1024;
const MIME = { pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png" };
const INTEGRITY_ERROR = "Arquivo recebido não confere. Envie novamente.";
const SIZE_ERROR = "Arquivo maior que 740 KB. Envie uma foto ou PDF menor (ex.: foto em qualidade média).";

export class DocumentWriteUncertainError extends Error {
  constructor() {
    super("Não conseguimos confirmar o envio neste momento. Confira a situação no Portal do candidato antes de enviar novamente.");
    this.code = "DOCUMENT_WRITE_UNCERTAIN";
    this.uncertain = true;
  }
}

function positiveInteger(value) {
  const n = Number(value);
  if (!/^\d+$/.test(String(value)) || !Number.isInteger(n) || n < 1 || n > 2147483647) throw new Error("Processo ou documento inválido. Consulte sua inscrição novamente.");
  return String(n);
}

async function ub(path, { method = "GET", body, timeoutMs = 8000, fetcher = fetch } = {}) {
  const r = await fetcher(UB_API + path, {
    method, headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(timeoutMs), redirect: "error"
  });
  let json = null; try { json = await r.json(); } catch {}
  console.info(JSON.stringify({ event: "unibalsas_api", path: path.split("?")[0].replace(/\/\d{11}$/, "/<cpf>"), http: r.status }));
  return { ok: r.ok, status: r.status, json };
}

export async function listDocuments(idps, codColigada = 1, opts) {
  const r = await ub(`/rm/documents?codColigada=${positiveInteger(codColigada)}&idps=${positiveInteger(idps)}`, opts);
  if (!r.ok || !Array.isArray(r.json?.resultado)) throw new Error("Não foi possível consultar os documentos do processo agora.");
  return r.json.resultado.map(d => {
    if (!d || !String(d.DESCRICAO ?? "").trim()) throw new Error("Não foi possível consultar os documentos do processo agora.");
    return { id: positiveInteger(d.CODDOCUMENTO), title: String(d.DESCRICAO).slice(0, 30), descricao: String(d.DESCRICAO) };
  });
}

export async function findInscription(idps, cpf, opts) {
  const process = positiveInteger(idps), digits = String(cpf).replace(/\D/g, "");
  if (!/^\d{11}$/.test(digits)) throw new Error("Informe o CPF usado na inscrição (11 números).");
  const r = await ub(`/blip/inscritos/${process}/${digits}`, opts);
  if (r.status === 404) throw new Error("Ainda não localizamos sua inscrição no sistema acadêmico. Aguarde alguns minutos e tente novamente.");
  if (!r.ok) throw new Error("Não foi possível consultar sua inscrição agora. Tente novamente em instantes.");
  const rows = Array.isArray(r.json) ? r.json : [r.json];
  const matches = rows.filter(x => String(x?.IDPS) === process && String(x?.CPF ?? "").replace(/\D/g, "") === digits && String(x?.CODCOLIGADA) === "1");
  const inscriptions = new Map(matches.filter(x => /^\d+$/.test(String(x.NUMEROINSCRICAO)) && Number(x.NUMEROINSCRICAO) > 0).map(x => [String(x.NUMEROINSCRICAO), x]));
  if (inscriptions.size !== 1) throw new Error("Não foi possível identificar uma única inscrição para este CPF e processo. Confira no Portal do candidato.");
  const row = [...inscriptions.values()][0];
  return { numeroInscricao: String(row.NUMEROINSCRICAO), codColigada: "1" };
}

export function safeFileName(name, fallback = "documento.pdf") {
  const base = String(name ?? "").split(/[\\/]/).pop().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  const ext = base.split(".").pop()?.toLowerCase();
  return base && MIME[ext] ? base.slice(-80) : fallback;
}

// AES-256-CBC(ciphertext) + HMAC-SHA256(hmac_key, iv + ciphertext)[0..10].
export function decryptMedia(cdnFile, meta = {}) {
  try {
    const buf = Buffer.from(cdnFile);
    const b64 = (value, length) => {
      if (typeof value !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new Error();
      const decoded = Buffer.from(value, "base64");
      if (decoded.length !== length) throw new Error();
      return decoded;
    };
    const encryptedHash = b64(meta.encrypted_hash, 32), plainHash = b64(meta.plaintext_hash, 32);
    const key = b64(meta.encryption_key, 32), hmacKey = b64(meta.hmac_key, 32), iv = b64(meta.iv, 16);
    if (buf.length < 26 || (buf.length - 10) % 16 !== 0 || !crypto.timingSafeEqual(crypto.createHash("sha256").update(buf).digest(), encryptedHash)) throw new Error();
    const ciphertext = buf.subarray(0, -10), mac = buf.subarray(-10);
    const expected = crypto.createHmac("sha256", hmacKey).update(Buffer.concat([iv, ciphertext])).digest().subarray(0, 10);
    if (!crypto.timingSafeEqual(mac, expected)) throw new Error();
    const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
    const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    if (!crypto.timingSafeEqual(crypto.createHash("sha256").update(plain).digest(), plainHash)) throw new Error();
    return plain;
  } catch { throw new Error(INTEGRITY_ERROR); }
}

export async function downloadMedia(media, { fetcher = fetch, timeoutMs = 8000, maxFileBytes = MAX_FILE_BYTES } = {}) {
  if (!Number.isInteger(maxFileBytes) || maxFileBytes < 1 || maxFileBytes > MAX_PORTAL_FILE_BYTES) throw new Error("Limite de arquivo inválido.");
  const maxEncryptedBytes = (Math.floor(maxFileBytes / 16) + 1) * 16 + 10;
  const sizeError = maxFileBytes === MAX_FILE_BYTES ? SIZE_ERROR : "Arquivo maior que 5 MB. Envie um arquivo menor.";
  let url;
  try { url = new URL(String(media?.cdn_url ?? "")); } catch { throw new Error("Não foi possível localizar o arquivo. Selecione-o novamente."); }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443") || !(host === "mmg.whatsapp.net" || host.endsWith(".whatsapp.net") || host.endsWith(".fbcdn.net"))) throw new Error("Arquivo inválido. Selecione-o novamente.");
  let r;
  try { r = await fetcher(url.href, { signal: AbortSignal.timeout(timeoutMs), redirect: "error" }); }
  catch { throw new Error("Não conseguimos baixar o arquivo enviado. Selecione-o novamente."); }
  if (!r.ok || r.redirected) throw new Error("Não conseguimos baixar o arquivo enviado. Selecione-o novamente.");
  if (Number(r.headers.get("content-length")) > maxEncryptedBytes) { await r.body?.cancel(); throw new Error(sizeError); }
  const reader = r.body?.getReader();
  if (!reader) throw new Error("O arquivo recebido está vazio. Selecione-o novamente.");
  const chunks = []; let length = 0;
  try {
    while (true) {
      const item = await reader.read(); if (item.done) break;
      length += item.value.byteLength;
      if (length > maxEncryptedBytes) { await reader.cancel(); throw new Error(sizeError); }
      chunks.push(Buffer.from(item.value));
    }
  } catch (error) {
    if (error.message === sizeError) throw error;
    throw new Error("Não conseguimos baixar o arquivo completo. Selecione-o novamente.");
  } finally { reader.releaseLock(); }
  const plain = decryptMedia(Buffer.concat(chunks, length), media.encryption_metadata ?? {});
  if (plain.length > maxFileBytes) throw new Error(sizeError);
  return plain;
}

function validateFile(file, media) {
  const original = String(media.file_name ?? ""), ext = original.split(".").pop()?.toLowerCase();
  if (!MIME[ext]) throw new Error("Envie um arquivo PDF, JPG, JPEG ou PNG.");
  const declaredMime = String(media.mime_type ?? media.mimeType ?? "").toLowerCase();
  if (declaredMime && declaredMime !== MIME[ext]) throw new Error("O formato do arquivo não corresponde ao nome. Selecione outro arquivo.");
  // Assinaturas detectam formatos incompatíveis; não substituem análise antivírus/parser.
  const signature = ext === "pdf" ? file.subarray(0, 5).equals(Buffer.from("%PDF-")) :
    ext === "png" ? file.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) :
    file.length >= 3 && file[0] === 255 && file[1] === 216 && file[2] === 255;
  if (!signature) throw new Error("O arquivo não parece ser um documento válido. Selecione outro arquivo.");
}

export async function validatedMedia(media, { fetcher = fetch, maxFileBytes = MAX_FILE_BYTES } = {}) {
  if (!Array.isArray(media) || media.length !== 1 || !media[0]) throw new Error("Anexe um arquivo para enviar.");
  const bytes = await downloadMedia(media[0], { fetcher, maxFileBytes, timeoutMs: 20000 });
  validateFile(bytes, media[0]);
  const name = safeFileName(media[0].file_name);
  return { bytes, name, mime: MIME[name.split(".").pop().toLowerCase()], hash: crypto.createHash("sha256").update(bytes).digest("hex") };
}

export async function saveDocument({ idps, cpf, codDocumento, media, fetcher = fetch }) {
  idps = positiveInteger(idps); codDocumento = positiveInteger(codDocumento);
  if (!Array.isArray(media) || media.length !== 1 || !media[0]) throw new Error("Anexe um arquivo para enviar.");
  const file = await downloadMedia(media[0], { fetcher });
  if (file.length > MAX_FILE_BYTES) throw new Error(SIZE_ERROR);
  validateFile(file, media[0]);
  const insc = await findInscription(idps, cpf, { fetcher });
  const documents = await listDocuments(idps, insc.codColigada, { fetcher });
  if (!documents.some(d => d.id === codDocumento)) throw new Error("Este documento não foi solicitado para sua inscrição. Atualize a situação antes de continuar.");
  const nome = safeFileName(media[0].file_name);
  const q = new URLSearchParams({ codColigada: insc.codColigada, idps, numeroInscricao: insc.numeroInscricao, codDocumento, nomeArquivo: nome });
  let r;
  try { r = await ub(`/blip/documents?${q}`, { method: "POST", body: { base64: file.toString("base64") }, timeoutMs: 15000, fetcher }); }
  catch { throw new DocumentWriteUncertainError(); }
  if (r.status === 413) throw new Error("Arquivo grande demais. Envie um arquivo menor que 740 KB.");
  if (r.status === 503 && r.json?.error?.code === "RM_BUSY") throw new Error("O sistema acadêmico está ocupado. Aguarde um minuto e tente novamente.");
  if ([400,401,403,404,422,429].includes(r.status)) throw new Error("O sistema acadêmico não aceitou o envio. Confira sua inscrição no Portal do candidato antes de tentar novamente.");
  const expectedKey = `${insc.codColigada};${idps};${insc.numeroInscricao};${codDocumento}`;
  if (!r.ok || r.json?.status !== "ok" || r.json?.primaryKey !== expectedKey) throw new DocumentWriteUncertainError();
  return { primaryKey: expectedKey, nomeArquivo: nome };
}
