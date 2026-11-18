import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {intelligentReply} from '../src/ai.mjs';
import {newSession,addPizza,setFulfillment,setPayment,confirmCustomerName,requestConfirmation} from '../src/core.mjs';
import {catalogFromPdvMenu} from '../src/pdv-catalog.mjs';
const cfg=JSON.parse(fs.readFileSync(new URL('../config/business.json',import.meta.url),'utf8'));
const business=catalogFromPdvMenu({ok:true,items:[
 {kind:'pizza',name:'Calabresa',sizes:[{label:'Grande',priceCents:5999,maxFlavors:2}]},
 {kind:'item',name:'Combo Família',category:'Combos',description:'2 pizzas grandes, 2 sabores cada + 1 refrigerante 2L',priceCents:9999}
]},cfg);
test('Combo Família sem regras estruturadas: nenhum preço avulso, bebida omitida ou pedido no PDV',async()=>{
 const s=newSession();let sent=0;const b={...business,submitOrder:async()=>{sent++;return {ok:true,number:7};}};
 const first=await intelligentReply('Quero um combo família',s,b,{menuFlowEnabled:true,catalogSynced:true});
 assert.match(first,/combo família/i);
 assert.match(first,/bebida inclusa/i);
 assert.match(first,/Não registrei nem cobrei/i);
 assert.equal(s.mode,'HUMAN');assert.deepEqual(s.cart,[]);
 for(const reply of ['calabresa, frango com catupiry, mexicana e strogonoff','Fechar','Confirmo']){
  const out=await intelligentReply(reply,s,b);
  assert.match(out,/conferid/i);
 }
 assert.equal(sent,0);
 assert.deepEqual(s.cart,[]);
 assert.equal(s.lastCompletedOrderNumber,undefined);
 const restart=await intelligentReply('novo pedido',s,b);
 assert.match(restart,/novo pedido/i);assert.equal(s.comboReview,null);
});
test('Compra anterior nº 7 não bloqueia nova confirmação',async()=>{
 const s=newSession();
 s.lastCompletedRequestId='antigo';s.lastCompletedOrderNumber=7;s.pdvOrder={ok:true,number:7,at:new Date().toISOString()};
 s.customerPhone='41999999999';addPizza(s,business,{size:'grande',flavors:['calabresa']});
 confirmCustomerName(s,{name:'Edson'});setFulfillment(s,{method:'PICKUP'});setPayment(s,{method:'PIX'});
 const q=requestConfirmation(s,business);assert.equal(q.ok,true);s.quotePresented=true;
 let sent=0;const b={...business,pdvMode:async()=> 'active',submitOrder:async()=>{sent++;return {ok:true,number:812,totalCents:5999,pixCopiaECola:'PIXTEST812'};}};
 const reply=await intelligentReply('Confirmo',s,b);
 assert.match(reply,/812/);assert.doesNotMatch(reply,/nº 7/);assert.equal(sent,1);
 assert.equal(s.lastCompletedOrderNumber,812);
});
test('Status entregue em pedido antigo nunca é apresentado como entrega comprovada',async()=>{
 const s=newSession();s.orderRefs=['gutobot:antigo'];
 let calls=0;
 const b={...business,orderStatus:async ids=>{calls++;return {ok:true,orders:[{externalId:ids[0],status:'delivered',statusLabel:'Entregue',number:7,createdAt:new Date(Date.now()-86400000).toISOString()}]}}};
 const r=await intelligentReply('Quanto tempo para entrega?',s,b);
 assert.match(r,/pedido anterior/i);assert.doesNotMatch(r,/j[aá] (?:foi |consta como )?entregue/i);assert.equal(s.mode,'HUMAN');assert.equal(calls,1);
});
test('Cliente contesta entrega: transferência sem atribuir conclusão ao entregador',async()=>{
 const s=newSession();s.orderRefs=['gutobot:123456'];
 const r=await intelligentReply('Não chegou meu pedido',s,business);
 assert.equal(s.mode,'HUMAN');assert.match(r,/não tenho confirmação segura/i);
});
