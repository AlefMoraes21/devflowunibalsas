import {test} from 'node:test';
import assert from 'node:assert/strict';
import {routeFlowRequest,sealState,flowContext} from '../api/flow.js';
process.env.FLOW_PRIVATE_KEY='unit-receipt-key';
const data={applyment_id:'123',processo_seletivo_id:'1',token:'unit',recibo_avaliacao:{id:777,finalizada:1,data_envio:'unit-date'},sessao_avaliacao:{binding:{applicationId:'123',processId:'1',step:33,executionCode:'CURRENT',proofId:'99',executionFieldId:110,proofFieldId:111}}};
for(const [feedback,expected]of [['Prova disponível','TELA_REDACAO'],['Aguardando correção','CONFIRMACAO']])test(`consulta recibo sem novo envio: ${feedback}`,async()=>{
 const original=globalThis.fetch;const calls=[];
 globalThis.fetch=async(url,options)=>{
  calls.push(String(url));
  if(String(url).includes('/getApplymentDataByStep/'))return Response.json({success:true,data:{steps:{currentStep:{id:33,content:[{type:'text',field_id:110,label:'IDEXECPROVA',value_now:'CURRENT'},{type:'text',field_id:111,label:'IDPROVAINSCRITO',value_now:'99'}]}}}});
  if(String(url).includes('/register-portal-data'))return Response.json({success:true,data:{applyments:[{current_process:1,applyment_id:123}],applyment_information:{selective_process_id:1},stages:[{title:'Prova online',feedback:{complementary_text:feedback}}]}});
  throw Error('Unexpected mutation');
 };
 try{
  const req={action:'data_exchange',screen:'TELA_REDACAO',data:{acao:'verificar_entrega',estado:sealState('TELA_REDACAO',data)}};
  const result=await flowContext.run({request:req,deadline:Date.now()+120000,worker:true,write:null},()=>routeFlowRequest(req));
  assert.equal(result.screen,expected);assert.equal(calls.length,2);assert.ok(!calls.some(x=>/salve|create|submit/.test(x)));
  if(expected==='TELA_REDACAO'){assert.equal(result.data.processando,true);assert.equal(result.data.acao_rodape,'verificar_entrega');assert.equal(result.data.titulo_processamento,'Redação recebida')}
 }finally{globalThis.fetch=original}
});
