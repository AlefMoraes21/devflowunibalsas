import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
process.env.FLOW_PRIVATE_KEY??='local-unit-key';
const {responseForScreen,openState}=await import('../api/flow.js');
const {createMatricula}=await import('../api/matricula.js');
const {createJobEngine}=await import('../api/jobs.js');
const {listDocuments}=await import('../api/documentos.js');

// Regressão: "Dropdown should NOT have additional properties (descricao)" em DOCUMENTOS_INSCRICAO
// (Transferência 14150234, Diploma 14150338, ENEM 14150473). O Flow só aceita {id,title}.
const RM=[{CODDOCUMENTO:28,DESCRICAO:'HISTÓRICO ACADÊMICO'},{CODDOCUMENTO:10,DESCRICAO:'DIPLOMA DE GRADUAÇÃO'},{CODDOCUMENTO:25,DESCRICAO:'BOLETIM NOTA ENEM'}];
const EXPECTED=[{id:'28',title:'HISTÓRICO ACADÊMICO'},{id:'10',title:'DIPLOMA DE GRADUAÇÃO'},{id:'25',title:'BOLETIM NOTA ENEM'}];
const rmFetcher=async()=>Response.json({resultado:RM});

function assertCleanOptions(list){
 assert.deepEqual(list,EXPECTED);
 assert.ok(!JSON.stringify(list).includes('descricao'),'payload final não pode conter descricao');
 for(const o of list){assert.deepEqual(Object.keys(o).sort(),['id','title']);assert.equal(typeof o.id,'string')}
}
async function internalList(){return listDocuments(226,1,{fetcher:rmFetcher})}

test('modelo interno mantém descricao; payload do Flow leva só id/title com os três documentos',async()=>{
 const list=await internalList();
 assert.deepEqual(list.map(d=>d.descricao),RM.map(d=>d.DESCRICAO),'descricao segue no modelo interno');
 const res=responseForScreen('DOCUMENTOS_INSCRICAO',{documentos:list,enviados:'Nenhum documento enviado ainda.',texto:'x'});
 assert.equal(res.screen,'DOCUMENTOS_INSCRICAO');
 assertCleanOptions(res.data.documentos);
 assert.ok(!JSON.stringify(res).includes('"descricao"'),'nenhum campo descricao em lugar algum do payload visível');
 // O estado selado (cifrado) preserva descricao para o envio do arquivo.
 const sealed=openState(res.data.estado,'DOCUMENTOS_INSCRICAO');
 assert.deepEqual(sealed.documentos.map(d=>d.descricao),RM.map(d=>d.DESCRICAO));
});

test('resposta imediata: abrir a etapa de documentos pelo adaptador não vaza descricao',async()=>{
 const docs={listDocuments:()=>internalList()};
 const form={id:1,content:{inputs:[{label:'Documento',field_id:1}],buttons:[]}};
 const m=createMatricula({api:async()=>({}),getForm:async()=>({data:{form}}),submitForm:async()=>({}),getDataSource:async()=>({}),render:responseForScreen,academicId:()=>226,docs});
 const res=await m.open({cpf:'11144477735',processo_seletivo_id:'20385',token:'t'},{step:300700,title:'Documentos inscrição'});
 assert.equal(res.screen,'DOCUMENTOS_INSCRICAO');
 assertCleanOptions(res.data.documentos);
 assert.ok(res.data.texto.includes('HISTÓRICO ACADÊMICO'),'o texto da tela ainda usa a descrição');
 assert.match(res.data.texto,/PDF, JPG ou PNG, até 740 KB/);
});

function memory(){const map=new Map();return {async create(id,r){if(map.has(id))return false;map.set(id,{record:structuredClone(r),version:1});return true},async get(id){return structuredClone(map.get(id)??null)},async update(id,r,v){const p=map.get(id);if(p.version!==v)return false;map.set(id,{record:structuredClone(r),version:v+1});return true}}}

test('após consultar_tarefa (processando e concluído) a lista segue sem descricao',async()=>{
 const list=await internalList();
 const docsResponse=()=>responseForScreen('DOCUMENTOS_INSCRICAO',{documentos:list,enviados:'Nenhum documento enviado ainda.',texto:'x'});
 const estado=docsResponse().data.estado;
 const store=memory();
 const engine=createJobEngine({store,enqueue:async()=>{},openState,render:responseForScreen,waitMs:0,run:async()=>docsResponse()});
 const base={action:'data_exchange',screen:'DOCUMENTOS_INSCRICAO',flow_token:'tok-docs'};
 // 1) clique em Continuar: processando (resposta com estado selado completo)
 const pending=await engine.route({...base,data:{acao:'atualizar_portal',estado}});
 assert.equal(pending.data.processando,true);assert.equal(pending.data.acao_rodape,'consultar_tarefa');
 assertCleanOptions(pending.data.documentos);
 // 2) Verificar andamento ainda em fila
 const again=await engine.route({...base,data:{acao:'consultar_tarefa',estado:pending.data.estado}});
 assertCleanOptions(again.data.documentos);
 // 3) worker conclui e Verificar andamento devolve a tela final
 await engine.worker(pending.data.job_id,(await import('../api/cloud-store.js')).workerSignature(pending.data.job_id));
 const done=await engine.route({...base,data:{acao:'consultar_tarefa',estado:pending.data.estado}});
 assert.equal(done.screen,'DOCUMENTOS_INSCRICAO');assert.equal(done.data.processando,false);
 assertCleanOptions(done.data.documentos);
 assert.ok(!JSON.stringify(done).includes('"descricao"'));
});

test('envio continua funcionando: o estado selado ainda resolve o nome pela descricao e id/title são preservados',async()=>{
 const list=await internalList();
 const res=responseForScreen('DOCUMENTOS_INSCRICAO',{documentos:list,enviados:'Nenhum documento enviado ainda.',texto:'x',cpf:'11144477735',processo_seletivo_id:'20385'});
 const sealed=openState(res.data.estado,'DOCUMENTOS_INSCRICAO');
 for(const doc of EXPECTED){
  const saved=[];
  const docs={saveDocument:async a=>{saved.push(a);return {nomeArquivo:'teste.pdf'}}};
  const m=createMatricula({api:async()=>({}),getForm:async()=>({}),submitForm:async()=>({}),getDataSource:async()=>({}),render:responseForScreen,academicId:()=>226,docs});
  const out=await m.sendDocument({...sealed,documento:doc.id,arquivo:[{file_name:'teste.pdf'}]});
  assert.equal(saved[0].codDocumento,doc.id);
  assert.match(out.data.enviados,new RegExp(`✅ ${doc.title} recebido`));
  assertCleanOptions(out.data.documentos);
 }
});

test('contrato publicado: documentos declara só id/title e todas as listas de Dropdown mantêm esse formato',async()=>{
 const j=JSON.parse(await readFile(new URL('../flow-waba.json',import.meta.url)));
 for(const s of j.screens)for(const [k,v] of Object.entries(s.data??{}))if(v.type==='array'&&v.items?.properties){
  assert.deepEqual(Object.keys(v.items.properties).sort(),['id','title'],`${s.id}.${k}`);
 }
 // Nenhuma lista de opções com campos extras passa pelo serializador.
 const noisy=[{id:7,title:'A',descricao:'x',extra:1}];
 for(const k of ['cursos','turnos','anos_enem','origens','opcoes_responsavel','ufs','cidades_natal','racas','estados_civis','anos','escolas']){
  const screen={cursos:'CURSO_INGRESSO',turnos:'CURSO_INGRESSO',anos_enem:'CURSO_ENEM',origens:'QUASE_LA',opcoes_responsavel:'RESP_FINANCEIRO',ufs:'ENDERECO',cidades_natal:'ENDERECO',racas:'IDENTIDADE',estados_civis:'IDENTIDADE',anos:'IDENTIDADE',escolas:'IDENTIDADE'}[k];
  assert.deepEqual(responseForScreen(screen,{[k]:noisy}).data[k],[{id:'7',title:'A'}],k);
 }
});
