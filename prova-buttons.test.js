import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chooseProofButton,createProofRouter} from '../api/prova-route.js';
const buttons=[{button:10,label:'Iniciar prova'},{button:11,label:'Continuar Prova'},{button:12,label:'Refazer a minha prova'}];
const fields=status=>[{label:'Status da prova',value:status},{label:'Status da opção',value:'0'}];
test('dois botões, prova ainda sem status: seleciona iniciar',()=>assert.equal(chooseProofButton(buttons,fields(null)).button,10));
test('dois botões, iniciada: seleciona continuar',()=>assert.equal(chooseProofButton(buttons,fields('Iniciada')).button,11));
for(const status of ['Finalizada','Corrigida'])test(`não abre prova ${status}`,()=>assert.throws(()=>chooseProofButton(buttons,fields(status)),/PROVA_ENCERRADA/));
test('sem status e dois botões não adivinha',()=>assert.throws(()=>chooseProofButton(buttons,[]),/PROVA_STATUS/));
test('consulta complementar usa token atual e seleciona continuar sem alterar IDs',async()=>{
 let read=0,submit=0;
 const router=createProofRouter({api:async(path)=>({data:path.startsWith('/stages')?[{id:77,title:'Prova online'}]:[{id:78}]}),getForm:async()=>({token:'refreshed',data:{form:{content:{buttons,inputs:[]}}}}),readStatus:async(step,data)=>{read++;assert.equal(step,78);assert.equal(data.token,'refreshed');return fields('Iniciada')},submitForm:async(button,values,token)=>{submit++;assert.equal(button,11);assert.equal(token,'refreshed');return {data:{redirect:{link:'https://avaliacao.apprubeus.com.br/api/avaliacao/linkProva?unit=1'}}}}});
 await router.resolve({processo_seletivo_id:91001,token:'old',applyment_id:'unit'});assert.equal(read,1);assert.equal(submit,1);
});
