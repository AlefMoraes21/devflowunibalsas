// Cenário etapa final (Rebeca/Rosa/Juan): LOGIN → lista (Pagamento sem botão, Recebido → aguardando equipe) →
// toque no Pagamento/Matriculado → vigia etapa4 (sem Blip: não gera cobrança) → 2º LOGIN rápido (status guardado).
import { call, mostrar, ctrl } from './lib.mjs';
const pessoas = { juan: ['972.402.321-40', '1980-11-14'], rosa: ['393.726.675-52', '1983-04-27'], rebeca: ['999.456.334-30', '1959-04-13'] };
const quem = process.argv[2] ?? 'rebeca';
const [cpf, nasc] = pessoas[quem];
const lista = r => { for (const it of r.data?.etapas ?? []) console.log(`  · ${it['main-content'].title} — ${it['main-content'].metadata}${it.end ? ' [' + it.end.title + ']' : ''}`); return r.data?.etapas ?? []; };
const T = 'verify-final-' + quem + '-' + Date.now();
let t0 = Date.now();
let r = await call('MATR_LOGIN', 'data_exchange', { acao: 'entrar', login: cpf, data_nascimento: nasc }, T);
console.log(`### LOGIN ${quem}: ${r.screen} em ${Date.now() - t0} ms`); lista(r);
if (r.screen === 'MATR_PORTAL' && r.data.botao === 'Atualizar') {
  await ctrl('/dispatch', { tipo: 'etapa2_status' });
  r = await call('MATR_PORTAL', 'data_exchange', { acao: 'continuar', estado: r.data.estado }, T);
  console.log('### Atualizar:', r.screen); lista(r);
}
for (const re of [/pagamento/i, /matriculad/i]) {
  const alvo = (r.data?.etapas ?? []).find(i => re.test(i['main-content'].title));
  if (!alvo) continue;
  const r2 = await call('MATR_STATUS', 'data_exchange', alvo['on-click-action'].payload, T);
  console.log(`### toque em "${alvo['main-content'].title}":`, r2.screen, JSON.stringify(r2.data?.titulo ?? ''), JSON.stringify(r2.data?.mensagem ?? ''));
}
let tarefas = await ctrl('/tasks'); console.log('### tarefas', JSON.stringify(tarefas.map(t => t.tipo)));
if (tarefas.some(t => t.tipo === 'etapa4_vigia')) console.log('### etapa4_vigia', JSON.stringify(await ctrl('/dispatch', { tipo: 'etapa4_vigia' })));
const m = (await ctrl('/store?col=matriculaFila')).map(x => ({ final_vigiando: !!x.record.final_vigiando, pagamento_liberado_em: x.record.pagamento_liberado_em ?? null, pagamento_recebido_em: x.record.pagamento_recebido_em ?? null, status: x.record.status }));
console.log('### fila', JSON.stringify(m));
t0 = Date.now();
r = await call('MATR_LOGIN', 'data_exchange', { acao: 'entrar', login: cpf, data_nascimento: nasc }, T + '-b');
console.log(`### 2º LOGIN ${quem}: ${r.screen} em ${Date.now() - t0} ms`); lista(r);
