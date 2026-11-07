import crypto from 'node:crypto';
import {createStore} from './cloud-store.js';
const COLLECTION='flowDocumentOperations';
const RETENTION_MS=30*86400000;
const STATES=new Set(['running','received','uncertain','rejected']);
const digest=value=>crypto.createHash('sha256').update(value).digest('hex');
function identityId({cpf,processId,applymentId,documentId}){
  const digits=String(cpf??'').replace(/\D/g,'');
  const identity=[digits,String(processId??''),String(applymentId??''),String(documentId??'')];
  if(!/^\d{11}$/.test(digits)||identity.slice(1).some(v=>!v||v.length>128))throw new Error('Não foi possível identificar o envio deste documento.');
  return digest(JSON.stringify(['document-operation-v1',...identity]));
}
function safeContext(context,documentId){
  if(context===undefined)return undefined;
  if(!context||typeof context!=='object'||Array.isArray(context))throw new Error('Informações de acompanhamento do documento inválidas.');
  const clean={};
  for(const [key,max] of Object.entries({documentId:128,name:255,previousPath:2048,previousFilesDigest:128})){
    if(context[key]===undefined)continue;
    if(typeof context[key]!=='string'||context[key].length>max||/[\u0000-\u001f\u007f]/.test(context[key]))throw new Error('Informações de acompanhamento do documento inválidas.');
    clean[key]=context[key];
  }
  if(clean.documentId!==undefined&&clean.documentId!==String(documentId))throw new Error('Informações de acompanhamento do documento inválidas.');
  return clean;
}
// Durable lock by authenticated inscription and document, shared by all Flow sessions.
// Never delete or replace a present uncertain record merely because its expiry passed.
export function createDocumentLedger({store=createStore(),clock=Date.now}={}){
  function result(record,claimed=false){return {id:record.id,claimed,state:record.state,...(record.receipt?{receipt:record.receipt}:{}),...(record.reason?{reason:record.reason}:{}),...(record.context?{context:structuredClone(record.context)}:{}),expired:record.expires<=clock(),requiresReconciliation:record.state==='uncertain'||record.state==='running'||record.expires<=clock()};}
  async function lookup(identity){
    const found=await store.get(identityId(identity),COLLECTION);
    return found?result(found.record):null;
  }
  async function claim({cpf,processId,applymentId,documentId,mediaHash,context}){
    const id=identityId({cpf,processId,applymentId,documentId});
    if(typeof mediaHash!=='string'||!mediaHash||mediaHash.length>512)throw new Error('Não foi possível identificar o envio deste documento.');
    const cleanContext=safeContext(context,documentId);
    const now=clock(),record={id,state:'running',mediaDigest:digest(mediaHash),attempt:1,created:now,updated:now,expires:now+RETENTION_MS,...(cleanContext?{context:cleanContext}:{})};
    if(await store.create(id,record,COLLECTION))return result(record,true);
    for(let attempt=0;attempt<3;attempt++){
      const found=await store.get(id,COLLECTION);
      if(!found)throw new Error('O registro deste envio não pôde ser recuperado. Confira a situação antes de tentar novamente.');
      if(found.record.state!=='rejected')return result(found.record);
      const next={...record,created:found.record.created,attempt:(found.record.attempt??1)+1};
      if(await store.update(id,next,found.version,COLLECTION))return result(next,true);
    }
    throw new Error('Este documento está sendo atualizado. Confira a situação em instantes.');
  }
  async function change(id,state,{receipt,reason}={},authoritative=false){
    if(!/^[a-f0-9]{64}$/.test(String(id))||!STATES.has(state)||state==='running')throw new Error('Situação de documento inválida.');
    for(let attempt=0;attempt<3;attempt++){
      const found=await store.get(id,COLLECTION);
      if(!found)throw new Error('Registro do documento não encontrado.');
      const current=found.record;
      if(!authoritative&&current.state!=='running'){
        if(current.state===state)return result(current);
        throw new Error('A situação deste documento precisa de conferência antes de ser alterada.');
      }
      const next={...current,state,updated:clock()};
      if(receipt!==undefined)next.receipt=receipt;
      if(reason!==undefined)next.reason=String(reason).slice(0,200);
      if(state==='received')delete next.reason;
      if(state==='rejected')delete next.receipt;
      if(await store.update(id,next,found.version,COLLECTION))return result(next);
    }
    throw new Error('Não foi possível registrar a situação do documento. Confira antes de reenviar.');
  }
  return {claim,lookup,transition:(id,state,details)=>change(id,state,details),reconcile:(id,state,details)=>change(id,state,details,true)};
}
