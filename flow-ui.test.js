import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
test('as três telas lentas mantêm consulta dinâmica na mesma tela',async()=>{
 const json=JSON.parse(await readFile(new URL('../flow-waba.json',import.meta.url)));
 for(const id of ['QUASE_LA','TELA_ORIENTACAO_PROVA','TELA_REDACAO']){
  const screen=json.screens.find(s=>s.id===id);assert.notEqual(screen.terminal,true);
  assert.equal(screen.data.processando.type,'boolean');assert.equal(screen.data.acao_rodape.type,'string');
  const form=screen.layout.children[0],footer=form.children.find(x=>x.type==='Footer');
  assert.equal(footer['on-click-action'].name,'data_exchange');assert.equal(footer['on-click-action'].payload.acao,'${data.acao_rodape}');
  assert.ok(JSON.stringify(form).includes('${data.mensagem_processamento}'));assert.ok(!JSON.stringify(form).includes('"name":"complete"'));
 }
});
