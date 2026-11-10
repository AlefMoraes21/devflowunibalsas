// Endpoint para o bot do Blip: grava na UniBalsas o documento enviado pelo Flow (que termina em `complete`).
//
// O Blip recebe o nfm_reply, baixa a mídia pela Graph API e acrescenta `file_url` em cada item:
//   "#wa.interactive.nfm_reply.json_response":
//     {"documento":"28","documents":[{"id":..,"mime_type":"application/pdf","sha256":"..","file_name":"x.pdf","file_url":"https://blipmediastore..."}],"flow_token":".."}
// O bot só repassa esse texto e a identificação do candidato (que ele já tem no estado da conversa):
//   POST /api/documento   Header: x-api-key: <BLIP_DOCS_KEY>
//   { "json_response": "<texto do nfm_reply>", "cpf": "38963757331", "processo_seletivo_id": "20385" }
//   (ou "idps": "225" no lugar de processo_seletivo_id; "codDocumento" substitui o campo "documento" do Flow)
// Resposta: { ok, mensagem, codDocumento, documento, nomeArquivo, primaryKey } ou { ok:false, mensagem } com 4xx/5xx.
import crypto from "node:crypto";
import { listDocuments, saveDocumentFromUrl } from "./documentos.js";
import { processPolicy } from "./processes.js";

const DIGITS = v => String(v ?? "").replace(/\D/g, "");

export function parseNfmReply(raw) {
  let obj = raw;
  if (typeof raw === "string") { try { obj = JSON.parse(raw); } catch { throw new HttpError(400, "Resposta do Flow inválida."); } }
  if (!obj || typeof obj !== "object") throw new HttpError(400, "Resposta do Flow inválida.");
  // O nome da chave é o que o payload do `complete` usa; aceitamos os nomes do Flow e o do exemplo do Blip.
  const list = [obj.arquivo, obj.documents, obj.documentos].find(Array.isArray) ?? [];
  return { documento: obj.documento ?? obj.codDocumento ?? "", files: list.filter(f => f && typeof f === "object") };
}

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }

function authorized(req, apiKey) {
  const expected = Buffer.from(String(apiKey ?? ""));
  const got = Buffer.from(String(req.headers?.["x-api-key"] ?? ""));
  return expected.length > 0 && got.length === expected.length && crypto.timingSafeEqual(got, expected);
}

export function createBlipDocumentHandler({ list = listDocuments, save = saveDocumentFromUrl, apiKey = () => process.env.BLIP_DOCS_KEY, fetcher = fetch } = {}) {
  return async function handler(req, res) {
    const reply = (status, body) => res.status(status).json(body);
    if (req.method !== "POST" && req.method !== "GET") return res.status(405).send("Method not allowed");
    if (!authorized(req, apiKey())) return reply(401, { ok: false, mensagem: "Não autorizado." });
    try {
      if (req.method === "GET") {
        // Lista para o bot montar o Flow (flow_action_payload.data): só {id,title} + texto. Ex.: ?processo_seletivo_id=20385
        const q = new URL(req.url ?? "/", "http://x").searchParams;
        let idps = DIGITS(q.get("idps"));
        if (!idps) { try { idps = processPolicy(q.get("processo_seletivo_id")).academicId; } catch (e) { throw new HttpError(400, e.message); } }
        const docs = await list(Number(idps), 1, { fetcher });
        return reply(200, {
          ok: true, documentos: docs.map(d => ({ id: d.id, title: d.title })),
          texto: docs.length ? `Envie um documento por vez: ${docs.map(d => d.descricao).join(", ")}. PDF, JPG ou PNG, até 740 KB.` : "Este processo não pede documentos nesta etapa."
        });
      }
      const b = req.body ?? {};
      const cpf = DIGITS(b.cpf);
      if (cpf.length !== 11) throw new HttpError(400, "Para enviar documentos, informe o CPF da inscrição.");
      let idps = DIGITS(b.idps);
      if (!idps) { try { idps = processPolicy(b.processo_seletivo_id).academicId; } catch (e) { throw new HttpError(400, e.message); } }
      const parsed = parseNfmReply(b.json_response ?? b);
      if (parsed.files.length !== 1) throw new HttpError(400, parsed.files.length ? "Envie um documento por vez." : "Anexe um arquivo para enviar.");
      const codDocumento = String(b.codDocumento ?? parsed.documento ?? "").trim();
      // O documento precisa ser um dos exigidos pelo processo (nunca um código qualquer vindo do cliente).
      const docs = await list(Number(idps), 1, { fetcher });
      const doc = docs.find(d => d.id === codDocumento);
      if (!doc) throw new HttpError(400, "Escolha qual documento você está enviando.");
      const saved = await save({ idps, cpf, codDocumento, file: parsed.files[0], fetcher });
      console.info(JSON.stringify({ event: "documento_blip", idps, codDocumento, ok: true }));
      return reply(200, {
        ok: true, codDocumento, documento: doc.descricao, nomeArquivo: saved.nomeArquivo, primaryKey: saved.primaryKey,
        mensagem: `✅ ${doc.descricao} recebido. Recebemos a confirmação do envio; a equipe vai conferir o documento em até 48 horas úteis.`
      });
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 422;
      if (!(e instanceof HttpError)) console.warn(JSON.stringify({ event: "documento_blip", ok: false, message: e.message }));
      return reply(status, { ok: false, mensagem: e.message });
    }
  };
}

export default createBlipDocumentHandler();
