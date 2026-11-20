// Sonda: Vestibular (20383) continua indo para a prova, não para os documentos.
import { call, mostrar, ctrl } from './lib.mjs';
const agora = Date.now(), T = 'verify-vest-' + agora;
await ctrl('/put', { col: 'flowCache', id: 'etapa1-20383', record: { tema: 'Tema de teste', cursos: [{ id: 'c1', title: 'Direito' }], turnos: { c1: [{ id: 't1', title: 'Noturno' }] }, atualizado: agora, expires: agora + 864e5 } });
await ctrl('/env', { ETAPA1_CONSULTA_RM: 'off' });
let r = await call('INSC_INICIO', 'data_exchange', { acao: 'e1_iniciar', processo_seletivo_id: '20383' }, T);
r = await call('INSC_DADOS', 'data_exchange', { acao: 'enviar_dados_basicos', estado: r.data.estado, nome: 'Rebeca Isabelly Stefany Drumond', possui_nome_social: false, nome_social: '', email: 'rebeca_drumond@piscinasegura.com.br', data_nascimento: '1959-04-13', celular: '68999966749', genero: 'F', aceite_privacidade: true }, T);
mostrar('20383: tela do curso', r);
r = await call(r.screen, 'data_exchange', { acao: 'escolher_curso', estado: r.data.estado, curso_id: 'direito' }, T);
mostrar('20383: QUASE_LA', r);
r = await call('INSC_QUASE_LA', 'data_exchange', { acao: 'enviar_informacoes_complementares', estado: r.data.estado, cpf: '999.456.334-30', nacionalidade: '10', concluiu_ensino_medio: 'Sim', possui_deficiencia: 'F', tipos_deficiencia: [], deficiencia_outra: '', como_conheceu: r.data.origens[0].id, como_conheceu_outro: '' }, T);
r = await call('INSC_CONCLUIDA', 'data_exchange', { acao: 'abrir_portal', estado: r.data.estado }, T);
mostrar('20383: Obrigado → Portal (esperado: INSC_PORTAL com a prova)', r);
r = await call('INSC_STATUS', 'data_exchange', { acao: 'verificar_documentos', estado: r.data.estado }, T);
mostrar('🔍 20383: estado do INSC_PORTAL enviado na tela INSC_STATUS', r);
