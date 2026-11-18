import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {intelligentReply} from '../src/ai.mjs';
import {newSession,addPizza} from '../src/core.mjs';
import {catalogFromPdvMenu} from '../src/pdv-catalog.mjs';
const config=JSON.parse(fs.readFileSync(new URL('../config/business.json',import.meta.url),'utf8'));
const business=catalogFromPdvMenu({ok:true,items:[{kind:'pizza',name:'Calabresa',sizes:[{label:'Grande',priceCents:5999,maxFlavors:2}]}]},config);

test('PIX não é enviado sem consentimento e não é marcado como pago',async()=>{
 const session=newSession();
 session.pendingPixOffer={number:17,link:'https://example.com/pix-17',brcode:'000201PIX17'};
 const reply=await intelligentReply('posso ver meu pedido?',session,business,{});
 assert.doesNotMatch(reply,/pix-17|000201PIX17/);
 assert.ok(session.pendingPixOffer);
 const consented=await intelligentReply('sim pode enviar',session,business,{});
 assert.match(consented,/https:\/\/example.com\/pix-17/);
 assert.match(consented,/confirmado pelo PDV/i);
 assert.equal(session.pendingPixOffer,null);
 assert.equal(session.paid,undefined);
});
test('cartão na máquina durante entrega registra modalidade sem exigir pagamento antecipado',async()=>{
 const session=newSession();addPizza(session,business,{size:'grande',flavors:['calabresa']});
 const reply=await intelligentReply('vou pagar na máquina durante a entrega',session,business,{});
 assert.equal(session.payment,'CARTAO');
 assert.equal(session.cardAtDelivery,true);
 assert.match(reply,/sem esperar pagamento antecipado/i);
 assert.equal(session.paid,undefined);
});
