import {test} from 'node:test';
import assert from 'node:assert/strict';
import {routeFlowRequest,flowContext,sealState} from '../api/flow.js';
test('preparar, entregar e confirmar portal usam a mesma execução, com uma única entrega',async()=>{
 process.env.FLOW_PRIVATE_KEY='unit-whole-proof';process.env.FLOW_PROJECT_ID='unit';process.env.RBS_TOKEN='unit';
 const original=globalThis.fetch;let submissions=0,saves=0,locks=0,portalText='Prova disponível';
 const snapshot={id:33,applicantData:[{field_id:112,value:'unit-key'},{field_id:113,value:'42'},{field_id:114,value:'unit-offer'}],content:[{type:'text',field_id:110,label:'IDEXECPROVA',value_now:'CURRENT'},{type:'text',field_id:111,label:'IDPROVAINSCRITO',value_now:'99'},{type:'button',id:1000,label:'Iniciar prova',forwardData:[{link:'https://avaliacao.apprubeus.com.br/api/avaliacao/linkProva',parameters:[{name:'chave',field_id:112,parameter_type_id:1},{name:'codigoContato',field_id:113,parameter_type_id:1},{name:'codigoOferta',field_id:114,parameter_type_id:1},{name:'idExecProva',field_id:110,parameter_type_id:1}]}]}]};
 const exam={id:777,avaliacao_id:10,crm_id:94,crm_contato_id:4,crm_curso_id:5,IDEXECPROVA:'CURRENT',codUsuarioPS:null,finalizada:0,tempoRestante:120,nome:'Redação',questoes:[{id:6,enunciado:'<p>Reda&ccedil;&atilde;o sobre equil&iacute;brio.</p>'}]};
 globalThis.fetch=async(input,options={})=>{
  const u=new URL(String(input)),body=options.body?JSON.parse(options.body):null;
  if(u.hostname==='metadata.google.internal')return Response.json({access_token:'unit-google',expires_in:3600});
  if(u.hostname==='firestore.googleapis.com'){assert.match(u.pathname,/flowDeliveryLocks/);locks++;return Response.json({})}
  if(u.hostname==='admin.portal.apprbs.com.br'){
   if(u.pathname.endsWith('/stages'))return Response.json({success:true,data:[{id:32,title:'Prova online'}]});
   if(u.pathname.endsWith('/steps'))return Response.json({success:true,data:[{id:33}]});
   if(u.pathname.endsWith('/form'))return Response.json({success:true,data:{form:{content:{buttons:[{button:1000,label:'Iniciar prova'}],inputs:[{field_id:110,label:'IDEXECPROVA',value:'STALE'}]}}}});
   assert.ok(u.pathname.endsWith('/submit'));submissions++;return Response.json({success:true,data:{token:'refreshed-unit',redirect:{link:'https://avaliacao.apprubeus.com.br/api/avaliacao/linkProva?idExecProva=STALE'}}});
  }
  if(u.hostname==='vestibular.unibalsas.edu.br'){
   if(u.pathname.includes('getApplymentDataByStep')){assert.equal(body.execute_stage_query,0);return Response.json({success:true,data:{steps:{currentStep:snapshot}}})}
   assert.ok(u.pathname.endsWith('register-portal-data'));return Response.json({success:true,data:{applyments:[{current_process:1,applyment_id:123}],applyment_information:{selective_process_id:94001},stages:[{title:'Prova online',feedback:{complementary_text:portalText}}]}});
  }
  if(u.pathname.endsWith('/linkProva')){assert.equal(u.searchParams.get('idExecProva'),'CURRENT');return new Response(null,{status:302,headers:{location:'https://avaliacao.apprubeus.com.br/execucao/inicio/unit-key/4/5/CURRENT/'}})}
  if(u.pathname.includes('/configuracao/execucao/'))return Response.json({success:true,data:{}},{headers:{'set-cookie':'lumen_session=unit; Path=/'}});
  if(u.pathname.includes('/create/')){assert.equal(body.IDEXECPROVA,'CURRENT');return Response.json({success:true,data:{token:'unit-exam'}})}
  if(u.pathname.includes('/consulta/'))return Response.json({success:true,data:exam});
  assert.ok(u.pathname.endsWith('/salve/'));assert.equal(body.IDEXECPROVA,'CURRENT');saves++;portalText='Prova já iniciada';return Response.json({success:true,data:{...exam,finalizada:1,data_envio:'unit-time'}});
 };
 async function run(screen,action,state,user={}){
  const req={screen,action:'data_exchange',data:{acao:action,estado:state,...user}};
  return flowContext.run({request:req,deadline:Date.now()+120000,worker:true,write:null},()=>routeFlowRequest(req));
 }
 try{
  const start=sealState('TELA_ORIENTACAO_PROVA',{applyment_id:'123',processo_seletivo_id:'94001',token:'unit'});
  const editor=await run('TELA_ORIENTACAO_PROVA','iniciar_redacao',start);assert.equal(editor.screen,'TELA_REDACAO');assert.equal(editor.data.tema_redacao,'Redação sobre equilíbrio.');
  const delivered=await run('TELA_REDACAO','enviar_redacao',editor.data.estado,{texto_redacao:'Um texto de teste com desenvolvimento suficiente para verificar a entrega da redação.'});
  assert.equal(delivered.screen,'TELA_REDACAO');assert.equal(delivered.data.acao_rodape,'verificar_entrega');assert.equal(delivered.data.titulo_processamento,'Redação recebida');
  portalText='Aguardando correção';
  const final=await run('TELA_REDACAO','verificar_entrega',delivered.data.estado);assert.equal(final.screen,'CONFIRMACAO');assert.match(final.data.mensagem,/Aguardando correção/);assert.equal(submissions,1);assert.equal(saves,1);assert.equal(locks,1);
 }finally{globalThis.fetch=original}
});
