import crypto from 'node:crypto';
import {createStore,enqueueJob,validWorkerSignature} from './cloud-store.js';
const screens={avancar_curso_ingresso:'CURSO_INGRESSO',retomar_etapa_ingresso:'CURSO_INGRESSO',retomar_etapa_enem:'CURSO_ENEM',avancar_curso_interesse:'CURSO_ENEM',conferir_prova_existente:'TELA_ORIENTACAO_PROVA',enviar_informacoes_complementares:'QUASE_LA',iniciar_redacao:'TELA_ORIENTACAO_PROVA',enviar_redacao:'TELA_REDACAO',verificar_entrega:'TELA_REDACAO'};
const actions={CURSO_INGRESSO:'avancar_curso_ingresso',CURSO_ENEM:'avancar_curso_interesse',QUASE_LA:'enviar_informacoes_complementares',TELA_ORIENTACAO_PROVA:'iniciar_redacao',TELA_REDACAO:'enviar_redacao'};
const hash=v=>crypto.createHash('sha256').update(v).digest('hex');
// Jornada de matrícula: ações que podem ocorrer em mais de uma tela e dependem do /portal
// da Rubeus (que pode passar de 6 s). Rodam no worker, com prazo maior.
const multiScreens={selecionar_processo:['ESCOLHA_PROCESSO'],enviar_documento_matricula:['DOCUMENTOS_MATRICULA'],atualizar_documentos_matricula:['DOCUMENTOS_MATRICULA'],enviar_documento:['DOCUMENTOS_INSCRICAO'],carregar_jornada:['PORTAL_STATUS','ACOMPANHAMENTO'],continuar_etapa:['PORTAL_STATUS','ACOMPANHAMENTO'],atualizar_portal:['PORTAL_STATUS','ACOMPANHAMENTO','ETAPA_PORTAL','DOCUMENTOS_INSCRICAO','DOCUMENTOS_MATRICULA'],enviar_responsavel:['RESP_FINANCEIRO'],enviar_resp_dados:['RESP_DADOS'],enviar_endereco:['ENDERECO'],enviar_identidade:['IDENTIDADE'],enviar_cupom:['CUPOM']};
const isDocumentSend=action=>['enviar_documento','enviar_documento_matricula'].includes(action);
const isLogin=job=>job.request.data.acao==='selecionar_processo'&&job.request.data.modo==='continuar';
const isImmediate=job=>isDocumentSend(job.request.data.acao)||job.request.data.acao==='atualizar_documentos_matricula'||isLogin(job);
const isAsync=(action,screen)=>screens[action]===screen||(multiScreens[action]??[]).includes(screen);
export function createJobEngine({store=createStore(),enqueue=enqueueJob,run,openState,render,clock=Date.now,sleep=ms=>new Promise(r=>setTimeout(r,ms)),waitMs=5500}){
  function processing(job,extra={}){
    const trusted=openState(job.request.data.estado,job.request.screen);
    // Media keys stay only in the encrypted durable request, never in client state.
    const documentJob=isDocumentSend(job.request.data.acao)||job.request.data.acao==='atualizar_documentos_matricula';
    const loginJob=isLogin(job);
    const {arquivo: ignoredMedia,values: ignoredValues,data_nascimento: ignoredBirth,...documentState}=trusted;
    const state=documentJob||loginJob?documentState:trusted;
    const values=loginJob?{modo:'continuar',login:job.request.data.login,data_nascimento:job.request.data.data_nascimento}:documentJob?{documento:job.request.data.documento}:job.request.data;
    const messages={selecionar_processo:'Estamos localizando sua inscrição. Aguarde um pouco e toque em Verificar andamento.',atualizar_documentos_matricula:'Estamos conferindo a situação dos seus documentos. Não precisa enviar novamente.',enviar_documento_matricula:'Recebemos seu documento! 📄 Estamos organizando o envio. Aguarde de 15 a 20 segundos e toque em Verificar andamento. Não precisa enviar novamente.',enviar_documento:'Recebemos seu documento! 📄 Estamos organizando o envio. Aguarde de 15 a 20 segundos e toque em Verificar andamento. Não precisa enviar novamente.',avancar_curso_ingresso:'Estamos gravando o curso escolhido no sistema da UniBalsas. Isso costuma levar alguns segundinhos. Aguarde um pouco e toque em Verificar andamento.',retomar_etapa_ingresso:'Estamos buscando a próxima etapa da sua inscrição, sem enviar seus dados de novo. Isso costuma levar alguns segundinhos. Aguarde um pouco e toque em Verificar andamento.',retomar_etapa_enem:'Estamos buscando a próxima etapa do ENEM, sem enviar suas notas de novo. Isso costuma levar alguns segundinhos. Aguarde um pouco e toque em Verificar andamento.',avancar_curso_interesse:'Estamos gravando seu curso e suas notas do ENEM no sistema da UniBalsas. Isso costuma levar alguns segundinhos. Aguarde um pouco e toque em Verificar andamento.',conferir_prova_existente:'Estamos localizando a prova que já foi liberada para você. Isso costuma levar alguns segundinhos. Aguarde um pouco e toque em Verificar andamento.',enviar_informacoes_complementares:'Estamos gravando seus dados e concluindo sua inscrição. Isso costuma levar alguns segundinhos. Aguarde um pouco e toque em Verificar andamento.',iniciar_redacao:'Estamos preparando sua prova e carregando o tema da redação. Isso costuma levar alguns segundinhos. Aguarde um pouco e toque em Verificar andamento.',enviar_redacao:'Estamos enviando sua redação. Não precisa enviar de novo. Isso costuma levar alguns segundinhos. Aguarde um pouco e toque em Verificar andamento.',verificar_entrega:'Estamos confirmando o recebimento da sua redação no portal. O texto não será enviado de novo. Isso costuma levar alguns segundinhos. Aguarde um pouco e toque em Verificar andamento.',carregar_jornada:'Estamos buscando a situação de cada etapa da sua inscrição no Portal do candidato. Isso costuma levar alguns segundinhos. Aguarde um pouco e toque em Verificar andamento.',atualizar_portal:'Estamos conferindo a situação atualizada da sua inscrição. Isso costuma levar alguns segundinhos. Aguarde um pouco e toque em Verificar andamento.',continuar_etapa:'Estamos abrindo a próxima etapa da sua inscrição. Isso costuma levar alguns segundinhos. Aguarde um pouco e toque em Verificar andamento.',enviar_responsavel:'Estamos gravando o responsável financeiro e buscando a próxima etapa. Isso costuma levar alguns segundinhos. Aguarde um pouco e toque em Verificar andamento.',enviar_resp_dados:'Estamos gravando os dados do responsável e buscando a próxima etapa. Isso costuma levar alguns segundinhos. Aguarde um pouco e toque em Verificar andamento.',enviar_endereco:'Estamos gravando seu endereço e buscando a próxima etapa. Isso costuma levar alguns segundinhos. Aguarde um pouco e toque em Verificar andamento.',enviar_identidade:'Estamos gravando seus dados de identidade e buscando a próxima etapa. Isso costuma levar alguns segundinhos. Aguarde um pouco e toque em Verificar andamento.',enviar_cupom:'Estamos aplicando o cupom e buscando a próxima etapa. Isso costuma levar alguns segundinhos. Aguarde um pouco e toque em Verificar andamento.'};
    return render(job.request.screen,{...state,values,erro:'',job_id:job.id,processando:true,editavel:false,acao_rodape:'consultar_tarefa',rotulo_rodape:'Verificar andamento',mensagem_processamento:messages[job.request.data.acao]??'Estamos gravando seus dados. Isso costuma levar alguns segundinhos. Aguarde um pouco e toque em Verificar andamento.',...extra});
  }
  function loginRetry(job,message){
    const {arquivo,values,data_nascimento,...trusted}=openState(job.request.data.estado,job.request.screen);
    return render(job.request.screen,{...trusted,values:{modo:'continuar',login:job.request.data.login,data_nascimento:job.request.data.data_nascimento},processando:false,editavel:true,job_id:'',erro:message,mensagem_processamento:''});
  }
  async function poll(job,wait=waitMs){
    const until=clock()+wait;let current=job;
    while(true){
      if(current.result){
        if(current.result.screen==='PENDENTE'&&isLogin(current))return loginRetry(current,'Não foi possível consultar sua inscrição agora. Confira os dados e tente novamente.');
        if(current.result.screen==='PENDENTE'&&current.request.screen==='CURSO_INGRESSO'&&current.audit?.ingressoContinuation){
          const trusted=openState(current.request.data.estado,current.request.screen);
          return render('CURSO_INGRESSO',{...trusted,values:current.request.data,continuacao_ingresso:current.audit.ingressoContinuation,processando:false,job_id:'',erro:'Seu curso foi recebido, mas não foi possível carregar a próxima etapa. Toque em Retomar inscrição.'});
        }
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
      if(isImmediate(current)||clock()+2400>=until)return processing(current);
      await sleep(600);
      const next=await store.get(job.id);if(next)current=next.record;
    }
  }
  async function route(req){
    const began=clock();
    const remainingWait=()=>Math.max(0,Math.min(waitMs,8000-(clock()-began)));
    if(req.action!=='data_exchange')return run(req);
    let action=req.data?.acao;
    if(action==='selecionar_processo'&&req.data?.modo!=='continuar')return run(req);
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
    if(!screens[action]&&!multiScreens[action])return run(req);
    if(!isAsync(action,req.screen))throw new Error('Ação não permitida nesta tela.');
    const trusted=openState(req.data.estado,req.screen);
    let id;
    if(isDocumentSend(action)){
      if(!/^\d{11}$/.test(String(trusted.cpf??''))||!String(trusted.processo_seletivo_id??''))throw new Error('Entre novamente para localizar sua inscrição.');
      if(!(trusted.documentos??[]).some(d=>String(d.id)===String(req.data.documento)))throw new Error('Escolha qual documento você está enviando.');
      const files=req.data.arquivo;
      if(!Array.isArray(files)||files.length!==1)throw new Error('Anexe um arquivo para enviar.');
      const identity=files[0]?.encryption_metadata?.encrypted_hash||files[0]?.media_id;
      if(typeof identity!=='string'||!identity||identity.length>512)throw new Error('Não foi possível identificar o arquivo. Selecione novamente.');
      // A refreshed sealed state must not make the same media a new operation.
      // The flow binding is retained so a result never crosses authenticated sessions.
      id=hash(JSON.stringify(['document-v1',action,req.flow_token??'',trusted.cpf,trusted.processo_seletivo_id,trusted.applyment_id??'',String(req.data.documento),identity]));
      req={...req,data:{...req.data,cpf:trusted.cpf,processo_seletivo_id:trusted.processo_seletivo_id,applyment_id:trusted.applyment_id,token:trusted.token}};
    }else if(action==='selecionar_processo')id=hash(JSON.stringify(['login-v1',req.flow_token??'',req.data.estado,String(req.data.login??'').replace(/\D/g,''),req.data.data_nascimento??'']));
    else id=hash((req.flow_token??'')+':'+req.data.estado+':'+action);
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
    try{const output=await run(structuredClone(record.request),true);result=output?.response??output;audit=output?.audit}catch{result=isLogin(record)?loginRetry(record,'Não foi possível consultar sua inscrição agora. Confira os dados e tente novamente.'):{screen:'PENDENTE',data:{mensagem:'Não foi possível confirmar o processamento. Consulte o portal antes de repetir.'}}}
    const latest=await store.get(id);
    if(!latest)throw new Error('Registro de processamento ausente.');
    if(!await store.update(id,{...record,state:'done',result,...(audit?{audit}:{}),finished:clock()},latest.version))throw new Error('Resultado não pôde ser persistido.');
    console.info(JSON.stringify({event:'flow_job',id,state:'done',screen:result.screen}));
    return 204;
  }
  return {route,worker};
}
