import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {routeFlowRequest,flowContext,sealState,openState} from '../api/flow.js';
import {SCREENS,summarizeStages,search,canAdvance} from '../api/matricula.js';

const flowJson=()=>readFile(new URL('../flow-waba.json',import.meta.url)).then(JSON.parse);
function walk(x,out=[]){if(Array.isArray(x))x.forEach(v=>walk(v,out));else if(x&&typeof x==='object'){if(x.type)out.push(x);for(const v of Object.values(x))if(v&&typeof v==='object')walk(v,out)}return out}

test('routing_model: só rotas para frente, sem ciclos, até 10 destinos e todas as telas existem',async()=>{
 const j=await flowJson(),r=j.routing_model,ids=new Set(j.screens.map(s=>s.id));
 for(const [from,to] of Object.entries(r)){assert.ok(ids.has(from),from);assert.ok(to.length<=10,from);for(const t of to){assert.ok(ids.has(t),t);assert.ok(!(r[t]??[]).includes(from),`${from}<->${t}`)}}
 const state={};const visit=id=>{if(state[id]===1)throw new Error('ciclo em '+id);if(state[id]===2)return;state[id]=1;(r[id]??[]).forEach(visit);state[id]=2};Object.keys(r).forEach(visit);
 for(const s of j.screens.filter(s=>!s.terminal&&s.id!=='OPTIN_SCREEN_screen_dhaobf'))assert.ok((r[s.id]??[]).length>0,s.id+' sem saída');
});

test('telas novas respeitam limites de componentes da Meta e batem com o servidor',async()=>{
 const j=await flowJson();
 for(const id of Object.keys(SCREENS)){
  const s=j.screens.find(x=>x.id===id);assert.ok(s,id);
  assert.deepEqual(Object.keys(s.data).sort(),[...SCREENS[id]].sort(),id+': data do JSON = chaves do servidor');
  const comps=walk(s.layout);
  assert.equal(comps.filter(c=>c.type==='Footer').length,1,id+': um Footer');
  const links=comps.filter(c=>c.type==='EmbeddedLink');assert.ok(links.length<=2,id);links.forEach(l=>assert.ok(l.text.length<=25,l.text));
  comps.filter(c=>c.type==='Footer'&&!c.label.startsWith('${')).forEach(f=>assert.ok(f.label.length<=35,f.label));
  assert.ok(comps.length<=50,id);
  for(const c of comps)for(const v of [c.text,c.label])if(typeof v==='string'&&v.includes('${data.')){const k=v.match(/\$\{data\.([a-z_]+)\}/)[1];assert.ok(k in s.data,`${id}: ${k}`)}
  for(const c of comps)if(typeof c['data-source']==='string'){const k=c['data-source'].match(/\$\{data\.([a-z_]+)\}/)[1];assert.equal(s.data[k].type,'array',`${id}: ${k}`)}
 }
 const first=j.screens.find(s=>s.id==='ESCOLHA_PROCESSO');assert.ok(j.routing_model.ESCOLHA_PROCESSO.includes('PORTAL_STATUS'));assert.ok(JSON.stringify(first).includes('Já sou inscrito'));
 assert.ok(!j.screens.some(s=>s.id==='LOGIN_CANDIDATO'));
 // A WABA exige que init-values tenha o mesmo tipo do input: campos "number" não aceitam ${data.valor_*} (string).
 for(const s of j.screens){const forms=walk(s.layout).filter(c=>c.type==='Form'&&c['init-values']);for(const f of forms)for(const c of walk(f.children))if(c.type==='TextInput'&&c['input-type']==='number')assert.ok(!(c.name in f['init-values']),`${s.id}.${c.name}`)}
 for(const s of ['QUASE_LA','TELA_REDACAO'])assert.ok(j.routing_model[s].includes('ACOMPANHAMENTO'),s);
 const doc=walk(j.screens.find(s=>s.id==='DOCUMENTOS_INSCRICAO').layout).find(c=>c.type==='DocumentPicker');assert.equal(doc['max-uploaded-documents'],1);assert.ok(doc['max-file-size-kb']<=740);
});

test('resumo do portal escolhe a primeira etapa pendente com ação',()=>{
 const s=summarizeStages([
  {title:'Inscrição',feedback:{conclusive:1,complementary_text:'Concluída'},cta_link:'presencial/feedback/1'},
  {title:'Prova online',feedback:{conclusive:1,complementary_text:'Aprovado'},cta_link:null},
  {title:'Seleção resp. financeiro',feedback:{conclusive:0,complementary_text:'Pendente',cta_text:'Verificar'},cta_link:'presencial/passo/300676'},
  {title:'Pré-matrícula',feedback:{conclusive:0,complementary_text:'Informe o responsável',cta_text:null},cta_link:null}]);
 assert.equal(s.next.step,300676);assert.match(s.resumo,/👉 Seleção resp\. financeiro: Pendente/);assert.match(s.resumo,/✅ Prova online: Aprovado/);
 assert.deepEqual(search([{id:'1',title:'Balsas'},{id:'2',title:'São Félix de Balsas'},{id:'3',title:'Bacabal'}],'bals').map(x=>x.id),['1','2']);
 assert.equal(canAdvance('ENDERECO','IDENTIDADE'),true);assert.equal(canAdvance('IDENTIDADE','ENDERECO'),false);assert.equal(canAdvance('ETAPA_PORTAL','ETAPA_PORTAL'),true);
});

const radioForm={id:300676,content:{inputs:[{field_id:232542,label:'Quem é seu responsável financeiro?',type:'radio',data:[{value:'Eu',display:'Eu'},{value:'Outro',display:'Outro'}]},{field_id:38608,label:'CODUSUARIOPS',type:'text',value:'20049'}],buttons:[{button:3940482,label:'Portal do candidato'},{button:3940483,label:'Concluir'}]},querys:[]};
const addressForm={id:300666,content:{inputs:[['Rua',38569],['Número',38570],['Complemento',38572],['Bairro',38571],['Cidade',38574],['Estado - UF',38573],['Estado natal',38641],['Cidade natal',38640],['Idade do candidato',38704]].map(([label,field_id])=>({label,field_id,value:field_id===38704?'19':null})),buttons:[{button:3940406,label:'Portal do candidato'},{button:3940407,label:'Avançar'}]},querys:[{query_data:'q-endereco',fields:[{field:38641},{field:38640},{field:38573},{field:38574}]}]};
const identityForm={id:300667,content:{inputs:[['Número da carteira de identidade',38642],['Órgão emissor da identidade',38643],['UF da carteira de identidade',38644],['Cor / Raça',38645],['Estado civil',38646],['Escola de Ensino Médio',38699],['Ano de conclusão',38680]].map(([label,field_id])=>({label,field_id})),buttons:[{button:3940411,label:'Concluir'}]},querys:[{query_data:'q-uf',fields:[{field:38644}]},{query_data:'q-raca',fields:[{field:38645}]},{query_data:'q-civil',fields:[{field:38646}]},{query_data:'q-ano',fields:[{field:38680}]},{query_data:'q-escola',fields:[{field:38699}]}]};
const docsForm={id:300671,content:{inputs:[{field_id:38733,label:'Tipo do arquivo'}],buttons:[{button:3940449,label:'Enviar'}]},querys:[]};
const stage=(title,conclusive,status,step,cta='Realizar')=>({title,feedback:{conclusive,complementary_text:status,cta_text:step?cta:null},cta_link:step?`presencial/passo/${step}`:null});

function rubeus(portalSequence,forms,submits){
 let portalCall=0;
 return async(input,options={})=>{
  const u=new URL(String(input));assert.equal(u.origin,'https://admin.portal.apprbs.com.br');const b=options.body?JSON.parse(options.body):{};
  if(u.pathname.endsWith('/login/info'))return Response.json({success:true,data:[{key:'LOGIN',label:'CPF ou EMAIL',type:'text'},{key:'DATANASCIMENTO',label:'Data de Nascimento',type:'date'}]});
  if(u.pathname.endsWith('/login')){assert.deepEqual(b.user_data,[{key:'LOGIN',value:'11144477735'},{key:'DATANASCIMENTO',value:'15/03/2007'}]);return Response.json({success:true,data:{person_id:9985265,applyment_id:14083470,session_id:'sessao-1'}})}
  if(u.pathname.endsWith('/portal')){assert.ok(b.token);const stages=portalSequence[Math.min(portalCall++,portalSequence.length-1)];return Response.json({success:true,data:{current_process:{id:20383,stages}}})}
  if(u.pathname.endsWith('/form'))return Response.json({success:true,token:b.token,data:{form:structuredClone(forms[b.target])}});
  if(u.pathname.endsWith('/data-source')){
   if(b.datasource==='q-endereco'&&Number(b.target)===38641)return Response.json({success:true,data:[{value:'MA',label:'Maranhão'},{value:'PI',label:'Piauí'}]});
   if(b.datasource==='q-endereco'&&Number(b.target)===38640){assert.deepEqual(b.filter,[{field:38641,values:'MA'}]);return Response.json({success:true,data:[{value:'00069',label:'Balsas'},{value:'00999',label:'São Félix de Balsas'},{value:'00010',label:'Bacabal'}]})}
   const lists={'q-uf':[['MA','Maranhão']],'q-raca':[['3','Parda']],'q-civil':[['S','Solteiro']],'q-ano':[['2025','2025'],['2026','2026']],'q-escola':[['968','INSTITUTO FEDERAL DO MARANHÃO']]};
   return Response.json({success:true,data:(lists[b.datasource]??[]).map(([value,label])=>({value,label}))});
  }
  assert.ok(u.pathname.endsWith('/submit'),u.pathname);submits.push(b);return Response.json({success:true,token:'sessao-'+(submits.length+1),data:{next:0}});
 };
}
async function run(request){request=structuredClone(request);return flowContext.run({request,write:null,deadline:Date.now()+60000},()=>routeFlowRequest(request))}
const ask=(screen,acao,estado,user={})=>({screen,action:'data_exchange',flow_token:'t',data:{acao,estado,...user}});

test('jornada de matrícula: login, responsável, endereço com busca de cidade, documentos no portal e situação final',async()=>{
 process.env.FLOW_PRIVATE_KEY='unit-matricula-key';process.env.RBS_TOKEN='unit';
 const submits=[],previous=globalThis.fetch;
 const done=[stage('Inscrição',1,'Concluída'),stage('Prova online',1,'Aprovado')];
 globalThis.fetch=rubeus([
  [...done,stage('Seleção resp. financeiro',0,'Pendente',300676,'Verificar')],
  [...done,stage('Seleção resp. financeiro',1,'Concluído'),stage('Pré-matrícula',0,'Pendente',300666)],
  [...done,stage('Pré-matrícula',0,'Pendente',300667)],
  [...done,stage('Pré-matrícula',1,'Concluída'),stage('Documentos matrícula',0,'Pendentes',300671,'Verificar'),stage('Contrato',0,'Aguardando documentação')],
  [...done,stage('Pré-matrícula',1,'Concluída'),stage('Documentos matrícula',1,'Aprovados'),stage('Contrato',0,'Em análise')]
 ],{300676:radioForm,300666:addressForm,300667:identityForm,300671:docsForm},submits);
 try{
  const first=sealState('ESCOLHA_PROCESSO',{});
  const bad=await run(ask('ESCOLHA_PROCESSO','selecionar_processo',first,{modo:'continuar',login:'123',data_nascimento:'2007-03-15'}));
  assert.equal(bad.screen,'ESCOLHA_PROCESSO');assert.equal(bad.data.tem_erro,true);assert.equal(bad.data.valor_modo,'continuar');
  const hub=await run(ask('ESCOLHA_PROCESSO','selecionar_processo',first,{modo:'continuar',login:'111.444.777-35',data_nascimento:'2007-03-15'}));
  assert.equal(hub.screen,'PORTAL_STATUS');assert.equal(hub.data.acao_rodape,'continuar_etapa');assert.match(hub.data.resumo,/Seleção resp\. financeiro/);
  assert.equal(openState(hub.data.estado,'PORTAL_STATUS').applyment_id,'14083470');
  const resp=await run(ask('PORTAL_STATUS','continuar_etapa',hub.data.estado));
  assert.equal(resp.screen,'RESP_FINANCEIRO');assert.deepEqual(resp.data.opcoes_responsavel.map(o=>o.id),['Eu','Outro']);
  const forged=await run(ask('RESP_FINANCEIRO','enviar_responsavel',resp.data.estado,{responsavel:'Hacker'}));
  assert.equal(forged.screen,'RESP_FINANCEIRO');assert.equal(submits.length,0);
  const address=await run(ask('RESP_FINANCEIRO','enviar_responsavel',resp.data.estado,{responsavel:'Eu'}));
  assert.equal(submits.length,1);assert.equal(submits[0].button,3940483);
  assert.deepEqual(submits[0].data.find(f=>f.field_id===232542),{field_id:232542,value:'Eu'});assert.deepEqual(submits[0].data.find(f=>f.field_id===38608),{field_id:38608,value:'20049'});
  assert.equal(address.screen,'ENDERECO');assert.deepEqual(address.data.ufs.map(u=>u.id),['MA','PI']);
  const fill={rua:'Rua Ficticia Teste',numero:'100',bairro:'Centro',cidade:'Balsas',uf:'ma',estado_natal:'MA'};
  const noCity=await run(ask('ENDERECO','enviar_endereco',address.data.estado,fill));assert.equal(noCity.screen,'ENDERECO');assert.match(noCity.data.erro,/cidade natal/i);
  const found=await run(ask('ENDERECO','buscar_cidade',address.data.estado,{...fill,busca_cidade:'balsas'}));
  assert.equal(found.data.cidade_visivel,true);assert.deepEqual(found.data.cidades_natal.map(c=>c.id),['00069','00999']);assert.equal(found.data.valor_rua,'Rua Ficticia Teste');
  const identity=await run(ask('ENDERECO','enviar_endereco',found.data.estado,{...fill,cidade_natal:'00069'}));
  assert.equal(submits.length,2);assert.equal(submits[1].button,3940407);
  const sent=Object.fromEntries(submits[1].data.map(f=>[f.field_id,f.value]));
  assert.equal(sent[38573],'MA');assert.equal(sent[38640],'00069');assert.equal(sent[38641],'MA');assert.equal(sent[38704],'19');assert.equal(sent[38572],undefined);
  assert.equal(identity.screen,'IDENTIDADE');assert.deepEqual(identity.data.anos.map(a=>a.id),['2026','2025']);
  const docs=await run(ask('IDENTIDADE','enviar_identidade',identity.data.estado,{rg:'12.345.678-9',orgao_emissor:'ssp',uf_rg:'MA',cor_raca:'3',estado_civil:'S',ano_conclusao:'2025'}));
  assert.equal(submits.length,3);const idSent=Object.fromEntries(submits[2].data.map(f=>[f.field_id,f.value]));assert.equal(idSent[38642],'123456789');assert.equal(idSent[38643],'SSP');assert.equal(idSent[38699],undefined);
  assert.equal(docs.screen,'ETAPA_PORTAL');assert.match(docs.data.titulo,/documentos/i);assert.match(docs.data.link_portal,/passo\/300671$/);
  const end=await run(ask('ETAPA_PORTAL','atualizar_portal',docs.data.estado));
  assert.equal(end.screen,'STATUS_FINAL');assert.match(end.data.resumo,/Contrato: Em análise/);assert.equal(submits.length,3);
 }finally{globalThis.fetch=previous}
});

test('etapa anterior na ordem do Flow encerra em STATUS_FINAL em vez de criar rota de volta',async()=>{
 process.env.FLOW_PRIVATE_KEY='unit-matricula-key';process.env.RBS_TOKEN='unit';
 const submits=[],previous=globalThis.fetch;
 globalThis.fetch=rubeus([[stage('Seleção resp. financeiro',0,'Pendente',300676)]],{300676:radioForm},submits);
 try{
  const state=sealState('IDENTIDADE',{token:'s',applyment_id:'1',processo_seletivo_id:'20383',campos:{rg:'38642',orgao_emissor:'38643',uf_rg:'38644',cor_raca:'38645',estado_civil:'38646'},button_id:'3940411',ocultos:[],ufs:[{id:'MA',title:'Maranhão'}],racas:[{id:'3',title:'Parda'}],estados_civis:[{id:'S',title:'Solteiro'}]});
  const r=await run(ask('IDENTIDADE','enviar_identidade',state,{rg:'1',orgao_emissor:'SSP',uf_rg:'MA',cor_raca:'3',estado_civil:'S'}));
  assert.equal(submits.length,1);assert.equal(r.screen,'STATUS_FINAL');assert.match(r.data.mensagem,/Já me inscrevi: continuar/);
 }finally{globalThis.fetch=previous}
});
