// Mais de uma inscrição no mesmo CPF (2.17.8), com o portal real: a Rebeca (fictícia) já tem a Transferência.
// Uma inscrição nova no Vestibular com o CPF dela deve mostrar o aviso "já possui inscrição" (INSC_JA_INSCRITO).
// Uso: node multipla.mjs [seguir|nova|login]. Nenhuma tarefa é despachada: nada chega ao Rubeus.
import { call, mostrar, ctrl } from './lib.mjs';
const modo = process.argv[2] ?? 'seguir';
const CPF = '999.456.334-30', NASC = '1959-04-13';
const agora = Date.now(), T = 'verify-multi-' + agora;
await ctrl('/put', { col: 'flowCache', id: 'etapa1-20383', record: { cursos: [{ id: 'c1', title: 'Direito' }], turnos: { c1: [{ id: 't1', title: 'Noturno' }] }, tema: 'Tema de teste', atualizado: agora, expires: agora + 864e5 } });
await ctrl('/env', { ETAPA1_CONSULTA_RM: 'off' });

if (modo === 'login') {
  const r = await call('MATR_LOGIN', 'data_exchange', { acao: 'entrar', login: CPF, data_nascimento: NASC }, T);
  mostrar('LOGIN da Rebeca (uma inscrição: caminho de sempre)', r);
  process.exit(0);
}
let r = await call('INSC_INICIO', 'data_exchange', { acao: 'e1_iniciar', processo_seletivo_id: '20383' }, T);
r = await call('INSC_DADOS', 'data_exchange', { acao: 'enviar_dados_basicos', estado: r.data.estado, nome: 'Rebeca Isabelly Stefany Drumond', possui_nome_social: false, nome_social: '', email: 'rebeca_drumond@piscinasegura.com.br', data_nascimento: NASC, celular: '68999966749', genero: 'F', aceite_privacidade: true }, T);
r = await call('INSC_CURSO', 'data_exchange', { acao: 'escolher_curso', estado: r.data.estado, curso_id: 'psicologia' }, T);
r = await call('INSC_QUASE_LA', 'data_exchange', { acao: 'enviar_informacoes_complementares', estado: r.data.estado, cpf: CPF, nacionalidade: '10', concluiu_ensino_medio: 'Sim', possui_deficiencia: 'F', tipos_deficiencia: [], deficiencia_outra: '', como_conheceu: r.data.origens[0].id, como_conheceu_outro: '' }, T);
mostrar('Concluir no Vestibular com CPF que já tem Transferência', r, ['mensagem', 'opcoes']);
if (r.screen !== 'INSC_JA_INSCRITO') process.exit(1);
const escolha = modo === 'nova' ? 'nova' : 'seguir_0';
const fim = await call('INSC_JA_INSCRITO', 'data_exchange', { acao: 'decidir_inscricao', estado: r.data.estado, inscricao: escolha }, T);
mostrar(`Escolha: ${escolha}`, fim);
const fila = (await ctrl('/store?col=inscricoesFila')).at(-1)?.record;
console.log('### inscrição nova', JSON.stringify({ concluida_em: Boolean(fila?.concluida_em), status: fila?.status }));
console.log('### tarefas', JSON.stringify((await ctrl('/tasks')).map(t => t.tipo).reduce((a, t) => ({ ...a, [t]: (a[t] ?? 0) + 1 }), {})));
