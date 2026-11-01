import {test} from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {readFile} from 'node:fs/promises';
const baseline={"ESCOLHA_PROCESSO": "ad8d5596d9c83995aaf6148d82b9ae0f9e5d07322d28706d4c2c8c0a9d1498a6", "DADOS_BASICOS": "25dba641655759240f3ec147bf4cae18c2922bc110e412254728b8a927ee5c56", "CURSO_INTERESSE": "3a1783a22f63179735436f1e5f10947379bf480e7a0eae31d7c2cc47c01ae01b", "DOCUMENTOS_ENEM": "637c74a1411bacb7ab5164669d2ab168beccc46758878565bb1f0e43e7463053", "QUASE_LA": "b7fdf4d3979eba0a42881171206aec7fe065f34bb5daced8a553e578c8b85a00", "TELA_ORIENTACAO_PROVA": "82bdd5d7472d928c9bf8e7fcd242be50cbfab0065bb520f0353c45315855710d", "TELA_REDACAO": "a47360bcb8474873f4eb39f86c823679d7bb60cc214ab2f5f451cdf03d0747cf", "CONFIRMACAO": "9162100886ffea05d973bf765f5762f90ec10458260e83f82cc18eee8392b321", "PENDENTE": "80ac1b8d6657610da3768fe985d071db988980f52170bb5f9f09861b8db73b3e", "OPTIN_SCREEN_screen_dhaobf": "04f326d156eaf185a4a2d7c150dacf592b387d953f41706092178833e10b415c"};
test('telas existentes do GitHub permanecem idênticas e a tela ENEM tem média editável e consulta dinâmica',async()=>{
 const flow=JSON.parse(await readFile(new URL('../flow-waba.json',import.meta.url)));
 for(const [id,hash] of Object.entries(baseline)){
  const screen=flow.screens.find(s=>s.id===id);assert.ok(screen,id);
  assert.equal(crypto.createHash('sha256').update(JSON.stringify(screen)).digest('hex'),hash,id);
 }
 const screen=flow.screens.find(s=>s.id==='CURSO_ENEM');assert.equal(screen.terminal,false);
 const all=[];function walk(x){if(Array.isArray(x))x.forEach(walk);else if(x&&typeof x==='object'){if(x.type)all.push(x);for(const v of Object.values(x))if(v&&typeof v==='object')walk(v)}}walk(screen.layout);
 assert.ok(all.find(x=>x.name==='media_enem'&&x.type==='TextInput'&&x.enabled!==false));
 assert.ok(all.find(x=>x.type==='EmbeddedLink'&&x['on-click-action']?.payload?.acao==='calcular_media'));
 assert.ok(all.find(x=>x.type==='Footer'&&x['on-click-action']?.payload?.acao==='${data.acao_rodape}'));
 assert.ok(!flow.routing_model.CURSO_ENEM.includes('DOCUMENTOS_ENEM'));
 for(const destinations of Object.values(flow.routing_model))for(const id of destinations)assert.ok(flow.screens.some(s=>s.id===id),id);
});
