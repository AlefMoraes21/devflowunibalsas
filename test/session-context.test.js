import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createAssessment} from '../api/avaliacao.js';
test('preserva cookie de linkProva e rotações até consulta',async()=>{
 let n=0;
 const client=createAssessment({fetcher:async(url,options)=>{
  n++;
  if(n===1)return new Response(null,{status:302,headers:{location:'https://avaliacao.apprubeus.com.br/execucao/inicio/key/4/5/ABCDEF1234/','set-cookie':'lumen_session=link; Path=/'}});
  if(n===2){assert.equal(options.headers.Cookie,'lumen_session=link');return Response.json({success:true,data:{}},{headers:{'set-cookie':'lumen_session=config; Path=/'}})}
  if(n===3){assert.equal(options.headers.Cookie,'lumen_session=config');return Response.json({success:true,data:{token:'unit'}},{headers:{'set-cookie':'lumen_session=create; Path=/'}})}
  assert.equal(options.headers.Cookie,'lumen_session=create');return Response.json({success:true,data:{id:1,avaliacao_id:2,crm_id:3,crm_contato_id:4,crm_curso_id:5,IDEXECPROVA:'ABCDEF1234',finalizada:0,tempoRestante:120,questoes:[{id:6}]}},{headers:{'set-cookie':'lumen_session=consulta; Path=/'}});
 }});
 const session=await client.init('https://avaliacao.apprubeus.com.br/api/avaliacao/linkProva');assert.equal(session.cookie,'lumen_session=consulta');
});
test('código numérico é codUsuarioPS, como no cliente publicado do site',async()=>{
 const client=createAssessment({fetcher:async(url,options)=>{
  if(url.includes('linkProva'))return new Response(null,{status:302,headers:{location:'https://avaliacao.apprubeus.com.br/execucao/inicio/key/4/5/12345/'}});
  if(url.includes('/consulta/'))return Response.json({success:true,data:{id:1,avaliacao_id:2,crm_id:3,crm_contato_id:4,crm_curso_id:5,codUsuarioPS:'12345',IDEXECPROVA:null,finalizada:0,tempoRestante:120,questoes:[{id:6}]}});
  const body=JSON.parse(options.body);assert.equal(body.IDEXECPROVA,null);assert.equal(body.codUsuarioPS,'12345');return Response.json({success:true,data:{token:'unit'}});
 }});
 const session=await client.init('https://avaliacao.apprubeus.com.br/api/avaliacao/linkProva');assert.equal(session.params.codUsuarioPS,'12345');
});
