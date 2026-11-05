import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  newSession,addPizza,setAddress,setFulfillment,setPayment,
  confirmCustomerName,getSummary,beginNewOrder
} from '../src/core.mjs';
import {intelligentReply} from '../src/ai.mjs';
import {buildPdvOrder,confirmationReply} from '../src/pdv-order.mjs';

const source=JSON.parse(fs.readFileSync(new URL('../config/business.json',import.meta.url),'utf8'));
function setup(){
  const b=structuredClone(source);
  b.pizzas.calabresa.grande=5999;
  const s=newSession();
  s.customerPhone='5541999990000';
  const pizza=addPizza(s,b,{size:'grande',flavors:['calabresa'],quantity:2});
  assert.equal(pizza.ok,true);
  return {b,s};
}
test('JORNADA REALISTA WhatsApp: duas pizzas, nome, entrega, taxa, dinheiro, troco, confirmação e PDV em modo test',async()=>{
  const {b,s}=setup();
  const steps=[];
  const say=async input=>{const output=await intelligentReply(input,s,b);steps.push({input,output});return output;};
  let reply=await say('Oi! Já escolhi duas grandes de calabresa');
  assert.doesNotMatch(reply,/pix, cartão ou dinheiro|como prefere pagar/i);
  reply=await say('pode fechar');
  assert.match(reply,/nome/i);
  assert.doesNotMatch(reply,/pix|cartão|dinheiro/i);
  reply=await say('Ana Silva');
  assert.match(reply,/receber|retirar|entrega/i);
  setFulfillment(s,{method:'DELIVERY'});
  reply=await say('preciso de entrega');
  assert.match(reply,/rua|bairro|endereço/i);
  assert.equal(setAddress(s,{address:'Rua das Flores, 100, Centro, Colombo'}).ok,true);
  s.neighborhood='Centro';
  s.deliveryFeeCents=650;
  reply=await say('endereço informado');
  assert.match(reply,/PIX, cartão ou dinheiro/i);
  assert.equal(getSummary(s,b).subtotalCents,11998);
  assert.equal(getSummary(s,b).totalCents,12648);
  reply=await say('dinheiro');
  assert.match(reply,/troco/i);
  reply=await say('sim');
  assert.match(reply,/troco para quanto/i);
  reply=await say('R$ 200,00');
  assert.match(reply,/Total: R\$\s*126,48/);
  assert.match(reply,/Troco previsto: R\$\s*73,52/);
  assert.match(reply,/Confirmo/);
  assert.equal(s.quotePresented,true);
  b.pdvMode=async()=> 'test';
  let submitted=0;
  b.submitOrder=async payload=>{
    submitted++;
    assert.equal(payload.paymentMethod,'cash');
    assert.equal(payload.items[0].qty,2);
    assert.match(payload.notes,/Troco para R\$\s*200,00/);
    return {ok:true,dryRun:true,mode:'test'};
  };
  reply=await say('Confirmo');
  assert.match(reply,/homologação|teste|conferência/i);
  assert.equal(submitted,1);
  assert.equal(s.lastCompletedOrderNumber,undefined);
  assert.equal(s.cart.length,1);
  assert.equal(s.cart[0].quantity,2);
  reply=await say('novo pedido');
  assert.match(reply,/pedido novo/i);
  assert.equal(s.cart.length,0);
  assert.equal(s.cashReceivedCents,null);
  assert.equal(s.cashChangeNeeded,null);
  assert.equal(s.payment,null);
  assert.equal(s.customerNameConfirmed,false);
  assert.equal(submitted,1);
});
test('JORNADA: PIX/retirada não pergunta troco e não reutiliza itens antigos',async()=>{
 const {b,s}=setup();
 assert.match(await intelligentReply('pode fechar',s,b),/nome/i);
 assert.match(await intelligentReply('Ana Silva',s,b),/entrega|retirar|receber/i);
 setFulfillment(s,{method:'PICKUP'});
 assert.match(await intelligentReply('vou retirar',s,b),/PIX, cartão ou dinheiro/);
 const payment=await intelligentReply('PIX',s,b);
 assert.doesNotMatch(payment,/troco/i);
 assert.equal(s.payment,'PIX');
 assert.equal(getSummary(s,b).totalCents,11998);
 assert.equal(getSummary(s,b).cashChangeCents,null);
});
