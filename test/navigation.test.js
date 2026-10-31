import {test} from 'node:test';
import assert from 'node:assert/strict';
import {responseForScreen} from '../api/flow.js';
process.env.FLOW_PRIVATE_KEY='unit-navigation-key';
test('orientação não herda o botão de concluir inscrição',()=>{
 const result=responseForScreen('TELA_ORIENTACAO_PROVA',{acao_rodape:'enviar_informacoes_complementares',rotulo_rodape:'Concluir inscrição',processando:false});
 assert.equal(result.data.acao_rodape,'iniciar_redacao');assert.equal(result.data.rotulo_rodape,'Iniciar redação');
});
test('editor não herda o botão de iniciar redação',()=>{
 const result=responseForScreen('TELA_REDACAO',{acao_rodape:'iniciar_redacao',rotulo_rodape:'Iniciar redação',processando:false});
 assert.equal(result.data.acao_rodape,'enviar_redacao');assert.equal(result.data.rotulo_rodape,'Enviar redação');
});
test('enquanto processa, mantém consulta sem reenvio',()=>{
 const result=responseForScreen('TELA_ORIENTACAO_PROVA',{acao_rodape:'iniciar_redacao',job_id:'unit',processando:true});
 assert.equal(result.data.acao_rodape,'consultar_tarefa');assert.equal(result.data.rotulo_rodape,'Verificar andamento');assert.equal(result.data.editavel,false);
});
