// Cenário 4: envio dos documentos de inscrição pelo worker (portal real) e vigia da inscrição.
// Registro semeado como o worker deixa depois do "final" (passo docs_inscricao), para um candidato de teste
// cujos documentos já estão "Em análise" no portal: o worker não deve reenviar nada (repetição segura).
import crypto from 'node:crypto';
import { ctrl } from './lib.mjs';
const pessoas = { juan: ['97240232140', '1980-11-14', '20386', '25', 'Juan'], rosa: ['39372667552', '1983-04-27', '20384', '10', 'Rosa'], rebeca: ['99945633430', '1959-04-13', '20385', '28', 'Rebeca'] };
const quem = process.argv[2] ?? 'rosa';
const [cpf, nasc, processo, codigo, nome] = pessoas[quem];
const id = crypto.createHash('sha256').update('verify-docs:' + quem).digest('hex');
const media = await ctrl('/media', { name: 'teste.pdf' });
const agora = Date.now();
await ctrl('/put', { col: 'inscricoesFila', id, record: { id, processo, flow: 'x', respostas: {}, redacao: null, status: 'inscrita', passo: 'docs_inscricao', tentativas: 0, rodando_ate: 0, inscrita_em: agora - 120000, applyment_id: '', via_login: { login: cpf, data_nascimento: nasc }, contato: { nome, celular: '' }, docs_inscricao: { completo: true, arquivos: { [codigo]: [media] } }, criado: agora, expires: agora + 864e5 } });
await ctrl('/task', { id, tipo: 'etapa1' });
console.log('### worker etapa1 (docs_inscricao)', JSON.stringify(await ctrl('/dispatch', { tipo: 'etapa1', id: id.slice(0, 10) })));
const rec = (await ctrl('/store?col=inscricoesFila')).find(x => x.key.endsWith(id.slice(0, 10)))?.record;
console.log('### registro da etapa 1 depois', JSON.stringify({ status: rec?.status, passo: rec?.passo, applyment_id: Boolean(rec?.applyment_id), docs: rec?.docs_inscricao, via_login: rec?.via_login, contato: rec?.contato, tentativas: rec?.tentativas, erro: rec?.erro ?? rec?.ultimo_erro }));
let t = await ctrl('/tasks'); console.log('### tarefas', JSON.stringify(t.map(x => x.tipo + ':' + x.id)));
for (let i = 0; i < 2 && t.some(x => x.tipo === 'inscricao_vigia'); i++) {
  await new Promise(r => setTimeout(r, 2500));
  console.log(`### vigia da inscrição (rodada ${i + 1})`, JSON.stringify(await ctrl('/dispatch', { tipo: 'inscricao_vigia' })));
  t = await ctrl('/tasks'); console.log('### tarefas', JSON.stringify(t.map(x => x.tipo + ':' + x.id)));
}
const m = (await ctrl('/store?col=matriculaFila')).map(x => ({ key: x.key, insc_vigia: x.record.insc_vigia, recusados: x.record.docs_inscricao_recusados, contato: Boolean(x.record.contato?.celular), avisos: x.record.avisos, ultimo_status: x.record.ultimo_status && { processo: x.record.ultimo_status.processo, etapas: x.record.ultimo_status.stages?.map(s => s.title + ': ' + (s.complementary_text ?? s.feedback?.complementary_text ?? '')).join(' | ') } }));
console.log('### matriculaFila', JSON.stringify(m, null, 1));
