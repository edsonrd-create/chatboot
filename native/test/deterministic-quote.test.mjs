import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {catalogFromPdvMenu} from '../src/pdv-catalog.mjs';
import {newSession,addPizza,setFulfillment,setPayment} from '../src/core.mjs';
import {intelligentReply,whatsappText} from '../src/ai.mjs';
const base=JSON.parse(fs.readFileSync(new URL('../config/business.json',import.meta.url),'utf8'));
const b=catalogFromPdvMenu({ok:true,items:[{kind:'pizza',name:'Baiana',sizes:[{label:'Grande',priceCents:5999,maxFlavors:3}]}]},base);

test('carrinho completo → resumo oficial; Confirmo → envia ao PDV', async ()=>{
  const s=newSession();s.customerPhone='41999990000';s.customerName='Ana';
  addPizza(s,b,{size:'grande',flavors:['baiana']});setFulfillment(s,{method:'PICKUP'});setPayment(s,{method:'PIX'});
  const r1=await intelligentReply('pode ser',s,b,{});
  assert.match(r1,/Confira os dados/);assert.match(r1,/Total: R\$\s?59,99/);
  let sent;b.submitOrder=async x=>{sent=x;return {ok:true,number:7,totalCents:5999,pixCopiaECola:'PIXCODE'};};
  const r2=await intelligentReply('Confirmo',s,b,{});
  assert.ok(sent);assert.match(r2,/nº 7/);assert.match(r2,/PIXCODE/);
  delete b.submitOrder;
});
test('negrito markdown vira negrito do WhatsApp', ()=>{assert.equal(whatsappText('**Total:** R$ 1'),'*Total:* R$ 1');});
