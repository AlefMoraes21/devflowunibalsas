// Only public process metadata is cached. Candidate tokens/forms are never shared.
const cache=new Map();
const norm=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase();
export function chooseProofButton(buttons,inputs){
  const candidates=buttons.filter(x=>x.visible!==false&&x.hidden!==true&&x.disabled!==true&&/^(iniciar prova|continuar prova)$/.test(norm(x.label)));
  const statusField=inputs.find(i=>norm(i.label)==='status da prova');
  const optionField=inputs.find(i=>norm(i.label)==='status da opcao');
  const value=i=>i?.value??i?.value_now??i?.data_value;
  const status=norm(value(statusField));
  if(['finalizada','corrigida'].includes(status))throw new Error('[PROVA_ENCERRADA] Esta prova já está finalizada ou corrigida. Confira o portal.');
  if(!candidates.length)throw new Error('[PROVA_BOTAO] O formulário não retornou botões de iniciar ou continuar prova.');
  if(optionField&&String(value(optionField))!=='0')throw new Error('[PROVA_OPCAO] A situação atual da opção não permite abrir a prova. Confira o portal.');
  if(candidates.length===1)return candidates[0];
  if(!statusField)throw new Error('[PROVA_STATUS] Os botões de início e continuação precisam da situação atual da prova.');
  const label=status==='iniciada'?'continuar prova':'iniciar prova';
  const matching=candidates.filter(b=>norm(b.label)===label);
  if(matching.length!==1)throw new Error('[PROVA_BOTAO] Não foi possível identificar a ação correspondente à situação atual da prova.');
  return matching[0];
}
function collectInputs(node,out=[]){
  if(Array.isArray(node))for(const x of node)collectInputs(x,out);
  else if(node&&typeof node==='object'){
    if(node.field_id&&node.label)out.push(node);
    for(const key of ['content','children','components','columns','rows'])if(node[key])collectInputs(node[key],out);
  }
  return out;
}
async function readSiteStatus(step,data){
  const r=await fetch(`https://vestibular.unibalsas.edu.br/api/applyment/getApplymentDataByStep/${step}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({execute_stage_query:0,token:data.token,process_id:Number(data.processo_seletivo_id),from_local:'step'}),signal:AbortSignal.timeout(3000)});
  const raw=await r.text();let j;
  try{j=JSON.parse(raw)}catch{throw new Error(`[PROVA_STATUS] A consulta de situação retornou resposta não JSON (HTTP ${r.status}).`)}
  if(!r.ok||j.success!==true||Number(j.data?.steps?.currentStep?.id)!==Number(step))throw new Error('[PROVA_STATUS] Não foi possível confirmar a situação da prova nesta sessão.');
  return collectInputs(j.data.steps.currentStep.content);
}
export function createProofRouter({api,getForm,submitForm,readStatus=readSiteStatus}){
  async function discover(process){
    const id=Number(process);
    if(!Number.isSafeInteger(id)||id<=0)throw new Error('[PROVA_PROCESSO] Processo inválido.');
    const saved=cache.get(id);if(saved?.expires>Date.now())return saved.step;
    const stages=await api(`/stages?process=${id}`);
    const matches=(Array.isArray(stages.data)?stages.data:[]).filter(s=>/avaliação|avaliacao|prova|redação|redacao/i.test(s.title??''));
    if(matches.length!==1)throw new Error('[PROVA_ETAPA] Não foi possível identificar uma única etapa de avaliação.');
    const steps=await api(`/steps?stage=${Number(matches[0].id)}`);
    const rows=Array.isArray(steps.data)?steps.data:[];
    if(rows.length!==1||!Number.isSafeInteger(Number(rows[0].id))||Number(rows[0].id)<=0)throw new Error('[PROVA_PASSO] A etapa precisa de um mapeamento adicional de passos.');
    const step=Number(rows[0].id);cache.set(id,{step,expires:Date.now()+300000});return step;
  }
  async function resolve(data){
    if(!data.token||!data.applyment_id)throw new Error('[PROVA_SESSAO] Inscrição não confirmada. Consulte o portal.');
    const step=await discover(data.processo_seletivo_id);
    const form=await getForm(step,'step',data.token);
    const buttons=form.data?.form?.content?.buttons??[];
    let inputs=form.data?.form?.content?.inputs??[];
    const recognized=buttons.filter(b=>/^(iniciar prova|continuar prova)$/.test(norm(b.label)));
    if(recognized.length!==1&&!inputs.some(i=>norm(i.label)==='status da prova'))inputs=await readStatus(step,{...data,token:form.token??form.data?.token??data.token});
    console.info(JSON.stringify({event:'proof_buttons',recognized:recognized.length,total:buttons.length,hasStatus:inputs.some(i=>norm(i.label)==='status da prova')}));
    const button=chooseProofButton(buttons,inputs);
    const result=await submitForm(button.button,[],form.token??form.data?.token??data.token);
    const link=result.data?.redirect?.link;
    if(!link)throw new Error('[PROVA_LINK] O Rubeus não retornou o link da prova.');
    return link;
  }
  return {resolve};
}
