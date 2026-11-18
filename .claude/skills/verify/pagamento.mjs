// Cenário pagamento (2.16): LOGIN → vigia final (lê o valor, avisa "pagamento liberado") → Pagamento abre a tela
// MATR_PAGAMENTO (valor + "Realizar pagamento") → toque → "Mensagem a caminho" + etapa4_vigia agendado.
// NÃO despacha o vigia (ele geraria um Pix real no portal). Blip: servidor falso local na 8098.
import { call, ctrl } from './lib.mjs';
const pessoas = { rosa: ['393.726.675-52', '1983-04-27'], rebeca: ['999.456.334-30', '1959-04-13'], juan: ['972.402.321-40', '1980-11-14'] };
const quem = process.argv[2] ?? 'rosa';
const [cpf, nasc] = pessoas[quem];
// Blip falso local (servidor em 8098) e só o número de teste da pessoa na lista.
await ctrl('/env', { BLIP_API_URL: process.env.BLIP_FALSO ?? 'http://127.0.0.1:8098', BLIP_BOT_KEY: 'falsa', AVISOS_SO_PARA: process.env.SO_PARA ?? '' });
const T = 'verify-pag-' + quem + '-' + Date.now();
const entrar = async () => { const t0 = Date.now(); const r = await call('MATR_LOGIN', 'data_exchange', { acao: 'entrar', login: cpf, data_nascimento: nasc }, T); console.log(`### LOGIN ${quem}: ${r.screen} ${Date.now() - t0} ms`, r.problemas?.length ? r.problemas : ''); return r; };
let r = await entrar();
if (r.screen === 'MATR_PORTAL' && r.data.botao === 'Atualizar') { await ctrl('/dispatch', { tipo: 'etapa2_status' }); r = await call('MATR_PORTAL', 'data_exchange', { acao: 'continuar', estado: r.data.estado }, T); }
for (const it of r.data?.etapas ?? []) console.log(`  · ${it['main-content'].title} — ${it['main-content'].metadata}${it.end ? ' [' + it.end.title + ']' : ''}`);
const tarefas = await ctrl('/tasks'); console.log('### tarefas', JSON.stringify(tarefas.map(t => t.tipo)));
// NUNCA despachar o etapa4_vigia aqui: com um pedido de cobrança na fila ele clica no botão Pix do portal REAL
// (em 18/11 isso aconteceu com a Rosa; o portal recusou e nenhum Pix foi gerado). O vigia é testado em npm test.
const fila = async () => (await ctrl('/store?col=matriculaFila')).map(x => ({ centavos: x.record.cobranca_centavos ?? null, pedida: !!x.record.cobranca_pedida_em, enviada: !!x.record.cobranca_enviada_em, avisos: Object.keys(x.record.avisos ?? {}) }));
console.log('### fila', JSON.stringify(await fila()));
const alvo = (r.data?.etapas ?? []).find(i => /pagamento/i.test(i['main-content'].title));
let t0 = Date.now();
const pag = await call('MATR_STATUS', 'data_exchange', alvo['on-click-action'].payload, T);
console.log(`### toque em Pagamento: ${pag.screen} ${Date.now() - t0} ms`, pag.problemas?.length ? pag.problemas : '', JSON.stringify({ valor: pag.data?.valor, botao: pag.data?.botao, mensagem: pag.data?.mensagem ?? pag.data?.titulo }));
if (pag.screen !== 'MATR_PAGAMENTO') process.exit(0);
const antes = (await ctrl('/tasks')).length;
t0 = Date.now();
const ok = await call('MATR_PAGAMENTO', 'data_exchange', { acao: 'pagar', estado: pag.data.estado }, T);
console.log(`### toque em "${pag.data.botao}": ${ok.screen} ${Date.now() - t0} ms`, JSON.stringify({ titulo: ok.data?.titulo, mensagem: ok.data?.mensagem }));
const depois = await ctrl('/tasks'); console.log('### tarefas novas', JSON.stringify(depois.slice(antes).map(t => t.tipo)), '(não despachadas)');
console.log('### fila', JSON.stringify(await fila()));
