// Etapa 1 do Vestibular (inscrição + redação) em modo fila.
//
// O Flow responde na hora: as telas são montadas com o cache (cursos, turnos e tema da redação) e
// as respostas são conferidas aqui, com as mesmas regras do caminho síncrono. Ao concluir a
// inscrição, os dados ficam guardados (Firestore, criptografados) e um worker do Cloud Run repete
// no Rubeus exatamente os passos do caminho síncrono (mesmo código), conferindo cada tela.
//
// Liga com ETAPA1_FILA=on. Sem o cache completo, o Flow segue o caminho síncrono de sempre (e esse
// caminho aquece o cache).
import crypto from 'node:crypto';

const DIA = 86400000;
const FILA = 'inscricoesFila';
const CACHE = 'flowCache';
const FINAIS = new Set(['concluida', 'duplicada', 'conferir', 'falhou']);
const MAX_TENTATIVAS = 6;
export const DUPLICADA_MSG = 'Você já possui inscrição neste processo seletivo ou no curso selecionado! Acesse o Portal do candidato para acompanhar sua inscrição.';
const hash = v => crypto.createHash('sha256').update(String(v)).digest('hex');
const digits = v => String(v ?? '').replace(/\D/g, '');
const curto = id => String(id).slice(0, 10);

class ErroPasso extends Error {
  constructor(message, { final = false, motivo = 'passo' } = {}) { super(message); this.final = final; this.motivo = motivo; }
}

export function createEtapa1({
  ativo = () => process.env.ETAPA1_FILA === 'on',
  store, enqueue, runStep, runLive = runStep, sealState, openState, render,
  ehEnem = () => false, validateEnem = () => {}, anosEnem = [], avisar = async () => false,
  validateBasic, validateFinal, origens, hoje, requiresEssay, academicId, userFields,
  jaInscritoNoRm = async () => false,
  clock = Date.now, sleep = ms => new Promise(r => setTimeout(r, ms)),
  orcamentoMs = 80000, intervaloEntregaMs = 8000,
  log = e => console.info(JSON.stringify(e))
}) {
  // ---------------------------------------------------------------- cache
  const memo = new Map();
  const aquecendo = new Set();
  async function lerCache(processo, { fresco = false } = {}) {
    const m = memo.get(processo);
    if (!fresco && m && clock() - m.at < 60000) return m.value;
    let value = null;
    try { value = (await store.get('etapa1-' + processo, CACHE))?.record ?? null; } catch {}
    // Só guarda em memória o que existe: cache vazio é relido no próximo toque.
    if (value) memo.set(processo, { at: clock(), value });
    return value;
  }
  function cacheCompleto(c) {
    return Boolean(c?.tema && c.cursos?.length && clock() - (c.atualizado ?? 0) < 3 * DIA &&
      c.cursos.every(x => (c.turnos?.[x.id] ?? []).length > 0));
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
  // Busca os turnos de todos os cursos usando a sessão de uma tela CURSO_INTERESSE (só leitura).
  async function turnosDeTodos(estadoCurso, cursos, processo) {
    const turnos = {};
    const fila = [...cursos];
    async function trabalhador() {
      for (let c = fila.shift(); c; c = fila.shift()) {
        try {
          const r = await runStep({ screen: 'CURSO_INTERESSE', action: 'data_exchange', flow_token: 'etapa1-cache', data: { acao: 'buscar_turnos', estado: estadoCurso, curso_id: c.id } });
          const st = openState(r.data.estado, r.screen);
          if (!st.erro && st.turnos?.length) turnos[c.id] = st.turnos;
        } catch {}
      }
    }
    await Promise.all([1, 2, 3, 4].map(trabalhador));
    await gravarCache(processo, { cursos, turnos });
    log({ event: 'etapa1_cache', processo, cursos: cursos.length, com_turno: Object.keys(turnos).length });
  }
  // Chamado pelo caminho síncrono ao montar a tela de curso: aquece o cache para os próximos.
  async function aquecer(processo, respostaCurso) {
    if (!requiresEssay(processo) || aquecendo.has(processo)) return;
    const c = await lerCache(processo);
    if (c?.cursos?.length && c.cursos.every(x => (c.turnos?.[x.id] ?? []).length) && clock() - (c.atualizado ?? 0) < 6 * 3600000) return;
    aquecendo.add(processo);
    try {
      const st = openState(respostaCurso.data.estado, respostaCurso.screen);
      if (st.cursos?.length) await turnosDeTodos(respostaCurso.data.estado, st.cursos, processo);
    } finally { aquecendo.delete(processo); }
  }

  // ---------------------------------------------------------------- Flow (instantâneo)
  const pick = d => Object.fromEntries(Object.entries(d ?? {}).filter(([k]) => userFields.has(k)));

  // Guarda a inscrição completa e agenda o envio. Devolve { id } ou { erro } (mensagem para o candidato).
  async function receberInscricao(processo, respostas, flowToken) {
    const cpf = digits(respostas.cpf);
    const id = hash('etapa1:' + processo + ':' + cpf);
    const flow = hash(flowToken ?? '');
    try {
      if (await jaInscritoNoRm(academicId(processo), cpf)) {
        log({ event: 'etapa1_fila', id: curto(id), passo: 'duplicada_rm' });
        return { erro: DUPLICADA_MSG };
      }
      const record = { id, processo, flow, respostas, redacao: null, status: 'pendente', passo: 'inicio', tentativas: 0, criado: clock(), expires: clock() + 30 * DIA };
      if (!await store.create(id, record, FILA)) {
        const atual = await store.get(id, FILA);
        if (atual && atual.record.status === 'falhou') {
          if (!await store.update(id, record, atual.version, FILA)) throw new Error('conflito');
        } else if (atual && atual.record.flow !== flow) {
          log({ event: 'etapa1_fila', id: curto(id), passo: 'duplicada_fila' });
          return { erro: DUPLICADA_MSG };
        }
      }
      log({ event: 'etapa1_fila', id: curto(id), passo: 'recebida', status: 'pendente' });
    } catch (e) {
      log({ event: 'etapa1_fila_erro', passo: 'receber', message: String(e?.message ?? e).slice(0, 120) });
      return { erro: 'Não conseguimos guardar sua inscrição agora. Toque em Concluir inscrição de novo.' };
    }
    await disparar(id);
    return { id };
  }
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
    await disparar(filaId);
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
  const INSC_KEYS = {
    INSC_DADOS: ['estado', 'erro', 'tem_erro', 'data_maxima_nascimento', ...valor('nome', 'possui_nome_social', 'nome_social', 'email', 'data_nascimento', 'celular', 'genero', 'aceite_privacidade')],
    INSC_CURSO: ['estado', 'erro', 'tem_erro', 'cursos', 'turnos', 'turno_visivel', ...valor('curso_id', 'turno_id')],
    INSC_QUASE_LA: ['estado', 'erro', 'tem_erro', 'origens', 'eh_nota_enem', 'anos_enem', ...valor('cpf', 'nacionalidade', 'concluiu_ensino_medio', 'possui_deficiencia', 'tipos_deficiencia', 'deficiencia_outra', 'como_conheceu', 'como_conheceu_outro', ...ENEM_CAMPOS)],
    INSC_REDACAO: ['estado', 'erro', 'tem_erro', 'tema_redacao', ...valor('texto_redacao')],
    INSC_FIM: ['titulo', 'mensagem']
  };
  const INSC_PADRAO = { tem_erro: false, turno_visivel: false, eh_nota_enem: false, valor_possui_nome_social: false, valor_aceite_privacidade: false, valor_nacionalidade: '10', valor_tipos_deficiencia: [], cursos: [], turnos: [], origens: [], anos_enem: [] };
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
    await disparar(id);
  }
  // Espera o worker trazer do Rubeus o que a tela precisa (só quando o cache ainda não tem).
  async function esperarCache(processo, pronto, ms = 6000) {
    const ate = clock() + ms;
    for (;;) {
      const c = await lerCache(processo, { fresco: true });
      if (pronto(c)) return c;
      if (clock() + 700 > ate) return c;
      await sleep(700);
    }
  }
  const ERRO_GRAVAR = 'Não conseguimos guardar seus dados agora. Toque no botão de novo.';
  const falha = (passo, e) => log({ event: 'etapa1_fila_erro', passo, message: String(e?.message ?? e).slice(0, 160) });

  async function routeE1(req) {
    const d = req.data ?? {}, acao = d.acao, screen = req.screen;
    if (screen === 'INSC_INICIO') {
      if (acao !== 'e1_iniciar') return null;
      const processo = String(d.processo_seletivo_id || processoE1());
      if (!academicId(processo)) return fimE1('Inscrição pelo site', 'Este processo seletivo não está disponível pelo WhatsApp. Faça sua inscrição pelo site vestibular.unibalsas.edu.br/presencial.');
      return renderE1('INSC_DADOS', { e1: true, processo_seletivo_id: processo, eh_nota_enem: ehEnem(processo), fila_id: hash('insc:' + processo + ':' + (req.flow_token ?? crypto.randomUUID())), data_maxima_nascimento: hoje(), erro: '' });
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
      const c = await esperarCache(processo, x => x?.cursos?.length);
      if (!c?.cursos?.length) return renderE1('INSC_DADOS', { ...s, values: u, erro: 'Seus dados foram salvos. Estamos carregando os cursos: toque em Avançar de novo.' });
      return renderE1('INSC_CURSO', { ...base, cursos: c.cursos, turnos: [], turno_visivel: false, erro: '' });
    }

    // Curso e turno na mesma tela: ao escolher o curso, os turnos aparecem abaixo.
    if (screen === 'INSC_CURSO' && (acao === 'buscar_turnos' || acao === 'escolher_curso')) {
      const curso = String(u.curso_id ?? '');
      if (!(s.cursos ?? []).some(c => c.id === curso)) return renderE1('INSC_CURSO', { ...s, erro: 'Selecione um curso.' });
      if (acao === 'buscar_turnos' || curso !== s.curso_selecionado) {
        const c = await esperarCache(processo, x => x?.turnos?.[curso]?.length);
        const turnos = c?.turnos?.[curso] ?? [];
        if (!turnos.length) return renderE1('INSC_CURSO', { ...s, curso_selecionado: '', turnos: [], turno_visivel: false, values: { curso_id: curso }, erro: 'Estamos carregando os turnos deste curso. Toque no curso de novo em alguns segundos.' });
        const unico = turnos.length === 1 ? turnos[0].id : '';
        return renderE1('INSC_CURSO', { ...s, curso_selecionado: curso, turnos, turno_visivel: true, values: { curso_id: curso, turno_id: unico }, erro: '' });
      }
      const turno = String(u.turno_id ?? '');
      if (!(s.turnos ?? []).some(t => t.id === turno)) return renderE1('INSC_CURSO', { ...s, values: { curso_id: curso }, erro: 'Selecione o turno.' });
      try { await gravarTela(s.fila_id, processo, req.flow_token, { curso_id: curso, turno_id: turno }); }
      catch (e) { falha('curso', e); return renderE1('INSC_CURSO', { ...s, values: { curso_id: curso, turno_id: turno }, erro: ERRO_GRAVAR }); }
      return renderE1('INSC_QUASE_LA', { ...base, origens, anos_enem: base.eh_nota_enem ? anosEnem : [], erro: '' });
    }

    // Concluir: valida, grava no Firestore, agenda o worker e FECHA o Flow na hora.
    if (screen === 'INSC_QUASE_LA' && acao === 'enviar_informacoes_complementares') {
      try {
        validateFinal({ ...u, origens: s.origens });
        if (s.eh_nota_enem) validateEnem(u);
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
      return sucesso(req.flow_token, { status: 'dados_recebidos', protocolo_fila: curto(s.fila_id), processo_seletivo_id: processo });
    }

    // Etapa 2: envio da redação também só grava, agenda e fecha o Flow na hora.
    if (screen === 'INSC_REDACAO' && acao === 'enviar_redacao') {
      const texto = String(u.texto_redacao ?? '').trim();
      if (texto.length < 50) return renderE1('INSC_REDACAO', { ...s, values: u, erro: 'Por favor, desenvolva mais a sua redação antes de enviar.' });
      const erroRed = await receberRedacao(s.fila_id, texto, req.flow_token);
      if (erroRed) return renderE1('INSC_REDACAO', { ...s, values: u, erro: erroRed });
      return sucesso(req.flow_token, { status: 'redacao_recebida', protocolo_fila: curto(s.fila_id) });
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
    const rec = f?.record;
    if (!rec) return fimE1('Inscrição não encontrada', 'Não encontramos sua inscrição. Fale com a nossa equipe por aqui.');
    if (rec.redacao || ['concluida', 'conferir'].includes(rec.status) || !['redacao', 'redacao_enviar'].includes(rec.passo)) {
      if (rec.redacao || rec.status === 'concluida') return fimE1('Redação enviada ✅', 'Você realizou a sua prova. Em breve o resultado estará disponível.');
      return fimE1('Prova em preparação', 'Sua prova ainda está sendo preparada. Abra a mensagem de novo em alguns minutos.');
    }
    let tema = (await lerCache(rec.processo))?.tema;
    if (!tema && rec.passo === 'redacao' && rec.ck) {
      // Primeira vez (tema ainda não guardado): o candidato abriu a redação, então a prova é aberta agora.
      try {
        const r = await runLive({ screen: rec.ck.screen, action: 'data_exchange', flow_token: 'insc', data: { acao: 'iniciar_redacao', estado: rec.ck.estado } });
        const st = r?.data?.estado ? openState(r.data.estado, r.screen) : {};
        if (r?.screen === 'TELA_REDACAO' && st.tema_redacao) {
          tema = st.tema_redacao;
          guardarTema(rec.processo, tema).catch(() => {});
          if (!((rec.rodando_ate ?? 0) > clock())) await store.update(rec.id, { ...rec, passo: 'redacao_enviar', ck: { screen: r.screen, estado: r.data.estado } }, f.version, FILA).catch(() => false);
        }
      } catch (e) { falha('abrir_prova', e); }
    }
    if (!tema) return fimE1('Prova em preparação', 'Não conseguimos carregar o tema agora. Abra a mensagem de novo em alguns minutos.');
    log({ event: 'etapa1_fila', id: curto(rec.id), passo: 'redacao_aberta' });
    return renderE1('INSC_REDACAO', { e1: true, processo_seletivo_id: rec.processo, fila_id: rec.id, tema_redacao: tema, erro: '' });
  }

  // Endpoint próprio (/api/flow/etapa1), opcional: o mesmo Flow também funciona em /api/flow.
  async function endpoint(req) {
    const action = req?.action;
    if (action === 'ping') return { data: { status: 'active' } };
    if (req?.data?.error) {
      console.warn(JSON.stringify({ event: 'flow_client_error', flow: 'etapa1', screen: String(req.screen ?? ''), error: String(req.data.error).slice(0, 120), error_message: String(req.data.error_message ?? '').slice(0, 300) }));
      return { data: { acknowledged: true } };
    }
    if (action === 'INIT') return (await abrirRedacao(req).catch(() => null)) ?? { screen: 'INSC_INICIO', data: {} };
    if (action === 'data_exchange' && String(req.screen ?? '').startsWith('INSC_')) {
      const resposta = await route(req);
      if (resposta) return resposta;
    }
    return fimE1('Algo deu errado', 'Não conseguimos continuar sua inscrição agora. Abra a mensagem de inscrição de novo em alguns minutos.');
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
    if (!ativo()) return null;
    const d = req.data ?? {}, acao = d.acao, screen = req.screen;

    if (acao === 'selecionar_processo' && screen === 'ESCOLHA_PROCESSO') {
      if (d.modo === 'continuar') return null;
      const processo = String(d.processo_seletivo_id ?? d.processo_id ?? '');
      if (!requiresEssay(processo)) return null;
      let trusted; try { trusted = openState(d.estado, screen); } catch { return null; }
      if (!(trusted.processos_disponiveis ?? []).map(String).includes(processo)) return null;
      const cache = await lerCache(processo);
      if (!cacheCompleto(cache)) { log({ event: 'etapa1_fila', passo: 'cache_incompleto', processo }); return null; }
      return render('DADOS_BASICOS', { modo_fila: true, processo_seletivo_id: processo, eh_nota_enem: false, data_maxima_nascimento: hoje(), titulo_etapa: 'Dados básicos', erro: '' });
    }

    let s; try { s = openState(d.estado, screen); } catch { return null; }
    if (!s.modo_fila) return null;
    const u = pick(d);
    const processo = s.processo_seletivo_id;

    if (screen === 'DADOS_BASICOS' && acao === 'enviar_dados_basicos') {
      try { validateBasic(u); } catch (e) { return render('DADOS_BASICOS', { ...s, values: u, erro: e.message }); }
      const cache = await lerCache(processo);
      if (!cache?.cursos?.length) return render('DADOS_BASICOS', { ...s, values: u, erro: 'Não conseguimos carregar os cursos agora. Toque em Continuar de novo.' });
      return render('CURSO_INTERESSE', { ...s, respostas: { ...s.respostas, ...u }, cursos: cache.cursos, turnos: [], turno_visivel: false, curso_selecionado: '', turno_selecionado: '', anos_enem: [], erro: '' });
    }

    if (screen === 'CURSO_INTERESSE' && (acao === 'buscar_turnos' || acao === 'avancar_curso_interesse')) {
      const curso = String(u.curso_id ?? '');
      if (!(s.cursos ?? []).some(c => c.id === curso)) return render('CURSO_INTERESSE', { ...s, erro: 'Selecione um curso para ver os turnos.' });
      if (acao === 'buscar_turnos' || curso !== s.curso_selecionado || !(s.turnos ?? []).length) {
        const turnos = (await lerCache(processo))?.turnos?.[curso] ?? [];
        if (!turnos.length) return render('CURSO_INTERESSE', { ...s, turnos: [], turno_visivel: false, curso_selecionado: curso, turno_selecionado: '', erro: 'Nenhum turno disponível para o curso selecionado.' });
        return render('CURSO_INTERESSE', { ...s, turnos, turno_visivel: true, curso_selecionado: curso, turno_selecionado: turnos.length === 1 ? turnos[0].id : '', erro: '' });
      }
      if (!(s.turnos ?? []).some(t => t.id === u.turno_id)) return render('CURSO_INTERESSE', { ...s, erro: 'Selecione o turno correspondente.' });
      return render('QUASE_LA', { modo_fila: true, processo_seletivo_id: processo, eh_nota_enem: false, respostas: { ...s.respostas, curso_id: curso, turno_id: String(u.turno_id) }, origens, erro: '' });
    }

    if (screen === 'QUASE_LA' && acao === 'enviar_informacoes_complementares') {
      try { validateFinal({ ...u, origens: s.origens }); } catch (e) { return render('QUASE_LA', { ...s, values: u, erro: e.message }); }
      const rec = await receberInscricao(processo, { ...s.respostas, ...u }, req.flow_token);
      if (rec.erro) return render('QUASE_LA', { ...s, values: u, erro: rec.erro });
      const id = rec.id;
      return render('TELA_ORIENTACAO_PROVA', { modo_fila: true, processo_seletivo_id: processo, fila_id: id, tema_redacao: '', texto_motivador: '', erro: '' });
    }

    if (screen === 'TELA_ORIENTACAO_PROVA' && acao === 'iniciar_redacao') {
      const tema = (await lerCache(processo))?.tema;
      if (!tema) return render('TELA_ORIENTACAO_PROVA', { ...s, erro: 'Não conseguimos carregar o tema agora. Toque em Iniciar redação de novo.' });
      return render('TELA_REDACAO', { modo_fila: true, processo_seletivo_id: processo, fila_id: s.fila_id, tema_redacao: tema, erro: '' });
    }

    if (screen === 'TELA_REDACAO' && acao === 'enviar_redacao') {
      const texto = String(u.texto_redacao ?? '').trim();
      if (texto.length < 50) return render('TELA_REDACAO', { ...s, values: u, erro: 'Por favor, desenvolva mais a sua redação antes de enviar.' });
      const erroRed = await receberRedacao(s.fila_id, texto, req.flow_token);
      if (erroRed) return render('TELA_REDACAO', { ...s, values: u, erro: erroRed });
      return render('CONFIRMACAO', {
        titulo: 'Redação enviada ✅',
        mensagem: 'Recebemos sua inscrição e sua redação!\n\nAgora nossa equipe vai corrigir. Assim que a correção sair, você recebe uma mensagem aqui no WhatsApp para seguir para a próxima etapa.',
        inscricao_id: ''
      });
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
    const token = crypto.randomBytes(18).toString('base64url');
    await store.create(hash(token), { fila_id: rec.id, expires: clock() + 30 * DIA }, 'flowTokens');
    const enviado = await avisar({ celular: rec.respostas?.celular, nome: rec.respostas?.nome, flowToken: token }).catch(() => false);
    return salvar({ token_redacao: hash(token), aviso_redacao: enviado ? 'enviado' : 'nao_enviado', aviso_em: clock() });
  }

  async function executarPasso(rec, salvar) {
    const R = rec.respostas;
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
        // Cursos e turnos vêm desta sessão (só leitura) e alimentam as telas do Flow.
        if (st.cursos?.length) {
          const c = await lerCache(rec.processo, { fresco: true });
          if (!c?.cursos?.length || !cacheCompletoSemTema(c) || clock() - (c.atualizado ?? 0) > 6 * 3600000) {
            await gravarCache(rec.processo, { cursos: st.cursos });
            try { await turnosDeTodos(r.data.estado, st.cursos, rec.processo); } catch {}
          }
        }
        return salvar({ passo: 'turnos', ck: ck(r) });
      }
      case 'turnos': {
        if (!R.curso_id || !R.turno_id) return salvar({ parar: true });
        let st0 = {}; try { st0 = openState(rec.ck.estado, rec.ck.screen); } catch {}
        if (st0.cursos && !st0.cursos.some(c => c.id === R.curso_id)) throw new ErroPasso('O curso escolhido não está mais disponível no Rubeus.', { final: true, motivo: 'curso_indisponivel' });
        const r = await step(rec.ck.screen, rec.ck.estado, 'buscar_turnos', { curso_id: R.curso_id }, rec.id);
        const st = abrirCurso(r);
        if (!st.turnos?.some(t => t.id === R.turno_id)) throw new ErroPasso('O turno escolhido não veio na consulta do Rubeus.', { motivo: 'turno' });
        // Aproveita a sessão para renovar o cache de cursos e turnos (só leitura).
        const c = await lerCache(rec.processo, { fresco: true });
        if (!c?.atualizado || clock() - c.atualizado > 6 * 3600000 || !cacheCompletoSemTema(c)) {
          try { await turnosDeTodos(rec.ck.estado, st.cursos, rec.processo); } catch {}
        }
        return salvar({ passo: 'curso', ck: ck(r) });
      }
      case 'curso': {
        // ENEM: o curso vai junto com as notas, que chegam na última tela.
        if (ehEnem(rec.processo) && !R.numero_inscricao_enem) return salvar({ parar: true });
        const notas = ehEnem(rec.processo) ? Object.fromEntries(ENEM_CAMPOS.map(k => [k, R[k]])) : {};
        const r = await step(rec.ck.screen, rec.ck.estado, rec.ck.screen === 'CURSO_INGRESSO' ? 'avancar_curso_ingresso' : 'avancar_curso_interesse', { curso_id: R.curso_id, turno_id: R.turno_id, ...notas }, rec.id);
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
        // Transferência, Portador e ENEM: a etapa 1 termina na inscrição confirmada.
        if (!requiresEssay(rec.processo)) {
          if (!['ACOMPANHAMENTO', 'CONFIRMACAO', 'PORTAL_STATUS'].includes(r?.screen)) throw new ErroPasso('Tela inesperada: ' + r?.screen, { final: true, motivo: 'incerto' });
          let st = {}; try { st = r.data.estado ? openState(r.data.estado, r.screen) : {}; } catch {}
          return salvar({ passo: 'fim', status: 'concluida', applyment_id: String(st.applyment_id ?? '') });
        }
        let st;
        try { st = abrir(r, 'TELA_ORIENTACAO_PROVA'); }
        catch (e) { throw new ErroPasso(e.message, { final: true, motivo: 'incerto' }); }
        // Vestibular: prova vinculada (pré-carga do Iniciar prova, sem abrir o cronômetro) e aviso da etapa 2.
        await salvar({ passo: 'redacao', status: 'inscrita', applyment_id: String(st.applyment_id ?? ''), prova_vinculada: Boolean(st.prova_pre_carregada), ck: ck(r) });
        return avisarEtapa2(rec, salvar);
      }
      case 'redacao': {
        if (!rec.redacao) return salvar({ parar: true });
        let r = await step(rec.ck.screen, rec.ck.estado, 'iniciar_redacao', {}, rec.id);
        if (r?.screen === 'TELA_ORIENTACAO_PROVA') {
          let st = {}; try { st = openState(r.data.estado, r.screen); } catch {}
          if (st.proof_resume_required) {
            const c = await step(r.screen, r.data.estado, 'conferir_prova_existente', {}, rec.id);
            abrir(c, 'TELA_ORIENTACAO_PROVA');
            r = await step(c.screen, c.data.estado, 'iniciar_redacao', {}, rec.id);
          }
        }
        const st = abrir(r, 'TELA_REDACAO');
        guardarTema(rec.processo, st.tema_redacao).catch(() => {});
        return salvar({ passo: 'redacao_enviar', ck: ck(r) });
      }
      case 'redacao_enviar': {
        if (!rec.redacao) return salvar({ parar: true });
        await salvar({ passo: 'redacao_enviando' });
        const r = await step(rec.ck.screen, rec.ck.estado, 'enviar_redacao', { texto_redacao: rec.redacao }, rec.id);
        if (r?.screen === 'CONFIRMACAO') return salvar({ passo: 'fim', status: 'concluida' });
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
          if (r?.screen === 'CONFIRMACAO') return salvar({ passo: 'fim', status: 'concluida' });
          await sleep(intervaloEntregaMs);
        }
        throw new ErroPasso('Portal ainda não confirmou a entrega da redação.', { motivo: 'entrega' });
      }
      case 'final_enviando':
      case 'redacao_enviando':
        throw new ErroPasso('O envio anterior foi interrompido sem confirmação.', { final: true, motivo: 'incerto' });
      default:
        throw new ErroPasso('Passo desconhecido: ' + rec.passo, { final: true });
    }
  }
  function cacheCompletoSemTema(c) { return Boolean(c?.cursos?.length && c.cursos.every(x => (c.turnos?.[x.id] ?? []).length > 0)); }

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

    try {
      while (!FINAIS.has(rec.status) && clock() - inicio < orcamentoMs) {
        const r = await executarPasso(rec, salvar);
        if (r === 'parar') break;
      }
    } catch (e) {
      const passoAntes = rec.passo;
      const tentativas = (rec.tentativas ?? 0) + 1;
      const final = e instanceof ErroPasso && e.final;
      const status = final ? (e.motivo === 'duplicada' ? 'duplicada' : 'conferir') : tentativas >= MAX_TENTATIVAS ? 'falhou' : rec.status;
      // Antes da conclusão, uma nova tentativa recomeça numa sessão nova do Rubeus.
      const passo = !final && ['basicos', 'turnos', 'curso', 'final'].includes(rec.passo) ? 'inicio' : rec.passo;
      await salvar({ status, passo, tentativas, ultimo_erro: String(e?.message ?? e).slice(0, 200), rodando_ate: 0 });
      const evento = { event: FINAIS.has(status) ? 'etapa1_fila_atencao' : 'etapa1_fila_erro', id: curto(id), passo: passoAntes, status, motivo: e?.motivo ?? 'erro', applyment_id: rec.applyment_id ?? '', message: String(e?.message ?? e).slice(0, 160) };
      FINAIS.has(status) ? console.error(JSON.stringify(evento)) : log(evento);
      if (!FINAIS.has(status)) await disparar(id, Math.min(600, 15 * 2 ** tentativas));
      return 204;
    }
    // Libera e, se ainda há trabalho (orçamento acabou ou a redação chegou agora), agenda a continuação.
    await salvar({ rodando_ate: 0 });
    const R2 = rec.respostas ?? {};
    const pronto = { inicio: true, basicos: Boolean(R2.nome), turnos: Boolean(R2.curso_id && R2.turno_id), curso: !ehEnem(rec.processo) || Boolean(R2.numero_inscricao_enem), final: Boolean(R2.cpf), redacao: Boolean(rec.redacao), redacao_enviar: Boolean(rec.redacao), entrega: true };
    const temTrabalho = !FINAIS.has(rec.status) && pronto[rec.passo] === true;
    if (temTrabalho) await disparar(id);
    return 204;
  }

  return { route, endpoint, worker, renderE1, aquecer, guardarTema, lerCache, gravarCache, cacheCompleto };
}
