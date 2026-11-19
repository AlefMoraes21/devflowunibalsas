// Telas da etapa 2 (login + matrícula + documentos), telas MATR_*. Entram no MESMO Flow da etapa 1
// (flows/etapa1-vestibular.json), pelo link "Já sou inscrito" da tela inicial. Usado por gerar-etapa1.mjs.
import { readFileSync } from 'node:fs';
import { UFS, RACAS, ESTADOS_CIVIS, DOCS } from '../api/etapa2-matricula.js';

const png = n => readFileSync(new URL('./img/' + n, import.meta.url)).toString('base64');
const LOGO_PORTAL = png('logo_portal.png');
const LOGO_MATRICULA = png('logo_matricula.png');
const LOGO_UNIBALSAS = png('logo_unibalsas.png');
const ICONE_OK = png('icone_ok.png');
const ICONE_PENDENTE = png('icone_pendente.png');
const imagem = (src, height = 40) => ({ type: 'Image', src, height, 'scale-type': 'contain' });

const str = (ex = '') => ({ type: 'string', __example__: ex });
const bool = (ex = false) => ({ type: 'boolean', __example__: ex });
const erroTexto = { type: 'TextBody', text: '${data.erro}', visible: '${data.tem_erro}' };
const troca = (acao, campos = {}) => ({ name: 'data_exchange', payload: { acao, estado: '${data.estado}', ...campos } });
const form = names => Object.fromEntries(names.map(n => [n, '${form.' + n + '}']));
const init = names => Object.fromEntries(names.map(n => [n, '${data.valor_' + n + '}']));
const dados = (names, extra = {}) => ({ estado: str(), erro: str(), tem_erro: bool(), ...Object.fromEntries(names.map(n => ['valor_' + n, str()])), ...extra });

const END = ['cep', 'rua', 'numero', 'complemento', 'bairro', 'cidade', 'uf', 'estado_natal', 'cidade_natal'];
const RESP = ['nome', 'email', 'cpf', 'data_nascimento', 'celular'];
const IDENT = ['rg', 'orgao_emissor', 'uf_rg', 'cor_raca', 'estado_civil', 'ano_conclusao', 'busca_escola', 'escola'];
const ESCOLAS = { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, title: { type: 'string' }, description: { type: 'string' } } },
  __example__: [{ id: '1', title: 'Escola exemplo', description: 'Escola exemplo' }] };

// Dados iniciais da tela de login quando aberta pelo link da tela inicial (navigate).
export const LOGIN_VAZIO = { erro: '', tem_erro: false, valor_login: '', valor_data_nascimento: '' };

const camposEndereco = acaoCep => [
  { type: 'TextInput', name: 'cep', label: 'CEP', 'helper-text': 'Somente números', 'input-type': 'text', required: true },
  { type: 'EmbeddedLink', text: 'Buscar endereço pelo CEP', 'on-click-action': acaoCep },
  { type: 'TextInput', name: 'rua', label: 'Rua', 'input-type': 'text', required: true },
  { type: 'TextInput', name: 'numero', label: 'Número', 'input-type': 'text', required: true },
  { type: 'TextInput', name: 'complemento', label: 'Complemento', 'input-type': 'text', required: false },
  { type: 'TextInput', name: 'bairro', label: 'Bairro', 'input-type': 'text', required: true },
  { type: 'TextInput', name: 'cidade', label: 'Cidade', 'input-type': 'text', required: true },
  { type: 'Dropdown', name: 'uf', label: 'Estado - UF', required: true, 'data-source': UFS },
  { type: 'Dropdown', name: 'estado_natal', label: 'Estado natal', required: true, 'data-source': UFS },
  { type: 'TextInput', name: 'cidade_natal', label: 'Cidade natal', 'input-type': 'text', required: true }
];

const docRotas = Object.fromEntries(DOCS.map((d, i) => [d.tela, i < DOCS.length - 1 ? [DOCS[i + 1].tela, 'MATR_FIM'] : ['MATR_FIM']]));

export const routing = {
  MATR_LOGIN: ['MATR_PORTAL', 'MATR_STATUS', 'MATR_FIM', 'INSC_PORTAL'],
  MATR_PORTAL: ['MATR_STATUS', 'MATR_RESPONSAVEL', 'MATR_RESP_DADOS', 'MATR_ENDERECO', 'MATR_IDENTIDADE', DOCS[0].tela, 'CONTR_TERMOS', 'MATR_FIM', 'INSC_PORTAL'],
  // "Documentos inscrição: Pendentes [Verificar]" (Transferência, Portador, ENEM) abre as telas da etapa 1.
  MATR_STATUS: ['MATR_RESPONSAVEL', 'MATR_RESP_DADOS', 'MATR_ENDERECO', 'MATR_IDENTIDADE', DOCS[0].tela, 'CONTR_TERMOS', 'MATR_PAGAMENTO', 'MATR_FIM', 'INSC_PORTAL', 'INSC_DOC_A'],
  MATR_RESPONSAVEL: ['MATR_RESP_DADOS', 'MATR_ENDERECO', 'MATR_FIM'],
  MATR_RESP_DADOS: ['MATR_ENDERECO', 'MATR_FIM'],
  MATR_ENDERECO: ['MATR_IDENTIDADE', 'MATR_FIM'],
  MATR_IDENTIDADE: [DOCS[0].tela, 'MATR_FIM'],
  ...docRotas,
  CONTR_TERMOS: [],
  MATR_PAGAMENTO: ['MATR_FIM'],
  MATR_FIM: []
};

export const screens = [
  {
    id: 'MATR_LOGIN', title: 'Portal do candidato',
    data: { erro: str(), tem_erro: bool(), valor_login: str(), valor_data_nascimento: str() },
    layout: { type: 'SingleColumnLayout', children: [{ type: 'Form', name: 'form_login', 'init-values': init(['login']), children: [
      imagem(LOGO_PORTAL),
      { type: 'TextSubheading', text: 'Já sou inscrito' },
      { type: 'TextBody', text: 'Entre com o CPF e a data de nascimento usados na inscrição para continuar de onde parou.' },
      erroTexto,
      { type: 'TextInput', name: 'login', label: 'CPF', 'helper-text': 'Somente os 11 números', 'input-type': 'text', required: true },
      { type: 'CalendarPicker', name: 'data_nascimento', label: 'Data de nascimento', mode: 'single', 'min-date': '1920-01-01', required: true },
      { type: 'Footer', label: 'Entrar', 'on-click-action': { name: 'data_exchange', payload: { acao: 'entrar', login: '${form.login}', data_nascimento: '${form.data_nascimento}' } } }
    ] }] }
  },
  {
    // Igual ao status do Portal do candidato.
    id: 'MATR_PORTAL', title: 'Portal do candidato',
    data: { estado: str(), resumo: str('✅ Inscrição: Concluída'), botao: str('Continuar matrícula') },
    layout: { type: 'SingleColumnLayout', children: [
      imagem(LOGO_PORTAL),
      { type: 'TextCaption', text: 'Acompanhe aqui o status da sua inscrição' },
      { type: 'TextBody', text: '${data.resumo}' },
      { type: 'Footer', label: '${data.botao}', 'on-click-action': troca('continuar') }
    ] }
  },
  {
    // Status igual ao Portal do candidato: uma linha por etapa (✅ concluída / ❗ pendente), com o status e, nas
    // etapas abertas, o botão do site (ex.: "Verificar"). A NavigationList não aceita outros componentes na tela;
    // a ilustração de cada status vai no ícone da linha (start.image: concluída, pendente, em análise, recusada).
    id: 'MATR_STATUS', title: 'Portal do candidato',
    data: { etapas: { type: 'array', items: { type: 'object', properties: {
      id: { type: 'string' },
      start: { type: 'object', properties: { image: { type: 'string' } } },
      'main-content': { type: 'object', properties: { title: { type: 'string' }, metadata: { type: 'string' } } },
      end: { type: 'object', properties: { title: { type: 'string' } } },
      'on-click-action': { type: 'object', properties: { name: { type: 'string' }, payload: { type: 'object', properties: { acao: { type: 'string' }, estado: { type: 'string' } } } } }
    } }, __example__: [
      { id: 'etapa_0', start: { image: ICONE_OK }, 'main-content': { title: 'Inscrição', metadata: 'Concluída' }, 'on-click-action': { name: 'data_exchange', payload: { acao: 'abrir_etapa', estado: 'x' } } },
      { id: 'etapa_1', start: { image: ICONE_PENDENTE }, 'main-content': { title: 'Contrato', metadata: 'Pendente' }, end: { title: 'Verificar' }, 'on-click-action': { name: 'data_exchange', payload: { acao: 'abrir_etapa', estado: 'y' } } }
    ] } },
    layout: { type: 'SingleColumnLayout', children: [
      { type: 'NavigationList', name: 'lista_etapas', label: 'Acompanhe aqui o status da sua inscrição', 'list-items': '${data.etapas}' }
    ] }
  },
  {
    id: 'MATR_RESPONSAVEL', title: 'Responsável financeiro', data: dados(['responsavel']),
    layout: { type: 'SingleColumnLayout', children: [{ type: 'Form', name: 'form_resp', 'init-values': init(['responsavel']), children: [
      imagem(LOGO_MATRICULA),
      { type: 'TextHeading', text: 'Responsável financeiro' },
      erroTexto,
      { type: 'RadioButtonsGroup', name: 'responsavel', label: 'Quem é seu responsável financeiro?', required: true, 'data-source': [{ id: 'Eu', title: 'Eu' }, { id: 'Outro', title: 'Outro' }] },
      { type: 'TextCaption', text: 'Se escolher Outro, pediremos os dados dessa pessoa em seguida.' },
      { type: 'Footer', label: 'Avançar', 'on-click-action': troca('enviar_responsavel', form(['responsavel'])) }
    ] }] }
  },
  {
    id: 'MATR_RESP_DADOS', title: 'Dados do responsável', data: dados([...RESP, ...END]),
    layout: { type: 'SingleColumnLayout', children: [{ type: 'Form', name: 'form_resp_dados', 'init-values': init(['nome', 'email', 'cpf', 'celular', ...END]), children: [
      imagem(LOGO_MATRICULA),
      { type: 'TextHeading', text: 'Dados do responsável' },
      { type: 'TextBody', text: 'Informe os dados do responsável financeiro.' },
      erroTexto,
      { type: 'TextInput', name: 'nome', label: 'Nome completo', 'input-type': 'text', required: true },
      { type: 'TextInput', name: 'email', label: 'E-mail', 'input-type': 'email', required: true },
      { type: 'TextInput', name: 'cpf', label: 'CPF', 'helper-text': 'Somente os 11 números', 'input-type': 'text', required: true },
      { type: 'CalendarPicker', name: 'data_nascimento', label: 'Data de nascimento', mode: 'single', 'min-date': '1920-01-01', required: true },
      { type: 'TextInput', name: 'celular', label: 'Celular', 'input-type': 'phone', required: true },
      ...camposEndereco(troca('buscar_cep', form([...RESP, ...END]))),
      { type: 'Footer', label: 'Avançar', 'on-click-action': troca('enviar_endereco', form([...RESP, ...END])) }
    ] }] }
  },
  {
    id: 'MATR_ENDERECO', title: 'Endereço', data: dados(END),
    layout: { type: 'SingleColumnLayout', children: [{ type: 'Form', name: 'form_endereco', 'init-values': init(END), children: [
      imagem(LOGO_MATRICULA),
      { type: 'TextHeading', text: 'Seu endereço' },
      { type: 'TextBody', text: 'Próximo passo: conhecer você melhor! Informe seu endereço e sua naturalidade.' },
      erroTexto,
      ...camposEndereco(troca('buscar_cep', form(END))),
      { type: 'Footer', label: 'Avançar', 'on-click-action': troca('enviar_endereco', form(END)) }
    ] }] }
  },
  {
    id: 'MATR_IDENTIDADE', title: 'Identidade', data: dados(IDENT, { escolas: ESCOLAS, tem_escolas: bool() }),
    layout: { type: 'SingleColumnLayout', children: [{ type: 'Form', name: 'form_identidade', 'init-values': init(IDENT.filter(k => k !== 'escola')), children: [
      imagem(LOGO_MATRICULA),
      { type: 'TextHeading', text: 'Documento e perfil' },
      { type: 'TextBody', text: 'Precisamos de mais algumas informações suas.' },
      erroTexto,
      { type: 'TextInput', name: 'rg', label: 'Nº da identidade', 'input-type': 'text', required: true },
      { type: 'TextInput', name: 'orgao_emissor', label: 'Órgão emissor', 'helper-text': 'Ex.: SSP', 'input-type': 'text', required: true },
      { type: 'Dropdown', name: 'uf_rg', label: 'UF da identidade', required: true, 'data-source': UFS },
      { type: 'RadioButtonsGroup', name: 'cor_raca', label: 'Cor / Raça', required: true, 'data-source': RACAS },
      { type: 'RadioButtonsGroup', name: 'estado_civil', label: 'Estado civil', required: true, 'data-source': ESTADOS_CIVIS },
      // No site é uma lista fechada: busca pelo nome e escolhe na lista (opcional).
      { type: 'TextInput', name: 'busca_escola', label: 'Escola de Ensino Médio', 'helper-text': 'Opcional. Digite parte do nome e toque em Buscar escola', 'input-type': 'text', required: false },
      { type: 'EmbeddedLink', text: 'Buscar escola', 'on-click-action': troca('buscar_escola', form(IDENT)) },
      { type: 'RadioButtonsGroup', name: 'escola', label: 'Escolha a sua escola', required: false, visible: '${data.tem_escolas}', 'data-source': '${data.escolas}' },
      { type: 'TextInput', name: 'ano_conclusao', label: 'Ano de conclusão', 'helper-text': 'Ensino médio (opcional). Ex.: 2024', 'input-type': 'text', required: false },
      { type: 'Footer', label: 'Avançar', 'on-click-action': troca('enviar_identidade', form(IDENT)) }
    ] }] }
  },
  // Documentos de matrícula: um por tela (o WhatsApp aceita um seletor de arquivo por tela).
  ...DOCS.map((d, i) => ({
    id: d.tela, title: 'Documentos', data: dados([]),
    layout: { type: 'SingleColumnLayout', children: [{ type: 'Form', name: 'form_doc', children: [
      imagem(LOGO_MATRICULA),
      { type: 'TextHeading', text: 'Documentos da matrícula' },
      ...(i === 0 ? [{ type: 'TextBody', text: 'Envie os documentos solicitados (PDF, JPG ou PNG). A análise ocorre em até 48 horas úteis.' }] : []),
      { type: 'TextSubheading', text: `${d.titulo}${d.obrigatorio ? ' *' : ''}` },
      { type: 'TextCaption', text: `${d.obrigatorio ? 'Obrigatório.' : 'Opcional: se não tiver agora, toque em Avançar.'} Documento ${i + 1} de ${DOCS.length}.` },
      erroTexto,
      { type: 'DocumentPicker', name: 'arquivo', label: 'Arquivo', description: 'PDF, JPG ou PNG de até 740 KB', 'min-uploaded-documents': d.obrigatorio ? 1 : 0, 'max-uploaded-documents': 1, 'max-file-size-kb': 740, 'allowed-mime-types': ['application/pdf', 'image/jpeg', 'image/png'] },
      { type: 'Footer', label: i === DOCS.length - 1 ? 'Enviar documentos' : 'Avançar', 'on-click-action': troca('enviar_documento', { arquivo: '${form.arquivo}' }) }
    ] }] }
  })),
  {
    // Etapa 3 — Contrato (passo 300669), com o texto do site. O link é exclusivo e vale 24 h: o Cloud Run
    // gera o contrato no portal na hora (botão "Clique aqui para fazer o download do contrato") e abre o PDF.
    id: 'CONTR_TERMOS', title: 'Contrato', terminal: true, success: true,
    data: { link_contrato: str('https://example.com/contrato/abc') },
    layout: { type: 'SingleColumnLayout', children: [
      imagem(LOGO_MATRICULA),
      { type: 'TextHeading', text: 'Termos da sua matrícula' },
      { type: 'EmbeddedLink', text: 'Baixar o contrato (PDF)', 'on-click-action': { name: 'open_url', url: '${data.link_contrato}' } },
      { type: 'TextCaption', text: 'O contrato é gerado na hora e pode levar alguns segundos para abrir. O link vale por 24 horas.' },
      { type: 'TextBody', text: 'Prezado(a) candidato(a),\n\nPara dar continuidade ao processo de inscrição, solicitamos que realize o download do seu contrato e efetue a assinatura digital por meio da plataforma GOV.BR.\n\nApós a assinatura, encaminhe o contrato assinado para o seguinte endereço de e-mail:\n\nE-mail: centraldematriculaub@unibalsas.edu.br\n\nAssim que recebermos o documento devidamente assinado, daremos prosseguimento ao processo de matrícula.\n\nEm caso de dúvidas ou necessidade de auxílio, entre em contato com nossa equipe pelo WhatsApp: (99) 99131-1684' },
      { type: 'Footer', label: 'Fechar', 'on-click-action': { name: 'complete', payload: {} } }
    ] }
  },
  {
    // Etapa 4 — Pagamento da taxa de matrícula (igual nos 4 processos). O pagamento NÃO é feito no Flow: o toque em
    // "Realizar pagamento" pede ao Cloud Run a mensagem do Blip com o Pix (copia e cola) e o link do cartão.
    id: 'MATR_PAGAMENTO', title: 'Pagamento',
    data: { estado: str(), valor: str('R$ 390,00'), mensagem: str('Ao tocar em "Realizar pagamento", você recebe aqui no WhatsApp uma mensagem com o Pix e o link para pagar com cartão.'), botao: str('Realizar pagamento') },
    layout: { type: 'SingleColumnLayout', children: [
      imagem(LOGO_MATRICULA),
      { type: 'TextHeading', text: 'Estamos finalizando!' },
      { type: 'TextBody', text: 'Para concluir a sua matrícula, realize o pagamento da taxa de matrícula.' },
      { type: 'TextCaption', text: 'Valor a pagar' },
      { type: 'TextSubheading', text: '${data.valor}' },
      { type: 'TextBody', text: '${data.mensagem}' },
      { type: 'TextCaption', text: 'Formas de pagamento: Pix (copia e cola) ou cartão de crédito. Dúvidas: WhatsApp da central de matrícula, (99) 99131-1684.' },
      { type: 'Footer', label: '${data.botao}', 'on-click-action': troca('pagar') }
    ] }
  },
  {
    id: 'MATR_FIM', title: 'Matrícula', terminal: true, success: true,
    data: { titulo: str('Documentos enviados ✅'), mensagem: str('') },
    layout: { type: 'SingleColumnLayout', children: [
      imagem(LOGO_UNIBALSAS),
      { type: 'TextSubheading', text: '${data.titulo}' },
      { type: 'TextBody', text: '${data.mensagem}' },
      { type: 'Footer', label: 'Fechar', 'on-click-action': { name: 'complete', payload: {} } }
    ] }
  }
];
