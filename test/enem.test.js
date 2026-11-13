import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {enemAverage,enemYears} from '../api/enem.js';
import {routeFlowRequest,flowContext,sealState,openState,responseForScreen} from '../api/flow.js';
import {createJobEngine} from '../api/jobs.js';
import {workerSignature} from '../api/cloud-store.js';
const notes={nota_natureza_enem:'800,1',nota_humanas_enem:'700.2',nota_matematica_enem:'650,3',nota_linguagens_enem:'750.4',nota_redacao_enem:'900'};
test('média mantém centésimos, aceita vírgula, zero e mil e rejeita média incompatível',()=>{
 assert.equal(enemAverage(notes),'760.20');
 assert.equal(enemAverage(Object.fromEntries(Object.keys(notes).map(k=>[k,'0']))),'0.00');
 assert.equal(enemAverage(Object.fromEntries(Object.keys(notes).map(k=>[k,'1000']))),'1000.00');
 for(const value of ['','-1','1001','NaN','1e3'])assert.throws(()=>enemAverage({...notes,nota_redacao_enem:value}));
 assert.equal(enemAverage({...notes,media_enem:'760,20'}),'760.20');
 assert.throws(()=>enemAverage({...notes,media_enem:'760'}),/760,20/);
});
test('anos respeitam opções do formulário em vez de limitar a 2025',()=>{
 assert.deepEqual(enemYears({options:[{value:'2026',label:'2026'},{value:'2022',label:'2022'}]},[]),[{id:'2026',title:'2026'},{id:'2022',title:'2022'}]);
});
function memory(){const map=new Map();return {async create(id,record){if(map.has(id))return false;map.set(id,{record:structuredClone(record),version:1});return true},async get(id){return structuredClone(map.get(id)??null)},async update(id,record,version){const prev=map.get(id);if(prev.version!==version)return false;map.set(id,{record:structuredClone(record),version:version+1});return true}}}
for(const failRead of [false,true])test(`ENEM até agradecimento / falha de leitura=${failRead}: nunca usa botão do vestibular`,async()=>{
 process.env.FLOW_PRIVATE_KEY='unit-enem-private';process.env.RBS_TOKEN='unit-rbs';
 const [courseForm,finalForm]=await Promise.all([300708,300709].map(id=>readFile(new URL(`./fixtures/enem-form-${id}.json`,import.meta.url)).then(JSON.parse)));
 courseForm.querys[0].fields[0].field=38627;
 let writes=0,finalReads=0,failFinalRead=failRead;const original=globalThis.fetch;
 globalThis.fetch=async(input,opts={})=>{
  const url=new URL(String(input));assert.equal(url.origin,'https://admin.portal.apprbs.com.br');
  const b=JSON.parse(opts.body);assert.equal(opts.method,'POST');
  if(url.pathname.endsWith('/data-source')){
   if(Number(b.target)===38627)return Response.json({success:true,data:[{value:'unit-course',label:'Biomedicina'}]});
   assert.equal(Number(b.target),38547);return Response.json({success:true,data:[{value:'unit-shift',label:'Noturno'}],nextOptions:{38553:{value:'unit-area'},38552:{value:'unit-offer'},38550:{value:'01'},38611:{value:'1'},38612:{value:'1'},38610:{value:'1'}}});
  }
  if(url.pathname.endsWith('/form')){
   if(Number(b.target)===300708)return Response.json({success:true,token:'unit-course-token',data:{form:courseForm}});
   assert.equal(Number(b.target),300709);assert.equal(b.token,'unit-final-token');finalReads++;
   if(failFinalRead)throw new Error('consulta indisponível');
   return Response.json({success:true,token:'unit-final-token',data:{form:finalForm}});
  }
  assert.ok(url.pathname.endsWith('/submit'));writes++;
  if(writes===1)return Response.json({success:true,data:{next:300708,local:'step',token:'unit-course-token'}});
  if(writes===2){
   assert.equal(b.button,3940768);assert.equal(b.token,'unit-course-token');
   assert.equal(String(b.data.find(x=>x.field_id===38558).value),'760.20');
   assert.equal(b.data.find(x=>x.field_id===38557).value,'2026');
   return Response.json({success:true,token:'unit-final-token',data:{next:300709,local:'step'}});
  }
  assert.equal(writes,3);assert.equal(b.button,3940774);assert.equal(b.token,'unit-final-token');
  return Response.json({success:true,data:{redirect:{applyment_id:'unit-enem-application',link:'https://seletivo.unibalsas.edu.br/obrigado-3'}}});
 };
 async function run(req,worker=false){const ctx={request:req,deadline:Date.now()+120000,worker,write:null};return flowContext.run(ctx,async()=>{const response=await routeFlowRequest(structuredClone(req));return worker?{response,audit:ctx.audit}:response})}
 const e=createJobEngine({store:memory(),enqueue:async()=>{},run,render:responseForScreen,openState,waitMs:0});
 const req=(screen,acao,estado,user={})=>({screen,action:'data_exchange',flow_token:'unit-flow',data:{acao,estado,...user}});
 try{
  const state=sealState('DADOS_BASICOS',{processo_seletivo_id:'20386',eh_nota_enem:true,token:'unit-basic-token',button_id:'100',campo_nome_id:'1',campo_possui_nome_social_id:'2',campo_nome_social_id:'3',campo_email_id:'4',campo_data_nascimento_id:'5',campo_celular_id:'6',campo_genero_id:'7',campo_consentimento_id:'8',campo_idps_id:'9',campo_lgpd_assinatura_id:'10',campo_lgpd_base_legal_id:'11',campo_genero_rubeus_id:'12'});
  const course=await e.route(req('DADOS_BASICOS','enviar_dados_basicos',state,{nome:'Pessoa Exemplo',email:'teste@example.invalid',data_nascimento:'2000-01-01',celular:'11900000000',genero:'F',aceite_privacidade:true}));
  assert.equal(course.screen,'CURSO_ENEM');assert.equal(course.data.anos_enem[0].id,'2026');
  const selected=await e.route(req(course.screen,'buscar_turnos',course.data.estado,{curso_id:'unit-course'}));
  const calc=await e.route(req(selected.screen,'calcular_media',selected.data.estado,{curso_id:'unit-course',turno_id:'unit-shift',numero_inscricao_enem:'123456789012',ano_enem:'2026',...notes}));
  assert.equal(calc.data.valor_media_enem,'760.20');assert.equal(writes,1);
  const bad=await e.route(req(calc.screen,'calcular_media',calc.data.estado,{...notes,nota_redacao_enem:'1001'}));assert.equal(bad.screen,'CURSO_ENEM');assert.equal(bad.data.tem_erro,true);assert.equal(writes,1);
  const advance=req(calc.screen,'avancar_curso_interesse',calc.data.estado,{curso_id:'unit-course',turno_id:'unit-shift',numero_inscricao_enem:'123456789012',ano_enem:'2026',...notes,media_enem:'760,20'});
  const [waiting,again]=await Promise.all([e.route(advance),e.route(advance)]);assert.equal(waiting.data.job_id,again.data.job_id);assert.equal(waiting.data.processando,true);
  await Promise.all([e.worker(waiting.data.job_id,workerSignature(waiting.data.job_id)),e.worker(waiting.data.job_id,workerSignature(waiting.data.job_id))]);
  let almost=await e.route(req(waiting.screen,'consultar_tarefa',waiting.data.estado));
  if(failRead){assert.equal(writes,2);assert.equal(almost.screen,'CURSO_ENEM');assert.equal(almost.data.tem_erro,true);assert.equal(almost.data.processando,false);assert.equal(almost.data.acao_rodape,'retomar_etapa_enem');failFinalRead=false;const resumed=await e.route(req(almost.screen,'retomar_etapa_enem',almost.data.estado));await e.worker(resumed.data.job_id,workerSignature(resumed.data.job_id));almost=await e.route(req(resumed.screen,'consultar_tarefa',resumed.data.estado));assert.equal(writes,2)}
  assert.equal(almost.screen,'QUASE_LA');assert.equal(writes,2);assert.equal(finalReads,failRead?2:1);
  const final=await e.route(req('QUASE_LA','enviar_informacoes_complementares',almost.data.estado,{cpf:'11144477735',nacionalidade:'10',concluiu_ensino_medio:'Sim',possui_deficiencia:'F',como_conheceu:'01'}));
  await e.worker(final.data.job_id,workerSignature(final.data.job_id));
  const done=await e.route(req('QUASE_LA','consultar_tarefa',final.data.estado));
  assert.equal(done.screen,'CONFIRMACAO');assert.equal(done.data.inscricao_id,'unit-enem-application');assert.equal(done.data.titulo,'Obrigado pelo seu cadastro!');assert.equal(writes,3);
 }finally{globalThis.fetch=original}
});
