import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {newSession,getSummary} from '../src/core.mjs';
import {testAIConnection,intelligentReply,describeAIError} from '../src/ai.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const business=JSON.parse(fs.readFileSync(path.join(root,'config/business.json'),'utf8'));
const fixture=()=>{const b=structuredClone(business);b.pizzas.calabresa.grande=5999;b.deliveryFeeCents=700;return b;};
const key='FAKE_TEST_KEY_NOT_A_REAL_SECRET';
const model='gemini-3.5-flash-lite';

test('Gemini envia chave apenas no header, não na URL nem no código-fonte',async()=>{
 const previous=globalThis.fetch;
 globalThis.fetch=async(url,opts)=>{
  assert.equal(url,'https://generativelanguage.googleapis.com/v1beta/models/'+model+':generateContent');
  assert.equal(opts.headers['x-goog-api-key'],key);
  assert.ok(!url.includes(key));
  assert.equal(opts.method,'POST');
  assert.equal(JSON.parse(opts.body).contents[0].parts[0].text,'Responda apenas: OK');
  return {ok:true,json:async()=>({candidates:[{content:{parts:[{text:'OK'}]}}]})};
 };
 try{assert.deepEqual(await testAIConnection({apiKey:key,provider:'gemini',model}),{ok:true,model,provider:'gemini'});}
 finally{globalThis.fetch=previous;}
});

test('Gemini usa funções reais do carrinho e apresenta orçamento determinístico',async()=>{
 const previous=globalThis.fetch,session=newSession(),b=fixture();let count=0;
 globalThis.fetch=async(url,opts)=>{
  assert.match(url,/generativelanguage.googleapis.com/);
  const body=JSON.parse(opts.body);
  assert.ok(body.systemInstruction.parts[0].text.includes('Nunca invente preço'));
  assert.ok(body.tools[0].functionDeclarations.some(t=>t.name==='adicionar_pizza'));
  count++;
  const parts=count===1?[
    {functionCall:{name:'adicionar_pizza',args:{size:'grande',flavors:['calabresa'],quantity:1}}},
    {functionCall:{name:'definir_endereco',args:{address:'Rua das Acácias 100, Centro, Curitiba'}}},
    {functionCall:{name:'definir_pagamento',args:{method:'PIX'}}},
  ]:[{functionCall:{name:'solicitar_confirmacao',args:{}}}];
  if(count===2)assert.ok(body.contents.some(x=>x.parts?.some(p=>p.functionResponse)));
  return {ok:true,json:async()=>({candidates:[{content:{role:'model',parts}}]})};
 };
 try{
  const reply=await intelligentReply('Quero uma grande calabresa, entrega Rua das Acácias 100 Centro Curitiba, pix',session,b,{apiKey:key,provider:'gemini',model});
  assert.match(reply,/Total: R\$\s*66,99/);
  assert.match(reply,/Confirmo/);
  assert.equal(session.cart.length,1);
  assert.equal(getSummary(session,b).totalCents,6699);
  assert.equal(session.quotePresented,true);
  assert.equal(count,2);
  const next=await intelligentReply('Confirmo',session,b,{apiKey:key,provider:'gemini',model});
  assert.match(next,/conferência da equipe/);
  assert.equal(count,2,'confirmação posterior é determinística e não chama o Gemini novamente');
 }finally{globalThis.fetch=previous;}
});

test('Gemini não inventa resposta quando API retorna candidato vazio',async()=>{
 const previous=globalThis.fetch;
 globalThis.fetch=async()=>({ok:true,json:async()=>({candidates:[{content:{parts:[]}}]})});
 try{
  await assert.rejects(()=>intelligentReply('Quero uma pizza',newSession(),fixture(),{apiKey:key,provider:'gemini',model}),/não retornou uma resposta/);
 }finally{globalThis.fetch=previous;}
});

test('erros da API não revelam a chave na mensagem',async()=>{
 const previous=globalThis.fetch;
 globalThis.fetch=async()=>({ok:false,status:403});
 try{
  await assert.rejects(()=>testAIConnection({apiKey:key,provider:'gemini',model}),(err)=>{
   assert.equal(describeAIError(err,'gemini').code,'AI_PERMISSION');
   assert.equal(err.message.includes(key),false);
   return true;
  });
 }finally{globalThis.fetch=previous;}
});

test('Gemini não é chamado para alergia ou solicitação de atendente',async()=>{
 const previous=globalThis.fetch;
 globalThis.fetch=()=>{throw new Error('Não deveria chamar API');};
 try{
  let session=newSession();
  assert.match(await intelligentReply('Tenho alergia severa, pode garantir?',session,fixture(),{apiKey:key,provider:'gemini',model}),/contaminação cruzada/);
  assert.equal(session.mode,'HUMAN');
  session=newSession();
  assert.match(await intelligentReply('Quero falar com atendente humano',session,fixture(),{apiKey:key,provider:'gemini',model}),/equipe/);
  assert.equal(session.mode,'HUMAN');
 }finally{globalThis.fetch=previous;}
});
