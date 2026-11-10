import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
process.env.FLOW_PRIVATE_KEY??='local-unit-key';
const {responseForScreen,openState}=await import('../api/flow.js');
const {createMatricula,documentProgress}=await import('../api/matricula.js');

// Transferência (20385): o portal só passa de "Pendentes" para "Em análise" com os 3 documentos enviados.
const DOCS=[{id:'28',title:'HISTÓRICO ACADÊMICO',descricao:'HISTÓRICO ACADÊMICO'},{id:'29',title:'PLANOS DE ENSINO (EMENTAS)',descricao:'PLANOS DE ENSINO (EMENTAS)'},{id:'30',title:'DECLARAÇÃO DE VINCULO ACADÊMI',descricao:'DECLARAÇÃO DE VINCULO ACADÊMICO'}];

function setup(){
 const saved=[];
 const docs={listDocuments:async()=>DOCS,saveDocument:async a=>{saved.push(a.codDocumento);return {nomeArquivo:'teste.pdf'}}};
 const m=createMatricula({api:async()=>({}),getForm:async()=>({data:{form:{id:1,content:{inputs:[],buttons:[]}}}}),submitForm:async()=>({}),getDataSource:async()=>({}),render:responseForScreen,academicId:()=>226,docs});
 return {m,saved};
}
const send=(m,res,id)=>m.sendDocument({...openState(res.data.estado,'DOCUMENTOS_INSCRICAO'),documento:id,arquivo:[{file_name:'x.pdf'}]});

test('abertura: 0 de 3, sem concluir, rodapé de envio',async()=>{
 const {m}=setup();
 const r=await m.open({cpf:'11144477735',processo_seletivo_id:'20385',token:'t'},{step:300696,title:'Documentos inscrição'});
 assert.equal(r.data.concluido,false);
 assert.match(r.data.progresso,/^0 de 3 documentos enviados\. Falta: HISTÓRICO ACADÊMICO, PLANOS DE ENSINO \(EMENTAS\), DECLARAÇÃO DE VINCULO ACADÊMICO\.$/);
 assert.equal(r.data.acao_rodape,'enviar_documento');
 assert.match(r.data.texto,/os 3 forem enviados/);
});

test('envio progressivo 1/3, 2/3, 3/3: só conclui com todos e o rodapé vira Atualizar situação',async()=>{
 const {m,saved}=setup();
 let r=await m.open({cpf:'11144477735',processo_seletivo_id:'20385',token:'t'},{step:300696,title:'Documentos inscrição'});
 r=await send(m,r,'28');
 assert.equal(r.data.concluido,false);assert.match(r.data.progresso,/^1 de 3 documentos enviados\. Falta: PLANOS DE ENSINO/);
 assert.equal(r.data.acao_rodape,'enviar_documento');assert.equal(r.data.rotulo_rodape,'Enviar documento');
 r=await send(m,r,'29');
 assert.equal(r.data.concluido,false);assert.match(r.data.progresso,/^2 de 3 .* Falta: DECLARAÇÃO DE VINCULO ACADÊMICO\.$/);
 r=await send(m,r,'30');
 assert.equal(r.data.concluido,true);assert.match(r.data.progresso,/Todos os 3 documentos solicitados foram enviados/);
 assert.equal(r.data.acao_rodape,'atualizar_portal');assert.equal(r.data.rotulo_rodape,'Atualizar situação');
 assert.deepEqual(saved,['28','29','30']);
 assert.deepEqual(openState(r.data.estado,'DOCUMENTOS_INSCRICAO').docs_enviados,['28','29','30']);
 assert.ok(!JSON.stringify(r).includes('"descricao"'));
});

test('reenvio do mesmo documento é atualização e não conta duas vezes',async()=>{
 const {m}=setup();
 let r=await m.open({cpf:'11144477735',processo_seletivo_id:'20385',token:'t'},{step:300696,title:'Documentos inscrição'});
 r=await send(m,r,'28');r=await send(m,r,'28');
 assert.match(r.data.progresso,/^1 de 3/);assert.match(r.data.enviados,/atualizado/);assert.equal(r.data.concluido,false);
});

test('documentProgress ignora ids fora da lista e lista vazia nunca conclui',()=>{
 assert.equal(documentProgress(DOCS,['28','999']).docs_enviados.length,1);
 assert.equal(documentProgress([],[]).concluido,false);
 assert.equal(documentProgress(DOCS,['28','29','30']).concluido,true);
});

test('JSON do Flow: três estados exclusivos e sem Dropdown/Picker na tela concluída',async()=>{
 const j=JSON.parse(await readFile(new URL('../flow-waba.json',import.meta.url)));
 const s=j.screens.find(x=>x.id==='DOCUMENTOS_INSCRICAO');
 assert.equal(s.data.concluido.type,'boolean');assert.equal(s.data.progresso.type,'string');
 const ifs=s.layout.children.filter(c=>c.type==='If');
 assert.deepEqual(ifs.map(i=>i.condition),['${data.processando} == false && ${data.concluido} == false','${data.processando} == false && ${data.concluido} == true','${data.processando} == true']);
 const types=i=>JSON.stringify(i.then);
 assert.ok(types(ifs[0]).includes('"Dropdown"')&&types(ifs[0]).includes('"DocumentPicker"'));
 assert.ok(!types(ifs[1]).includes('"Dropdown"')&&!types(ifs[1]).includes('"DocumentPicker"'));
 assert.equal(s.layout.children.filter(c=>c.type==='Footer').length,1);
 // limites de arquivo preservados
 const picker=JSON.parse(types(ifs[0])).find(c=>c.type==='DocumentPicker');
 assert.equal(picker['max-file-size-kb'],740);assert.deepEqual(picker['allowed-mime-types'],['application/pdf','image/jpeg','image/png']);
});
