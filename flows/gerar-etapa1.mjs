// Gera flows/etapa1-vestibular.json (Flow da etapa 1 do Vestibular: inscrição + redação).
// Uso: node flows/gerar-etapa1.mjs
import { writeFileSync, readFileSync } from 'node:fs';
// Etapa 2 (login + matrícula) no mesmo Flow, aberta pelo link "Já sou inscrito" da tela inicial.
import { screens as TELAS_ETAPA2, routing as ROTAS_ETAPA2, LOGIN_VAZIO } from './gerar-etapa2.mjs';
// Cursos fixos no Flow (com o turno no nome): a escolha não chama o Run. O worker acha o curso no Rubeus depois.
import { opcoesCursos } from '../api/cursos-fixos.js';

// Logos vermelhos com fundo transparente (flows/img), embutidos em base64 como pede o Flow JSON.
const png = n => readFileSync(new URL('./img/' + n, import.meta.url)).toString('base64');
const LOGO_UNIBALSAS = png('logo_unibalsas.png');
const LOGO_PORTAL = png('logo_portal.png');
const LOGO_INSCRICAO = png('logo_inscricao.png');
const LOGO_DOCUMENTOS = png('logo_documentos.png');
const LOGO_ENEM = png('logo_enem.png');
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
// As notas do ENEM ficam na tela do curso, como no site (passo 300708); a "Estamos quase lá" é igual nos 4 processos.
const QUASE = ['cpf', 'nacionalidade', 'concluiu_ensino_medio', 'possui_deficiencia', 'tipos_deficiencia', 'deficiencia_outra', 'como_conheceu', 'como_conheceu_outro'];
const CURSO_ENEM = ['curso_id', ...ENEM];
// Valor inicial só nos campos de texto do ENEM (listas sem valor inicial).
const ENEM_TEXTO = ENEM.filter(k => k !== 'ano_enem');
// Documentos de inscrição (Transferência, Portador e ENEM): uma tela por posição, para o seletor de arquivo vir
// vazio em cada documento. A 1ª é sempre o documento obrigatório. Id de tela só com letras (regra da Meta).
const DOCS_INSC = ['INSC_DOC_A', 'INSC_DOC_B', 'INSC_DOC_C'];
const notaEnem = (name, label) => ({ type: 'TextInput', name, label, 'helper-text': 'Use ponto (.) para decimais. Máximo 1000.', 'input-type': 'text', required: true });

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
    INSC_INICIO: ['INSC_DADOS', 'INSC_FIM', 'MATR_LOGIN'],
    INSC_DADOS: ['INSC_CURSO', 'INSC_CURSO_ENEM', 'INSC_FIM'],
    INSC_CURSO: ['INSC_QUASE_LA', 'INSC_FIM'],
    INSC_CURSO_ENEM: ['INSC_QUASE_LA', 'INSC_FIM'],
    INSC_QUASE_LA: ['INSC_CONCLUIDA', 'INSC_FIM'],
    INSC_CONCLUIDA: ['INSC_PORTAL', 'INSC_STATUS', 'INSC_FIM'],
    INSC_STATUS: ['INSC_DOC_A', 'INSC_FIM'],
    INSC_DOC_A: ['INSC_DOC_B', 'INSC_DOCS_FIM', 'INSC_FIM'],
    INSC_DOC_B: ['INSC_DOC_C', 'INSC_DOCS_FIM', 'INSC_FIM'],
    INSC_DOC_C: ['INSC_DOCS_FIM', 'INSC_FIM'],
    INSC_DOCS_FIM: [],
    INSC_PORTAL: ['INSC_AVALIACAO'],
    INSC_AVALIACAO: ['INSC_ORIENTACAO'],
    INSC_ORIENTACAO: ['INSC_REDACAO', 'INSC_FIM'],
    INSC_REDACAO: ['INSC_FINALIZADA', 'INSC_FIM'],
    INSC_FINALIZADA: [],
    INSC_FIM: [],
    ...ROTAS_ETAPA2
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
            imagem(LOGO_INSCRICAO, 40),
            // Página 1 = porta de entrada: "Iniciar inscrição" (etapa 1) ou "LOGIN" (o servidor leva à etapa em que parou).
            { type: 'TextSubheading', text: 'Escolha seu processo e selecione uma opção' },
            // Lista fixa (a Meta não informa ao servidor qual Flow abriu): atualizar a cada semestre.
            { type: 'Dropdown', name: 'processo_seletivo_id', label: 'Processo seletivo', required: true, 'data-source': [
              { id: '20383', title: 'Vestibular Online 2027/1' },
              { id: '20385', title: 'Transferência 2027/1' },
              { id: '20384', title: 'Portador de Diploma 2027/1' },
              { id: '20386', title: 'Nota do ENEM 2027/1' }
            ] },
            { type: 'TextCaption', text: 'Já iniciou sua inscrição ou matrícula?\nToque em "LOGIN" abaixo para continuar da etapa em que parou.' },
            { type: 'EmbeddedLink', text: 'Já sou inscrito (LOGIN)', 'on-click-action': { name: 'navigate', next: { type: 'screen', name: 'MATR_LOGIN' }, payload: LOGIN_VAZIO } },
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
            imagem(LOGO_INSCRICAO, 40),
            { type: 'TextHeading', text: 'Dados básicos' },
            { type: 'TextBody', text: 'Olá! Para começar, preencha alguns dados básicos sobre você:' },
            erroTexto,
            { type: 'TextInput', name: 'nome', label: 'Nome completo', 'input-type': 'text', required: true },
            { type: 'OptIn', name: 'possui_nome_social', label: 'Possuo nome social', required: false },
            // If de volta (2.16.23): o nome social só aparece com a caixa marcada. Teste para separar a causa do
            // WhatsApp Web: a 2.16.22 (sem calendário e sem If) passou; aqui só o DatePicker continua.
            { type: 'If', condition: '${form.possui_nome_social} == true', then: [{ type: 'TextInput', name: 'nome_social', label: 'Nome social', 'input-type': 'text', required: true }], else: [] },
            { type: 'TextInput', name: 'email', label: 'E-mail', 'input-type': 'email', required: true },
            // DatePicker (seletor clássico) no lugar do CalendarPicker: suspeito de estragar a navegação do WhatsApp Web
            // na passagem Dados básicos → Curso (20/11). Também devolve AAAA-MM-DD.
            { type: 'DatePicker', name: 'data_nascimento', label: 'Data de nascimento', 'min-date': '1920-01-01', 'max-date': '${data.data_maxima_nascimento}', required: true },
            { type: 'TextInput', name: 'celular', label: 'Celular', 'helper-text': 'Para facilitar o nosso contato, confirme o seu WhatsApp, de preferência.', 'input-type': 'phone', required: true },
            { type: 'RadioButtonsGroup', name: 'genero', label: 'Gênero', required: true, 'data-source': [{ id: 'M', title: 'Masculino' }, { id: 'F', title: 'Feminino' }] },
            // "Leia mais" abre a página da LGPD. Antes abria a tela INSC_PRIVACIDADE, cujo "Voltar" navegava de novo
            // para INSC_DADOS sem rota declarada: o único ciclo do Flow (suspeito do erro no WhatsApp Web, 20/11).
            { type: 'OptIn', name: 'aceite_privacidade', label: 'Aceito receber conteúdos e lembretes sobre o processo seletivo e concordo com a Política de Privacidade vigente.', required: true, 'on-click-action': { name: 'open_url', url: 'https://lp.unibalsas.edu.br/lgpd/' } },
            { type: 'Footer', label: 'Avançar', 'on-click-action': troca('enviar_dados_basicos', form(DADOS)) }
          ]
        }]
      }
    },
    {
      id: 'INSC_CURSO',
      title: 'Curso de interesse',
      data: { estado: str(), erro: str(), tem_erro: bool() },
      layout: {
        type: 'SingleColumnLayout',
        children: [{
          type: 'Form', name: 'form_curso',
          children: [
            imagem(LOGO_INSCRICAO, 40),
            { type: 'TextHeading', text: 'Curso de interesse' },
            { type: 'TextBody', text: 'Conte-nos mais detalhes sobre o curso de seu interesse!' },
            erroTexto,
            // Lista fixa (curso com o turno no nome), sem on-select: no WhatsApp Web, a resposta do Run com a mesma
            // tela (que carregava o turno) fazia o Flow mostrar a 1ª tela (20/11).
            { type: 'RadioButtonsGroup', name: 'curso_id', label: 'Curso', 'data-source': opcoesCursos(), required: true },
            { type: 'Footer', label: 'Avançar', 'on-click-action': troca('escolher_curso', form(['curso_id'])) }
          ]
        }]
      }
    },
    {
      // Nota do ENEM: curso (com o turno no nome) + os dados do ENEM na mesma tela, igual ao site (passo 300708).
      // A média é calculada pelo Cloud Run e aparece na tela seguinte (o site mostra o campo bloqueado).
      id: 'INSC_CURSO_ENEM',
      title: 'Curso de interesse',
      data: {
        estado: str(), erro: str(), tem_erro: bool(), anos_enem: opcoes(),
        ...Object.fromEntries(ENEM_TEXTO.map(k => ['valor_' + k, str()]))
      },
      layout: {
        type: 'SingleColumnLayout',
        children: [{
          type: 'Form', name: 'form_curso_enem',
          'init-values': init(ENEM_TEXTO),
          children: [
            imagem(LOGO_ENEM, 40),
            { type: 'TextHeading', text: 'Curso de interesse' },
            { type: 'TextBody', text: 'Conte-nos mais detalhes sobre o curso de seu interesse!' },
            erroTexto,
            { type: 'RadioButtonsGroup', name: 'curso_id', label: 'Curso', 'data-source': opcoesCursos(), required: true },
            { type: 'TextSubheading', text: 'Dados do ENEM' },
            { type: 'TextInput', name: 'numero_inscricao_enem', label: 'Número de inscrição do ENEM', 'helper-text': 'Somente números (12 a 15)', 'input-type': 'text', required: true },
            { type: 'Dropdown', name: 'ano_enem', label: 'Ano do ENEM', 'data-source': '${data.anos_enem}', required: true },
            notaEnem('nota_natureza_enem', 'Nota de ciências da natureza'),
            notaEnem('nota_humanas_enem', 'Nota de ciências humanas'),
            notaEnem('nota_matematica_enem', 'Nota de matemática'),
            notaEnem('nota_linguagens_enem', 'Nota de linguagens'),
            notaEnem('nota_redacao_enem', 'Nota da redação'),
            { type: 'TextCaption', text: 'A média das notas é calculada automaticamente.' },
            { type: 'Footer', label: 'Avançar', 'on-click-action': troca('escolher_curso', form(CURSO_ENEM)) }
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
        eh_nota_enem: bool(), resumo_enem: str('Média das notas do ENEM: 628,10')
      },
      layout: {
        type: 'SingleColumnLayout',
        children: [{
          type: 'Form', name: 'form_quase_la',
          'init-values': init(QUASE),
          children: [
            imagem(LOGO_INSCRICAO, 40),
            { type: 'TextHeading', text: 'Estamos quase lá!' },
            { type: 'TextBody', text: 'Complete as suas informações para concluir a sua inscrição:' },
            { type: 'TextCaption', text: '${data.resumo_enem}', visible: '${data.eh_nota_enem}' },
            erroTexto,
            { type: 'TextInput', name: 'cpf', label: 'CPF', 'helper-text': 'Somente os 11 números', 'input-type': 'text', required: true },
            { type: 'Dropdown', name: 'nacionalidade', label: 'Nacionalidade', required: true, 'data-source': [{ id: '10', title: 'Brasileira' }, { id: '20', title: 'Naturalizado Brasileiro' }, { id: '50', title: 'Outros' }] },
            { type: 'RadioButtonsGroup', name: 'concluiu_ensino_medio', label: 'Você já concluiu o ensino médio?', required: true, 'data-source': [{ id: 'Sim', title: 'Sim' }, { id: 'Não', title: 'Não' }] },
            { type: 'RadioButtonsGroup', name: 'possui_deficiencia', label: 'Possui alguma deficiência?', required: true, 'data-source': [{ id: 'T', title: 'Sim' }, { id: 'F', title: 'Não' }] },
            { type: 'If', condition: "${form.possui_deficiencia} == 'T'", then: [
              { type: 'CheckboxGroup', name: 'tipos_deficiencia', label: 'Necessidades especiais', required: true, 'data-source': [{ id: 'auditiva', title: 'Auditiva' }, { id: 'fala', title: 'Fala' }, { id: 'fisica', title: 'Física' }, { id: 'intelectual', title: 'Intelectual' }, { id: 'visual', title: 'Visual' }, { id: 'mental', title: 'Mental' }, { id: 'outras', title: 'Outras' }] },
              { type: 'TextInput', name: 'deficiencia_outra', label: 'Se marcou Outras, especifique:', 'input-type': 'text', required: false }
            ], else: [] },
            { type: 'Dropdown', name: 'como_conheceu', label: 'Como nos conheceu?', required: true, 'data-source': '${data.origens}' },
            { type: 'If', condition: "${form.como_conheceu} == '10'", then: [{ type: 'TextInput', name: 'como_conheceu_outro', label: 'Especifique o canal:', 'input-type': 'text', required: true }], else: [] },
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
      // Transferência, Portador e ENEM: o status que o portal mostra logo depois de concluir a inscrição
      // (conferido no site em 17/11/2026). "Verificar" abre os documentos de inscrição, como no site.
      id: 'INSC_STATUS',
      title: 'Portal do candidato',
      data: { estado: str(), eh_nota_enem: bool() },
      layout: {
        type: 'SingleColumnLayout',
        children: [
          imagem(LOGO_PORTAL, 40),
          { type: 'TextCaption', text: 'Acompanhe aqui o status da sua inscrição' },
          { type: 'TextSubheading', text: '✅ Inscrição' },
          { type: 'TextCaption', text: 'Concluída' },
          { type: 'TextSubheading', text: '⏳ Checando as notas', visible: '${data.eh_nota_enem}' },
          { type: 'TextCaption', text: 'Validando', visible: '${data.eh_nota_enem}' },
          { type: 'TextSubheading', text: '❗ Documentos inscrição' },
          { type: 'TextCaption', text: 'Pendentes' },
          { type: 'Footer', label: 'Verificar', 'on-click-action': troca('verificar_documentos') }
        ]
      }
    },
    // Documentos de inscrição: um por tela, com o título vindo do Cloud Run (a lista é a do processo).
    ...DOCS_INSC.map((id, i) => ({
      id,
      title: 'Documentos inscrição',
      data: { estado: str(), erro: str(), tem_erro: bool(), titulo_doc: str('Histórico acadêmico *'), legenda_doc: str('Obrigatório. Documento 1 de 3.'), botao: str('Avançar') },
      layout: {
        type: 'SingleColumnLayout',
        children: [{
          type: 'Form', name: 'form_doc_insc',
          children: [
            imagem(LOGO_DOCUMENTOS, 40),
            { type: 'TextHeading', text: 'Envio de arquivos' },
            ...(i === 0 ? [{ type: 'TextBody', text: 'Envie o arquivo com todas as páginas do documento, incluindo frente e verso. A análise ocorre em até 48 horas úteis.' }] : []),
            { type: 'TextSubheading', text: '${data.titulo_doc}' },
            { type: 'TextCaption', text: '${data.legenda_doc}' },
            erroTexto,
            { type: 'DocumentPicker', name: 'arquivo', label: 'Arquivo', description: 'PDF, JPG ou PNG de até 740 KB', 'min-uploaded-documents': i === 0 ? 1 : 0, 'max-uploaded-documents': 1, 'max-file-size-kb': 740, 'allowed-mime-types': ['application/pdf', 'image/jpeg', 'image/png'] },
            { type: 'Footer', label: '${data.botao}', 'on-click-action': troca('enviar_documento_inscricao', { arquivo: '${form.arquivo}' }) }
          ]
        }]
      }
    })),
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
      // Igual à tela da avaliação ao finalizar a prova; o botão só fecha o Flow.
      id: 'INSC_FINALIZADA',
      title: 'Avaliação online',
      terminal: true,
      success: true,
      layout: {
        type: 'SingleColumnLayout',
        children: [
          imagem(LOGO_UNIBALSAS, 40),
          { type: 'TextSubheading', text: 'Avaliação online' },
          { type: 'TextBody', text: 'Parabéns! Você finalizou a sua prova on-line.' },
          { type: 'TextBody', text: 'Nossa equipe já iniciou a sua correção e, em breve, você terá o resultado.' },
          { type: 'TextBody', text: 'Recomendamos que você acompanhe o andamento no Portal do Candidato.' },
          { type: 'TextBody', text: 'Assim que sair o resultado, caso você não tenha alcançado o percentual mínimo de aprovação, poderá "Realizar a avaliação mais uma vez".' },
          { type: 'TextBody', text: 'Desejamos boa sorte!\nAté breve.' },
          { type: 'Footer', label: 'Fechar', 'on-click-action': { name: 'complete', payload: {} } }
        ]
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
    },
    {
      // Fim da etapa 1 da Transferência, do Portador e do ENEM: depois do "Enviar", o status do portal como no
      // site (Documentos inscrição: Em análise). Última tela: o envio já está agendado no Cloud Run, então
      // fechar o Flow aqui (Concluir ou o X) finaliza.
      id: 'INSC_DOCS_FIM',
      title: 'Portal do candidato',
      terminal: true,
      success: true,
      data: { eh_nota_enem: bool() },
      layout: {
        type: 'SingleColumnLayout',
        children: [
          imagem(LOGO_PORTAL, 40),
          { type: 'TextCaption', text: 'Acompanhe aqui o status da sua inscrição' },
          { type: 'TextSubheading', text: '✅ Inscrição' },
          { type: 'TextCaption', text: 'Concluída' },
          { type: 'TextSubheading', text: '⏳ Checando as notas', visible: '${data.eh_nota_enem}' },
          { type: 'TextCaption', text: 'Validando', visible: '${data.eh_nota_enem}' },
          { type: 'TextSubheading', text: '⏳ Documentos inscrição' },
          { type: 'TextCaption', text: 'Em análise' },
          { type: 'TextBody', text: 'Documentos recebidos ✅ A análise ocorre em até 48 horas úteis. Avisaremos por aqui quando houver novidade; você também acompanha pelo LOGIN (Já sou inscrito).' },
          { type: 'Footer', label: 'Concluir', 'on-click-action': { name: 'complete', payload: {} } }
        ]
      }
    }
    ,...TELAS_ETAPA2
  ]
};

writeFileSync(new URL('./etapa1-vestibular.json', import.meta.url), JSON.stringify(flow, null, 2) + '\n');
console.log('flows/etapa1-vestibular.json gerado');
