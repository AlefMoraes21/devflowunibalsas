// Gera flows/etapa2-matricula.json (Flow da etapa 2: login + matrícula, telas MATR_*).
// Uso: node flows/gerar-etapa2.mjs
import { writeFileSync, readFileSync } from 'node:fs';
import { UFS, RACAS, ESTADOS_CIVIS } from '../api/etapa2-matricula.js';

const png = n => readFileSync(new URL('./img/' + n, import.meta.url)).toString('base64');
const LOGO_PORTAL = png('logo_portal.png');
const LOGO_MATRICULA = png('logo_matricula.png');
const LOGO_UNIBALSAS = png('logo_unibalsas.png');
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
const IDENT = ['rg', 'orgao_emissor', 'uf_rg', 'cor_raca', 'estado_civil', 'ano_conclusao', 'escola'];

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
const login = comErro => ({
  type: 'SingleColumnLayout',
  children: [{
    type: 'Form', name: 'form_login',
    ...(comErro ? { 'init-values': init(['cpf']) } : {}),
    children: [
      imagem(LOGO_PORTAL),
      { type: 'TextSubheading', text: 'Já sou inscrito' },
      { type: 'TextBody', text: 'Entre com o CPF e a data de nascimento usados na inscrição para continuar de onde parou.' },
      ...(comErro ? [erroTexto] : []),
      { type: 'TextInput', name: 'cpf', label: 'CPF', 'helper-text': 'Somente os 11 números', 'input-type': 'text', required: true },
      { type: 'CalendarPicker', name: 'data_nascimento', label: 'Data de nascimento', mode: 'single', 'min-date': '1920-01-01', required: true },
      { type: 'Footer', label: 'Entrar', 'on-click-action': { name: 'data_exchange', payload: { acao: 'entrar', cpf: '${form.cpf}', data_nascimento: '${form.data_nascimento}' } } }
    ]
  }]
});

const flow = {
  version: '7.3',
  data_api_version: '3.0',
  routing_model: {
    MATR_INICIO: ['MATR_LOGIN', 'MATR_PORTAL', 'MATR_FIM'],
    MATR_LOGIN: ['MATR_PORTAL', 'MATR_FIM'],
    MATR_PORTAL: ['MATR_RESPONSAVEL', 'MATR_FIM'],
    MATR_RESPONSAVEL: ['MATR_RESP_DADOS', 'MATR_ENDERECO', 'MATR_FIM'],
    MATR_RESP_DADOS: ['MATR_ENDERECO', 'MATR_FIM'],
    MATR_ENDERECO: ['MATR_IDENTIDADE', 'MATR_FIM'],
    MATR_IDENTIDADE: ['MATR_CUPOM', 'MATR_FIM'],
    MATR_CUPOM: ['MATR_FIM'],
    MATR_FIM: []
  },
  screens: [
    { id: 'MATR_INICIO', title: 'Portal do candidato', layout: login(false) },
    { id: 'MATR_LOGIN', title: 'Portal do candidato', data: { erro: str(), tem_erro: bool(), valor_cpf: str(), valor_data_nascimento: str() }, layout: login(true) },
    {
      // Igual ao status do Portal do candidato.
      id: 'MATR_PORTAL', title: 'Portal do candidato',
      data: { estado: str(), resumo: str('✅ Inscrição\nConcluída') },
      layout: { type: 'SingleColumnLayout', children: [
        imagem(LOGO_PORTAL),
        { type: 'TextCaption', text: 'Acompanhe aqui o status da sua inscrição' },
        { type: 'TextBody', text: '${data.resumo}' },
        { type: 'TextBody', text: 'Agora é a vez da sua matrícula. Vamos começar?' },
        { type: 'Footer', label: 'Continuar matrícula', 'on-click-action': troca('continuar') }
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
      id: 'MATR_IDENTIDADE', title: 'Identidade', data: dados(IDENT),
      layout: { type: 'SingleColumnLayout', children: [{ type: 'Form', name: 'form_identidade', 'init-values': init(IDENT), children: [
        imagem(LOGO_MATRICULA),
        { type: 'TextHeading', text: 'Documento e perfil' },
        { type: 'TextBody', text: 'Precisamos de mais algumas informações suas.' },
        erroTexto,
        { type: 'TextInput', name: 'rg', label: 'Nº da identidade', 'input-type': 'text', required: true },
        { type: 'TextInput', name: 'orgao_emissor', label: 'Órgão emissor', 'helper-text': 'Ex.: SSP', 'input-type': 'text', required: true },
        { type: 'Dropdown', name: 'uf_rg', label: 'UF da identidade', required: true, 'data-source': UFS },
        { type: 'Dropdown', name: 'cor_raca', label: 'Cor / Raça', required: true, 'data-source': RACAS },
        { type: 'Dropdown', name: 'estado_civil', label: 'Estado civil', required: true, 'data-source': ESTADOS_CIVIS },
        { type: 'TextInput', name: 'ano_conclusao', label: 'Ano de conclusão', 'helper-text': 'Ensino médio. 4 números. Ex.: 2024', 'input-type': 'text', required: true },
        { type: 'TextInput', name: 'escola', label: 'Escola de Ensino Médio', 'helper-text': 'Opcional', 'input-type': 'text', required: false },
        { type: 'Footer', label: 'Avançar', 'on-click-action': troca('enviar_identidade', form(IDENT)) }
      ] }] }
    },
    {
      id: 'MATR_CUPOM', title: 'Cupom de desconto', data: dados(['cupom']),
      layout: { type: 'SingleColumnLayout', children: [{ type: 'Form', name: 'form_cupom', 'init-values': init(['cupom']), children: [
        imagem(LOGO_MATRICULA),
        { type: 'TextHeading', text: 'Cupom de desconto' },
        { type: 'TextBody', text: 'Se você recebeu um cupom de desconto, informe abaixo. Deixe em branco para seguir sem cupom.' },
        erroTexto,
        { type: 'TextInput', name: 'cupom', label: 'Cupom', 'input-type': 'text', required: false },
        { type: 'Footer', label: 'Concluir', 'on-click-action': troca('enviar_cupom', form(['cupom'])) }
      ] }] }
    },
    {
      id: 'MATR_FIM', title: 'Matrícula', terminal: true, success: true,
      data: { titulo: str('Dados da matrícula recebidos ✅'), mensagem: str('') },
      layout: { type: 'SingleColumnLayout', children: [
        imagem(LOGO_UNIBALSAS),
        { type: 'TextSubheading', text: '${data.titulo}' },
        { type: 'TextBody', text: '${data.mensagem}' },
        { type: 'Footer', label: 'Fechar', 'on-click-action': { name: 'complete', payload: {} } }
      ] }
    }
  ]
};

writeFileSync(new URL('./etapa2-matricula.json', import.meta.url), JSON.stringify(flow, null, 2) + '\n');
console.log('flows/etapa2-matricula.json gerado');
