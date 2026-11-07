import crypto from 'node:crypto';
import {createPortalClient} from './portal-client.js';
import {parseDocumentStep,prepareDocumentUpload,documentOptions,documentSummary} from './portal-documentos.js';
import {validatedMedia,MAX_PORTAL_FILE_BYTES} from './documentos.js';
import {createDocumentLedger} from './document-ledger.js';
import {createStore} from './cloud-store.js';

const COLLECTION='flowPortalDocumentBindings';
const hash=v=>crypto.createHash('sha256').update(v).digest('hex');
const str=v=>String(v??'');
const sameName=(a,b)=>str(a).normalize('NFC')===str(b).normalize('NFC');
const filesDigest=files=>hash(JSON.stringify((files??[]).map(f=>({name:f.name,link:f.link}))));
const pendingMessage='Não conseguimos confirmar o envio neste momento. Estamos preservando este documento para evitar um envio repetido. Toque em Atualizar situação para conferir.';

export function createMatriculaDocuments({client=createPortalClient(),ledger=createDocumentLedger(),store=createStore(),download=validatedMedia,clock=Date.now}={}){
  function identity(session){
    if(!/^\d{11}$/.test(str(session.cpf))||!/^\d+$/.test(str(session.processo_seletivo_id))||!/^\d+$/.test(str(session.applyment_id)))throw new Error('Entre novamente para localizar sua matrícula.');
    return {cpf:session.cpf,processId:session.processo_seletivo_id,applymentId:session.applyment_id};
  }
  function bindingId(session){const i=identity(session);return hash(JSON.stringify(['portal-documents-v1',i.cpf,i.processId,i.applymentId]));}
  async function remember(session,stepId){
    const id=bindingId(session),record={stepId:str(stepId),created:clock(),expires:clock()+30*86400000};
    if(await store.create(id,record,COLLECTION))return;
    const previous=await store.get(id,COLLECTION);
    if(!previous)throw new Error('Não foi possível guardar o acompanhamento da matrícula.');
    if(previous.record.stepId!==record.stepId&&!await store.update(id,record,previous.version,COLLECTION))throw new Error('Atualize a situação da matrícula para continuar.');
  }
  async function lookup(session){
    const found=await store.get(bindingId(session),COLLECTION);
    return found?.record?.stepId?{step:str(found.record.stepId),title:'Documentos matrícula'}:null;
  }
  async function login(cpf,birth,official={}){
    const session=await client.login(cpf,birth);
    for(const key of ['person_id','applyment_id'])if(official[key]&&str(official[key])!==str(session[key]))throw new Error('O portal retornou outra inscrição. Entre novamente antes de enviar documentos.');
    return session;
  }
  function portalSession(data){
    identity(data);
    if(!data.portal_session?.token)throw new Error(data.portal_document_error||'Entre novamente pela opção Já sou inscrito para enviar os documentos dentro do WhatsApp.');
    for(const key of ['cpf','applyment_id'])if(str(data.portal_session[key])!==str(data[key]))throw new Error('A sessão dos documentos pertence a outra inscrição. Entre novamente.');
    return {...data.portal_session,processo_seletivo_id:str(data.processo_seletivo_id)};
  }
  async function read(data,stepId=data.portal_document_step){
    const result=await client.readStep(portalSession(data),{stepId,processId:data.processo_seletivo_id});
    const parsed=parseDocumentStep(result.json,{stepId,processId:data.processo_seletivo_id});
    if(parsed.uploads.length!==1)throw new Error('O portal retornou mais de uma lista de documentos. Não foi feito nenhum envio.');
    return {parsed,session:result.session};
  }
  function screenData(data,view,message=''){
    const upload=view.parsed.uploads[0],documentos=documentOptions(view.parsed,{uploadId:upload.recordId});
    const {arquivo,values,portal_document_error,nascimento_candidato,...safe}=data;
    return {...safe,portal_session:view.session,portal_document_step:view.parsed.stepId,portal_upload_id:upload.recordId,
      titulo:'Documentos da matrícula',texto:'Envie os mesmos documentos solicitados no Portal do candidato, um de cada vez. PDF, JPG, JPEG ou PNG de até 5 MB. Inclua todas as páginas, frente e verso. Os itens com * são obrigatórios. Prazo de envio: até 30 dias; análise em até 48 horas úteis.',
      documentos,documentos_resumo:documentSummary(view.parsed,{uploadId:upload.recordId}).slice(0,3900),tem_pendentes:documentos.length>0,
      mensagem_envio:message,erro:'',processando:false,job_id:'',documento:'',values:{documento:''}};
  }
  async function open(data,{step}={}){
    if(!data.portal_session?.token&&data.nascimento_candidato){
      data={...data,portal_session:await login(data.cpf,data.nascimento_candidato,data)};
    }
    const stepId=str(step||data.portal_document_step);
    let view;
    try{view=await read(data,stepId)}catch(error){error.session??=data.portal_session;throw error}
    await remember(data,stepId);
    await reconcileView(data,view);
    return screenData(data,view);
  }
  function changedFile(doc,file,before){
    const changedFiles=filesDigest(doc.files)!==(before.filesDigest??filesDigest(before.files));
    return (changedFiles&&doc.files.some(f=>sameName(f.name,file.name)))||Boolean(doc.path&&doc.path!==before.path);
  }
  function received(view,documentId,file,before){
    const doc=view.parsed.uploads[0].documents.find(d=>d.id===str(documentId));
    if(!doc||!['review','approved'].includes(doc.status))return false;
    return changedFile(doc,file,before);
  }
  async function reconcileView(data,view){
    const ident=identity(data);
    await Promise.all(view.parsed.uploads[0].documents.map(async doc=>{
      const operation=await ledger.lookup({...ident,documentId:doc.id});
      const ctx=operation?.context;
      if(!ctx?.name)return;
      const changed=changedFile(doc,{name:ctx.name},{path:ctx.previousPath,filesDigest:ctx.previousFilesDigest});
      if(changed&&['review','approved'].includes(doc.status)&&operation.state!=='received')
        await ledger.reconcile(operation.id,'received',{receipt:{documentId:doc.id,name:ctx.name,status:'received'}});
      else if(changed&&doc.status==='rejected'&&doc.canUpload&&operation.state!=='rejected')
        await ledger.reconcile(operation.id,'rejected',{reason:'O documento enviado foi recusado e o portal liberou o reenvio.'});
    }));
  }
  async function refresh(data){
    const view=await read(data),last=data.portal_document_operation;
    await reconcileView(data,view);
    const baseline=last?{path:last.previousPath,filesDigest:last.previousFilesDigest}:null;
    return screenData(data,view,last&&received(view,last.documentId,{name:last.name},baseline)?'Prontinho! Seu documento foi recebido e está aguardando conferência.':'');
  }
  async function send(data){
    const ident=identity(data),beforeView=await read(data),upload=beforeView.parsed.uploads[0];
    await reconcileView(data,beforeView);
    const doc=upload.documents.find(d=>d.id===str(data.documento));
    if(!doc)throw new Error('Escolha um documento solicitado para sua matrícula.');
    if(!doc.canUpload)return screenData(data,beforeView,'Este documento já foi recebido. Acompanhe a situação abaixo.');
    // Validate and download before claiming a durable write operation.
    const file=await download(data.arquivo,{maxFileBytes:MAX_PORTAL_FILE_BYTES});
    const form=prepareDocumentUpload(beforeView.parsed,{documentId:doc.id,uploadId:upload.recordId,file,
      context:{token:beforeView.session.token,domainParams:beforeView.session.domainParams,processId:ident.processId,stepId:beforeView.parsed.stepId,
        substitute_id:null,session_id:null,hostClient:null,contact_id_crm:null}});
    const context={documentId:doc.id,name:file.name,previousPath:doc.path||'',previousFilesDigest:filesDigest(doc.files)};
    const claimInput={...ident,documentId:doc.id,mediaHash:file.hash,context};
    let operation=await ledger.claim(claimInput);
    // A confirmed previous delivery may be replaced only after a current, explicit rejection.
    if(!operation.claimed&&operation.state==='received'&&doc.status==='rejected'&&doc.canUpload){
      await ledger.reconcile(operation.id,'rejected',{reason:'Documento recusado no portal; reenvio liberado.'});
      operation=await ledger.claim(claimInput);
    }
    const originalContext=operation.context??context;
    const progress={...data,portal_session:beforeView.session,portal_document_operation:{id:operation.id,...originalContext}};
    if(!operation.claimed)return {...screenData(progress,beforeView,pendingMessage),erro:operation.state==='received'?'Este documento já possui um envio registrado. Atualize a situação antes de enviar novamente.':pendingMessage};
    let submitted=false;
    try{
      const result=await client.submitUpload(beforeView.session,form);submitted=true;
      progress.portal_session=result.session;
      const after=await read(progress);
      if(received(after,doc.id,file,doc)){
        await ledger.transition(operation.id,'received',{receipt:{documentId:doc.id,name:file.name,status:'received',fileHash:file.hash}});
        return screenData(progress,after,'Prontinho! ✅ Seu documento foi recebido pelo sistema e está aguardando a conferência da nossa equipe.');
      }
      await ledger.transition(operation.id,'uncertain',{reason:'O portal ainda não confirmou o arquivo na reconsulta.'});
      return {...screenData(progress,after,pendingMessage),erro:pendingMessage};
    }catch(error){
      if(error.session)progress.portal_session=error.session;
      const uncertain=submitted||error.uncertain||error.code==='PORTAL_WRITE_UNCERTAIN';
      await ledger.transition(operation.id,uncertain?'uncertain':'rejected',{reason:uncertain?'Resultado do upload não confirmado.':'Upload recusado antes de confirmar recebimento.'});
      if(uncertain){
        // A read may confirm a write whose HTTP response was lost; never repeat the POST.
        try{
          const after=await read(progress);
          if(received(after,doc.id,file,doc)){
            await ledger.reconcile(operation.id,'received',{receipt:{documentId:doc.id,name:file.name,status:'received',fileHash:file.hash}});
            return screenData(progress,after,'Seu documento foi recebido. Aguardando conferência da equipe.');
          }
          return {...screenData(progress,after,pendingMessage),erro:pendingMessage};
        }catch{}
        return {...screenData(progress,{...beforeView,session:progress.portal_session},pendingMessage),erro:pendingMessage};
      }
      return {...screenData(progress,{...beforeView,session:progress.portal_session}),erro:error.message||'O portal recusou o arquivo. Confira o formato e tente novamente.'};
    }
  }
  return {login,open,send,refresh,lookup};
}
