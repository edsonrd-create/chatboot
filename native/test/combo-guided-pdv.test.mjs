import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {catalogFromPdvMenu} from '../src/pdv-catalog.mjs';
import {newSession,getSummary} from '../src/core.mjs';
import {intelligentReply} from '../src/ai.mjs';
import {buildPdvOrder} from '../src/pdv-order.mjs';
const cfg=JSON.parse(fs.readFileSync(new URL('../config/business.json',import.meta.url),'utf8'));
const menu={ok:true,items:[
 ...['Calabresa','Frango Catupiry','Mexicana','Strogonoff de Frango'].map((name,i)=>({id:i+1,kind:'pizza',name,category:'Salgadas',inStock:true,sizes:[{label:'Grande',priceCents:5999,maxFlavors:2}]})),
 {id:5,kind:'pizza',name:'Proibida',category:'Salgadas',sizes:[{label:'Grande',priceCents:6999,maxFlavors:2}]},
 {id:11,kind:'item',name:'Coca-Cola 2L',category:'Bebidas',priceCents:1500},
 {id:12,kind:'item',name:'Guaraná Antarctica 2L',category:'Bebidas',priceCents:1300},
 {id:13,kind:'item',name:'Coca-Cola Lata',category:'Bebidas',priceCents:600},
 {id:20,kind:'item',category:'Combos',name:'Combo Família',description:'2 pizzas grandes, 2 sabores cada + 1 refrigerante 2L',priceCents:9999,botCheckoutPriceCents:9999,
  comboRules:{pizzaSlots:[
   {label:'Grande 1',sizeHint:'Grande',maxFlavors:2,allowedFlavorIds:[1,2,3,4]},
   {label:'Grande 2',sizeHint:'Grande',maxFlavors:2,allowedFlavorIds:[1,2,3,4]}
  ],drinkSlots:[{label:'Refrigerante 2L',allowedDrinkIds:[11,12]}]}}
]};
const business=catalogFromPdvMenu(menu,cfg);
const settings={menuFlowEnabled:true,catalogSynced:true};
test('monta combo Família com duas pizzas e bebida antes de fechamento',async()=>{
 const session=newSession();
 const first=await intelligentReply('Quero um combo família',session,business,settings);
 assert.match(first,/Pizza 1 de 2/);assert.doesNotMatch(first,/Proibida/);
 const p1=await intelligentReply('Calabresa, Frango com Catupiry',session,business,settings);
 assert.match(p1,/Pizza 2 de 2/);
 const p2=await intelligentReply('Mexicana, Strogonoff de Frango',session,business,settings);
 assert.match(p2,/bebida inclusa/i);
 assert.doesNotMatch(p2,/Lata/);
 const complete=await intelligentReply('Coca-Cola 2L',session,business,settings);
 assert.match(complete,/montado/i);
 assert.equal(session.cart.length,1);
 assert.equal(session.cart[0].kind,'combo');
 assert.equal(getSummary(session,business).subtotalCents,9999);
 const body=buildPdvOrder({...session,customerPhone:'41999999999',customerName:'Edson'},business,{items:getSummary(session,business).items,payment:'PIX',fulfillment:'PICKUP'},'abc123');
 assert.equal(body.items.length,1);
 assert.equal(body.items[0].productId,20);
 assert.match(body.items[0].notes,/Grande 1: Calabresa \/ Frango Catupiry/);
 assert.match(body.items[0].notes,/Grande 2: Mexicana \/ Strogonoff de Frango/);
 assert.match(body.items[0].notes,/Refri: Coca-Cola 2L/);
});
test('não permite bebida diferente ou fechar combo ainda incompleto',async()=>{
 const session=newSession();
 await intelligentReply('Quero um combo família',session,business,settings);
 const early=await intelligentReply('Fechar',session,business,settings);
 assert.match(early,/escolha/i);assert.equal(session.cart.length,0);
 await intelligentReply('Calabresa',session,business,settings);
 await intelligentReply('Mexicana',session,business,settings);
 const no=await intelligentReply('Coca-Cola Lata',session,business,settings);
 assert.match(no,/bebida exata/i);assert.equal(session.cart.length,0);
});
test('rejeita combo sem regras oficiais com transferência segura',async()=>{
 const session=newSession(),invalid={...business,combos:business.combos.map(c=>({...c,comboRules:null}))};
 const reply=await intelligentReply('Quero combo família',session,invalid,settings);
 assert.match(reply,/ainda não pode/i);assert.equal(session.mode,'HUMAN');
 assert.equal(session.cart.length,0);
});
