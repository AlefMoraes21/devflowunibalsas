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
  store, enqueue, runStep, sealState, openState, render,
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
    memo.set(processo, { at: clock(), value });
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
    if (!ativo() || !tema) return;
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
    if (!ativo() || !requiresEssay(processo) || aquecendo.has(processo)) return;
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

  async function route(req) {
    if (!ativo() || req?.action !== 'data_exchange') return null;
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
      const cpf = digits(u.cpf);
      const id = hash('etapa1:' + processo + ':' + cpf);
      const flow = hash(req.flow_token ?? '');
      try {
        if (await jaInscritoNoRm(academicId(processo), cpf)) {
          log({ event: 'etapa1_fila', id: curto(id), passo: 'duplicada_rm' });
          return render('QUASE_LA', { ...s, values: u, erro: DUPLICADA_MSG });
        }
        const record = { id, processo, flow, respostas: { ...s.respostas, ...u }, redacao: null, status: 'pendente', passo: 'inicio', tentativas: 0, criado: clock(), expires: clock() + 30 * DIA };
        if (!await store.create(id, record, FILA)) {
          const atual = await store.get(id, FILA);
          if (atual && atual.record.status === 'falhou') {
            if (!await store.update(id, record, atual.version, FILA)) throw new Error('conflito');
          } else if (atual && atual.record.flow !== flow) {
            log({ event: 'etapa1_fila', id: curto(id), passo: 'duplicada_fila' });
            return render('QUASE_LA', { ...s, values: u, erro: DUPLICADA_MSG });
          }
        }
        log({ event: 'etapa1_fila', id: curto(id), passo: 'recebida', status: 'pendente' });
      } catch (e) {
        log({ event: 'etapa1_fila_erro', passo: 'receber', message: String(e?.message ?? e).slice(0, 120) });
        return render('QUASE_LA', { ...s, values: u, erro: 'Não conseguimos guardar sua inscrição agora. Toque em Concluir inscrição de novo.' });
      }
      await disparar(id);
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
      try {
        let gravada = false;
        for (let i = 0; i < 4 && !gravada; i++) {
          const atual = await store.get(s.fila_id, FILA);
          if (!atual || atual.record.flow !== hash(req.flow_token ?? '')) throw new Error('inscrição não encontrada');
          if (atual.record.redacao) { gravada = true; break; }
          gravada = await store.update(s.fila_id, { ...atual.record, redacao: texto, redacao_em: clock() }, atual.version, FILA);
        }
        if (!gravada) throw new Error('conflito');
        log({ event: 'etapa1_fila', id: curto(s.fila_id), passo: 'redacao_recebida' });
      } catch (e) {
        log({ event: 'etapa1_fila_erro', passo: 'redacao', message: String(e?.message ?? e).slice(0, 120) });
        return render('TELA_REDACAO', { ...s, values: u, erro: 'Não conseguimos guardar sua redação agora. Toque em Enviar redação de novo; o texto continua aqui.' });
      }
      await disparar(s.fila_id);
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

  async function executarPasso(rec, salvar) {
    const R = rec.respostas;
    switch (rec.passo) {
      case 'inicio': {
        const r = await step('ESCOLHA_PROCESSO', sealState('ESCOLHA_PROCESSO', { processos_disponiveis: [rec.processo] }), 'selecionar_processo', { processo_seletivo_id: rec.processo }, rec.id);
        abrir(r, 'DADOS_BASICOS');
        return salvar({ passo: 'basicos', ck: ck(r) });
      }
      case 'basicos': {
        const r = await step(rec.ck.screen, rec.ck.estado, 'enviar_dados_basicos', pick({ nome: R.nome, possui_nome_social: R.possui_nome_social, nome_social: R.nome_social, email: R.email, data_nascimento: R.data_nascimento, celular: R.celular, genero: R.genero, aceite_privacidade: R.aceite_privacidade }), rec.id);
        const st = abrir(r, 'CURSO_INTERESSE');
        if (!st.cursos?.some(c => c.id === R.curso_id)) throw new ErroPasso('O curso escolhido não está mais disponível no Rubeus.', { final: true, motivo: 'curso_indisponivel' });
        return salvar({ passo: 'turnos', ck: ck(r) });
      }
      case 'turnos': {
        const r = await step(rec.ck.screen, rec.ck.estado, 'buscar_turnos', { curso_id: R.curso_id }, rec.id);
        const st = abrir(r, 'CURSO_INTERESSE');
        if (!st.turnos?.some(t => t.id === R.turno_id)) throw new ErroPasso('O turno escolhido não veio na consulta do Rubeus.', { motivo: 'turno' });
        // Aproveita a sessão para renovar o cache de cursos e turnos (só leitura).
        const c = await lerCache(rec.processo, { fresco: true });
        if (!c?.atualizado || clock() - c.atualizado > 6 * 3600000 || !cacheCompletoSemTema(c)) {
          try { await turnosDeTodos(rec.ck.estado, st.cursos, rec.processo); } catch {}
        }
        return salvar({ passo: 'curso', ck: ck(r) });
      }
      case 'curso': {
        const r = await step(rec.ck.screen, rec.ck.estado, 'avancar_curso_interesse', { curso_id: R.curso_id, turno_id: R.turno_id }, rec.id);
        abrir(r, 'QUASE_LA');
        return salvar({ passo: 'final', ck: ck(r) });
      }
      case 'final': {
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
        let st;
        try { st = abrir(r, 'TELA_ORIENTACAO_PROVA'); }
        catch (e) { throw new ErroPasso(e.message, { final: true, motivo: 'incerto' }); }
        return salvar({ passo: 'redacao', status: 'inscrita', applyment_id: String(st.applyment_id ?? ''), ck: ck(r) });
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
    const temTrabalho = !FINAIS.has(rec.status) && (rec.passo !== 'redacao' || rec.redacao);
    if (temTrabalho) await disparar(id);
    return 204;
  }

  return { route, worker, aquecer, guardarTema, lerCache, gravarCache, cacheCompleto };
}
