import {test} from 'node:test';
import assert from 'node:assert/strict';
import {flowContext,sealState,routeFlowRequest} from '../api/flow.js';
import {createProofRouter} from '../api/prova-route.js';
process.env.FLOW_PRIVATE_KEY='unit';process.env.RBS_TOKEN='unit';
const finalData={token:'unit',applyment_id:'unit',processo_seletivo_id:'90000',eh_nota_enem:false,button_id:'123',campo_cpf_id:'1',campo_nacionalidade_id:'2',campo_ensino_medio_id:'3',campo_deficiencia_id:'4',campo_origem_id:'5',origens:[{id:'05',title:'Indicação'}]};
const user={cpf:'52998224725',nacionalidade:'10',concluiu_ensino_medio:'Sim',possui_deficiencia:'F',como_conheceu:'05'};
test('timeout de gravação não ENEM não volta ao formulário para reenviar',async()=>{
 const original=globalThis.fetch;let count=0;globalThis.fetch=async()=>{count++;const e=new Error('timeout');e.name='AbortError';throw e};
 try{
  const req={screen:'QUASE_LA',action:'data_exchange',data:{acao:'enviar_informacoes_complementares',...user,estado:sealState('QUASE_LA',finalData)}};
  const result=await flowContext.run({request:req,deadline:Date.now()+8500,write:null},()=>routeFlowRequest(req));
  assert.equal(result.screen,'PENDENTE');assert.match(result.data.mensagem,/não foi possível confirmar/);assert.equal(count,1);
 }finally{globalThis.fetch=original}
});
test('abertura da prova envia campos técnicos recebidos pelo servidor',async()=>{
 const router=createProofRouter({api:async(path)=>({data:path.startsWith('/stages')?[{id:61,title:'Prova online'}]:[{id:62}]}),getForm:async()=>({data:{form:{content:{buttons:[{button:63,label:'Iniciar prova'}],inputs:[{field_id:64,label:'Status da prova',value:'Disponível'},{field_id:65,label:'Campo técnico',value:'unit-value'}]}}}}),submitForm:async(button,fields)=>{assert.equal(button,63);assert.deepEqual(fields,[{field_id:64,value:'Disponível'},{field_id:65,value:'unit-value'}]);return {data:{redirect:{link:'https://avaliacao.apprubeus.com.br/api/avaliacao/linkProva'}}}}});
 await router.resolve({token:'unit',applyment_id:'unit',processo_seletivo_id:92001});
});
