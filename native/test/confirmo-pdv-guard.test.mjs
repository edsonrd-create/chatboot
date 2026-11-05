import test from 'node:test';
import assert from 'node:assert/strict';
import {newSession,requestConfirmation} from '../src/core.mjs';
import {intelligentReply} from '../src/ai.mjs';

function fixture(){
  let submits=0;
  const business={
    sizes:[],flavors:[],pizzas:{},halfHalfPricing:'MAX',
    drinks:[{id:'coke',label:'Coca-Cola 2L',available:true,priceCents:1499}],
    pdvMode:async()=> 'active',
    submitOrder:async()=>{submits++;return {ok:true,number:98765,totalCents:1499,paymentStatus:'pending'};},
    orderStatus:async()=>({ok:true,orders:[]})
  };
  const session={...newSession(),cart:[{id:'line-1',kind:'drink',drinkId:'coke',quantity:1,description:'Coca-Cola 2L'}],
    fulfillment:'PICKUP',fulfillmentChosen:true,payment:'PIX',customerName:'Cliente Teste',
    customerNameConfirmed:true,customerPhone:'5541999990001',confirmationMessageId:'unit-test-confirm-001'};
  return {session,business,count:()=>submits};
}

test('Confirmo sem resumo válido mostra cotação do servidor e não envia venda',async()=>{
  const {session,business,count}=fixture();
  const reply=await intelligentReply('Confirmo',session,business,{apiKey:'fake-never-called'});
  assert.match(reply,/Nenhum pedido foi enviado ainda/);
  assert.match(reply,/Total:/);
  assert.equal(session.awaitingConfirmation,true);
  assert.equal(session.quotePresented,true);
  assert.equal(count(),0);
});

test('Confirmo depois do resumo envia ao PDV exatamente uma vez e retorna número',async()=>{
  const {session,business,count}=fixture();
  const quote=requestConfirmation(session,business);
  assert.equal(quote.ok,true);
  session.quotePresented=true;
  const reply=await intelligentReply('Confirmo',session,business,{apiKey:'fake-never-called'});
  assert.match(reply,/Pedido nº 98765 registrado/);
  assert.equal(count(),1);
  assert.equal(session.pdvOrder.ok,true);
  assert.equal(session.lastCompletedOrderNumber,98765);
  const again=await intelligentReply('Confirmo',session,business,{apiKey:'fake-never-called'});
  assert.match(again,/já foi registrado/);
  assert.equal(count(),1,'não duplicar pedido na repetição da confirmação');
});

test('Confirmo sem carrinho impede IA de dizer que pedido está em preparo',async()=>{
  const session=newSession();
  const reply=await intelligentReply('Confirmo',session,{}, {apiKey:'fake-never-called'});
  assert.match(reply,/não estamos preparando esse pedido/i);
  assert.equal(session.mode,'HUMAN');
});
