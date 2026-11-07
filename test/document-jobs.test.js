import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createJobEngine} from '../api/jobs.js';
import {workerSignature} from '../api/cloud-store.js';
process.env.FLOW_PRIVATE_KEY='document-jobs-unit-key';
function memory(){const map=new Map();return {map,async create(id,record){if(map.has(id))return false;map.set(id,{record:structuredClone(record),version:1});return true},async get(id){return structuredClone(map.get(id)??null)},async update(id,record,version){const previous=map.get(id);if(previous.version!==version)return false;map.set(id,{record:structuredClone(record),version:version+1});return true}}}
const trusted={cpf:'11144477735',processo_seletivo_id:'20385',applyment_id:'777',token:'authenticated',documentos:[{id:'28'},{id:'10'}]};
const req=(extra={},state={})=>({action:'data_exchange',screen:'DOCUMENTOS_INSCRICAO',flow_token:'unit-flow',data:{acao:'enviar_documento',estado:JSON.stringify({...trusted,...state}),documento:'28',arquivo:[{media_id:'media-1',cdn_url:'https://mmg.whatsapp.net/a',encryption_metadata:{encrypted_hash:'encrypted-sha256',encryption_key:'secret-media-key'}}],...extra}});
const render=(screen,data)=>({screen,data:{...data,estado:JSON.stringify(data)}});
function engine(store,run,extra={}){return createJobEngine({store,run,enqueue:async()=>{},openState:JSON.parse,render,...extra})}
const poll=r=>({action:'data_exchange',screen:r.screen,flow_token:'unit-flow',data:{acao:'consultar_tarefa',estado:r.data.estado}});
test('document job returns immediately without polling sleep or exposing media keys',async()=>{
 const store=memory();let slept=0;const e=engine(store,async()=>{throw Error('must run in worker')},{sleep:async()=>{slept++}});
 const result=await e.route(req());assert.equal(result.data.processando,true);assert.equal(slept,0);assert.match(result.data.mensagem_processamento,/15 a 20/);
 assert.ok(!JSON.stringify(result).includes('secret-media-key'));assert.ok(!JSON.stringify(result).includes('cdn_url'));assert.equal(result.data.values.documento,'28');
 assert.equal((await store.get(result.data.job_id)).record.request.data.arquivo[0].encryption_metadata.encryption_key,'secret-media-key');
});
test('same document media deduplicates refreshed states and concurrent worker deliveries',async()=>{
 const store=memory();let writes=0;const e=engine(store,async()=>{writes++;return {screen:'DOCUMENTOS_INSCRICAO',data:{processando:false,enviados:'Recebido'}}});
 const [a,b]=await Promise.all([e.route(req()),e.route(req({}, {enviados:'Outra atualização',nonce:'changed-state'}))]);assert.equal(a.data.job_id,b.data.job_id);
 await Promise.all([e.worker(a.data.job_id,workerSignature(a.data.job_id)),e.worker(b.data.job_id,workerSignature(b.data.job_id))]);assert.equal(writes,1);
 assert.equal((await e.route(poll(a))).data.enviados,'Recebido');
});
test('different document types and files have separate operations',async()=>{
 const e=engine(memory(),async()=>({}));const first=await e.route(req());
 const otherType=await e.route(req({documento:'10'}));const otherFile=await e.route(req({arquivo:[{media_id:'media-2',encryption_metadata:{encrypted_hash:'other-sha256'}}]}));
 assert.notEqual(first.data.job_id,otherType.data.job_id);assert.notEqual(first.data.job_id,otherFile.data.job_id);
});
test('untrusted request identity cannot change persisted binding or produce another job',async()=>{
 const store=memory();let executed;const e=engine(store,async r=>{executed=r.data;return {screen:'DOCUMENTOS_INSCRICAO',data:{}}});
 const first=await e.route(req({cpf:'99999999999',processo_seletivo_id:'wrong',applyment_id:'wrong',token:'forged'}));const second=await e.route(req());assert.equal(first.data.job_id,second.data.job_id);
 await e.worker(first.data.job_id,workerSignature(first.data.job_id));assert.equal(executed.cpf,trusted.cpf);assert.equal(executed.processo_seletivo_id,trusted.processo_seletivo_id);assert.equal(executed.token,trusted.token);
});
test('invalid state or missing media rejected before persisting a document operation',async()=>{
 const store=memory(),e=engine(store,async()=>({}));await assert.rejects(e.route(req({estado:'invalid'})));await assert.rejects(e.route(req({arquivo:[]})),/Anexe/);await assert.rejects(e.route(req({documento:'999'})),/Escolha/);assert.equal(store.map.size,0);
});
test('a restart during a running document never repeats the academic write',async()=>{
 const store=memory();let now=1000000,finish,started,writes=0;const began=new Promise(r=>{started=r}),work=new Promise(r=>{finish=r});
 const first=engine(store,async()=>{writes++;started();await work;return {screen:'DOCUMENTOS_INSCRICAO',data:{}}},{clock:()=>now});const initial=await first.route(req());const worker=first.worker(initial.data.job_id,workerSignature(initial.data.job_id));await began;
 const second=engine(store,async()=>{writes++;throw Error('must not run')},{clock:()=>now});await second.worker(initial.data.job_id,workerSignature(initial.data.job_id));now+=190000;
 const result=await second.route(poll(initial));assert.equal(result.data.processando,true);assert.match(result.data.erro,/Portal/);assert.equal(writes,1);assert.ok(!JSON.stringify(result).includes('secret-media-key'));finish();await worker;
});
test('uncertain document result stays protected and is restored on a new instance',async()=>{
 const store=memory();let writes=0;const first=engine(store,async()=>{writes++;return {screen:'PENDENTE',data:{mensagem:'Confirmação indisponível'}}});const initial=await first.route(req());await first.worker(initial.data.job_id,workerSignature(initial.data.job_id));
 const second=engine(store,async()=>{writes++;throw Error('must not run')});for(let i=0;i<2;i++){const result=await second.route(poll(initial));assert.equal(result.data.processando,true);assert.match(result.data.erro,/Confirmação/);assert.ok(!JSON.stringify(result).includes('secret-media-key'))}assert.equal(writes,1);
});

test('native matrícula send and refresh use immediate jobs without media leaks',async()=>{
 const store=memory();let slept=0;const e=engine(store,async()=>({}),{sleep:async()=>{slept++}});
 const send=req();send.screen='DOCUMENTOS_MATRICULA';send.data.acao='enviar_documento_matricula';const initial=await e.route(send);assert.equal(initial.data.processando,true);assert.equal(slept,0);assert.ok(!JSON.stringify(initial).includes('secret-media-key'));
 const refresh={...send,data:{acao:'atualizar_documentos_matricula',estado:send.data.estado}};const updated=await e.route(refresh);assert.equal(updated.data.processando,true);assert.match(updated.data.mensagem_processamento,/conferindo/);assert.notEqual(initial.data.job_id,updated.data.job_id);
});
test('login continuation uses immediate sanitized processing and worker errors reopen editable form',async()=>{
 const store=memory();let slept=0;const e=engine(store,async()=>{throw Error('upstream unavailable')},{sleep:async()=>{slept++}});
 const login={action:'data_exchange',screen:'ESCOLHA_PROCESSO',flow_token:'unit-flow',data:{acao:'selecionar_processo',estado:JSON.stringify({processos:[{id:'1'}]}),modo:'continuar',login:'11144477735',data_nascimento:'2000-01-02',extra:'untrusted-extra'}};
 const initial=await e.route(login);assert.equal(initial.data.processando,true);assert.equal(slept,0);assert.deepEqual(initial.data.values,{modo:'continuar',login:'11144477735',data_nascimento:'2000-01-02'});assert.ok(!JSON.stringify(initial).includes('untrusted-extra'));await e.worker(initial.data.job_id,workerSignature(initial.data.job_id));const result=await e.route(poll(initial));assert.equal(result.screen,'ESCOLHA_PROCESSO');assert.equal(result.data.processando,false);assert.equal(result.data.editavel,true);assert.equal(result.data.job_id,'');assert.match(result.data.erro,/tente novamente/);
});
test('new inscription selection preserves direct routing and corrected login gets a new operation',async()=>{
 let direct=0;const e=engine(memory(),async()=>{direct++;return {screen:'DADOS_BASICOS',data:{}}});const login={action:'data_exchange',screen:'ESCOLHA_PROCESSO',flow_token:'unit-flow',data:{acao:'selecionar_processo',estado:'{}',modo:'nova'}};assert.equal((await e.route(login)).screen,'DADOS_BASICOS');assert.equal(direct,1);
 const first=await e.route({...login,data:{...login.data,modo:'continuar',login:'11144477735',data_nascimento:'2000-01-02'}});const second=await e.route({...login,data:{...login.data,modo:'continuar',login:'11144477735',data_nascimento:'2000-01-03'}});assert.notEqual(first.data.job_id,second.data.job_id);
});
