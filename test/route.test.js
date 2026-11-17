import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {flowContext,routeFlowRequest,sealState} from '../api/flow.js';
process.env.FLOW_PRIVATE_KEY='local-state-test-key';
process.env.RBS_TOKEN='unit-test-only';
test('seleção do curso busca turno uma vez sem enviar formulário',async()=>{
 const original=globalThis.fetch;let calls=0;
 globalThis.fetch=async(url,options)=>{calls++;assert.match(String(url),/data-source$/);assert.equal(JSON.parse(options.body).target,2);return Response.json({success:true,data:{options:[{value:'n',label:'Noturno'}],nextOptions:{}}})};
 try{
  const data={token:'unit',datasource:'q',campo_curso_id:'1',campo_turno_id:'2',cursos:[{id:'c',title:'Curso'}],turnos:[],turno_visivel:false};
  const req={action:'data_exchange',screen:'CURSO_INTERESSE',data:{acao:'buscar_turnos',curso_id:'c',estado:sealState('CURSO_INTERESSE',data)}};
  const response=await flowContext.run({deadline:Date.now()+8500,request:req,write:null},()=>routeFlowRequest(req));
  assert.equal(response.screen,'CURSO_INTERESSE');assert.equal(response.data.turno_visivel,true);assert.equal(response.data.valor_turno_id,'n');assert.equal(calls,1);
 }finally{globalThis.fetch=original}
});
