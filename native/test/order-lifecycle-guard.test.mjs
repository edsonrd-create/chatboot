import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {newSession,addPizza,setFulfillment,setPayment,confirmCustomerName,getSummary,requestConfirmation,confirmRequest} from '../src/core.mjs';
import {confirmationReply} from '../src/pdv-order.mjs';
const base=JSON.parse(fs.readFileSync(new URL('../config/business.json',import.meta.url),'utf8'));
function fixture(){
 const business=structuredClone(base);
 business.pizzas.calabresa.grande=5999;
 const s=newSession();s.customerPhone='5541999990000';
 addPizza(s,business,{size:'grande',flavors:['calabresa']});
 setFulfillment(s,{method:'PICKUP'});
 return {business,s};
}
function confirm(s,business){
 const q=requestConfirmation(s,business);assert.equal(q.ok,true);
 s.quotePresented=true;
 const out=confirmRequest(s,business,{explicitConfirmation:true});
 assert.equal(out.ok,true);s.lastConfirmed=out;
 return out;
}
test('nome e forma de pagamento são exigidos em cada pedido',()=>{
 const {business,s}=fixture();
 assert.ok(getSummary(s,business).missing.includes('nome do cliente'));
 assert.ok(getSummary(s,business).missing.includes('pagamento'));
 setPayment(s,{method:'PIX'});
 assert.equal(requestConfirmation(s,business).ok,false);
 assert.equal(confirmCustomerName(s,{name:'Ana Silva'}).ok,true);
 assert.equal(getSummary(s,business).missing.length,0);
 assert.equal(requestConfirmation(s,business).ok,true);
});
test('registro efetivo do PDV limpa carrinho e permite um NOVO pedido sem herdar pagamento',async()=>{
 const {business,s}=fixture();
 confirmCustomerName(s,{name:'Ana Silva'});setPayment(s,{method:'PIX'});
 const out=confirm(s,business);let submissions=0;
 business.submitOrder=async()=>{submissions++;return {ok:true,number:451,totalCents:5999,paymentStatus:'pending'};};
 const message=await confirmationReply(s,business,out,'fallback');
 assert.match(message,/nº 451/);
 assert.equal(s.cart.length,0);
 assert.equal(s.payment,null);
 assert.equal(s.customerNameConfirmed,false);
 assert.equal(s.awaitingConfirmation,false);
 assert.equal(s.lastCompletedRequestId,out.requestId);
 await confirmationReply(s,business,out,'fallback');
 assert.equal(submissions,1,'mesmo ID nunca deve criar outra venda');
 addPizza(s,business,{size:'grande',flavors:['calabresa']});
 assert.ok(getSummary(s,business).missing.includes('nome do cliente'));
 assert.ok(getSummary(s,business).missing.includes('pagamento'));
});
test('modo teste do PDV não grava e não apaga carrinho nem finge registro',async()=>{
 const {business,s}=fixture();confirmCustomerName(s,{name:'Ana Silva'});setPayment(s,{method:'PIX'});
 const out=confirm(s,business);
 business.submitOrder=async()=>({ok:true,dryRun:true,mode:'test'});
 const text=await confirmationReply(s,business,out,'fallback');
 assert.match(text,/homologação/);
 assert.doesNotMatch(text,/Pedido nº .* registrado/);
 assert.equal(s.cart.length,1);assert.equal(s.lastCompletedRequestId,undefined);
});
test('PDV indisponível não perde os itens e exige atendente',async()=>{
 const {business,s}=fixture();confirmCustomerName(s,{name:'Ana Silva'});setPayment(s,{method:'CARTAO'});
 const out=confirm(s,business);
 business.submitOrder=async()=>{throw Error('ECONNREFUSED');};
 const response=await confirmationReply(s,business,out,'fallback');
 assert.match(response,/atendente/);assert.equal(s.mode,'HUMAN');
 assert.equal(s.cart.length,1);assert.equal(s.lastCompletedRequestId,undefined);
});
