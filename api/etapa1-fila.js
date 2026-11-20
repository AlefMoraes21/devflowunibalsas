// Etapa 1 (telas INSC_* do Flow): inscrição nos 4 processos, redação do Vestibular e documentos de
// inscrição da Transferência, do Portador e do ENEM.
//
// O Flow responde na hora: os cursos são fixos no Flow (api/cursos-fixos.js), o tema da redação vem do cache e
// as respostas são conferidas aqui. Os dados ficam guardados (Firestore, criptografados) e um worker do
// Cloud Run repete no Rubeus os passos do site, conferindo cada tela.
import crypto from 'node:crypto';
import { jaEnviado as jaEnviadoNoPortal, tipoDoArquivo, linkDesconhecido } from './portal-site.js';
import { cursoFixo, cursoNoRubeus, turnoNoRubeus } from './cursos-fixos.js';
import { PRIMEIRA_TENTATIVA_S, MAX_TENTATIVAS, esperaDepoisDaFalha } from './retentativas.js';

const DIA = 86400000;
const FILA = 'inscricoesFila';
const CACHE = 'flowCache';
const FINAIS = new Set(['concluida', 'duplicada', 'conferir', 'falhou']);
// Espera pelo portal (Documentos inscrição ainda não apareceu): alerta a equipe na 6ª espera.
const ALERTA_DOCS_PORTAL = 6;
// Docs de inscrição recebidos, mas o portal ainda não mostra a etapa "Documentos inscrição": espera com calma
// (a cada 10 min, por até ~24 h) em vez de desistir em 6 tentativas e deixar os arquivos parados.
const MAX_TENTATIVAS_DOCS_PORTAL = 150;
export const DUPLICADA_MSG = 'Você já possui inscrição neste processo seletivo ou no curso selecionado! Acesse o Portal do candidato para acompanhar sua inscrição.';
const hash = v => crypto.createHash('sha256').update(String(v)).digest('hex');
const digits = v => String(v ?? '').replace(/\D/g, '');
const curto = id => String(id).slice(0, 10);
const norm = v => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
// Etapa "Documentos inscrição" do portal (Transferência, Portador, ENEM); não confundir com "Documentos matrícula".
export const ehDocsInscricao = titulo => /document/.test(norm(titulo)) && /inscri/.test(norm(titulo));
const passoDoLink = link => { const m = String(link ?? '').match(/passo\/(\d+)/); return m ? Number(m[1]) : null; };
const tipoArquivo = nome => tipoDoArquivo(nome) ?? 'application/pdf';

class ErroPasso extends Error {
  constructor(message, { final = false, motivo = 'passo' } = {}) { super(message); this.final = final; this.motivo = motivo; }
}

export function createEtapa1({
  store, enqueue, runStep, runLive = runStep, sealState, openState,
  // Candidato que entrou pelo LOGIN com a prova ainda por fazer: o worker entra no Rubeus por ele.
  loginRubeus = null, prepararProva = null,
  ehEnem = () => false, validateEnem = () => {}, anosEnem = [], avisar = async () => false,
  // Redação confirmada no portal: agenda o vigia da correção (etapa 2). Não muda nada da etapa 1.
  aoConfirmarRedacao = async () => {},
  validateBasic, validateFinal, origens, hoje, requiresEssay, academicId, userFields,
  jaInscritoNoRm = async () => false,
  // Transferência, Portador e ENEM: documentos de inscrição (lista por processo), envio pelo caminho do site
  // (api/portal-site.js) e, depois do envio, o vigia da análise (etapa 2). Nada disso vale para o Vestibular.
  docsInscricao = () => [], portalSite = null, baixarMidia = null, aoEnviarDocsInscricao = async () => {},
  mediaEnem = () => '',
  // Calma entre o Concluir e o envio dos documentos: o RM ainda sincroniza a inscrição.
  esperaDocsInscricaoMs = Number(process.env.ETAPA1_ESPERA_DOCS_MS) || 60000,
  clock = Date.now, sleep = ms => new Promise(r => setTimeout(r, ms)),
  orcamentoMs = 80000, intervaloEntregaMs = 8000,
  // Calma no envio da redação: o Rubeus/RM ainda ajusta a prova da inscrição por alguns minutos.
  esperaProvaMs = Number(process.env.ETAPA1_ESPERA_PROVA_MS) || 10 * 60000,
  estabilidadeMs = Number(process.env.ETAPA1_ESTABILIDADE_MS) || 60000,
  log = e => console.info(JSON.stringify(e))
}) {
  // ---------------------------------------------------------------- cache
  const memo = new Map();
  async function lerCache(processo, { fresco = false } = {}) {
    const m = memo.get(processo);
    if (!fresco && m && clock() - m.at < 60000) return m.value;
    let value = null;
    try { value = (await store.get('etapa1-' + processo, CACHE))?.record ?? null; } catch {}
    // Só guarda em memória o que existe: cache vazio é relido no próximo toque.
    if (value) memo.set(processo, { at: clock(), value });
    return value;
  }
  // Cache do processo: tema da redação e a lista de cursos do Rubeus (reserva do worker para achar o curso fixo).
  function cacheCompleto(c) {
    return Boolean(c?.tema && c.cursos?.length && clock() - (c.atualizado ?? 0) < 3 * DIA);
  }
  async function gravarCache(processo, patch) {
    const id = 'etapa1-' + processo;
    for (let i = 0; i < 4; i++) {
      let atual = null;
      try { atual = await store.get(id, CACHE); } catch {}
      const base = atual?.record ?? { turnos: {} };
      const novo = { ...base, ...patch, turnos: { ...base.turnos, ...(patch.turnos ?? {}) }, expires: clock() + 30 * DIA };
      if (patch.cursos) novo.atualizado = clock();
      const ok = atual ? await store.update(id, novo, atual.version, CACHE) : await store.create(id, novo, CACHE);
      if (ok) { memo.set(processo, { at: clock(), value: novo }); return novo; }
    }
    return null;
  }
  async function guardarTema(processo, tema) {
    if (!tema) return;
    const c = await lerCache(processo);
    if (c?.tema === tema) return;
    await gravarCache(processo, { tema });
    log({ event: 'etapa1_cache', processo, tema: true });
  }

  // ---------------------------------------------------------------- Flow (instantâneo)
  const pick = d => Object.fromEntries(Object.entries(d ?? {}).filter(([k]) => userFields.has(k)));

  // Guarda o texto da redação na inscrição e agenda o envio. Devolve null ou a mensagem de erro.
  async function receberRedacao(filaId, texto, flowToken) {
    try {
      let gravada = false;
      for (let i = 0; i < 4 && !gravada; i++) {
        const atual = await store.get(filaId, FILA);
        const ft = hash(flowToken ?? '');
        if (!atual || (atual.record.flow !== ft && atual.record.token_redacao !== ft)) throw new Error('inscrição não encontrada');
        if (atual.record.redacao || atual.record.status === 'concluida') { gravada = true; break; }
        gravada = await store.update(filaId, { ...atual.record, redacao: texto, redacao_em: clock() }, atual.version, FILA);
      }
      if (!gravada) throw new Error('conflito');
      log({ event: 'etapa1_fila', id: curto(filaId), passo: 'redacao_recebida' });
    } catch (e) {
      log({ event: 'etapa1_fila_erro', passo: 'redacao', message: String(e?.message ?? e).slice(0, 120) });
      return 'Não conseguimos guardar sua redação agora. Toque em Enviar redação de novo; o texto continua aqui.';
    }
    await disparar(filaId, PRIMEIRA_TENTATIVA_S);
    return null;
  }

  // ---------------------------------------------------------------- Flow da etapa 1 (telas INSC_*)
  // Etapa 1: processo → dados básicos → curso/turno → informações complementares (e notas do ENEM).
  // Cada tela grava no Firestore e agenda o worker; ao concluir, o Flow FECHA na hora (SUCCESS) com a
  // confirmação de que o Cloud Run recebeu os dados. O worker grava no Rubeus em segundo plano.
  // Etapa 2 (Vestibular): o worker deixa a prova vinculada e avisa pelo Blip; o Flow reabre pelo INIT
  // com o flow_token do aviso direto na INSC_REDACAO, e o envio também fecha o Flow na hora.
  const valor = (...n) => n.map(x => 'valor_' + x);
  const ENEM_CAMPOS = ['numero_inscricao_enem', 'ano_enem', 'nota_natureza_enem', 'nota_humanas_enem', 'nota_matematica_enem', 'nota_linguagens_enem', 'nota_redacao_enem'];
  const DOC_KEYS = ['estado', 'erro', 'tem_erro', 'titulo_doc', 'legenda_doc', 'botao'];
  const TELAS_DOC = ['INSC_DOC_A', 'INSC_DOC_B', 'INSC_DOC_C'];
  const INSC_KEYS = {
    INSC_DADOS: ['estado', 'erro', 'tem_erro', 'data_maxima_nascimento', ...valor('nome', 'possui_nome_social', 'nome_social', 'email', 'data_nascimento', 'celular', 'genero', 'aceite_privacidade')],
    // Lista de cursos fixa no JSON (api/cursos-fixos.js): a tela só recebe estado e erro.
    INSC_CURSO: ['estado', 'erro', 'tem_erro'],
    // Nota do ENEM: as notas ficam na tela do curso, como no site (passo 300708).
    INSC_CURSO_ENEM: ['estado', 'erro', 'tem_erro', 'anos_enem', ...valor(...ENEM_CAMPOS.filter(k => k !== 'ano_enem'))],
    INSC_QUASE_LA: ['estado', 'erro', 'tem_erro', 'origens', 'eh_nota_enem', 'resumo_enem', ...valor('cpf', 'nacionalidade', 'concluiu_ensino_medio', 'possui_deficiencia', 'tipos_deficiencia', 'deficiencia_outra', 'como_conheceu', 'como_conheceu_outro')],
    INSC_CONCLUIDA: ['estado'],
    INSC_PORTAL: ['estado'],
    INSC_STATUS: ['estado', 'eh_nota_enem'],
    ...Object.fromEntries(TELAS_DOC.map(t => [t, DOC_KEYS])),
    INSC_DOCS_FIM: ['eh_nota_enem'],
    INSC_AVALIACAO: ['estado'],
    INSC_ORIENTACAO: ['estado', 'erro', 'tem_erro'],
    INSC_REDACAO: ['estado', 'erro', 'tem_erro', 'tema_redacao', ...valor('texto_redacao')],
    INSC_FINALIZADA: [],
    INSC_FIM: ['titulo', 'mensagem']
  };
  const INSC_PADRAO = { tem_erro: false, eh_nota_enem: false, valor_possui_nome_social: false, valor_aceite_privacidade: false, valor_nacionalidade: '10', valor_tipos_deficiencia: [], cursos: [], turnos: [], origens: [], anos_enem: [] };
  const LISTAS = ['cursos', 'turnos', 'origens', 'anos_enem'];
  const proj = l => (l ?? []).map(o => ({ id: String(o.id), title: String(o.title) }));
  function renderE1(screen, data) {
    const { values = {}, ...trusted } = data;
    const out = {};
    for (const k of INSC_KEYS[screen]) {
      if (k === 'estado') out.estado = sealState(screen, trusted);
      else if (k === 'tem_erro') out.tem_erro = Boolean(trusted.erro);
      else if (k.startsWith('valor_')) out[k] = values[k.slice(6)] ?? INSC_PADRAO[k] ?? '';
      else if (LISTAS.includes(k)) out[k] = proj(trusted[k]);
      else out[k] = trusted[k] ?? INSC_PADRAO[k] ?? '';
    }
    return { screen, data: out };
  }
  const fimE1 = (titulo, mensagem) => renderE1('INSC_FIM', { titulo, mensagem });
  // Fecha o Flow na hora: a Meta encerra e entrega estes parâmetros no response_json da conversa.
  const sucesso = (flowToken, params) => ({ screen: 'SUCCESS', data: { extension_message_response: { params: { flow_token: String(flowToken ?? ''), ...params } } } });
  const processoE1 = () => String(process.env.ETAPA1_PROCESSO || '20383');
  const CPF_IDX = 'inscricoesCpf';
  const TOKENS = 'flowTokens';

  // Grava as respostas da tela no Firestore (cria a inscrição na primeira tela) e agenda o worker,
  // que vai gravando no Rubeus em segundo plano enquanto o candidato segue para a próxima tela.
  async function gravarTela(id, processo, flowToken, patch, extra = {}) {
    const flow = hash(flowToken ?? '');
    for (let i = 0; i < 5; i++) {
      const atual = await store.get(id, FILA);
      if (!atual) {
        const novo = { id, processo, flow, respostas: patch, redacao: null, status: 'pendente', passo: 'inicio', tentativas: 0, criado: clock(), expires: clock() + 30 * DIA, ...extra };
        if (await store.create(id, novo, FILA)) break;
        continue;
      }
      if (atual.record.flow !== flow) throw new Error('inscrição de outra sessão');
      const rec = { ...atual.record, respostas: { ...atual.record.respostas, ...patch }, ...extra };
      if (await store.update(id, rec, atual.version, FILA)) break;
      if (i === 4) throw new Error('conflito');
    }
    await disparar(id, PRIMEIRA_TENTATIVA_S);
  }
  const ERRO_GRAVAR = 'Não conseguimos guardar seus dados agora. Toque no botão de novo.';
  const falha = (passo, e) => log({ event: 'etapa1_fila_erro', passo, message: String(e?.message ?? e).slice(0, 160) });

  // ---------------------------------------------------------------- documentos de inscrição (Flow)
  // Tela do documento i da lista (INSC_DOC_A/B/C). O 1º da lista é sempre o obrigatório nos 3 processos;
  // a lista pode ter só os recusados (reenvio pelo LOGIN).
  function telaDocumento(s, i, erro = '') {
    const docs = (Array.isArray(s.docs) ? s.docs : []).slice(0, TELAS_DOC.length);
    const doc = docs[i];
    if (!doc) return fimE1('Documentos de inscrição', 'Não há documentos de inscrição para enviar por aqui. Acompanhe pelo Portal do candidato.');
    const ultimo = i === docs.length - 1;
    const { values, erro: _e, ...estado } = s;
    return renderE1(TELAS_DOC[i], {
      ...estado, docs, i,
      titulo_doc: `${doc.titulo}${doc.obrigatorio ? ' *' : ''}`,
      legenda_doc: `${doc.recusado ? 'Recusado na análise: envie de novo.' : doc.obrigatorio ? 'Obrigatório.' : 'Opcional: se não tiver agora, toque no botão abaixo.'} Documento ${i + 1} de ${docs.length}.`,
      botao: ultimo ? 'Enviar' : 'Avançar',
      erro
    });
  }
  // Guarda a referência do arquivo (criptografada no Firestore); no último, marca completo e agenda o worker.
  async function gravarDocumentoInscricao(id, flowToken, codigo, media, completo) {
    const flow = hash(flowToken ?? '');
    for (let i = 0; i < 5; i++) {
      const atual = await store.get(id, FILA);
      if (!atual) throw new Error('inscrição não encontrada');
      if (atual.record.flow !== flow) throw new Error('inscrição de outra sessão');
      const prev = atual.record.docs_inscricao ?? {};
      const docs = { ...prev, arquivos: { ...(prev.arquivos ?? {}), ...(media.length ? { [codigo]: media } : {}) }, completo: Boolean(completo || prev.completo), recebido_em: clock() };
      // Reenvio pelo LOGIN numa inscrição já entregue: reabre o envio.
      const reabrir = completo && ['concluida', 'falhou', 'conferir'].includes(atual.record.status) && atual.record.passo === 'docs_inscricao';
      const rec = { ...atual.record, docs_inscricao: docs, ...(reabrir ? { status: 'inscrita', tentativas: 0, rodando_ate: 0 } : {}) };
      if (await store.update(id, rec, atual.version, FILA)) {
        if (completo) {
          log({ event: 'etapa1_fila', id: curto(id), passo: 'documentos_inscricao_recebidos', quantidade: Object.keys(docs.arquivos).length });
          await disparar(id, PRIMEIRA_TENTATIVA_S);
        }
        return;
      }
    }
    throw new Error('conflito');
  }

  async function routeE1(req) {
    const d = req.data ?? {}, acao = d.acao, screen = req.screen;
    if (screen === 'INSC_INICIO') {
      if (acao !== 'e1_iniciar') return null;
      const processo = String(d.processo_seletivo_id || processoE1());
      if (!academicId(processo)) return fimE1('Inscrição pelo site', 'Este processo seletivo não está disponível pelo WhatsApp. Faça sua inscrição pelo site vestibular.unibalsas.edu.br/presencial.');
      return renderE1('INSC_DADOS', { e1: true, processo_seletivo_id: processo, eh_nota_enem: ehEnem(processo), fila_id: hash('insc:' + processo + ':' + (req.flow_token ?? '') + ':' + crypto.randomUUID()), data_maxima_nascimento: hoje(), erro: '' });
    }
    if (!INSC_KEYS[screen] || screen === 'INSC_FIM') return null;
    let s;
    try { s = openState(d.estado, screen); } catch { return fimE1('Sessão expirada', 'Esta inscrição ficou muito tempo parada e expirou. Abra a mensagem de inscrição de novo para recomeçar.'); }
    if (!s.e1) return null;
    const u = pick(d);
    const processo = s.processo_seletivo_id;
    const base = { e1: true, processo_seletivo_id: processo, eh_nota_enem: Boolean(s.eh_nota_enem), fila_id: s.fila_id };

    if (screen === 'INSC_DADOS' && acao === 'enviar_dados_basicos') {
      try { validateBasic(u); } catch (e) { return renderE1('INSC_DADOS', { ...s, values: u, erro: e.message }); }
      try { await gravarTela(s.fila_id, processo, req.flow_token, u); }
      catch (e) { falha('dados_basicos', e); return renderE1('INSC_DADOS', { ...s, values: u, erro: ERRO_GRAVAR }); }
      // Cursos fixos no Flow: a tela de curso abre na hora, sem esperar o Rubeus.
      if (base.eh_nota_enem) return renderE1('INSC_CURSO_ENEM', { ...base, anos_enem: anosEnem, erro: '' });
      return renderE1('INSC_CURSO', { ...base, erro: '' });
    }

    // Curso (lista fixa, com o turno no nome): o Run só confere e guarda a escolha. O worker acha o curso e o
    // turno no Rubeus pelo nome, depois. No ENEM, os dados do exame ficam na mesma tela (INSC_CURSO_ENEM).
    if ((screen === 'INSC_CURSO' || screen === 'INSC_CURSO_ENEM') && acao === 'escolher_curso') {
      const enem = screen === 'INSC_CURSO_ENEM';
      const notas = enem ? Object.fromEntries(ENEM_CAMPOS.map(k => [k, u[k] == null ? '' : String(u[k]).trim()])) : {};
      const fixo = cursoFixo(u.curso_id);
      if (!fixo) return renderE1(screen, { ...s, values: notas, erro: 'Selecione um curso.' });
      let media = '';
      if (enem) {
        try { validateEnem(notas); media = String(mediaEnem(notas) ?? ''); }
        catch (e) { return renderE1(screen, { ...s, values: notas, erro: e.message }); }
      }
      try { await gravarTela(s.fila_id, processo, req.flow_token, { curso_id: fixo.id, ...notas, ...(enem ? { media_enem: media } : {}) }); }
      catch (e) { falha('curso', e); return renderE1(screen, { ...s, values: notas, erro: ERRO_GRAVAR }); }
      const resumo_enem = enem && media ? `Média das notas do ENEM: ${media.replace('.', ',')}` : '';
      return renderE1('INSC_QUASE_LA', { ...base, origens, resumo_enem, erro: '' });
    }

    // Concluir: valida, grava no Firestore e agenda o worker. Vestibular: segue para a prova. Transferência,
    // Portador e ENEM: segue igual ao site (Obrigado → Portal → Documentos inscrição).
    if (screen === 'INSC_QUASE_LA' && acao === 'enviar_informacoes_complementares') {
      try {
        validateFinal({ ...u, origens: s.origens });
      } catch (e) { return renderE1('INSC_QUASE_LA', { ...s, values: u, erro: e.message }); }
      const cpf = digits(u.cpf);
      try {
        if (await jaInscritoNoRm(academicId(processo), cpf)) { log({ event: 'etapa1_fila', id: curto(s.fila_id), passo: 'duplicada_rm' }); return renderE1('INSC_QUASE_LA', { ...s, values: u, erro: DUPLICADA_MSG }); }
        const idx = hash('etapa1:' + processo + ':' + cpf);
        if (!await store.create(idx, { fila_id: s.fila_id, expires: clock() + 30 * DIA }, CPF_IDX)) {
          const atual = await store.get(idx, CPF_IDX);
          if (atual && atual.record.fila_id !== s.fila_id) {
            const outra = await store.get(atual.record.fila_id, FILA);
            if (outra && outra.record.status !== 'falhou') { log({ event: 'etapa1_fila', id: curto(s.fila_id), passo: 'duplicada_fila' }); return renderE1('INSC_QUASE_LA', { ...s, values: u, erro: DUPLICADA_MSG }); }
            await store.update(idx, { fila_id: s.fila_id, expires: clock() + 30 * DIA }, atual.version, CPF_IDX);
          }
        }
        await gravarTela(s.fila_id, processo, req.flow_token, u, { concluida_em: clock() });
        log({ event: 'etapa1_fila', id: curto(s.fila_id), passo: 'dados_recebidos', status: 'pendente' });
      } catch (e) { falha('quase_la', e); return renderE1('INSC_QUASE_LA', { ...s, values: u, erro: ERRO_GRAVAR }); }
      if (requiresEssay(processo) || docsInscricao(processo).length) return renderE1('INSC_CONCLUIDA', { ...base, erro: '' });
      return sucesso(req.flow_token, { status: 'dados_recebidos', protocolo_fila: curto(s.fila_id), processo_seletivo_id: processo });
    }

    // Igual ao site: Obrigado pelo seu cadastro → Portal do candidato → Avaliação online disponível →
    // instruções → redação. Fechar o Flow em qualquer ponto deixa o candidato só como inscrito.
    // Transferência, Portador e ENEM: Obrigado → Portal (Documentos inscrição: Pendentes) → documentos.
    if (screen === 'INSC_CONCLUIDA' && acao === 'abrir_portal') {
      if (!requiresEssay(processo) && docsInscricao(processo).length) return renderE1('INSC_STATUS', { ...base });
      return renderE1('INSC_PORTAL', { ...base });
    }
    if (screen === 'INSC_STATUS' && acao === 'verificar_documentos') return telaDocumento({ ...base, docs: docsInscricao(processo) }, 0);

    // Documentos de inscrição: cada arquivo fica guardado na hora (referência da mídia do WhatsApp); o último
    // agenda o envio, que o worker faz pelo caminho do site, num único "Enviar", como o candidato faria.
    const iDoc = TELAS_DOC.indexOf(screen);
    if (iDoc >= 0 && acao === 'enviar_documento_inscricao') {
      const docs = Array.isArray(s.docs) ? s.docs : [];
      const i = Number.isInteger(s.i) ? s.i : iDoc;
      const doc = docs[i];
      if (!doc) return fimE1('Algo deu errado', 'Não encontramos este documento. Entre de novo pelo LOGIN para continuar.');
      const media = Array.isArray(d.arquivo) ? d.arquivo.slice(0, 1) : [];
      if (doc.obrigatorio && media.length !== 1) return telaDocumento(s, i, `Anexe o arquivo: ${doc.titulo}.`);
      const ultimo = i >= docs.length - 1 || i >= TELAS_DOC.length - 1;
      try { await gravarDocumentoInscricao(s.fila_id, req.flow_token, doc.codigo, media, ultimo); }
      catch (e) { falha('documento_inscricao', e); return telaDocumento(s, i, ERRO_GRAVAR); }
      if (!ultimo) return telaDocumento(s, i + 1);
      // Igual ao site depois do "Enviar": volta ao status do portal com "Documentos inscrição: Em análise".
      // É a última tela: o envio já está agendado, então fechar o Flow aqui finaliza.
      return renderE1('INSC_DOCS_FIM', { eh_nota_enem: Boolean(s.eh_nota_enem) });
    }
    if (screen === 'INSC_PORTAL' && acao === 'realizar_prova') return renderE1('INSC_AVALIACAO', { ...base });
    if (screen === 'INSC_AVALIACAO' && acao === 'iniciar_prova') return renderE1('INSC_ORIENTACAO', { ...base, erro: '' });
    if (screen === 'INSC_ORIENTACAO' && acao === 'iniciar_redacao') {
      const f = await store.get(s.fila_id, FILA);
      if (!f) return renderE1('INSC_ORIENTACAO', { ...s, erro: 'Não encontramos sua inscrição. Tente de novo em alguns minutos.' });
      const pr = await prepararRedacao(f, { aberta: true });
      if (pr.fim) return pr.fim;
      if (pr.erro) return renderE1('INSC_ORIENTACAO', { ...s, erro: pr.erro });
      return renderE1('INSC_REDACAO', { ...base, tema_redacao: pr.tema, erro: '' });
    }

    // Etapa 2: envio da redação também só grava, agenda e fecha o Flow na hora.
    if (screen === 'INSC_REDACAO' && acao === 'enviar_redacao') {
      const texto = String(u.texto_redacao ?? '').trim();
      if (texto.length < 50) return renderE1('INSC_REDACAO', { ...s, values: u, erro: 'Por favor, desenvolva mais a sua redação antes de enviar.' });
      const erroRed = await receberRedacao(s.fila_id, texto, req.flow_token);
      if (erroRed) return renderE1('INSC_REDACAO', { ...s, values: u, erro: erroRed });
      // Tela final igual à da avaliação no site; o botão só fecha o Flow. O envio é do worker.
      return renderE1('INSC_FINALIZADA', {});
    }
    return null;
  }

  // INIT com o flow_token do aviso da etapa 2: abre direto a redação, já com o tema.
  async function abrirRedacao(req) {
    const ft = String(req.flow_token ?? '');
    if (!ft) return null;
    let idx = null;
    try { idx = await store.get(hash(ft), TOKENS); } catch {}
    if (!idx) return null;
    const f = await store.get(idx.record.fila_id, FILA);
    if (!f?.record) return fimE1('Inscrição não encontrada', 'Não encontramos sua inscrição. Fale com a nossa equipe por aqui.');
    const pr = await prepararRedacao(f);
    if (pr.fim) return pr.fim;
    if (pr.erro) return fimE1('Prova em preparação', pr.erro);
    return renderE1('INSC_REDACAO', { e1: true, processo_seletivo_id: f.record.processo, fila_id: f.record.id, tema_redacao: pr.tema, erro: '' });
  }

  // Devolve { tema } quando a redação pode abrir, { erro } para tentar de novo ou { fim } (tela final).
  async function prepararRedacao(f, { aberta = false } = {}) {
    const rec = f.record;
    if (rec.redacao || rec.status === 'concluida') return { fim: fimE1('Redação enviada ✅', 'Você realizou a sua prova. Em breve o resultado estará disponível.') };
    if (['conferir', 'duplicada', 'falhou'].includes(rec.status)) return { fim: fimE1('Vamos conferir sua inscrição', 'Nossa equipe vai conferir sua inscrição e falar com você por aqui.') };
    let tema = (await lerCache(rec.processo))?.tema;
    // Tema guardado: a redação abre na hora, mesmo com o worker ainda concluindo a inscrição no Rubeus
    // (o texto fica guardado e é enviado quando a prova estiver pronta).
    if (tema) {
      if (aberta && !rec.redacao_aberta) {
        for (let i = 0, a = f; i < 3 && a; i++) {
          if (await store.update(rec.id, { ...a.record, redacao_aberta: clock() }, a.version, FILA).catch(() => false)) break;
          a = await store.get(rec.id, FILA);
        }
      }
      log({ event: 'etapa1_fila', id: curto(rec.id), passo: 'redacao_aberta' });
      return { tema };
    }
    if (!['redacao', 'redacao_enviar'].includes(rec.passo)) return { erro: 'Estamos concluindo sua inscrição no sistema. Aguarde alguns segundos e toque em Realizar prova de novo.' };
    if (!tema && rec.passo === 'redacao' && rec.ck) {
      // Primeira vez (tema ainda não guardado): o candidato abriu a redação, então a prova é aberta agora.
      try {
        const r = await runLive({ screen: rec.ck.screen, action: 'data_exchange', flow_token: 'insc', data: { acao: 'iniciar_redacao', estado: rec.ck.estado } });
        const st = r?.data?.estado ? openState(r.data.estado, r.screen) : {};
        if (r?.screen === 'TELA_REDACAO' && st.tema_redacao) {
          tema = st.tema_redacao;
          guardarTema(rec.processo, tema).catch(() => {});
          if (aberta && !((rec.rodando_ate ?? 0) > clock())) await store.update(rec.id, { ...rec, redacao_aberta: clock() }, f.version, FILA).catch(() => false);
        }
      } catch (e) { falha('abrir_prova', e); }
    }
    if (!tema) return { erro: 'Não conseguimos carregar o tema agora. Toque de novo em alguns segundos.' };
    log({ event: 'etapa1_fila', id: curto(rec.id), passo: 'redacao_aberta' });
    return { tema };
  }

  async function route(req) {
    if (req?.action === 'INIT') {
      try { return await abrirRedacao(req); }
      catch (e) { console.error(JSON.stringify({ event: 'etapa1_fila_atencao', motivo: 'erro_init', message: String(e?.message ?? e).slice(0, 160) })); return null; }
    }
    if (req?.action !== 'data_exchange') return null;
    if (String(req.screen ?? '').startsWith('INSC_')) {
      try { return await routeE1(req); }
      catch (e) {
        console.error(JSON.stringify({ event: 'etapa1_fila_atencao', motivo: 'erro_tela', screen: req.screen, message: String(e?.message ?? e).slice(0, 160) }));
        return fimE1('Algo deu errado', 'Não conseguimos continuar sua inscrição agora. Abra a mensagem de inscrição de novo em alguns minutos.');
      }
    }
    return null;
  }

  async function disparar(id, atrasoSeg = 0) {
    try { await enqueue(id, { tipo: 'etapa1', atrasoSeg }); }
    catch (e) { log({ event: 'etapa1_fila_erro', id: curto(id), passo: 'agendar', message: String(e?.message ?? e).slice(0, 120) }); }
  }

  // ---------------------------------------------------------------- worker (envio ao Rubeus)
  const step = (screen, estado, acao, dados = {}, id = '') =>
    runStep({ screen, action: 'data_exchange', flow_token: 'etapa1-' + curto(id), data: { acao, estado, ...dados } });
  function abrir(r, esperado) {
    let st = {};
    try { st = r?.data?.estado ? openState(r.data.estado, r.screen) : (r?.data ?? {}); } catch {}
    if (r?.screen === 'PENDENTE') throw new ErroPasso(r.data?.mensagem || 'Resultado incerto no Rubeus.', { motivo: 'incerto' });
    if (r?.screen !== esperado || st.erro) throw new ErroPasso(st.erro || `Tela inesperada: ${r?.screen}`);
    return st;
  }
  const ck = r => ({ screen: r.screen, estado: r.data.estado });
  const TELAS_CURSO = ['CURSO_INTERESSE', 'CURSO_ENEM', 'CURSO_INGRESSO'];
  const abrirCurso = r => abrir(r, TELAS_CURSO.includes(r?.screen) ? r.screen : 'CURSO_INTERESSE');
  // Aviso da etapa 2: link novo (flow_token) guardado só como hash; o texto vai ao Blip.
  async function avisarEtapa2(rec, salvar) {
    const atual = (await store.get(rec.id, FILA))?.record;
    if (atual?.redacao || atual?.redacao_aberta) return salvar({ aviso_redacao: 'dispensado' });
    const token = crypto.randomBytes(18).toString('base64url');
    await store.create(hash(token), { fila_id: rec.id, expires: clock() + 30 * DIA }, 'flowTokens');
    const enviado = await avisar({ celular: rec.respostas?.celular, nome: rec.respostas?.nome, flowToken: token }).catch(() => false);
    return salvar({ token_redacao: hash(token), aviso_redacao: enviado ? 'enviado' : 'nao_enviado', aviso_em: clock() });
  }

  // Documentos de inscrição pelo mesmo caminho do site (api/portal-site.js), como os de matrícula: entra no
  // Portal do candidato, acha a etapa "Documentos inscrição" pelo link (sem fixar o passo), lê a lista do passo,
  // envia num único "Enviar" (multipart file_0…) e confere no próprio passo. Repetição segura: o que já está
  // em análise ou aceito (status 1 ou 3) não é reenviado.
  async function entregarDocsInscricao(rec) {
    const login = rec.via_login?.login, nasc = rec.via_login?.data_nascimento;
    if (!login || !nasc) throw new ErroPasso('Sem CPF ou data de nascimento para entrar no portal.', { final: true, motivo: 'login' });
    const sessao = await portalSite.entrar(login, nasc);
    const { processo: procPortal, stages } = await portalSite.inscricao(sessao);
    const processo = procPortal || String(rec.processo);
    const etapa = (stages ?? []).find(x => ehDocsInscricao(x.title));
    const passoId = passoDoLink(etapa?.cta_link);
    const arquivos = rec.docs_inscricao?.arquivos ?? {};
    const enviados = {};
    if (!passoId) {
      // Etapa sem botão = documentos já em análise (ex.: enviados pelo site). Sem a etapa: o portal ainda não liberou.
      // Diagnóstico: quais etapas o portal devolveu (só títulos) e de qual inscrição/processo.
      if (!etapa) log({ event: 'etapa1_fila', id: curto(rec.id), passo: 'docs_portal_etapas', applyment_id: sessao.applyment_id ?? '', processo, esperado: String(rec.processo), etapas: (stages ?? []).map(x => x.title).join(' | ').slice(0, 200) });
      if (!etapa) throw new ErroPasso('A etapa Documentos inscrição ainda não apareceu no portal.', { motivo: 'docs_nao_liberado' });
      // Só conta como "já em análise" sem botão nenhum (ou com o link de situação). Botão em formato desconhecido
      // ou "Pendentes" sem botão: nunca conclui sem enviar (o portal mudou ou ainda não liberou).
      if (linkDesconhecido(etapa.cta_link)) throw new ErroPasso('O botão de Documentos inscrição veio num formato desconhecido.', { final: true, motivo: 'portal_formato' });
      if (/pendente/.test(norm(etapa.feedback?.complementary_text))) throw new ErroPasso('Documentos inscrição pendente sem o botão de envio.', { motivo: 'docs_nao_liberado' });
      log({ event: 'etapa1_fila', id: curto(rec.id), passo: 'documentos_inscricao_ja_em_analise' });
      return { applyment_id: sessao.applyment_id, processo, stages, enviados };
    }
    const passo = await portalSite.passoDocumentos(sessao, passoId, processo);
    const naLista = new Map(passo.docs.map(x => [x.codigo, x]));
    for (const codigo of Object.keys(arquivos)) if (!naLista.has(codigo)) console.error(JSON.stringify({ event: 'etapa1_fila_atencao', id: curto(rec.id), motivo: 'documento_fora_da_lista', doc: codigo }));
    const lote = [], invalidos = [];
    // Na ordem do passo (a mesma do site).
    for (const linha of passo.docs) {
      const codigo = linha.codigo, media = arquivos[codigo];
      if (!media?.length) continue;
      if (jaEnviadoNoPortal(linha)) { enviados[codigo] = 'ja_no_portal'; continue; }
      const m = media[0];
      // Anexo que não abre (ex.: Flow em rascunho manda mídia simulada): descarta e pede de novo (como na matrícula).
      let bytes;
      try { bytes = await baixarMidia(m); }
      catch (e) { invalidos.push(codigo); log({ event: 'etapa1_fila', id: curto(rec.id), passo: 'documento_inscricao_invalido', doc: codigo, message: String(e?.message ?? e).slice(0, 80) }); continue; }
      if (bytes.length > passo.max_mb * 1024 * 1024) throw new ErroPasso(`Arquivo do documento ${codigo} acima de ${passo.max_mb} MB.`, { final: true, motivo: 'tamanho' });
      lote.push({ codigo, bytes, nome: String(m.file_name || `documento-${codigo}.pdf`).slice(-80), tipo: tipoArquivo(m.file_name) });
    }
    let stagesFinal = stages;
    if (lote.length) {
      await portalSite.enviarDocumentos({ sessao, passo, processo, arquivos: lote });
      let conferidos = [];
      try { conferidos = (await portalSite.passoDocumentos(sessao, passoId, processo)).docs.filter(jaEnviadoNoPortal).map(x => x.codigo); } catch {}
      for (const a of lote) {
        log({ event: 'etapa1_fila', id: curto(rec.id), passo: 'documento_inscricao_enviado', doc: a.codigo, conferido: conferidos.includes(a.codigo) });
        enviados[a.codigo] = conferidos.includes(a.codigo) ? 'conferido' : 'enviado';
      }
      // Nenhum conferido: tenta de novo (o que já entrou não é reenviado, pela lista do passo).
      if (!conferidos.length && !invalidos.length) throw new ErroPasso('O portal ainda não mostra os documentos de inscrição enviados.', { motivo: 'docs_conferir' });
      // Status do portal depois do envio (Documentos inscrição: Em análise), para o LOGIN abrir na hora.
      try { stagesFinal = (await portalSite.inscricao(sessao)).stages; } catch {}
    }
    if (invalidos.length) throw Object.assign(new ErroPasso('Documentos de inscrição que não abriram: o candidato envia de novo pelo Flow.', { motivo: 'docs_refazer' }), { refazer: invalidos });
    return { applyment_id: sessao.applyment_id, processo, stages: stagesFinal, enviados };
  }

  async function redacaoConfirmada(rec, salvar) {
    const r = await salvar({ passo: 'fim', status: 'concluida' });
    const R = rec.respostas ?? {};
    try { await aoConfirmarRedacao({ login: rec.via_login?.login ?? R.cpf, data_nascimento: rec.via_login?.data_nascimento ?? R.data_nascimento, celular: R.celular, nome: R.nome }); }
    catch (e) { log({ event: 'etapa1_fila_erro', passo: 'vigia_redacao', message: String(e?.message ?? e).slice(0, 120) }); }
    return r;
  }

  // Sessão do Rubeus guardada no registro (estado selado, vale 3 h). Expirada, não adianta tentar de novo com ela.
  const ckValido = rec => { try { openState(rec.ck.estado, rec.ck.screen); return true; } catch { return false; } };
  async function executarPasso(rec, salvar) {
    const R = rec.respostas;
    if (rec.ck && !ckValido(rec)) {
      // Antes da conclusão: recomeça numa sessão nova, sem contar como falha.
      if (['basicos', 'turnos', 'curso', 'final'].includes(rec.passo)) { log({ event: 'etapa1_fila', id: curto(rec.id), passo: 'sessao_expirada', de: rec.passo }); return salvar({ passo: 'inicio', ck: null }); }
      // Redação ainda não enviada: abre de novo a prova da inscrição (passo redacao entra no Rubeus pelo CPF).
      if (rec.passo === 'redacao_enviar') { log({ event: 'etapa1_fila', id: curto(rec.id), passo: 'sessao_expirada', de: rec.passo }); return salvar({ passo: 'redacao', ck: null }); }
      // Redação já enviada, só falta a confirmação: sem a sessão, a equipe confere no portal (nunca reenvia).
      if (rec.passo === 'entrega') throw new ErroPasso('A sessão expirou antes de o portal confirmar a entrega da redação.', { final: true, motivo: 'entrega_sem_sessao' });
    }
    switch (rec.passo) {
      case 'inicio': {
        const r = await step('ESCOLHA_PROCESSO', sealState('ESCOLHA_PROCESSO', { processos_disponiveis: [rec.processo] }), 'selecionar_processo', { processo_seletivo_id: rec.processo }, rec.id);
        abrir(r, 'DADOS_BASICOS');
        return salvar({ passo: 'basicos', ck: ck(r) });
      }
      case 'basicos': {
        if (!R.nome) return salvar({ parar: true });
        const r = await step(rec.ck.screen, rec.ck.estado, 'enviar_dados_basicos', pick({ nome: R.nome, possui_nome_social: R.possui_nome_social, nome_social: R.nome_social, email: R.email, data_nascimento: R.data_nascimento, celular: R.celular, genero: R.genero, aceite_privacidade: R.aceite_privacidade }), rec.id);
        const st = abrirCurso(r);
        // Guarda a lista de cursos do Rubeus (reserva do passo turnos), renovada a cada 6 h.
        if (st.cursos?.length) {
          const c = await lerCache(rec.processo, { fresco: true });
          if (!c?.cursos?.length || clock() - (c.atualizado ?? 0) > 6 * 3600000) await gravarCache(rec.processo, { cursos: st.cursos });
        }
        return salvar({ passo: 'turnos', ck: ck(r) });
      }
      case 'turnos': {
        if (!R.curso_id) return salvar({ parar: true });
        let st0 = {}; try { st0 = openState(rec.ck.estado, rec.ck.screen); } catch {}
        // Curso da lista fixa do Flow: acha o curso do Rubeus pelo nome e, depois da consulta, o turno.
        const fixo = R.turno_id ? null : cursoFixo(R.curso_id);
        let cursoRubeus = R.curso_id;
        if (fixo) {
          const lista = st0.cursos?.length ? st0.cursos : (await lerCache(rec.processo))?.cursos;
          const achado = cursoNoRubeus(fixo, lista);
          if (!achado) throw new ErroPasso(`O curso ${fixo.title} não foi achado na lista do Rubeus deste processo.`, { final: true, motivo: 'curso_indisponivel' });
          cursoRubeus = achado.id;
        } else if (!R.turno_id) return salvar({ parar: true });
        else if (st0.cursos && !st0.cursos.some(c => c.id === R.curso_id)) throw new ErroPasso('O curso escolhido não está mais disponível no Rubeus.', { final: true, motivo: 'curso_indisponivel' });
        const r = await step(rec.ck.screen, rec.ck.estado, 'buscar_turnos', { curso_id: cursoRubeus }, rec.id);
        const st = abrirCurso(r);
        let turnoRubeus = R.turno_id;
        if (fixo) {
          const t = turnoNoRubeus(fixo, st.turnos);
          if (!t) throw new ErroPasso(`O turno ${fixo.turno} do curso ${fixo.title} não veio na consulta do Rubeus.`, { motivo: 'turno' });
          turnoRubeus = t.id;
        } else if (!st.turnos?.some(t => t.id === R.turno_id)) throw new ErroPasso('O turno escolhido não veio na consulta do Rubeus.', { motivo: 'turno' });
        return salvar({ passo: 'curso', ck: ck(r), rubeus_curso: { curso_id: cursoRubeus, turno_id: turnoRubeus } });
      }
      case 'curso': {
        // ENEM: o curso vai junto com as notas, que chegam na última tela.
        if (ehEnem(rec.processo) && !R.numero_inscricao_enem) return salvar({ parar: true });
        const notas = ehEnem(rec.processo) ? Object.fromEntries(ENEM_CAMPOS.map(k => [k, R[k]])) : {};
        const r = await step(rec.ck.screen, rec.ck.estado, rec.ck.screen === 'CURSO_INGRESSO' ? 'avancar_curso_ingresso' : 'avancar_curso_interesse', { curso_id: rec.rubeus_curso?.curso_id ?? R.curso_id, turno_id: rec.rubeus_curso?.turno_id ?? R.turno_id, ...notas }, rec.id);
        abrir(r, 'QUASE_LA');
        return salvar({ passo: 'final', ck: ck(r) });
      }
      case 'final': {
        if (!R.cpf) return salvar({ parar: true });
        // A partir daqui o envio não é repetido sozinho: se cair no meio, a equipe confere.
        await salvar({ passo: 'final_enviando' });
        const r = await step(rec.ck.screen, rec.ck.estado, 'enviar_informacoes_complementares', pick({ cpf: R.cpf, nacionalidade: R.nacionalidade, concluiu_ensino_medio: R.concluiu_ensino_medio, possui_deficiencia: R.possui_deficiencia, tipos_deficiencia: R.tipos_deficiencia, deficiencia_outra: R.deficiencia_outra, como_conheceu: R.como_conheceu, como_conheceu_outro: R.como_conheceu_outro }), rec.id);
        if (r?.screen === 'QUASE_LA') {
          let st = {}; try { st = openState(r.data.estado, r.screen); } catch {}
          if (/possui inscri/i.test(st.erro ?? '')) throw new ErroPasso('Candidato já possui inscrição no Rubeus.', { final: true, motivo: 'duplicada' });
          // Recusa do Rubeus (sem gravação): pode tentar de novo, numa sessão nova.
          await salvar({ passo: 'final' });
          throw new ErroPasso(st.erro || 'Rubeus recusou a conclusão.', { motivo: 'recusada' });
        }
        // Transferência, Portador e ENEM: inscrição confirmada; a etapa 1 segue para os documentos de inscrição
        // (só o CPF e a data de nascimento ficam, para entrar no portal; o resto dos dados sai do registro).
        if (!requiresEssay(rec.processo)) {
          if (!['ACOMPANHAMENTO', 'CONFIRMACAO', 'PORTAL_STATUS'].includes(r?.screen)) throw new ErroPasso('Tela inesperada: ' + r?.screen, { final: true, motivo: 'incerto' });
          let st = {}; try { st = r.data.estado ? openState(r.data.estado, r.screen) : {}; } catch {}
          if (!docsInscricao(rec.processo).length || !portalSite) return salvar({ passo: 'fim', status: 'concluida', applyment_id: String(st.applyment_id ?? '') });
          return salvar({
            passo: 'docs_inscricao', status: 'inscrita', applyment_id: String(st.applyment_id ?? ''), inscrita_em: clock(),
            via_login: { login: digits(R.cpf), data_nascimento: R.data_nascimento },
            contato: { nome: String(R.nome ?? ''), celular: digits(R.celular) },
            respostas: null, ck: null
          });
        }
        let st;
        try { st = abrir(r, 'TELA_ORIENTACAO_PROVA'); }
        catch (e) { throw new ErroPasso(e.message, { final: true, motivo: 'incerto' }); }
        // Vestibular: prova vinculada (pré-carga do Iniciar prova, sem abrir o cronômetro) e aviso da etapa 2.
        await salvar({ passo: 'redacao', status: 'inscrita', inscrita_em: clock(), applyment_id: String(st.applyment_id ?? ''), prova_vinculada: Boolean(st.prova_pre_carregada), ck: ck(r) });
        return avisarEtapa2(rec, salvar);
      }
      case 'redacao': {
        if (!rec.redacao) return salvar({ parar: true });
        // 1) Espera o Rubeus/RM terminar de criar a prova da inscrição (o vínculo lido logo após o
        //    "Iniciar prova" pode ser provisório).
        const pronta = (rec.inscrita_em ?? 0) + esperaProvaMs;
        if (clock() < pronta) return salvar({ parar: true, proxima: pronta });
        // 2) Lê a prova ATUAL da inscrição, sem acionar "Iniciar prova" de novo, duas vezes com
        //    intervalo: só segue se a execução e o registro não mudaram.
        let base = null;
        if (!rec.via_login && rec.ck) { try { base = openState(rec.ck.estado, rec.ck.screen); } catch {} }
        // Entrou pelo LOGIN, ou a sessão da inscrição expirou (o estado selado vale 3 h): sessão nova no Rubeus
        // com o CPF e a data de nascimento guardados, como o candidato faria no portal.
        const reLogin = !base;
        if (reLogin) {
          const acesso = rec.via_login ?? { login: digits(R?.cpf), data_nascimento: R?.data_nascimento };
          if (!acesso.login || !acesso.data_nascimento) throw new ErroPasso('Sessão da inscrição expirada e sem CPF/data de nascimento para entrar de novo.', { final: true, motivo: 'sessao_expirada' });
          const sess = await loginRubeus(acesso.login, acesso.data_nascimento);
          base = { token: sess.token, applyment_id: String(rec.applyment_id), processo_seletivo_id: String(rec.processo), person_id: sess.person_id };
        }
        const conferir = async () => {
          const est = sealState('TELA_ORIENTACAO_PROVA', { ...base, prepared_existing: null, prova_pre_carregada: false, proof_resume_required: true });
          const c = await step('TELA_ORIENTACAO_PROVA', est, 'conferir_prova_existente', {}, rec.id);
          const st = abrir(c, 'TELA_ORIENTACAO_PROVA');
          return { c, b: st.prepared_existing?.binding ?? {} };
        };
        let a1;
        try { a1 = await conferir(); }
        catch (e) {
          // Prova ainda não iniciada (inscrição feita e prova nunca aberta): aciona o "Iniciar prova" como o
          // site faz, uma vez, e espera a calma antes de conferir e enviar.
          if (reLogin && !rec.prova_preparada && /idexecprova|nao foi confirmad|não foi confirmad|registro da prova/i.test(e.message)) {
            await prepararProva(base);
            log({ event: 'etapa1_fila', id: curto(rec.id), passo: 'prova_iniciada_pelo_login' });
            return salvar({ prova_preparada: true, inscrita_em: clock(), parar: true, proxima: clock() + esperaProvaMs });
          }
          throw e;
        }
        await sleep(estabilidadeMs);
        const a2 = await conferir();
        if (a1.b.executionCode !== a2.b.executionCode || a1.b.proofId !== a2.b.proofId) {
          log({ event: 'etapa1_fila', id: curto(rec.id), passo: 'prova_instavel' });
          return salvar({ parar: true, proxima: clock() + esperaProvaMs });
        }
        // 3) Abre a avaliação dessa execução (cronômetro começa agora) e segue para o envio.
        const r = await step(a2.c.screen, a2.c.data.estado, 'iniciar_redacao', {}, rec.id);
        const st = abrir(r, 'TELA_REDACAO');
        guardarTema(rec.processo, st.tema_redacao).catch(() => {});
        return salvar({ passo: 'redacao_enviar', ck: ck(r) });
      }
      case 'redacao_enviar': {
        if (!rec.redacao) return salvar({ parar: true });
        await salvar({ passo: 'redacao_enviando' });
        const r = await step(rec.ck.screen, rec.ck.estado, 'enviar_redacao', { texto_redacao: rec.redacao }, rec.id);
        if (r?.screen === 'CONFIRMACAO') return redacaoConfirmada(rec, salvar);
        try { abrir(r, 'TELA_REDACAO'); }
        catch (e) {
          // Erro antes do envio (a tela de redação volta com erro e sem recibo): pode tentar de novo.
          let st = {}; try { st = openState(r.data.estado, r.screen); } catch {}
          if (r?.screen === 'TELA_REDACAO' && !st.recibo_avaliacao) { await salvar({ passo: 'redacao' }); throw new ErroPasso(e.message, { motivo: 'redacao' }); }
          throw new ErroPasso(e.message, { final: true, motivo: 'incerto' });
        }
        return salvar({ passo: 'entrega', ck: ck(r) });
      }
      case 'entrega': {
        for (let i = 0; i < 4; i++) {
          const r = await step(rec.ck.screen, rec.ck.estado, 'verificar_entrega', {}, rec.id);
          if (r?.screen === 'CONFIRMACAO') return redacaoConfirmada(rec, salvar);
          await sleep(intervaloEntregaMs);
        }
        // A inscrição passou a apontar outra execução depois do envio: o mesmo texto vai para a
        // prova atual, com calma (até 2 vezes); depois disso, a equipe confere.
        const ult = await step(rec.ck.screen, rec.ck.estado, 'verificar_entrega', {}, rec.id);
        if (ult?.screen === 'CONFIRMACAO') return redacaoConfirmada(rec, salvar);
        let stU = {}; try { stU = openState(ult.data.estado, ult.screen); } catch {}
        if (/outra execu/i.test(stU.erro ?? '')) {
          if ((rec.reenvios ?? 0) >= 2) throw new ErroPasso('A inscrição mudou de execução de prova após o envio.', { final: true, motivo: 'execucao_trocada' });
          log({ event: 'etapa1_fila', id: curto(rec.id), passo: 'reenvio_prova_atual' });
          return salvar({ passo: 'redacao', reenvios: (rec.reenvios ?? 0) + 1, inscrita_em: clock(), parar: true, proxima: clock() + esperaProvaMs });
        }
        throw new ErroPasso('Portal ainda não confirmou a entrega da redação.', { motivo: 'entrega' });
      }
      case 'docs_inscricao': {
        if (!rec.docs_inscricao?.completo) return salvar({ parar: true });
        const pronta = (rec.inscrita_em ?? 0) + esperaDocsInscricaoMs;
        if (clock() < pronta) return salvar({ parar: true, proxima: pronta });
        let r;
        try { r = await entregarDocsInscricao(rec); }
        catch (e) {
          if (!e?.refazer) throw e;
          // Reabre: "Documentos inscrição" continua pendente no portal e o toque no Flow abre as telas de novo.
          const arq = Object.fromEntries(Object.entries(rec.docs_inscricao?.arquivos ?? {}).filter(([k]) => !e.refazer.includes(k)));
          console.error(JSON.stringify({ event: 'etapa1_fila_atencao', id: curto(rec.id), motivo: 'docs_refazer', docs: e.refazer }));
          return salvar({ docs_inscricao: { ...rec.docs_inscricao, arquivos: arq, completo: false }, docs_refazer: e.refazer, parar: true });
        }
        // Entregue: as referências dos arquivos (com as chaves de criptografia) e o login não ficam guardados.
        await salvar({ passo: 'fim', status: 'concluida', applyment_id: r.applyment_id || rec.applyment_id || '', docs_inscricao: { completo: true, enviados: r.enviados, enviado_em: clock() }, via_login: null, contato: null });
        try {
          await aoEnviarDocsInscricao({ applyment_id: r.applyment_id || rec.applyment_id, processo: r.processo || rec.processo, login: rec.via_login?.login, data_nascimento: rec.via_login?.data_nascimento, contato: rec.contato, stages: r.stages });
        } catch (e) { log({ event: 'etapa1_fila_erro', id: curto(rec.id), passo: 'vigia_inscricao', message: String(e?.message ?? e).slice(0, 120) }); }
        return 'parar';
      }
      case 'final_enviando':
      case 'redacao_enviando':
        throw new ErroPasso('O envio anterior foi interrompido sem confirmação.', { final: true, motivo: 'incerto' });
      default:
        throw new ErroPasso('Passo desconhecido: ' + rec.passo, { final: true });
    }
  }

  async function worker(id) {
    const inicio = clock();
    let f = await store.get(id, FILA);
    if (!f) return 204;
    if (FINAIS.has(f.record.status)) return 204;
    if ((f.record.rodando_ate ?? 0) > clock()) return 204; // outro worker está com ela
    let version;
    { const rec = { ...f.record, rodando_ate: clock() + 170000 };
      if (!await store.update(id, rec, f.version, FILA)) return 204;
      f = await store.get(id, FILA); version = f.version; }
    let rec = f.record;

    async function salvar(patch) {
      for (let i = 0; i < 5; i++) {
        const atual = i === 0 ? { record: rec, version } : await store.get(id, FILA);
        const novo = { ...atual.record, ...patch, redacao: atual.record.redacao ?? rec.redacao };
        delete novo.parar;
        // Entregue: os dados pessoais e o texto não ficam guardados além do necessário.
        if (novo.status === 'concluida') { novo.respostas = null; novo.redacao = null; novo.ck = null; }
        if (await store.update(id, novo, atual.version, FILA)) {
          const lido = await store.get(id, FILA);
          rec = lido.record; version = lido.version;
          log({ event: 'etapa1_fila', id: curto(id), passo: rec.passo, status: rec.status, ms: clock() - inicio });
          return patch.parar ? 'parar' : 'ok';
        }
        if (i === 0) { const lido = await store.get(id, FILA); rec = lido.record; version = lido.version; }
      }
      throw new Error('Não foi possível gravar o andamento da inscrição.');
    }

    // Passo em que a volta começou: é ele que conta como "o passo que falhou".
    let passoDaVolta = rec.passo;
    try {
      while (!FINAIS.has(rec.status) && clock() - inicio < orcamentoMs) {
        passoDaVolta = rec.passo;
        const r = await executarPasso(rec, salvar);
        // O passo que tinha falhado agora deu certo: as tentativas recomeçam do zero (falhas antigas não somam).
        if (rec.tentativas && rec.erro_passo === passoDaVolta && rec.passo !== passoDaVolta) await salvar({ tentativas: 0, erro_passo: null, ultimo_motivo: null });
        if (r === 'parar') break;
      }
    } catch (e) {
      const passoAntes = rec.passo;
      const final = e instanceof ErroPasso && e.final;
      const esperaPortal = e?.motivo === 'docs_nao_liberado';
      // Espera pelo portal e falha de envio têm contagens próprias: ao trocar de uma para a outra, recomeça.
      const mesmaContagem = esperaPortal === (rec.ultimo_motivo === 'docs_nao_liberado');
      const tentativas = (mesmaContagem ? rec.tentativas ?? 0 : 0) + 1;
      const limite = esperaPortal ? MAX_TENTATIVAS_DOCS_PORTAL : MAX_TENTATIVAS;
      const status = final ? (e.motivo === 'duplicada' ? 'duplicada' : 'conferir') : tentativas >= limite ? 'falhou' : rec.status;
      // Antes da conclusão, uma nova tentativa recomeça numa sessão nova do Rubeus.
      const passo = !final && ['basicos', 'turnos', 'curso', 'final'].includes(rec.passo) ? 'inicio' : rec.passo;
      await salvar({ status, passo, tentativas, erro_passo: passoDaVolta, ultimo_motivo: e?.motivo ?? 'erro', ultimo_erro: String(e?.message ?? e).slice(0, 200), rodando_ate: 0 });
      // Aviso de atenção na 6ª espera (a equipe confere o portal); depois só o log comum até liberar.
      const atencao = FINAIS.has(status) || (esperaPortal && tentativas === ALERTA_DOCS_PORTAL);
      const evento = { event: atencao ? 'etapa1_fila_atencao' : 'etapa1_fila_erro', id: curto(id), passo: passoAntes, status, tentativa: tentativas, motivo: e?.motivo ?? 'erro', applyment_id: rec.applyment_id ?? '', message: String(e?.message ?? e).slice(0, 160) };
      atencao ? console.error(JSON.stringify(evento)) : log(evento);
      // Próxima tentativa agendada no Cloud Tasks (o Run fica desligado na espera). Tabela em api/retentativas.js.
      if (!FINAIS.has(status)) await disparar(id, esperaPortal ? Math.min(600, 60 * tentativas) : esperaDepoisDaFalha(tentativas));
      return 204;
    }
    // Libera e, se ainda há trabalho (orçamento acabou ou a redação chegou agora), agenda a continuação.
    await salvar({ rodando_ate: 0 });
    const R2 = rec.respostas ?? {};
    const pronto = { inicio: true, basicos: Boolean(R2.nome), turnos: Boolean(R2.curso_id), curso: !ehEnem(rec.processo) || Boolean(R2.numero_inscricao_enem), final: Boolean(R2.cpf), redacao: Boolean(rec.redacao), redacao_enviar: Boolean(rec.redacao), entrega: true, docs_inscricao: Boolean(rec.docs_inscricao?.completo) };
    const temTrabalho = !FINAIS.has(rec.status) && pronto[rec.passo] === true;
    if (temTrabalho) await disparar(id, rec.proxima > clock() ? Math.ceil((rec.proxima - clock()) / 1000) : 0);
    return 204;
  }

  // LOGIN com a prova disponível: abre o "Portal do candidato" da etapa 1 (Realizar prova → … → redação).
  // A redação segue o mesmo caminho da jornada direta (guardada e enviada pelo worker, com calma).
  async function entrarNaProva({ applyment_id, processo, login, data_nascimento, flowToken }) {
    const id = hash('login-prova:' + applyment_id);
    const flow = hash(flowToken ?? '');
    const novo = { id, processo: String(processo), flow, applyment_id: String(applyment_id), via_login: { login, data_nascimento }, respostas: {}, redacao: null, status: 'inscrita', passo: 'redacao', inscrita_em: 0, tentativas: 0, criado: clock(), expires: clock() + 30 * DIA };
    const atual = await store.get(id, FILA);
    if (!atual) await store.create(id, novo, FILA);
    else if (atual.record.status !== 'concluida') await store.update(id, { ...atual.record, flow, via_login: novo.via_login, status: atual.record.status === 'falhou' ? 'inscrita' : atual.record.status, tentativas: atual.record.status === 'falhou' ? 0 : atual.record.tentativas }, atual.version, FILA);
    log({ event: 'etapa1_fila', id: curto(id), passo: 'login_prova' });
    return renderE1('INSC_PORTAL', { e1: true, processo_seletivo_id: String(processo), eh_nota_enem: false, fila_id: id });
  }

  // LOGIN com "Documentos inscrição: Pendentes [Verificar]" (fechou o Flow antes de enviar, ou a equipe recusou
  // algum): abre as mesmas telas de documento. `codigos` = só os recusados (vazio = a lista toda do processo).
  async function entrarNosDocsInscricao({ applyment_id, processo, login, data_nascimento, flowToken, codigos = [] }) {
    const todos = docsInscricao(processo);
    // Reenvio dos recusados: cada um é obrigatório (a equipe pediu de novo), mesmo que no site seja opcional.
    const docs = codigos?.length ? todos.filter(x => codigos.includes(x.codigo)).map(x => ({ ...x, obrigatorio: true, recusado: true })) : todos;
    if (!applyment_id || !docs.length) return fimE1('Documentos de inscrição', 'Envie os documentos pelo Portal do candidato: vestibular.unibalsas.edu.br/presencial (entre com seu CPF e a data de nascimento).');
    const id = hash('login-docs:' + applyment_id);
    const flow = hash(flowToken ?? '');
    const base = { processo: String(processo), flow, applyment_id: String(applyment_id), via_login: { login: digits(login), data_nascimento }, respostas: {}, redacao: null, status: 'inscrita', passo: 'docs_inscricao', inscrita_em: 0, tentativas: 0, rodando_ate: 0, docs_inscricao: null };
    for (let i = 0; i < 3; i++) {
      const atual = await store.get(id, FILA);
      if (!atual) { if (await store.create(id, { id, ...base, criado: clock(), expires: clock() + 30 * DIA }, FILA).then(() => true, () => false)) break; continue; }
      // Envio ainda em andamento (worker rodando): não apaga o que já foi guardado; só troca a sessão do Flow.
      const emAndamento = atual.record.status === 'inscrita' && atual.record.docs_inscricao?.completo;
      const novo = emAndamento ? { ...atual.record, flow, via_login: base.via_login } : { ...atual.record, ...base, expires: clock() + 30 * DIA };
      if (await store.update(id, novo, atual.version, FILA)) break;
    }
    log({ event: 'etapa1_fila', id: curto(id), passo: 'login_documentos_inscricao', quantidade: docs.length });
    return telaDocumento({ e1: true, processo_seletivo_id: String(processo), eh_nota_enem: ehEnem(processo), fila_id: id, docs }, 0);
  }

  return { route, worker, entrarNaProva, entrarNosDocsInscricao, renderE1, guardarTema, lerCache, gravarCache, cacheCompleto };
}
