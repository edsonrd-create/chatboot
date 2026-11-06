import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';
import {parseWaMessage} from '../src/wa-qr.mjs';
import {phoneFromWaKey,parseCustomerPhoneAnswer} from '../src/customer-phone.mjs';
import {newSession,getSummary} from '../src/core.mjs';
import {checkoutNextQuestion} from '../src/checkout-flow.mjs';
import {intelligentReply} from '../src/ai.mjs';

const LID='144126284705982@lid';
test('LID sem PN não é telefone do comprador',()=>{
 assert.equal(phoneFromWaKey({remoteJid:LID}),'');
 const parsed=parseWaMessage({key:{remoteJid:LID,id:'lid1'},message:{conversation:'Oi'}});
 assert.equal(parsed.from,'144126284705982');
 assert.equal(parsed.phoneNumber,'');
 assert.equal(parsed.jid,LID,'mantém identificador para responder no WhatsApp');
});
test('PN verificado no JID alternativo resolve LID sem truncar identificador',()=>{
 const parsed=parseWaMessage({key:{remoteJid:LID,remoteJidAlt:'5541987654321@s.whatsapp.net',id:'lid2'},message:{conversation:'Oi'}});
 assert.equal(parsed.phoneNumber,'5541987654321');
 assert.equal(parsed.jid,LID);
});
test('Apenas resposta explícita com telefone é aceita',()=>{
 assert.equal(parseCustomerPhoneAnswer('41 98765-4321'),'41987654321');
 assert.equal(parseCustomerPhoneAnswer('Preço R$ 64,99'),'');
 assert.equal(parseCustomerPhoneAnswer('144126284705982'),'');
});
function fixture(phone=''){
 let calls=0;
 const business={
  sizes:[],flavors:[],pizzas:{},halfHalfPricing:'MAX',
  drinks:[{id:'coke',label:'Coca-Cola 2L',available:true,priceCents:1499}],
  pdvMode:async()=> 'active',
  submitOrder:async body=>{calls++;assert.equal(body.customerPhone,'41987654321');return {ok:true,number:98765,totalCents:1499,paymentStatus:'pending'};},
  orderStatus:async()=>({ok:true,orders:[]})
 };
 const session={...newSession(),requireValidatedPhone:true,checkoutRequested:true,customerPhone:phone,
  cart:[{id:'drink1',kind:'drink',drinkId:'coke',quantity:1,description:'Coca-Cola 2L'}],
  fulfillment:'PICKUP',fulfillmentChosen:true,payment:'PIX',customerName:'Comprador de Teste',
  customerNameConfirmed:true,confirmationMessageId:'unique-qr-test'};
 return {business,session,calls:()=>calls};
}
test('Checkout LID exige telefone com DDD, então confirma e grava uma única vez',async()=>{
 const {business,session,calls}=fixture('');
 assert.ok(getSummary(session,business).missing.includes('telefone para contato'));
 const first=await intelligentReply('pode fechar',session,business,{apiKey:'unused'});
 assert.match(first,/telefone para contato/i);
 assert.equal(calls(),0);
 const invalid=await intelligentReply('144126284705982',session,business,{apiKey:'unused'});
 assert.match(invalid,/telefone com DDD/i);
 assert.equal(calls(),0);
 const quote=await intelligentReply('41 98765-4321',session,business,{apiKey:'unused'});
 assert.match(quote,/responda \*Confirmo\*/i);
 assert.equal(session.awaitingConfirmation,true);
 assert.equal(session.quotePresented,true);
 assert.equal(calls(),0);
 const saved=await intelligentReply('Confirmo',session,business,{apiKey:'unused'});
 assert.match(saved,/Pedido nº 98765 registrado/);
 assert.equal(calls(),1);
 await intelligentReply('Confirmo',session,business,{apiKey:'unused'});
 assert.equal(calls(),1);
});
test('Pedido antigo rejeitado localmente por LID recupera carrinho sem envio duplicado',async()=>{
 const {business,session,calls}=fixture('144126284705982');
 session.pdvOrder={ok:false,error:'ORDER_PAYLOAD_INVALID'};
 session.lastConfirmed={requestId:'old-unsubmitted'};
 session.confirmedRequestId='old-unsubmitted';
 const ask=await intelligentReply('Confirmo',session,business,{apiKey:'unused'});
 assert.match(ask,/telefone com DDD/i);
 assert.equal(calls(),0);
 const quote=await intelligentReply('41987654321',session,business,{apiKey:'unused'});
 assert.match(quote,/Confira novamente/i);
 assert.equal(session.lastConfirmed,null);
 const sent=await intelligentReply('Confirmo',session,business,{apiKey:'unused'});
 assert.match(sent,/Pedido nº 98765 registrado/);
 assert.equal(calls(),1);
});

test('Número PN acompanha tarefa persistida e tarefa retomada após reinício',()=>{
 const source=readFileSync(join(dirname(fileURLToPath(import.meta.url)),'../src/server.mjs'),'utf8');
 assert.match(source,/phoneNumber:validCustomerPhone\(m\.phoneNumber\)\?m\.phoneNumber:''/);
 assert.match(source,/phoneNumber:j\.phoneNumber\|\|t\.customerPhone\|\|''/);
 assert.match(source,/authenticatedPhone=String\(m\.phoneNumber\|\|store\.peek\(\)\.threads\?\.\[tid\]\?\.customerPhone\|\|''\)/);
});
test('Cadastro local reutiliza nome informado pelo cliente sem exigir endereço para retirada',()=>{
 const source=readFileSync(join(dirname(fileURLToPath(import.meta.url)),'../src/server.mjs'),'utf8');
 assert.match(source,/validCustomerPhone\(session\.customerPhone\)&&session\.customerNameConfirmed/);
 assert.match(source,/session\.address&&session\.addressCheck\?/);
});
