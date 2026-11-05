import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {newSession,addPizza,setFulfillment,confirmCustomerName,setPayment} from '../src/core.mjs';
import {intelligentReply} from '../src/ai.mjs';
import {wantsToFinishOrder,asksForCurrentPrice} from '../src/checkout-flow.mjs';
const business=JSON.parse(fs.readFileSync(new URL('../config/business.json',import.meta.url),'utf8'));
function session(){
 const s=newSession();s.customerPhone='5541999990000';
 assert.equal(addPizza(s,business,{size:'grande',flavors:['calabresa']}).ok,true);
 return s;
}
test('reconhece frases da captura real do WhatsApp',()=>{
 for(const phrase of ['pode','fechar seu pedido','pode fechar','fechar o pedido','finalizar pedido','quero finalizar','Sim, pode!'])
  assert.equal(wantsToFinishOrder(phrase),true,phrase);
 assert.equal(asksForCurrentPrice('qual valor'),true);
 assert.equal(wantsToFinishOrder('qual valor'),false);
});
test('fechar seu pedido deve avançar e NÃO voltar à pergunta de fechar',async()=>{
 const s=session();confirmCustomerName(s,{name:'Edson'});
 const reply=await intelligentReply('fechar seu pedido',s,business);
 assert.equal(s.checkoutRequested,true);
 assert.match(reply,/receber|retirar|entrega/i);
 assert.doesNotMatch(reply,/quer acrescentar mais alguma coisa ou posso/i);
});
test('pode depois da escolha deve avançar para coleta do nome',async()=>{
 const s=session();const reply=await intelligentReply('pode',s,business);
 assert.equal(s.checkoutRequested,true);
 assert.match(reply,/nome/i);
 assert.doesNotMatch(reply,/quer acrescentar mais alguma coisa ou posso/i);
});
test('qual valor responde total/subtotal e não loopa',async()=>{
 const s=session();setFulfillment(s,{method:'PICKUP'});
 const reply=await intelligentReply('qual valor',s,business);
 assert.match(reply,/Subtotal:/);
 assert.match(reply,/Total:/);
 assert.doesNotMatch(reply,/Que delícia, ótima escolha/i);
});
test('fechar pedido já completo apresenta resumo confirmável',async()=>{
 const s=session();confirmCustomerName(s,{name:'Edson'});setFulfillment(s,{method:'PICKUP'});setPayment(s,{method:'PIX'});
 const reply=await intelligentReply('fechar seu pedido',s,business);
 assert.match(reply,/Confira os dados/);
 assert.match(reply,/Confirmo/);
 assert.equal(s.awaitingConfirmation,true);
});
