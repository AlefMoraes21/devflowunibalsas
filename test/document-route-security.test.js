import {test} from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {routeFlowRequest,flowContext,sealState,openState} from '../api/flow.js';

function mediaFixture(){
 const plain=Buffer.from('%PDF-1.4 teste');
 const key=crypto.randomBytes(32),hmac=crypto.randomBytes(32),iv=crypto.randomBytes(16);
 const cipher=crypto.createCipheriv('aes-256-cbc',key,iv);
 const ciphertext=Buffer.concat([cipher.update(plain),cipher.final()]);
 const mac=crypto.createHmac('sha256',hmac).update(Buffer.concat([iv,ciphertext])).digest().subarray(0,10);
 const bytes=Buffer.concat([ciphertext,mac]);
 return {bytes,media:[{file_name:'teste.pdf',cdn_url:'https://mmg.whatsapp.net/test',encryption_metadata:{
  encrypted_hash:crypto.createHash('sha256').update(bytes).digest('base64'),
  plaintext_hash:crypto.createHash('sha256').update(plain).digest('base64'),
  encryption_key:key.toString('base64'),hmac_key:hmac.toString('base64'),iv:iv.toString('base64')
 }}]};
}

for(const uncertain of [false,true])test(`rota usa CPF autenticado e trata retorno ${uncertain?'incerto':'confirmado'}`,async()=>{
 process.env.FLOW_PRIVATE_KEY='document-route-test';
 const fixture=mediaFixture(),previous=globalThis.fetch;let posts=0;
 globalThis.fetch=async(input,options={})=>{
  const u=new URL(String(input));
  if(u.hostname==='mmg.whatsapp.net')return new Response(fixture.bytes);
  if(u.pathname.startsWith('/blip/inscritos/')){
   assert.equal(u.pathname,'/blip/inscritos/225/11144477735');
   return Response.json({IDPS:'225',CPF:'11144477735',CODCOLIGADA:'1',NUMEROINSCRICAO:'77'});
  }
  if(u.pathname==='/rm/documents')return Response.json({resultado:[{CODDOCUMENTO:'28',DESCRICAO:'HISTÓRICO'}]});
  assert.equal(u.pathname,'/blip/documents');assert.equal(options.method,'POST');posts++;
  if(uncertain)throw new DOMException('timeout','TimeoutError');
  return Response.json({status:'ok',primaryKey:'1;225;77;28'});
 };
 try{
  const req={action:'data_exchange',screen:'DOCUMENTOS_INSCRICAO',flow_token:'unit',data:{
   acao:'enviar_documento',cpf:'52998224725',documento:'28',arquivo:fixture.media,
   estado:sealState('DOCUMENTOS_INSCRICAO',{cpf:'11144477735',processo_seletivo_id:'20385',applyment_id:'77',documentos:[{id:'28',descricao:'HISTÓRICO'}],processando:true,job_id:'old'})
  }};
  const result=await flowContext.run({request:req,write:null,deadline:Date.now()+60000},()=>routeFlowRequest(req));
  assert.equal(posts,1);
  if(uncertain){assert.equal(result.screen,'PENDENTE');assert.match(result.data.mensagem,/antes de enviar novamente/)}
  else{
   assert.equal(result.data.processando,false);assert.equal(result.data.job_id,'');assert.equal(result.data.acao_rodape,'enviar_documento');
   assert.match(result.data.enviados,/Aguardando conferência/);
   assert.equal(openState(result.data.estado,result.screen).arquivo,undefined);
  }
 }finally{globalThis.fetch=previous}
});
