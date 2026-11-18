import test from 'node:test';
import assert from 'node:assert/strict';
import {handlePaymentMessage,paymentIntent} from '../src/payment-flow.mjs';

test('PIX exige autorização do cliente antes do link',()=>{
 const session={payment:null};
 const first=handlePaymentMessage('vou pagar no pix',session);
 assert.equal(first.kind,'PIX_CONSENT');
 assert.equal(session.pixLinkConsent,undefined);
 assert.equal(session.awaitingPixLinkConsent,true);
 const second=handlePaymentMessage('sim pode enviar',session);
 assert.equal(second.kind,'PIX_LINK_REQUEST');
 assert.equal(session.pixLinkConsent,true);
 assert.equal(session.awaitingPixLinkConsent,false);
 assert.match(second.text,/equipe/i);
});
test('maquininha na entrega não vira PIX nem marca como pago',()=>{
 const session={};
 const flow=handlePaymentMessage('vou pagar na máquina durante a entrega',session);
 assert.equal(flow.kind,'CARD_ON_DELIVERY');
 assert.equal(session.payment,'CARTAO');
 assert.equal(session.paymentTiming,'ON_DELIVERY');
 assert.equal(session.paid,undefined);
 assert.equal(paymentIntent('crédito'),'CARD');
});
test('pedido via cartão não presume modalidades liberadas no PDV',()=>{
 const session={};
 assert.equal(handlePaymentMessage('quero cartão',session).kind,'CARD_CHOICE');
 assert.match(handlePaymentMessage('pix',session).text,/posso enviar/i);
 assert.equal(handlePaymentMessage('não',session).kind,'PIX_DECLINED');
});
