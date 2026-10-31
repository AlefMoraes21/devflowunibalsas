import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createProofRouter} from '../api/prova-route.js';
test('descobre etapa/passo sem login/portal e usa o token de cada candidato',async()=>{
 const calls=[];let reads=0;
 const router=createProofRouter({api:async(path)=>{calls.push(path);reads++;return {data:path.startsWith('/stages')?[{id:12,title:'Prova online'}]:[{id:13,name:'Passo 1'}]}},getForm:async(step,local,token)=>{assert.equal(step,13);assert.equal(local,'step');calls.push(token);return {data:{form:{content:{buttons:[{label:' Iniciar prova ',button:14}]}}}}},submitForm:async(button,fields,token)=>{assert.equal(button,14);assert.deepEqual(fields,[]);return {data:{redirect:{link:'https://avaliacao.apprubeus.com.br/api/avaliacao/linkProva?unit='+token}}}}});
 assert.match(await router.resolve({processo_seletivo_id:90001,applyment_id:'a',token:'candidate-a'}),/candidate-a$/);
 assert.match(await router.resolve({processo_seletivo_id:90001,applyment_id:'b',token:'candidate-b'}),/candidate-b$/);
 assert.equal(reads,2);assert.ok(calls.includes('candidate-b'));assert.ok(!calls.some(x=>x.includes('login/portal')));
});
test('etapa ambígua não abre nem submete uma prova arbitrária',async()=>{
 let writes=0;const router=createProofRouter({api:async()=>({data:[{id:1,title:'Prova A'},{id:2,title:'Prova B'}]}),getForm:async()=>{throw Error('should not call')},submitForm:async()=>{writes++}});
 await assert.rejects(router.resolve({processo_seletivo_id:90002,applyment_id:'a',token:'a'}),/PROVA_ETAPA/);assert.equal(writes,0);
});
test('HTML inesperado gera erro com caminho e status, sem incluir conteúdo da página',async()=>{
 const {routeFlowRequest,flowContext,sealState}=await import('../api/flow.js');
 process.env.FLOW_PRIVATE_KEY='unit';process.env.RBS_TOKEN='unit';
 const original=globalThis.fetch;globalThis.fetch=async()=>new Response('<!DOCTYPE html><p>private content</p>',{status:404,headers:{'content-type':'text/html'}});
 try{
  const req={action:'data_exchange',screen:'TELA_ORIENTACAO_PROVA',data:{acao:'iniciar_redacao',estado:sealState('TELA_ORIENTACAO_PROVA',{processo_seletivo_id:90003,applyment_id:'a',token:'a'})}};
  const result=await flowContext.run({request:req,deadline:Date.now()+8500,write:null},()=>routeFlowRequest(req));
  assert.match(result.data.erro,/stages.*HTTP 404/);assert.ok(!result.data.erro.includes('private content'));
 }finally{globalThis.fetch=original}
});
