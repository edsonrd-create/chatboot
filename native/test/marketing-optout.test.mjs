import test from 'node:test';
import assert from 'node:assert/strict';
import {isMarketingOptOut,optOutMessage} from '../src/marketing-optout.mjs';

test('SAIR e pedidos claros de descadastro prevalecem sobre a IA',()=>{
 for(const text of ['SAIR','parar','não quero mais promoções','STOP','descadastrar','remover meu número'])
  assert.equal(isMarketingOptOut(text),true,text);
});
test('Não impede pedidos de pizza ou conversas que só citam sair',()=>{
 for(const text of ['quero um combo família','vou sair com a moto','quero promoções','gostaria de sair para retirar'])
  assert.equal(isMarketingOptOut(text),false,text);
});
test('Confirma somente após o PDV atualizar a preferência',()=>{
 assert.match(optOutMessage(true),/não receberá mais promoções/i);
 assert.match(optOutMessage(false),/não consegui confirmar/i);
 assert.doesNotMatch(optOutMessage(false),/✅/);
});
