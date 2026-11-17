// Etapa 2 do Vestibular (pós-inscrição): matrícula no MESMO Flow da etapa 1 (`flows/etapa1-vestibular.json`),
// telas MATR_*, aberta pelo link "Já sou inscrito" da tela inicial.
//
// Igual à etapa 1: cada subetapa grava no Firestore e responde na hora; o worker do Cloud Run grava no
// Rubeus em segundo plano. No site cada subetapa é um passo próprio, com o seu botão (responsável
// financeiro 300676 → dados do responsável 300668/300675 → endereço 300666 → identidade 300667 →
// cupom 300674), e o Rubeus só libera um passo depois que o anterior foi gravado. Por isso o envio é
// INCREMENTAL e EM ORDEM: o worker pergunta ao portal qual é o próximo passo e envia o bloco
// correspondente; passos já concluídos no portal não são reenviados.
//
// Ao vivo no Flow só o que é indispensável: o login (CPF + data de nascimento, como no portal) e a
// busca do endereço pelo CEP. Listas (UF, cor/raça, estado civil) são fixas; o worker converte o texto
// escolhido para o código do formulário do Rubeus.
import crypto from 'node:crypto';
import { summarizeStages, stepFromLink, portalScreenData } from './matricula.js';
import { jaEnviado, tipoDoArquivo, lerPassoContrato, dadosDoContrato, pdfDoPopup, contatoDaResposta, lerPassoPagamento, centavosDoPagamento, dadosDoPix, pixDoPopup, pixValido, recebedorDoPix, CAMPOS_PAGAMENTO } from './portal-site.js';
import { ICONES } from './icones.js';

const DIA = 86400000;
const FILA = 'matriculaFila';
const FINAIS = new Set(['concluida', 'conferir', 'falhou']);
const MAX_TENTATIVAS = 6;
const hash = v => crypto.createHash('sha256').update(String(v)).digest('hex');
const curto = id => String(id).slice(0, 10);
const digits = v => String(v ?? '').replace(/\D/g, '');
export const norm = v => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
// Etapas da inscrição direta (Transferência, Portador, ENEM) que dependem da equipe: "Documentos inscrição"
// (não confundir com "Documentos matrícula") e "Checando as notas" (ENEM).
export const ehDocsInscricao = t => /document/.test(norm(t)) && /inscri/.test(norm(t));
const ehDocsMatricula = t => /document/.test(norm(t)) && !/inscri/.test(norm(t));
export const ehNotasEnem = t => /checando.*nota|nota.*enem/.test(norm(t));

// Resultado da análise da inscrição direta, pela situação do portal (summarizeStages) e, no ENEM, pelo campo
// 38623 "Status da opção" do passo "Checando as notas" (3 = desclassificado; 4 a 8 = aprovado; 0 = validando).
// Devolve 'desclassificado', 'aprovado', 'recusado' (documento de volta a Pendentes) ou null (aguardando).
export function avaliarInscricao(s2, { statusOpcao = null } = {}) {
  const rows = s2?.rows ?? [];
  const docs = rows.find(r => ehDocsInscricao(r.title));
  const notas = rows.find(r => ehNotasEnem(r.title));
  const op = statusOpcao === null || statusOpcao === undefined || statusOpcao === '' ? null : Number(statusOpcao);
  if (op === 3 || (notas && /desclassific|insuficien/.test(norm(notas.status)))) return 'desclassificado';
  // Etapa seguinte liberada (ex.: "Seleção resp. financeiro" com Verificar): aprovado.
  const seguinte = s2?.next && !ehDocsInscricao(s2.next.title) && !ehNotasEnem(s2.next.title);
  if (seguinte) return 'aprovado';
  if (docs && !docs.conclusive && docs.step && docs.action) return 'recusado';
  if (op !== null && op >= 4 && op <= 8 && (!docs || docs.conclusive)) return 'aprovado';
  return null;
}
// Ícone da linha na lista de status (ilustração do status, como no portal).
export function iconeDoStatus(r, aberta) {
  if (r.conclusive) return ICONES.ok;
  if (/recusad|indeferid|desclassific|reprovad/.test(norm(r.status))) return ICONES.recusado;
  if (aberta) return ICONES.pendente;
  return ICONES.analise;
}

export const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'].map(u => ({ id: u, title: u }));
export const RACAS = ['Branca', 'Preta', 'Parda', 'Amarela', 'Indígena', 'Não declarada'].map(t => ({ id: norm(t).replace(/\s+/g, '_'), title: t }));
export const ESTADOS_CIVIS = ['Solteiro(a)', 'Casado(a)', 'Divorciado(a)', 'Viúvo(a)', 'Separado(a)', 'União estável'].map(t => ({ id: norm(t).replace(/[^a-z]+/g, '_').replace(/_+$/, ''), title: t }));
// Documentos de matrícula do Vestibular (passo 300671), na ordem e com a obrigatoriedade do Portal do candidato.
export const DOCS = [
  { id: '1', tela: 'MATR_DOC_IDENTIDADE', titulo: 'Carteira de identidade', obrigatorio: false },
  { id: '2', tela: 'MATR_DOC_CPF', titulo: 'CPF', obrigatorio: false },
  { id: '5', tela: 'MATR_DOC_HISTORICO', titulo: 'Histórico do ensino médio', obrigatorio: true },
  { id: '8', tela: 'MATR_DOC_CERTIFICADO', titulo: 'Certificado de conclusão do ensino médio', obrigatorio: true },
  { id: '15', tela: 'MATR_DOC_RESIDENCIA', titulo: 'Comprovante de residência', obrigatorio: false },
  { id: '16', tela: 'MATR_DOC_RESPONSAVEL', titulo: 'Documentos do responsável financeiro', obrigatorio: false },
  { id: '46', tela: 'MATR_DOC_DECLARACAO', titulo: 'Declaração de conclusão do ensino médio', obrigatorio: true }
];
// Bloco do Firestore que cada tela do Rubeus consome (nome da tela em api/matricula.js).
const BLOCO_DA_TELA = { RESP_FINANCEIRO: 'responsavel', RESP_DADOS: 'resp_dados', ENDERECO: 'endereco', IDENTIDADE: 'identidade', CUPOM: 'cupom' };

class ErroPasso extends Error {
  constructor(message, { final = false, motivo = 'passo' } = {}) { super(message); this.final = final; this.motivo = motivo; }
}

// Escolhe a opção do formulário do Rubeus que corresponde ao texto escolhido no Flow.
export function escolherOpcao(lista, valor, { prefixo = 0 } = {}) {
  const alvo = norm(valor).replace(/[^a-z0-9 ]/g, '').trim();
  if (!alvo) return null;
  const opts = (lista ?? []).map(o => ({ ...o, n: norm(o.title).replace(/[^a-z0-9 ]/g, '').trim(), i: norm(o.id) }));
  const exata = opts.filter(o => o.n === alvo || o.i === alvo);
  if (exata.length === 1) return exata[0].id;
  if (prefixo) {
    const p = alvo.slice(0, prefixo);
    const parecidas = opts.filter(o => o.n.startsWith(p));
    if (parecidas.length === 1) return parecidas[0].id;
  }
  return null;
}
export function idade(nascimentoIso, hoje = new Date()) {
  const [y, m, d] = String(nascimentoIso ?? '').split('-').map(Number);
  if (!y) return null;
  let a = hoje.getFullYear() - y;
  if (hoje.getMonth() + 1 < m || (hoje.getMonth() + 1 === m && hoje.getDate() < d)) a--;
  return a;
}

// Escola de Ensino Médio: no site é uma lista fechada (~1.461 escolas, campo opcional). No Flow a pessoa digita
// parte do nome e toca em "Buscar escola"; a lista vem do cache no Firestore, aquecido pelo worker quando abre
// a identidade no Rubeus (sem cache, a busca abre a identidade ao vivo uma vez e guarda a lista).
const CACHE = 'flowCache';
const CACHE_ESCOLAS = 'escolas-ensino-medio';
export const SEM_ESCOLA = 'nao_encontrei';
const OPCAO_SEM_ESCOLA = { id: SEM_ESCOLA, title: 'Não encontrei a minha escola', description: 'O campo fica em branco (é opcional).' };
export function buscarEscolas(lista, texto, limite = 15) {
  const limpa = v => norm(v).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  const q = limpa(texto), palavras = q.split(' ').filter(p => p.length >= 2);
  if (!palavras.length) return [];
  const achadas = (lista ?? []).filter(o => { const n = limpa(o.title); return palavras.every(p => n.includes(p)); });
  return achadas.sort((a, b) => Number(!limpa(a.title).startsWith(q)) - Number(!limpa(b.title).startsWith(q))).slice(0, limite);
}
// O Rubeus repete o nome ("ESCOLA X - ESCOLA X"); no WhatsApp o título da opção tem até 30 caracteres.
export function opcaoEscola(o) {
  const t = String(o.title ?? '').trim();
  const m = t.match(/^(.+?)\s+-\s+(.+)$/);
  const nome = m && norm(m[1]) === norm(m[2]) ? m[1].trim() : t;
  if (nome.length <= 30) return { id: String(o.id), title: nome };
  const corte = nome.slice(0, 29).replace(/\s+\S*$/, '') || nome.slice(0, 29);
  return { id: String(o.id), title: corte + '…', description: nome.slice(0, 300) };
}

// Tela de destino do botão do Portal: a primeira subetapa da matrícula que falta, pelo que já está gravado
// no Firestore e pelo que o portal já mostra como concluído. Etapas que dependem da equipe (correção,
// análise) ou que ainda não estão no Flow (contrato, pagamento) só mostram o status e fecham.
export function proximaTela(s2, blocos = {}, menor = false) {
  const next = s2?.next ?? null;
  const fechar = { tela: null, botao: 'Fechar' };
  if (s2 && !next) return fechar;
  // Etapa 3: contrato (baixar, assinar no GOV.BR e enviar por e-mail, como no site).
  if (next && /contrato/.test(norm(next.title))) return { tela: 'CONTR_TERMOS', botao: String(next.action || 'Verificar').slice(0, 35) };
  // Documentos de inscrição: telas da etapa 1 (abertas pela lista de status), nunca as da matrícula.
  if (next && ehDocsInscricao(next.title)) return fechar;
  if (next && !/resp|pre.?matric|document/.test(norm(next.title))) return fechar;
  // "Documentos inscrição" concluída não conta como "Documentos matrícula" concluída.
  const concluida = re => (s2?.rows ?? []).some(r => r.conclusive && re.test(norm(r.title)) && !ehDocsInscricao(r.title));
  const quem = blocos.responsavel?.responsavel;
  const respOk = concluida(/resp/) || (quem === 'Eu' && !menor) || ((quem === 'Outro' || menor) && Boolean(blocos.resp_dados));
  const preOk = concluida(/pre.?matric/);
  const tela = !respOk ? (quem === 'Outro' || menor ? 'MATR_RESP_DADOS' : 'MATR_RESPONSAVEL')
    : !preOk && !blocos.endereco ? 'MATR_ENDERECO'
    : !preOk && !blocos.identidade ? 'MATR_IDENTIDADE'
    : !blocos.documentos?.completo && (/document/.test(norm(next?.title)) || !concluida(/document/)) ? DOCS[0].tela
    : null;
  if (!tela) return fechar;
  return { tela, botao: String(next?.action || 'Continuar matrícula').slice(0, 35) };
}

export function createEtapa2({
  store, enqueue, sealState, openState, matricula, runCtx = fn => fn(), validCpf,
  buscarCep = null, clock = Date.now, log = e => console.info(JSON.stringify(e)), orcamentoMs = 80000,
  portalSite = null, baixarMidia = null, entrarNaProva = null,
  // Transferência, Portador e ENEM: "Documentos inscrição" abre as telas da etapa 1 (api/etapa1-fila.js).
  entrarNosDocsInscricao = null, tituloProcesso = () => 'processo seletivo 2027/1',
  // Avisos pelo Blip (api/blip.js createAvisosBlip): { atualizacao, cobranca, configurado }. Sem ele, nada é enviado.
  avisos = null,
  // Endereço público do Cloud Run (links do contrato).
  urlPublica = String(process.env.FLOW_WORKER_ORIGIN ?? '').replace(/\/+$/, ''),
  // Espera máxima pelo status do portal no login (o WhatsApp corta a resposta em ~10 s, contando o login).
  esperaPortalMs = Number(process.env.ETAPA2_ESPERA_PORTAL_MS) || 6500,
  // Calma antes dos documentos: o RM gera o RA e sincroniza a inscrição depois da identidade.
  esperaDocsMs = Number(process.env.ETAPA2_ESPERA_DOCS_MS) || 120000,
  // Link do contrato aberto durante uma geração em andamento: espera o PDF ficar pronto (até ~40 s).
  esperaContratoMs = 40000, dormir = ms => new Promise(r => setTimeout(r, ms))
}) {
  // ---------------------------------------------------------------- telas do Flow
  const valor = (...n) => n.map(x => 'valor_' + x);
  const END = ['cep', 'rua', 'numero', 'complemento', 'bairro', 'cidade', 'uf', 'estado_natal', 'cidade_natal'];
  const KEYS = {
    MATR_LOGIN: ['erro', 'tem_erro', ...valor('login', 'data_nascimento')],
    MATR_PORTAL: ['estado', 'resumo', 'botao'],
    CONTR_TERMOS: ['link_contrato'],
    MATR_STATUS: ['etapas'],
    MATR_RESPONSAVEL: ['estado', 'erro', 'tem_erro', ...valor('responsavel')],
    MATR_RESP_DADOS: ['estado', 'erro', 'tem_erro', ...valor('nome', 'email', 'cpf', 'data_nascimento', 'celular', ...END)],
    MATR_ENDERECO: ['estado', 'erro', 'tem_erro', ...valor(...END)],
    MATR_IDENTIDADE: ['estado', 'erro', 'tem_erro', ...valor('rg', 'orgao_emissor', 'uf_rg', 'cor_raca', 'estado_civil', 'ano_conclusao', 'busca_escola', 'escola'), 'escolas', 'tem_escolas'],
    ...Object.fromEntries(DOCS.map(x => [x.tela, ['estado', 'erro', 'tem_erro']])),
    MATR_FIM: ['titulo', 'mensagem']
  };
  function render(screen, data) {
    const { values = {}, ...trusted } = data;
    const out = {};
    for (const k of KEYS[screen]) {
      if (k === 'estado') { const { escolas, ...selar } = trusted; out.estado = sealState(screen, selar); }
      else if (k === 'tem_erro') out.tem_erro = Boolean(trusted.erro);
      else if (k === 'escolas') out.escolas = trusted.escolas ?? [];
      else if (k === 'tem_escolas') out.tem_escolas = Boolean(trusted.escolas?.length);
      else if (k.startsWith('valor_')) out[k] = values[k.slice(6)] == null ? '' : String(values[k.slice(6)]);
      else out[k] = trusted[k] ?? '';
    }
    return { screen, data: out };
  }
  const fim = (titulo, mensagem) => render('MATR_FIM', { titulo, mensagem });
  const pick = (d, nomes) => Object.fromEntries(nomes.filter(n => d?.[n] !== undefined).map(n => [n, typeof d[n] === 'string' ? d[n].trim() : d[n]]));

  async function gravarBloco(s, flowToken, bloco, dados) {
    for (let i = 0; i < 5; i++) {
      const atual = await store.get(s.fila_id, FILA);
      if (!atual) throw new Error('matrícula não encontrada');
      if (atual.record.flow !== hash(flowToken ?? '')) throw new Error('matrícula de outra sessão');
      const rec = { ...atual.record, blocos: { ...atual.record.blocos, [bloco]: { ...dados, recebido_em: clock() } }, status: ['concluida', 'falhou'].includes(atual.record.status) ? 'pendente' : atual.record.status };
      if (await store.update(s.fila_id, rec, atual.version, FILA)) {
        log({ event: 'etapa2_fila', id: curto(s.fila_id), passo: 'bloco_recebido', bloco });
        try { await enqueue(s.fila_id, { tipo: 'etapa2' }).catch(() => enqueue(s.fila_id, { tipo: 'etapa2' })); } catch (e) { log({ event: 'etapa2_fila_erro', passo: 'agendar', message: String(e?.message ?? e).slice(0, 120) }); }
        return;
      }
    }
    throw new Error('conflito');
  }
  const ERRO_GRAVAR = 'Não conseguimos guardar seus dados agora. Toque no botão de novo.';
  const sucesso = flowToken => ({ screen: 'SUCCESS', data: { extension_message_response: { params: { flow_token: String(flowToken ?? '') } } } });

  // ---------------------------------------------------------------- lista de escolas (cache)
  const memoEscolas = { at: 0, lista: null };
  async function lerEscolas() {
    if (memoEscolas.lista && clock() - memoEscolas.at < 3600000) return memoEscolas.lista;
    let r = null;
    try { r = (await store.get(CACHE_ESCOLAS, CACHE))?.record ?? null; } catch {}
    if (!r?.lista?.length || clock() - (r.atualizado ?? 0) > 7 * DIA) return null;
    memoEscolas.at = clock(); memoEscolas.lista = r.lista;
    return r.lista;
  }
  async function gravarEscolas(lista) {
    const enxuta = lista.map(o => ({ id: String(o.id), title: String(o.title ?? '') }));
    const novo = { lista: enxuta, atualizado: clock(), expires: clock() + 30 * DIA };
    try {
      const atual = await store.get(CACHE_ESCOLAS, CACHE);
      if (atual) await store.update(CACHE_ESCOLAS, novo, atual.version, CACHE); else await store.create(CACHE_ESCOLAS, novo, CACHE);
    } catch {}
    memoEscolas.at = clock(); memoEscolas.lista = enxuta;
    log({ event: 'etapa2_fila', passo: 'escolas_cache', quantidade: enxuta.length });
  }
  // Sem cache: abre o passo liberado no Rubeus (a identidade, quando a pessoa já chegou nesta tela) e guarda a lista.
  async function carregarEscolas(filaId) {
    const em = await lerEscolas();
    if (em) return em;
    const f = await store.get(filaId, FILA);
    if (!f) throw new Error('matrícula não encontrada');
    let sessao = await matricula.login(f.record.login ?? f.record.cpf, f.record.data_nascimento);
    const p = await matricula.portal(sessao);
    sessao = { ...sessao, token: p.token, processo_seletivo_id: p.processo_seletivo_id };
    const next = summarizeStages(p.stages).next;
    if (!next) throw new Error('sem passo liberado');
    const tela = await matricula.open(sessao, next);
    if (tela.screen !== 'IDENTIDADE') throw new Error('identidade ainda não liberada');
    const lista = await matricula.schoolOptions(openState(tela.data.estado, tela.screen));
    if (!lista?.length) throw new Error('lista de escolas vazia');
    await gravarEscolas(lista);
    return memoEscolas.lista;
  }
  async function opcoesDoCache(busca) {
    const lista = String(busca ?? '').trim() ? await lerEscolas() : null;
    return lista ? [...buscarEscolas(lista, busca).map(opcaoEscola), OPCAO_SEM_ESCOLA] : [];
  }
  // Guarda o arquivo (referência criptografada do WhatsApp) e, no último, marca os documentos como completos.
  async function gravarDocumento(s, flowToken, docId, media, completo) {
    for (let i = 0; i < 5; i++) {
      const atual = await store.get(s.fila_id, FILA);
      if (!atual) throw new Error('matrícula não encontrada');
      if (atual.record.flow !== hash(flowToken ?? '')) throw new Error('matrícula de outra sessão');
      const prev = atual.record.blocos?.documentos ?? {};
      const documentos = { ...prev, arquivos: { ...prev.arquivos, ...(media.length ? { [docId]: media } : {}) }, completo: Boolean(completo || prev.completo) };
      const rec = { ...atual.record, blocos: { ...atual.record.blocos, documentos }, status: ['concluida', 'falhou'].includes(atual.record.status) ? 'pendente' : atual.record.status };
      if (await store.update(s.fila_id, rec, atual.version, FILA)) {
        if (completo) {
          log({ event: 'etapa2_fila', id: curto(s.fila_id), passo: 'documentos_recebidos', quantidade: Object.keys(documentos.arquivos).length });
          try { await enqueue(s.fila_id, { tipo: 'etapa2' }).catch(() => enqueue(s.fila_id, { tipo: 'etapa2' })); } catch (e) { log({ event: 'etapa2_fila_erro', passo: 'agendar', message: String(e?.message ?? e).slice(0, 120) }); }
        }
        return;
      }
    }
    throw new Error('conflito');
  }

  function validarEndereco(u, { responsavel = false } = {}) {
    if (responsavel) {
      if (String(u.nome ?? '').trim().split(/\s+/).length < 2) throw new Error('Informe o nome completo do responsável.');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(u.email ?? '').trim())) throw new Error('Confira o e-mail do responsável.');
      if (!validCpf(u.cpf)) throw new Error('CPF do responsável inválido.');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(u.data_nascimento ?? ''))) throw new Error('Informe a data de nascimento do responsável.');
      if (!/^\d{10,11}$/.test(digits(u.celular).replace(/^55(?=\d{10,11}$)/, ''))) throw new Error('Informe o celular do responsável com DDD.');
    }
    if (!/^\d{8}$/.test(digits(u.cep))) throw new Error('Informe o CEP com 8 números.');
    for (const [k, rot] of [['rua', 'a rua'], ['numero', 'o número'], ['bairro', 'o bairro'], ['cidade', 'a cidade']]) if (!String(u[k] ?? '').trim()) throw new Error(`Preencha ${rot}.`);
    if (!UFS.some(o => o.id === String(u.uf ?? '').toUpperCase())) throw new Error('Selecione a UF do endereço.');
    if (!UFS.some(o => o.id === u.estado_natal)) throw new Error('Selecione o estado natal.');
    if (String(u.cidade_natal ?? '').trim().length < 2) throw new Error('Informe a cidade natal.');
  }
  async function preencherCep(screen, s, u) {
    if (!buscarCep) return render(screen, { ...s, values: u, erro: 'Preencha o endereço manualmente.' });
    try {
      const e = await buscarCep({ cep: u.cep, rua: u.rua, bairro: u.bairro });
      return render(screen, { ...s, values: { ...u, ...e, uf: e.uf }, erro: '' });
    } catch (e) { return render(screen, { ...s, values: u, erro: e.message }); }
  }

  // ---------------------------------------------------------------- status do portal (salvo)
  // O portal do Rubeus leva ~16 s para devolver as etapas; o WhatsApp espera ~10 s. O último status lido
  // (no login ou pelo worker) fica na fila e é usado quando o portal não responde a tempo.
  const STATUS_VALIDO_MS = 6 * 3600000;
  const enxugar = stages => (stages ?? []).map(x => ({ id: x.id, title: x.title, cta_link: x.cta_link ?? null,
    feedback: { complementary_text: x.feedback?.complementary_text ?? null, conclusive: x.feedback?.conclusive ?? 0, cta_text: x.feedback?.cta_text ?? null } }));
  async function salvarStatus(id, stages, processo) {
    for (let i = 0; i < 4; i++) {
      const atual = await store.get(id, FILA);
      if (!atual) return;
      if (await store.update(id, { ...atual.record, ultimo_status: { stages: enxugar(stages), processo: String(processo ?? ''), at: clock() } }, atual.version, FILA)) return;
    }
  }
  function statusSalvo(rec) {
    const u = rec?.ultimo_status;
    return u?.stages?.length && clock() - (u.at ?? 0) < STATUS_VALIDO_MS ? summarizeStages(u.stages) : null;
  }
  // Tarefa em segundo plano: lê o status no portal e guarda (o candidato toca em Atualizar).
  async function atualizarStatus(id) {
    const f = await store.get(id, FILA);
    if (!f) return 204;
    await runCtx(async () => {
      const sessao = await matricula.login(f.record.login ?? f.record.cpf, f.record.data_nascimento);
      const p = await matricula.portal(sessao);
      await salvarStatus(id, p.stages, p.processo_seletivo_id);
      await religarVigias(id, summarizeStages(p.stages ?? []));
      log({ event: 'etapa2_fila', id: curto(id), passo: 'status_salvo' });
    });
    return 204;
  }
  const BUSCANDO = 'Estamos buscando a situação da sua inscrição no Portal do candidato. Aguarde alguns instantes e toque em Atualizar.';
  // Tela de status igual ao Portal do candidato: cada etapa com o seu status e, nas etapas abertas, o botão
  // do site (ex.: "Verificar"). Cada linha leva à sua etapa.
  const emCorrecao = r => !r.conclusive && /aguardando.*correc/.test(norm(r.status));
  const aberta = r => !r.conclusive && Boolean(r.step && r.action) && !emCorrecao(r);
  function itensStatus({ id, menor, s2 }) {
    return (s2.rows ?? []).slice(0, 20).map((r, i) => {
      // Ilustração do status no ícone da linha; sem o arquivo do ícone, volta o emoji no título.
      const icone = iconeDoStatus(r, aberta(r));
      const item = {
        id: 'etapa_' + i,
        ...(icone ? { start: { image: icone } } : {}),
        'main-content': { title: (icone ? r.title : `${r.conclusive ? '✅' : '❗'} ${r.title}`).slice(0, 30), metadata: String(r.status || '—').slice(0, 80) },
        'on-click-action': { name: 'data_exchange', payload: { acao: 'abrir_etapa', estado: sealState('MATR_STATUS', { m2: true, fila_id: id, menor, etapa: { title: r.title, action: r.action, aberta: aberta(r) } }) } }
      };
      if (aberta(r)) item.end = { title: String(r.action).slice(0, 10) };
      return item;
    });
  }
  async function telaPortal({ id, menor, s2, blocos, rec, flowToken }) {
    if (!s2) return render('MATR_PORTAL', { m2: true, fila_id: id, menor, destino: 'atualizar', botao: 'Atualizar', resumo: BUSCANDO });
    // Prova liberada: segue para o "Portal do candidato" da etapa 1 (Realizar prova → redação), sem mudar a etapa 1.
    if (s2.next && /prova|avaliacao|redacao/.test(norm(s2.next.title)) && entrarNaProva && rec) {
      return entrarNaProva({ applyment_id: rec.applyment_id, processo: rec.ultimo_status?.processo, login: rec.login, data_nascimento: rec.data_nascimento, flowToken });
    }
    log({ event: 'etapa2_fila', id: curto(id), passo: 'portal_destino', destino: 'status', proxima: s2.next?.title ?? 'nenhuma',
      etapas: (s2.rows ?? []).map(r => `${r.title}|${r.conclusive ? 'C' : '-'}|${r.step ? 'P' : '-'}|${r.action ? 'A' : '-'}`).join(' ; ').slice(0, 400), blocos: Object.keys(blocos ?? {}).join(',') });
    return render('MATR_STATUS', { etapas: itensStatus({ id, menor, s2 }) });
  }
  // Abre a tela de uma etapa (vale para a lista de status e para o botão da tela de espera).
  async function abrirDestino(destino, s, base, flowToken) {
    if (destino === 'CONTR_TERMOS') {
      // O candidato já está aqui: gera agora (sem a calma do vigia), se ainda não estiver pronto.
      if (!(await contratoPronto(s.fila_id))) { try { await enqueue(s.fila_id, { tipo: 'etapa3_gerar' }); } catch {} }
      return render('CONTR_TERMOS', { link_contrato: await criarLinkContrato(s.fila_id) });
    }
    // Menor de 18 anos não pode ser o próprio responsável financeiro: grava "Outro" e vai direto à ficha do responsável.
    if (destino === 'MATR_RESP_DADOS' && s.menor) {
      try { await gravarBloco(s, flowToken, 'responsavel', { responsavel: 'Outro' }); }
      catch { return render('MATR_RESPONSAVEL', { ...base, erro: ERRO_GRAVAR }); }
    }
    return render(destino, { ...base, erro: '' });
  }

  // ---------------------------------------------------------------- contrato (etapa 3)
  // Link exclusivo e temporário (24 h). Ao abrir, o Cloud Run faz o que o navegador faz no passo do contrato:
  // entra no portal como o candidato, clica em "Clique aqui para fazer o download do contrato" e devolve o PDF
  // que o portal gera (campo 52138 do popup "Contrato gerado"). O PDF não fica guardado.
  const LINKS = 'contratoLinks';
  async function criarLinkContrato(filaId) {
    const token = crypto.randomBytes(24).toString('hex');
    await store.create(token, { fila_id: filaId, criado: clock(), expires: clock() + DIA }, LINKS);
    log({ event: 'etapa3_contrato', id: curto(filaId), passo: 'link_criado' });
    return `${urlPublica}/contrato/${token}`;
  }
  class ErroContrato extends Error { constructor(m, motivo) { super(m); this.motivo = motivo; } }
  // Contrato pronto (PDF criptografado no Firestore, coleção `contratos`, 7 dias): gerado em segundo plano pelo
  // Cloud Run assim que o portal libera a etapa, para o link abrir na hora. Sem PDF pronto, gera na hora (reserva).
  const CONTRATOS = 'contratos';
  const CALMA_CONTRATO_MS = Number(process.env.ETAPA3_CALMA_MS) || 120000;
  const CONTRATO_VALIDO_MS = 7 * DIA;
  const MAX_PDF_GUARDADO = 600 * 1024; // documento do Firestore: até 1 MiB depois de criptografado
  async function contratoPronto(filaId) {
    try {
      const c = await store.get(filaId, CONTRATOS);
      return c && (c.record.expires ?? 0) > clock() && c.record.pdf ? Buffer.from(c.record.pdf, 'base64') : null;
    } catch { return null; }
  }
  // Gera o contrato no portal como o site: abre o passo do contrato e clica em "Clique aqui para fazer o download
  // do contrato"; o PDF vem do popup "Contrato gerado" (campo 52138). Em segundo plano o IP de aceite vai vazio
  // (não há navegador do candidato; não registramos o IP do servidor como se fosse dele).
  // Uma geração por vez: dois logins da mesma pessoa no portal ao mesmo tempo derrubam um ao outro.
  async function travar(filaId) {
    for (let i = 0; i < 4; i++) {
      const a = await store.get(filaId, FILA);
      if (!a) return false;
      if ((a.record.contrato_gerando_ate ?? 0) > clock()) return false;
      if (await store.update(filaId, { ...a.record, contrato_gerando_ate: clock() + 90000 }, a.version, FILA)) return true;
    }
    return false;
  }
  async function destravar(filaId) {
    for (let i = 0; i < 4; i++) {
      const a = await store.get(filaId, FILA);
      if (!a) return;
      if (await store.update(filaId, { ...a.record, contrato_gerando_ate: 0 }, a.version, FILA)) return;
    }
  }
  async function gerarContrato(filaId, rec, ip = '', opcoes = {}) {
    if (!(await travar(filaId))) throw new ErroContrato('Estamos gerando o seu contrato. Esta página atualiza sozinha em alguns segundos.', 'gerando');
    try { return await gerarContratoAgora(filaId, rec, ip, opcoes); }
    finally { await destravar(filaId).catch(() => {}); }
  }
  async function gerarContratoAgora(filaId, rec, ip = '', { calma = false, statusSalvo = false } = {}) {
    const inicio = clock();
    const sessao = await portalSite.entrar(rec.login ?? rec.cpf, rec.data_nascimento);
    const passoDe = stages => stepFromLink((stages ?? []).find(x => /contrato/.test(norm(x.title)))?.cta_link);
    let processo = '', passoId = statusSalvo ? passoDe(rec.ultimo_status?.stages) : null;
    if (passoId) { try { processo = await portalSite.processo(sessao); } catch {} }
    if (!passoId || !processo) {
      const insc = await portalSite.inscricao(sessao);
      processo = processo || insc.processo;
      passoId = passoDe(insc.stages);
      const etapaContrato = (insc.stages ?? []).find(x => /contrato/.test(norm(x.title)));
      if (Number(etapaContrato?.feedback?.conclusive) === 1) throw new ErroContrato('O contrato já foi assinado.', 'concluido');
    }
    if (!processo || !passoId) throw new ErroContrato('O contrato ainda não está liberado no Portal do candidato.', 'nao_liberado');
    // Calma (vigia): o portal acabou de liberar o contrato; espera o Rubeus terminar de processar antes de gerar.
    if (calma && (!rec.contrato_liberado_em || clock() - rec.contrato_liberado_em < CALMA_CONTRATO_MS)) throw new ErroContrato('Contrato liberado agora; aguardando o Rubeus processar.', 'calma');
    const bruto = await portalSite.passoBruto(sessao, passoId, processo);
    await guardarContato(filaId, rec, contatoDaResposta(bruto));
    const passo = lerPassoContrato(bruto);
    const clique = await portalSite.clicar({ sessao, passo, processo, data: dadosDoContrato(passo, ip) });
    const destino = clique?.data ?? {};
    if (Number(destino.place_type_id) !== 6 || !destino.place_id) throw new ErroContrato('O portal não gerou o contrato agora. Tente de novo em instantes.', 'sem_popup');
    const pdf = pdfDoPopup(await portalSite.popup({ sessao, popupId: destino.place_id, stageId: destino.stage_id ?? passo.stage_id }));
    if (pdf.length <= MAX_PDF_GUARDADO) {
      const novo = { pdf: pdf.toString('base64'), criado: clock(), expires: clock() + CONTRATO_VALIDO_MS };
      try { const a = await store.get(filaId, CONTRATOS); if (a) await store.update(filaId, novo, a.version, CONTRATOS); else await store.create(filaId, novo, CONTRATOS); } catch {}
    }
    log({ event: 'etapa3_contrato', id: curto(filaId), passo: 'contrato_gerado', bytes: pdf.length, ms: clock() - inicio });
    return pdf;
  }
  async function baixarContrato(token, ip) {
    if (!/^[a-f0-9]{48}$/.test(String(token ?? ''))) throw new ErroContrato('Link inválido.', 'link');
    const link = await store.get(token, LINKS);
    if (!link || (link.record.expires ?? 0) < clock()) throw new ErroContrato('Este link expirou. Abra o Flow de novo pelo WhatsApp para gerar outro.', 'expirado');
    const id = link.record.fila_id;
    const pronto = await contratoPronto(id);
    if (pronto) { log({ event: 'etapa3_contrato', id: curto(id), passo: 'contrato_entregue', pronto: true }); return pronto; }
    const fila = await store.get(id, FILA);
    if (!fila) throw new ErroContrato('Inscrição não encontrada. Abra o Flow de novo pelo WhatsApp.', 'fila');
    // Geração já em andamento (ex.: pedida ao tocar em Verificar): espera ela terminar, sem gerar em paralelo.
    if ((fila.record.contrato_gerando_ate ?? 0) > clock()) {
      const limite = clock() + esperaContratoMs;
      while (clock() < limite) {
        await dormir(2000);
        const ok = await contratoPronto(id);
        if (ok) { log({ event: 'etapa3_contrato', id: curto(id), passo: 'contrato_entregue', pronto: true, esperou: true }); return ok; }
      }
      throw new ErroContrato('Estamos gerando o seu contrato. Esta página atualiza sozinha em alguns segundos.', 'gerando');
    }
    const pdf = await gerarContrato(id, fila.record, ip, { statusSalvo: true });
    log({ event: 'etapa3_contrato', id: curto(id), passo: 'contrato_entregue', pronto: false });
    return pdf;
  }

  // Vigias (Cloud Tasks): o Rubeus não avisa o Run, então o Run confere o portal de tempos em tempos.
  // Para economizar (Cloud Run com mínimo 0, cobrado por uso), confere a cada 10 min nas 2 primeiras horas e
  // depois de hora em hora. Cada conferência leva ~15 s (o portal demora a devolver as etapas).
  const VIGIA_INTERVALO_S = Number(process.env.ETAPA3_VIGIA_INTERVALO_S) || 600;
  const VIGIA_LONGO_S = Number(process.env.VIGIA_INTERVALO_LONGO_S) || 3600;
  const VIGIA_MAX_MS = 15 * DIA;
  const PRIMEIRA_CONFERENCIA_S = Number(process.env.VIGIA_PRIMEIRA_S) || 120;
  const intervaloVigia = desde => (clock() - (desde ?? clock()) < 2 * 3600000 ? VIGIA_INTERVALO_S : VIGIA_LONGO_S);
  const salvarFilaDe = id => async patch => { for (let i = 0; i < 4; i++) { const a = await store.get(id, FILA); if (!a) return; if (await store.update(id, { ...a.record, ...patch }, a.version, FILA)) return; } };

  // Uma corrente por vigia. Cada agendamento guarda o horário da próxima conferência (vigia_proxima[tipo]);
  // tarefa que chega antes desse horário é de uma corrente antiga e sai sem reagendar. O prazo do registro
  // acompanha o vigia (não expira no meio). Se o Cloud Tasks não aceitar, lança erro: o worker devolve 500 e
  // a tarefa é repetida.
  const FOLGA_VIGIA_MS = 30000;
  const VIGIA_PARADA_MS = 2 * 3600000;
  const correnteAntiga = (rec, tipo) => clock() < (rec?.vigia_proxima?.[tipo] ?? 0) - FOLGA_VIGIA_MS;
  const vigiaParada = (rec, tipo) => (rec?.vigia_proxima?.[tipo] ?? 0) + VIGIA_PARADA_MS < clock();
  async function agendarVigia(id, tipo, atrasoSeg, colecao = FILA) {
    const quando = clock() + atrasoSeg * 1000;
    try { await enqueue(id, { tipo, atrasoSeg }); }
    catch {
      try { await enqueue(id, { tipo, atrasoSeg }); }
      catch (e) {
        console.error(JSON.stringify({ event: 'vigia_atencao', id: curto(id), tipo, motivo: 'agendar', message: String(e?.message ?? e).slice(0, 120) }));
        throw Object.assign(new Error('Não foi possível agendar o vigia.'), { agendar: true });
      }
    }
    for (let i = 0; i < 4; i++) {
      const a = await store.get(id, colecao).catch(() => null);
      if (!a) return;
      const novo = { ...a.record, vigia_proxima: { ...(a.record.vigia_proxima ?? {}), [tipo]: quando }, expires: Math.max(a.record.expires ?? 0, quando + 7 * DIA) };
      if (await store.update(id, novo, a.version, colecao).catch(() => false)) return;
    }
  }
  // Começa um vigia só se não houver corrente viva (nunca agendado, ou a próxima conferência atrasou mais de 2 h).
  async function garantirVigia(id, tipo, atrasoSeg, extra = null) {
    const rec = (await store.get(id, FILA))?.record;
    if (!rec || !vigiaParada(rec, tipo)) return false;
    if (extra) await salvarFilaDe(id)(extra).catch(() => {});
    await agendarVigia(id, tipo, atrasoSeg);
    return true;
  }
  // Uma execução por vez de cada vigia. Devolve false se outra execução está em andamento.
  async function travarVigia(id, campo, colecao = FILA) {
    for (let i = 0; i < 4; i++) {
      const a = await store.get(id, colecao);
      if (!a) return false;
      if ((a.record[campo] ?? 0) > clock()) return false;
      if (await store.update(id, { ...a.record, [campo]: clock() + 170000 }, a.version, colecao)) return true;
    }
    return false;
  }
  async function destravarVigia(id, campo, colecao = FILA) {
    for (let i = 0; i < 4; i++) {
      const a = await store.get(id, colecao).catch(() => null);
      if (!a) return;
      if (await store.update(id, { ...a.record, [campo]: 0 }, a.version, colecao).catch(() => false)) return;
    }
  }
  // Login ou status atualizado: liga (ou religa) o vigia que a situação do portal pede, mesmo para quem enviou
  // os documentos pelo site. Não lança erro: o próximo login tenta de novo.
  async function religarVigias(id, s2) {
    try {
      const rec = (await store.get(id, FILA))?.record;
      if (!rec || !s2?.rows?.length || rec.matricula_concluida_em) return;
      const linha = re => s2.rows.find(r => re.test(norm(r.title)));
      // Inscrição direta (Transferência, Portador, ENEM) aguardando a equipe: vigia da análise e do resultado.
      const docsInsc = s2.rows.find(r => ehDocsInscricao(r.title)), notas = s2.rows.find(r => ehNotasEnem(r.title));
      const inscEmAnalise = (docsInsc && !docsInsc.conclusive && !aberta(docsInsc)) || (notas && !notas.conclusive);
      if (inscEmAnalise && !rec.insc_vigia?.fim && !s2.rows.some(r => ehDocsMatricula(r.title))) {
        if (await garantirVigia(id, 'inscricao_vigia', VIGIA_INTERVALO_S, rec.insc_vigia ? null : { insc_vigia: { desde: clock(), ate: clock() + VIGIA_MAX_MS } })) log({ event: 'inscricao_vigia', id: curto(id), passo: 'vigia_ligado' });
        return;
      }
      const docs = s2.rows.find(r => /document/.test(norm(r.title)) && /matric/.test(norm(r.title))) ?? s2.rows.find(r => ehDocsMatricula(r.title));
      const contrato = linha(/contrato/), pagamento = linha(/pagamento|taxa/), matriculado = linha(/matriculad/);
      if (matriculado?.conclusive) return;
      const antes = docs ? s2.rows.slice(0, s2.rows.indexOf(docs)) : [];
      const emAnalise = docs && !docs.conclusive && !aberta(docs) && antes.every(r => r.conclusive);
      const docsOk = docs ? Boolean(docs.conclusive) : true;
      const contratoPendente = Boolean(contrato) && !contrato.conclusive && docsOk;
      const pagamentoPendente = Boolean(pagamento) && !pagamento.conclusive && docsOk && (!contrato || contrato.conclusive);
      if (pagamentoPendente || rec.final_vigiando) {
        if (await garantirVigia(id, 'etapa4_vigia', 60, rec.final_vigiando ? null : { final_vigiando: clock() })) log({ event: 'etapa_final', id: curto(id), passo: 'vigia_ligado' });
      } else if (emAnalise || contratoPendente) {
        // Contrato já aberto na tela de status: o candidato está vendo agora, não precisa do aviso.
        const extra = contratoPendente && aberta(contrato) && !rec.avisos?.contrato_liberado ? { avisos: { ...(rec.avisos ?? {}), contrato_liberado: clock() } } : null;
        if (await garantirVigia(id, 'etapa3_vigia', emAnalise ? VIGIA_INTERVALO_S : 5, extra)) log({ event: 'etapa3_contrato', id: curto(id), passo: 'vigia_ligado' });
      }
    } catch (e) { log({ event: 'etapa2_fila_erro', id: curto(id), passo: 'religar_vigias', message: String(e?.message ?? e).slice(0, 120) }); }
  }

  // Etapa 3: depois dos documentos entregues, espera a liberação do contrato (análise da equipe) e, quando
  // liberar, gera e guarda o PDF. Contrato pronto ou já assinado: passa a vigiar o pagamento e a matrícula.
  async function vigiarContrato(id, { imediato = false } = {}) {
    const f = await store.get(id, FILA);
    if (!f) return 204;
    const rec = f.record;
    const salvarFila = salvarFilaDe(id);
    // Tarefa de uma corrente antiga (outra conferência já está agendada): sai sem reagendar.
    if (!imediato && correnteAntiga(rec, 'etapa3_vigia')) return 204;
    // Passa a vigiar o pagamento e a matrícula (uma corrente só).
    const iniciarFinal = atrasoSeg => garantirVigia(id, 'etapa4_vigia', atrasoSeg, { final_vigiando: clock() });
    if (await contratoPronto(id)) { await iniciarFinal(VIGIA_LONGO_S); return 204; }
    const ate = rec.vigia_ate ?? clock() + VIGIA_MAX_MS;
    if (!rec.vigia_ate) await salvarFila({ vigia_ate: ate, vigia_desde: clock() }).catch(() => {});
    try {
      await gerarContrato(id, rec, '', { calma: !imediato });
      // Documentos aprovados e contrato liberado (e já gerado): avisa o candidato. Se ele mesmo abriu o
      // contrato no Flow (imediato), já sabe — não avisa.
      if (!imediato) await avisar(id, 'contrato_liberado').catch(() => {});
      await iniciarFinal(VIGIA_LONGO_S);
      return 204;
    } catch (e) {
      if (e?.agendar) throw e;
      if (e?.motivo === 'gerando') {
        // Outra geração em andamento: o vigia volta em 2 minutos (não perde a corrente).
        if (!imediato) await agendarVigia(id, 'etapa3_vigia', 120);
        return 204;
      }
      if (e?.motivo === 'concluido') {
        log({ event: 'etapa3_contrato', id: curto(id), passo: 'contrato_ja_assinado' });
        await iniciarFinal(60);
        return 204;
      }
      if (e?.motivo === 'calma') {
        // Acabou de liberar: marca o momento e volta daqui a ~2 minutos para gerar.
        const desde = rec.contrato_liberado_em ?? clock();
        if (!rec.contrato_liberado_em) await salvarFila({ contrato_liberado_em: desde }).catch(() => {});
        log({ event: 'etapa3_contrato', id: curto(id), passo: 'contrato_liberado' });
        await agendarVigia(id, 'etapa3_vigia', Math.max(5, Math.ceil((desde + CALMA_CONTRATO_MS - clock()) / 1000)));
        return 204;
      }
      log({ event: 'etapa3_contrato', id: curto(id), passo: e?.motivo === 'nao_liberado' ? 'contrato_aguardando' : 'contrato_erro', message: String(e?.message ?? e).slice(0, 120) });
    }
    // Pedido do candidato (imediato) não cria corrente: quem reagenda é só o vigia.
    if (!imediato && clock() < ate) await agendarVigia(id, 'etapa3_vigia', intervaloVigia(rec.vigia_desde));
    return 204;
  }

  // Etapa final (igual para todos os processos): Pagamento "Pendente/Verificar" → "Recebido" e
  // Matriculado "Existem pendências" → "Parabéns!". O pagamento é feito fora do Flow (portal; depois, a
  // mensagem de pagamento do WhatsApp). O vigia registra quando o pagamento libera e quando a matrícula
  // conclui — são os momentos dos avisos ao candidato.
  const FINAL_MAX_MS = 30 * DIA;
  const MAX_TENTATIVAS_AVISO = 5;
  async function vigiarFinal(id) {
    const antes = await store.get(id, FILA);
    if (!antes) return 204;
    if (correnteAntiga(antes.record, 'etapa4_vigia')) return 204;
    // Outra conferência em andamento: 503 para o Cloud Tasks repetir depois (não roda em paralelo).
    if (!(await travarVigia(id, 'final_rodando_ate'))) return 503;
    try { return await conferirFinal(id); }
    finally { await destravarVigia(id, 'final_rodando_ate'); }
  }
  async function conferirFinal(id) {
    const f = await store.get(id, FILA);
    if (!f) return 204;
    const rec = f.record;
    const salvarFila = salvarFilaDe(id);
    if (rec.matricula_concluida_em) {
      // Concluída: só falta o aviso, se a última tentativa falhou.
      if (rec.pagamento_liberado_em && avisoPendente(rec, 'matricula_concluida') && !(await avisar(id, 'matricula_concluida').catch(() => false)) && avisoPendente((await store.get(id, FILA))?.record, 'matricula_concluida')) {
        await agendarVigia(id, 'etapa4_vigia', VIGIA_INTERVALO_S);
      }
      return 204;
    }
    const ate = rec.final_ate ?? clock() + FINAL_MAX_MS;
    if (!rec.final_ate) await salvarFila({ final_ate: ate }).catch(() => {});
    let proximoEm = VIGIA_LONGO_S;
    try {
      const sessao = await portalSite.entrar(rec.login ?? rec.cpf, rec.data_nascimento);
      const { stages, processo } = await portalSite.inscricao(sessao);
      await salvarStatus(id, stages, processo || rec.ultimo_status?.processo).catch(() => {});
      const st = summarizeStages(stages ?? []);
      const linha = re => st.rows.find(r => re.test(norm(r.title)));
      const contrato = linha(/contrato/), pagamento = linha(/pagamento|taxa/), matriculado = linha(/matriculad/);
      if (matriculado?.conclusive || (pagamento?.conclusive && !matriculado)) {
        await salvarFila({ matricula_concluida_em: clock() });
        log({ event: 'etapa_final', id: curto(id), passo: 'matricula_concluida', pagamento: pagamento?.status ?? '', matriculado: matriculado?.status ?? '' });
        // Avisa só quem a gente viu com o pagamento pendente (não manda para matrícula antiga).
        if (rec.pagamento_liberado_em && !(await avisar(id, 'matricula_concluida', { sessao, processo }).catch(() => false))) {
          if (avisoPendente((await store.get(id, FILA))?.record, 'matricula_concluida')) await agendarVigia(id, 'etapa4_vigia', VIGIA_INTERVALO_S);
        }
        return 204;
      }
      // Aviso do contrato que falhou antes: tenta de novo enquanto o contrato não foi assinado.
      if (contrato && !contrato.conclusive && avisoPendente(rec, 'contrato_liberado') && (rec.avisos_tentativas?.contrato_liberado ?? 0) > 0) {
        await avisar(id, 'contrato_liberado', { sessao, processo }).catch(() => {});
      }
      // Pagamento liberado = contrato concluído (ou sem etapa de contrato) e o Pagamento com o botão do site.
      const pagamentoAberto = pagamento && !pagamento.conclusive && pagamento.step && pagamento.action && (!contrato || contrato.conclusive);
      if (pagamentoAberto) {
        if (!rec.pagamento_liberado_em) {
          await salvarFila({ pagamento_liberado_em: clock() });
          log({ event: 'etapa_final', id: curto(id), passo: 'pagamento_liberado' });
        }
        if (!rec.cobranca_enviada_em && avisos?.configurado?.cobranca?.() && (rec.cobranca_tentativas ?? 0) < MAX_TENTATIVAS_AVISO) {
          const ok = await enviarCobranca(id, rec, sessao, processo, pagamento.step);
          if (!ok) proximoEm = VIGIA_INTERVALO_S; // tenta de novo em 10 min
        }
      } else {
        log({ event: 'etapa_final', id: curto(id), passo: 'aguardando', pagamento: pagamento?.status ?? '', matriculado: matriculado?.status ?? '' });
      }
    } catch (e) {
      if (e?.agendar) throw e;
      log({ event: 'etapa_final', id: curto(id), passo: 'erro', message: String(e?.message ?? e).slice(0, 120) });
    }
    if (clock() < ate) await agendarVigia(id, 'etapa4_vigia', proximoEm);
    return 204;
  }

  // ---------------------------------------------------------------- avisos (Blip)
  // Cada aviso sai uma vez só (fila.avisos[chave]); falhou, tenta de novo até 5 vezes. Nome e celular vêm do
  // próprio portal (applicantData dos passos do contrato/pagamento ou "Meus dados", página 432) e ficam na fila
  // (criptografada). Nada de celular nos logs.
  const AVISOS = {
    contrato_liberado: { processo: 'matrícula', situacao: 'Seus documentos de matrícula foram analisados e aprovados.', proximo: 'acesse a sua inscrição pelo botão abaixo e baixe o contrato da sua matrícula.' },
    matricula_concluida: { processo: 'matrícula', situacao: 'Pagamento recebido. Sua matrícula está concluída! 🎉', proximo: 'acompanhe as orientações da UniBalsas para o início das aulas.' }
  };
  const avisoPendente = (rec, chave) => Boolean(avisos?.configurado?.atualizacao?.()) && Boolean(rec) && !rec.avisos?.[chave] && (rec.avisos_tentativas?.[chave] ?? 0) < MAX_TENTATIVAS_AVISO;
  async function guardarContato(id, rec, contato) {
    if (!contato?.celular || (rec?.contato?.celular === contato.celular && rec?.contato?.nome === contato.nome)) return;
    await salvarFilaDe(id)({ contato }).catch(() => {});
  }
  async function avisar(id, chave, { sessao = null, processo = '', textos = null } = {}) {
    if (!avisos?.configurado?.atualizacao?.()) return false;
    const rec = (await store.get(id, FILA))?.record;
    if (!avisoPendente(rec, chave)) return Boolean(rec?.avisos?.[chave]);
    let contato = rec.contato;
    if (!contato?.celular && sessao && portalSite?.pagina) {
      try { contato = contatoDaResposta(await portalSite.pagina(sessao, 432, processo || rec.ultimo_status?.processo)); await guardarContato(id, rec, contato); } catch {}
    }
    const ok = contato?.celular ? await avisos.atualizacao({ celular: contato.celular, nome: contato.nome, ...(textos ?? AVISOS[chave]) }).catch(() => false) : false;
    const atual = (await store.get(id, FILA))?.record ?? rec;
    await salvarFilaDe(id)(ok
      ? { avisos: { ...(atual.avisos ?? {}), [chave]: clock() } }
      : { avisos_tentativas: { ...(atual.avisos_tentativas ?? {}), [chave]: (atual.avisos_tentativas?.[chave] ?? 0) + 1 } }).catch(() => {});
    if (!ok && (atual.avisos_tentativas?.[chave] ?? 0) + 1 >= MAX_TENTATIVAS_AVISO) console.error(JSON.stringify({ event: 'etapa_aviso_atencao', id: curto(id), aviso: chave, motivo: contato?.celular ? 'blip' : 'sem_celular' }));
    log({ event: 'etapa_aviso', id: curto(id), aviso: chave, enviado: ok, motivo: ok ? undefined : contato?.celular ? 'blip' : 'sem_celular' });
    return ok;
  }

  // Cobrança da taxa (template de pagamento): gera o Pix como o botão "Realizar pagamento" do site (Pix) e manda o
  // copia e cola + link do portal (cartão). O Pix gerado fica na fila (12 h) para as novas tentativas não gerarem outro.
  const PIX_VALIDO_MS = 12 * 3600000;
  async function enviarCobranca(id, rec, sessao, processo, passoId) {
    const salvar = salvarFilaDe(id);
    const tentativa = (rec.cobranca_tentativas ?? 0) + 1;
    let ok = false, motivo = '';
    try {
      const bruto = await portalSite.passoBruto(sessao, passoId, processo);
      const passo = lerPassoPagamento(bruto);
      const contato = contatoDaResposta(bruto)?.celular ? contatoDaResposta(bruto) : rec.contato;
      await guardarContato(id, rec, contato);
      const centavos = centavosDoPagamento(passo);
      let codigo = rec.cobranca_pix && clock() - (rec.cobranca_pix_em ?? 0) < PIX_VALIDO_MS ? pixValido(rec.cobranca_pix) : '';
      if (!codigo) {
        try {
          const clique = await portalSite.clicar({ sessao, passo, processo, data: dadosDoPix(passo) });
          const d = clique?.data ?? {};
          if (Number(d.place_type_id) === 6 && d.place_id) codigo = pixDoPopup(await portalSite.popup({ sessao, popupId: d.place_id, stageId: d.stage_id ?? passo.stage_id }));
        } catch (e) { log({ event: 'etapa_final', id: curto(id), passo: 'pix_erro', message: String(e?.message ?? e).slice(0, 120) }); }
        // Reserva: o último Pix que o portal guardou (campo 50901).
        if (!codigo) codigo = pixValido(passo.valores[CAMPOS_PAGAMENTO.pixCodigo]);
        if (codigo) await salvar({ cobranca_pix: codigo, cobranca_pix_em: clock() }).catch(() => {});
      }
      if (!codigo) motivo = 'sem_pix';
      else if (!contato?.celular) motivo = 'sem_celular';
      else if (!centavos) motivo = 'sem_valor';
      else if ((await store.get(id, FILA))?.record?.cobranca_enviada_em) { ok = true; motivo = 'ja_enviada'; }
      else {
        ok = await avisos.cobranca({ celular: contato.celular, nome: contato.nome, centavos, codigoPix: codigo,
          referencia: 'mat-' + (passo.valores[CAMPOS_PAGAMENTO.idBoleto] || curto(id)), recebedor: recebedorDoPix(codigo) });
        if (!ok) motivo = 'blip';
      }
    } catch (e) { motivo = String(e?.message ?? e).slice(0, 120); }
    if (motivo === 'ja_enviada') return true;
    await salvar(ok ? { cobranca_enviada_em: clock() } : { cobranca_tentativas: tentativa }).catch(() => {});
    if (!ok && tentativa >= MAX_TENTATIVAS_AVISO) console.error(JSON.stringify({ event: 'etapa_aviso_atencao', id: curto(id), aviso: 'cobranca', motivo: motivo }));
    log({ event: 'etapa_final', id: curto(id), passo: ok ? 'cobranca_enviada' : 'cobranca_falhou', tentativa, motivo: motivo || undefined });
    return ok;
  }

  // ---------------------------------------------------------------- vigia da redação
  // Depois que a etapa 1 confirma a redação no portal, confere a correção (Prova online "Aguardando correção"):
  //  - aprovada: a prova fica concluída E a etapa seguinte abre com o botão do site → aviso "matrícula liberada";
  //  - não aprovada: a prova sai da correção sem concluir e volta a ter o botão → aviso "pode refazer"
  //    (só depois de ver "Aguardando correção", para não confundir com o status antes da sincronização).
  // Ritmo dos outros vigias (10 min nas 2 primeiras horas, depois de hora em hora), por até 15 dias.
  const REDACAO = 'redacaoVigia';
  const AVISOS_REDACAO = {
    aprovada: { processo: 'inscrição no Vestibular 2027/1', situacao: 'Sua redação foi corrigida e você foi aprovado(a)! 🎉', proximo: 'informe o responsável financeiro, seus dados e envie os documentos da matrícula pelo botão abaixo.' },
    reprovada: { processo: 'inscrição no Vestibular 2027/1', situacao: 'Sua redação foi corrigida e não atingiu a nota necessária.', proximo: 'você pode realizar a avaliação mais uma vez pelo botão abaixo.' }
  };
  async function iniciarVigiaRedacao({ login, data_nascimento, celular, nome }) {
    const cpf = digits(login);
    if (cpf.length !== 11 || !data_nascimento) return false;
    const id = hash('redacao:' + cpf);
    const novo = { id, login: cpf, data_nascimento, contato: digits(celular) ? { nome: String(nome ?? ''), celular: digits(celular) } : null, desde: clock(), ate: clock() + VIGIA_MAX_MS, expires: clock() + 20 * DIA };
    const atual = await store.get(id, REDACAO);
    // Nova redação (ex.: refez a avaliação): recomeça o vigia.
    if (atual) await store.update(id, novo, atual.version, REDACAO); else await store.create(id, novo, REDACAO);
    log({ event: 'redacao_vigia', id: curto(id), passo: 'iniciado' });
    // 1ª conferência em 2 min (V1: deixa o status salvo cedo para o LOGIN); depois, o ritmo de sempre.
    await agendarVigia(id, 'redacao_vigia', PRIMEIRA_CONFERENCIA_S, REDACAO);
    return true;
  }
  async function salvarRedacao(id, patch) {
    for (let i = 0; i < 4; i++) { const a = await store.get(id, REDACAO); if (!a) return; if (await store.update(id, { ...a.record, ...patch }, a.version, REDACAO)) return; }
  }
  async function vigiarRedacao(id) {
    const antes = await store.get(id, REDACAO);
    if (!antes || antes.record.fim) return 204;
    if (correnteAntiga(antes.record, 'redacao_vigia')) return 204;
    if (!(await travarVigia(id, 'rodando_ate', REDACAO))) return 503;
    try { return await conferirRedacao(id); }
    finally { await destravarVigia(id, 'rodando_ate', REDACAO); }
  }
  async function conferirRedacao(id) {
    const f = await store.get(id, REDACAO);
    if (!f || f.record.fim) return 204;
    const rec = f.record;
    let proximoEm = intervaloVigia(rec.desde);
    try {
      const sessao = await portalSite.entrar(rec.login, rec.data_nascimento);
      const { stages, processo } = await portalSite.inscricao(sessao);
      // V1: o último status fica salvo para o LOGIN abrir a lista na hora (o portal passa do tempo do WhatsApp).
      await guardarStatusDaInscricao({ applyment_id: sessao.applyment_id, login: rec.login, data_nascimento: rec.data_nascimento, stages, processo }).catch(() => {});
      const st = summarizeStages(stages ?? []);
      const prova = st.rows.find(r => /prova|avaliacao|redacao/.test(norm(r.title)));
      let resultado = null;
      if (!prova) resultado = null;
      else if (emCorrecao(prova)) { if (!rec.viu_correcao) await salvarRedacao(id, { viu_correcao: clock() }); }
      else if (prova.conclusive) { if (st.next && st.next !== prova) resultado = 'aprovada'; }
      else if (rec.viu_correcao && prova.step && prova.action) resultado = 'reprovada';
      log({ event: 'redacao_vigia', id: curto(id), passo: resultado ?? 'aguardando', prova: prova?.status ?? '' });
      if (resultado) {
        let contato = rec.contato;
        if (!contato?.celular && portalSite.pagina) { try { contato = contatoDaResposta(await portalSite.pagina(sessao, 432, processo)); } catch {} }
        const ok = avisos?.configurado?.atualizacao?.() && contato?.celular
          ? await avisos.atualizacao({ celular: contato.celular, nome: contato.nome, ...AVISOS_REDACAO[resultado] }).catch(() => false) : false;
        const tentativas = (rec.tentativas ?? 0) + 1;
        log({ event: 'etapa_aviso', id: curto(id), aviso: 'redacao_' + resultado, enviado: Boolean(ok), motivo: ok ? undefined : contato?.celular ? 'blip' : 'sem_celular' });
        if (!ok && tentativas >= MAX_TENTATIVAS_AVISO && avisos?.configurado?.atualizacao?.()) console.error(JSON.stringify({ event: 'etapa_aviso_atencao', id: curto(id), aviso: 'redacao_' + resultado, motivo: contato?.celular ? 'blip' : 'sem_celular' }));
        if (ok || tentativas >= MAX_TENTATIVAS_AVISO || !avisos?.configurado?.atualizacao?.()) {
          await salvarRedacao(id, { fim: clock(), resultado, aviso_enviado: Boolean(ok), ...(contato?.celular ? { contato } : {}) });
          return 204;
        }
        await salvarRedacao(id, { tentativas, ...(contato?.celular ? { contato } : {}) });
        proximoEm = VIGIA_INTERVALO_S;
      }
    } catch (e) {
      log({ event: 'redacao_vigia', id: curto(id), passo: 'erro', message: String(e?.message ?? e).slice(0, 120) });
    }
    if (clock() < (rec.ate ?? 0)) await agendarVigia(id, 'redacao_vigia', proximoEm, REDACAO);
    else await salvarRedacao(id, { fim: clock(), resultado: 'sem_correcao' });
    return 204;
  }

  // ---------------------------------------------------------------- status salvo para o LOGIN (V1)
  // O portal leva ~7 s e o login tem ~6,5 s: quem já tem o último status salvo vê a lista na hora. O registro da
  // matrícula (mesmo id do login) é criado aqui quando ainda não existe, com o login criptografado, como no login.
  async function guardarStatusDaInscricao({ applyment_id, login, data_nascimento, stages, processo, extra = {} }) {
    if (!applyment_id || !login || !data_nascimento) return null;
    const id = hash('matr:' + applyment_id);
    const ultimo = stages?.length ? { ultimo_status: { stages: enxugar(stages), processo: String(processo ?? ''), at: clock() } } : {};
    for (let i = 0; i < 4; i++) {
      const atual = await store.get(id, FILA);
      if (!atual) {
        const novo = { id, applyment_id: String(applyment_id), flow: '', login: digits(login), data_nascimento, blocos: {}, enviados: {}, status: 'pendente', tentativas: 0, criado: clock(), expires: clock() + 30 * DIA, ...ultimo, ...extra };
        if (await store.create(id, novo, FILA).then(() => true, () => false)) return id;
        continue;
      }
      if (await store.update(id, { ...atual.record, ...ultimo, ...extra }, atual.version, FILA)) return id;
    }
    return id;
  }

  // ---------------------------------------------------------------- vigia da inscrição direta
  // Transferência, Portador e ENEM depois do envio dos documentos de inscrição (e, no ENEM, das notas): confere
  // o portal no ritmo dos outros vigias e avisa pelo Blip (template de atualização, botão abre o Flow):
  //  - aprovado (etapa seguinte liberada, ou ENEM com 38623 entre 4 e 8): fim;
  //  - desclassificado (ENEM, 38623 = 3): texto do site e nova inscrição; fim;
  //  - documento recusado (Documentos inscrição volta a Pendentes): pede o reenvio só dos recusados; segue vigiando.
  const CAMPO_STATUS_OPCAO = 38623;
  function valorDoCampo(resp, campo) {
    const cs = resp?.data?.steps?.currentStep ?? {};
    const a = (cs.applicantData ?? []).find(x => Number(x?.field_id) === campo);
    if (a && a.value !== null && a.value !== undefined && a.value !== '') return String(a.value);
    const todos = [];
    (function achatar(l) { for (const c of l ?? []) { todos.push(c); achatar(c.container_content); } })(cs.content);
    const c = todos.find(x => Number(x?.field_id) === campo);
    return c?.value_now !== undefined && c?.value_now !== null && c.value_now !== '' ? String(c.value_now) : null;
  }
  const primeiroNome = n => String(n ?? '').trim().split(/\s+/)[0] ?? '';
  function textosInscricao(resultado, processo) {
    const p = 'inscrição em ' + tituloProcesso(processo);
    if (resultado === 'aprovado') return { processo: p, situacao: 'Parabéns, você foi aprovado(a) em nosso processo seletivo! 🎉', proximo: 'dê continuidade à sua pré-matrícula pelo botão abaixo (Já sou inscrito).' };
    if (resultado === 'desclassificado') return { processo: p, situacao: 'Não foi dessa vez: suas notas não foram suficientes (desclassificado por insuficiência de nota).', proximo: 'não desista! Há outras formas de ingresso: faça uma nova inscrição pelo botão abaixo.' };
    return { processo: p, situacao: 'Um documento da sua inscrição foi recusado na análise.', proximo: 'envie o documento de novo pelo botão abaixo (Já sou inscrito → Documentos inscrição).' };
  }
  async function iniciarVigiaInscricao({ applyment_id, processo, login, data_nascimento, contato, stages }) {
    // Reenvio depois de uma recusa: mantém a contagem de recusas (cada nova recusa tem o seu aviso).
    const antigo = applyment_id ? (await store.get(hash('matr:' + applyment_id), FILA).catch(() => null))?.record?.insc_vigia : null;
    const recusas = (antigo?.recusas ?? 0) + (antigo?.em_recusa ? 1 : 0);
    const extra = { insc_vigia: { desde: clock(), ate: clock() + VIGIA_MAX_MS, processo: String(processo ?? ''), recusas }, docs_inscricao_recusados: [], ...(contato?.celular ? { contato: { nome: String(contato.nome ?? ''), celular: digits(contato.celular) } } : {}) };
    const id = await guardarStatusDaInscricao({ applyment_id, login, data_nascimento, stages, processo, extra });
    if (!id) return false;
    log({ event: 'inscricao_vigia', id: curto(id), passo: 'iniciado' });
    await agendarVigia(id, 'inscricao_vigia', VIGIA_INTERVALO_S);
    return true;
  }
  async function vigiarInscricao(id) {
    const antes = await store.get(id, FILA);
    if (!antes || antes.record.insc_vigia?.fim) return 204;
    if (correnteAntiga(antes.record, 'inscricao_vigia')) return 204;
    if (!(await travarVigia(id, 'insc_rodando_ate'))) return 503;
    try { return await conferirInscricao(id); }
    finally { await destravarVigia(id, 'insc_rodando_ate'); }
  }
  async function conferirInscricao(id) {
    const f = await store.get(id, FILA);
    if (!f || f.record.insc_vigia?.fim) return 204;
    const rec = f.record, v = rec.insc_vigia ?? { desde: clock(), ate: clock() + VIGIA_MAX_MS };
    const salvarFila = salvarFilaDe(id);
    let proximoEm = intervaloVigia(v.desde);
    try {
      const sessao = await portalSite.entrar(rec.login, rec.data_nascimento);
      const { stages, processo: procPortal } = await portalSite.inscricao(sessao);
      const processo = procPortal || v.processo || rec.ultimo_status?.processo || '';
      await salvarStatus(id, stages, processo).catch(() => {});
      const st = summarizeStages(stages ?? []);
      const notas = st.rows.find(r => ehNotasEnem(r.title));
      let statusOpcao = null;
      if (notas?.step) {
        try {
          const bruto = await portalSite.passoBruto(sessao, notas.step, processo);
          statusOpcao = valorDoCampo(bruto, CAMPO_STATUS_OPCAO);
          await guardarContato(id, rec, contatoDaResposta(bruto));
        } catch (e) { log({ event: 'inscricao_vigia', id: curto(id), passo: 'notas_erro', message: String(e?.message ?? e).slice(0, 80) }); }
      }
      const resultado = avaliarInscricao(st, { statusOpcao });
      log({ event: 'inscricao_vigia', id: curto(id), passo: resultado ?? 'aguardando', status_opcao: statusOpcao ?? '', docs: st.rows.find(r => ehDocsInscricao(r.title))?.status ?? '' });
      if (resultado === 'recusado') {
        const docs = st.rows.find(r => ehDocsInscricao(r.title));
        let recusados = [];
        try { recusados = (await portalSite.passoDocumentos(sessao, docs.step, processo)).docs.filter(d => String(d.status) === '2').map(d => d.codigo); } catch {}
        // Pendentes sem recusa marcada (ex.: equipe pediu um documento que faltou): pede a lista toda.
        // Um aviso por recusa: a chave muda só quando os documentos voltam para análise e são recusados de novo.
        const chave = `docs_inscricao_recusa_${v.recusas ?? 0}`;
        await salvarFila({ docs_inscricao_recusados: recusados, insc_vigia: { ...v, em_recusa: true } });
        await avisar(id, chave, { sessao, processo, textos: textosInscricao('recusado', processo) }).catch(() => false);
        // Segue vigiando: o reenvio volta a "Em análise".
      } else if (!resultado && v.em_recusa) {
        // Reenviado (voltou para análise): a próxima recusa é um novo ciclo, com novo aviso.
        await salvarFila({ insc_vigia: { ...v, em_recusa: false, recusas: (v.recusas ?? 0) + 1 }, docs_inscricao_recusados: [] });
      } else if (resultado) {
        const ok = await avisar(id, 'inscricao_' + resultado, { sessao, processo, textos: textosInscricao(resultado, processo) }).catch(() => false);
        const tentativas = ((await store.get(id, FILA))?.record?.avisos_tentativas?.['inscricao_' + resultado]) ?? 0;
        if (ok || !avisos?.configurado?.atualizacao?.() || tentativas >= MAX_TENTATIVAS_AVISO) {
          await salvarFila({ insc_vigia: { ...v, fim: clock(), resultado, aviso_enviado: Boolean(ok) }, docs_inscricao_recusados: [] });
          // Aprovado: a etapa 2 segue igual à do Vestibular (religa os vigias da matrícula pelo status atual).
          if (resultado === 'aprovado') await religarVigias(id, st);
          return 204;
        }
        proximoEm = VIGIA_INTERVALO_S;
      }
    } catch (e) {
      if (e?.agendar) throw e;
      log({ event: 'inscricao_vigia', id: curto(id), passo: 'erro', message: String(e?.message ?? e).slice(0, 120) });
    }
    if (clock() < (v.ate ?? 0)) await agendarVigia(id, 'inscricao_vigia', proximoEm);
    else await salvarFila({ insc_vigia: { ...v, fim: clock(), resultado: 'sem_resultado' } }).catch(() => {});
    return 204;
  }

  async function route(req) {
    if (req?.action !== 'data_exchange' || !String(req.screen ?? '').startsWith('MATR_')) return null;
    try { return await routeTela(req); }
    catch (e) {
      console.error(JSON.stringify({ event: 'etapa2_fila_atencao', motivo: 'erro_tela', screen: req.screen, message: String(e?.message ?? e).slice(0, 160) }));
      return fim('Algo deu errado', 'Não conseguimos continuar agora. Abra a mensagem de novo em alguns minutos.');
    }
  }

  async function routeTela(req) {
    const d = req.data ?? {}, acao = d.acao, screen = req.screen;

    // Login igual ao Portal do candidato: CPF + data de nascimento (validado no Rubeus, ao vivo). É a única
    // consulta em tempo real da etapa 2: a partir dela o Cloud Run sabe de quem são os dados.
    if ((screen === 'MATR_INICIO' || screen === 'MATR_LOGIN') && acao === 'entrar') {
      const u = pick(d, ['login', 'data_nascimento']);
      const volta = erro => render('MATR_LOGIN', { values: u, erro });
      const texto = String(u.login ?? '').trim();
      if (!validCpf(texto)) return volta('Confira o CPF (11 números).');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(u.data_nascimento ?? ''))) return volta('Informe a data de nascimento.');
      const login = digits(texto);
      const t0 = clock();
      let sessao;
      try { sessao = await matricula.login(login, u.data_nascimento); }
      catch (e) {
        // Rede, tempo esgotado, resposta não JSON ou HTTP 5xx = sistema fora; qualquer outra recusa = dados não conferem.
        const m = String(e?.message ?? e);
        if (!/HTTP 5\d\d|demorou|abort|fetch failed|ECONN|ETIMEDOUT|ENOTFOUND|network|RUBEUS_RESPOSTA/i.test(m)) return volta('Não encontramos uma inscrição com esses dados. Confira e tente de novo.');
        log({ event: 'etapa2_fila', passo: 'login_indisponivel', message: m.slice(0, 80), ms: clock() - t0 });
        return volta('O sistema da UniBalsas está indisponível no momento. Tente de novo em alguns minutos.');
      }
      if (!sessao.applyment_id) return volta('Não encontramos uma inscrição com esses dados.');
      const id = hash('matr:' + sessao.applyment_id);
      const flow = hash(req.flow_token ?? '');
      // Situação das etapas, como no portal. Quem decide o que está liberado é o portal (próximo passo);
      // a única espera é a prova "Aguardando correção". Se o portal demorar, segue e o worker confere a ordem.
      let s2 = null, stLido = null;
      try {
        const st = stLido = await Promise.race([matricula.portal(sessao), new Promise((_, r) => setTimeout(() => r(new Error('lento')), Math.max(1500, esperaPortalMs - (clock() - t0))))]);
        s2 = summarizeStages(st.stages ?? []);
        // Próximo passo é a prova: segue para a redação, como na jornada direta da etapa 1.
        if (s2.next && /prova|avaliacao|redacao/.test(norm(s2.next.title)) && entrarNaProva) {
          return await entrarNaProva({ applyment_id: sessao.applyment_id, processo: st.processo_seletivo_id, login, data_nascimento: u.data_nascimento, flowToken: req.flow_token });
        }
      } catch (e) { log({ event: 'etapa2_fila', passo: 'portal_lento', message: String(e?.message ?? e).slice(0, 60) }); }
      // Inscrição da matrícula no Firestore (login e data de nascimento ficam criptografados, para o worker entrar no Rubeus).
      const novo = { id, applyment_id: sessao.applyment_id, flow, login, data_nascimento: u.data_nascimento, blocos: {}, enviados: {}, status: 'pendente', tentativas: 0, criado: clock(), expires: clock() + 30 * DIA };
      const ultimo = s2 ? { ultimo_status: { stages: enxugar(stLido.stages), processo: String(stLido.processo_seletivo_id ?? ''), at: clock() } } : {};
      // Uma escrita só: fila + último status (sem reler depois).
      let rec = null, agendar = false;
      for (let i = 0; i < 3 && !rec; i++) {
        const atual = await store.get(id, FILA);
        if (!atual) { const r = { ...novo, ...ultimo }; if (await store.create(id, r, FILA).then(() => true, () => false)) rec = r; continue; }
        const a = atual.record;
        // Fila que falhou (ex.: sistema acadêmico fora do ar): entrar de novo reabre e retoma o envio do que já foi gravado.
        const reabrir = a.status === 'falhou';
        // Dado gravado sem worker rodando (agendamento perdido): agenda o envio de novo.
        const parado = a.status === 'pendente' && (a.rodando_ate ?? 0) <= clock() && (
          Object.keys(a.blocos ?? {}).some(b => b !== 'documentos' && !a.enviados?.[b]) ||
          (a.blocos?.documentos?.completo && Object.keys(a.blocos.documentos.arquivos ?? {}).some(k => !a.enviados_docs?.[k])));
        const r = { ...a, flow, login, data_nascimento: novo.data_nascimento, ...ultimo, ...(reabrir ? { status: 'pendente', tentativas: 0, rodando_ate: 0 } : {}) };
        if (await store.update(id, r, atual.version, FILA)) { rec = r; agendar = reabrir || parado; if (agendar) log({ event: 'etapa2_fila', id: curto(id), passo: reabrir ? 'reaberta' : 'retomada' }); }
      }
      if (!rec) rec = (await store.get(id, FILA))?.record ?? novo;
      if (agendar) { try { await enqueue(id, { tipo: 'etapa2' }); } catch {} }
      const menor = (idade(u.data_nascimento) ?? 18) < 18;
      if (s2) await religarVigias(id, s2);
      else {
        s2 = statusSalvo(rec);
        // Portal lento: busca em segundo plano; o candidato toca em Atualizar (ou já usa o último status salvo).
        try { await enqueue(id, { tipo: 'etapa2_status' }); } catch {}
      }
      log({ event: 'etapa2_fila', id: curto(id), passo: 'login', ms: clock() - t0 });
      // Tela inicial após o login = status do Portal do candidato, com o botão da etapa pendente (como no site).
      return telaPortal({ id, menor, s2, blocos: rec.blocos, rec, flowToken: req.flow_token });
    }

    let s;
    try { s = openState(d.estado, screen); } catch { return fim('Sessão expirada', 'Esta sessão ficou muito tempo parada. Abra a mensagem de novo e entre com seu CPF e data de nascimento.'); }
    if (!s.m2) return null;
    const base = { m2: true, fila_id: s.fila_id, menor: s.menor };

    if (screen === 'MATR_PORTAL' && acao === 'continuar') {
      // Nada a continuar no Flow agora (aguardando a equipe, ou etapa ainda fora do Flow): fecha.
      if (s.destino === null) return sucesso(req.flow_token);
      if (s.destino === 'atualizar') {
        const rec = (await store.get(s.fila_id, FILA))?.record;
        return telaPortal({ id: s.fila_id, menor: s.menor, s2: statusSalvo(rec), blocos: rec?.blocos, rec, flowToken: req.flow_token });
      }
      const destino = s.destino || (s.menor ? 'MATR_RESP_DADOS' : 'MATR_RESPONSAVEL');
      try { return await abrirDestino(destino, s, base, req.flow_token); }
      catch { return render('MATR_PORTAL', { ...s, resumo: 'Não conseguimos abrir esta etapa agora. Toque de novo em instantes.' }); }
    }

    // Lista de status: toque numa etapa.
    if (screen === 'MATR_STATUS' && acao === 'abrir_etapa') {
      const rec = (await store.get(s.fila_id, FILA))?.record;
      const st = statusSalvo(rec);
      const voltar = () => st ? render('MATR_STATUS', { etapas: itensStatus({ id: s.fila_id, menor: s.menor, s2: st }) }) : render('MATR_PORTAL', { ...base, destino: 'atualizar', botao: 'Atualizar', resumo: BUSCANDO });
      const e = s.etapa ?? {};
      if (!e.aberta) return voltar(); // concluída ou aguardando a equipe: só o status, como no site
      const t = norm(e.title);
      // Documentos de inscrição (Transferência, Portador, ENEM): telas da etapa 1; se a equipe recusou algum,
      // pede só os recusados (lidos pelo vigia).
      if (ehDocsInscricao(e.title) && entrarNosDocsInscricao && rec) {
        return entrarNosDocsInscricao({ applyment_id: rec.applyment_id, processo: rec.ultimo_status?.processo, login: rec.login, data_nascimento: rec.data_nascimento, flowToken: req.flow_token, codigos: rec.docs_inscricao_recusados ?? [] });
      }
      if (/prova|avaliacao|redacao/.test(t) && entrarNaProva && rec) {
        return entrarNaProva({ applyment_id: rec.applyment_id, processo: rec.ultimo_status?.processo, login: rec.login, data_nascimento: rec.data_nascimento, flowToken: req.flow_token });
      }
      const destino = proximaTela({ next: { title: e.title, action: e.action }, rows: st?.rows ?? [] }, rec?.blocos ?? {}, s.menor).tela;
      if (destino) {
        try { return await abrirDestino(destino, s, base, req.flow_token); } catch { return voltar(); }
      }
      if (/resp|pre.?matric|document/.test(t)) return fim(e.title, 'Recebemos tudo desta etapa. A equipe vai conferir; acompanhe a situação por aqui.');
      // Pagamento: a cobrança Pix vai por mensagem no WhatsApp (o Pix leva ~20 s para sair, não é gerado na tela).
      if (/pagamento|taxa/.test(t) && rec && avisos?.configurado?.cobranca?.()) {
        if (rec.cobranca_enviada_em) return fim('Pagamento', 'Enviamos o Pix da taxa de matrícula por mensagem aqui no WhatsApp. Para pagar com cartão, acesse o Portal do candidato.');
        if ((rec.cobranca_tentativas ?? 0) < MAX_TENTATIVAS_AVISO) {
          try {
            if (!rec.final_vigiando) await salvarFilaDe(s.fila_id)({ final_vigiando: clock() }).catch(() => {});
            await agendarVigia(s.fila_id, 'etapa4_vigia', 5);
            return fim('Pagamento', 'Você vai receber o Pix da taxa de matrícula por mensagem em instantes. Para pagar com cartão, acesse o Portal do candidato.');
          } catch {}
        }
      }
      // Etapa ainda fora do Flow (ex.: pagamento): orientação do site.
      const info = portalScreenData(e.title);
      return fim(info.titulo, String(info.mensagem).split('\n\nEntre com')[0]);
    }

    if (screen === 'MATR_RESPONSAVEL' && acao === 'enviar_responsavel') {
      const u = pick(d, ['responsavel']);
      if (!['Eu', 'Outro'].includes(u.responsavel)) return render(screen, { ...s, values: u, erro: 'Escolha quem será o responsável financeiro.' });
      try { await gravarBloco(s, req.flow_token, 'responsavel', u); } catch { return render(screen, { ...s, values: u, erro: ERRO_GRAVAR }); }
      // Menor de 18 anos ou "Outro": o site pede os dados do responsável.
      if (u.responsavel === 'Outro' || s.menor) return render('MATR_RESP_DADOS', { ...base, erro: '' });
      return render('MATR_ENDERECO', { ...base, erro: '' });
    }

    if (screen === 'MATR_RESP_DADOS' || screen === 'MATR_ENDERECO') {
      const nomes = screen === 'MATR_RESP_DADOS' ? ['nome', 'email', 'cpf', 'data_nascimento', 'celular', ...END] : END;
      const u = pick(d, nomes);
      if (acao === 'buscar_cep') return preencherCep(screen, s, u);
      if (acao !== 'enviar_endereco') return null;
      try { validarEndereco(u, { responsavel: screen === 'MATR_RESP_DADOS' }); } catch (e) { return render(screen, { ...s, values: u, erro: e.message }); }
      u.uf = String(u.uf).toUpperCase();
      try { await gravarBloco(s, req.flow_token, screen === 'MATR_RESP_DADOS' ? 'resp_dados' : 'endereco', u); } catch { return render(screen, { ...s, values: u, erro: ERRO_GRAVAR }); }
      return render(screen === 'MATR_RESP_DADOS' ? 'MATR_ENDERECO' : 'MATR_IDENTIDADE', { ...base, erro: '' });
    }

    const IDENT_CAMPOS = ['rg', 'orgao_emissor', 'uf_rg', 'cor_raca', 'estado_civil', 'ano_conclusao', 'busca_escola', 'escola'];
    if (screen === 'MATR_IDENTIDADE' && acao === 'buscar_escola') {
      const u = pick(d, IDENT_CAMPOS);
      const volta = (erro, escolas = []) => render(screen, { ...s, values: { ...u, escola: '' }, escolas, erro });
      if (norm(u.busca_escola).replace(/[^a-z0-9]/g, '').length < 3) return volta('Digite pelo menos 3 letras do nome da escola e toque em Buscar escola.');
      let lista;
      // O Rubeus pode passar do tempo do WhatsApp (~10 s): sem cache, tenta no máximo 5 s e libera a tela.
      try { lista = await Promise.race([carregarEscolas(s.fila_id), new Promise((_, r) => setTimeout(() => r(new Error('lento')), 5000))]); }
      catch (e) {
        log({ event: 'etapa2_fila', id: curto(s.fila_id), passo: 'escolas_indisponivel', message: String(e?.message ?? e).slice(0, 80) });
        return volta('Não conseguimos carregar a lista de escolas agora. Pode tocar em Avançar: guardamos o nome digitado (o campo é opcional).');
      }
      const achadas = buscarEscolas(lista, u.busca_escola).map(opcaoEscola);
      return volta(achadas.length ? '' : 'Nenhuma escola encontrada com esse nome. Tente outra parte do nome ou escolha "Não encontrei a minha escola".', [...achadas, OPCAO_SEM_ESCOLA]);
    }

    if (screen === 'MATR_IDENTIDADE' && acao === 'enviar_identidade') {
      const u = pick(d, IDENT_CAMPOS);
      const escolhida = u.escola && u.escola !== SEM_ESCOLA ? String(u.escola) : '';
      const erro = !String(u.rg ?? '').trim() ? 'Informe o número da identidade.'
        : !String(u.orgao_emissor ?? '').trim() ? 'Informe o órgão emissor.'
        : !UFS.some(o => o.id === u.uf_rg) ? 'Selecione a UF da identidade.'
        : !RACAS.some(o => o.id === u.cor_raca) ? 'Selecione cor/raça.'
        : !ESTADOS_CIVIS.some(o => o.id === u.estado_civil) ? 'Selecione o estado civil.'
        : u.ano_conclusao && !(/^\d{4}$/.test(u.ano_conclusao) && Number(u.ano_conclusao) >= 1995 && Number(u.ano_conclusao) <= new Date().getFullYear() + 1) ? 'Confira o ano de conclusão (4 números, de 1995 em diante).'
        : '';
      if (erro) return render(screen, { ...s, values: u, escolas: await opcoesDoCache(u.busca_escola), erro });
      // Grava o código da escola escolhida na lista (o mesmo do formulário do Rubeus) e o nome, para conferência.
      // Escolhida na lista: código + nome. Só digitada (lista indisponível): vai o nome, e o worker procura no formulário do Rubeus, como antes.
      const nomeEscola = escolhida ? ((await lerEscolas())?.find(o => o.id === escolhida)?.title ?? '') : u.escola === SEM_ESCOLA ? '' : String(u.busca_escola ?? '').trim();
      const bloco = { rg: u.rg, orgao_emissor: u.orgao_emissor, uf_rg: u.uf_rg, cor_raca: u.cor_raca, estado_civil: u.estado_civil, ano_conclusao: u.ano_conclusao ?? '', escola_id: escolhida, escola: nomeEscola };
      try { await gravarBloco(s, req.flow_token, 'identidade', bloco); } catch { return render(screen, { ...s, values: u, escolas: await opcoesDoCache(u.busca_escola), erro: ERRO_GRAVAR }); }
      return render(DOCS[0].tela, { ...base, erro: '' });
    }

    // Documentos de matrícula: um por tela (o WhatsApp aceita um seletor de arquivo por tela). Ficam
    // guardados e vão ao sistema acadêmico com calma, no fim, como a redação.
    const iDoc = DOCS.findIndex(x => x.tela === screen);
    if (iDoc >= 0 && acao === 'enviar_documento') {
      const doc = DOCS[iDoc];
      const media = Array.isArray(d.arquivo) ? d.arquivo : [];
      if (doc.obrigatorio && media.length !== 1) return render(screen, { ...s, erro: `Anexe o arquivo: ${doc.titulo}.` });
      const ultimo = iDoc === DOCS.length - 1;
      try { await gravarDocumento(s, req.flow_token, doc.id, media, ultimo); } catch { return render(screen, { ...s, erro: ERRO_GRAVAR }); }
      if (!ultimo) return render(DOCS[iDoc + 1].tela, { ...base, erro: '' });
      return fim('Documentos enviados ✅', 'Seus documentos foram recebidos e estão em análise. A análise ocorre em até 48 horas úteis.\n\nAcompanhe a situação no Portal do Candidato.');
    }
    return null;
  }

  // ---------------------------------------------------------------- worker (Rubeus, uma subetapa por vez)
  // Converte o bloco do Flow (texto) para os valores do formulário atual do Rubeus.
  async function montarDados(tela, st, bloco) {
    if (tela === 'RESP_FINANCEIRO') {
      const id = escolherOpcao(st.opcoes_responsavel, bloco.responsavel);
      if (!id) throw new ErroPasso('Opção de responsável financeiro não encontrada no formulário.', { final: true, motivo: 'opcao' });
      return { ...st, responsavel: id };
    }
    if (tela === 'ENDERECO' || tela === 'RESP_DADOS') {
      const uf = escolherOpcao(st.ufs, bloco.estado_natal);
      if (!uf) throw new ErroPasso('Estado natal não encontrado no formulário.', { final: true, motivo: 'estado_natal' });
      let cidades = [];
      try { cidades = await matricula.cities({ ...st, estado_natal: uf, busca_cidade: bloco.cidade_natal }); } catch {}
      const cidade = escolherOpcao(cidades, bloco.cidade_natal) ?? (cidades.length === 1 ? cidades[0].id : null);
      if (!cidade) throw new ErroPasso('Cidade natal não encontrada no formulário.', { final: true, motivo: 'cidade_natal' });
      const extra = tela === 'RESP_DADOS' ? { nome: bloco.nome, email: bloco.email, cpf_informado: bloco.cpf, data_nascimento: bloco.data_nascimento, celular: bloco.celular } : {};
      return { ...st, ...extra, cep: bloco.cep, rua: bloco.rua, numero: bloco.numero, complemento: bloco.complemento, bairro: bloco.bairro, cidade: bloco.cidade, uf: bloco.uf, estado_natal: uf, cidade_natal: cidade, cidades_natal: cidades };
    }
    if (tela === 'IDENTIDADE') {
      const uf_rg = escolherOpcao(st.ufs, bloco.uf_rg);
      const cor = escolherOpcao(st.racas, RACAS.find(r => r.id === bloco.cor_raca)?.title, { prefixo: 4 });
      const civil = escolherOpcao(st.estados_civis, ESTADOS_CIVIS.find(r => r.id === bloco.estado_civil)?.title, { prefixo: 5 });
      if (!uf_rg || !cor || !civil) throw new ErroPasso('Opção de identidade não encontrada no formulário.', { final: true, motivo: 'opcao' });
      let escola = '', escolas = [];
      if (bloco.escola_id && st.campos?.escola) {
        escola = String(bloco.escola_id);
        escolas = [{ id: escola, title: bloco.escola || escola }];
      } else if (bloco.escola && st.campos?.escola) {
        try { escolas = await matricula.schools({ ...st, busca_escola: bloco.escola }); } catch {}
        escola = escolherOpcao(escolas, bloco.escola) ?? (escolas.length === 1 ? escolas[0].id : '');
      }
      return { ...st, rg: bloco.rg, orgao_emissor: bloco.orgao_emissor, uf_rg, cor_raca: cor, estado_civil: civil, escola, escolas, ano_conclusao: st.campos?.ano_conclusao ? (bloco.ano_conclusao ?? '') : '' };
    }
    if (tela === 'CUPOM') return { ...st, cupom: bloco.cupom ?? '' };
    throw new ErroPasso('Tela inesperada: ' + tela, { final: true });
  }

  async function worker(id) {
    const inicio = clock();
    let f = await store.get(id, FILA);
    if (!f || FINAIS.has(f.record.status)) return 204;
    if ((f.record.rodando_ate ?? 0) > clock()) { await enqueue(id, { tipo: 'etapa2', atrasoSeg: 30 }).catch(() => {}); return 204; }
    if (!await store.update(id, { ...f.record, rodando_ate: clock() + 170000 }, f.version, FILA)) return 204;
    f = await store.get(id, FILA);
    let rec = f.record, version = f.version;
    async function salvar(patch) {
      for (let i = 0; i < 5; i++) {
        const atual = i === 0 ? { record: rec, version } : await store.get(id, FILA);
        const novo = { ...atual.record, ...patch, blocos: patch.limpar_docs ? { ...atual.record.blocos, documentos: { completo: true } } : atual.record.blocos };
        delete novo.limpar_docs;
        if (await store.update(id, novo, atual.version, FILA)) { const l = await store.get(id, FILA); rec = l.record; version = l.version; return; }
        if (i === 0) { const l = await store.get(id, FILA); rec = l.record; version = l.version; }
      }
      throw new Error('Não foi possível gravar o andamento da matrícula.');
    }
    // Documentos de matrícula pelo mesmo caminho do site (api/portal-site.js): entra no Portal do candidato,
    // lê o passo de documentos, envia num único "Enviar" (multipart file_0…) e confere no próprio passo.
    async function entregarDocumentos(passoId, docsB) {
      const sessao = await portalSite.entrar(rec.login ?? rec.cpf, rec.data_nascimento);
      let processo = '';
      try { processo = await portalSite.processo(sessao); } catch {}
      if (!processo) processo = (await portalSite.inscricao(sessao)).processo;
      if (!processo) throw new ErroPasso('Processo seletivo da inscrição não encontrado no portal.', { motivo: 'processo' });
      const passo = await portalSite.passoDocumentos(sessao, passoId, processo);
      const naLista = new Map(passo.docs.map(d => [d.codigo, d]));
      const arquivos = [], jaNoPortal = [];
      for (const doc of DOCS) {
        const media = docsB.arquivos?.[doc.id];
        if (!media?.length || rec.enviados_docs?.[doc.id]) continue;
        const linha = naLista.get(doc.id);
        if (!linha) { log({ event: 'etapa2_fila', id: curto(id), passo: 'documento_fora_da_lista', doc: doc.id }); continue; }
        if (jaEnviado(linha)) { jaNoPortal.push(doc.id); continue; } // já enviado (ex.: pelo site): não reenvia
        const m = media[0];
        const tipo = tipoDoArquivo(m.file_name) ?? 'application/pdf';
        const bytes = await baixarMidia(m);
        if (bytes.length > passo.max_mb * 1024 * 1024) throw new ErroPasso(`Arquivo do documento ${doc.id} acima de ${passo.max_mb} MB.`, { final: true, motivo: 'tamanho' });
        arquivos.push({ codigo: doc.id, bytes, nome: String(m.file_name || `documento-${doc.id}.pdf`).slice(-80), tipo });
      }
      const marcados = Object.fromEntries([...arquivos.map(a => a.codigo), ...jaNoPortal].map(c => [c, clock()]));
      if (arquivos.length) {
        await portalSite.enviarDocumentos({ sessao, passo, processo, arquivos });
        // Conferência: o próprio passo passa a mostrar os documentos como enviados (em análise).
        let conferidos = [];
        try { const depois = await portalSite.passoDocumentos(sessao, passoId, processo); conferidos = depois.docs.filter(jaEnviado).map(d => d.codigo); } catch {}
        for (const a of arquivos) log({ event: 'etapa2_fila', id: curto(id), passo: 'documento_enviado', doc: a.codigo, conferido: conferidos.includes(a.codigo) });
      }
      for (const c of jaNoPortal) log({ event: 'etapa2_fila', id: curto(id), passo: 'documento_ja_no_portal', doc: c });
      await salvar({ enviados_docs: { ...rec.enviados_docs, ...marcados } });
    }
    try {
      await runCtx(async () => {
        let sessao = await matricula.login(rec.login ?? rec.cpf, rec.data_nascimento);
        while (clock() - inicio < orcamentoMs) {
          // O portal diz qual é o próximo passo liberado (os concluídos ficam de fora).
          const p = await matricula.portal(sessao);
          sessao = { ...sessao, token: p.token, processo_seletivo_id: p.processo_seletivo_id };
          await salvar({ ultimo_status: { stages: enxugar(p.stages), processo: String(p.processo_seletivo_id ?? ''), at: clock() } });
          const next = summarizeStages(p.stages).next;
          if (!next) { await salvar({ status: 'concluida', passo: 'fim' }); return; }
          // Documentos de inscrição são da etapa 1 (telas INSC_DOC_*, envio pelo worker da etapa 1).
          if (ehDocsInscricao(next.title)) { await salvar({ passo: 'aguardando_docs_inscricao' }); return; }
          if (/document/.test(norm(next.title))) {
            const docsB = rec.blocos?.documentos;
            if (!docsB?.completo) { await salvar({ passo: 'aguardando_documentos' }); return; }
            const pronta = (rec.enviados?.identidade ?? 0) + esperaDocsMs;
            if (clock() < pronta) {
              await salvar({ passo: 'documentos_espera' });
              await enqueue(id, { tipo: 'etapa2', atrasoSeg: Math.ceil((pronta - clock()) / 1000) });
              return;
            }
            await entregarDocumentos(next.step, docsB);
            // Entregue: as referências dos arquivos (com as chaves de criptografia) não ficam guardadas.
            await salvar({ status: 'concluida', passo: 'fim', limpar_docs: true });
            try { await agendarVigia(id, 'etapa3_vigia', VIGIA_INTERVALO_S); } catch {}
            return;
          }
          const tela = await matricula.open(sessao, next);
          // Aquece a lista de escolas para a busca do Flow (a pessoa costuma estar preenchendo a identidade agora).
          if (tela.screen === 'IDENTIDADE' && !(await lerEscolas())) {
            try { const l = await matricula.schoolOptions(openState(tela.data.estado, tela.screen)); if (l?.length) await gravarEscolas(l); }
            catch (e) { log({ event: 'etapa2_fila', id: curto(id), passo: 'escolas_cache_erro', message: String(e?.message ?? e).slice(0, 80) }); }
          }
          const bloco = BLOCO_DA_TELA[tela.screen];
          if (!bloco) {
            // Próximo passo não é desta etapa (documentos, contrato…): a etapa 2 terminou se todos os blocos foram enviados.
            const faltando = ['responsavel', 'endereco', 'identidade'].filter(b => !rec.enviados?.[b]);
            await salvar(faltando.length ? { passo: 'aguardando_' + tela.screen.toLowerCase() } : { status: 'concluida', passo: 'fim', proxima_etapa: next.title });
            return;
          }
          const dados = rec.blocos?.[bloco] ?? (bloco === 'cupom' ? { cupom: '' } : null);
          if (!dados) { await salvar({ passo: 'aguardando_' + bloco }); return; }
          const st = openState(tela.data.estado, tela.screen);
          if (tela.screen === 'CUPOM' && !dados.cupom) {
            // Sem cupom: o passo é opcional no site; a etapa 2 termina aqui.
            await salvar({ status: 'concluida', passo: 'fim', enviados: { ...rec.enviados, cupom: 'sem_cupom' } });
            return;
          }
          const montado = await montarDados(tela.screen, st, dados);
          const r = await matricula.send(tela.screen, montado);
          sessao = { ...sessao, token: r.token ?? sessao.token };
          await salvar({ enviados: { ...rec.enviados, [bloco]: clock() }, passo: bloco });
          log({ event: 'etapa2_fila', id: curto(id), passo: 'enviado', bloco, ms: clock() - inicio });
        }
        await enqueue(id, { tipo: 'etapa2' });
      });
      await salvar({ rodando_ate: 0 });
      log({ event: 'etapa2_fila', id: curto(id), passo: rec.passo, status: rec.status });
    } catch (e) {
      const tentativas = (rec.tentativas ?? 0) + 1;
      const final = e instanceof ErroPasso && e.final;
      const status = final ? 'conferir' : tentativas >= MAX_TENTATIVAS ? 'falhou' : rec.status;
      await salvar({ status, tentativas, ultimo_erro: String(e?.message ?? e).slice(0, 200), rodando_ate: 0 });
      const ev = { event: FINAIS.has(status) ? 'etapa2_fila_atencao' : 'etapa2_fila_erro', id: curto(id), passo: rec.passo, status, motivo: e?.motivo ?? 'erro', applyment_id: rec.applyment_id ?? '', message: String(e?.message ?? e).slice(0, 160) };
      FINAIS.has(status) ? console.error(JSON.stringify(ev)) : log(ev);
      if (!FINAIS.has(status)) await enqueue(id, { tipo: 'etapa2', atrasoSeg: Math.min(600, 30 * 2 ** tentativas) }).catch(() => {});
    }
    return 204;
  }

  return { route, worker, render, atualizarStatus, baixarContrato, criarLinkContrato, vigiarContrato, vigiarFinal, iniciarVigiaRedacao, vigiarRedacao, iniciarVigiaInscricao, vigiarInscricao, guardarStatusDaInscricao };
}
