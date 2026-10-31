import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {buildCanonicalProof} from '../api/proof-binding.js';
test('contrato do formulário capturado: campos globais vêm de applicantData',async()=>{
 const snapshot=JSON.parse(await readFile(new URL('./fixtures/proof-schema.json',import.meta.url)));
 const prepared=buildCanonicalProof(snapshot,{applyment_id:'unit-application',processo_seletivo_id:'20383'},{button:3940382,label:'Iniciar prova'},'https://avaliacao.apprubeus.com.br/api/avaliacao/linkProva?idExecProva=OLD');
 const url=new URL(prepared.link);assert.equal(url.searchParams.get('idExecProva'),'UNIT-EXEC-CODE');assert.equal(url.searchParams.get('codigoContato'),'unit-candidate');assert.equal(url.searchParams.get('codigoOferta'),'unit-offer');assert.equal(prepared.binding.proofId,'unit-proof');
});
