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
import { summarizeStages } from './matricula.js';
import { jaEnviado, tipoDoArquivo } from './portal-site.js';

const DIA = 86400000;
const FILA = 'matriculaFila';
const FINAIS = new Set(['concluida', 'conferir', 'falhou']);
const MAX_TENTATIVAS = 6;
const hash = v => crypto.createHash('sha256').update(String(v)).digest('hex');
const curto = id => String(id).slice(0, 10);
const digits = v => String(v ?? '').replace(/\D/g, '');
export const norm = v => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

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
  if (next && !/resp|pre.?matric|document/.test(norm(next.title))) return fechar;
  const concluida = re => (s2?.rows ?? []).some(r => r.conclusive && re.test(norm(r.title)));
  const quem = blocos.responsavel?.responsavel;
  const respOk = concluida(/resp/) || (quem === 'Eu' && !menor) || ((quem === 'Outro' || menor) && Boolean(blocos.resp_dados));
  const preOk = concluida(/pre.?matric/);
  const tela = !respOk ? (quem === 'Outro' || menor ? 'MATR_RESP_DADOS' : 'MATR_RESPONSAVEL')
    : !preOk && !blocos.endereco ? 'MATR_ENDERECO'
    : !preOk && !blocos.identidade ? 'MATR_IDENTIDADE'
    : !blocos.documentos?.completo && !concluida(/document/) ? DOCS[0].tela
    : null;
  if (!tela) return fechar;
  return { tela, botao: String(next?.action || 'Continuar matrícula').slice(0, 35) };
}

export function createEtapa2({
  store, enqueue, sealState, openState, matricula, runCtx = fn => fn(), validCpf,
  buscarCep = null, clock = Date.now, log = e => console.info(JSON.stringify(e)), orcamentoMs = 80000,
  portalSite = null, baixarMidia = null, entrarNaProva = null,
  // Espera máxima pelo status do portal no login (o WhatsApp corta a resposta em ~10 s, contando o login).
  esperaPortalMs = Number(process.env.ETAPA2_ESPERA_PORTAL_MS) || 7500,
  // Calma antes dos documentos: o RM gera o RA e sincroniza a inscrição depois da identidade.
  esperaDocsMs = Number(process.env.ETAPA2_ESPERA_DOCS_MS) || 120000
}) {
  // ---------------------------------------------------------------- telas do Flow
  const valor = (...n) => n.map(x => 'valor_' + x);
  const END = ['cep', 'rua', 'numero', 'complemento', 'bairro', 'cidade', 'uf', 'estado_natal', 'cidade_natal'];
  const KEYS = {
    MATR_LOGIN: ['erro', 'tem_erro', ...valor('login', 'data_nascimento')],
    MATR_PORTAL: ['estado', 'resumo', 'botao'],
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
        try { await enqueue(s.fila_id, { tipo: 'etapa2' }); } catch (e) { log({ event: 'etapa2_fila_erro', passo: 'agendar', message: String(e?.message ?? e).slice(0, 120) }); }
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
          try { await enqueue(s.fila_id, { tipo: 'etapa2' }); } catch (e) { log({ event: 'etapa2_fila_erro', passo: 'agendar', message: String(e?.message ?? e).slice(0, 120) }); }
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
      catch { return volta('Não encontramos uma inscrição com esses dados. Confira e tente de novo.'); }
      if (!sessao.applyment_id) return volta('Não encontramos uma inscrição com esses dados.');
      const id = hash('matr:' + sessao.applyment_id);
      const flow = hash(req.flow_token ?? '');
      // Situação das etapas, como no portal. Quem decide o que está liberado é o portal (próximo passo);
      // a única espera é a prova "Aguardando correção". Se o portal demorar, segue e o worker confere a ordem.
      let resumo = '', s2 = null;
      try {
        const st = await Promise.race([matricula.portal(sessao), new Promise((_, r) => setTimeout(() => r(new Error('lento')), Math.max(1500, esperaPortalMs - (clock() - t0))))]);
        s2 = summarizeStages(st.stages ?? []);
        resumo = s2.resumo;
        // Próximo passo é a prova: segue para a redação, como na jornada direta da etapa 1.
        if (s2.next && /prova|avaliacao|redacao/.test(norm(s2.next.title)) && entrarNaProva) {
          return await entrarNaProva({ applyment_id: sessao.applyment_id, processo: st.processo_seletivo_id, login, data_nascimento: u.data_nascimento, flowToken: req.flow_token });
        }
      } catch (e) { log({ event: 'etapa2_fila', passo: 'portal_lento', message: String(e?.message ?? e).slice(0, 60) }); }
      // Inscrição da matrícula no Firestore (login e data de nascimento ficam criptografados, para o worker entrar no Rubeus).
      const novo = { id, applyment_id: sessao.applyment_id, flow, login, data_nascimento: u.data_nascimento, blocos: {}, enviados: {}, status: 'pendente', tentativas: 0, criado: clock(), expires: clock() + 30 * DIA };
      const atual = await store.get(id, FILA);
      if (!atual) await store.create(id, novo, FILA);
      else {
        // Fila que falhou (ex.: sistema acadêmico fora do ar): entrar de novo reabre e retoma o envio do que já foi gravado.
        const reabrir = atual.record.status === 'falhou';
        await store.update(id, { ...atual.record, flow, login, data_nascimento: novo.data_nascimento, ...(reabrir ? { status: 'pendente', tentativas: 0, rodando_ate: 0 } : {}) }, atual.version, FILA);
        if (reabrir) {
          log({ event: 'etapa2_fila', id: curto(id), passo: 'reaberta' });
          try { await enqueue(id, { tipo: 'etapa2' }); } catch {}
        }
      }
      log({ event: 'etapa2_fila', id: curto(id), passo: 'login' });
      const menor = (idade(u.data_nascimento) ?? 18) < 18;
      // Tela inicial após o login = status do Portal do candidato, com o botão da etapa pendente (como no site).
      const destino = proximaTela(s2, atual?.record.blocos ?? {}, menor);
      return render('MATR_PORTAL', { m2: true, fila_id: id, menor, destino: destino.tela, botao: destino.botao, resumo: resumo || 'Sua inscrição foi encontrada. Vamos seguir com a sua matrícula.' });
    }

    let s;
    try { s = openState(d.estado, screen); } catch { return fim('Sessão expirada', 'Esta sessão ficou muito tempo parada. Abra a mensagem de novo e entre com seu CPF e data de nascimento.'); }
    if (!s.m2) return null;
    const base = { m2: true, fila_id: s.fila_id, menor: s.menor };

    if (screen === 'MATR_PORTAL' && acao === 'continuar') {
      // Nada a continuar no Flow agora (aguardando a equipe, ou etapa ainda fora do Flow): fecha.
      if (s.destino === null) return sucesso(req.flow_token);
      const destino = s.destino || (s.menor ? 'MATR_RESP_DADOS' : 'MATR_RESPONSAVEL');
      // Menor de 18 anos não pode ser o próprio responsável financeiro: grava "Outro" e vai direto à ficha do responsável.
      if (destino === 'MATR_RESP_DADOS' && s.menor) {
        try { await gravarBloco(s, req.flow_token, 'responsavel', { responsavel: 'Outro' }); }
        catch { return render('MATR_RESPONSAVEL', { ...base, erro: ERRO_GRAVAR }); }
      }
      return render(destino, { ...base, erro: '' });
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
    if (!f || FINAIS.has(f.record.status) || (f.record.rodando_ate ?? 0) > clock()) return 204;
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
      const { processo } = await portalSite.inscricao(sessao);
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
          const next = summarizeStages(p.stages).next;
          if (!next) { await salvar({ status: 'concluida', passo: 'fim' }); return; }
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

  return { route, worker, render };
}
