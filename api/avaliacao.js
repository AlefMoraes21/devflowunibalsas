import crypto from 'node:crypto';
const BASE='https://avaliacao.apprubeus.com.br';
export class ResultadoIncerto extends Error {}
export function createAssessment({fetcher=fetch,remaining=()=>8000,markWrite=()=>{}}={}) {
  async function call(path,{body,cookie,method=body?'POST':'GET',manual=false}={}) {
    const budget=Math.min(4500,remaining()-150);
    if(budget<250)throw new Error('Tempo insuficiente. Reabra esta etapa pelo portal.');
    const r=await fetcher(BASE+path,{method,redirect:manual?'manual':'error',headers:{...(body?{'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(budget)});
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
    const {response}=await call(url.pathname+url.search,{manual:true});
    if(![301,302,303,307,308].includes(response.status))throw new Error('A avaliação não retornou a execução.');
    const to=new URL(response.headers.get('location'),BASE);
    const m=to.pathname.match(/^\/execucao\/inicio\/([^/]+)\/(\d+)\/(\d+)\/([^/]+)\/?$/);
    if(to.origin!==BASE||!m)throw new Error('Execução da avaliação inválida.');
    const params={chave:decodeURIComponent(m[1]),crm_contato_id:m[2],crm_curso_id:m[3],IDEXECPROVA:decodeURIComponent(m[4]),crm_processoseletivo_id:null,codUsuarioPS:null};
    const config=await call('/api/avaliacao/configuracao/execucao/',{body:params});
    const created=await call('/api/avaliacao/create/',{body:params,cookie:config.cookie});
    if(!created.data?.token)throw new Error('Token de execução ausente.');
    const session={token:created.data.token,cookie:created.cookie,params};
    const read=await call('/api/avaliacao/consulta/'+encodeURIComponent(session.token),{cookie:session.cookie});
    const exam=read.data;
    if(!exam?.id||!exam.avaliacao_id||!exam.crm_id||Number(exam.finalizada)!==0||exam.questoes?.length!==1)throw new Error('Prova indisponível ou formato não suportado. Abra o portal.');
    for(const key of ['crm_contato_id','crm_curso_id','IDEXECPROVA'])if(String(exam[key])!==String(params[key]))throw new Error('A execução retornada não corresponde à inscrição.');
    const minutes=Number(exam.tempoRestante??exam.tempo);
    if(!Number.isFinite(minutes)||minutes<=0)throw new Error('Prazo da avaliação indisponível.');
    return {...session,exam,startedAt:Date.now(),deadline:Date.now()+minutes*60000};
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
      if(String(r.data?.id)!==String(e.id)||Number(r.data?.finalizada)!==1||!r.data?.data_envio)throw new Error('Resposta sem confirmação de finalização.');
      markWrite({status:'received',path:'/avaliacao/salve'});
      return r.data;
    }catch{throw new ResultadoIncerto('Não foi possível confirmar a entrega. Consulte o Portal do candidato antes de reenviar.');}
  }
  return {init,send};
}

// No in-memory lock: Cloud Run may execute concurrently on many instances.
// Redis REST provides an atomic, durable tombstone before the external finalization.
export async function claimDelivery(session) {
  if(!process.env.REDIS_REST_URL||!process.env.REDIS_REST_TOKEN)throw new Error('Configure Redis REST para proteger a finalização.');
  const url=new URL(process.env.REDIS_REST_URL);
  if(url.protocol!=='https:')throw new Error('Redis exige HTTPS.');
  const key='unibalsas:delivery:'+crypto.createHash('sha256').update(String(session.exam.id)+':'+session.token).digest('hex');
  const r=await fetch(url,{method:'POST',headers:{Authorization:`Bearer ${process.env.REDIS_REST_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify(['SET',key,'claimed','NX','EX',604800]),signal:AbortSignal.timeout(1500)});
  const j=await r.json();
  if(!r.ok||j.error)throw new Error('Não foi possível proteger o envio.');
  if(j.result!=='OK')throw new ResultadoIncerto('Esta prova já teve uma tentativa de entrega. Confira o resultado no Portal do candidato.');
}
