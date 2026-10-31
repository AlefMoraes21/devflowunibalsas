// Only public process metadata is cached. Candidate tokens/forms are never shared.
const cache=new Map();
export function createProofRouter({api,getForm,submitForm}){
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
    const buttons=(form.data?.form?.content?.buttons??[]).filter(x=>x.visible!==false&&x.hidden!==true&&x.disabled!==true&&/^(iniciar prova|continuar prova)$/i.test(String(x.label??'').trim()));
    if(buttons.length!==1)throw new Error('[PROVA_BOTAO] O formulário não retornou um único botão de prova disponível.');
    const result=await submitForm(buttons[0].button,[],form.token??form.data?.token??data.token);
    const link=result.data?.redirect?.link;
    if(!link)throw new Error('[PROVA_LINK] O Rubeus não retornou o link da prova.');
    return link;
  }
  return {resolve};
}
