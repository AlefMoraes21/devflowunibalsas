import {test} from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
process.env.FLOW_PRIVATE_KEY??='local-unit-key';
const {responseForScreen,openState}=await import('../api/flow.js');
const {createMatricula,MATRICULA_DOCS,screenForStep,describeUploadForm,matriculaUploadBinding}=await import('../api/matricula.js');
const {readDocument}=await import('../api/documentos.js');

// Documentos de matrícula do Vestibular (passo "Documentos matrícula"): os 7 documentos do Portal, 3 obrigatórios.
// O arquivo do DocumentPicker segue ao Rubeus no /submit do botão 3940449, nos campos do componente de upload.
const FORM={id:300671,content:{
 inputs:[{field_id:38611,value:1},{field_id:38613,value:79},{field_id:38651,value:'27.1.23520'},{field_id:38730,value:null},{field_id:38733,value:null},{field_id:1,value:null}],
 buttons:[{button:3940449,label:'Envia documentos de matrícula'}]}};
const STEP={step:300671,title:'Documentos matrícula'};
const SESSION={cpf:'11144477735',processo_seletivo_id:'20383',token:'tok-1'};

function setup({form=FORM,upload=true,submit}={}){
 const submitted=[];
 const docs={readDocument:async()=>({base64:'QUJD',type:'pdf',size:3,originalName:'x.pdf'}),listDocuments:async()=>[],saveDocument:async()=>({})};
 const submitForm=submit??(async(button,fields,token)=>{submitted.push({button,fields,token});return {success:true,data:{token:'tok-2'}}});
 const m=createMatricula({api:async()=>({}),getForm:async()=>({data:{form}}),submitForm,getDataSource:async()=>({}),render:responseForScreen,academicId:()=>null,docs,matriculaUpload:upload});
 return {m,submitted};
}
const send=(m,res,id)=>m.sendDocument({...openState(res.data.estado,'DOCUMENTOS_INSCRICAO'),documento:id,arquivo:[{file_name:'x.pdf'}]});

test('rotas da Meta: o hub abre a tela de documentos; vindo de IDENTIDADE (mais adiante na ordem) não há rota de volta',async()=>{
 const {canAdvance}=await import('../api/matricula.js');
 assert.equal(canAdvance('PORTAL_STATUS','DOCUMENTOS_INSCRICAO'),true);
 assert.equal(canAdvance('ACOMPANHAMENTO','DOCUMENTOS_INSCRICAO'),true);
 assert.equal(canAdvance('IDENTIDADE','DOCUMENTOS_INSCRICAO'),false);
});

test('screenForStep: "Documentos matrícula" usa a tela de documentos; contrato segue no portal',()=>{
 assert.equal(screenForStep('Documentos matrícula',FORM),'DOCUMENTOS_INSCRICAO');
 assert.equal(screenForStep('Documentos inscrição',FORM),'DOCUMENTOS_INSCRICAO');
 assert.equal(screenForStep('Contrato',FORM),'ETAPA_PORTAL');
});

test('abertura: 7 documentos {id,title}, 0 de 3 obrigatórios, modo matrícula só no estado selado',async()=>{
 const {m}=setup();
 const r=await m.open(SESSION,STEP);
 assert.equal(r.screen,'DOCUMENTOS_INSCRICAO');
 assert.deepEqual(r.data.documentos.map(d=>d.id),['1','2','5','8','15','16','46']);
 for(const d of r.data.documentos){assert.deepEqual(Object.keys(d).sort(),['id','title']);assert.ok(d.title.length<=30,d.title)}
 assert.ok(!JSON.stringify(r).includes('"descricao"')&&!JSON.stringify(r).includes('obrigatorio'));
 assert.match(r.data.progresso,/^0 de 3 documentos obrigatórios enviados\. Falta: HISTÓRICO ENSINO MÉDIO, CERTIFICADO DE CONCLUSÃO ENSINO MÉDIO, DECLARAÇÃO DE CONCLUSÃO ENSINO MÉDIO\.$/);
 assert.equal(r.data.concluido,false);assert.equal(r.data.acao_rodape,'enviar_documento');
 const sealed=openState(r.data.estado,'DOCUMENTOS_INSCRICAO');
 assert.equal(sealed.doc_modo,'matricula');assert.equal(sealed.button_id,'3940449');
 assert.deepEqual(sealed.ocultos.map(o=>o.field_id).sort((a,b)=>a-b),[1,38611,38613,38651].filter(id=>id!==1));
});

test('envio: /submit do botão 3940449 com arquivo, nome, código e CHAVERM; campos técnicos preservados',async()=>{
 const {m,submitted}=setup();
 const r=await m.open(SESSION,STEP);
 const out=await send(m,r,'5');
 assert.equal(submitted.length,1);
 const {button,fields,token}=submitted[0];
 assert.equal(Number(button),3940449);assert.equal(token,'tok-1');
 const f=id=>fields.find(x=>x.field_id===id)?.value;
 assert.equal(f(38730),'QUJD');assert.equal(f(38731),'HISTÓRICO ENSINO MÉDIO.pdf');assert.equal(f(38733),'5');assert.equal(f(38718),'1;79;27.1.23520;5');
 assert.equal(f(38611),1);assert.equal(f(38651),'27.1.23520');
 assert.match(out.data.enviados,/✅ HISTÓRICO ENSINO MÉDIO recebido \(HISTÓRICO ENSINO MÉDIO\.pdf\)/);
 assert.equal(openState(out.data.estado,'DOCUMENTOS_INSCRICAO').arquivo,undefined,'a mídia não fica no estado');
 assert.equal(openState(out.data.estado,'DOCUMENTOS_INSCRICAO').token,'tok-2','usa o token devolvido pelo Rubeus');
});

test('só os 3 obrigatórios concluem; opcional não conta; reenvio é atualização',async()=>{
 const {m}=setup();
 let r=await m.open(SESSION,STEP);
 r=await send(m,r,'1'); // opcional
 assert.equal(r.data.concluido,false);assert.match(r.data.progresso,/^0 de 3 /);
 r=await send(m,r,'5');assert.match(r.data.progresso,/^1 de 3 /);
 r=await send(m,r,'5');assert.match(r.data.enviados,/HISTÓRICO ENSINO MÉDIO atualizado/);assert.match(r.data.progresso,/^1 de 3 /);
 r=await send(m,r,'8');assert.match(r.data.progresso,/^2 de 3 .* Falta: DECLARAÇÃO DE CONCLUSÃO ENSINO MÉDIO\.$/);assert.equal(r.data.concluido,false);
 r=await send(m,r,'46');
 assert.equal(r.data.concluido,true);assert.match(r.data.progresso,/Os 3 documentos obrigatórios foram enviados/);
 assert.equal(r.data.acao_rodape,'atualizar_portal');assert.equal(r.data.rotulo_rodape,'Atualizar situação');
 assert.equal(r.data.mostrar_envio,false);assert.equal(r.data.mostrar_concluido,true);
 assert.deepEqual(openState(r.data.estado,'DOCUMENTOS_INSCRICAO').docs_enviados.sort(),['1','46','5','8']);
});

test('sem o botão de envio no formulário, ou com o interruptor desligado, abre o portal como antes',async()=>{
 const noButton=setup({form:{id:300671,content:{inputs:FORM.content.inputs,buttons:[{button:1,label:'Voltar'}]}}});
 assert.equal((await noButton.m.open(SESSION,STEP)).screen,'ETAPA_PORTAL');
 const off=setup({upload:false});
 const r=await off.m.open(SESSION,STEP);
 assert.equal(r.screen,'ETAPA_PORTAL');assert.match(r.data.link_portal,/passo\/300671$/);
});

test('o Rubeus recusa o envio: mensagem pede conferir o portal e nada é marcado como enviado',async()=>{
 const {m}=setup({submit:async()=>{throw new Error('[RUBEUS_ERRO] /submit não confirmou a operação (HTTP 422).')}});
 const r=await m.open(SESSION,STEP);
 await assert.rejects(()=>send(m,r,'5'),/Confira no Portal do candidato antes de enviar de novo/);
 const {m:m2}=setup({submit:async()=>({success:false})});
 const r2=await m2.open(SESSION,STEP);
 await assert.rejects(()=>send(m2,r2,'5'),/não aceitou este documento/);
});

test('validações: documento fora da lista e sessão sem token',async()=>{
 const {m}=setup();
 const r=await m.open(SESSION,STEP);
 await assert.rejects(()=>send(m,r,'999'),/Escolha qual documento/);
 await assert.rejects(()=>m.sendDocument({...openState(r.data.estado,'DOCUMENTOS_INSCRICAO'),token:'',documento:'5',arquivo:[{}]}),/sessão expirou/);
});

test('diagnóstico do formulário não leva valores, só quais campos e botões existem',()=>{
 const d=describeUploadForm(FORM);
 assert.deepEqual(d.buttons,[{button:3940449,label:'Envia documentos de matrícula'}]);
 assert.ok(d.inputs.some(i=>i.field_id===38730&&i.has_value===false));
 assert.ok(!JSON.stringify(d).includes('27.1.23520'));
 assert.equal(matriculaUploadBinding({id:1,content:{inputs:[],buttons:[]}}),null);
 assert.equal(MATRICULA_DOCS.filter(x=>x.obrigatorio).length,3);
});

// Mídia como o WhatsApp entrega no DocumentPicker.
function encryptMedia(plain){
 const key=crypto.randomBytes(32),hmacKey=crypto.randomBytes(32),iv=crypto.randomBytes(16);
 const c=crypto.createCipheriv('aes-256-cbc',key,iv);const ciphertext=Buffer.concat([c.update(plain),c.final()]);
 const mac=crypto.createHmac('sha256',hmacKey).update(Buffer.concat([iv,ciphertext])).digest().subarray(0,10);
 const file=Buffer.concat([ciphertext,mac]);
 return {file,media:[{media_id:'m',cdn_url:'https://cdn.whatsapp.test/f',file_name:'historico.pdf',encryption_metadata:{encrypted_hash:crypto.createHash('sha256').update(file).digest('base64'),iv:iv.toString('base64'),encryption_key:key.toString('base64'),hmac_key:hmacKey.toString('base64'),plaintext_hash:crypto.createHash('sha256').update(plain).digest('base64')}}]};
}

test('readDocument: decifra, valida o tipo real e o limite de 740 KB',async()=>{
 const pdf=Buffer.from('%PDF-1.4 teste matricula');
 const ok=encryptMedia(pdf);
 const r=await readDocument({media:ok.media,fetcher:async()=>new Response(ok.file)});
 assert.equal(r.type,'pdf');assert.equal(r.base64,pdf.toString('base64'));assert.equal(r.size,pdf.length);
 const exe=encryptMedia(Buffer.from('MZ-programa'));
 await assert.rejects(()=>readDocument({media:exe.media,fetcher:async()=>new Response(exe.file)}),/não é aceito/);
 const big=encryptMedia(Buffer.concat([Buffer.from('%PDF-1.4 '),Buffer.alloc(741*1024)]));
 await assert.rejects(()=>readDocument({media:big.media,fetcher:async()=>new Response(big.file)}),/maior que 740 KB/);
 await assert.rejects(()=>readDocument({media:[],fetcher:async()=>new Response('')}),/Anexe um arquivo/);
});

test('sondagem do portal: recebe passo e token ao abrir; falha dela não derruba a etapa',async()=>{
 const calls=[];
 const mk=probe=>createMatricula({api:async()=>({}),getForm:async()=>({data:{form:FORM}}),submitForm:async()=>({}),getDataSource:async()=>({}),render:responseForScreen,academicId:()=>null,docs:{readDocument:async()=>({}),listDocuments:async()=>[],saveDocument:async()=>({})},portalProbe:probe});
 const ok=await mk(async a=>{calls.push(a)}).open(SESSION,STEP);
 assert.equal(ok.screen,'DOCUMENTOS_INSCRICAO');assert.deepEqual(calls,[{step:300671,token:'tok-1',processId:'20383'}]);
 const bad=await mk(async()=>{throw new Error('boom')}).open(SESSION,STEP);
 assert.equal(bad.screen,'DOCUMENTOS_INSCRICAO');
});

test('log do anexo: formato e metadados, sem chaves nem endereço completo',async()=>{
 const {describeMedia}=await import('../api/matricula.js');
 const d=describeMedia([{media_id:'m',cdn_url:'https://cdn.whatsapp.test/segredo?x=1',file_name:'Historico.PDF',encryption_metadata:{encryption_key:'KEY',iv:'IV',hmac_key:'H',plaintext_hash:'p',encrypted_hash:'e'}}]);
 assert.equal(d.cdn_host,'cdn.whatsapp.test');assert.equal(d.cdn_https,true);assert.equal(d.ext,'pdf');assert.equal(d.has_key,true);
 assert.ok(!JSON.stringify(d).match(/KEY|segredo|Historico/));
 assert.deepEqual(describeMedia(undefined).media_count,0);assert.equal(describeMedia([{}]).cdn_https,null);
});
