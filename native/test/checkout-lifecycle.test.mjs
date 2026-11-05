import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {catalogFromPdvMenu} from '../src/pdv-catalog.mjs';
import {newSession,addPizza,confirmCustomerName,setFulfillment,setPayment,requestConfirmation,confirmRequest,getSummary,beginNewOrder} from '../src/core.mjs';
import {intelligentReply} from '../src/ai.mjs';
import {confirmationReply} from '../src/pdv-order.mjs';
const base=JSON.parse(fs.readFileSync(new URL('../config/business.json',import.meta.url),'utf8'));
const b=catalogFromPdvMenu({ok:true,items:[{id:17,kind:'pizza',name:'Calabresa',sizes:[{label:'Grande',priceCents:5999,maxFlavors:2}]}]},base);
function prepared(){
 const s=newSession();s.customerPhone='5541999990000';
 addPizza(s,b,{size:'grande',flavors:['calabresa']});
 setFulfillment(s,{method:'PICKUP'});
 return s;
}
function confirmed(){
 const s=prepared();confirmCustomerName(s,{name:'Ana Silva'});setPayment(s,{method:'PIX'});
 const q=requestConfirmation(s,b);assert.equal(q.ok,true);
 s.quotePresented=true;
 const x=confirmRequest(s,b,{explicitConfirmation:true});assert.equal(x.ok,true);
 s.lastConfirmed=x;return s;
}
test('nome não aceita comando, PIX nem resposta de confirmação',()=>{
 const s=prepared();
 for(const name of ['me manda pix','Confirmo','Pix','Quero pizza','11999990000']){
  assert.equal(confirmCustomerName(s,{name}).ok,false);
 }
 assert.equal(confirmCustomerName(s,{name:'Ana Silva'}).ok,true);
});
test('bot exige nome e pagamento em CADA novo pedido',async()=>{
 const s=prepared();
 const ask=await intelligentReply('quero confirmar',s,b);
 assert.match(ask,/nome/i);
 assert.equal(s.awaitingCustomerName,true);
 const answer=await intelligentReply('Ana Silva',s,b);
 assert.match(answer,/PIX/);
 const summary=await intelligentReply('PIX',s,b);
 assert.match(summary,/Confira os dados/i);
 assert.match(summary,/Pagamento: PIX/i);
 assert.match(summary,/Nome: Ana Silva/i);
});
test('pedir PIX com orçamento apresentado não envia nada ao PDV nem refaz o carrinho',async()=>{
 const s=confirmed();let calls=0;
 b.submitOrder=async()=>{calls++;return {ok:true}};
 const count=s.cart.length;
 const answer=await intelligentReply('me manda o pix',s,b);
 assert.match(answer,/Confirmo/);
 assert.equal(s.cart.length,count);
 assert.equal(calls,0);
});
test('modo teste encerra carrinho mas não registra venda',async()=>{
 const s=confirmed();b.pdvMode=async()=> 'test';
 b.submitOrder=async()=>({ok:true,dryRun:true,mode:'test'});
 const original=s.lastConfirmed.requestId;
 const text=await confirmationReply(s,b,s.lastConfirmed,'fallback');
 assert.match(text,/homologação/i);
 assert.equal(s.cart.length,0);
 assert.equal(s.payment,null);
 assert.equal(s.customerNameConfirmed,false);
 assert.equal(s.lastDryRunRequestId,original);
 assert.notEqual(s.lastCompletedRequestId,original);
});
test('venda confirmada pelo PDV encerra carrinho; segunda compra começa sem itens antigos',async()=>{
 const s=confirmed();
 b.pdvMode=async()=> 'active';
 b.submitOrder=async()=>({ok:true,number:345,totalCents:5999,paymentStatus:'pending',pixCopiaECola:'PIX-TESTE'});
 const answer=await intelligentReply('Confirmo',s,b);
 assert.match(answer,/Pedido nº 345 registrado/);
 assert.match(answer,/PIX-TESTE/);
 assert.equal(s.cart.length,0);
 assert.equal(s.payment,null);
 assert.equal(s.customerNameConfirmed,false);
 assert.equal(s.lastCompletedOrderNumber,345);
 assert.equal(s.history.length,0);
 const fresh=await intelligentReply('novo pedido',s,b);
 assert.match(fresh,/pedido novo/i);
 assert.equal(s.cart.length,0);
});
test('falha no PDV mantém pedido para revisão mas não mistura com a compra seguinte',async()=>{
 const s=confirmed();b.pdvMode=async()=> 'off';
 const response=await intelligentReply('Confirmo',s,b);
 assert.match(response,/NÃO foi registrado/i);
 assert.equal(s.mode,'HUMAN');
 assert.equal(s.cart.length,1);
 assert.match((await intelligentReply('me manda pix',s,b)),/não foi registrado/i);
 const start=await intelligentReply('novo pedido',s,b);
 assert.match(start,/Começamos um pedido novo/);
 assert.equal(s.cart.length,0);
 assert.equal(s.payment,null);
 assert.equal(s.manualReviewOrders.length,1);
 assert.equal(s.manualReviewOrders[0].quote.items.length,1);
});
