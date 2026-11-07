import {test} from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {routeFlowRequest,flowContext,sealState,openState} from '../api/flow.js';
import {createJobEngine} from '../api/jobs.js';
import {workerSignature} from '../api/cloud-store.js';

const names=['Carteira de identidade','CPF','Histórico ensino médio','Certificado de conclusão','Comprovante de residência','Responsável financeiro','Declaração de conclusão'];
function rawStep(documents){return {success:true,data:{process_id:'20383',stage:{id:321},steps:{currentStep:{id:7777,stage_id:321,applicantData:[],content:[
 {id:801,key:'upload-dinamico',component_type_id:6,form_build:JSON.stringify({type:'container'}),container_content:[
  {id:802,key:'arquivos-dinamicos',type:'upload',form_build:JSON.stringify({type:'upload',input:true}),upload_content:structuredClone(documents),block_attaching_reject_files:0},
  {id:803,key:'enviar-dinamico',type:'button',store_data:true,related_component_id:802,form_build:JSON.stringify({type:'button',label:'ENVIAR'})}
 ]}
]}}}};}
function encrypted(bytes,name='matricula.pdf'){
 const key=crypto.randomBytes(32),hmac=crypto.randomBytes(32),iv=crypto.randomBytes(16),cipher=crypto.createCipheriv('aes-256-cbc',key,iv);
 const content=Buffer.concat([cipher.update(bytes),cipher.final()]);
 const mac=crypto.createHmac('sha256',hmac).update(Buffer.concat([iv,content])).digest().subarray(0,10),cdn=Buffer.concat([content,mac]);
 return {cdn,media:[{file_name:name,media_id:'synthetic-media-'+name,cdn_url:'https://mmg.whatsapp.net/synthetic',encryption_metadata:{
  encryption_key:key.toString('base64'),hmac_key:hmac.toString('base64'),iv:iv.toString('base64'),
  encrypted_hash:crypto.createHash('sha256').update(cdn).digest('base64'),plaintext_hash:crypto.createHash('sha256').update(bytes).digest('base64')
 }}]};
}
function fixture({mode='confirmed',bytes=Buffer.concat([Buffer.from('%PDF-1.4 '),Buffer.alloc(900*1024)])}={}){
 const state={posts:0,settings:0,analysis:false,mode,db:new Map(),cdn:encrypted(bytes),documents:names.map((name,i)=>({CODTIPODOCUMENTO:String(501+i),DESCRICAODOCUMENTO:name,CHAVERM:'synthetic-key-'+i,OBRIGATORIO:[2,3,6].includes(i)?1:0,STATUSENVIO:null,FILES:[],PATHARQUIVO:null}))};
 const identity={person_id:81,applyment_id:71,cpf:'11144477735'};
 const fetcher=async(input,options={})=>{
  const u=new URL(String(input));
  if(u.hostname==='metadata.google.internal')return Response.json({access_token:'synthetic-google',expires_in:3600});
  if(u.hostname==='firestore.googleapis.com'){
   const key=options.method==='POST'?u.pathname+'/'+u.searchParams.get('documentId'):u.pathname;
   const found=state.db.get(key);
   if(!options.method||options.method==='GET')return found?Response.json(found):Response.json({}, {status:404});
   if(options.method==='POST'&&found)return Response.json({}, {status:409});
   if(options.method==='PATCH'&&(!found||found.updateTime!==u.searchParams.get('currentDocument.updateTime')))return Response.json({}, {status:412});
   const saved={...JSON.parse(options.body),updateTime:'v'+(Number(found?.updateTime?.slice(1)||0)+1)};state.db.set(key,saved);return Response.json(saved);
  }
  if(u.hostname==='mmg.whatsapp.net')return new Response(state.cdn.cdn);
  if(u.hostname==='admin.portal.apprbs.com.br'){
   if(u.pathname.endsWith('/login/info'))return Response.json({success:true,data:[{key:'LOGIN',type:'text'},{key:'DATANASCIMENTO',type:'date'}]});
   if(u.pathname.endsWith('/login'))return Response.json({success:true,data:{...identity,token:'official-token'}});
   if(u.pathname.endsWith('/portal'))return Response.json({success:true,data:{current_process:{id:20383,stages:[
    {title:'Documentos matrícula',feedback:{conclusive:0,complementary_text:state.analysis?'Em análise':'Pendentes',cta_text:state.analysis?null:'Verificar'},cta_link:state.analysis?null:'presencial/passo/7777'},
    {title:'Contrato',feedback:{conclusive:0,complementary_text:'Aguardando documentação'},cta_link:null}
   ]}}});
  }
  if(u.hostname==='vestibular.unibalsas.edu.br'){
   const endpoint=u.pathname.split('/api/applyment/')[1],body=options.body instanceof FormData?options.body:JSON.parse(options.body);
   if(endpoint==='settings/'){state.settings++;return Response.json({success:true,data:{token:'portal-token-'+state.settings}})}
   if(endpoint==='login-info')return Response.json({success:true,data:{fields:[{type:'text',formControlName:'typeLogin',label:'CPF'},{type:'date',formControlName:'dataNascimento'}]}});
   if(endpoint==='login-portal'){assert.equal(body.user_data.typeLogin,'11144477735');assert.equal(body.user_data.dataNascimento,'02/01/2000');return Response.json({success:true,data:{...identity,selective_process_id:20383,session_id:'separate-session'}})}
   if(endpoint==='check-login')return Response.json({success:true,data:{...identity,selective_process_id:20383}});
   if(endpoint==='getApplymentDataByStep/7777')return Response.json(rawStep(state.documents));
   if(endpoint==='button-click'){
    state.posts++;assert.ok(body instanceof FormData);assert.equal(body.get('button_id'),'803');assert.equal(body.get('substitute_id'),'null');
    const values=JSON.parse(body.get('data')).find(d=>d.type==='upload').value;assert.equal(values.length,7);
    const selected=values.filter(d=>d.value!==null);assert.equal(selected.length,1);assert.deepEqual(selected[0].value,['file_0']);
    const file=body.get('file_0');assert.equal(file.size,bytes.length,'binary is not Base64 or limited to 740KiB');
    const doc=state.documents.find(d=>String(d.CODTIPODOCUMENTO)===String(selected[0].CODIGO));
    if(state.mode!=='unconfirmed'){doc.STATUSENVIO='1';doc.FILES=[{name:file.name,link:'https://example.invalid/receipt/'+state.posts}];doc.PATHARQUIVO='receipt-'+state.posts;state.analysis=true}
    if(state.mode==='lost-response')throw new DOMException('synthetic timeout','TimeoutError');
    return Response.json({success:true,data:{same_place:true}});
   }
  }
  throw new Error('Unexpected mocked request: '+u.origin+u.pathname);
 };
 return {...state,fetcher,state};
}
const ask=(screen,acao,estado,user={})=>({screen,action:'data_exchange',flow_token:'synthetic-flow',data:{acao,estado,...user}});
async function run(request){const req=structuredClone(request);return flowContext.run({request:req,worker:true,write:null,deadline:Date.now()+120000},()=>routeFlowRequest(req));}
async function enter(){
 const welcome=await run(ask('ESCOLHA_PROCESSO','selecionar_processo',sealState('ESCOLHA_PROCESSO',{}),{modo:'continuar',login:'11144477735',data_nascimento:'2000-01-02'}));
 assert.equal(welcome.screen,'PORTAL_STATUS');assert.ok(openState(welcome.data.estado,welcome.screen).portal_session);
 const hub=await run(ask(welcome.screen,'carregar_jornada',welcome.data.estado));
 return run(ask(hub.screen,'continuar_etapa',hub.data.estado));
}
function setup(){process.env.FLOW_PRIVATE_KEY='native-flow-synthetic-key';process.env.RBS_TOKEN='unit';process.env.FLOW_PROJECT_ID='synthetic-project';}

test('native enrollment journey uploads >740KiB, confirms portal receipt, resumes and follows rejection',async()=>{
 setup();const f=fixture(),previous=globalThis.fetch;globalThis.fetch=f.fetcher;
 try{
  const docs=await enter();assert.equal(docs.screen,'DOCUMENTOS_MATRICULA');assert.equal(docs.data.documentos.length,7);assert.equal(docs.data.tem_pendentes,true);
  const req=ask(docs.screen,'enviar_documento_matricula',docs.data.estado,{documento:'501',arquivo:f.state.cdn.media,cpf:'52998224725'});
  const sent=await run(req);assert.equal(sent.screen,'DOCUMENTOS_MATRICULA');assert.equal(f.state.posts,1);assert.equal(sent.data.tem_erro,false);assert.match(sent.data.documentos_resumo,/Carteira de identidade: Em análise/);
  assert.equal(sent.data.documentos.some(d=>d.id==='501'),false);assert.equal(openState(sent.data.estado,sent.screen).arquivo,undefined);
  assert.ok(!JSON.stringify(openState(sent.data.estado,sent.screen)).includes('encryption_key'));
  await run(req);assert.equal(f.state.posts,1,'stale state does not overwrite a document in review');
  const resumed=await enter();assert.equal(resumed.screen,'DOCUMENTOS_MATRICULA');assert.match(resumed.data.documentos_resumo,/Em análise/);
  f.state.documents[0].STATUSENVIO='2';f.state.documents[0].MOTIVORECUSA='Imagem ilegível';
  const rejected=await run(ask(resumed.screen,'atualizar_documentos_matricula',resumed.data.estado));assert.match(rejected.data.documentos_resumo,/Recusado — Imagem ilegível/);assert.ok(rejected.data.documentos.some(d=>d.id==='501'));
  // The mock size expectation belongs to this fixture; keep replacement size equal.
  f.state.cdn=encrypted(Buffer.concat([Buffer.from('%PDF-1.4 '),Buffer.alloc(900*1024)]),'corrigido.pdf');
  const corrected=await run(ask(rejected.screen,'enviar_documento_matricula',rejected.data.estado,{documento:'501',arquivo:f.state.cdn.media}));
  assert.equal(f.state.posts,2);assert.equal(corrected.data.tem_erro,false);
  f.state.documents[0].STATUSENVIO='3';const approved=await run(ask(corrected.screen,'atualizar_documentos_matricula',corrected.data.estado));assert.match(approved.data.documentos_resumo,/Carteira de identidade: Aprovado/);
 }finally{globalThis.fetch=previous}
});

test('lost upload response is confirmed by read without another POST',async()=>{
 setup();const f=fixture({mode:'lost-response'}),previous=globalThis.fetch;globalThis.fetch=f.fetcher;
 try{const docs=await enter(),req=ask(docs.screen,'enviar_documento_matricula',docs.data.estado,{documento:'501',arquivo:f.state.cdn.media});const sent=await run(req);assert.equal(sent.data.tem_erro,false);assert.match(sent.data.mensagem_envio,/recebido/);await run(req);assert.equal(f.state.posts,1)}finally{globalThis.fetch=previous}
});

test('HTTP success without new persisted file stays uncertain and blocks new media in another session',async()=>{
 setup();const f=fixture({mode:'unconfirmed'}),previous=globalThis.fetch;globalThis.fetch=f.fetcher;
 try{
  const docs=await enter(),sent=await run(ask(docs.screen,'enviar_documento_matricula',docs.data.estado,{documento:'501',arquivo:f.state.cdn.media}));
  assert.equal(sent.data.tem_erro,true);assert.match(sent.data.erro,/confirmar/);assert.equal(f.state.posts,1);
  f.state.cdn=encrypted(Buffer.concat([Buffer.from('%PDF-1.4 '),Buffer.alloc(900*1024)]),'outro.pdf');
  const another=await enter();const blocked=await run({...ask(another.screen,'enviar_documento_matricula',another.data.estado,{documento:'501',arquivo:f.state.cdn.media}),flow_token:'another-flow'});
  assert.equal(blocked.data.tem_erro,true);assert.equal(f.state.posts,1,'global inscription/document ledger blocks changed media too');
 }finally{globalThis.fetch=previous}
});

test('native upload is wired through the durable job engine with real sealed-state rendering',async()=>{
 setup();const f=fixture(),previous=globalThis.fetch;globalThis.fetch=f.fetcher;
 const map=new Map(),store={async create(id,record){if(map.has(id))return false;map.set(id,{record:structuredClone(record),version:1});return true},async get(id){return structuredClone(map.get(id))},async update(id,record,version){const old=map.get(id);if(old.version!==version)return false;map.set(id,{record:structuredClone(record),version:version+1});return true}};
 try{
  const docs=await enter();const {responseForScreen}=await import('../api/flow.js');
  const engine=createJobEngine({store,enqueue:async()=>{},openState,render:responseForScreen,run,waitMs:0});
  const request=ask(docs.screen,'enviar_documento_matricula',docs.data.estado,{documento:'501',arquivo:f.state.cdn.media});
  const waiting=await engine.route(request);assert.equal(waiting.data.processando,true);assert.equal(waiting.data.acao_rodape,'consultar_tarefa');assert.equal(f.state.posts,0);
  await engine.worker(waiting.data.job_id,workerSignature(waiting.data.job_id));
  const done=await engine.route(ask(docs.screen,'consultar_tarefa',waiting.data.estado));assert.equal(done.data.processando,false);assert.equal(done.data.acao_rodape,'enviar_documento_matricula');assert.equal(f.state.posts,1);
 }finally{globalThis.fetch=previous}
});

test('native JSON exposes one 5MiB picker and status refresh without opening a site',async()=>{
 const flow=JSON.parse(await readFile(new URL('../flow-waba.json',import.meta.url))),screen=flow.screens.find(s=>s.id==='DOCUMENTOS_MATRICULA'),components=[];
 const walk=v=>{if(Array.isArray(v))return v.forEach(walk);if(v&&typeof v==='object'){if(v.type)components.push(v);Object.values(v).forEach(walk)}};walk(screen.layout);
 const pickers=components.filter(c=>c.type==='DocumentPicker');assert.equal(pickers.length,1);assert.equal(pickers[0]['max-file-size-kb'],5120);
 assert.ok(components.some(c=>c.type==='EmbeddedLink'&&c['on-click-action'].payload.acao==='atualizar_documentos_matricula'));
 assert.ok(!JSON.stringify(screen.layout).includes('open_url'));
});

test('full 5MiB encrypted media is delivered as binary; a larger file never reaches POST',async()=>{
 setup();const bytes=Buffer.alloc(5*1024*1024);bytes.write('%PDF-1.4 ');
 const f=fixture({bytes}),previous=globalThis.fetch;globalThis.fetch=f.fetcher;
 try{
  const docs=await enter();const done=await run(ask(docs.screen,'enviar_documento_matricula',docs.data.estado,{documento:'501',arquivo:f.state.cdn.media}));
  assert.equal(done.data.tem_erro,false);assert.equal(f.state.posts,1);
  const oversized=Buffer.alloc(bytes.length+1);oversized.write('%PDF-1.4 ');f.state.cdn=encrypted(oversized,'maior.pdf');
  const failed=await run(ask(done.screen,'enviar_documento_matricula',done.data.estado,{documento:'502',arquivo:f.state.cdn.media}));
  assert.equal(failed.data.tem_erro,true);assert.match(failed.data.erro,/maior que 5 MB/);assert.equal(f.state.posts,1);
 }finally{globalThis.fetch=previous}
});

test('original uncertain filename survives blocked new media and reconciles after a new login',async()=>{
 setup();const f=fixture({mode:'unconfirmed'}),previous=globalThis.fetch;globalThis.fetch=f.fetcher;
 try{
  const docs=await enter();await run(ask(docs.screen,'enviar_documento_matricula',docs.data.estado,{documento:'501',arquivo:f.state.cdn.media}));
  const original=f.state.cdn.media[0].file_name;
  f.state.cdn=encrypted(Buffer.concat([Buffer.from('%PDF-1.4 '),Buffer.alloc(900*1024)]),'blocked.pdf');
  let resumed=await enter();const blocked=await run(ask(resumed.screen,'enviar_documento_matricula',resumed.data.estado,{documento:'501',arquivo:f.state.cdn.media}));
  assert.equal(openState(blocked.data.estado,blocked.screen).portal_document_operation.name,original);assert.equal(f.state.posts,1);
  Object.assign(f.state.documents[0],{STATUSENVIO:'1',PATHARQUIVO:'delayed-path',FILES:[{name:original,link:'https://example.invalid/delayed'}]});
  resumed=await enter();assert.ok(!resumed.data.documentos.some(d=>d.id==='501'));
  f.state.documents[0].STATUSENVIO='2';f.state.mode='confirmed';
  const rejected=await run(ask(resumed.screen,'atualizar_documentos_matricula',resumed.data.estado));
  const corrected=await run(ask(rejected.screen,'enviar_documento_matricula',rejected.data.estado,{documento:'501',arquivo:f.state.cdn.media}));
  assert.equal(corrected.data.tem_erro,false);assert.equal(f.state.posts,2);
 }finally{globalThis.fetch=previous}
});

test('preexisting rejected file with the same name is not a receipt for an unconfirmed replacement',async()=>{
 setup();const f=fixture({mode:'unconfirmed'}),previous=globalThis.fetch;globalThis.fetch=f.fetcher;
 Object.assign(f.state.documents[0],{STATUSENVIO:'2',PATHARQUIVO:'old-path',FILES:[{name:'matricula.pdf',link:'https://example.invalid/old'}]});
 try{
  const docs=await enter();const result=await run(ask(docs.screen,'enviar_documento_matricula',docs.data.estado,{documento:'501',arquivo:f.state.cdn.media}));
  assert.equal(result.data.tem_erro,true);assert.match(result.data.erro,/confirmar/);assert.equal(f.state.posts,1);
 }finally{globalThis.fetch=previous}
});

test('all documents in review stay unapproved and next-stage action preserves contract block',async()=>{
 setup();const f=fixture(),previous=globalThis.fetch;globalThis.fetch=f.fetcher;
 try{
  const docs=await enter();f.state.analysis=true;for(const d of f.state.documents)d.STATUSENVIO='1';
  const current=await run(ask(docs.screen,'atualizar_documentos_matricula',docs.data.estado));
  assert.equal(current.data.tem_pendentes,false);assert.equal(current.data.acao_rodape,'atualizar_portal');assert.match(current.data.documentos_resumo,/Em análise/);
  const next=await run(ask(current.screen,'atualizar_portal',current.data.estado));
  assert.equal(next.screen,'STATUS_FINAL');assert.match(next.data.resumo,/Contrato: Aguardando documentação/);assert.match(next.data.titulo,/Aguardando/);assert.equal(f.state.posts,0);
 }finally{globalThis.fetch=previous}
});

test('existing-candidate login is queued and repeated clicks do not authenticate twice',async()=>{
 setup();const f=fixture(),previous=globalThis.fetch;globalThis.fetch=f.fetcher;
 const map=new Map(),store={async create(id,record){if(map.has(id))return false;map.set(id,{record:structuredClone(record),version:1});return true},async get(id){return structuredClone(map.get(id))},async update(id,record,version){const old=map.get(id);if(old.version!==version)return false;map.set(id,{record:structuredClone(record),version:version+1});return true}};
 try{
  const {responseForScreen}=await import('../api/flow.js');
  const engine=createJobEngine({store,enqueue:async()=>{},openState,render:responseForScreen,run,waitMs:0});
  const req=ask('ESCOLHA_PROCESSO','selecionar_processo',sealState('ESCOLHA_PROCESSO',{data_maxima_nascimento:'2026-11-07',processo_seletivo_id:[]}),{modo:'continuar',login:'11144477735',data_nascimento:'2000-01-02'});
  const [a,b]=await Promise.all([engine.route(req),engine.route(req)]);assert.equal(a.data.processando,true);assert.equal(a.data.job_id,b.data.job_id);assert.equal(f.state.settings,0);
  await engine.worker(a.data.job_id,workerSignature(a.data.job_id));await engine.worker(a.data.job_id,workerSignature(a.data.job_id));
  const done=await engine.route(ask('ESCOLHA_PROCESSO','consultar_tarefa',a.data.estado));assert.equal(done.screen,'PORTAL_STATUS');assert.equal(f.state.settings,1);
 }finally{globalThis.fetch=previous}
});

test('financial responsible CPF does not replace the candidate identity used by native documents',async()=>{
 setup();const f=fixture(),previous=globalThis.fetch;let responsibleCpf;
 globalThis.fetch=async(input,options={})=>{
  const u=new URL(String(input));
  if(u.hostname==='admin.portal.apprbs.com.br'&&u.pathname.endsWith('/submit')){
   responsibleCpf=JSON.parse(options.body).data.find(d=>d.field_id===3)?.value;
   return Response.json({success:true,data:{token:'official-token'}});
  }
  return f.fetcher(input,options);
 };
 try{
  const docs=await enter(),candidate=openState(docs.data.estado,docs.screen);
  const fields=['nome','email','cpf','data_nascimento','celular','rua','numero','bairro','cidade','uf','estado_natal','cidade_natal'];
  const estado=sealState('RESP_DADOS',{...candidate,button_id:'999',campos:Object.fromEntries(fields.map((key,i)=>[key,String(i+1)])),ocultos:[],ufs:[{id:'MA'}],cidades_natal:[{id:'BALSAS'}]});
  const next=await run(ask('RESP_DADOS','enviar_resp_dados',estado,{nome:'Responsável fictício',email:'teste@example.invalid',cpf:'52998224725',data_nascimento:'1970-01-01',celular:'99999999999',rua:'Rua fictícia',numero:'1',bairro:'Centro',cidade:'Balsas',uf:'MA',estado_natal:'MA',cidade_natal:'BALSAS'}));
  assert.equal(responsibleCpf,'52998224725');assert.equal(next.screen,'DOCUMENTOS_MATRICULA');
  assert.equal(openState(next.data.estado,next.screen).cpf,'11144477735');assert.equal(next.data.tem_erro,false);
 }finally{globalThis.fetch=previous}
});
