const SITE='https://vestibular.unibalsas.edu.br';
const ASSESSMENT='https://avaliacao.apprubeus.com.br';
export const normalize=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase();
function nodes(node,out=[]){if(Array.isArray(node))node.forEach(n=>nodes(n,out));else if(node&&typeof node==='object'){if(node.type)out.push(node);for(const k of ['content','container_content','children','components','columns','rows'])if(node[k])nodes(node[k],out)}return out}
export function snapshotValues(snapshot){
 const values=new Map();for(const row of snapshot.applicantData??[])if(row.field_id)values.set(Number(row.field_id),row.value);
 for(const row of nodes(snapshot.content))if(row.field_id){
  if(Object.hasOwn(row,'value_now'))values.set(Number(row.field_id),row.value_now);
  else if(Object.hasOwn(row,'value'))values.set(Number(row.field_id),row.value);
  else if(!values.has(Number(row.field_id)))values.set(Number(row.field_id),row.data_value??null);
 }
 return values;
}
const same=(a,b)=>String(a??'').trim().toUpperCase()===String(b??'').trim().toUpperCase();
export function buildCanonicalProof(snapshot,data,button,previousLink){
 const values=snapshotValues(snapshot),all=nodes(snapshot.content);
 let choices=all.filter(n=>n.type==='button'&&(Number(n.id)===Number(button.button)||Number(n.related_component_id)===Number(button.button)));
 if(!choices.length)choices=all.filter(n=>n.type==='button'&&normalize(n.label)===normalize(button.label));
 if(choices.length!==1)throw new Error('[PROVA_VINCULO] Não foi possível identificar os parâmetros atuais da prova.');
 const redirects=(choices[0].forwardData??[]).filter(r=>{try{const u=new URL(r.link);return u.origin===ASSESSMENT&&u.pathname==='/api/avaliacao/linkProva'}catch{return false}});
 if(redirects.length!==1)throw new Error('[PROVA_VINCULO] O formulário não retornou um único destino de avaliação.');
 const redirect=redirects[0],url=new URL(redirect.link),ids={};
 for(const p of redirect.parameters??[]){
  url.searchParams.delete(p.name);
  const value=Number(p.parameter_type_id)===2?p.fixed_value:values.get(Number(p.field_id));
  if(value!==null&&value!==undefined&&String(value)!=='')url.searchParams.set(p.name,String(value));
  if(p.field_id)ids[p.name]=Number(p.field_id);
 }
 for(const key of ['chave','codigoContato','codigoOferta','idExecProva'])if(!url.searchParams.get(key))throw new Error(`[PROVA_VINCULO] O parâmetro ${key} não foi confirmado pelo formulário atual.`);
 const code=url.searchParams.get('idExecProva');
 const proof=all.find(n=>normalize(n.label)==='idprovainscrito');
 const proofId=proof?values.get(Number(proof.field_id)):null;
 if(proofId==null||String(proofId)==='')throw new Error('[PROVA_VINCULO] O registro da prova distribuída não foi confirmado.');
 let redirectMatches=null;try{redirectMatches=same(new URL(previousLink).searchParams.get('idExecProva'),code)}catch{}
 return {link:url.href,binding:{applicationId:String(data.applyment_id),processId:String(data.processo_seletivo_id),step:Number(snapshot.id),proofId:String(proofId),executionCode:code,executionFieldId:ids.idExecProva,proofFieldId:Number(proof.field_id),buttonLabel:button.label,candidateCode:url.searchParams.get('codigoContato'),offerCode:url.searchParams.get('codigoOferta'),redirectMatched:redirectMatches}};
}
async function post(path,body,{fetcher=fetch,remaining=()=>30000}={}){
 const timeout=Math.min(25000,remaining()-200);if(timeout<250)throw new Error('[PROVA_VINCULO] Tempo insuficiente para conferir o vínculo.');
 const r=await fetcher(SITE+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(timeout)});
 const raw=await r.text();let json;try{json=JSON.parse(raw)}catch{throw new Error(`[PROVA_VINCULO] A consulta de vínculo retornou resposta não JSON (HTTP ${r.status}).`)}
 if(!r.ok||json.success!==true)throw new Error(`[PROVA_VINCULO] Não foi possível consultar o vínculo (HTTP ${r.status}).`);
 return json.data;
}
export async function loadProofSnapshot(step,data,options){
 const result=await post(`/api/applyment/getApplymentDataByStep/${Number(step)}`,{execute_stage_query:0,token:data.token,process_id:Number(data.processo_seletivo_id),from_local:'step'},options);
 const snapshot=result?.steps?.currentStep;
 if(Number(snapshot?.id)!==Number(step))throw new Error('[PROVA_VINCULO] O passo retornado pertence a outra etapa.');
 return snapshot;
}
export async function loadPortal(data,options){
 const p=await post('/api/applyment/register-portal-data',{token:data.token,domain:'vestibular.unibalsas.edu.br/presencial',return_applyments:true},options);
 const current=p?.applyments?.filter(x=>Number(x.current_process)===1)??[];
 if(current.length!==1||!same(current[0].applyment_id,data.applyment_id)||!same(p?.applyment_information?.selective_process_id,data.processo_seletivo_id))throw new Error('[PROVA_VINCULO] O portal não confirmou esta inscrição como a inscrição atual da sessão.');
 return {applicationId:String(current[0].applyment_id),processId:String(p.applyment_information.selective_process_id),stages:(p.stages??[]).filter(s=>/prova|avaliacao|redacao/.test(normalize(s.title))).map(s=>({title:s.title,feedback:s.feedback?.complementary_text??'',conclusive:s.feedback?.conclusive,hasAction:Boolean(s.cta_link)}))};
}
export function assertCurrentBinding(snapshot,data,binding){
 if(!binding||!same(data.applyment_id,binding.applicationId)||!same(data.processo_seletivo_id,binding.processId)||Number(snapshot.id)!==Number(binding.step))throw new Error('[PROVA_VINCULO] Esta sessão não possui vínculo validado com a inscrição atual.');
 const values=snapshotValues(snapshot);
 if(!same(values.get(binding.executionFieldId),binding.executionCode)||!same(values.get(binding.proofFieldId),binding.proofId))throw new Error('[PROVA_VINCULO] A inscrição aponta outra execução de prova. O texto foi preservado; não foi enviado para uma execução diferente.');
 return true;
}
export function portalConfirmsDelivery(portal){
 return portal.stages.some(s=>{const text=normalize(s.feedback);return !/nao.*finaliz|nao.*envi|disponivel|nao iniciad|ja iniciad|em andamento|aguardando.*realiza/.test(text)&&/aguardando.*correc|aguarde.*correc|correcao.*pendente|em correcao|enviad|corrigid|aprovad|reprovad|finalizad/.test(text)});
}
