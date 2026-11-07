import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createJobEngine} from '../api/jobs.js';
import {workerSignature,pack,unpack,validWorkerSignature} from '../api/cloud-store.js';
process.env.FLOW_PRIVATE_KEY='local-unit-key';
function memory(){const map=new Map();return {async create(id,record){if(map.has(id))return false;map.set(id,{record:structuredClone(record),version:1});return true},async get(id){return structuredClone(map.get(id)??null)},async update(id,record,version){const previous=map.get(id);if(previous.version!==version)return false;map.set(id,{record:structuredClone(record),version:version+1});return true}}}
const req=()=>({action:'data_exchange',screen:'QUASE_LA',flow_token:'unit-flow',data:{acao:'enviar_informacoes_complementares',estado:'{}',cpf:'unit-value'}});
const render=(screen,data)=>({screen,data:{...data,estado:JSON.stringify(data)}});
function engine(store,run,extra={}){return createJobEngine({store,run,enqueue:async()=>{},openState:JSON.parse,render,waitMs:0,...extra})}

test('resultado antigo da redação usa painel pós-prova sem repetir envio',async()=>{
 const store=memory();let calls=0;
 const e=engine(store,async()=>{calls++;return render('ACOMPANHAMENTO',{token:'unit',proxima:{step:33,title:'Prova online'}})});
 const request={action:'data_exchange',screen:'TELA_REDACAO',flow_token:'unit-flow',data:{acao:'enviar_redacao',estado:'{}'}};
 const first=await e.route(request);await e.worker(first.data.job_id,workerSignature(first.data.job_id));
 const result=await e.route({...request,data:{acao:'consultar_tarefa',estado:first.data.estado}});
 assert.equal(result.screen,'ACOMPANHAMENTO_POS_PROVA');assert.equal(result.data.proxima,null);assert.equal(result.data.acao_rodape,'atualizar_portal');assert.equal(calls,1);
});

test('painel pós-prova aceita atualização assíncrona e preserva a origem durante espera',async()=>{
 const e=engine(memory(),async()=>({}));
 const result=await e.route({action:'data_exchange',screen:'ACOMPANHAMENTO_POS_PROVA',flow_token:'unit-flow',data:{acao:'atualizar_portal',estado:'{}'}});
 assert.equal(result.screen,'ACOMPANHAMENTO_POS_PROVA');assert.equal(result.data.acao_rodape,'consultar_tarefa');
});
test('operação lenta permanece na tela de origem e conclui sem novo submit',async()=>{
 const store=memory();let writes=0;const e=engine(store,async()=>{writes++;return {screen:'TELA_ORIENTACAO_PROVA',data:{estado:'{}'}}});
 const first=await e.route(req());assert.equal(first.screen,'QUASE_LA');assert.equal(first.data.processando,true);assert.equal(first.data.acao_rodape,'consultar_tarefa');assert.equal(writes,0);
 const id=first.data.job_id;await e.worker(id,workerSignature(id));
 const next=await e.route({action:'data_exchange',screen:'QUASE_LA',flow_token:'unit-flow',data:{acao:'consultar_tarefa',estado:first.data.estado}});
 assert.equal(next.screen,'TELA_ORIENTACAO_PROVA');assert.equal(writes,1);
});
test('repetição do clique e duas entregas da fila executam uma única operação',async()=>{
 const store=memory();let writes=0;const e=engine(store,async()=>{writes++;return {screen:'TELA_ORIENTACAO_PROVA',data:{}}});
 const [a,b]=await Promise.all([e.route(req()),e.route(req())]);assert.equal(a.data.job_id,b.data.job_id);
 const id=a.data.job_id;await Promise.all([e.worker(id,workerSignature(id)),e.worker(id,workerSignature(id))]);assert.equal(writes,1);
});
test('nova instância recupera o resultado persistido',async()=>{
 const store=memory();const first=engine(store,async()=>({screen:'TELA_REDACAO',data:{}}));const initial=await first.route(req());
 await first.worker(initial.data.job_id,workerSignature(initial.data.job_id));
 const second=engine(store,async()=>{throw Error('must not execute')});
 const result=await second.route({action:'data_exchange',screen:'QUASE_LA',flow_token:'unit-flow',data:{acao:'consultar_tarefa',estado:initial.data.estado}});assert.equal(result.screen,'TELA_REDACAO');
});
test('resultado incerto não fecha o Flow nem repete gravação',async()=>{
 const store=memory();let writes=0;const e=engine(store,async()=>{writes++;return {screen:'PENDENTE',data:{mensagem:'Confirmação indisponível'}}});const first=await e.route(req());
 await e.worker(first.data.job_id,workerSignature(first.data.job_id));
 const poll={action:'data_exchange',screen:'QUASE_LA',flow_token:'unit-flow',data:{acao:'consultar_tarefa',estado:first.data.estado}};
 for(let i=0;i<2;i++){const result=await e.route(poll);assert.equal(result.screen,'QUASE_LA');assert.equal(result.data.processando,true);assert.equal(result.data.erro,'Confirmação indisponível')}
 assert.equal(writes,1);
});
test('erro de validação devolve formulário para correção',async()=>{
 const store=memory();const e=engine(store,async()=>({screen:'QUASE_LA',data:{processando:false,erro:'Campo obrigatório'}}));const first=await e.route(req());await e.worker(first.data.job_id,workerSignature(first.data.job_id));
 const result=await e.route({action:'data_exchange',screen:'QUASE_LA',flow_token:'unit-flow',data:{acao:'consultar_tarefa',estado:first.data.estado}});assert.equal(result.data.processando,false);assert.equal(result.data.erro,'Campo obrigatório');
});
test('fila indisponível preserva operação e permite agendar na consulta',async()=>{
 const store=memory();let n=0;const e=engine(store,async()=>({}),{enqueue:async()=>{if(++n===1)throw Error('fila indisponível')}});const first=await e.route(req());assert.equal(first.data.erro,'fila indisponível');
 await e.route({action:'data_exchange',screen:'QUASE_LA',flow_token:'unit-flow',data:{acao:'consultar_tarefa',estado:first.data.estado}});assert.equal(n,2);
});
test('worker rejeita assinatura inválida e consulta rejeita outra sessão',async()=>{
 const store=memory();let calls=0;const e=engine(store,async()=>{calls++});const first=await e.route(req());assert.equal(await e.worker(first.data.job_id,'0'.repeat(64)),403);assert.equal(calls,0);
 await assert.rejects(e.route({action:'data_exchange',screen:'QUASE_LA',flow_token:'another',data:{acao:'consultar_tarefa',estado:first.data.estado}}),/outra sessão/);
});
test('armazenamento criptografa dados e detecta adulteração',()=>{
 const input={request:{cpf:'unit-document',texto:'unit-essay'}};const encrypted=pack(input);assert.ok(!encrypted.includes('unit-essay'));assert.deepEqual(unpack(encrypted),input);
 const buffer=Buffer.from(encrypted,'base64url');buffer[buffer.length-1]^=1;assert.throws(()=>unpack(buffer.toString('base64url')));assert.equal(validWorkerSignature('bad','bad'),false);
});
test('rota que altera o request não destrói o estado original de acompanhamento',async()=>{
 const store=memory();const e=engine(store,async request=>{request.data={acao:'mutated'};return {screen:'PENDENTE',data:{mensagem:'Conferir'}}});
 const first=await e.route(req());await e.worker(first.data.job_id,workerSignature(first.data.job_id));
 const result=await e.route({action:'data_exchange',screen:'QUASE_LA',flow_token:'unit-flow',data:{acao:'consultar_tarefa',estado:first.data.estado}});
 assert.equal(result.screen,'QUASE_LA');assert.equal(result.data.erro,'Conferir');
});
test('worker continua após 12 segundos e a consulta não repete a inscrição',async()=>{
 const store=memory();let now=1000000,writes=0,finish,started;
 const began=new Promise(r=>{started=r});
 const work=new Promise(r=>{finish=r});
 const e=engine(store,async()=>{writes++;started();await work;return {screen:'TELA_ORIENTACAO_PROVA',data:{}}},{clock:()=>now});
 const first=await e.route(req());const worker=e.worker(first.data.job_id,workerSignature(first.data.job_id));await began;
 now+=12000;
 const poll={action:'data_exchange',screen:'QUASE_LA',flow_token:'unit-flow',data:{acao:'consultar_tarefa',estado:first.data.estado}};
 assert.equal((await e.route(poll)).data.processando,true);assert.equal(writes,1);
 finish();await worker;assert.equal((await e.route(poll)).screen,'TELA_ORIENTACAO_PROVA');assert.equal(writes,1);
});
test('recupera ação herdada de 1.1.0 sem submeter outra inscrição',async()=>{
 const store=memory();let action;
 const e=engine(store,async request=>{action=request.data.acao;return {screen:'TELA_REDACAO',data:{}}});
 const request={action:'data_exchange',screen:'TELA_ORIENTACAO_PROVA',flow_token:'unit-flow',data:{acao:'enviar_informacoes_complementares',estado:JSON.stringify({acao_rodape:'enviar_informacoes_complementares',processando:false})}};
 const first=await e.route(request);assert.equal(first.screen,'TELA_ORIENTACAO_PROVA');await e.worker(first.data.job_id,workerSignature(first.data.job_id));assert.equal(action,'iniciar_redacao');
});
test('não aceita ação de outra tela se ela não está autenticada no estado',async()=>{
 const e=engine(memory(),async()=>({}));
 await assert.rejects(e.route({action:'data_exchange',screen:'TELA_ORIENTACAO_PROVA',flow_token:'unit',data:{acao:'enviar_informacoes_complementares',estado:'{}'}}),/Ação não permitida/);
});


test('prova pendente sai do polling para conferência, sem repetir a operação antiga',async()=>{
 const store=memory();let runs=0;
 const e=engine(store,async request=>{runs++;return request.data.acao==='iniciar_redacao'?{screen:'PENDENTE',data:{mensagem:'Parâmetros não encontrados'}}:{screen:'TELA_ORIENTACAO_PROVA',data:{}}});
 const request={action:'data_exchange',screen:'TELA_ORIENTACAO_PROVA',flow_token:'unit-flow',data:{acao:'iniciar_redacao',estado:JSON.stringify({token:'unit',applyment_id:'unit-app'})}};
 const first=await e.route(request);await e.worker(first.data.job_id,workerSignature(first.data.job_id));
 const poll={action:'data_exchange',screen:request.screen,flow_token:request.flow_token,data:{acao:'consultar_tarefa',estado:first.data.estado}};
 for(let i=0;i<3;i++){const result=await e.route(poll);assert.equal(result.data.processando,false);assert.equal(result.data.proof_resume_required,true);assert.equal(result.data.job_id,'')}
 assert.equal(runs,1);
 const ready=await e.route(poll);
 const check=await e.route({...poll,data:{acao:'conferir_prova_existente',estado:ready.data.estado}});
 await e.worker(check.data.job_id,workerSignature(check.data.job_id));assert.equal(runs,2);
});
