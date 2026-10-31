import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createAssessment,ResultadoIncerto} from '../api/avaliacao.js';
const exam={id:101,avaliacao_id:2,crm_id:3,crm_contato_id:4,crm_curso_id:5,IDEXECPROVA:'test',finalizada:0,tempoRestante:120,nome:'Redação',questoes:[{id:6,enunciado:'Tema'}]};
const session=()=>({exam,token:'test-only',cookie:'lumen_session=test-only',startedAt:Date.now(),deadline:Date.now()+60000});
test('envio usa a execução atual, cookie e finalização única',async()=>{
 let calls=0;
 const client=createAssessment({fetcher:async(url,options)=>{
  calls++;assert.match(url,/salve/);assert.equal(options.headers.Cookie,'lumen_session=test-only');
  const p=JSON.parse(options.body);assert.equal(p.id,101);assert.equal(p.finalizada,1);assert.equal(p.questoes[0].questao_id,6);assert.ok(p.tempoUsado<1);
  return Response.json({success:true,data:{id:101,finalizada:1,data_envio:'2026-10-31 10:00:00'}});
 }});
 await client.send(session(),'Minha redação');assert.equal(calls,1);
});
for(const [name,response]of Object.entries({rascunho:{success:true,data:{id:101,finalizada:0}},semData:{success:true,data:{id:101,finalizada:1}},outraExecucao:{success:true,data:{id:999,finalizada:1,data_envio:'today'}},falha:{success:false}})){
 test(`não confirma ${name} nem reenvia como rascunho`,async()=>{
  let n=0;const client=createAssessment({fetcher:async()=>{n++;return Response.json(response)}});
  await assert.rejects(client.send(session(),'Texto'),ResultadoIncerto);assert.equal(n,1);
 });
}
test('falha de rede tem resultado incerto, sem segunda gravação',async()=>{
 let n=0;const client=createAssessment({fetcher:async()=>{n++;throw new Error('network')}});
 await assert.rejects(client.send(session(),'Texto'),ResultadoIncerto);assert.equal(n,1);
});
test('prazo expirado não grava',async()=>{
 let n=0;const client=createAssessment({fetcher:async()=>{n++}});
 await assert.rejects(client.send({...session(),deadline:0},'Texto'),/prazo/);assert.equal(n,0);
});
test('inicialização preserva cookie entre configuração, create e consulta',async()=>{
 let n=0;const client=createAssessment({fetcher:async(url,opts)=>{
  n++;
  if(n===1)return new Response(null,{status:302,headers:{location:'https://avaliacao.apprubeus.com.br/execucao/inicio/key/4/5/test/'}});
  if(n===2)return Response.json({success:true,data:{}},{headers:{'set-cookie':'lumen_session=unit; Path=/; HttpOnly'}});
  assert.equal(opts.headers.Cookie,'lumen_session=unit');
  if(n===3)return Response.json({success:true,data:{token:'unit'}});
  return Response.json({success:true,data:exam});
 }});
 const s=await client.init('https://avaliacao.apprubeus.com.br/api/avaliacao/linkProva?chave=unit');assert.equal(s.exam.id,101);assert.equal(n,4);
});
