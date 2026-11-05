import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {newSession,addPizza,confirmCustomerName,setFulfillment,setPayment,requestConfirmation,confirmRequest} from '../src/core.mjs';
import {confirmationReply} from '../src/pdv-order.mjs';
import {reconcilePdvOrder} from '../src/pdv-reconcile.mjs';

const business=JSON.parse(fs.readFileSync(new URL('../config/business.json',import.meta.url),'utf8'));
function ready(){
 const s=newSession();
 s.customerPhone='5541999990000';
 assert.equal(addPizza(s,business,{size:'grande',flavors:['calabresa']}).ok,true);
 assert.equal(confirmCustomerName(s,{name:'Ana Silva'}).ok,true);
 assert.equal(setFulfillment(s,{method:'PICKUP'}).ok,true);
 assert.equal(setPayment(s,{method:'PIX'}).ok,true);
 const quote=requestConfirmation(s,business);assert.equal(quote.ok,true);
 s.quotePresented=true;
 const confirmed=confirmRequest(s,business,{explicitConfirmation:true});
 assert.equal(confirmed.ok,true);s.lastConfirmed=confirmed;
 return s;
}
test('recupera registro real pelo identificador externo, sem envio duplicado',async()=>{
 const s=ready(),externalId='gutobot:'+s.lastConfirmed.requestId;
 let sendCount=0,readCount=0;
 const b={...business,pdvMode:async()=> 'active',
   submitOrder:async()=>{sendCount++;throw Error('network timeout');},
   orderStatus:async ids=>{readCount++;assert.deepEqual(ids,[externalId]);return {
     ok:true,orders:[{externalId,number:845, status:'new',totalCents:5999,paymentStatus:'pending'}]};}};
 const reply=await confirmationReply(s,b,s.lastConfirmed,'fallback');
 assert.match(reply,/Pedido nº 845 registrado/);
 assert.equal(sendCount,1);assert.equal(readCount,1);
 assert.equal(s.cart.length,0);
 assert.equal(s.lastCompletedOrderNumber,845);
 assert.equal(s.pdvOrder.ok,true);
 assert.equal(s.orderRefs.includes(externalId),true);
});
test('sem comprovante de gravação, conserva carrinho e não declara sucesso',async()=>{
 const s=ready();const b={...business,pdvMode:async()=> 'active',
  submitOrder:async()=>({ok:false,status:409,error:'PDV_REJECTED'}),
  orderStatus:async()=>({ok:true,orders:[]})};
 const reply=await confirmationReply(s,b,s.lastConfirmed,'fallback');
 assert.match(reply,/não consegui confirmar/i);
 assert.doesNotMatch(reply,/Pedido nº \d+ registrado/i);
 assert.equal(s.cart.length,1);
 assert.equal(s.mode,'HUMAN');
});
test('resposta 201 com número real encerra o carrinho, mesmo sem leitura extra',async()=>{
 const s=ready();let calls=0;const b={...business,pdvMode:async()=> 'active',
  submitOrder:async()=>{calls++;return {ok:true,registered:true,orderId:45,number:902,status:'new',totalCents:5999,paymentStatus:'pending'};}};
 const reply=await confirmationReply(s,b,s.lastConfirmed,'fallback');
 assert.match(reply,/Pedido nº 902 registrado/);
 assert.equal(calls,1);assert.equal(s.cart.length,0);
 assert.equal(s.lastCompletedOrderNumber,902);
});
test('status não usa nome do cliente nem telefone para buscar pedido',async()=>{
 const found=await reconcilePdvOrder('gutobot:abc12345',async ids=>{
  assert.deepEqual(ids,['gutobot:abc12345']);
  return {ok:true,orders:[{externalId:'gutobot:abc12345',number:702,status:'new',totalCents:4000}]};
 });
 assert.equal(found.registered,true);
 assert.equal(found.number,702);
});
