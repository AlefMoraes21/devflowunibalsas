import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseDocumentStep,prepareDocumentUpload,documentOptions,documentSummary,PORTAL_MAX_FILE_BYTES} from '../api/portal-documentos.js';

// Synthetic values, modeled on the raw server records in the captured client.
// This is not a captured authenticated form or proof of server acceptance.
const template=(type,extra={})=>JSON.stringify({type,input:true,...extra});
function fixture(){
 const docs=Array.from({length:7},(_,i)=>({CODTIPODOCUMENTO:String(301+i),DESCRICAODOCUMENTO:`Documento ${i+1}`,
  STATUSENVIO:null,OBRIGATORIO:i===2?1:0,CHAVERM:`test-key-${i+1}`,PATHARQUIVO:null,ADICIONAL:null,ADICIONAL2:null,FILES:[]}));
 docs[0].STATUSENVIO='1';docs[0].FILES=[{name:'anterior.pdf',link:'https://example.invalid/read'}];
 docs[1].STATUSENVIO='3';docs[2].STATUSENVIO='2';docs[2].MOTIVORECUSA='Imagem ilegível';
 return {success:true,data:{process_id:'20383',stage:{id:661,query:{query_data:[{'PERSON.CPF':'11144477735'}]}},steps:{currentStep:{
  id:300671,stage_id:661,applicantData:[{field_id:9001,value:'anterior'}],content:[
   {type:'container',container_content:[
    {id:800,key:'38733',type:'upload',form_build:template('upload'),upload_content:docs,upload_multiple_files:true,block_attaching_reject_files:0},
    {id:99,key:'cpf',field_id:9001,type:'text',form_build:template('textfield',{hidde:true}),value_now:'valor-agora',totvs_table:'PERSON',totvs_field:'CPF'},
    {id:201,key:'send',type:'button',related_component_id:800,store_data:true,form_build:template('button',{label:'ENVIAR'})},
    {id:202,key:'portal',type:'button',store_data:false,form_build:template('button',{label:'PORTAL DO CANDIDATO'})}
   ]}
  ]
 }}}};
}
const parse=raw=>parseDocumentStep(raw??fixture(),{stepId:'300671',processId:'20383'});
const options=(extra={})=>({documentId:'304',file:{bytes:Buffer.from('%PDF-1.4 test'),name:'teste.pdf',mime:'application/pdf'},context:{token:'unit-session-token',processId:'20383'},...extra});

test('raw step records are mapped recursively, preserving dynamic identifiers and all documents',()=>{
 const raw=fixture(),parsed=parse(raw),upload=parsed.uploads[0];
 assert.equal(parsed.stepId,'300671');assert.equal(parsed.stageId,'661');assert.equal(parsed.processId,'20383');
 assert.equal(upload.recordId,'800');assert.equal(upload.key,'38733');assert.equal(upload.fieldId,null);
 assert.equal(upload.documents.length,7);assert.equal(upload.documents[0].rmKey,'test-key-1');
 assert.deepEqual(upload.documents.map(d=>d.status),['review','approved','rejected','pending','pending','pending','pending']);
 assert.equal(parsed.fields[0].value,'11144477735','stage query applies after value_now');
 assert.equal(parsed.fields[0].cssHidden,true);assert.equal(parsed.fields[0].hidden,false);
 assert.deepEqual(raw,fixture(),'parser does not mutate its input');
});

test('summary distinguishes review, approval and rejection; options include only permitted documents',()=>{
 const parsed=parse();assert.deepEqual(documentOptions(parsed).map(d=>d.id),['303','304','305','306','307']);
 assert.match(documentSummary(parsed),/Documento 1: Em análise/);
 assert.match(documentSummary(parsed),/Documento 2: Aprovado/);
 assert.match(documentSummary(parsed),/Documento 3 \*: Recusado — Imagem ilegível/);
 assert.match(documentOptions(parsed).find(d=>d.id==='303').title,/\*$/);
 const raw=fixture();raw.data.steps.currentStep.content[0].container_content[0].block_attaching_reject_files=1;
 assert.ok(!documentOptions(parse(raw)).some(d=>d.id==='303'));
});

test('one file produces binary file_0 plus all seven metadata rows and preserved technical fields',async()=>{
 const parsed=parse(),before=structuredClone(parsed),form=prepareDocumentUpload(parsed,options());
 const file=form.get('file_0');assert.equal(file.name,'teste.pdf');assert.equal(file.type,'application/pdf');
 assert.equal(await file.text(),'%PDF-1.4 test');
 const data=JSON.parse(form.get('data'));assert.equal(data.length,2);
 assert.equal(data[0].field_id,9001);assert.equal(data[0].value,'11144477735','CSS-hidden technical value is included');
 const item=data[1];assert.equal(item.component_id,800);assert.equal(item.field_id,null);assert.equal(item.field_settings_id,null);assert.equal(item.key,'38733');
 assert.ok(!Object.hasOwn(item,'rubeus_table'),'undefined nested values omitted by JSON serialization');
 assert.equal(item.value.length,7);
 assert.deepEqual(item.value[3],{CODIGO:'304',title:'Documento 4',STATUSENVIO:null,PATHARQUIVO:null,CHAVERM:'test-key-4',ADICIONAL:null,ADICIONAL2:null,files:[{}],value:['file_0']});
 assert.deepEqual(item.value[0].files,[]);assert.equal(item.value[0].STATUSENVIO,'1');assert.equal(item.value[0].value,null);
 assert.equal(form.get('button_id'),'201');assert.equal(form.get('related_component_id'),'800');
 assert.equal(form.get('formio_comp_id'),'send','server key is a correlation fallback, separate from button_id');
 assert.equal(form.get('stage_id'),'661');assert.equal(form.get('selective_process_id'),'20383');assert.equal(form.get('last_place_id'),'300671');
 assert.equal(form.get('substitute_id'),'undefined');assert.equal(form.get('domainParams'),'null');assert.equal(form.get('rbParams'),'null');
 assert.deepEqual(parsed,before,'encoding does not mutate parsed document state');
});

test('no fixed document/button identifiers: a different form keeps its own code and key',()=>{
 const raw=fixture(),records=raw.data.steps.currentStep.content[0].container_content;
 records[0].id=456;records[0].key='dynamic-upload';records[0].upload_content[3].CODTIPODOCUMENTO='999';records[0].upload_content[3].CHAVERM='different-key';
 records[2].id=987;records[2].related_component_id=456;
 const form=prepareDocumentUpload(parse(raw),options({documentId:'999',uploadId:'456'}));
 assert.equal(form.get('button_id'),'987');const item=JSON.parse(form.get('data'))[1];assert.equal(item.component_id,456);assert.equal(item.key,'dynamic-upload');assert.equal(item.value[3].CHAVERM,'different-key');
});

test('wrong step, process, stage or unsuccessful lookup cannot be used for upload',()=>{
 for(const mutate of [r=>r.success=false,r=>r.data.steps.currentStep.id=9,r=>r.data.process_id=9,r=>r.data.stage.id=9]){
  const raw=fixture();mutate(raw);assert.throws(()=>parse(raw));
 }
 assert.throws(()=>parseDocumentStep(fixture(),{stepId:'300671',processId:null}));
 assert.throws(()=>prepareDocumentUpload(parse(),options({context:{token:'unit',processId:'other'}})));
 assert.throws(()=>prepareDocumentUpload(parse(),options({context:{token:'',processId:'20383'}})));
 assert.throws(()=>prepareDocumentUpload(parse(),options({context:{token:'unit',processId:'20383',stepId:'7'}})));
});

test('review/approved/unknown documents cannot be replaced; rejected documents honor blocking',()=>{
 for(const documentId of ['301','302','unknown'])assert.throws(()=>prepareDocumentUpload(parse(),options({documentId})));
 let raw=fixture();raw.data.steps.currentStep.content[0].container_content[0].upload_content[3].STATUSENVIO='unrecognized';
 assert.throws(()=>prepareDocumentUpload(parse(raw),options()),/não está liberado/);
 raw=fixture();raw.data.steps.currentStep.content[0].container_content[0].block_attaching_reject_files=1;
 assert.throws(()=>prepareDocumentUpload(parse(raw),options({documentId:'303'})),/não está liberado/);
 assert.doesNotThrow(()=>prepareDocumentUpload(parse(),options({documentId:'303'})));
});

test('ambiguous uploads, duplicate document codes and missing RM key are refused',()=>{
 let raw=fixture(),records=raw.data.steps.currentStep.content[0].container_content;
 records.push({...structuredClone(records[0]),id:801,key:'second'});
 const parsed=parse(raw);assert.throws(()=>prepareDocumentUpload(parsed,options()),/único envio/);
 raw=fixture();records=raw.data.steps.currentStep.content[0].container_content;
 records[0].upload_content[1].CODTIPODOCUMENTO='301';assert.throws(()=>parse(raw),/duplicados/);
 raw=fixture();raw.data.steps.currentStep.content[0].container_content[0].upload_content[3].CHAVERM=null;
 assert.throws(()=>prepareDocumentUpload(parse(raw),options()),/chave/);
});

test('navigation button is not treated as upload; unresolved button/ancestor condition fails closed',()=>{
 let raw=fixture(),records=raw.data.steps.currentStep.content[0].container_content;
 records[2].store_data=false;assert.throws(()=>prepareDocumentUpload(parse(raw),options()),/botão/);
 raw=fixture();records=raw.data.steps.currentStep.content[0].container_content;
 records[2].form_build=template('button',{conditionalData:{enable:true,data:[{key:'x'}]}});
 assert.throws(()=>prepareDocumentUpload(parse(raw),options()),/envio está liberado/);
 raw=fixture();raw.data.steps.currentStep.content[0].form_build=template('container',{customConditional:'never execute this'});
 assert.throws(()=>prepareDocumentUpload(parse(raw),options()),/liberado/);
});

test('missing hidden technical value is not silently omitted',()=>{
 const raw=fixture(),record=raw.data.steps.currentStep.content[0].container_content[1];
 delete record.value_now;delete record.totvs_table;raw.data.steps.currentStep.applicantData=[];
 assert.throws(()=>prepareDocumentUpload(parse(raw),options()),/todos os dados/);
 record.form_build=template('textfield',{defaultValue:'trusted-default',hidde:true});
 assert.equal(JSON.parse(prepareDocumentUpload(parse(raw),options()).get('data'))[0].value,'trusted-default');
});

test('declarative nonempty-upload rule can enable its related submit without executing JavaScript',()=>{
 const raw=fixture(),button=raw.data.steps.currentStep.content[0].container_content[2];
 button.logics=[{field_compare_id:'38733',rule_logic_id:4,fixed_value:'',system_value:null}];
 button.form_build=template('button',{id:'trusted-template-id',conditionalData:{enable:true,condition:2,action:1}});
 let form=prepareDocumentUpload(parse(raw),options());
 assert.equal(form.get('button_id'),'201');assert.equal(form.get('formio_comp_id'),'trusted-template-id');
 form=prepareDocumentUpload(parse(raw),options({context:{token:'unit',processId:'20383',formioComponentId:'trusted-service-id'}}));
 assert.equal(form.get('formio_comp_id'),'trusted-service-id');
 button.logics[0].rule_logic_id=3;
 assert.throws(()=>prepareDocumentUpload(parse(raw),options()),/envio está liberado/,'empty-upload predicate is false after selecting a file');
});

test('known equality condition and AND/OR composition are data-only; unknown operators fail closed',()=>{
 const raw=fixture(),button=raw.data.steps.currentStep.content[0].container_content[2];
 button.logics=[{field_compare_id:'38733',rule_logic_id:4},{field_compare_id:'9001',rule_logic_id:1,fixed_value:'11144477735'}];
 button.form_build=template('button',{conditionalData:{enable:true,condition:2,action:1}});
 assert.doesNotThrow(()=>prepareDocumentUpload(parse(raw),options()));
 button.logics[1].fixed_value='other';assert.throws(()=>prepareDocumentUpload(parse(raw),options()),/envio está liberado/);
 button.form_build=template('button',{conditionalData:{enable:true,condition:1,action:1}});
 assert.doesNotThrow(()=>prepareDocumentUpload(parse(raw),options()));
 button.logics[0].rule_logic_id=999;
 assert.throws(()=>prepareDocumentUpload(parse(raw),options()),/envio está liberado/);
});

test('portal resets builtin conditional and replaces an old customConditional with declarative rules',()=>{
 const raw=fixture(),button=raw.data.steps.currentStep.content[0].container_content[2];
 button.form_build=template('button',{conditional:{show:true,when:'old',eq:'old'}});
 assert.doesNotThrow(()=>prepareDocumentUpload(parse(raw),options()),'builtin conditional is cleared by captured client');
 button.logics=[{field_compare_id:'38733',rule_logic_id:4}];
 button.form_build=template('button',{conditionalData:{enable:true,condition:2,action:1},customConditional:'old arbitrary code must never execute'});
 assert.doesNotThrow(()=>prepareDocumentUpload(parse(raw),options()),'known declarative rules replace old custom script');
 button.logics=[];
 assert.throws(()=>prepareDocumentUpload(parse(raw),options()),/envio está liberado/,'without active declarative rules, arbitrary custom condition remains unsupported');
});

test('empty raw logics clears stale conditionalData.data just like configureCompProperties',()=>{
 const raw=fixture(),button=raw.data.steps.currentStep.content[0].container_content[2];
 button.logics=[];
 button.form_build=template('button',{conditionalData:{enable:true,condition:2,action:1,data:[{key:'38733',operator:3}]}});
 assert.doesNotThrow(()=>prepareDocumentUpload(parse(raw),options()));
});

test('malformed form_build is data error, not executable code',()=>{
 const raw=fixture();raw.data.steps.currentStep.content[0].container_content[0].form_build='(()=>{throw Error("execute")})()';
 assert.throws(()=>parse(raw),/ler o formulário/);
});

test('files obey 5 MiB, allowed extension, declared MIME and signatures',()=>{
 const parsed=parse();
 for(const file of [
  {bytes:Buffer.from('%PDF-1.4'),name:'x.exe',mime:'application/pdf'},
  {bytes:Buffer.from('%PDF-1.4'),name:'x.pdf',mime:'image/png'},
  {bytes:Buffer.from('bad'),name:'x.pdf',mime:'application/pdf'},
  {bytes:Buffer.alloc(0),name:'x.pdf',mime:'application/pdf'}
 ])assert.throws(()=>prepareDocumentUpload(parsed,options({file})));
 const bytes=Buffer.alloc(PORTAL_MAX_FILE_BYTES);bytes.write('%PDF-1.4');
 assert.equal(prepareDocumentUpload(parsed,options({file:{bytes,name:'x.pdf'}})).get('file_0').size,PORTAL_MAX_FILE_BYTES);
 assert.throws(()=>prepareDocumentUpload(parsed,options({file:{bytes:Buffer.concat([bytes,Buffer.from([0])]),name:'x.pdf'}})),/5 MB/);
 for(const [name,bytes,mime] of [
  ['x.png',Buffer.from([137,80,78,71,13,10,26,10]),'image/png'],
  ['x.JPG',Buffer.from([255,216,255]),'image/jpeg'],
  ['x.jpeg',Buffer.from([255,216,255]),'image/jpeg']
 ])assert.equal(prepareDocumentUpload(parsed,options({file:{name,bytes,mime}})).get('file_0').type,mime);
});
