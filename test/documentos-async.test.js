import {test} from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {createJobEngine} from '../api/jobs.js';
import {workerSignature} from '../api/cloud-store.js';
import {saveDocument,detectType} from '../api/documentos.js';
process.env.FLOW_PRIVATE_KEY='local-unit-key';

function encryptMedia(plain){
 const key=crypto.randomBytes(32),hmacKey=crypto.randomBytes(32),iv=crypto.randomBytes(16);
 const c=crypto.createCipheriv('aes-256-cbc',key,iv);const ciphertext=Buffer.concat([c.update(plain),c.final()]);
 const mac=crypto.createHmac('sha256',hmacKey).update(Buffer.concat([iv,ciphertext])).digest().subarray(0,10);
 const file=Buffer.concat([ciphertext,mac]);
 return {file,meta:{encrypted_hash:crypto.createHash('sha256').update(file).digest('base64'),iv:iv.toString('base64'),encryption_key:key.toString('base64'),hmac_key:hmacKey.toString('base64'),plaintext_hash:crypto.createHash('sha256').update(plain).digest('base64')}};
}
// Simula CDN do WhatsApp + API da UniBalsas. post: resposta do POST /blip/documents.
function world(plain,post){
 const {file,meta}=encryptMedia(plain);const sent=[];
 const fetcher=async(input,options={})=>{
  const u=new URL(String(input));
  if(u.origin==='https://cdn.whatsapp.test')return new Response(file);
  if(u.pathname.startsWith('/blip/inscritos/'))return Response.json({CODCOLIGADA:'1',IDPS:'226',NUMEROINSCRICAO:'55'});
  sent.push({q:Object.fromEntries(u.searchParams),body:JSON.parse(options.body)});return post();
 };
 return {fetcher,sent,media:[{media_id:'m',cdn_url:'https://cdn.whatsapp.test/f',file_name:'boletim.pdf',encryption_metadata:meta}]};
}
const args=w=>({idps:226,cpf:'11144477735',codDocumento:'25',media:w.media,fetcher:w.fetcher});

test('detecta o tipo pelo conteúdo e recusa arquivos que não são PDF/JPG/PNG',async()=>{
 assert.equal(detectType(Buffer.from('%PDF-1.7 x')),'pdf');
 assert.equal(detectType(Buffer.from([0xff,0xd8,0xff,0xe0,0])),'jpg');
 assert.equal(detectType(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0])),'png');
 assert.equal(detectType(Buffer.from('PK\u0003\u0004docx')),null);
 const w=world(Buffer.from('PK\u0003\u0004conteudo de um docx'),()=>Response.json({status:'ok'}));
 await assert.rejects(saveDocument(args(w)),/PDF, JPG ou PNG/);
 assert.equal(w.sent.length,0,'nada é enviado à UniBalsas');
});

test('nome do arquivo segue o tipo real e a chave confirmada precisa bater',async()=>{
 const png=Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]),Buffer.from('x')]);
 const w=world(png,()=>Response.json({status:'ok',primaryKey:'1;226;55;25'}));
 const r=await saveDocument(args(w));
 assert.equal(r.nomeArquivo,'documento.png');assert.equal(w.sent[0].q.nomeArquivo,'documento.png');assert.equal(w.sent[0].q.numeroInscricao,'55');
 const wrong=world(png,()=>Response.json({status:'ok',primaryKey:'1;226;99;25'}));
 await assert.rejects(saveDocument(args(wrong)),/Não recebemos a confirmação/);
});

test('falhas: arquivo grande, RM ocupado, resposta sem confirmação e timeout do POST',async()=>{
 const big=Buffer.concat([Buffer.from('%PDF-1.4 '),Buffer.alloc(741*1024)]);
 await assert.rejects(saveDocument(args(world(big,()=>Response.json({status:'ok'})))),/maior que 740 KB/);
 const pdf=Buffer.from('%PDF-1.4 ok');
 await assert.rejects(saveDocument(args(world(pdf,()=>Response.json({},{status:503})))),/muitos envios/);
 await assert.rejects(saveDocument(args(world(pdf,()=>Response.json({},{status:502})))),/Não recebemos a confirmação/);
 await assert.rejects(saveDocument(args(world(pdf,()=>Response.json({},{status:400})))),/não aceitou esse arquivo/);
 const slow=world(pdf,()=>{throw new DOMException('timeout','TimeoutError')});
 await assert.rejects(saveDocument(args(slow)),/Confira no Portal do candidato/);
});

test('inscrição não encontrada e falha de rede na consulta têm mensagens próprias',async()=>{
 const pdf=Buffer.from('%PDF-1.4 ok');const w=world(pdf,()=>Response.json({status:'ok'}));
 const notFound=async(input,o)=>String(input).includes('/blip/inscritos/')?new Response('{}',{status:404}):w.fetcher(input,o);
 await assert.rejects(saveDocument({...args(w),fetcher:notFound}),/Ainda não localizamos sua inscrição/);
 const down=async()=>{throw new TypeError('fetch failed')};
 await assert.rejects(saveDocument({...args(w),fetcher:down}),/Não conseguimos falar com o sistema acadêmico/);
 assert.equal(w.sent.length,0);
});

// --- fila durável: enviar_documento não roda dentro da requisição do Flow ---
function memory(){const map=new Map();return {async create(id,record){if(map.has(id))return false;map.set(id,{record:structuredClone(record),version:1});return true},async get(id){return structuredClone(map.get(id)??null)},async update(id,record,version){const p=map.get(id);if(p.version!==version)return false;map.set(id,{record:structuredClone(record),version:version+1});return true},map}}
const render=(screen,data)=>({screen,data:{...data,estado:JSON.stringify(data)}});
const upload=()=>({action:'data_exchange',screen:'DOCUMENTOS_INSCRICAO',flow_token:'t-doc',data:{acao:'enviar_documento',estado:'{}',documento:'25',arquivo:[{cdn_url:'https://cdn.whatsapp.test/f',encryption_metadata:{encryption_key:'segredo'}}]}});

test('envio de documento vai para a fila, não duplica no clique repetido e não guarda as chaves da mídia',async()=>{
 const store=memory();let runs=0;
 const e=createJobEngine({store,enqueue:async()=>{},openState:JSON.parse,render,waitMs:0,run:async()=>{runs++;return {screen:'DOCUMENTOS_INSCRICAO',data:{enviados:'✅ recebido',processando:false}}}});
 const [a,b]=await Promise.all([e.route(upload()),e.route(upload())]);
 assert.equal(a.screen,'DOCUMENTOS_INSCRICAO');assert.equal(a.data.processando,true);assert.equal(a.data.acao_rodape,'consultar_tarefa');
 assert.equal(a.data.job_id,b.data.job_id);assert.equal(runs,0,'a requisição do Flow não executa o envio');
 const id=a.data.job_id;await Promise.all([e.worker(id,workerSignature(id)),e.worker(id,workerSignature(id))]);assert.equal(runs,1);
 assert.ok(!JSON.stringify(store.map.get(id).record).includes('segredo'),'chaves removidas do registro concluído');
 const done=await e.route({action:'data_exchange',screen:'DOCUMENTOS_INSCRICAO',flow_token:'t-doc',data:{acao:'consultar_tarefa',estado:a.data.estado}});
 assert.equal(done.data.enviados,'✅ recebido');
});

test('enquanto o worker não termina, a tela continua em processamento sem confirmar nada',async()=>{
 const store=memory();const e=createJobEngine({store,enqueue:async()=>{},openState:JSON.parse,render,waitMs:0,run:async()=>({})});
 const first=await e.route(upload());
 const again=await e.route({action:'data_exchange',screen:'DOCUMENTOS_INSCRICAO',flow_token:'t-doc',data:{acao:'consultar_tarefa',estado:first.data.estado}});
 assert.equal(again.data.processando,true);assert.match(again.data.mensagem_processamento,/Estamos recebendo o seu documento/);
});
