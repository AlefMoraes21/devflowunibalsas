// Gera flows/etapa1-vestibular.json (Flow da etapa 1 do Vestibular: inscrição + redação).
// Uso: node flows/gerar-etapa1.mjs
import { writeFileSync } from 'node:fs';

const str = (ex = '') => ({ type: 'string', __example__: ex });
const bool = (ex = false) => ({ type: 'boolean', __example__: ex });
const opcoes = () => ({ type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, title: { type: 'string' } } }, __example__: [] });
const erroTexto = { type: 'TextBody', text: '${data.erro}', visible: '${data.tem_erro}' };
const troca = (acao, campos = {}) => ({ name: 'data_exchange', payload: { acao, estado: '${data.estado}', ...campos } });
const form = names => Object.fromEntries(names.map(n => [n, '${form.' + n + '}']));
const init = names => Object.fromEntries(names.map(n => [n, '${data.valor_' + n + '}']));

const DADOS = ['nome', 'possui_nome_social', 'nome_social', 'email', 'data_nascimento', 'celular', 'genero', 'aceite_privacidade'];
const QUASE = ['cpf', 'nacionalidade', 'concluiu_ensino_medio', 'possui_deficiencia', 'tipos_deficiencia', 'deficiencia_outra', 'como_conheceu', 'como_conheceu_outro'];

const flow = {
  version: '7.3',
  data_api_version: '3.0',
  routing_model: {
    E1_INICIO: ['E1_DADOS', 'E1_FIM'],
    E1_DADOS: ['E1_CURSO', 'E1_FIM'],
    E1_CURSO: ['E1_QUASE_LA', 'E1_FIM'],
    E1_QUASE_LA: ['E1_ORIENTACAO', 'E1_FIM'],
    E1_ORIENTACAO: ['E1_REDACAO', 'E1_FIM'],
    E1_REDACAO: ['E1_FIM'],
    E1_FIM: []
  },
  screens: [
    {
      id: 'E1_INICIO',
      title: 'Inscrição Vestibular',
      layout: {
        type: 'SingleColumnLayout',
        children: [
          { type: 'TextHeading', text: 'Vestibular UniBalsas' },
          { type: 'TextBody', text: 'Faça sua inscrição e a prova de redação aqui mesmo, pelo WhatsApp.' },
          { type: 'TextBody', text: '1. Seus dados\n2. Curso e turno\n3. Informações complementares\n4. Redação online' },
          { type: 'TextCaption', text: 'Reserve um tempo para escrever a redação com calma. Se preferir, escreva antes em outro aplicativo e cole o texto.' },
          { type: 'Footer', label: 'Começar inscrição', 'on-click-action': { name: 'data_exchange', payload: { acao: 'e1_iniciar' } } }
        ]
      }
    },
    {
      id: 'E1_DADOS',
      title: 'Dados básicos',
      data: {
        estado: str(), erro: str(), tem_erro: bool(), data_maxima_nascimento: str('2026-11-15'),
        valor_nome: str(), valor_possui_nome_social: bool(), valor_nome_social: str(), valor_email: str(),
        valor_data_nascimento: str(), valor_celular: str(), valor_genero: str(), valor_aceite_privacidade: bool()
      },
      layout: {
        type: 'SingleColumnLayout',
        children: [{
          type: 'Form', name: 'form_dados',
          'init-values': init(['nome', 'possui_nome_social', 'nome_social', 'email', 'celular', 'genero', 'aceite_privacidade']),
          children: [
            { type: 'TextHeading', text: 'Dados básicos' },
            { type: 'TextBody', text: 'Para começar, preencha alguns dados sobre você:' },
            erroTexto,
            { type: 'TextInput', name: 'nome', label: 'Nome completo', 'input-type': 'text', required: true },
            { type: 'OptIn', name: 'possui_nome_social', label: 'Possuo nome social', required: false },
            { type: 'If', condition: '${form.possui_nome_social} == true', then: [{ type: 'TextInput', name: 'nome_social', label: 'Nome social', 'input-type': 'text', required: true }], else: [] },
            { type: 'TextInput', name: 'email', label: 'E-mail', 'input-type': 'email', required: true },
            { type: 'CalendarPicker', name: 'data_nascimento', label: 'Data de nascimento', mode: 'single', 'min-date': '1920-01-01', 'max-date': '${data.data_maxima_nascimento}', required: true },
            { type: 'TextInput', name: 'celular', label: 'Celular (WhatsApp)', 'helper-text': 'Com DDD. Ex.: 99 99999-9999', 'input-type': 'phone', required: true },
            { type: 'RadioButtonsGroup', name: 'genero', label: 'Gênero', required: true, 'data-source': [{ id: 'M', title: 'Masculino' }, { id: 'F', title: 'Feminino' }] },
            { type: 'OptIn', name: 'aceite_privacidade', label: 'Aceito receber avisos e concordo com a Política de Privacidade vigente. *', required: true, 'on-click-action': { name: 'open_url', url: 'https://lp.unibalsas.edu.br/lgpd/' } },
            { type: 'Footer', label: 'Avançar', 'on-click-action': troca('enviar_dados_basicos', form(DADOS)) }
          ]
        }]
      }
    },
    {
      id: 'E1_CURSO',
      title: 'Curso de interesse',
      data: { estado: str(), erro: str(), tem_erro: bool(), cursos: opcoes(), turnos: opcoes(), turno_visivel: bool(), valor_curso_id: str(), valor_turno_id: str() },
      layout: {
        type: 'SingleColumnLayout',
        children: [{
          type: 'Form', name: 'form_curso',
          'init-values': init(['curso_id', 'turno_id']),
          children: [
            { type: 'TextHeading', text: 'Curso de interesse' },
            { type: 'TextBody', text: 'Escolha o curso e o turno:' },
            erroTexto,
            { type: 'Dropdown', name: 'curso_id', label: 'Curso', 'data-source': '${data.cursos}', required: true, 'on-select-action': troca('buscar_turnos', { curso_id: '${form.curso_id}' }) },
            { type: 'If', condition: '${data.turno_visivel} == true', then: [{ type: 'Dropdown', name: 'turno_id', label: 'Turno', 'data-source': '${data.turnos}', required: true }], else: [] },
            { type: 'Footer', label: 'Continuar', 'on-click-action': troca('escolher_curso', form(['curso_id', 'turno_id'])) }
          ]
        }]
      }
    },
    {
      id: 'E1_QUASE_LA',
      title: 'Estamos quase lá',
      data: {
        estado: str(), erro: str(), tem_erro: bool(), origens: opcoes(),
        valor_cpf: str(), valor_nacionalidade: str('10'), valor_concluiu_ensino_medio: str(), valor_possui_deficiencia: str(),
        valor_tipos_deficiencia: { type: 'array', items: { type: 'string' }, __example__: [] }, valor_deficiencia_outra: str(),
        valor_como_conheceu: str(), valor_como_conheceu_outro: str()
      },
      layout: {
        type: 'SingleColumnLayout',
        children: [{
          type: 'Form', name: 'form_quase_la',
          'init-values': init(QUASE),
          children: [
            { type: 'TextHeading', text: 'Estamos quase lá!' },
            { type: 'TextBody', text: 'Complete as suas informações para concluir a inscrição:' },
            erroTexto,
            { type: 'TextInput', name: 'cpf', label: 'CPF', 'helper-text': 'Somente os 11 números', 'input-type': 'text', required: true },
            { type: 'Dropdown', name: 'nacionalidade', label: 'Nacionalidade', required: true, 'data-source': [{ id: '10', title: 'Brasileira' }, { id: '20', title: 'Naturalizado Brasileiro' }, { id: '50', title: 'Outros' }] },
            { type: 'RadioButtonsGroup', name: 'concluiu_ensino_medio', label: 'Você já concluiu o ensino médio?', required: true, 'data-source': [{ id: 'Sim', title: 'Sim' }, { id: 'Não', title: 'Não' }] },
            { type: 'RadioButtonsGroup', name: 'possui_deficiencia', label: 'Possui alguma deficiência?', required: true, 'data-source': [{ id: 'T', title: 'Sim' }, { id: 'F', title: 'Não' }] },
            { type: 'If', condition: "${form.possui_deficiencia} == 'T'", then: [
              { type: 'CheckboxGroup', name: 'tipos_deficiencia', label: 'Necessidades especiais', required: true, 'data-source': [{ id: 'auditiva', title: 'Auditiva' }, { id: 'fala', title: 'Fala' }, { id: 'fisica', title: 'Física' }, { id: 'intelectual', title: 'Intelectual' }, { id: 'visual', title: 'Visual' }, { id: 'mental', title: 'Mental' }, { id: 'outras', title: 'Outras' }] },
              { type: 'TextInput', name: 'deficiencia_outra', label: 'Se marcou Outras, especifique:', 'input-type': 'text', required: false }
            ], else: [] },
            { type: 'Dropdown', name: 'como_conheceu', label: 'Como ficou sabendo do processo?', required: true, 'data-source': '${data.origens}' },
            { type: 'If', condition: "${form.como_conheceu} == '10'", then: [{ type: 'TextInput', name: 'como_conheceu_outro', label: 'Especifique o canal:', 'input-type': 'text', required: true }], else: [] },
            { type: 'Footer', label: 'Concluir inscrição', 'on-click-action': troca('enviar_informacoes_complementares', form(QUASE)) }
          ]
        }]
      }
    },
    {
      id: 'E1_ORIENTACAO',
      title: 'Prova de redação',
      data: { estado: str(), erro: str(), tem_erro: bool() },
      layout: {
        type: 'SingleColumnLayout',
        children: [
          { type: 'TextHeading', text: 'Inscrição recebida! ✅' },
          { type: 'TextBody', text: 'Agora é a prova de redação online.' },
          erroTexto,
          { type: 'TextBody', text: '• Texto dissertativo-argumentativo sobre o tema da próxima tela.\n• Até 3.000 caracteres.\n• O texto só é enviado quando você tocar em Enviar redação.' },
          { type: 'TextCaption', text: 'Dica: se preferir, escreva em outro aplicativo e cole o texto.' },
          { type: 'Footer', label: 'Iniciar redação', 'on-click-action': troca('iniciar_redacao') }
        ]
      }
    },
    {
      id: 'E1_REDACAO',
      title: 'Redação',
      data: { estado: str(), erro: str(), tem_erro: bool(), tema_redacao: str('Tema da redação'), valor_texto_redacao: str() },
      layout: {
        type: 'SingleColumnLayout',
        children: [{
          type: 'Form', name: 'form_redacao',
          'init-values': init(['texto_redacao']),
          children: [
            { type: 'TextHeading', text: 'Sua redação' },
            erroTexto,
            { type: 'TextBody', text: '${data.tema_redacao}' },
            { type: 'TextArea', name: 'texto_redacao', label: 'Digite aqui seu texto', required: true, 'max-length': 3000 },
            { type: 'Footer', label: 'Enviar redação', 'on-click-action': troca('enviar_redacao', form(['texto_redacao'])) }
          ]
        }]
      }
    },
    {
      id: 'E1_FIM',
      title: 'Inscrição',
      terminal: true,
      success: true,
      data: { titulo: str('Redação enviada ✅'), mensagem: str('') },
      layout: {
        type: 'SingleColumnLayout',
        children: [
          { type: 'TextHeading', text: '${data.titulo}' },
          { type: 'TextBody', text: '${data.mensagem}' },
          { type: 'Footer', label: 'Concluir', 'on-click-action': { name: 'complete', payload: {} } }
        ]
      }
    }
  ]
};

writeFileSync(new URL('./etapa1-vestibular.json', import.meta.url), JSON.stringify(flow, null, 2) + '\n');
console.log('flows/etapa1-vestibular.json gerado');
