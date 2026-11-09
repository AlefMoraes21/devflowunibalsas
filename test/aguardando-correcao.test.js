import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createMatricula,summarizeStages} from '../api/matricula.js';

const stage=(title,text,{conclusive=0,cta,link}={})=>({title,feedback:{conclusive,complementary_text:text,cta_text:cta??'null'},cta_link:link});
const prova=stage('Prova online','Aguardando correção',{cta:'Continuar prova',link:'presencial/passo/300664'});
const inscricao=stage('Inscrição','Concluída',{conclusive:1});

function hub(stages,name='ACOMPANHAMENTO'){
 const m=createMatricula({api:async()=>({data:{current_process:{id:20383,stages}}}),getForm:async()=>({}),submitForm:async()=>({}),getDataSource:async()=>({}),render:(screen,data)=>({screen,data})});
 return m.status({token:'t',applyment_id:'1',processo_seletivo_id:'20383'},'',name,{mensagem:'texto antigo'});
}

test('prova entregue e aguardando correção não vira etapa para continuar',()=>{
 const s=summarizeStages([inscricao,prova]);
 assert.equal(s.next,null);assert.equal(s.aguardandoCorrecao,true);assert.match(s.resumo,/⏱ Prova online: Aguardando correção/);
});

test('acompanhamento aguardando correção mostra a mensagem do portal, Portal do Candidato e Encerrar',async()=>{
 const r=await hub([inscricao,prova]);
 assert.equal(r.data.aguardando_resultado,true);
 assert.equal(r.data.titulo,'Aguardando correção ⏱');
 assert.match(r.data.mensagem,/Você realizou a sua prova\. Em breve o resultado estará disponível\./);
 assert.equal(r.data.acao_rodape,'encerrar');assert.equal(r.data.rotulo_rodape,'Encerrar');
 assert.doesNotMatch(r.data.rotulo_rodape,/Continuar/);
});

test('com outra etapa disponível, o botão Continuar continua aparecendo',async()=>{
 const docs=stage('Documentos inscrição','Pendentes',{cta:'Enviar',link:'presencial/passo/300696'});
 const r=await hub([inscricao,prova,docs]);
 assert.equal(r.data.aguardando_resultado,false);assert.equal(r.data.acao_rodape,'continuar_etapa');assert.match(r.data.rotulo_rodape,/Continuar: Documentos/);
});

test('painel de login (PORTAL_STATUS) aguardando correção só oferece atualizar',async()=>{
 const r=await hub([inscricao,prova],'PORTAL_STATUS');
 assert.equal(r.data.acao_rodape,'atualizar_portal');assert.equal(r.data.aguardando_resultado,undefined);
});

test('JSON do Flow: link Portal do Candidato só com resultado aguardando e Encerrar por agora no restante',async()=>{
 const j=JSON.parse(await readFile(new URL('../flow-waba.json',import.meta.url)));
 const s=j.screens.find(x=>x.id==='ACOMPANHAMENTO');
 assert.equal(s.data.aguardando_resultado.type,'boolean');
 const cond=s.layout.children.find(c=>c.type==='If').then.find(c=>c.type==='If');
 assert.equal(cond.condition,'${data.aguardando_resultado} == true');
 assert.equal(cond.then[0].text,'Portal do Candidato');assert.equal(cond.then[0]['on-click-action'].name,'open_url');
 assert.equal(cond.else[0].text,'Encerrar por agora');
});
