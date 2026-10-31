import crypto from 'node:crypto';
let cached;
export async function accessToken(){
  if(cached?.expires>Date.now())return cached.value;
  const r=await fetch('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',{headers:{'Metadata-Flavor':'Google'},signal:AbortSignal.timeout(1200)});
  const j=await r.json();if(!r.ok||!j.access_token)throw new Error('Não foi possível autenticar o processamento.');
  cached={value:j.access_token,expires:Date.now()+(Number(j.expires_in)-60)*1000};return cached.value;
}
export async function googleRequest(url,{method='GET',body,timeout=2000}={}){
  const r=await fetch(url,{method,headers:{Authorization:`Bearer ${await accessToken()}`,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(timeout)});
  const text=await r.text();let json;try{json=JSON.parse(text)}catch{json={}}
  if(r.status>=400&&![404,409,412].includes(r.status))console.warn(JSON.stringify({event:'flow_cloud_error',service:new URL(url).hostname,method,http:r.status,code:json.error?.status}));
  return {status:r.status,json};
}
function key(){if(!process.env.FLOW_PRIVATE_KEY)throw new Error('Chave do Flow ausente.');return crypto.createHash('sha256').update(process.env.FLOW_PRIVATE_KEY.replace(/\\n/g,'\n')).update('flow-durable-jobs-v1').digest()}
export function pack(value){const iv=crypto.randomBytes(12),c=crypto.createCipheriv('aes-256-gcm',key(),iv);const bytes=Buffer.concat([c.update(JSON.stringify(value)),c.final()]);return Buffer.concat([iv,c.getAuthTag(),bytes]).toString('base64url')}
export function unpack(value){const b=Buffer.from(value,'base64url'),d=crypto.createDecipheriv('aes-256-gcm',key(),b.subarray(0,12));d.setAuthTag(b.subarray(12,28));return JSON.parse(Buffer.concat([d.update(b.subarray(28)),d.final()]).toString())}
export function workerSignature(id){return crypto.createHmac('sha256',key()).update('worker:'+id).digest('hex')}
export function validWorkerSignature(id,sig){if(!/^[a-f0-9]{64}$/.test(id??'')||!/^[a-f0-9]{64}$/.test(sig??''))return false;return crypto.timingSafeEqual(Buffer.from(sig,'hex'),Buffer.from(workerSignature(id),'hex'))}
export function createStore({request=googleRequest}={}){
  function base(){const project=process.env.FLOW_PROJECT_ID,db=process.env.FLOW_DATABASE_ID||'unibalsas-flow';if(!project)throw new Error('Configure FLOW_PROJECT_ID.');return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(project)}/databases/${encodeURIComponent(db)}/documents`}
  function fields(record){return {blob:{stringValue:pack(record)},expireAt:{timestampValue:new Date(record.expires).toISOString()}}}
  function decode(json){return {record:unpack(json.fields.blob.stringValue),version:json.updateTime}}
  async function get(id,collection='flowJobs'){
    const r=await request(`${base()}/${collection}/${id}`);if(r.status===404)return null;
    if(r.status!==200)throw new Error('Não foi possível consultar o processamento.');return decode(r.json);
  }
  async function create(id,record,collection='flowJobs'){
    const r=await request(`${base()}/${collection}?documentId=${id}`,{method:'POST',body:{fields:fields(record)}});
    if(r.status===409)return false;if(r.status!==200)throw new Error('Não foi possível registrar o processamento.');return true;
  }
  async function update(id,record,version){
    const r=await request(`${base()}/flowJobs/${id}?currentDocument.updateTime=${encodeURIComponent(version)}`,{method:'PATCH',body:{fields:fields(record)}});
    if([409,412].includes(r.status)||r.json?.error?.status==='FAILED_PRECONDITION')return false;
    if(r.status!==200)throw new Error('Não foi possível atualizar o processamento.');return true;
  }
  return {get,create,update};
}
export async function enqueueJob(id){
  const project=process.env.FLOW_PROJECT_ID,region=process.env.FLOW_TASKS_REGION||'southamerica-east1',queue=process.env.FLOW_TASKS_QUEUE||'unibalsas-flow';
  const origin=new URL(process.env.FLOW_WORKER_ORIGIN);
  if(origin.protocol!=='https:'||!origin.hostname.endsWith('.run.app')||origin.pathname!=='/')throw new Error('Configure FLOW_WORKER_ORIGIN com a URL do Cloud Run.');
  const parent=`projects/${project}/locations/${region}/queues/${queue}`;
  const r=await googleRequest(`https://cloudtasks.googleapis.com/v2/${parent}/tasks`,{method:'POST',body:{task:{name:`${parent}/tasks/flow-${id}`,dispatchDeadline:'180s',httpRequest:{httpMethod:'POST',url:new URL('/internal/flow-worker',origin).href,headers:{'Content-Type':'application/json','X-Flow-Worker-Signature':workerSignature(id)},body:Buffer.from(JSON.stringify({id})).toString('base64')}}}});
  if(![200,409].includes(r.status))throw new Error('Não foi possível agendar o processamento. Consulte novamente para tentar agendar.');
}
export async function claimProofDelivery(session){
  const id=crypto.createHash('sha256').update(String(session.exam.id)+':'+session.token).digest('hex');
  return createStore().create(id,{created:Date.now(),expires:Date.now()+7*86400000},'flowDeliveryLocks');
}
