import {test} from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import handler,{sealState,workerHandler} from '../api/flow.js';

test('webhook criptografado atravessa fila, worker e Firestore sem duplicar submit',async()=>{
 const keys=crypto.generateKeyPairSync('rsa',{modulusLength:2048});
 process.env.FLOW_PRIVATE_KEY=keys.privateKey.export({type:'pkcs8',format:'pem'}).toString();
 process.env.META_APP_SECRET='unit-app-secret';process.env.RBS_TOKEN='unit-rbs';
 process.env.FLOW_PROJECT_ID='unit-project';process.env.FLOW_WORKER_ORIGIN='https://unit.run.app';
 const response=()=>({code:0,body:'',status(code){this.code=code;return this},send(body){this.body=body;return this},json(body){this.body=JSON.stringify(body);return this},setHeader(){}});
 const original=globalThis.fetch;const docs=new Map();let version=0,writes=0;
 globalThis.fetch=async(input,options={})=>{
  const url=new URL(String(input));
  if(url.hostname==='metadata.google.internal')return Response.json({access_token:'unit-google',expires_in:3600});
  if(url.hostname==='firestore.googleapis.com'){
   const id=url.searchParams.get('documentId')??url.pathname.split('/').at(-1);
   if(options.method==='POST'){
    if(docs.has(id))return Response.json({},{status:409});
    const doc={...JSON.parse(options.body),updateTime:String(++version)};docs.set(id,doc);return Response.json(doc);
   }
   if(options.method==='PATCH'){
    if(docs.get(id)?.updateTime!==url.searchParams.get('currentDocument.updateTime'))return Response.json({},{status:412});
    const doc={...JSON.parse(options.body),updateTime:String(++version)};docs.set(id,doc);return Response.json(doc);
   }
   return docs.has(id)?Response.json(docs.get(id)):Response.json({},{status:404});
  }
  if(url.hostname==='cloudtasks.googleapis.com'){
   const task=JSON.parse(options.body).task;
   const res=response();
   await workerHandler({body:JSON.parse(Buffer.from(task.httpRequest.body,'base64')),headers:{'x-flow-worker-signature':task.httpRequest.headers['X-Flow-Worker-Signature']}},res);
   assert.equal(res.code,204);return Response.json({name:task.name});
  }
  if(url.hostname==='admin.portal.apprbs.com.br'){
   assert.equal(url.pathname,'/api/v1/submit');writes++;
   return Response.json({success:true,data:{token:'unit-session',redirect:{applyment_id:12345}}});
  }
  throw Error('Unexpected host');
 };
 try{
  const trusted={token:'unit-session',applyment_id:'12345',processo_seletivo_id:'1',eh_nota_enem:false,button_id:'2',campo_cpf_id:'3',campo_nacionalidade_id:'4',campo_ensino_medio_id:'5',campo_deficiencia_id:'6',campo_origem_id:'7',origens:[{id:'05',title:'Indicação'}]};
  const request={version:'3.0',action:'data_exchange',screen:'QUASE_LA',flow_token:'unique-unit-flow',data:{acao:'enviar_informacoes_complementares',estado:sealState('QUASE_LA',trusted),cpf:'52998224725',nacionalidade:'10',concluiu_ensino_medio:'Sim',possui_deficiencia:'F',como_conheceu:'05'}};
  const aes=crypto.randomBytes(16),iv=crypto.randomBytes(16),cipher=crypto.createCipheriv('aes-128-gcm',aes,iv);
  const encrypted=Buffer.concat([cipher.update(JSON.stringify(request)),cipher.final(),cipher.getAuthTag()]);
  const body={encrypted_flow_data:encrypted.toString('base64'),encrypted_aes_key:crypto.publicEncrypt({key:keys.publicKey,padding:crypto.constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256'},aes).toString('base64'),initial_vector:iv.toString('base64')};
  const rawBody=Buffer.from(JSON.stringify(body));
  const signature='sha256='+crypto.createHmac('sha256',process.env.META_APP_SECRET).update(rawBody).digest('hex');
  for(let attempt=0;attempt<2;attempt++){
   const res=response();await handler({method:'POST',body,rawBody,headers:{'x-hub-signature-256':signature}},res);assert.equal(res.code,200);
   const bytes=Buffer.from(res.body,'base64'),dec=crypto.createDecipheriv('aes-128-gcm',aes,Buffer.from(iv.map(b=>b^255)));dec.setAuthTag(bytes.subarray(-16));
   const result=JSON.parse(Buffer.concat([dec.update(bytes.subarray(0,-16)),dec.final()]).toString());
   assert.equal(result.screen,'TELA_ORIENTACAO_PROVA');assert.equal(result.data.processando,false);
  }
  assert.equal(writes,1);
 }finally{globalThis.fetch=original}
});
