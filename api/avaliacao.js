import {claimProofDelivery} from "./cloud-store.js";
import crypto from 'node:crypto';
const BASE='https://avaliacao.apprubeus.com.br';
export class ResultadoIncerto extends Error {}
export function createAssessment({fetcher=fetch,remaining=()=>8000,markWrite=()=>{},observe=()=>{},maxRequestMs=4500}={}) {
  async function call(path,{body,cookie,method=body?'POST':'GET',manual=false}={}) {
    const budget=Math.min(maxRequestMs,remaining()-150);
    if(budget<250)throw new Error('Tempo insuficiente. Reabra esta etapa pelo portal.');
    const started=Date.now();observe({phase:path.startsWith("/api/avaliacao/consulta/")?"consulta":path.split("?")[0],state:"begin"});
    const r=await fetcher(BASE+path,{method,redirect:manual?'manual':'error',headers:{...(body?{'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(budget)});
    observe({phase:path.startsWith("/api/avaliacao/consulta/")?"consulta":path.split("?")[0],state:"end",http:r.status,ms:Date.now()-started});
    const cookies=r.headers.getSetCookie?.()??[];
    const nextCookie=[...(cookie??'').split('; ').filter(Boolean),...cookies.map(x=>x.split(';')[0])];
    const merged=[...new Map(nextCookie.map(x=>[x.split('=')[0],x])).values()].join('; ');
    if(manual)return {response:r,cookie:merged};
    const j=await r.json();
    if(!r.ok||j.success!==true)throw new Error('O módulo de avaliação não confirmou a operação.');
    return {data:j.data,cookie:merged};
  }
  async function init(link) {
    const url=new URL(link);
    if(url.origin!==BASE||url.pathname!=='/api/avaliacao/linkProva')throw new Error('Link de avaliação inválido.');
    const {response,cookie:linkCookie}=await call(url.pathname+url.search,{manual:true});
    if(![301,302,303,307,308].includes(response.status))throw new Error('A avaliação não retornou a execução.');
    const to=new URL(response.headers.get('location'),BASE);
    const m=to.pathname.match(/^\/execucao\/inicio\/([^/]+)\/(\d+)\/(\d+)\/([^/]+)(?:\/([^/]+))?\/?$/);
    if(to.origin!==BASE||!m)throw new Error('Execução da avaliação inválida.');
    const code=decodeURIComponent(m[4]);
    // The shipped client maps numeric route codes to codUsuarioPS, not IDEXECPROVA.
    const params={chave:decodeURIComponent(m[1]),crm_contato_id:m[2],crm_curso_id:m[3],IDEXECPROVA:/^\d+$/.test(code)?null:code,crm_processoseletivo_id:null,codUsuarioPS:/^\d+$/.test(code)?code:m[5]?decodeURIComponent(m[5]):null};
    const config=await call('/api/avaliacao/configuracao/execucao/',{body:params,cookie:linkCookie});
    const created=await call('/api/avaliacao/create/',{body:params,cookie:config.cookie});
    if(!created.data?.token)throw new Error('Token de execução ausente.');
    const session={token:created.data.token,cookie:created.cookie,params};
    const read=await call('/api/avaliacao/consulta/'+encodeURIComponent(session.token),{cookie:session.cookie});
    const exam=read.data;
    if(!exam?.id||!exam.avaliacao_id||!exam.crm_id||Number(exam.finalizada)!==0||exam.questoes?.length!==1)throw new Error('Prova indisponível ou formato não suportado. Abra o portal.');
    for(const key of ['crm_contato_id','crm_curso_id',...['IDEXECPROVA','codUsuarioPS'].filter(k=>params[k]!=null)])if(String(exam[key])!==String(params[key]))throw new Error('A execução retornada não corresponde à inscrição.');
    const minutes=Number(exam.tempoRestante??exam.tempo);
    if(!Number.isFinite(minutes)||minutes<=0)throw new Error('Prazo da avaliação indisponível.');
    return {...session,cookie:read.cookie,exam,startedAt:Date.now(),deadline:Date.now()+minutes*60000};
  }
  async function send(session,text) {
    if(!session?.exam||!session.cookie)throw new Error('Sessão incompleta. Inicie a prova novamente pelo portal.');
    if(Date.now()>session.deadline)throw new Error('O prazo da avaliação terminou. Consulte o portal.');
    if(!String(text??'').trim())throw new Error('Preencha a redação.');
    const e=session.exam;
    const payload=Object.fromEntries(['id','avaliacao_id','crm_contato_id','crm_curso_id','crm_id','crm_processoseletivo_id','IDEXECPROVA','codUsuarioPS','nome'].map(k=>[k,e[k]??null]));
    payload.questoes=[{questao_id:e.questoes[0].id,obrigatoria:1,tipo:1,resposta:String(text)}];
    payload.tempoUsado=Number(e.tempoUsado??0)+(Date.now()-session.startedAt)/60000;
    Object.assign(payload,{finalizada:1,salvar:1,salvarEstadoAtual:1,finalizada_automaticamente:0});
    markWrite({status:'sending',path:'/avaliacao/salve'});
    try {
      const r=await call('/api/avaliacao/salve/',{body:payload,cookie:session.cookie});
      const receipt=Object.fromEntries(['id','avaliacao_id','crm_contato_id','crm_curso_id','crm_id','crm_processoseletivo_id','IDEXECPROVA','codUsuarioPS','finalizada','data_envio'].map(k=>[k,r.data?.[k]??null]));
      markWrite({status:'received',path:'/avaliacao/salve',receipt});
      if(String(r.data?.id)!==String(e.id)||Number(r.data?.finalizada)!==1||!r.data?.data_envio)throw new Error('Resposta sem confirmação de finalização.');
      for(const key of ['crm_contato_id','crm_curso_id','IDEXECPROVA','codUsuarioPS'])if(r.data[key]!=null&&String(r.data[key])!==String(e[key]))throw new Error('Recibo pertence a outro vínculo.');
      return r.data;
    }catch{throw new ResultadoIncerto('Não foi possível confirmar a entrega. Consulte o Portal do candidato antes de reenviar.');}
  }
  return {init,send};
}

// Durable create-only lock shared by all Cloud Run instances.
export async function claimDelivery(session){
 if(!await claimProofDelivery(session))throw new ResultadoIncerto("Esta prova já teve uma tentativa de entrega. Confira o Portal do candidato.");
}
