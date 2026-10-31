import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validationSummary} from '../api/diagnostics.js';
test('detalhes de validação preservam a regra e retiram valores enviados',()=>{
 const body={token:'token-example-private',data:[{field_id:1,value:'Pessoa Teste'},{field_id:2,value:'52998224725'},{field_id:3,value:'pessoa@example.com'}]};
 const result=validationSummary({errors:{nome:['Campo obrigatório para Pessoa Teste'],cpf:['CPF 52998224725 inválido'],email:['pessoa@example.com inválido'],session:['token-example-private']}},body);
 assert.match(result,/obrigatório/);for(const v of ['Pessoa Teste','52998224725','pessoa@example.com','token-example-private'])assert.ok(!result.includes(v));
});
test('detalhes de validação não incluem a resposta inteira',()=>{
 const result=validationSummary({success:false,message:'Campo obrigatório',data:{token:'private'}},{});assert.equal(result,'Campo obrigatório');assert.ok(!result.includes('private'));
});
