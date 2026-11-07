// Inert adapter for the public portal's document form. It never performs HTTP.
// Contract recovered from public chunks 2005, 3426, 4280 and 7435 (07/11/2026).
// A parsed contract is not evidence that the server accepts a submission.
export const PORTAL_MAX_FILE_BYTES = 5 * 1024 * 1024;
const MIME = {pdf:'application/pdf',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg'};
const own = (o,k) => Object.prototype.hasOwnProperty.call(o ?? {},k);
const str = v => v == null ? '' : String(v);
const missing = v => v == null || v === 'undefined' || v === 'null' || v === '';
const boolean = v => v === true || v === 1 || v === '1' || v === 'true';
const fail = text => { throw new Error(text); };
function id(v,label) {
  if(!/^\d+$/.test(str(v)) || Number(v)<1 || !Number.isSafeInteger(Number(v))) fail(`Não foi possível identificar ${label}. Atualize sua inscrição.`);
  return String(Number(v));
}
function normalized(o) { return Object.fromEntries(Object.entries(o ?? {}).map(([k,v])=>[k.toUpperCase(),v])); }
function nullable(v) { return v === undefined || v === 'undefined' ? null : v; }
function statusOf(value) {
  const v=str(value);
  if(missing(value))return 'pending';
  return {'1':'review','2':'rejected','3':'approved'}[v] ?? 'unknown';
}
function conditionOf(record,template) {
  // Preserve declarative rules. Never evaluate FormIO JavaScript or expressions.
  const definition=structuredClone(template.conditionalData ?? null);
  const logics=Array.isArray(record.logics)?structuredClone(record.logics):[];
  // configureCompProperties resets `conditional` unconditionally. Its generic
  // FormIO default is not an extra runtime condition. It also replaces the old
  // customConditional with its generated wrapper when declarative rules exist.
  // Raw record.logics replaces conditionalData.data, including an empty list.
  if(definition && Array.isArray(record.logics))definition.data=[];
  const enabled=boolean(definition?.enable) && (logics.length>0 || (definition?.data?.length ?? 0)>0);
  const arbitrary=(!enabled&&Boolean(template.customConditional))||Boolean(template.logic?.length);
  return {definition,logics,enabled,arbitrary,unresolved:enabled||arbitrary};
}
function templateOf(record) {
  if(typeof record.form_build!=='string' || !record.form_build.trim()) fail('O formulário não trouxe os dados necessários para o envio. Atualize a situação.');
  let template;
  try { template=JSON.parse(record.form_build); } catch { fail('Não foi possível ler o formulário de documentos. Atualize a situação.'); }
  if(!template || Array.isArray(template) || typeof template!=='object')fail('O formulário de documentos está incompleto.');
  return template;
}
function componentMeta(record,template) {
  const recordId=id(record.id,'o componente do formulário');
  let key=record.key,fieldId=record.field_id ?? null,fieldSettingsId=record.field_settings_id ?? null;
  if(record.field_id)key=record.field_id;
  if(record.field_id_related_to_component)key=record.field_id_related_to_component;
  if(record.field_id_to_save_cep)key=`cep-${record.field_id_to_save_cep}`;
  if(missing(key))fail('O formulário não trouxe a identificação do campo.');
  return {recordId,key:str(key),originalKey:str(record.key),fieldId,fieldSettingsId,
    relatedFieldId:record.field_id_related_to_component,cepFieldId:record.field_id_to_save_cep,
    rubeusTable:record.rubeus_table,psTable:record.ps_table,totvsTable:record.totvs_table,
    totvsField:record.totvs_field,totvsAlternativeName:record.totvs_alternative_name,
    type:template.type ?? record.type,condition:conditionOf(record,template),
    hidden:Boolean(template.hidden),cssHidden:Boolean(template.hidde),disabled:Boolean(template.disabled),
    required: boolean(template.isRequired) || (boolean(template.validatorData?.enable) && (template.validatorData?.data??[]).some(r=>['required','requiredNumber','requiredCheck'].includes(r.key)&&boolean(r.value))),
    // Store the template as data only, so unsupported behavior remains reviewable.
    template:structuredClone(template)};
}
function fieldValue(record,meta,applicant,stageQuery) {
  let known=false,value;
  if(own(meta.template,'defaultValue')) { value=meta.template.defaultValue;known=true; }
  const person=applicant.filter(a=>str(a?.field_id)===str(record.field_id));
  if(person.length>1)fail('O formulário retornou valores ambíguos para um campo.');
  if(person.length===1) { value=person[0].value;known=true; }
  if(own(record,'value_now') && record.value_now!==undefined) { value=record.value_now;known=true; }
  // For steps, buildSubmission runs last and maps stage query fields by TOTVS name.
  if(record.field_id && record.totvs_table!=null && record.totvs_field!=null && stageQuery) {
    const candidates=[`${record.totvs_table}.${record.totvs_field}`,record.totvs_alternative_name].filter(Boolean);
    const keys=Object.keys(stageQuery).filter(k=>candidates.some(c=>str(c).toLowerCase()===k.toLowerCase()));
    if(keys.length>1)fail('O formulário retornou valores ambíguos para um campo.');
    if(keys.length===1) { value=str(stageQuery[keys[0]]);known=true; }
  }
  return {known,value};
}

export function parseDocumentStep(response,{stepId,processId}={}) {
  const expectedStep=id(stepId,'o passo da inscrição'),expectedProcess=id(processId,'o processo seletivo');
  if(response?.success!==true)fail('Não foi possível consultar seus documentos. Entre novamente na sua inscrição.');
  const data=response.data,step=data?.steps?.currentStep;
  if(!step || id(step.id,'o passo retornado')!==expectedStep)fail('O formulário pertence a outra etapa. Atualize sua inscrição.');
  for(const v of [data?.process_id,data?.selective_process_id,step.process_id,step.selective_process_id])
    if(!missing(v) && id(v,'o processo retornado')!==expectedProcess)fail('O formulário pertence a outro processo seletivo.');
  const stageId=id(step.stage_id ?? data.stage?.id,'a etapa da inscrição');
  if(step.stage_id && data.stage?.id && id(data.stage.id,'a etapa retornada')!==stageId)fail('O formulário retornou etapas diferentes. Atualize a situação.');
  if(!Array.isArray(step.content))fail('O formulário não trouxe a lista de documentos.');
  const applicant=Array.isArray(step.applicantData)?step.applicantData:[];
  const stageQuery=Array.isArray(data.stage?.query?.query_data)?data.stage.query.query_data[0]:null;
  const uploads=[],buttons=[],fields=[],recordIds=new Set();
  function walk(records,ancestors=[]) {
    for(const record of records) {
      if(!record || typeof record!=='object')fail('O formulário de documentos está incompleto.');
      // Server containers can carry no form_build; children still must be read.
      if(Array.isArray(record.container_content) || record.type==='container' || Number(record.component_type_id)===6) {
        if(!Array.isArray(record.container_content))fail('O formulário de documentos está incompleto.');
        const parentCondition=record.form_build?conditionOf(record,templateOf(record)):{unresolved:false};
        walk(record.container_content,[...ancestors,{condition:parentCondition,hidden:record.form_build?Boolean(templateOf(record).hidden):false}]);
        continue;
      }
      if(!record.form_build)continue; // Editorial records do not submit values.
      const template=templateOf(record),meta=componentMeta(record,template);
      if(recordIds.has(meta.recordId))fail('O formulário retornou componentes duplicados.');
      recordIds.add(meta.recordId);
      meta.ancestorUnresolved=ancestors.some(a=>a.condition.unresolved);
      meta.ancestorHidden=ancestors.some(a=>a.hidden);
      meta.ancestors=structuredClone(ancestors);
      if(record.type==='upload' || meta.type==='upload') {
        if(!Array.isArray(record.upload_content))fail('O formulário não trouxe o catálogo de documentos.');
        const seen=new Set();
        const documents=record.upload_content.map((item,index)=>{
          const d=normalized(item),documentId=id(d.CODTIPODOCUMENTO,'o tipo de documento');
          if(seen.has(documentId))fail('O formulário retornou documentos duplicados.');seen.add(documentId);
          if(missing(d.DESCRICAODOCUMENTO))fail('O formulário retornou um documento sem descrição.');
          const status=statusOf(d.STATUSENVIO),blocked=boolean(record.block_attaching_reject_files);
          return {id:documentId,title:str(d.DESCRICAODOCUMENTO),index,status,statusCode:nullable(d.STATUSENVIO),
            required:str(d.OBRIGATORIO)==='1',reason:str(d.MOTIVORECUSA),files:Array.isArray(d.FILES)?structuredClone(d.FILES):[],
            canUpload:status==='pending'||(status==='rejected'&&!blocked),
            code:d.CODTIPODOCUMENTO,rmKey:nullable(d.CHAVERM),path:nullable(d.PATHARQUIVO),
            additional:nullable(d.ADICIONAL),additional2:nullable(d.ADICIONAL2)};
        });
        uploads.push({...meta,multipleFiles:boolean(record.upload_multiple_files),rejectBlocked:boolean(record.block_attaching_reject_files),
          declaredFileTypes:structuredClone(record.component_upload_file_types ?? null),documents});
      } else if(record.type==='button' || meta.type==='button') {
        const storeData=record.store_data ? record.store_data : template.store_data;
        buttons.push({...meta,label:str(template.label ?? record.label),storeData:boolean(storeData),
          relatedComponentId:missing(record.related_component_id)?null:str(record.related_component_id)});
      } else if(template.input!==false && !['html','content','columns','fieldset','panel'].includes(str(meta.type))) {
        fields.push({...meta,...fieldValue(record,meta,applicant,stageQuery)});
      }
    }
  }
  walk(step.content);
  if(!uploads.length)fail('Esta etapa não oferece envio de documentos pelo formulário consultado.');
  return {stepId:expectedStep,stageId,processId:expectedProcess,uploads,buttons,fields};
}

function chooseUpload(parsed,uploadId) {
  const candidates=uploadId==null?parsed.uploads:parsed.uploads.filter(u=>u.recordId===str(uploadId));
  if(candidates.length!==1)fail('Não foi possível identificar um único envio de documentos. Atualize a situação.');
  return candidates[0];
}
function conditionResult(condition,values) {
  if(!condition?.unresolved)return true;
  if(condition.arbitrary || !condition.enabled)return null;
  const rules=condition.logics.length?condition.logics:condition.definition?.data??[];
  if(!rules.length)return null;
  const results=[];
  for(const rule of rules) {
    const key=str(rule.field_compare_id ?? rule.key),operator=Number(rule.rule_logic_id ?? rule.operator);
    const ref=values.get(key),system=rule.system_value ?? rule.systemValue;
    const value=ref?.value ?? system;
    if(value==null || ['datetime','checkbox','selectboxes'].includes(ref?.type))return null;
    const actual=String(value).toLowerCase(),expected=String(rule.fixed_value ?? rule.value ?? '').toLowerCase();
    let result;
    switch(operator) {
      case 1:result=actual===expected;break;
      case 2:result=actual!==expected;break;
      case 3:result=actual.trim()==='';break;
      case 4:result=actual.trim()!=='';break;
      case 5:if(!Number.isFinite(Number(actual))||!Number.isFinite(Number(expected)))return null;result=Number(actual)>Number(expected);break;
      case 6:if(!Number.isFinite(Number(actual))||!Number.isFinite(Number(expected)))return null;result=Number(actual)<Number(expected);break;
      case 7:result=actual.includes(expected);break;
      case 8:result=!actual.includes(expected);break;
      default:return null;
    }
    results.push(result);
  }
  const combination=Number(condition.definition?.condition),action=Number(condition.definition?.action);
  if(![1,2].includes(combination)||![1,2].includes(action))return null;
  const matched=combination===1?results.some(Boolean):results.every(Boolean);
  return action===1?matched:!matched;
}
function availability(meta,values) {
  const conditions=[...(meta.ancestors??[]).map(a=>a.condition),meta.condition];
  for(const condition of conditions) {
    const result=conditionResult(condition,values);
    if(result!==true)return result;
  }
  return true;
}
function chooseButton(parsed,upload,buttonId,values) {
  let candidates=parsed.buttons.filter(b=>b.storeData && !b.hidden && !b.ancestorHidden && !b.disabled && (!b.relatedComponentId || b.relatedComponentId===upload.recordId));
  const related=candidates.filter(b=>b.relatedComponentId===upload.recordId);
  if(related.length)candidates=related;
  if(buttonId!=null)candidates=candidates.filter(b=>b.recordId===str(buttonId));
  if(candidates.length!==1)fail('O formulário não trouxe um único botão de envio disponível. Atualize a situação.');
  const button=candidates[0];
  if(availability(button,values)!==true)fail('Não foi possível confirmar se o envio está liberado. Atualize a situação.');
  return button;
}
function dataItem(meta,value) {
  const item={field_id:null,field_settings_id:null,component_id:null,key:meta.key,
    value:typeof value==='string'?value.trim():value,rubeus_table:meta.rubeusTable,ps_table:meta.psTable,type:meta.type};
  if(meta.fieldId!=null)item.field_id=meta.fieldId;else item.component_id=Number(meta.recordId);
  if(meta.fieldSettingsId!=null)item.field_settings_id=meta.fieldSettingsId;
  if(meta.relatedFieldId!==undefined)item.field_id=meta.relatedFieldId;
  if(meta.cepFieldId!==undefined)item.field_id=meta.cepFieldId;
  return item;
}
function checkedFile(file) {
  if(!file || !file.bytes || typeof file.name!=='string')fail('Anexe um arquivo para enviar.');
  const bytes=Buffer.from(file.bytes),name=file.name.split(/[\\/]/).pop().replace(/[\x00-\x1f\x7f]/g,'');
  const ext=name.split('.').pop().toLowerCase(),mime=MIME[ext];
  if(!mime || (file.mime && str(file.mime).toLowerCase()!==mime))fail('Envie um arquivo PDF, JPG, JPEG ou PNG com o formato correto.');
  if(!bytes.length || bytes.length>PORTAL_MAX_FILE_BYTES)fail('Envie um arquivo de até 5 MB.');
  const signature=ext==='pdf'?bytes.subarray(0,5).equals(Buffer.from('%PDF-')):
    ext==='png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):
    bytes.length>=3&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
  if(!signature)fail('O arquivo não corresponde ao formato informado. Selecione outro arquivo.');
  return new File([bytes],name,{type:mime});
}

export function prepareDocumentUpload(parsed,{documentId,uploadId,file,context={},buttonId}={}) {
  if(!parsed || !Array.isArray(parsed.uploads))fail('Consulte seus documentos antes de enviar.');
  if(missing(context.token))fail('Entre novamente para enviar seus documentos.');
  if(id(context.processId,'o processo da sessão')!==parsed.processId)fail('Esta sessão pertence a outro processo seletivo.');
  if(context.stepId!=null && id(context.stepId,'o passo da sessão')!==parsed.stepId)fail('Esta sessão pertence a outra etapa.');
  const upload=chooseUpload(parsed,uploadId),document=upload.documents.find(d=>d.id===str(documentId));
  if(!document)fail('Escolha um documento solicitado nesta matrícula.');
  if(!document.canUpload)fail('Este documento já foi recebido ou não está liberado para reenvio.');
  if(missing(document.rmKey))fail('O formulário não trouxe a chave deste documento. Atualize a situação.');
  const visibilityValues=new Map();
  for(const field of parsed.fields)if(field.known)visibilityValues.set(field.key,{value:field.value,type:field.type});
  // The captured upload getter returns a nonempty list only when a file is selected.
  visibilityValues.set(upload.key,{value:[{CODIGO:document.code}],type:'upload'});
  if(upload.hidden || upload.ancestorHidden || upload.disabled || availability(upload,visibilityValues)!==true)fail('Não foi possível confirmar se este documento está liberado para envio.');
  const button=chooseButton(parsed,upload,buttonId,visibilityValues),nativeFile=checkedFile(file),data=[];
  for(const field of parsed.fields) {
    if(field.hidden || field.ancestorHidden)continue;
    const visible=availability(field,visibilityValues);
    if(visible===null)fail('O formulário possui campos cuja disponibilidade precisa ser confirmada.');
    if(!visible)continue;
    if(!field.known)fail('O formulário não trouxe todos os dados necessários para o envio. Atualize a situação.');
    if(field.required && missing(field.value))fail('Há dados obrigatórios pendentes na sua inscrição.');
    if(field.value!==null)data.push(dataItem(field,field.value));
  }
  const values=upload.documents.map(d=>({CODIGO:d.code,title:d.title,STATUSENVIO:d.statusCode,
    PATHARQUIVO:d.path,CHAVERM:d.rmKey,ADICIONAL:d.additional,ADICIONAL2:d.additional2,
    files:d.id===document.id?[nativeFile]:[],value:d.id===document.id?['file_0']:null}));
  data.push(dataItem(upload,values));
  const form=new FormData();form.append('file_0',nativeFile);
  const payload={formio_comp_id:str(context.formioComponentId ?? button.template.id ?? button.key),stage_id:parsed.stageId,selective_process_id:parsed.processId,
    domainParams:context.domainParams ?? null,last_place_id:parsed.stepId,last_place_type_id:context.lastPlaceTypeId ?? 1,
    button_id:button.recordId,related_component_id:button.relatedComponentId ?? undefined,data,
    rbParams:context.rbParams ? [context.rbParams] : null,token:context.token,
    substitute_id:context.substitute_id,session_id:context.session_id,hostClient:context.hostClient,contact_id_crm:context.contact_id_crm};
  for(const [key,value] of Object.entries(payload))form.append(key,Array.isArray(value)?JSON.stringify(value):value);
  return form;
}

export function documentOptions(parsed,{uploadId}={}) {
  return chooseUpload(parsed,uploadId).documents.filter(d=>d.canUpload).map(d=>({id:d.id,title:d.required?d.title.slice(0,28)+' *':d.title.slice(0,30)}));
}
export function documentSummary(parsed,{uploadId}={}) {
  const labels={pending:'Pendente',review:'Em análise',approved:'Aprovado',rejected:'Recusado',unknown:'Situação não confirmada'};
  return chooseUpload(parsed,uploadId).documents.map(d=>`${d.title}${d.required?' *':''}: ${labels[d.status]}${d.status==='rejected'&&d.reason?` — ${d.reason}`:''}`).join('\n');
}
