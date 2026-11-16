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

export function createEtapa2({
  store, enqueue, sealState, openState, matricula, runCtx = fn => fn(), validCpf,
  buscarCep = null, clock = Date.now, log = e => console.info(JSON.stringify(e)), orcamentoMs = 80000,
  docs = null, academicId = () => null, entrarNaProva = null,
  // Calma antes dos documentos: o RM gera o RA e sincroniza a inscrição depois da identidade.
  esperaDocsMs = Number(process.env.ETAPA2_ESPERA_DOCS_MS) || 120000
}) {
  // ---------------------------------------------------------------- telas do Flow
  const valor = (...n) => n.map(x => 'valor_' + x);
  const END = ['cep', 'rua', 'numero', 'complemento', 'bairro', 'cidade', 'uf', 'estado_natal', 'cidade_natal'];
  const KEYS = {
    MATR_LOGIN: ['erro', 'tem_erro', ...valor('login', 'data_nascimento')],
    MATR_PORTAL: ['estado', 'resumo'],
    MATR_RESPONSAVEL: ['estado', 'erro', 'tem_erro', ...valor('responsavel')],
    MATR_RESP_DADOS: ['estado', 'erro', 'tem_erro', ...valor('nome', 'email', 'cpf', 'data_nascimento', 'celular', ...END)],
    MATR_ENDERECO: ['estado', 'erro', 'tem_erro', ...valor(...END)],
    MATR_IDENTIDADE: ['estado', 'erro', 'tem_erro', ...valor('rg', 'orgao_emissor', 'uf_rg', 'cor_raca', 'estado_civil', 'ano_conclusao', 'escola')],
    ...Object.fromEntries(DOCS.map(x => [x.tela, ['estado', 'erro', 'tem_erro']])),
    MATR_FIM: ['titulo', 'mensagem']
  };
  function render(screen, data) {
    const { values = {}, ...trusted } = data;
    const out = {};
    for (const k of KEYS[screen]) {
      if (k === 'estado') out.estado = sealState(screen, trusted);
      else if (k === 'tem_erro') out.tem_erro = Boolean(trusted.erro);
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
      let sessao;
      try { sessao = await matricula.login(login, u.data_nascimento); }
      catch { return volta('Não encontramos uma inscrição com esses dados. Confira e tente de novo.'); }
      if (!sessao.applyment_id) return volta('Não encontramos uma inscrição com esses dados.');
      const id = hash('matr:' + sessao.applyment_id);
      const flow = hash(req.flow_token ?? '');
      // Situação das etapas, como no portal. Quem decide o que está liberado é o portal (próximo passo);
      // a única espera é a prova "Aguardando correção". Se o portal demorar, segue e o worker confere a ordem.
      let resumo = '';
      try {
        const st = await Promise.race([matricula.portal(sessao), new Promise((_, r) => setTimeout(() => r(new Error('lento')), 4500))]);
        const s2 = summarizeStages(st.stages ?? []);
        resumo = s2.resumo;
        if (!s2.next && s2.aguardandoCorrecao) return fim('Aguardando correção ⏱', 'Você realizou a sua prova. Em breve o resultado estará disponível.');
        // Próximo passo é a prova: segue para a redação, como na jornada direta da etapa 1.
        if (s2.next && /prova|avaliacao|redacao/.test(norm(s2.next.title)) && entrarNaProva) {
          return await entrarNaProva({ applyment_id: sessao.applyment_id, processo: st.processo_seletivo_id, login, data_nascimento: u.data_nascimento, flowToken: req.flow_token });
        }
      } catch (e) { log({ event: 'etapa2_fila', passo: 'portal_lento', message: String(e?.message ?? e).slice(0, 60) }); }
      // Inscrição da matrícula no Firestore (login e data de nascimento ficam criptografados, para o worker entrar no Rubeus).
      const novo = { id, applyment_id: sessao.applyment_id, flow, login, data_nascimento: u.data_nascimento, blocos: {}, enviados: {}, status: 'pendente', tentativas: 0, criado: clock(), expires: clock() + 30 * DIA };
      const atual = await store.get(id, FILA);
      if (!atual) await store.create(id, novo, FILA);
      else await store.update(id, { ...atual.record, flow, login, data_nascimento: novo.data_nascimento, status: atual.record.status === 'falhou' ? 'pendente' : atual.record.status }, atual.version, FILA);
      log({ event: 'etapa2_fila', id: curto(id), passo: 'login' });
      const menor = (idade(u.data_nascimento) ?? 18) < 18;
      return render('MATR_PORTAL', { m2: true, fila_id: id, menor, resumo: resumo || 'Sua inscrição foi encontrada. Vamos seguir com a sua matrícula.' });
    }

    let s;
    try { s = openState(d.estado, screen); } catch { return fim('Sessão expirada', 'Esta sessão ficou muito tempo parada. Abra a mensagem de novo e entre com seu CPF e data de nascimento.'); }
    if (!s.m2) return null;
    const base = { m2: true, fila_id: s.fila_id, menor: s.menor };

    if (screen === 'MATR_PORTAL' && acao === 'continuar') {
      // Menor de 18 anos não pode ser o próprio responsável financeiro: grava "Outro" e vai direto à ficha do responsável.
      if (s.menor) {
        try { await gravarBloco(s, req.flow_token, 'responsavel', { responsavel: 'Outro' }); }
        catch { return render('MATR_RESPONSAVEL', { ...base, erro: ERRO_GRAVAR }); }
        return render('MATR_RESP_DADOS', { ...base, erro: '' });
      }
      return render('MATR_RESPONSAVEL', { ...base, erro: '' });
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

    if (screen === 'MATR_IDENTIDADE' && acao === 'enviar_identidade') {
      const u = pick(d, ['rg', 'orgao_emissor', 'uf_rg', 'cor_raca', 'estado_civil', 'ano_conclusao', 'escola']);
      const erro = !String(u.rg ?? '').trim() ? 'Informe o número da identidade.'
        : !String(u.orgao_emissor ?? '').trim() ? 'Informe o órgão emissor.'
        : !UFS.some(o => o.id === u.uf_rg) ? 'Selecione a UF da identidade.'
        : !RACAS.some(o => o.id === u.cor_raca) ? 'Selecione cor/raça.'
        : !ESTADOS_CIVIS.some(o => o.id === u.estado_civil) ? 'Selecione o estado civil.'
        : u.ano_conclusao && !(/^\d{4}$/.test(u.ano_conclusao) && Number(u.ano_conclusao) >= 1995 && Number(u.ano_conclusao) <= new Date().getFullYear() + 1) ? 'Confira o ano de conclusão (4 números, de 1995 em diante).'
        : '';
      if (erro) return render(screen, { ...s, values: u, erro });
      try { await gravarBloco(s, req.flow_token, 'identidade', u); } catch { return render(screen, { ...s, values: u, erro: ERRO_GRAVAR }); }
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
      if (bloco.escola && st.campos?.escola) {
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
            const idps = academicId(sessao.processo_seletivo_id ?? rec.processo);
            for (const doc of DOCS) {
              const media = docsB.arquivos?.[doc.id];
              if (!media?.length || rec.enviados_docs?.[doc.id]) continue;
              await docs.saveDocument({ idps, cpf: rec.login, codDocumento: Number(doc.id), media });
              await salvar({ enviados_docs: { ...rec.enviados_docs, [doc.id]: clock() } });
              log({ event: 'etapa2_fila', id: curto(id), passo: 'documento_enviado', doc: doc.id });
            }
            // Entregue: as referências dos arquivos (com as chaves de criptografia) não ficam guardadas.
            await salvar({ status: 'concluida', passo: 'fim', limpar_docs: true });
            return;
          }
          const tela = await matricula.open(sessao, next);
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
