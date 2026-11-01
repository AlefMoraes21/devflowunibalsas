import crypto from 'node:crypto';
import {createStore,enqueueJob,validWorkerSignature} from './cloud-store.js';
const screens={retomar_etapa_enem:'CURSO_ENEM',avancar_curso_interesse:'CURSO_ENEM',conferir_prova_existente:'TELA_ORIENTACAO_PROVA',enviar_informacoes_complementares:'QUASE_LA',iniciar_redacao:'TELA_ORIENTACAO_PROVA',enviar_redacao:'TELA_REDACAO',verificar_entrega:'TELA_REDACAO'};
const actions={CURSO_ENEM:'avancar_curso_interesse',QUASE_LA:'enviar_informacoes_complementares',TELA_ORIENTACAO_PROVA:'iniciar_redacao',TELA_REDACAO:'enviar_redacao'};
const hash=v=>crypto.createHash('sha256').update(v).digest('hex');
export function createJobEngine({store=createStore(),enqueue=enqueueJob,run,openState,render,clock=Date.now,sleep=ms=>new Promise(r=>setTimeout(r,ms)),waitMs=5500}){
  function processing(job,extra={}){
    const trusted=openState(job.request.data.estado,job.request.screen);
    const messages={retomar_etapa_enem:'Estamos consultando a próxima etapa do ENEM, sem reenviar suas notas.',avancar_curso_interesse:'Estamos registrando seu curso e suas notas do ENEM. Aguarde a próxima etapa.',conferir_prova_existente:'Estamos conferindo a prova já distribuída, sem repetir a inscrição.',enviar_informacoes_complementares:'Estamos concluindo sua inscrição e preparando sua próxima etapa.',iniciar_redacao:'Estamos abrindo o ambiente de redação. Aguarde a preparação da sua prova.',enviar_redacao:'Estamos enviando sua redação. Não é necessário enviar novamente.',verificar_entrega:'Estamos conferindo a atualização da sua redação no portal. O texto não será reenviado.'};
    return render(job.request.screen,{...trusted,values:job.request.data,erro:'',job_id:job.id,processando:true,editavel:false,acao_rodape:'consultar_tarefa',rotulo_rodape:'Verificar andamento',mensagem_processamento:messages[job.request.data.acao]??'Estamos processando seus dados.',...extra});
  }
  async function poll(job,wait=waitMs){
    const until=clock()+wait;let current=job;
    while(true){
      if(current.result){
        if(current.result.screen==='PENDENTE'&&current.request.screen==='CURSO_ENEM'&&current.audit?.enemContinuation){
          const trusted=openState(current.request.data.estado,current.request.screen);
          return render('CURSO_ENEM',{...trusted,values:current.request.data,continuacao_enem:current.audit.enemContinuation,processando:false,job_id:'',erro:'Suas notas foram recebidas, mas não foi possível carregar a próxima etapa. Toque em Retomar inscrição.'});
        }
        if(current.result.screen==='PENDENTE'&&current.request.data.acao==='iniciar_redacao'){
          const trusted=openState(current.request.data.estado,current.request.screen);
          return render('TELA_ORIENTACAO_PROVA',{...trusted,proof_resume_required:true,processando:false,job_id:'',erro:'A preparação não foi confirmada. Confira a prova já distribuída para continuar sem reenviar a operação.',mensagem_processamento:''});
        }
        if(current.result.screen==='PENDENTE')return processing(current,{erro:current.result.data.mensagem,tem_erro:true,mensagem_processamento:'O resultado precisa de conferência no Portal do candidato. Não reenviamos esta operação.'});
        const result=current.result;
        // Refresh results persisted by 1.1.0 so its inherited footer cannot leak
        // the previous screen's action into a completed transition.
        if(actions[result.screen]&&result.data?.estado){
          const trusted=openState(result.data.estado,result.screen);
          const values=Object.fromEntries(Object.entries(result.data).filter(([k])=>k.startsWith('valor_')).map(([k,v])=>[k.slice(6),v]));
          return render(result.screen,{...trusted,...result.data,processando:false,values});
        }
        return result;
      }
      if(clock()-current.created>180000)return processing(current,{erro:'O processamento está demorando além do esperado. Confira a situação no Portal do candidato.',mensagem_processamento:'Esta operação continua protegida contra reenvio.'});
      if(clock()+2400>=until)return processing(current);
      await sleep(600);
      const next=await store.get(job.id);if(next)current=next.record;
    }
  }
  async function route(req){
    const began=clock();
    const remainingWait=()=>Math.max(0,Math.min(waitMs,8000-(clock()-began)));
    if(req.action!=='data_exchange')return run(req);
    let action=req.data?.acao;
    if(action==='avancar_curso_interesse'&&req.screen!=='CURSO_ENEM')return run(req);
    if(screens[action]&&screens[action]!==req.screen&&actions[req.screen]){
      const trusted=openState(req.data.estado,req.screen);
      // Recover only the exact inherited action authenticated in an old state.
      if(trusted.acao_rodape===action&&!trusted.processando){
        action=actions[req.screen];req={...req,data:{...req.data,acao:action}};
        console.info(JSON.stringify({event:'flow_navigation_recovered',screen:req.screen}));
      }
    }
    if(action==='consultar_tarefa'){
      const state=openState(req.data.estado,req.screen);
      if(!/^[a-f0-9]{64}$/.test(state.job_id??''))throw new Error('Processamento não identificado.');
      const found=await store.get(state.job_id);if(!found||found.record.expires<clock())throw new Error('Este acompanhamento expirou. Consulte o portal.');
      const job=found.record;
      if(job.binding!==hash(req.flow_token??'')||job.request.screen!==req.screen)throw new Error('Esta operação pertence a outra sessão.');
      if(job.state==='queued')try{await enqueue(job.id)}catch(e){return processing(job,{erro:e.message})}
      return poll(job,remainingWait());
    }
    if(!screens[action])return run(req);
    if(screens[action]!==req.screen)throw new Error('Ação não permitida nesta tela.');
    openState(req.data.estado,req.screen);
    const id=hash((req.flow_token??'')+':'+req.data.estado+':'+action);
    const record={id,state:'queued',binding:hash(req.flow_token??''),request:req,created:clock(),expires:clock()+7200000};
    await store.create(id,record);
    const current=await store.get(id);if(!current)throw new Error('Não foi possível recuperar o processamento.');
    if(current.record.expires<clock())throw new Error('Este acompanhamento expirou. Consulte o portal.');
    if(current.record.state==='queued')try{await enqueue(id)}catch(e){return processing(current.record,{erro:e.message})}
    return poll(current.record,remainingWait());
  }
  async function worker(id,sig){
    if(!validWorkerSignature(id,sig))return 403;
    const current=await store.get(id);if(!current)return 204;
    if(current.record.expires<clock())return 204;
    if(current.record.state!=='queued')return 204;
    const record={...current.record,state:'running',started:clock()};
    if(!await store.update(id,record,current.version))return 204;
    console.info(JSON.stringify({event:'flow_job',id,state:'running',action:record.request.data.acao}));
    let result,audit;
    try{const output=await run(structuredClone(record.request),true);result=output?.response??output;audit=output?.audit}catch{result={screen:'PENDENTE',data:{mensagem:'Não foi possível confirmar o processamento. Consulte o portal antes de repetir.'}}}
    const latest=await store.get(id);
    if(!latest)throw new Error('Registro de processamento ausente.');
    if(!await store.update(id,{...record,state:'done',result,...(audit?{audit}:{}),finished:clock()},latest.version))throw new Error('Resultado não pôde ser persistido.');
    console.info(JSON.stringify({event:'flow_job',id,state:'done',screen:result.screen}));
    return 204;
  }
  return {route,worker};
}
