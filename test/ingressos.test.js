import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {routeFlowRequest,flowContext,sealState,openState,responseForScreen} from '../api/flow.js';
import {createJobEngine} from '../api/jobs.js';
import {workerSignature} from '../api/cloud-store.js';
// Ação gravada pela fila: segue o job até o resultado (o servidor responde "Só um instante" quando passa de 5,5 s).
async function settle(engine,request){
 let out=await engine.route(request);
 if(out.data?.job_id){
  await engine.worker(out.data.job_id,workerSignature(out.data.job_id));
  out=await engine.route({...request,screen:out.screen,data:{acao:"consultar_tarefa",estado:out.data.estado}});
 }
 return out;
}

import {processPolicy,isDirectRegistration,requiresEssay} from '../api/processes.js';
function memory(){const map=new Map();return {async create(id,record){if(map.has(id))return false;map.set(id,{record:structuredClone(record),version:1});return true},async get(id){return structuredClone(map.get(id)??null)},async update(id,record,version){const prev=map.get(id);if(prev.version!==version)return false;map.set(id,{record:structuredClone(record),version:version+1});return true}}}
test('políticas confirmadas: somente vestibular tem redação; IDs acadêmicos são específicos',()=>{
 assert.equal(processPolicy(20384).academicId,'224');assert.equal(processPolicy(20385).academicId,'225');
 assert.equal(requiresEssay(20383),true);assert.equal(requiresEssay(20384),false);assert.equal(requiresEssay(20385),false);assert.equal(requiresEssay(20386),false);
 assert.equal(isDirectRegistration(20384),true);assert.throws(()=>processPolicy(99999),/validado/);
});
for(const processId of ['20384','20385'])for(const fault of ['none','read','403'])test(`ingresso ${processId}, cenário ${fault}: conclusão e retomada sem prova nem botão alheio`,async()=>{
 process.env.FLOW_PRIVATE_KEY='unit-ingresso-key';process.env.RBS_TOKEN='unit';
 const [courseForm,finalForm]=await Promise.all([300708,300709].map(id=>readFile(new URL(`./fixtures/enem-form-${id}.json`,import.meta.url)).then(JSON.parse)));
 // Synthetic distinct step/button IDs exercise dynamic binding. They are not live route evidence.
 const courseStep=processId==='20384'?910001:920001,finalStep=courseStep+1,courseButton=courseStep+100,finalButton=courseStep+101;
 courseForm.id=courseStep;courseForm.content.inputs=courseForm.content.inputs.filter(i=>i.field_id<38556||i.field_id>38563);courseForm.content.buttons=[{button:courseButton,label:'Avançar'}];courseForm.querys[0].fields[0].field=38627;
 finalForm.id=finalStep;finalForm.content.buttons=[{button:finalButton,label:'Concluir'}];
 let submits=0,reads=0,failRead=fault==='read';const previous=globalThis.fetch;
 globalThis.fetch=async(input,options={})=>{
  const u=new URL(String(input));assert.equal(u.origin,'https://admin.portal.apprbs.com.br');const b=JSON.parse(options.body);
  if(u.pathname.endsWith('/data-source')){
   if(Number(b.target)===38627)return Response.json({success:true,data:[{value:'unit-course',label:'Curso de teste'}]});
   return Response.json({success:true,data:[{value:'unit-shift',label:'Noturno'}],nextOptions:{38553:{value:'area'},38552:{value:'offer'},38611:{value:'1'},38612:{value:'1'},38610:{value:'1'}}});
  }
  if(u.pathname.endsWith('/form')){
   if(Number(b.target)===courseStep)return Response.json({success:true,token:'course-token',data:{form:courseForm}});
   assert.equal(Number(b.target),finalStep);assert.equal(b.token,'final-token');reads++;
   if(failRead)throw Error('Leitura demorou');return Response.json({success:true,token:'final-token',data:{form:finalForm}});
  }
  assert.ok(u.pathname.endsWith('/submit'));submits++;
  if(submits===1){assert.equal(b.data.find(x=>x.field_id===9).value,processPolicy(processId).academicId);return Response.json({success:true,data:{next:courseStep,local:'step',token:'course-token'}})}
  if(submits===2){assert.equal(b.button,courseButton);assert.equal(b.token,'course-token');return Response.json({success:true,token:'final-token',data:{next:finalStep,local:'step'}})}
  assert.equal(submits,3);assert.equal(b.button,finalButton);assert.notEqual(b.button,3940366);assert.equal(b.token,'final-token');
  if(fault==='403')return Response.json({success:false},{status:403});
  return Response.json({success:true,data:{redirect:{applyment_id:'unit-'+processId}}});
 };
 async function run(request,worker=false){request=structuredClone(request);const ctx={request,worker,write:null,deadline:Date.now()+120000};return flowContext.run(ctx,async()=>{const response=await routeFlowRequest(request);return worker?{response,audit:ctx.audit}:response})}
 const engine=createJobEngine({store:memory(),enqueue:async()=>{},run,render:responseForScreen,openState,waitMs:0});
 const req=(screen,acao,estado,user={})=>({screen,action:'data_exchange',flow_token:'flow-'+processId,data:{acao,estado,...user}});
 try{
  const state=sealState('DADOS_BASICOS',{processo_seletivo_id:processId,token:'basic-token',button_id:'100',campo_nome_id:'1',campo_possui_nome_social_id:'2',campo_nome_social_id:'3',campo_email_id:'4',campo_data_nascimento_id:'5',campo_celular_id:'6',campo_genero_id:'7',campo_consentimento_id:'8',campo_idps_id:'9',campo_lgpd_assinatura_id:'10',campo_lgpd_base_legal_id:'11',campo_genero_rubeus_id:'12'});
  const course=await settle(engine,req('DADOS_BASICOS','enviar_dados_basicos',state,{nome:'Pessoa Teste',email:'teste@example.invalid',data_nascimento:'2000-01-01',celular:'11900000000',genero:'F',aceite_privacidade:true}));assert.equal(course.screen,'CURSO_INGRESSO');
  const selected=await engine.route(req(course.screen,'buscar_turnos',course.data.estado,{curso_id:'unit-course'}));
  const advance=req(selected.screen,'avancar_curso_ingresso',selected.data.estado,{curso_id:'unit-course',turno_id:'unit-shift'});
  const [waiting,duplicate]=await Promise.all([engine.route(advance),engine.route(advance)]);assert.equal(waiting.data.job_id,duplicate.data.job_id);
  await Promise.all([engine.worker(waiting.data.job_id,workerSignature(waiting.data.job_id)),engine.worker(waiting.data.job_id,workerSignature(waiting.data.job_id))]);
  let next=await engine.route(req(waiting.screen,'consultar_tarefa',waiting.data.estado));assert.equal(submits,2);
  if(fault==='read'){
   assert.equal(next.screen,'CURSO_INGRESSO');assert.equal(next.data.processando,false);assert.equal(next.data.editavel,false);assert.equal(next.data.acao_rodape,'retomar_etapa_ingresso');
   failRead=false;const resume=await engine.route(req(next.screen,'retomar_etapa_ingresso',next.data.estado));await engine.worker(resume.data.job_id,workerSignature(resume.data.job_id));next=await engine.route(req(resume.screen,'consultar_tarefa',resume.data.estado));assert.equal(submits,2);
  }
  assert.equal(next.screen,'QUASE_LA');assert.equal(reads,fault==='read'?2:1);assert.equal(openState(next.data.estado,next.screen).button_id,String(finalButton));
  const sending=await engine.route(req(next.screen,'enviar_informacoes_complementares',next.data.estado,{cpf:'11144477735',nacionalidade:'10',concluiu_ensino_medio:'Sim',possui_deficiencia:'F',como_conheceu:'01'}));
  await engine.worker(sending.data.job_id,workerSignature(sending.data.job_id));const final=await engine.route(req(sending.screen,'consultar_tarefa',sending.data.estado));assert.equal(submits,3);
  if(fault==='403'){assert.equal(final.screen,'QUASE_LA');assert.equal(final.data.tem_erro,true);assert.equal(final.data.processando,false)}
  else {assert.equal(final.screen,'CONFIRMACAO');assert.equal(final.data.inscricao_id,'unit-'+processId);assert.ok(final.data.mensagem.includes(processPolicy(processId).name))}
 }finally{globalThis.fetch=previous}
});
