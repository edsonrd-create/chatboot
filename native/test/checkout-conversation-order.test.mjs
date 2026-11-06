import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {newSession,addPizza,setFulfillment,confirmCustomerName,setPayment,beginNewOrder} from '../src/core.mjs';
import {checkoutNextQuestion,wantsToFinishOrder} from '../src/checkout-flow.mjs';
import {intelligentReply} from '../src/ai.mjs';
const base=JSON.parse(fs.readFileSync(new URL('../config/business.json',import.meta.url),'utf8'));
function fixture(){
  const business=structuredClone(base);
  business.pizzas.calabresa.grande=5999;
  const session=newSession();
  session.customerPhone='5541999990000';
  addPizza(session,business,{size:'grande',flavors:['calabresa']});
  return {business,session};
}
test('finalizar reconhece expressões reais do WhatsApp e não confunde adições',()=>{
  for(const term of ['só isso','pode fechar','finalizar pedido','não quero mais nada','pode mandar o resumo'])
    assert.equal(wantsToFinishOrder(term),true,term);
  assert.equal(wantsToFinishOrder('quero pizza grande calabresa'),false);
});
test('carrinho ainda em montagem não pergunta pagamento ao cliente',async()=>{
  const {business,session}=fixture();
  const out=await intelligentReply('Oi',session,business);
  assert.doesNotMatch(out,/como prefere pagar|PIX, cartão ou dinheiro/i);
  assert.equal(session.checkoutRequested,false);
});
test('finalização pergunta nome primeiro e entrega/retirada antes do pagamento',async()=>{
  const {business,session}=fixture();
  const start=await intelligentReply('pode fechar',session,business);
  assert.match(start,/nome/i);
  assert.doesNotMatch(start,/PIX|cartão|dinheiro/i);
  assert.equal(session.checkoutRequested,true);
  const name=await intelligentReply('Ana Silva',session,business);
  assert.match(name,/entrega|retirar|receber/i);
  assert.doesNotMatch(name,/PIX|cartão|dinheiro/i);
  setFulfillment(session,{method:'DELIVERY'});
  const address=checkoutNextQuestion(session,business);
  assert.match(address,/rua, número e bairro/i);
  assert.doesNotMatch(address,/PIX|cartão|dinheiro/i);
  session.address='Rua das Flores, 100, Centro, Colombo';
  session.deliveryFeeCents=650;
  const payment=checkoutNextQuestion(session,business);
  assert.match(payment,/PIX, cartão ou dinheiro/i);
  setPayment(session,{method:'PIX'});
  assert.equal(checkoutNextQuestion(session,business),null);
});
test('retirada pula endereço e pergunta pagamento no fim',()=>{
  const {business,session}=fixture();
  session.checkoutRequested=true;
  confirmCustomerName(session,{name:'Ana Silva'});
  setFulfillment(session,{method:'PICKUP'});
  assert.match(checkoutNextQuestion(session,business),/PIX, cartão ou dinheiro/i);
});
test('novo pedido limpa a etapa de checkout anterior',()=>{
  const {session}=fixture();
  session.checkoutRequested=true;
  session.fulfillmentChosen=true;
  beginNewOrder(session);
  assert.equal(session.checkoutRequested,false);
  assert.equal(session.fulfillmentChosen,false);
  assert.equal(session.cart.length,0);
});
