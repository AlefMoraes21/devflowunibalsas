import {test} from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {readFile} from 'node:fs/promises';
// 1.5.0: ESCOLHA_PROCESSO (texto da opção continuar) e exemplos do tema da redação foram alterados de propósito.
const baseline={"ESCOLHA_PROCESSO": "400a37a9d4caad441337545edfdc1907bf42d09727eb3044f7ce518cc53f4670", "DADOS_BASICOS": "25dba641655759240f3ec147bf4cae18c2922bc110e412254728b8a927ee5c56", "CURSO_INTERESSE": "3a1783a22f63179735436f1e5f10947379bf480e7a0eae31d7c2cc47c01ae01b", "DOCUMENTOS_ENEM": "637c74a1411bacb7ab5164669d2ab168beccc46758878565bb1f0e43e7463053", "QUASE_LA": "b7fdf4d3979eba0a42881171206aec7fe065f34bb5daced8a553e578c8b85a00", "TELA_ORIENTACAO_PROVA": "ce87f257f405f299b8bd3570fa6288f8763c2dea24eb86f23716da61ba2cff4d", "TELA_REDACAO": "30abb3a54158b7345fa32da25e225603a7a6c44e9f785fb4d4039f956ef923f3", "CONFIRMACAO": "9162100886ffea05d973bf765f5762f90ec10458260e83f82cc18eee8392b321", "PENDENTE": "80ac1b8d6657610da3768fe985d071db988980f52170bb5f9f09861b8db73b3e", "OPTIN_SCREEN_screen_dhaobf": "04f326d156eaf185a4a2d7c150dacf592b387d953f41706092178833e10b415c"};
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
