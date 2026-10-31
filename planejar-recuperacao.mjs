import {buildCanonicalProof} from "./api/proof-binding.js";
import {promptText} from "./api/prompt-text.js";
// Read-only audit. Run in the owner's Cloud Shell; credentials stay in memory.
import {execFileSync} from 'node:child_process';
import crypto from 'node:crypto';
const PROJECT='talks-servidor',REGION='southamerica-east1',SERVICE='devflowunibalsas-git';
const jobId=process.argv[2]||'3e59eaaf4a43a1b3ec145c6cea387514f04c8691ab7de47b337ff17d7d530b1a';
if(!/^[a-f0-9]{64}$/.test(jobId))throw Error('Identificador de tarefa inválido.');
function gcloud(args){try{return execFileSync('gcloud',args,{encoding:'utf8',stdio:['ignore','pipe','pipe']})}catch{throw Error('O gcloud não conseguiu ler a configuração necessária. Confira as permissões da conta no projeto.')}}
const config=JSON.parse(gcloud(['run','services','describe',SERVICE,'--project='+PROJECT,'--region='+REGION,'--format=json']));
const env=config.spec?.template?.spec?.containers?.[0]?.env??[];
function setting(name){
 const found=env.find(e=>e.name===name);if(!found)return '';
 if(found.value!==undefined)return found.value;
 const ref=found.valueFrom?.secretKeyRef;if(!ref)throw Error('Configuração não reconhecida para '+name);
 const parts=ref.name.split('/'),secret=parts.at(-1),project=parts.includes('projects')?parts[parts.indexOf('projects')+1]:PROJECT;
 return gcloud(['secrets','versions','access',ref.key||'latest','--secret='+secret,'--project='+project]);
}
const privateKey=setting('FLOW_PRIVATE_KEY').replace(/\\n/g,'\n');
if(!privateKey)throw Error('FLOW_PRIVATE_KEY não encontrada na configuração do serviço.');
const oauth=gcloud(['auth','print-access-token']).trim();
function unseal(value,salt){
 try{const key=crypto.createHash('sha256').update(privateKey).update(salt).digest(),b=Buffer.from(value,'base64url');
 const d=crypto.createDecipheriv('aes-256-gcm',key,b.subarray(0,12));d.setAuthTag(b.subarray(12,28));return JSON.parse(Buffer.concat([d.update(b.subarray(28)),d.final()]).toString('utf8'))}
 catch{throw Error('Não foi possível decifrar a tarefa. A chave pode ter sido alterada desde a execução.');}
}
async function read(url,{body,headers={}}={}){
 try{
  const r=await fetch(url,{method:body?'POST':'GET',headers:{...headers,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,redirect:'error',signal:AbortSignal.timeout(25000)});
  const raw=await r.text();let json;try{json=JSON.parse(raw)}catch{return {http:r.status,success:false,format:'non-json'}};
  return {http:r.status,success:json.success===true,json};
 }catch{return {http:null,success:false,format:'unavailable'}}
}
const norm=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase();
function inputs(node,out=[]){
 if(Array.isArray(node))node.forEach(x=>inputs(x,out));
 else if(node&&typeof node==='object'){
  if(node.field_id&&node.label)out.push(node);
  for(const k of ['content','container_content','children','components','columns','rows'])if(node[k])inputs(node[k],out);
 }
 return out;
}
function field(rows,labels,id){return rows.find(i=>labels.includes(norm(i.label)))??rows.find(i=>Number(i.field_id)===id)}
const value=i=>i?.value??i?.value_now??i?.data_value??null;
function snapshot(rows){return {
 status:value(field(rows,['status da prova'],38592)),
 executionCode:value(field(rows,['idexecprova'],38590)),
 proofId:value(field(rows,['idprovainscrito'],38620)),
 optionStatus:value(field(rows,['status da opcao'],38623)),
 offerCode:value(field(rows,['codoferta'],38552))
}}
let targetProof;
const same=(a,b)=>a==null||b==null?null:String(a).trim().toUpperCase()===String(b).trim().toUpperCase();

console.log('1/4 Lendo a tarefa existente; nenhuma inscrição ou prova será criada.');
const db=setting('FLOW_DATABASE_ID')||'unibalsas-flow';
const stored=await read(`https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/${encodeURIComponent(db)}/documents/flowJobs/${jobId}`,{headers:{Authorization:'Bearer '+oauth}});
if(!stored.json?.fields?.blob?.stringValue)throw Error(`Tarefa indisponível no Firestore (HTTP ${stored.http}). Ela pode ter expirado ou a conta não ter acesso.`);
const job=unseal(stored.json.fields.blob.stringValue,'flow-durable-jobs-v1');
const state=unseal(job.request?.data?.estado,'unibalsas-flow-state-v1');
if(!['TELA_REDACAO','TELA_ORIENTACAO_PROVA'].includes(state.screen))throw Error('Essa tarefa não contém uma sessão de redação.');
const data=state.data,session=data.sessao_avaliacao;
if(!session?.exam)throw Error('Sessão de avaliação não encontrada nesta tarefa. Use a tarefa enviar_redacao.');
const report={job:{state:job.state,action:job.request.data.acao,resultScreen:job.result?.screen,expired:job.expires<Date.now()},application:{id:String(data.applyment_id),process:String(data.processo_seletivo_id)},assessment:{executionId:session.exam.id,crmContact:session.exam.crm_contato_id,crmCourse:session.exam.crm_curso_id,externalExecutionCode:session.exam.IDEXECPROVA,crmProcess:session.exam.crm_processoseletivo_id},observations:[]};
if(job.audit?.binding)report.recordedBinding={applicationId:job.audit.binding.applicationId,proofId:job.audit.binding.proofId,executionCode:job.audit.binding.executionCode};
if(job.audit?.receipt)report.recordedReceipt=Object.fromEntries(['id','avaliacao_id','crm_contato_id','crm_curso_id','IDEXECPROVA','finalizada','data_envio'].map(k=>[k,job.audit.receipt[k]??null]));
const rbs=setting('RBS_TOKEN').trim().replace(/^Bearer\s+/i,'');
if(!rbs)throw Error('RBS_TOKEN não encontrada.');
const apiHeaders={Authorization:'Bearer '+rbs};
console.log('2/4 Consultando metadados e o formulário atual da prova, sem clicar nos botões.');
const stages=await read(`https://admin.portal.apprbs.com.br/api/v1/stages?process=${Number(data.processo_seletivo_id)}`,{headers:apiHeaders});
const stageRows=Array.isArray(stages.json?.data)?stages.json.data:[];
const matched=stageRows.filter(s=>/prova|avaliacao|redacao/.test(norm(s.title)));
report.discovery={http:stages.http,matchedStages:matched.length};
if(matched.length===1){
 const steps=await read(`https://admin.portal.apprbs.com.br/api/v1/steps?stage=${Number(matched[0].id)}`,{headers:apiHeaders});
 const rows=Array.isArray(steps.json?.data)?steps.json.data:[];
 if(rows.length===1){
  const step=Number(rows[0].id);report.discovery.step=step;
  const form=await read('https://admin.portal.apprbs.com.br/api/v1/form',{headers:apiHeaders,body:{target:step,local:'step',token:data.token}});
  report.officialForm={http:form.http,success:form.success,...snapshot(form.json?.data?.form?.content?.inputs??[])};
  const site=await read(`https://vestibular.unibalsas.edu.br/api/applyment/getApplymentDataByStep/${step}`,{body:{execute_stage_query:0,token:data.token,process_id:Number(data.processo_seletivo_id),from_local:'step'}});
  const current=site.json?.data?.steps?.currentStep;
  report.siteForm={http:site.http,success:site.success,stepMatches:Number(current?.id)===step,...snapshot(inputs(current?.content))};
  if(site.success&&current){
   function buttons(node,out=[]){if(Array.isArray(node))node.forEach(v=>buttons(v,out));else if(node&&typeof node==='object'){if(node.type==='button')out.push(node);for(const k of ['content','container_content','children','components','columns','rows'])if(node[k])buttons(node[k],out)}return out}
   const found=buttons(current.content).filter(b=>norm(b.label)==='iniciar prova');
   if(found.length===1)try{targetProof=buildCanonicalProof(current,data,{button:found[0].id,label:found[0].label},'')}catch{report.observations.push('Os parâmetros atuais da prova não foram suficientes para produzir um plano de recuperação.');}
  }

  report.comparison={assessmentMatchesOfficialExecution:same(session.exam.IDEXECPROVA,report.officialForm.executionCode),assessmentMatchesSiteExecution:same(session.exam.IDEXECPROVA,report.siteForm.executionCode)};
 }
}
console.log('3/4 Consultando a situação do portal com o token da inscrição do Flow.');
const portal=await read('https://vestibular.unibalsas.edu.br/api/applyment/register-portal-data',{body:{token:data.token,domain:'vestibular.unibalsas.edu.br/presencial',return_applyments:true}});
const p=portal.json?.data;
const currentApplication=p?.applyments?.find(x=>Number(x.current_process)===1);
const proof=p?.stages?.filter(s=>/prova|avaliacao|redacao/.test(norm(s.title)))??[];
report.portal={http:portal.http,success:portal.success,process:p?.applyment_information?.selective_process_id??null,applicationId:currentApplication?.applyment_id??null,matchesExpectedApplication:currentApplication?same(currentApplication.applyment_id,data.applyment_id):null,stages:proof.map(s=>({title:s.title,feedback:s.feedback?.complementary_text,conclusive:s.feedback?.conclusive,hasAction:Boolean(s.cta_link)}))};
console.log('4/4 Consultando a execução existente; não chamaremos create, linkProva nem salve.');
const execution=await read('https://avaliacao.apprubeus.com.br/api/avaliacao/consulta/'+encodeURIComponent(session.token),{headers:session.cookie?{Cookie:session.cookie}:{}});
const e=execution.json?.data;
report.currentExecution={http:execution.http,readable:execution.success&&Boolean(e),executionId:e?.id??null,finalized:e?.finalizada??null,sentAt:e?.data_envio??null};
if(!report.currentExecution.readable)report.observations.push('A consulta pode ficar indisponível após a finalização; isso não prova falha na entrega.');
if(report.comparison?.assessmentMatchesSiteExecution===false||report.comparison?.assessmentMatchesOfficialExecution===false)report.observations.push('O código da execução gravada difere do código atualmente associado à inscrição.');
if(report.portal.matchesExpectedApplication===false)report.observations.push('O token consultado aponta outra inscrição atual no portal.');
if(!job.audit?.receipt)report.observations.push('Esta tarefa não guardou o recibo completo de salve; o resultado CONFIRMACAO foi condicionado à finalização, mas não comprova a atualização do CRM.');
if(targetProof){
 const text=String(job.request.data.texto_redacao??'').trim();
 const answerHash=crypto.createHash('sha256').update(text).digest('hex');
 const sameAssessment=new URL(targetProof.link).searchParams.get('chave')===session.params?.chave;
 const plan={operation:'recuperar_entrega_sem_alterar_texto',applicationId:String(data.applyment_id),sourceJobId:jobId,sourceExecutionId:session.exam.id,sourceCode:session.exam.IDEXECPROVA,targetCode:targetProof.binding.executionCode,targetProofId:targetProof.binding.proofId,process:String(data.processo_seletivo_id),expectedCrmContact:session.exam.crm_contato_id,expectedCrmCourse:session.exam.crm_curso_id,sourceQuestionId:session.exam.questoes?.[0]?.id,answerCharacters:text.length,answerSha256:answerHash,sourcePromptSha256:crypto.createHash('sha256').update(promptText(session.exam.questoes?.[0]?.enunciado)).digest('hex'),sameAssessmentDefinition:sameAssessment,originalDeliveryWithinDeadline:Number(job.finished)<=Number(session.deadline),portalMatchesApplication:report.portal.matchesExpectedApplication};
 plan.digest=crypto.createHash('sha256').update(JSON.stringify(plan)).digest('hex');
 report.recoveryPlan=plan;
 report.observations.push('Este plano não executou recuperação. Qualquer entrega de recuperação precisa ser autorizada e deve conferir o destino, o enunciado, a questão e o hash do texto antes de gravar.');
}
console.log(JSON.stringify(report,null,2));
