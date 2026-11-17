// Cenário 2: Transferência (3 documentos, 2 opcionais) e Portador (abertura), sem worker.
import { call, mostrar, ctrl } from './lib.mjs';
const agora = Date.now();
for (const p of ['20385', '20384']) await ctrl('/put', { col: 'flowCache', id: 'etapa1-' + p, record: { cursos: [{ id: 'c1', title: 'Direito' }], turnos: { c1: [{ id: 't1', title: 'Noturno' }] }, atualizado: agora, expires: agora + 864e5 } });
await ctrl('/env', { ETAPA1_CONSULTA_RM: 'off' });

async function ate(processo, token, pessoa) {
  let r = await call('INSC_INICIO', 'data_exchange', { acao: 'e1_iniciar', processo_seletivo_id: processo }, token);
  r = await call('INSC_DADOS', 'data_exchange', { acao: 'enviar_dados_basicos', estado: r.data.estado, possui_nome_social: false, nome_social: '', genero: 'F', aceite_privacidade: true, ...pessoa.basicos }, token);
  mostrar(`${processo}: INSC_DADOS → tela do curso`, r);
  r = await call(r.screen, 'data_exchange', { acao: 'escolher_curso', estado: r.data.estado, curso_id: 'c1' }, token);
  mostrar(`${processo}: curso com turno único (pré-selecionado?)`, r, ['valor_turno_id']);
  r = await call(r.screen, 'data_exchange', { acao: 'escolher_curso', estado: r.data.estado, curso_id: 'c1', turno_id: r.data.valor_turno_id }, token);
  mostrar(`${processo}: avançar → QUASE_LA (sem campos do ENEM)`, r);
  r = await call('INSC_QUASE_LA', 'data_exchange', { acao: 'enviar_informacoes_complementares', estado: r.data.estado, cpf: pessoa.cpf, nacionalidade: '10', concluiu_ensino_medio: 'Sim', possui_deficiencia: 'F', tipos_deficiencia: [], deficiencia_outra: '', como_conheceu: r.data.origens[0].id, como_conheceu_outro: '' }, token);
  r = await call('INSC_CONCLUIDA', 'data_exchange', { acao: 'abrir_portal', estado: r.data.estado }, token);
  mostrar(`${processo}: Obrigado → Portal`, r);
  r = await call('INSC_STATUS', 'data_exchange', { acao: 'verificar_documentos', estado: r.data.estado }, token);
  return r;
}

const T = 'verify-transf-' + agora;
let r = await ate('20385', T, { cpf: '999.456.334-30', basicos: { nome: 'Rebeca Isabelly Stefany Drumond', email: 'rebeca_drumond@piscinasegura.com.br', data_nascimento: '1959-04-13', celular: '68999966749' } });
mostrar('20385: Verificar → doc 1', r);
const m1 = await ctrl('/media', { name: 'historico.pdf' }), m3 = await ctrl('/media', { name: 'declaracao.pdf' });
r = await call('INSC_DOC_A', 'data_exchange', { acao: 'enviar_documento_inscricao', estado: r.data.estado, arquivo: [m1] }, T); mostrar('20385: doc 1 anexado → doc 2', r);
r = await call('INSC_DOC_B', 'data_exchange', { acao: 'enviar_documento_inscricao', estado: r.data.estado, arquivo: [] }, T); mostrar('🔍 20385: doc 2 opcional pulado → doc 3', r);
r = await call('INSC_DOC_C', 'data_exchange', { acao: 'enviar_documento_inscricao', estado: r.data.estado, arquivo: [m3] }, T); mostrar('20385: doc 3 → Enviar', r);

const P = 'verify-port-' + agora;
r = await ate('20384', P, { cpf: '393.726.675-52', basicos: { nome: 'Rosa Helena Patricia Rodrigues', email: 'rosahelenarodrigues@alcastro.com.br', data_nascimento: '1983-04-27', celular: '91997413715' } });
mostrar('20384: Verificar → doc 1', r);
const estA = r.data.estado;
const m2 = await ctrl('/media', { name: 'diploma.pdf' });
r = await call('INSC_DOC_A', 'data_exchange', { acao: 'enviar_documento_inscricao', estado: estA, arquivo: [m2, m2] }, P); mostrar('🔍 20384: dois arquivos no doc 1', r);
r = await call('INSC_DOC_B', 'data_exchange', { acao: 'enviar_documento_inscricao', estado: r.data.estado, arquivo: [] }, P);
r = await call('INSC_DOC_C', 'data_exchange', { acao: 'enviar_documento_inscricao', estado: r.data.estado, arquivo: [] }, P); mostrar('20384: só o obrigatório → Enviar', r);
r = await call('INSC_DOC_A', 'data_exchange', { acao: 'enviar_documento_inscricao', estado: 'lixo', arquivo: [m2] }, P); mostrar('🔍 estado adulterado', r);

const fila = (await ctrl('/store?col=inscricoesFila')).map(x => ({ key: x.key, processo: x.record.processo, passo: x.record.passo, docs: x.record.docs_inscricao && { completo: x.record.docs_inscricao.completo, arquivos: Object.fromEntries(Object.entries(x.record.docs_inscricao.arquivos ?? {}).map(([k, v]) => [k, v.length])) } }));
console.log('\n### Firestore (simulado)', JSON.stringify(fila));
