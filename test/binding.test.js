import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildCanonicalProof,assertCurrentBinding,portalConfirmsDelivery} from '../api/proof-binding.js';
import {createProofRouter} from '../api/prova-route.js';
import {promptText} from '../api/prompt-text.js';
const application={applyment_id:'unit-app',processo_seletivo_id:93001,token:'unit-token'};
const button={button:1000,label:'Iniciar prova'};
function snapshot(){return {id:33,applicantData:[{field_id:110,value:'STALE'},{field_id:112,value:'unit-key'},{field_id:113,value:'unit-candidate'},{field_id:114,value:'unit-offer'}],content:[{type:'text',field_id:110,label:'IDEXECPROVA',value_now:'CURRENT-CODE'},{type:'text',field_id:111,label:'IDPROVAINSCRITO',value_now:'unit-proof'},{type:'button',id:1000,label:'Iniciar prova',forwardData:[{link:'https://avaliacao.apprubeus.com.br/api/avaliacao/linkProva',parameters:[{name:'chave',field_id:112,parameter_type_id:1},{name:'codigoContato',field_id:113,parameter_type_id:1},{name:'codigoOferta',field_id:114,parameter_type_id:1},{name:'idExecProva',field_id:110,parameter_type_id:1},{name:'origemContato',fixed_value:'121',parameter_type_id:2}]}]}]}}
test('link usa execução atual pós-distribuição, sem reutilizar código antigo',()=>{
 const p=buildCanonicalProof(snapshot(),application,button,'https://avaliacao.apprubeus.com.br/api/avaliacao/linkProva?idExecProva=OLD');
 assert.equal(new URL(p.link).searchParams.get('idExecProva'),'CURRENT-CODE');assert.equal(p.binding.redirectMatched,false);assert.equal(p.binding.proofId,'unit-proof');assert.equal(p.binding.offerCode,'unit-offer');
 assert.ok(!JSON.stringify(p.binding).includes('unit-key'));
});
test('campo atual vazio não reutiliza valor antigo de applicantData',()=>{
 const s=snapshot();s.content[0].value_now=null;assert.throws(()=>buildCanonicalProof(s,application,button,''),/idExecProva/);
 s.content[2].forwardData[0].link+='?idExecProva=STALE';assert.throws(()=>buildCanonicalProof(s,application,button,''),/idExecProva/);
});
test('vínculo alterado bloqueia operação em vez de migrar resposta',()=>{
 const s=snapshot(),p=buildCanonicalProof(s,application,button,'');s.content[0].value_now='OTHER';assert.throws(()=>assertCurrentBinding(s,application,p.binding),/outra execução/);
});
test('prepare valida portal e relê após uma única ação do botão',async()=>{
 let submits=0,reads=0,portals=0;
 const router=createProofRouter({api:async path=>({data:path.startsWith('/stages')?[{id:32,title:'Prova online'}]:[{id:33}]}),getForm:async()=>({data:{form:{content:{buttons:[button],inputs:[{field_id:110,label:'IDEXECPROVA',value:'OLD'}]}}}}),submitForm:async()=>{submits++;return {data:{redirect:{link:'https://avaliacao.apprubeus.com.br/api/avaliacao/linkProva?idExecProva=OLD'}}}},readPortal:async()=>{portals++;return {}},readSnapshot:async()=>{reads++;assert.equal(submits,1);return snapshot()}});
 const result=await router.prepare(application);assert.equal(result.binding.executionCode,'CURRENT-CODE');assert.equal(submits,1);assert.equal(reads,1);assert.equal(portals,1);
});
for(const feedback of ['Prova disponível','Prova já iniciada','Prova não finalizada'])test(`não confirma portal com ${feedback}`,()=>assert.equal(portalConfirmsDelivery({stages:[{feedback}]}),false));
for(const feedback of ['Aguardando correção','Em correção','Prova corrigida'])test(`confirma portal com ${feedback}`,()=>assert.equal(portalConfirmsDelivery({stages:[{feedback}]}),true));
test('enunciado decodifica acentos e preserva parágrafos',()=>assert.equal(promptText('<p>Reda&ccedil;&atilde;o e sa&uacute;de</p><p>&ldquo;Equil&iacute;brio&rdquo; &#233; essencial.</p>'),'Redação e saúde\n\n“Equilíbrio” é essencial.'));
// Produção (13/11/2026): o Rubeus aceita o "Iniciar prova" e só depois gera o IDEXECPROVA.
// A preparação relê o formulário (sem novo envio) até o código aparecer.
test('prepare espera o código da execução aparecer, sem reenviar o Iniciar prova',async()=>{
 let submits=0,reads=0,waits=0;
 const router=createProofRouter({api:async path=>({data:path.startsWith('/stages')?[{id:32,title:'Prova online'}]:[{id:33}]}),getForm:async()=>({data:{form:{content:{buttons:[button],inputs:[{field_id:110,label:'IDEXECPROVA',value:'OLD'}]}}}}),submitForm:async()=>{submits++;return {data:{}}},readPortal:async()=>({}),readSnapshot:async()=>{reads++;const s=snapshot();if(reads<3)s.content[0].value_now=null;return s},sleep:async()=>{waits++},remaining:()=>120000});
 const result=await router.prepare(application);
 assert.equal(result.binding.executionCode,'CURRENT-CODE');assert.equal(submits,1);assert.equal(reads,3);assert.equal(waits,2);
});
test('prepare desiste após o limite de releituras e mantém o erro original',async()=>{
 let submits=0,reads=0;
 const router=createProofRouter({api:async path=>({data:path.startsWith('/stages')?[{id:32,title:'Prova online'}]:[{id:33}]}),getForm:async()=>({data:{form:{content:{buttons:[button],inputs:[{field_id:110,label:'IDEXECPROVA',value:'OLD'}]}}}}),submitForm:async()=>{submits++;return {data:{}}},readPortal:async()=>({}),readSnapshot:async()=>{reads++;const s=snapshot();s.content[0].value_now=null;return s},sleep:async()=>{},remaining:()=>120000,bindingTries:3});
 await assert.rejects(router.prepare(application),/idExecProva/);assert.equal(submits,1);assert.equal(reads,3);
});
