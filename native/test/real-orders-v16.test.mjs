import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {newSession,addPizza,getSummary,replaceFlavor,replaceFlavorOneUnit,setFulfillment,setAddress,setPayment,requestConfirmation,confirmRequest} from '../src/core.mjs';
import {applyTool,intelligentReply,localReply,flagsAllergy} from '../src/ai.mjs';
const base=JSON.parse(fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../config/business.json'),'utf8'));
const setup=()=>{const b=structuredClone(base);b.pizzas.calabresa.grande=5999;b.pizzas.portuguesa.grande=6299;b.pizzas.frango_catupiry.grande=6499;b.halfHalfPricing='MAX';b.deliveryFeeCents=700;return b;};

test('troca de sabor altera descrição, sem deixar o sabor anterior no resumo',()=>{
 const b=setup(),s=newSession();addPizza(s,b,{size:'grande',flavors:['calabresa','frango_catupiry'],quantity:1});
 const r=replaceFlavor(s,b,{fromFlavorId:'calabresa',toFlavorId:'portuguesa'});
 assert.equal(r.ok,true);
 const summary=getSummary(s,b);assert.deepEqual(summary.items[0].flavors,['portuguesa','frango_catupiry']);
 assert.match(summary.items[0].description,/Portuguesa/);assert.doesNotMatch(summary.items[0].description,/Calabresa/);
 assert.equal(summary.items[0].unitPriceCents,6499);
});

test('duas pizzas iguais: uma troca divide a quantidade sem modificar a outra',()=>{
 const b=setup(),s=newSession();addPizza(s,b,{size:'grande',flavors:['calabresa'],quantity:2});
 assert.equal(replaceFlavor(s,b,{fromFlavorId:'calabresa',toFlavorId:'portuguesa'}).ok,false);
 const originalId=s.cart[0].id;
 const r=replaceFlavorOneUnit(s,b,{itemId:originalId,fromFlavorId:'calabresa',toFlavorId:'portuguesa'});
 assert.equal(r.ok,true);assert.equal(s.cart.length,2);
 assert.equal(s.cart[0].quantity,1);assert.deepEqual(s.cart[0].flavors,['calabresa']);
 assert.equal(s.cart[1].quantity,1);assert.deepEqual(s.cart[1].flavors,['portuguesa']);
 assert.equal(getSummary(s,b).subtotalCents,12298);
});

test('retirada no balcão dispensa endereço e taxa de entrega',()=>{
 const b=setup(),s=newSession();addPizza(s,b,{size:'grande',flavors:['calabresa']});
 assert.equal(setFulfillment(s,{method:'PICKUP'}).ok,true);
 setPayment(s,{method:'PIX'});let q=getSummary(s,b);
 assert.deepEqual(q.missing,[]);assert.equal(q.deliveryFeeCents,0);assert.equal(q.totalCents,5999);
 assert.equal(requestConfirmation(s,b).ok,true);s.quotePresented=true;
 assert.equal(confirmRequest(s,b,{explicitConfirmation:true}).ok,true);
});

test('alterar retirada para entrega invalida orçamento e exige endereço',()=>{
 const b=setup(),s=newSession();addPizza(s,b,{size:'grande',flavors:['calabresa']});
 setFulfillment(s,{method:'PICKUP'});setPayment(s,{method:'CARTAO'});requestConfirmation(s,b);s.quotePresented=true;
 setFulfillment(s,{method:'DELIVERY'});
 assert.ok(getSummary(s,b).missing.includes('endereço'));
 assert.equal(confirmRequest(s,b,{explicitConfirmation:true}).ok,false);
 setAddress(s,{address:'Rua das Flores 123, centro, Colombo'});
 assert.equal(getSummary(s,b).totalCents,6699);
});

test('alteração em uma unidade exige IDs válidos e não modifica carrinho se falhar',()=>{
 const b=setup(),s=newSession();addPizza(s,b,{size:'grande',flavors:['calabresa'],quantity:2});
 const a=JSON.stringify(s.cart);
 assert.equal(replaceFlavorOneUnit(s,b,{itemId:'inexistente',fromFlavorId:'calabresa',toFlavorId:'portuguesa'}).ok,false);
 assert.equal(replaceFlavorOneUnit(s,b,{itemId:s.cart[0].id,fromFlavorId:'quatro_queijos',toFlavorId:'portuguesa'}).ok,false);
 assert.equal(JSON.stringify(s.cart),a);
});

test('alergia alimentar transfere sem garantir segurança e sem chamada à IA',async()=>{
 const b=setup(),s=newSession();let called=0;
 const prior=globalThis.fetch;globalThis.fetch=async()=>{called++;throw Error('Não deve chamar IA');};
 try{
 const reply=await intelligentReply('Meu filho é alérgico a leite, pode fazer sem queijo?',s,b,{apiKey:'fake'});
 assert.equal(flagsAllergy('Tenho anafilaxia'),true);
 assert.equal(s.mode,'HUMAN');assert.match(reply,/contaminação cruzada/);
 assert.equal(called,0);
 }finally{globalThis.fetch=prior;}
});

test('simulador sem chave mantém restrições de alergênicos',()=>{
 const s=newSession(),b=setup();assert.match(localReply('Tenho alergia a leite',s,b),/não consigo garantir/i);assert.equal(s.mode,'HUMAN');
});

test('duas sessões independentes: sabores e forma de entrega não se misturam',()=>{
 const b=setup(),a=newSession(),c=newSession();
 applyTool('adicionar_pizza',{size:'grande',flavors:['calabresa'],quantity:1},a,b,'');
 applyTool('adicionar_pizza',{size:'grande',flavors:['portuguesa'],quantity:1},c,b,'');
 applyTool('definir_modalidade',{method:'PICKUP'},a,b,'');
 applyTool('definir_endereco',{address:'Rua Pinhais 123, Centro, Pinhais'},c,b,'');
 assert.equal(getSummary(a,b).deliveryFeeCents,0);assert.equal(getSummary(c,b).deliveryFeeCents,700);
 assert.deepEqual(a.cart[0].flavors,['calabresa']);assert.deepEqual(c.cart[0].flavors,['portuguesa']);
});

test('IA simulada por respostas HTTP: retirada, pizza e pagamento no mesmo turno, depois confirmação',async()=>{
 const b=setup(),s=newSession();let num=0;
 const orig=globalThis.fetch;
 globalThis.fetch=async(_url,options)=>{
  num++;
  const req=JSON.parse(options.body);
  assert.equal(req.store,false);assert.ok(req.tools.some(t=>t.name==='definir_modalidade'));
  const output=num===1?[
   {type:'function_call',call_id:'p',name:'adicionar_pizza',arguments:JSON.stringify({size:'grande',flavors:['calabresa'],quantity:1})},
   {type:'function_call',call_id:'f',name:'definir_modalidade',arguments:JSON.stringify({method:'PICKUP'})},
   {type:'function_call',call_id:'m',name:'definir_pagamento',arguments:JSON.stringify({method:'PIX'})},
  ]:[{type:'function_call',call_id:'q',name:'solicitar_confirmacao',arguments:'{}'}];
  return {ok:true,json:async()=>({output})};
 };
 try{
  let text=await intelligentReply('Vou retirar uma grande de calabresa, pago no Pix',s,b,{apiKey:'fake'});
  assert.match(text,/Retirada no balcão: R\$\s*0,00/);
  assert.match(text,/Total: R\$\s*59,99/);
  assert.equal(num,2);
  assert.equal(s.quotePresented,true);
  text=await intelligentReply('Confirmo',s,b,{apiKey:'fake'});
  assert.match(text,/conferência da equipe/i);
  assert.ok(s.lastConfirmed?.requestId);
 }finally{globalThis.fetch=orig;}
});
