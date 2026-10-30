import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {catalogFromPdvMenu} from '../src/pdv-catalog.mjs';
import {newSession,addPizza,addDrink,getSummary,setFulfillment,setAddress} from '../src/core.mjs';

const base=JSON.parse(fs.readFileSync(new URL('../config/business.json',import.meta.url),'utf8'));
const sz=(b,m,g)=>[{label:'Broto',priceCents:b,maxFlavors:1},{label:'Média',priceCents:m,maxFlavors:2},{label:'Grande',priceCents:g,maxFlavors:3}];
const menu={ok:true,items:[
  {kind:'pizza',name:'Baiana',category:'Salgadas',description:'calabresa, pimenta',sizes:sz(4499,4999,5999)},
  {kind:'pizza',name:'Calabresa',category:'Salgadas',sizes:sz(3999,4499,5499)},
  {kind:'pizza',name:'Chocolate',category:'Doces',sizes:sz(4199,4699,5799)},
  {kind:'item',name:'Coca-Cola 2L',category:'Bebidas',priceCents:1400},
]};

test('catálogo do PDV vira preços por sabor e tamanho', ()=>{
  const b=catalogFromPdvMenu(menu,base);
  assert.equal(b.pizzas.baiana.grande,5999);
  assert.equal(b.halfHalfPricing,'AVERAGE');
  assert.equal(b.sizes.find(s=>s.id==='media').maxFlavors,2);
  assert.equal(b.drinks[0].priceCents,1400);
  assert.equal(b.catalogSource.snapshotOnly,false);
  assert.throws(()=>catalogFromPdvMenu({ok:true,items:[]},base));
});

test('IA soma: meio a meio pela média + bebida, retirada', ()=>{
  const b=catalogFromPdvMenu(menu,base);const s=newSession();
  assert.equal(addPizza(s,b,{size:'grande',flavors:['baiana','calabresa','chocolate']}).ok,true);
  assert.equal(addPizza(s,b,{size:'broto',flavors:['baiana','calabresa']}).ok,false); // broto = 1 sabor
  assert.equal(addDrink(s,b,{drinkId:b.drinks[0].id,quantity:2}).ok,true);
  setFulfillment(s,{method:'PICKUP'});
  const q=getSummary(s,b);
  const avg=Math.round((5999+5499+5799)/3);
  assert.equal(q.subtotalCents,avg+2800);
  assert.equal(q.totalCents,avg+2800);
});

test('entrega usa a taxa validada pelo PDV', ()=>{
  const b=catalogFromPdvMenu(menu,base);const s=newSession();
  addPizza(s,b,{size:'media',flavors:['baiana']});
  setFulfillment(s,{method:'DELIVERY'});setAddress(s,{address:'Rua das Flores, 120, Centro, Curitiba'});
  s.deliveryFeeCents=700;
  assert.equal(getSummary(s,b).totalCents,4999+700);
});
