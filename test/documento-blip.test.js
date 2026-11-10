import {test} from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {saveDocumentFromUrl,downloadBlipMedia,MAX_FILE_BYTES} from '../api/documentos.js';
import {createBlipDocumentHandler,parseNfmReply} from '../api/documento-blip.js';

const HOST='https://blipmediastore.blob.core.windows.net';
const PDF=Buffer.from('%PDF-1.4 arquivo de teste');
const sha=b=>crypto.createHash('sha256').update(b).digest('base64');
// Forma do json_response real do Blip (URL de teste, sem assinatura real).
const nfm=(over={},file={})=>JSON.stringify({documento:'28',documents:[{id:1413196110792069,mime_type:'application/pdf',sha256:sha(PDF),file_name:'Relatório de Auditoria Técnica.pdf',file_url:`${HOST}/thread-medias/Media_5_x?sv=2024-05-04&se=2026-10-16T21%3A51%3A57Z&sig=TESTE`,...file}],flow_token:'sessao-123',...over});

function world({body=PDF,rm=[{CODDOCUMENTO:'28',DESCRICAO:'HISTÓRICO ACADÊMICO'}],post=()=>Response.json({status:'ok',primaryKey:'1;225;55;28'}),blip=()=>new Response(body)}={}){
 const sent=[],calls=[];
 const fetcher=async(input,o={})=>{
  const u=new URL(String(input));calls.push(u.href);
  if(u.origin===HOST)return blip(o);
  if(u.pathname==='/rm/documents')return Response.json({resultado:rm});
  if(u.pathname.startsWith('/blip/inscritos/'))return Response.json({CODCOLIGADA:'1',IDPS:'225',NUMEROINSCRICAO:'55'});
  sent.push({q:Object.fromEntries(u.searchParams),body:JSON.parse(o.body)});return post();
 };
 return {fetcher,sent,calls};
}
function call(handler,{method='POST',body,key='segredo',url='/api/documento'}={}){
 return new Promise(resolve=>{
  const res={statusCode:0,status(c){this.statusCode=c;return this},json(b){resolve({status:this.statusCode,body:b})},send(b){resolve({status:this.statusCode,body:b})}};
  handler({method,url,headers:key===null?{}:{'x-api-key':key},body},res);
 });
}
const make=w=>createBlipDocumentHandler({apiKey:()=>'segredo',fetcher:w.fetcher});

test('parseNfmReply lê o json_response do Blip (string) e aceita os nomes de chave do Flow',()=>{
 const p=parseNfmReply(nfm());
 assert.equal(p.documento,'28');assert.equal(p.files.length,1);assert.equal(p.files[0].file_name,'Relatório de Auditoria Técnica.pdf');
 assert.equal(parseNfmReply({documento:'10',arquivo:[{file_url:'x'}]}).files.length,1);
 assert.throws(()=>parseNfmReply('não é json'),/inválida/);
});

test('fluxo completo: baixa do Blip, confere sha256, grava no RM com o nome do tipo real',async()=>{
 const w=world();const h=make(w);
 const r=await call(h,{body:{json_response:nfm(),cpf:'389.637.573-31',processo_seletivo_id:'20385'}});
 assert.equal(r.status,200);assert.equal(r.body.ok,true);assert.equal(r.body.documento,'HISTÓRICO ACADÊMICO');
 assert.match(r.body.mensagem,/HISTÓRICO ACADÊMICO recebido/);
 assert.equal(w.sent.length,1);
 assert.equal(w.sent[0].q.idps,'225');assert.equal(w.sent[0].q.codDocumento,'28');assert.equal(w.sent[0].q.numeroInscricao,'55');
 assert.match(w.sent[0].q.nomeArquivo,/\.pdf$/);assert.equal(w.sent[0].q.nomeArquivo.includes(' '),false,'nome sem espaços/acentos');
 assert.equal(Buffer.from(w.sent[0].body.base64,'base64').equals(PDF),true);
 assert.ok(!JSON.stringify(r.body).includes('sig='),'a URL assinada nunca volta na resposta');
});

test('segurança: sem chave, host fora da lista, http, redirect e documento fora da lista são recusados',async()=>{
 const w=world();const h=make(w);
 assert.equal((await call(h,{key:null,body:{}})).status,401);
 assert.equal((await call(h,{key:'errada',body:{}})).status,401);
 const base={cpf:'38963757331',processo_seletivo_id:'20385'};
 const evil=await call(h,{body:{...base,json_response:nfm({},{file_url:'https://evil.example/x.pdf'})}});
 assert.equal(evil.status,422);assert.equal(w.calls.some(c=>c.includes('evil.example')),false,'nem chega a baixar');
 assert.equal((await call(h,{body:{...base,json_response:nfm({},{file_url:HOST.replace('https','http')+'/x'})}})).status,422);
 assert.equal((await call(h,{body:{...base,json_response:nfm({documento:'999'})}})).status,400);
 assert.equal((await call(h,{body:{...base,json_response:nfm({documento:''})}})).status,400);
 assert.equal((await call(h,{body:{...base,cpf:'123'}})).status,400);
 assert.equal((await call(h,{body:{...base,processo_seletivo_id:'1'}})).status,400);
 const redirect=world({blip:()=>new Response('',{status:302,headers:{location:'https://evil.example/'}})});
 assert.equal((await call(make(redirect),{body:{...base,json_response:nfm()}})).status,422);
 assert.equal(w.sent.length,0);
});

test('arquivo: sha256 diferente, tipo inválido, acima de 740 KB e link expirado não gravam nada',async()=>{
 const base={cpf:'38963757331',processo_seletivo_id:'20385'};
 const bad=world({body:Buffer.from('%PDF-1.4 outro conteudo')});
 assert.match((await call(make(bad),{body:{...base,json_response:nfm()}})).body.mensagem,/não confere/);
 const docx=Buffer.from('PK\u0003\u0004docx');const t=world({body:docx});
 assert.match((await call(make(t),{body:{...base,json_response:nfm({},{sha256:sha(docx)})}})).body.mensagem,/PDF, JPG ou PNG/);
 const big=Buffer.concat([Buffer.from('%PDF-1.4 '),Buffer.alloc(MAX_FILE_BYTES+10)]);const g=world({body:big});
 assert.match((await call(make(g),{body:{...base,json_response:nfm({},{sha256:sha(big)})}})).body.mensagem,/maior que 740 KB/);
 const gone=world({blip:()=>new Response('',{status:403})});
 assert.match((await call(make(gone),{body:{...base,json_response:nfm()}})).body.mensagem,/expirou/);
 for(const x of [bad,t,g,gone])assert.equal(x.sent.length,0);
});

test('erros do RM: 503 ocupado e timeout do POST viram mensagem clara, sem expor a URL',async()=>{
 const base={cpf:'38963757331',processo_seletivo_id:'20385'};
 const busy=world({post:()=>Response.json({},{status:503})});
 assert.match((await call(make(busy),{body:{...base,json_response:nfm()}})).body.mensagem,/muitos envios/);
 const slow=world({post:()=>{throw new DOMException('t','TimeoutError')}});
 const r=await call(make(slow),{body:{...base,json_response:nfm()}});
 assert.match(r.body.mensagem,/Confira no Portal do candidato/);assert.ok(!JSON.stringify(r.body).includes('sig='));
});

test('GET devolve a lista só com id/title para o bot montar o Flow',async()=>{
 const w=world({rm:[{CODDOCUMENTO:'28',DESCRICAO:'HISTÓRICO ACADÊMICO'},{CODDOCUMENTO:'29',DESCRICAO:'PLANOS DE ENSINO (EMENTAS)'}]});
 const r=await call(make(w),{method:'GET',url:'/api/documento?processo_seletivo_id=20385'});
 assert.equal(r.status,200);assert.deepEqual(r.body.documentos,[{id:'28',title:'HISTÓRICO ACADÊMICO'},{id:'29',title:'PLANOS DE ENSINO (EMENTAS)'}]);
 assert.ok(!JSON.stringify(r.body).includes('descricao'));assert.match(r.body.texto,/740 KB/);
 assert.equal((await call(make(w),{method:'GET',key:null})).status,401);
});

test('JSON do Flow de documentos: tela terminal com complete, picker de 740 KB e Dropdown só id/title',async()=>{
 const j=JSON.parse(await readFile(new URL('../flow-documentos-blip.json',import.meta.url)));
 const s=j.screens[0];assert.equal(j.screens.length,1);assert.equal(s.terminal,true);assert.equal(s.success,true);
 assert.deepEqual(Object.keys(s.data.documentos.items.properties).sort(),['id','title']);
 const kids=s.layout.children;
 const picker=kids.find(c=>c.type==='DocumentPicker');
 assert.equal(picker['max-file-size-kb'],740);assert.equal(picker['max-uploaded-documents'],1);assert.deepEqual(picker['allowed-mime-types'],['application/pdf','image/jpeg','image/png']);
 assert.equal(kids.filter(c=>c.type==='DocumentPicker'||c.type==='PhotoPicker').length,1,'um picker por tela');
 const f=kids.find(c=>c.type==='Footer');assert.equal(f['on-click-action'].name,'complete');
 assert.deepEqual(Object.keys(f['on-click-action'].payload).sort(),['arquivo','documento']);
 assert.ok(f.label.length<=35);
});
