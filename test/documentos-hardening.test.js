import {test} from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {findInscription,listDocuments,downloadMedia,decryptMedia,saveDocument,MAX_FILE_BYTES,DocumentWriteUncertainError} from '../api/documentos.js';

const cpf='11144477735';
function encrypted(plain=Buffer.from('%PDF-1.7\nmock\n%%EOF'),overrides={}) {
 const key=crypto.randomBytes(32),hmac=crypto.randomBytes(32),iv=crypto.randomBytes(16);
 const cipher=crypto.createCipheriv('aes-256-cbc',key,iv),ciphertext=Buffer.concat([cipher.update(plain),cipher.final()]);
 const file=Buffer.concat([ciphertext,crypto.createHmac('sha256',hmac).update(Buffer.concat([iv,ciphertext])).digest().subarray(0,10)]);
 return {file,media:{cdn_url:'https://mmg.whatsapp.net/f',file_name:'documento.pdf',encryption_metadata:{encrypted_hash:crypto.createHash('sha256').update(file).digest('base64'),plaintext_hash:crypto.createHash('sha256').update(plain).digest('base64'),encryption_key:key.toString('base64'),hmac_key:hmac.toString('base64'),iv:iv.toString('base64')},...overrides}};
}
function fixture({plain,media:overrides,rows,documents,response,postError}={}) {
 const sample=encrypted(plain,overrides),posts=[];
 const fetcher=async(url,options={})=>{
  const u=new URL(String(url));
  if(u.hostname==='mmg.whatsapp.net') {assert.equal(options.redirect,'error');return new Response(sample.file);}
  if(u.pathname.startsWith('/blip/inscritos/'))return Response.json(rows??{IDPS:'225',CPF:cpf,CODCOLIGADA:'1',NUMEROINSCRICAO:'77'});
  if(u.pathname==='/rm/documents')return Response.json(documents??{resultado:[{CODDOCUMENTO:'28',DESCRICAO:'Histórico'}]});
  assert.equal(u.pathname,'/blip/documents');posts.push({url:u,options});if(postError)throw postError;
  return response?.()??Response.json({status:'ok',primaryKey:'1;225;77;28'});
 };
 return {posts,sample,fetcher,send:()=>saveDocument({idps:'225',cpf,codDocumento:'28',media:[sample.media],fetcher})};
}

test('binds candidate, process and coligada exactly; rejects missing or ambiguous identity',async()=>{
 for(const rows of [
  {IDPS:'226',CPF:cpf,CODCOLIGADA:'1',NUMEROINSCRICAO:'77'},
  {IDPS:'225',CPF:'99999999999',CODCOLIGADA:'1',NUMEROINSCRICAO:'77'},
  {IDPS:'225',CPF:cpf,CODCOLIGADA:'2',NUMEROINSCRICAO:'77'},
  {IDPS:'225',CODCOLIGADA:'1',NUMEROINSCRICAO:'77'},
  [{IDPS:'225',CPF:cpf,CODCOLIGADA:'1',NUMEROINSCRICAO:'77'},{IDPS:'225',CPF:cpf,CODCOLIGADA:'1',NUMEROINSCRICAO:'78'}]
 ]) {const f=fixture({rows});await assert.rejects(f.send,/única inscrição/);assert.equal(f.posts.length,0);}
});

test('rejects invalid IDs and CPF before any API call',async()=>{
 const fetcher=()=>{assert.fail('must not fetch')};
 for(const idps of ['0','-1','NaN','1e2','2147483648'])await assert.rejects(findInscription(idps,cpf,{fetcher}));
 await assert.rejects(findInscription('225','123',{fetcher}));
});

test('revalidates selected document against official catalog before POST',async()=>{
 const f=fixture({documents:{resultado:[{CODDOCUMENTO:'99',DESCRICAO:'Outro'}]}});
 await assert.rejects(f.send,/não foi solicitado/);assert.equal(f.posts.length,0);
 await assert.rejects(listDocuments('225',1,{fetcher:async()=>Response.json({resultado:{}})}),/consultar/);
});

test('accepts PDF, PNG, JPG and JPEG with matching signature and MIME',async()=>{
 const files=[['pdf','application/pdf',Buffer.from('%PDF-1.7 mock')],['png','image/png',Buffer.from([137,80,78,71,13,10,26,10,0])],['jpg','image/jpeg',Buffer.from([255,216,255,224])],['jpeg','image/jpeg',Buffer.from([255,216,255,225])]];
 for(const [ext,mime,plain] of files){const f=fixture({plain,media:{file_name:`frente.${ext}`,mime_type:mime}});const result=await f.send();assert.equal(result.primaryKey,'1;225;77;28');assert.equal(f.posts.length,1);assert.equal(JSON.parse(f.posts[0].options.body).base64,plain.toString('base64'));}
});

test('rejects extension, declared MIME, and content-signature mismatches',async()=>{
 for(const options of [{media:{file_name:'documento.exe'}},{media:{mime_type:'image/png'}},{plain:Buffer.from('not a PDF')}]){
  const f=fixture(options);await assert.rejects(f.send);assert.equal(f.posts.length,0);
 }
});

test('requires exactly one selected file',async()=>{
 for(const media of [undefined,[],[{},{}],[null]])await assert.rejects(saveDocument({idps:'225',cpf,codDocumento:'28',media}),/Anexe/);
});

test('size boundary permits 740KiB while keeping JSON below 1MiB',async()=>{
 const plain=Buffer.alloc(MAX_FILE_BYTES);plain.write('%PDF-1.7');const f=fixture({plain});await f.send();
 assert.ok(Buffer.byteLength(f.posts[0].options.body)<1024*1024);
 const large=Buffer.alloc(MAX_FILE_BYTES+1);large.write('%PDF-1.7');const g=fixture({plain:large});await assert.rejects(g.send,/740 KB/);assert.equal(g.posts.length,0);
});

test('cancels oversized streamed download even without content-length',async()=>{
 let cancelled=false;
 const body=new ReadableStream({pull(controller){controller.enqueue(new Uint8Array(800000));},cancel(){cancelled=true;}});
 await assert.rejects(downloadMedia({cdn_url:'https://mmg.whatsapp.net/f'},{fetcher:async()=>new Response(body)}),/740 KB/);assert.equal(cancelled,true);
});

test('blocks private and lookalike URL destinations and redirects',async()=>{
 for(const url of ['http://mmg.whatsapp.net/f','https://127.0.0.1/f','https://mmg.whatsapp.net.evil.example/f','https://evilfbcdn.net/f','https://user:pass@mmg.whatsapp.net/f','https://mmg.whatsapp.net:8443/f']) {
  await assert.rejects(downloadMedia({cdn_url:url},{fetcher:()=>assert.fail('must not fetch')}),/inválido/);
 }
 await assert.rejects(downloadMedia({cdn_url:'https://mmg.whatsapp.net/f'},{fetcher:async()=>Response.redirect('https://example.com')}),/baixar/);
});

test('malformed metadata and authentication failures produce friendly errors',()=>{
 const sample=encrypted();
 for(const patch of [{},{iv:'bad'},{encrypted_hash:'AA=='},{encryption_key:null},{hmac_key:crypto.randomBytes(32).toString('base64')},{plaintext_hash:crypto.randomBytes(32).toString('base64')}]) {
  const meta=Object.keys(patch).length?{...sample.media.encryption_metadata,...patch}:{};
  assert.throws(()=>decryptMedia(sample.file,meta),/^Error: Arquivo recebido não confere/);
 }
 const corrupt=Buffer.from(sample.file);corrupt[0]^=1;assert.throws(()=>decryptMedia(corrupt,sample.media.encryption_metadata),/não confere/);
});

test('download failure never reaches academic write',async()=>{
 await assert.rejects(downloadMedia({cdn_url:'https://mmg.whatsapp.net/f'},{fetcher:async()=>{throw new Error('expired')}}),/baixar/);
 await assert.rejects(downloadMedia({cdn_url:'https://mmg.whatsapp.net/f'},{fetcher:async()=>new Response('',{status:403})}),/baixar/);
});

test('timeout or inconclusive academic result is uncertain and never retried',async()=>{
 for(const config of [
  {postError:new DOMException('timeout','TimeoutError')},
  {response:()=>Response.json({status:'ok'})},
  {response:()=>Response.json({status:'ok',primaryKey:'1;225;78;28'})},
  {response:()=>Response.json({error:'gateway'},{status:502})},
  {response:()=>new Response('not json')}
 ]) {const f=fixture(config);await assert.rejects(f.send,error=>error instanceof DocumentWriteUncertainError&&error.uncertain&&error.code==='DOCUMENT_WRITE_UNCERTAIN');assert.equal(f.posts.length,1);}
});

test('documented prewrite RM_BUSY and HTTP validation errors remain explicit failures',async()=>{
 for(const status of [400,401,403,404,413,422,429,503]) {
  const f=fixture({response:()=>Response.json({error:{code:status===503?'RM_BUSY':'INVALID'}},{status})});
  await assert.rejects(f.send,error=>!error.uncertain);assert.equal(f.posts.length,1);
 }
});
