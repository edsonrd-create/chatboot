import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {intelligentReply,testAIConnection} from '../src/ai.mjs';
import {newSession,getSummary} from '../src/core.mjs';
const dirname=path.dirname(fileURLToPath(import.meta.url));
const business=JSON.parse(fs.readFileSync(path.join(dirname,'../config/business.json'),'utf8'));
function fixture(){const b=structuredClone(business);b.pizzas.calabresa.grande=5999;b.deliveryFeeCents=700;return b;}
test('motor de IA chama ferramentas, apresenta orçamento do servidor e exige confirmação posterior',async()=>{
 const s=newSession(),b=fixture();let calls=0;
 const original=globalThis.fetch;
 globalThis.fetch=async(_url,opts)=>{
   calls++;
   const body=JSON.parse(opts.body);assert.equal(body.store,false);assert.ok(body.tools.length>5);
   const out=calls===1?[
     {type:'function_call',call_id:'pizza',name:'adicionar_pizza',arguments:JSON.stringify({size:'grande',flavors:['calabresa'],quantity:1})},
     {type:'function_call',call_id:'addr',name:'definir_endereco',arguments:JSON.stringify({address:'Rua das Acácias 100, Centro, Curitiba'})},
     {type:'function_call',call_id:'pay',name:'definir_pagamento',arguments:JSON.stringify({method:'PIX'})},
   ]:[{type:'function_call',call_id:'quote',name:'solicitar_confirmacao',arguments:'{}'}];
   return {ok:true,json:async()=>({output:out})};
 };
 try{
   const first=await intelligentReply('Quero uma pizza grande de calabresa, entrega Rua das Acácias 100, Centro, Curitiba, pago pix.',s,b,{apiKey:'fake_key'});
   assert.match(first,/Total: R\$\s*66,99/);
   assert.match(first,/Confirmo/);
   assert.equal(s.quotePresented,true);
   assert.equal(s.cart.length,1);
   assert.equal(getSummary(s,b).totalCents,6699);
   const confirm=await intelligentReply('Confirmo',s,b,{apiKey:'fake_key'});
   assert.match(confirm,/conferência da equipe/i);
   assert.ok(s.lastConfirmed?.requestId);
   assert.equal(calls,2,'confirmação determinística não pede nova chamada à IA');
 } finally {globalThis.fetch=original;}
});
test('solicitação humana interrompe fluxo sem chamada externa',async()=>{
 const s=newSession(),b=fixture();
 const reply=await intelligentReply('Quero falar com atendente humano',s,b,{apiKey:'fake_key'});
 assert.match(reply,/equipe/);assert.equal(s.mode,'HUMAN');
});

test('verificação de IA exige chave e resposta real do provedor',async()=>{
 await assert.rejects(()=>testAIConnection({}),/OPENAI_API_KEY/);
 const previous=globalThis.fetch;
 globalThis.fetch=async(url,options)=>{
  assert.equal(url,'https://api.openai.com/v1/responses');
  const body=JSON.parse(options.body);
  assert.equal(body.store,false);
  assert.equal(body.tools,undefined);
  return {ok:true,json:async()=>({output_text:'OK',output:[]})};
 };
 try{const out=await testAIConnection({apiKey:'fake',model:'gpt-4.1-mini'});assert.deepEqual(out,{ok:true,model:'gpt-4.1-mini'});}
 finally{globalThis.fetch=previous;}
});
