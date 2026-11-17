// Cenário 3b: LOGIN completo (status em 2º plano → Atualizar → lista → toques → vigia → 2º LOGIN / V1).
import { call, mostrar, ctrl } from './lib.mjs';
const pessoas = { juan: ['972.402.321-40', '1980-11-14'], rosa: ['393.726.675-52', '1983-04-27'], rebeca: ['999.456.334-30', '1959-04-13'] };
const quem = process.argv[2] ?? 'juan';
const [cpf, nasc] = pessoas[quem];
const lista = r => { for (const it of r.data?.etapas ?? []) console.log(`  · ${it['main-content'].title} — ${it['main-content'].metadata}${it.end ? ' [' + it.end.title + ']' : ''}${it.start?.image ? ` (ícone ${Math.round(it.start.image.length * 3 / 4)} B)` : ' (sem ícone)'}`); return r.data?.etapas ?? []; };
const T = 'verify-login2-' + quem + '-' + Date.now();
let r = await call('MATR_LOGIN', 'data_exchange', { acao: 'entrar', login: cpf, data_nascimento: nasc }, T);
mostrar(`LOGIN ${quem}`, r); lista(r);
let tarefas = await ctrl('/tasks'); console.log('### tarefas', JSON.stringify(tarefas.map(t => t.tipo + ':' + t.id)));
if (r.screen === 'MATR_PORTAL' && r.data.botao === 'Atualizar') {
  console.log('### worker etapa2_status', JSON.stringify(await ctrl('/dispatch', { tipo: 'etapa2_status' })));
  r = await call('MATR_PORTAL', 'data_exchange', { acao: 'continuar', estado: r.data.estado }, T);
  mostrar('Atualizar', r); lista(r);
}
const itens = r.data?.etapas ?? [];
for (const re of [/inscri/i, /nota/i]) {
  const alvo = itens.find(i => re.test(i['main-content'].title) && /document|checando/i.test(i['main-content'].title));
  if (!alvo) continue;
  const r2 = await call('MATR_STATUS', 'data_exchange', alvo['on-click-action'].payload, T);
  mostrar(`toque em "${alvo['main-content'].title}"`, r2); lista(r2);
}
tarefas = await ctrl('/tasks'); console.log('### tarefas', JSON.stringify(tarefas.map(t => t.tipo + ':' + t.id + (t.scheduleTime ? '@' + t.scheduleTime : ''))));
if (tarefas.some(t => t.tipo === 'inscricao_vigia')) {
  console.log('### worker inscricao_vigia', JSON.stringify(await ctrl('/dispatch', { tipo: 'inscricao_vigia' })));
  tarefas = await ctrl('/tasks'); console.log('### tarefas depois do vigia', JSON.stringify(tarefas.map(t => t.tipo + ':' + t.id + (t.scheduleTime ? '@' + t.scheduleTime : ''))));
}
const m = (await ctrl('/store?col=matriculaFila')).map(x => ({ key: x.key, insc_vigia: x.record.insc_vigia, recusados: x.record.docs_inscricao_recusados, ultimo_status: x.record.ultimo_status && { processo: x.record.ultimo_status.processo, etapas: x.record.ultimo_status.stages?.length }, vigia: x.record.vigia_proxima ?? x.record.vigias }));
console.log('### matriculaFila', JSON.stringify(m, null, 1));
const T2 = T + '-b';
r = await call('MATR_LOGIN', 'data_exchange', { acao: 'entrar', login: cpf, data_nascimento: nasc }, T2);
mostrar(`2º LOGIN ${quem} (V1: status salvo)`, r); lista(r);
