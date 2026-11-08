import {test} from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {routeFlowRequest,flowContext,sealState,openState} from '../api/flow.js';
import {decryptMedia,safeFileName} from '../api/documentos.js';

// Mídia como o WhatsApp entrega no DocumentPicker (Flows "Media upload").
function encryptMedia(plain){
 const key=crypto.randomBytes(32),hmacKey=crypto.randomBytes(32),iv=crypto.randomBytes(16);
 const c=crypto.createCipheriv('aes-256-cbc',key,iv);const ciphertext=Buffer.concat([c.update(plain),c.final()]);
 const mac=crypto.createHmac('sha256',hmacKey).update(Buffer.concat([iv,ciphertext])).digest().subarray(0,10);
 const file=Buffer.concat([ciphertext,mac]);
 return {file,meta:{encrypted_hash:crypto.createHash('sha256').update(file).digest('base64'),iv:iv.toString('base64'),encryption_key:key.toString('base64'),hmac_key:hmacKey.toString('base64'),plaintext_hash:crypto.createHash('sha256').update(plain).digest('base64')}};
}

test('descriptografa a mídia do WhatsApp e recusa arquivo adulterado',()=>{
 const plain=Buffer.from('%PDF-1.4 historico teste');const {file,meta}=encryptMedia(plain);
 assert.deepEqual(decryptMedia(file,meta),plain);
 const bad=Buffer.from(file);bad[0]^=1;assert.throws(()=>decryptMedia(bad,meta),/não confere/);
 assert.equal(safeFileName('../../Histórico Escolar.PDF'),'Historico-Escolar.PDF');assert.equal(safeFileName('virus.exe'),'documento.pdf');
});

test('transferência: conclui, abre acompanhamento sem fechar o Flow e envia o histórico pelo DocumentPicker',async()=>{
 process.env.FLOW_PRIVATE_KEY='unit-documentos-key';process.env.RBS_TOKEN='unit';
 const plain=Buffer.from('%PDF-1.4 historico academico teste');const {file,meta}=encryptMedia(plain);
 const calls=[];const previous=globalThis.fetch;
 globalThis.fetch=async(input,options={})=>{
  const u=new URL(String(input));calls.push(u.origin+u.pathname);
  if(u.origin==='https://cdn.whatsapp.test')return new Response(file);
  if(u.origin==='https://api.unibalsas.edu.br'){
   if(u.pathname==='/rm/documents'){assert.equal(u.searchParams.get('idps'),'225');return Response.json({resultado:[{CODDOCUMENTO:'28',DESCRICAO:'HISTÓRICO ACADÊMICO'}]})}
   if(u.pathname==='/blip/inscritos/225/11144477735')return Response.json({CODCOLIGADA:'1',IDPS:'225',NUMEROINSCRICAO:'77',NOME:'TESTE',CPF:'11144477735'});
   assert.equal(u.pathname,'/blip/documents');
   assert.deepEqual(Object.fromEntries(u.searchParams),{codColigada:'1',idps:'225',numeroInscricao:'77',codDocumento:'28',nomeArquivo:'historico.pdf'});
   assert.equal(JSON.parse(options.body).base64,plain.toString('base64'));
   return Response.json({status:'ok',primaryKey:'1;225;77;28'});
  }
  assert.equal(u.origin,'https://admin.portal.apprbs.com.br');const b=options.body?JSON.parse(options.body):{};
  if(u.pathname.endsWith('/submit'))return Response.json({success:true,token:'apos-inscricao',data:{redirect:{applyment_id:'990001'}}});
  if(u.pathname.endsWith('/portal')){assert.equal(b.token,'apos-inscricao');return Response.json({success:true,data:{current_process:{id:20385,stages:[
   {title:'Inscrição',feedback:{conclusive:1,complementary_text:'Concluída'}},
   {title:'Documentos inscrição',feedback:{conclusive:0,complementary_text:'Pendentes',cta_text:'Enviar'},cta_link:'presencial/passo/300696'}]}}})}
  if(u.pathname.endsWith('/form'))return Response.json({success:true,token:'apos-inscricao',data:{form:{id:300696,content:{inputs:[],buttons:[{button:3940675,label:'Enviar'}]},querys:[]}}});
  throw new Error('chamada inesperada '+u.pathname);
 };
 const run=r=>{r=structuredClone(r);return flowContext.run({request:r,write:null,deadline:Date.now()+60000},()=>routeFlowRequest(r))};
 const ask=(screen,acao,estado,user={})=>({screen,action:'data_exchange',flow_token:'t',data:{acao,estado,...user}});
 try{
  const state=sealState('QUASE_LA',{processo_seletivo_id:'20385',token:'final',button_id:'5',campo_cpf_id:'1',campo_nacionalidade_id:'2',campo_ensino_medio_id:'3',campo_deficiencia_id:'4',campo_origem_id:'6',origens:[{id:'01',title:'Site'}]});
  const hub=await run(ask('QUASE_LA','enviar_informacoes_complementares',state,{cpf:'111.444.777-35',nacionalidade:'10',concluiu_ensino_medio:'Sim',possui_deficiencia:'F',como_conheceu:'01'}));
  assert.equal(hub.screen,'ACOMPANHAMENTO');assert.match(hub.data.mensagem,/Transferência/);assert.equal(hub.data.acao_rodape,'continuar_etapa');assert.match(hub.data.resumo,/👉 Documentos inscrição/);
  const docs=await run(ask('ACOMPANHAMENTO','continuar_etapa',hub.data.estado));
  assert.equal(docs.screen,'DOCUMENTOS_INSCRICAO');assert.deepEqual(docs.data.documentos.map(d=>d.id),['28']);assert.equal(docs.data.enviados,'Nenhum documento enviado ainda.');
  const media=[{media_id:'m1',cdn_url:'https://cdn.whatsapp.test/f',file_name:'historico.pdf',encryption_metadata:meta}];
  const noType=await run(ask('DOCUMENTOS_INSCRICAO','enviar_documento',docs.data.estado,{documento:'',arquivo:media}));
  assert.equal(noType.data.tem_erro,true);assert.ok(!calls.includes('https://api.unibalsas.edu.br/blip/documents'));
  const sent=await run(ask('DOCUMENTOS_INSCRICAO','enviar_documento',docs.data.estado,{documento:'28',arquivo:media}));
  assert.equal(sent.screen,'DOCUMENTOS_INSCRICAO');assert.equal(sent.data.tem_erro,false);assert.match(sent.data.enviados,/HISTÓRICO ACADÊMICO recebido/);
  assert.equal(openState(sent.data.estado,'DOCUMENTOS_INSCRICAO').arquivo,undefined,'chaves da mídia não ficam no estado');
 }finally{globalThis.fetch=previous}
});

test('se o portal não responder logo após a inscrição, mantém a confirmação tradicional',async()=>{
 process.env.FLOW_PRIVATE_KEY='unit-documentos-key';process.env.RBS_TOKEN='unit';
 const previous=globalThis.fetch;
 globalThis.fetch=async(input,options={})=>{const u=new URL(String(input));if(u.pathname.endsWith('/submit'))return Response.json({success:true,data:{redirect:{applyment_id:'990002'}}});return Response.json({success:false},{status:401})};
 try{
  const state=sealState('QUASE_LA',{processo_seletivo_id:'20384',token:'final',button_id:'5',campo_cpf_id:'1',campo_nacionalidade_id:'2',campo_ensino_medio_id:'3',campo_deficiencia_id:'4',campo_origem_id:'6',origens:[{id:'01',title:'Site'}]});
  const req={screen:'QUASE_LA',action:'data_exchange',flow_token:'t',data:{acao:'enviar_informacoes_complementares',estado:state,cpf:'11144477735',nacionalidade:'10',concluiu_ensino_medio:'Sim',possui_deficiencia:'F',como_conheceu:'01'}};
  const r=await flowContext.run({request:req,write:null,deadline:Date.now()+60000},()=>routeFlowRequest(structuredClone(req)));
  assert.equal(r.screen,'CONFIRMACAO');assert.match(r.data.mensagem,/Já sou inscrito/);
 }finally{globalThis.fetch=previous}
});
