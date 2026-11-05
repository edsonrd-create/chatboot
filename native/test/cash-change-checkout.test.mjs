import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {newSession,addPizza,setFulfillment,setPayment,confirmCustomerName,getSummary,requestConfirmation,beginNewOrder} from '../src/core.mjs';
import {parseCashAmount,setCashChange} from '../src/cash-change.mjs';
import {intelligentReply} from '../src/ai.mjs';
import {buildPdvOrder,pdvOrderMessage} from '../src/pdv-order.mjs';

const base=JSON.parse(fs.readFileSync(new URL('../config/business.json',import.meta.url),'utf8'));
function sample(){
  const business=structuredClone(base);
  business.pizzas.calabresa.grande=5999;
  const session=newSession();
  session.customerPhone='5541999990000';
  addPizza(session,business,{size:'grande',flavors:['calabresa']});
  setFulfillment(session,{method:'PICKUP'});
  confirmCustomerName(session,{name:'Ana Silva'});
  session.checkoutRequested=true;
  return {business,session};
}
test('converte valores brasileiros com precisão em centavos',()=>{
  assert.equal(parseCashAmount('R$ 100,00'),10000);
  assert.equal(parseCashAmount('100'),10000);
  assert.equal(parseCashAmount('troco para 100'),10000);
  assert.equal(parseCashAmount('1.000,50'),100050);
  assert.equal(parseCashAmount('100.50'),10050);
  assert.equal(parseCashAmount('sim'),null);
  assert.equal(parseCashAmount('1,001'),null);
  assert.equal(parseCashAmount('0'),null);
});
test('após escolher dinheiro pergunta troco e só confirma depois da resposta',async()=>{
  const {business,session}=sample();
  const money=await intelligentReply('dinheiro',session,business);
  assert.match(money,/troco/i);
  assert.equal(session.payment,'DINHEIRO');
  assert.equal(requestConfirmation(session,business).ok,false);
  const yes=await intelligentReply('sim',session,business);
  assert.match(yes,/troco para quanto/i);
  const quote=await intelligentReply('R$ 100,00',session,business);
  assert.match(quote,/Subtotal: R\$\s*59,99/);
  assert.match(quote,/Total: R\$\s*59,99/);
  assert.match(quote,/Troco para: R\$\s*100,00/);
  assert.match(quote,/Troco previsto: R\$\s*40,01/);
  assert.match(quote,/Confirmo/);
  assert.equal(session.quotePresented,true);
  assert.deepEqual(getSummary(session,business).missing,[]);
});
test('se não precisa de troco confirma e não pergunta para quanto',async()=>{
 const {business,session}=sample();
 setPayment(session,{method:'DINHEIRO'});
 const quote=await intelligentReply('não',session,business);
 assert.match(quote,/Troco: não precisa/);
 assert.doesNotMatch(quote,/Troco para:/);
 assert.match(quote,/Confirmo/);
});
test('valor insuficiente não finaliza nem gera valor negativo',async()=>{
 const {business,session}=sample();
 setPayment(session,{method:'DINHEIRO'});
 const r=await intelligentReply('troco para 40',session,business);
 assert.match(r,/menor que o total/i);
 assert.equal(requestConfirmation(session,business).ok,false);
 const q=getSummary(session,business);
 assert.equal(q.cashChangeCents,null);
 assert.ok(q.missing.includes('informar troco'));
});
test('mudança de preço/taxa recalcula troco e bloqueia valor insuficiente',()=>{
 const {business,session}=sample();
 setPayment(session,{method:'DINHEIRO'});
 assert.equal(setCashChange(session,true,7000,business).ok,true);
 assert.equal(getSummary(session,business).cashChangeCents,1001);
 business.pizzas.calabresa.grande=7500;
 const changed=getSummary(session,business);
 assert.ok(changed.missing.includes('valor do troco válido'));
 assert.equal(requestConfirmation(session,business).ok,false);
});
test('dinheiro com troco segue ao PDV em observações e retorna cálculo pelo valor do PDV',()=>{
 const {business,session}=sample();
 setPayment(session,{method:'DINHEIRO'});
 setCashChange(session,true,10000,business);
 const quote=getSummary(session,business);
 const order=buildPdvOrder(session,business,quote,'1234-abc');
 assert.match(order.notes,/Troco para R\$\s*100,00/);
 assert.equal(order.paymentMethod,'cash');
 const message=pdvOrderMessage({ok:true,number:77,totalCents:6500},quote);
 assert.match(message,/Troco calculado pelo total do PDV: R\$\s*35,00/);
 assert.doesNotMatch(message,/40,01/);
});
test('PIX, cartão e novo pedido não herdam troco',()=>{
 const {business,session}=sample();
 setPayment(session,{method:'DINHEIRO'});
 setCashChange(session,true,10000,business);
 setPayment(session,{method:'PIX'});
 assert.equal(session.cashChangeNeeded,null);
 assert.equal(session.cashReceivedCents,null);
 assert.ok(!getSummary(session,business).missing.includes('informar troco'));
 beginNewOrder(session);
 assert.equal(session.cashChangeNeeded,null);
 assert.equal(session.cashReceivedCents,null);
 assert.equal(session.cart.length,0);
});
