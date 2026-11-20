// Cenário 1: inscrição Nota do ENEM pelo Flow (telas novas), sem rodar o worker (nada vai ao Rubeus).
import { call, mostrar, ctrl } from './lib.mjs';
const TOKEN = 'verify-enem-' + Date.now();
const agora = Date.now();
await ctrl('/put', { col: 'flowCache', id: 'etapa1-20386', record: { cursos: [{ id: 'c1', title: 'Psicologia' }, { id: 'c2', title: 'Direito' }], turnos: { c1: [{ id: 't1', title: 'Noturno' }], c2: [{ id: 't1', title: 'Noturno' }, { id: 't2', title: 'Matutino' }] }, atualizado: agora, expires: agora + 864e5 } });

let r = await call(null, 'INIT', {}, TOKEN); mostrar('INIT', r);
r = await call('INSC_INICIO', 'data_exchange', { acao: 'e1_iniciar', processo_seletivo_id: '20386' }, TOKEN); mostrar('INSC_INICIO → Nota do ENEM', r);
const basicos = { acao: 'enviar_dados_basicos', estado: r.data.estado, nome: 'Juan Luiz Luiz da Costa', possui_nome_social: false, nome_social: '', email: 'juan_dacosta@futureteeth.com.br', data_nascimento: '1980-11-14', celular: '68998773655', genero: 'M', aceite_privacidade: true };
r = await call('INSC_DADOS', 'data_exchange', basicos, TOKEN); mostrar('INSC_DADOS → enviar', r);
const est = r.data.estado;
const notas = { numero_inscricao_enem: '999999999999', ano_enem: '2025', nota_natureza_enem: '600.5', nota_humanas_enem: '620', nota_matematica_enem: '580', nota_linguagens_enem: '640', nota_redacao_enem: '700' };
// Cursos fixos no Flow: o curso vai junto com as notas, num toque.
// 🔍 nota fora da faixa
r = await call('INSC_CURSO_ENEM', 'data_exchange', { acao: 'escolher_curso', estado: est, curso_id: 'direito', ...notas, nota_redacao_enem: '1200' }, TOKEN); mostrar('🔍 nota de redação 1200', r, ['valor_nota_redacao_enem']);
// 🔍 inscrição ENEM curta
r = await call('INSC_CURSO_ENEM', 'data_exchange', { acao: 'escolher_curso', estado: est, curso_id: 'direito', ...notas, numero_inscricao_enem: '123' }, TOKEN); mostrar('🔍 nº de inscrição ENEM com 3 dígitos', r);
// 🔍 curso fora da lista
r = await call('INSC_CURSO_ENEM', 'data_exchange', { acao: 'escolher_curso', estado: est, curso_id: 'inventado', ...notas }, TOKEN); mostrar('🔍 curso fora da lista', r);
r = await call('INSC_CURSO_ENEM', 'data_exchange', { acao: 'escolher_curso', estado: est, curso_id: 'direito', ...notas }, TOKEN); mostrar('INSC_CURSO_ENEM → avançar válido', r);
const origem = r.data.origens?.[0]?.id;
const final = { acao: 'enviar_informacoes_complementares', estado: r.data.estado, cpf: '972.402.321-40', nacionalidade: '10', concluiu_ensino_medio: 'Sim', possui_deficiencia: 'F', tipos_deficiencia: [], deficiencia_outra: '', como_conheceu: origem, como_conheceu_outro: '' };
r = await call('INSC_QUASE_LA', 'data_exchange', final, TOKEN); mostrar('INSC_QUASE_LA → concluir (consulta RM ligada, CPF do Juan já inscrito)', r);
await ctrl('/env', { ETAPA1_CONSULTA_RM: 'off' });
r = await call('INSC_QUASE_LA', 'data_exchange', final, TOKEN); mostrar('INSC_QUASE_LA → concluir (consulta RM desligada só neste teste)', r);
r = await call('INSC_CONCLUIDA', 'data_exchange', { acao: 'abrir_portal', estado: r.data.estado }, TOKEN); mostrar('INSC_CONCLUIDA → Portal', r);
const estStatus = r.data.estado;
r = await call('INSC_STATUS', 'data_exchange', { acao: 'verificar_documentos', estado: estStatus }, TOKEN); mostrar('INSC_STATUS → Verificar', r);
const estDoc = r.data.estado;
r = await call('INSC_DOC_A', 'data_exchange', { acao: 'enviar_documento_inscricao', estado: estDoc, arquivo: [] }, TOKEN); mostrar('🔍 INSC_DOC_A sem arquivo (obrigatório)', r);
const m = await ctrl('/media', { name: 'boletim-enem.pdf' });
r = await call('INSC_DOC_A', 'data_exchange', { acao: 'enviar_documento_inscricao', estado: estDoc, arquivo: [m] }, 'outro-token'); mostrar('🔍 INSC_DOC_A com flow_token de outra sessão', r);
r = await call('INSC_DOC_A', 'data_exchange', { acao: 'enviar_documento_inscricao', estado: estDoc, arquivo: [m] }, TOKEN); mostrar('INSC_DOC_A → Enviar boletim', r);
r = await call('INSC_DOC_A', 'data_exchange', { acao: 'enviar_documento_inscricao', estado: estDoc, arquivo: [m] }, TOKEN); mostrar('🔍 Enviar de novo (toque duplo)', r);
console.log('\n### tarefas na fila', JSON.stringify(await ctrl('/tasks')));
const fila = (await ctrl('/store?col=inscricoesFila')).map(x => ({ key: x.key, status: x.record.status, passo: x.record.passo, respostas: Object.keys(x.record.respostas ?? {}).length, media_enem: x.record.respostas?.media_enem, docs: x.record.docs_inscricao && { completo: x.record.docs_inscricao.completo, codigos: Object.keys(x.record.docs_inscricao.arquivos ?? {}) } }));
console.log('### registro no Firestore (simulado)', JSON.stringify(fila, null, 1));
