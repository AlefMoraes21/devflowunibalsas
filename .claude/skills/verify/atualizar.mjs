// "Atualizar" no 1º LOGIN (sem status salvo): a fila roda a leitura do portal logo após o login (como o Cloud
// Tasks faria) e o candidato toca em Atualizar ~2 s depois. Esperado: um toque abre a lista.
import { call, mostrar, ctrl } from './lib.mjs';
const pessoas = { juan: ['972.402.321-40', '1980-11-14'], rosa: ['393.726.675-52', '1983-04-27'], rebeca: ['999.456.334-30', '1959-04-13'] };
const [cpf, nasc] = pessoas[process.argv[2] ?? 'rosa'];
const T = 'verify-atualizar-' + Date.now();
const r = await call('MATR_LOGIN', 'data_exchange', { acao: 'entrar', login: cpf, data_nascimento: nasc }, T);
mostrar('LOGIN', r);
if (r.screen !== 'MATR_PORTAL') process.exit(0);
const fundo = ctrl('/dispatch', { tipo: 'etapa2_status' });
await new Promise(res => setTimeout(res, 2000));
const t = await call('MATR_PORTAL', 'data_exchange', { acao: 'continuar', estado: r.data.estado }, T);
mostrar('1 toque em Atualizar (2 s depois do LOGIN)', t);
for (const it of t.data?.etapas ?? []) console.log(`  · ${it['main-content'].title} — ${it['main-content'].metadata}${it.start?.image ? ' (ícone)' : ''}`);
console.log('### leitura em segundo plano', JSON.stringify(await fundo));
