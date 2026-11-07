// Continuação da jornada após a inscrição: login do candidato, leitura das etapas
// do Portal do candidato e as telas de matrícula (responsável financeiro,
// endereço, identidade, cupom). Etapas sem operação documentada na API oficial
// (uploads, contrato, pagamento, filiação) abrem o portal oficial.
//
// Mapeamento observado no site em 06/11/2026 (processo 20383):
//  - Seleção resp. financeiro (300676): rádio "Quem é seu responsável financeiro?" Eu/Outro.
//  - Resp. financeiro / menor 18 (300668/300675): dados do responsável.
//  - Pré-matrícula: Dados de endereço (300666) e Informações de identidade (300667).
//  - Cupom de Desconto (300674): texto + botão "Ativar Cupom".
//  - Documentos inscrição/matrícula, Contrato, Pagamento, Taxa de inscrição, Filiação: portal.

export const PORTAL_URL = "https://vestibular.unibalsas.edu.br/presencial";
const NENHUM_ENVIO = "Nenhum documento enviado ainda.";
export const CONTINUAR_ID = "continuar_inscricao";
const PORTAL_ID = 257;

export const norm = v => String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
const str = (v, f = "") => (v === null || v === undefined ? f : String(v));
const title30 = v => str(v).replace(/-+\s*$/g, "").trim().slice(0, 30);

export const SCREENS = {
  PORTAL_STATUS: ["titulo", "resumo", "erro", "tem_erro", "estado", "rotulo_rodape", "acao_rodape", "link_portal"],
  ACOMPANHAMENTO: ["titulo", "mensagem", "resumo", "erro", "tem_erro", "estado", "rotulo_rodape", "acao_rodape"],
  DOCUMENTOS_INSCRICAO: ["documentos", "texto", "enviados", "erro", "tem_erro", "estado", "valor_documento"],
  RESP_FINANCEIRO: ["opcoes_responsavel", "erro", "tem_erro", "estado", "valor_responsavel"],
  RESP_DADOS: ["ufs", "erro", "tem_erro", "estado", "cidades_natal", "cidade_visivel",
    "valor_nome", "valor_email", "valor_cpf", "valor_data_nascimento", "valor_celular", "valor_cep", "valor_rua",
    "valor_numero", "valor_complemento", "valor_bairro", "valor_cidade", "valor_uf", "valor_estado_natal",
    "valor_busca_cidade", "valor_cidade_natal", "data_maxima_nascimento"],
  ENDERECO: ["ufs", "erro", "tem_erro", "estado", "cidades_natal", "cidade_visivel",
    "valor_cep", "valor_rua", "valor_numero", "valor_complemento", "valor_bairro", "valor_cidade", "valor_uf",
    "valor_estado_natal", "valor_busca_cidade", "valor_cidade_natal"],
  IDENTIDADE: ["ufs", "racas", "estados_civis", "anos", "escolas", "escola_visivel", "erro", "tem_erro", "estado",
    "valor_rg", "valor_orgao_emissor", "valor_uf_rg", "valor_cor_raca", "valor_estado_civil",
    "valor_busca_escola", "valor_escola", "valor_ano_conclusao"],
  CUPOM: ["texto", "erro", "tem_erro", "estado", "valor_cupom"],
  ETAPA_PORTAL: ["titulo", "mensagem", "link_portal", "rotulo_link", "erro", "tem_erro", "estado"],
  STATUS_FINAL: ["titulo", "resumo", "mensagem", "link_portal"]
};

// O routing_model da Meta só aceita rotas para frente. A jornada segue esta ordem;
// quando a próxima etapa do portal fica "para trás", o Flow termina em STATUS_FINAL.
export const ORDER = ["PORTAL_STATUS", "DOCUMENTOS_INSCRICAO", "RESP_FINANCEIRO", "RESP_DADOS", "ENDERECO", "IDENTIDADE", "CUPOM", "ETAPA_PORTAL"];
const HUBS = new Set(["PORTAL_STATUS", "ACOMPANHAMENTO"]);
const rank = s => (HUBS.has(s) ? 0 : ORDER.indexOf(s));
export function canAdvance(from, to) {
  if (from === to && (to === "ETAPA_PORTAL" || to === "DOCUMENTOS_INSCRICAO")) return true; // atualização da mesma tela
  if (to === "TELA_ORIENTACAO_PROVA") return from === "PORTAL_STATUS";
  const a = rank(from), b = rank(to);
  return a >= 0 && b > a;
}

export const FORM_FIELDS = {
  DOCUMENTOS_INSCRICAO: { documento: "" },
  RESP_FINANCEIRO: { responsavel: "" },
  RESP_DADOS: { nome: "", email: "", cpf: "", data_nascimento: "", celular: "", cep: "", rua: "", numero: "", complemento: "",
    bairro: "", cidade: "", uf: "", estado_natal: "", busca_cidade: "", cidade_natal: "" },
  ENDERECO: { cep: "", rua: "", numero: "", complemento: "", bairro: "", cidade: "", uf: "", estado_natal: "", busca_cidade: "", cidade_natal: "" },
  IDENTIDADE: { rg: "", orgao_emissor: "", uf_rg: "", cor_raca: "", estado_civil: "", busca_escola: "", escola: "", ano_conclusao: "" },
  CUPOM: { cupom: "" }
};

export const USER_FIELDS = new Set([...Object.values(FORM_FIELDS).flatMap(Object.keys), "arquivo", "modo", "login"]);

export const ACTIONS = new Set(["atualizar_portal", "continuar_etapa", "encerrar", "enviar_documento", "enviar_responsavel",
  "buscar_cep", "buscar_cidade", "enviar_endereco", "enviar_resp_dados", "buscar_escola", "enviar_identidade", "enviar_cupom"]);

// Campos por etapa, localizados pelo rótulo do formulário oficial (field_id observado como reserva).
const SPEC = {
  RESP_FINANCEIRO: { responsavel: [["Quem é seu responsável financeiro?"], 232542] },
  ENDERECO: {
    rua: [["Rua"], 38569], numero: [["Número"], 38570], complemento: [["Complemento"], 38572], bairro: [["Bairro"], 38571],
    cidade: [["Cidade"], 38574], uf: [["Estado - UF", "Estado"], 38573], estado_natal: [["Estado natal"], 38641], cidade_natal: [["Cidade natal"], 38640]
  },
  RESP_DADOS: {
    nome: [["Nome completo"], 38710], email: [["E-mail", "Email"], 38692], cpf: [["CPF"], 38688], data_nascimento: [["Data de nascimento"], 38691],
    celular: [["Celular"], 38682], rua: [["Rua"], 38714], numero: [["Número"], 38711], complemento: [["Complemento"], 38726], bairro: [["Bairro"], 38681],
    cidade: [["Cidade"], 38684], uf: [["Estado"], 38701], estado_natal: [["Estado natal"], 38728], cidade_natal: [["Cidade natal"], 38727]
  },
  IDENTIDADE: {
    rg: [["Número da carteira de identidade"], 38642], orgao_emissor: [["Órgão emissor da identidade"], 38643],
    uf_rg: [["UF da carteira de identidade"], 38644], cor_raca: [["Cor / Raça", "Cor/Raça"], 38645], estado_civil: [["Estado civil"], 38646],
    escola: [["Escola de Ensino Médio"], 38699], ano_conclusao: [["Ano de conclusão"], 38680]
  },
  CUPOM: { cupom: [["Cupom de Desconto"], 98519] }
};
const OPTIONAL = new Set(["complemento", "escola", "ano_conclusao", "cupom"]);
const LABELS = { rua: "Rua", numero: "Número", bairro: "Bairro", cidade: "Cidade", uf: "UF", estado_natal: "Estado natal", cidade_natal: "Cidade natal",
  nome: "Nome", email: "E-mail", cpf: "CPF", data_nascimento: "Data de nascimento", celular: "Celular", rg: "Número da identidade",
  orgao_emissor: "Órgão emissor", uf_rg: "UF da identidade", cor_raca: "Cor/Raça", estado_civil: "Estado civil", responsavel: "Responsável financeiro" };

const inputsOf = form => form?.content?.inputs ?? [];
function locate(form, labels, fallback) {
  const wanted = labels.map(norm), inputs = inputsOf(form);
  return inputs.find(i => wanted.includes(norm(i.label))) ?? inputs.find(i => Number(i.field_id) === Number(fallback)) ?? null;
}
const queryFor = (form, fieldId) => (form?.querys ?? []).find(q => (q.fields ?? []).some(f => Number(f.field) === Number(fieldId))) ?? null;
const options = r => (Array.isArray(r?.data) ? r.data : Array.isArray(r?.data?.options) ? r.data.options : [])
  .map(o => ({ id: str(o.value), title: title30(o.label ?? o.value) })).filter(o => o.id);
export function search(list, text, limit = 20) {
  const q = norm(text);
  if (q.length < 2) return [];
  const starts = list.filter(o => norm(o.title).startsWith(q)), has = list.filter(o => !norm(o.title).startsWith(q) && norm(o.title).includes(q));
  return [...starts, ...has].slice(0, limit);
}
function onlyDigits(v) { return str(v).replace(/\D/g, ""); }
export function validCpf(v) {
  const d = onlyDigits(v);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  for (const size of [9, 10]) { let s = 0; for (let i = 0; i < size; i++) s += Number(d[i]) * (size + 1 - i); if (((s * 10) % 11) % 10 !== Number(d[size])) return false; }
  return true;
}
export function stepFromLink(link) { const m = str(link).match(/passo\/(\d+)/); return m ? Number(m[1]) : null; }

// Etapas do portal → próxima etapa acionável (primeira não conclusiva com passo).
export function summarizeStages(stages = []) {
  const rows = stages.map(s => ({
    id: s.id, title: str(s.title), status: str(s.feedback?.complementary_text), conclusive: Number(s.feedback?.conclusive) === 1,
    action: s.feedback?.cta_text && s.feedback.cta_text !== "null" ? str(s.feedback.cta_text) : "", step: stepFromLink(s.cta_link)
  }));
  const next = rows.find(r => !r.conclusive && r.step && r.action) ?? null;
  const resumo = rows.map(r => `${r.conclusive ? "✅" : r.step && r.action ? "👉" : "⏳"} ${r.title}: ${r.status || "—"}`).join("\n");
  return { rows, next, resumo };
}

export function screenForStep(stageTitle, form) {
  const t = norm(stageTitle), labels = new Set(inputsOf(form).map(i => norm(i.label)));
  if (/prova|avaliacao|redacao/.test(t)) return "TELA_ORIENTACAO_PROVA";
  if (labels.has(norm("Quem é seu responsável financeiro?"))) return "RESP_FINANCEIRO";
  if (labels.has(norm("Número da carteira de identidade"))) return "IDENTIDADE";
  if (labels.has(norm("Cupom de Desconto"))) return "CUPOM";
  if (/resp.*financeiro/.test(t) && labels.has("cpf") && labels.has("rua")) return "RESP_DADOS";
  if (labels.has("rua") && labels.has(norm("Estado natal"))) return "ENDERECO";
  if (/documentos?.*inscri/.test(t)) return "DOCUMENTOS_INSCRICAO";
  return "ETAPA_PORTAL";
}

const PORTAL_TEXT = [
  [/documento/, "Envie seus documentos", "Envie os documentos solicitados (PNG, JPG ou PDF, até 5 MB no total) pelo Portal do candidato. A análise ocorre em até 48 horas úteis."],
  [/contrato/, "Contrato", "Leia o contrato e registre o seu aceite no Portal do candidato."],
  [/pagamento|taxa/, "Pagamento", "Escolha Pix, cartão ou boleto e conclua o pagamento pelo ambiente seguro do Portal do candidato."],
  [/filiacao/, "Filiação", "Cadastre os nomes dos seus responsáveis pelo Portal do candidato."]
];
export function portalScreenData(stageTitle, step) {
  const found = PORTAL_TEXT.find(([re]) => re.test(norm(stageTitle)));
  return {
    titulo: found?.[1] ?? str(stageTitle, "Próxima etapa"),
    mensagem: (found?.[2] ?? "Continue esta etapa pelo Portal do candidato.") + "\n\nEntre com seu CPF ou e-mail e a data de nascimento. Depois volte aqui e toque em Atualizar situação.",
    link_portal: step ? `${PORTAL_URL}/passo/${step}` : `${PORTAL_URL}/portal-inscrito`,
    rotulo_link: "Abrir no Portal do candidato"
  };
}

export function createMatricula({ api, getForm, submitForm, getDataSource, render, academicId = () => null, docs = null }) {
  async function login(loginValue, birth) {
    let keys = { login: "LOGIN", birth: "DATANASCIMENTO" };
    try {
      const info = await api(`/login/info?portal=${PORTAL_ID}`);
      const fields = Array.isArray(info?.data) ? info.data : [];
      const date = fields.find(f => f.type === "date" || /nasc/i.test(f.key ?? "")), text = fields.find(f => f !== date);
      if (text?.key) keys.login = text.key; if (date?.key) keys.birth = date.key;
    } catch {}
    const [y, m, d] = str(birth).split("-");
    const r = await api("/login", { method: "POST", body: { portal: PORTAL_ID, user_data: [{ key: keys.login, value: str(loginValue).trim() }, { key: keys.birth, value: `${d}/${m}/${y}` }] } });
    const token = r?.token ?? r?.data?.token ?? r?.data?.session_id;
    if (!token) throw new Error("Não encontramos uma inscrição com esses dados.");
    return { token: str(token), person_id: str(r?.data?.person_id), applyment_id: str(r?.data?.applyment_id) };
  }

  async function portal(session) {
    // A documentação cita /login/portal, mas no servidor essa rota responde 404; a rota real é /portal
    // (conferido em 07/11/2026: POST /api/v1/portal → 401 sem chave; /login/portal → 404).
    const r = await api("/portal", { method: "POST", body: { portal: PORTAL_ID, token: session.token, ...(session.applyment_id ? { applyment_id: Number(session.applyment_id) } : {}) } });
    const cur = r?.data?.current_process ?? {};
    return { token: str(r?.token ?? r?.data?.token, session.token), processo_seletivo_id: str(cur.id ?? cur.process ?? session.processo_seletivo_id), stages: cur.stages ?? r?.data?.stages ?? [] };
  }

  // Painel com a situação de cada etapa. PORTAL_STATUS vem do login; ACOMPANHAMENTO vem
  // logo depois da inscrição ou da redação, sem fechar o Flow.
  async function status(session, erro = "", hub = "PORTAL_STATUS", extra = {}) {
    const p = await portal(session);
    const s = summarizeStages(p.stages);
    const base = { ...session, token: p.token, processo_seletivo_id: p.processo_seletivo_id || session.processo_seletivo_id, proxima: s.next };
    const waiting = s.rows.find(r => !r.conclusive && !(r.step && r.action));
    return render(hub, {
      ...base, titulo: hub === "ACOMPANHAMENTO" ? "Inscrição recebida ✅" : "Sua inscrição",
      resumo: (s.resumo || "Nenhuma etapa disponível no momento.") + (!s.next && waiting ? `\n\n⏳ ${waiting.title}: aguardando a análise da equipe UniBalsas. Você pode tocar em Atualizar situação daqui a pouco ou voltar depois por "Já sou inscrito".` : ""),
      erro, acao_rodape: s.next ? "continuar_etapa" : "atualizar_portal", rotulo_rodape: s.next ? `Continuar: ${title30(s.next.title)}`.slice(0, 35) : "Atualizar situação",
      link_portal: `${PORTAL_URL}/portal-inscrito`, ...extra
    });
  }

  function finish(data) {
    return render("STATUS_FINAL", {
      titulo: "Até breve!", resumo: str(data.resumo, "Sua inscrição está salva."),
      mensagem: "Quando quiser continuar, abra este atendimento e escolha \"Já sou inscrito\" com seu CPF e data de nascimento.",
      link_portal: `${PORTAL_URL}/portal-inscrito`
    });
  }

  async function sendDocument(data) {
    if (!docs) throw new Error("Envio de documentos indisponível.");
    if (!(data.documentos ?? []).some(d => d.id === str(data.documento))) throw new Error("Escolha qual documento você está enviando.");
    if (!/^\d{11}$/.test(str(data.cpf))) throw new Error("Para enviar documentos, entre pela opção \"Já sou inscrito\" com seu CPF.");
    const saved = await docs.saveDocument({ idps: academicId(data.processo_seletivo_id), cpf: data.cpf, codDocumento: data.documento, media: data.arquivo });
    const nome = (data.documentos.find(d => d.id === str(data.documento))?.descricao) ?? "Documento";
    const previous = str(data.enviados) === NENHUM_ENVIO ? "" : str(data.enviados);
    const enviados = [previous, `✅ ${nome} recebido (${saved.nomeArquivo}). Aguardando conferência da equipe.`].filter(Boolean).join("\n");
    const { arquivo, ...rest } = data; // a mídia (chaves de criptografia) nunca vai para o estado selado
    return render("DOCUMENTOS_INSCRICAO", { ...rest, enviados, values: { documento: "" }, erro: "" });
  }

  // Depois de concluir uma etapa: abre a próxima etapa se a rota for permitida, senão encerra com a situação.
  async function advance(from, session) {
    const p = await portal(session);
    const s = summarizeStages(p.stages);
    const sess = { ...session, token: p.token, processo_seletivo_id: p.processo_seletivo_id || session.processo_seletivo_id };
    const finish = mensagem => render("STATUS_FINAL", {
      titulo: s.next ? "Etapa registrada" : "Tudo em dia por aqui", resumo: s.resumo || "Situação indisponível no momento.",
      mensagem, link_portal: `${PORTAL_URL}/portal-inscrito`
    });
    if (!s.next) return finish("Não há outra etapa disponível agora. Quando houver novidade, abra este atendimento e escolha \"Já me inscrevi: continuar\".");
    const response = await open(sess, s.next);
    if (canAdvance(from, response.screen)) return response;
    return finish(`Próxima etapa: ${s.next.title}. Abra este atendimento novamente e escolha "Já me inscrevi: continuar" para seguir.`);
  }

  async function loadOptions(form, token, fieldId, filter = []) {
    const q = queryFor(form, fieldId);
    if (!q) return [];
    const next = (q.fields ?? []).map(f => Number(f.field)).filter(id => id !== Number(fieldId));
    return options(await getDataSource({ datasource: q.query_data, target: fieldId, filter, nextFields: next, token }));
  }

  function bind(screen, form) {
    const ids = {};
    for (const [name, [labels, fallback]] of Object.entries(SPEC[screen] ?? {})) {
      const input = locate(form, labels, fallback);
      if (input?.field_id) ids[name] = str(input.field_id);
      else if (!OPTIONAL.has(name)) throw new Error(`O campo "${LABELS[name] ?? name}" não foi localizado nesta etapa.`);
    }
    const buttons = form?.content?.buttons ?? [];
    const button = buttons.find(b => /concluir|avancar|ativar|enviar/.test(norm(b.label))) ?? null;
    if (!button) throw new Error("Esta etapa não retornou um botão de envio. Continue pelo Portal do candidato.");
    // Campos técnicos do formulário (ex.: CODUSUARIOPS, Idade, CPF) seguem com o valor atual, como o site faz.
    const used = new Set(Object.values(ids).map(Number));
    const hidden = inputsOf(form).filter(i => Number(i.field_id) > 0 && !used.has(Number(i.field_id)) && (i.value ?? i.value_now ?? null) !== null)
      .map(i => ({ field_id: Number(i.field_id), value: i.value ?? i.value_now }));
    return { ids, button: str(button.button), hidden, target: str(form.id) };
  }

  async function open(session, next) {
    const form = (await getForm(next.step, "step", session.token)).data?.form ?? null;
    const screen = screenForStep(next.title, form);
    const base = { ...session, etapa_titulo: next.title, etapa_passo: str(next.step) };
    if (screen === "TELA_ORIENTACAO_PROVA") return render(screen, { ...base, tema_redacao: "", texto_motivador: "", erro: "" });
    if (screen === "DOCUMENTOS_INSCRICAO") {
      const list = docs && academicId(session.processo_seletivo_id) ? await docs.listDocuments(academicId(session.processo_seletivo_id)).catch(() => []) : [];
      if (list.length && /^\d{11}$/.test(str(session.cpf))) return render(screen, {
        ...base, documentos: list, enviados: NENHUM_ENVIO,
        texto: `Envie pelo WhatsApp: ${list.map(d => d.descricao).join(", ")}.\nFormatos PDF, JPG ou PNG, até 740 KB por arquivo. Envie um documento por vez.`
      });
    }
    if (screen === "ETAPA_PORTAL" || screen === "DOCUMENTOS_INSCRICAO") return render("ETAPA_PORTAL", { ...base, ...portalScreenData(next.title, next.step) });
    const b = bind(screen, form);
    const data = { ...base, campos: b.ids, button_id: b.button, ocultos: b.hidden, target: b.target, values: {} };
    const pre = Object.fromEntries(inputsOf(form).map(i => [str(i.field_id), i.value ?? i.value_now ?? null]));
    for (const [name, id] of Object.entries(b.ids)) if (pre[id] !== null && pre[id] !== undefined) data.values[name] = str(pre[id]);
    if (screen === "RESP_FINANCEIRO") {
      const input = locate(form, ...SPEC.RESP_FINANCEIRO.responsavel);
      const own = (input?.data ?? input?.options ?? []).map(o => ({ id: str(o.value), title: title30(o.display ?? o.label ?? o.value) }));
      data.opcoes_responsavel = own.length ? own : await loadOptions(form, session.token, b.ids.responsavel);
      if (!data.opcoes_responsavel.length) data.opcoes_responsavel = [{ id: "Eu", title: "Eu" }, { id: "Outro", title: "Outro" }];
    }
    if (screen === "ENDERECO" || screen === "RESP_DADOS") data.ufs = await loadOptions(form, session.token, b.ids.estado_natal);
    if (screen === "RESP_DADOS") data.data_maxima_nascimento = new Date().toISOString().slice(0, 10);
    if (screen === "IDENTIDADE") {
      data.ufs = await loadOptions(form, session.token, b.ids.uf_rg);
      data.racas = await loadOptions(form, session.token, b.ids.cor_raca);
      data.estados_civis = await loadOptions(form, session.token, b.ids.estado_civil);
      data.anos = b.ids.ano_conclusao ? (await loadOptions(form, session.token, b.ids.ano_conclusao)).sort((a, z) => z.id.localeCompare(a.id)) : [];
    }
    if (screen === "CUPOM") data.texto = "Se você recebeu um cupom de desconto, informe abaixo. Deixe em branco para seguir sem cupom.";
    data.formulario = form ? { id: form.id, querys: form.querys ?? [] } : null;
    return render(screen, data);
  }

  async function cep(data) {
    const digits = onlyDigits(data.cep);
    if (digits.length !== 8) throw new Error("Informe o CEP com 8 números.");
    const r = await fetch(`https://viacep.com.br/ws/${digits}/json/`, { signal: AbortSignal.timeout(3000) });
    const j = await r.json();
    if (!r.ok || j.erro) throw new Error("CEP não encontrado. Preencha o endereço manualmente.");
    return { cep: `${digits.slice(0, 5)}-${digits.slice(5)}`, rua: j.logradouro || data.rua, bairro: j.bairro || data.bairro, cidade: j.localidade, uf: j.uf };
  }

  async function cities(data) {
    if (!data.estado_natal) throw new Error("Selecione o estado natal antes de buscar a cidade.");
    const all = await loadOptions(data.formulario, data.token, data.campos.cidade_natal, [{ field: Number(data.campos.estado_natal), values: str(data.estado_natal) }]);
    const found = search(all, data.busca_cidade);
    if (!found.length) throw new Error("Nenhuma cidade encontrada. Digite pelo menos 2 letras do nome.");
    return found;
  }

  async function schools(data) {
    if (!data.campos.escola) throw new Error("Esta etapa não pede escola.");
    const all = await loadOptions(data.formulario, data.token, data.campos.escola);
    const found = search(all, data.busca_escola);
    if (!found.length) throw new Error("Nenhuma escola encontrada. Tente outra parte do nome ou deixe em branco.");
    return found;
  }

  function require(data, names) {
    for (const n of names) if (!str(data[n]).trim()) throw new Error(`Preencha ${LABELS[n] ?? n}.`);
  }

  async function send(screen, data) {
    const fields = [...(data.ocultos ?? [])];
    const set = (name, value) => { const id = data.campos?.[name]; if (id && value !== undefined && value !== null && str(value) !== "") { const i = fields.findIndex(f => f.field_id === Number(id)); const item = { field_id: Number(id), value }; i >= 0 ? fields.splice(i, 1, item) : fields.push(item); } };
    if (screen === "RESP_FINANCEIRO") {
      if (!(data.opcoes_responsavel ?? []).some(o => o.id === data.responsavel)) throw new Error("Escolha quem será o responsável financeiro.");
      set("responsavel", data.responsavel);
    } else if (screen === "ENDERECO" || screen === "RESP_DADOS") {
      const req = ["rua", "numero", "bairro", "cidade", "uf", "estado_natal", "cidade_natal"];
      if (screen === "RESP_DADOS") req.unshift("nome", "email", "cpf", "data_nascimento", "celular");
      require(data, req);
      if (screen === "RESP_DADOS" && !validCpf(data.cpf)) throw new Error("CPF do responsável inválido.");
      if (!/^[A-Za-z]{2}$/.test(str(data.uf).trim())) throw new Error("Informe a UF com 2 letras.");
      if (!(data.ufs ?? []).some(o => o.id === data.estado_natal)) throw new Error("Selecione o estado natal.");
      if (!(data.cidades_natal ?? []).some(o => o.id === data.cidade_natal)) throw new Error("Busque e selecione a cidade natal.");
      for (const n of ["nome", "email", "rua", "numero", "complemento", "bairro", "cidade"]) set(n, str(data[n]).trim());
      set("uf", str(data.uf).trim().toUpperCase());
      set("estado_natal", data.estado_natal); set("cidade_natal", data.cidade_natal);
      if (screen === "RESP_DADOS") { set("cpf", onlyDigits(data.cpf)); set("data_nascimento", data.data_nascimento); set("celular", onlyDigits(data.celular).replace(/^55(?=\d{10,11}$)/, "")); }
    } else if (screen === "IDENTIDADE") {
      require(data, ["rg", "orgao_emissor", "uf_rg", "cor_raca", "estado_civil"]);
      for (const [n, list] of [["uf_rg", "ufs"], ["cor_raca", "racas"], ["estado_civil", "estados_civis"]]) if (!(data[list] ?? []).some(o => o.id === data[n])) throw new Error(`Selecione ${LABELS[n]}.`);
      if (data.escola && !(data.escolas ?? []).some(o => o.id === data.escola)) throw new Error("Busque e selecione a escola, ou deixe em branco.");
      set("rg", onlyDigits(data.rg) || str(data.rg).trim()); set("orgao_emissor", str(data.orgao_emissor).trim().toUpperCase());
      set("uf_rg", data.uf_rg); set("cor_raca", data.cor_raca); set("estado_civil", data.estado_civil); set("escola", data.escola); set("ano_conclusao", data.ano_conclusao);
    } else if (screen === "CUPOM") {
      if (!str(data.cupom).trim()) return null;
      set("cupom", str(data.cupom).trim().toUpperCase());
    }
    const r = await submitForm(data.button_id, fields, data.token);
    return str(r?.token ?? r?.data?.token, data.token);
  }

  return { login, portal, status, open, advance, finish, sendDocument, cep, cities, schools, send };
}
