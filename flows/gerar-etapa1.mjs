// Gera flows/etapa1-vestibular.json (Flow da etapa 1 do Vestibular: inscrição + redação).
// Uso: node flows/gerar-etapa1.mjs
import { writeFileSync, readFileSync } from 'node:fs';

// Logos vermelhos com fundo transparente (flows/img), embutidos em base64 como pede o Flow JSON.
const png = n => readFileSync(new URL('./img/' + n, import.meta.url)).toString('base64');
const LOGO_UNIBALSAS = png('logo_unibalsas.png');
const LOGO_PORTAL = png('logo_portal.png');
const imagem = (src, height) => ({ type: 'Image', src, height, 'scale-type': 'contain' });

const str = (ex = '') => ({ type: 'string', __example__: ex });
const bool = (ex = false) => ({ type: 'boolean', __example__: ex });
const opcoes = () => ({ type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, title: { type: 'string' } } }, __example__: [] });
const erroTexto = { type: 'TextBody', text: '${data.erro}', visible: '${data.tem_erro}' };
const troca = (acao, campos = {}) => ({ name: 'data_exchange', payload: { acao, estado: '${data.estado}', ...campos } });
const form = names => Object.fromEntries(names.map(n => [n, '${form.' + n + '}']));
const init = names => Object.fromEntries(names.map(n => [n, '${data.valor_' + n + '}']));

const DADOS = ['nome', 'possui_nome_social', 'nome_social', 'email', 'data_nascimento', 'celular', 'genero', 'aceite_privacidade'];
const ENEM = ['numero_inscricao_enem', 'ano_enem', 'nota_natureza_enem', 'nota_humanas_enem', 'nota_matematica_enem', 'nota_linguagens_enem', 'nota_redacao_enem'];
const QUASE = ['cpf', 'nacionalidade', 'concluiu_ensino_medio', 'possui_deficiencia', 'tipos_deficiencia', 'deficiencia_outra', 'como_conheceu', 'como_conheceu_outro', ...ENEM];

const DADOS_DATA = {
  estado: str(), erro: str(), tem_erro: bool(), data_maxima_nascimento: str('2026-11-15'),
  valor_nome: str(), valor_possui_nome_social: bool(), valor_nome_social: str(), valor_email: str(),
  valor_data_nascimento: str(), valor_celular: str(), valor_genero: str(), valor_aceite_privacidade: bool()
};
const DADOS_PAYLOAD = Object.fromEntries(Object.keys(DADOS_DATA).map(k => [k, '${data.' + k + '}']));

const flow = {
  version: '7.3',
  data_api_version: '3.0',
  routing_model: {
    INSC_INICIO: ['INSC_DADOS', 'INSC_FIM'],
    INSC_DADOS: ['INSC_CURSO', 'INSC_PRIVACIDADE', 'INSC_FIM'],
    INSC_PRIVACIDADE: [],
    INSC_CURSO: ['INSC_QUASE_LA', 'INSC_FIM'],
    INSC_QUASE_LA: ['INSC_CONCLUIDA', 'INSC_FIM'],
    INSC_CONCLUIDA: ['INSC_PORTAL'],
    INSC_PORTAL: ['INSC_AVALIACAO'],
    INSC_AVALIACAO: ['INSC_ORIENTACAO'],
    INSC_ORIENTACAO: ['INSC_REDACAO', 'INSC_FIM'],
    INSC_REDACAO: ['INSC_FIM'],
    INSC_FIM: []
  },
  screens: [
    {
      id: 'INSC_INICIO',
      title: 'Inscrição',
      layout: {
        type: 'SingleColumnLayout',
        children: [{
          type: 'Form', name: 'form_processo',
          children: [
            { type: 'TextHeading', text: 'Inscrição' },
            // Lista fixa (a Meta não informa ao servidor qual Flow abriu): atualizar a cada semestre.
            { type: 'Dropdown', name: 'processo_seletivo_id', label: 'Escolha o processo seletivo', required: true, 'data-source': [
              { id: '20383', title: 'Vestibular Online 2027/1' },
              { id: '20385', title: 'Transferência 2027/1' },
              { id: '20384', title: 'Portador de Diploma 2027/1' },
              { id: '20386', title: 'Nota do ENEM 2027/1' }
            ] },
            { type: 'Footer', label: 'Iniciar inscrição', 'on-click-action': { name: 'data_exchange', payload: { acao: 'e1_iniciar', processo_seletivo_id: '${form.processo_seletivo_id}' } } }
          ]
        }]
      }
    },
    {
      id: 'INSC_DADOS',
      title: 'Dados básicos',
      data: DADOS_DATA,
      layout: {
        type: 'SingleColumnLayout',
        children: [{
          type: 'Form', name: 'form_dados',
          'init-values': init(['nome', 'possui_nome_social', 'nome_social', 'email', 'celular', 'genero', 'aceite_privacidade']),
          children: [
            { type: 'TextHeading', text: 'Dados básicos' },
            { type: 'TextBody', text: 'Olá! Para começar, preencha alguns dados básicos sobre você:' },
            erroTexto,
            { type: 'TextInput', name: 'nome', label: 'Nome completo', 'input-type': 'text', required: true },
            { type: 'OptIn', name: 'possui_nome_social', label: 'Possuo nome social', required: false },
            { type: 'If', condition: '${form.possui_nome_social} == true', then: [{ type: 'TextInput', name: 'nome_social', label: 'Nome social', 'input-type': 'text', required: true }], else: [] },
            { type: 'TextInput', name: 'email', label: 'E-mail', 'input-type': 'email', required: true },
            { type: 'CalendarPicker', name: 'data_nascimento', label: 'Data de nascimento', mode: 'single', 'min-date': '1920-01-01', 'max-date': '${data.data_maxima_nascimento}', required: true },
            { type: 'TextInput', name: 'celular', label: 'Celular', 'helper-text': 'Para facilitar o nosso contato, informe o seu WhatsApp, de preferência.', 'input-type': 'phone', required: true },
            { type: 'RadioButtonsGroup', name: 'genero', label: 'Gênero', required: true, 'data-source': [{ id: 'M', title: 'Masculino' }, { id: 'F', title: 'Feminino' }] },
            { type: 'OptIn', name: 'aceite_privacidade', label: 'Aceito receber conteúdos e lembretes sobre o processo seletivo e concordo com a Política de Privacidade vigente.', required: true, 'on-click-action': { name: 'navigate', next: { type: 'screen', name: 'INSC_PRIVACIDADE' }, payload: DADOS_PAYLOAD } },
            { type: 'Footer', label: 'Avançar', 'on-click-action': troca('enviar_dados_basicos', form(DADOS)) }
          ]
        }]
      }
    },
    {
      id: 'INSC_PRIVACIDADE',
      title: 'Privacidade',
      data: DADOS_DATA,
      layout: {
        type: 'SingleColumnLayout',
        children: [
          { type: 'TextCaption', text: 'A Faculdade de Balsas - Unibalsas preza pelos preceitos fundamentais de confiabilidade de seus contratantes e qualidade de seus serviços prestados, levando em consideração o princípio da boa-fé e estando comprometida com a proteção e privacidade dos seus dados pessoais.\n\nOs dados informados serão utilizados exclusivamente para o gerenciamento de sua inscrição e comunicação no processo seletivo vigente.\n\nPara maiores detalhes e contato com nosso DPO, acesse: https://lp.unibalsas.edu.br/lgpd/' },
          { type: 'Footer', label: 'Voltar', 'on-click-action': { name: 'navigate', next: { type: 'screen', name: 'INSC_DADOS' }, payload: DADOS_PAYLOAD } }
        ]
      }
    },
    {
      id: 'INSC_CURSO',
      title: 'Curso de interesse',
      data: { estado: str(), erro: str(), tem_erro: bool(), cursos: opcoes(), turnos: opcoes(), turno_visivel: bool(), valor_curso_id: str(), valor_turno_id: str() },
      layout: {
        type: 'SingleColumnLayout',
        children: [{
          type: 'Form', name: 'form_curso',
          'init-values': init(['curso_id', 'turno_id']),
          children: [
            { type: 'TextHeading', text: 'Curso de interesse' },
            { type: 'TextBody', text: 'Conte-nos mais detalhes sobre o curso de seu interesse!' },
            erroTexto,
            { type: 'Dropdown', name: 'curso_id', label: 'Curso', 'data-source': '${data.cursos}', required: true, 'on-select-action': troca('buscar_turnos', { curso_id: '${form.curso_id}' }) },
            { type: 'If', condition: '${data.turno_visivel} == true', then: [{ type: 'Dropdown', name: 'turno_id', label: 'Turno', 'data-source': '${data.turnos}', required: true }], else: [] },
            { type: 'Footer', label: 'Avançar', 'on-click-action': troca('escolher_curso', form(['curso_id', 'turno_id'])) }
          ]
        }]
      }
    },
    {
      id: 'INSC_QUASE_LA',
      title: 'Estamos quase lá',
      data: {
        estado: str(), erro: str(), tem_erro: bool(), origens: opcoes(),
        valor_cpf: str(), valor_nacionalidade: str('10'), valor_concluiu_ensino_medio: str(), valor_possui_deficiencia: str(),
        valor_tipos_deficiencia: { type: 'array', items: { type: 'string' }, __example__: [] }, valor_deficiencia_outra: str(),
        valor_como_conheceu: str(), valor_como_conheceu_outro: str(),
        eh_nota_enem: bool(), anos_enem: opcoes(),
        ...Object.fromEntries(ENEM.map(k => ['valor_' + k, str()]))
      },
      layout: {
        type: 'SingleColumnLayout',
        children: [{
          type: 'Form', name: 'form_quase_la',
          'init-values': init(QUASE),
          children: [
            { type: 'TextHeading', text: 'Estamos quase lá!' },
            { type: 'TextBody', text: 'Complete as suas informações para concluir a sua inscrição:' },
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
            { type: 'If', condition: '${data.eh_nota_enem} == true', then: [
              { type: 'TextSubheading', text: 'Notas do ENEM' },
              { type: 'TextBody', text: 'Informe os dados oficiais do seu exame (notas entre 0 e 1000):' },
              { type: 'TextInput', name: 'numero_inscricao_enem', label: 'Nº de inscrição do ENEM', 'helper-text': '12 a 15 números', 'input-type': 'text', required: true },
              { type: 'Dropdown', name: 'ano_enem', label: 'Ano do exame', 'data-source': '${data.anos_enem}', required: true },
              { type: 'TextInput', name: 'nota_natureza_enem', label: 'Ciências da Natureza', 'input-type': 'text', required: true },
              { type: 'TextInput', name: 'nota_humanas_enem', label: 'Ciências Humanas', 'input-type': 'text', required: true },
              { type: 'TextInput', name: 'nota_matematica_enem', label: 'Matemática', 'input-type': 'text', required: true },
              { type: 'TextInput', name: 'nota_linguagens_enem', label: 'Linguagens e Códigos', 'input-type': 'text', required: true },
              { type: 'TextInput', name: 'nota_redacao_enem', label: 'Redação', 'input-type': 'text', required: true }
            ], else: [] },
            { type: 'Footer', label: 'Concluir', 'on-click-action': troca('enviar_informacoes_complementares', form(QUASE)) }
          ]
        }]
      }
    },
    {
      // Igual à tela do site após a inscrição ("Obrigado pelo seu cadastro!").
      id: 'INSC_CONCLUIDA',
      title: 'Inscrição',
      data: { estado: str() },
      layout: {
        type: 'SingleColumnLayout',
        children: [
          imagem(LOGO_UNIBALSAS, 40),
          { type: 'TextSubheading', text: '✅ Obrigado pelo seu cadastro!' },
          { type: 'TextBody', text: 'Sua inscrição foi recebida. Agora é só acessar o Portal do Candidato para acompanhar cada etapa.' },
          { type: 'TextCaption', text: 'Aproveite para conhecer mais sobre a nossa instituição acessando nossas redes sociais!' },
          { type: 'Footer', label: 'Acessar Portal do Candidato', 'on-click-action': troca('abrir_portal') }
        ]
      }
    },
    {
      // Igual ao status do Portal do candidato.
      id: 'INSC_PORTAL',
      title: 'Portal do candidato',
      data: { estado: str() },
      layout: {
        type: 'SingleColumnLayout',
        children: [
          imagem(LOGO_PORTAL, 40),
          { type: 'TextCaption', text: 'Acompanhe aqui o status da sua inscrição' },
          { type: 'TextSubheading', text: '✅ Inscrição' },
          { type: 'TextCaption', text: 'Concluída' },
          { type: 'TextSubheading', text: '❗ Prova online' },
          { type: 'TextCaption', text: 'Prova disponível' },
          { type: 'Footer', label: 'Realizar prova', 'on-click-action': troca('realizar_prova') }
        ]
      }
    },
    {
      // Igual à página "Avaliação online disponível" do site.
      id: 'INSC_AVALIACAO',
      title: 'Prova online',
      data: { estado: str() },
      layout: {
        type: 'SingleColumnLayout',
        children: [
          imagem(LOGO_PORTAL, 40),
          { type: 'TextSubheading', text: 'Avaliação online disponível ✅' },
          { type: 'TextBody', text: 'Por ser 100% online, sua prova pode ser feita no conforto da sua casa ou em qualquer lugar com acesso à internet.' },
          { type: 'TextBody', text: 'Clique no botão abaixo e veja todos os detalhes.' },
          { type: 'Footer', label: 'Iniciar prova', 'on-click-action': troca('iniciar_prova') }
        ]
      }
    },
    {
      id: 'INSC_ORIENTACAO',
      title: 'Prova online',
      data: { estado: str(), erro: str(), tem_erro: bool() },
      layout: {
        type: 'SingleColumnLayout',
        children: [
          { type: 'TextHeading', text: 'Prova de Redação' },
          { type: 'TextSubheading', text: 'Redação online' },
          erroTexto,
          { type: 'TextBody', text: 'Você tem até 120 minutos para elaborar um texto dissertativo-argumentativo sobre o tema apresentado na próxima tela.' },
          { type: 'TextCaption', text: 'Sua redação só é enviada quando você tocar em Enviar redação.' },
          { type: 'Footer', label: 'Iniciar redação', 'on-click-action': troca('iniciar_redacao') }
        ]
      }
    },
    {
      id: 'INSC_REDACAO',
      title: 'Redação',
      data: { estado: str(), erro: str(), tem_erro: bool(), tema_redacao: str('Tema da redação'), valor_texto_redacao: str() },
      layout: {
        type: 'SingleColumnLayout',
        children: [{
          type: 'Form', name: 'form_redacao',
          'init-values': init(['texto_redacao']),
          children: [
            { type: 'TextHeading', text: 'Prova de Redação' },
            { type: 'TextCaption', text: 'Você tem até 120 minutos para elaborar um texto dissertativo-argumentativo sobre o tema abaixo.' },
            erroTexto,
            { type: 'TextBody', text: '${data.tema_redacao}' },
            { type: 'TextArea', name: 'texto_redacao', label: 'Digite aqui seu texto dissertativo', required: true, 'max-length': 3000 },
            { type: 'Footer', label: 'Enviar redação', 'on-click-action': troca('enviar_redacao', form(['texto_redacao'])) }
          ]
        }]
      }
    },
    {
      id: 'INSC_FIM',
      title: 'Prova online',
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
