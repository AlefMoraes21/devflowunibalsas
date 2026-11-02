import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
test('nova tela de ingresso tem consulta dinâmica e não encaminha para redação',async()=>{
 const j=JSON.parse(await readFile(new URL('../flow-waba.json',import.meta.url)));
 const screen=j.screens.find(s=>s.id==='CURSO_INGRESSO');assert.equal(screen.terminal,false);
 assert.equal(screen.data.processando.type,'boolean');
 const f=screen.layout.children[0];assert.equal(f.children.at(-1)['on-click-action'].payload.acao,'${data.acao_rodape}');
 assert.deepEqual(j.routing_model.CURSO_INGRESSO,['QUASE_LA','PENDENTE']);assert.ok(j.routing_model.DADOS_BASICOS.includes('CURSO_INGRESSO'));
 assert.ok(j.screens.some(s=>s.id==='CURSO_ENEM'));
});
