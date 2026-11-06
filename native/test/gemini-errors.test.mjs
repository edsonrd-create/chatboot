import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createNativeServer} from '../src/server.mjs';
import {testAIConnection,describeAIError} from '../src/ai.mjs';

const TEST_KEY='FAKE_GEMINI_TEST_KEY_NO_REAL_CREDENTIALS';
const MODEL='gemini-3.5-flash-lite';
const cases=[
 [400,'AI_BAD_REQUEST',502],
 [401,'AI_KEY_INVALID',503],
 [402,'AI_BILLING',503],
 [403,'AI_PERMISSION',503],
 [404,'AI_MODEL_UNAVAILABLE',503],
 [429,'AI_QUOTA',429],
 [503,'AI_UPSTREAM',503],
 [504,'AI_TIMEOUT',504]
];

for(const [httpCode,expectedCode,expectedStatus] of cases){
 test('Gemini '+httpCode+' apresenta diagnóstico seguro '+expectedCode,async()=>{
  const original=globalThis.fetch;
  globalThis.fetch=async(url,options)=>{
   assert.match(String(url),/generativelanguage.googleapis.com/);
   assert.equal(options.headers['x-goog-api-key'],TEST_KEY);
   return {ok:false,status:httpCode};
  };
  try{
   await assert.rejects(()=>testAIConnection({apiKey:TEST_KEY,provider:'gemini',model:MODEL}),e=>{
    const info=describeAIError(e,'gemini');
    assert.equal(info.code,expectedCode);
    assert.equal(info.status,expectedStatus);
    assert.ok(info.error.length>12);
    assert.equal(JSON.stringify(info).includes(TEST_KEY),false);
    return true;
   });
  }finally{globalThis.fetch=original;}
 });
}

test('Falha de rede é classificada e nunca vaza a chave',async()=>{
 const old=globalThis.fetch;globalThis.fetch=async()=>{throw new Error('Network failure with secret '+TEST_KEY);};
 try{await assert.rejects(()=>testAIConnection({apiKey:TEST_KEY,provider:'gemini',model:MODEL}),e=>{
  const safe=describeAIError(e,'gemini');
  assert.equal(safe.code,'AI_NETWORK');
  assert.equal(safe.status,502);
  assert.equal(JSON.stringify(safe).includes(TEST_KEY),false);
  return true;
 });}finally{globalThis.fetch=old;}
});

test('Endpoint /api/simulate retorna código e erroId, não HTTP 500 genérico nem credenciais',async t=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'guto-ai-errors-'));
 const env={NODE_ENV:'test',HOST:'127.0.0.1',ADMIN_PASSWORD:'test-admin-secret-strong',APP_SECRET:'test-32-characters-for-cookie-123456',AI_PROVIDER:'gemini',GEMINI_API_KEY:TEST_KEY,GEMINI_MODEL:MODEL};
 const app=createNativeServer({env,dataFile:path.join(temp,'state.json')});
 const address=await app.start(0);
 t.after(async()=>{await app.stop();fs.rmSync(temp,{force:true,recursive:true});});
 const nativeFetch=globalThis.fetch.bind(globalThis);
 const base='http://127.0.0.1:'+address.port;
 const login=await nativeFetch(base+'/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:env.ADMIN_PASSWORD})});
 assert.equal(login.status,200);
 const cookie=login.headers.get('set-cookie').split(';')[0];
 const before=app.store.snapshot();
 const old=globalThis.fetch;
 globalThis.fetch=async(url,options)=>{
  if(String(url).startsWith(base))return nativeFetch(url,options);
  assert.match(String(url),/generativelanguage.googleapis.com/);
  return {ok:false,status:403};
 };
 try{
  const res=await nativeFetch(base+'/api/simulate',{method:'POST',headers:{'content-type':'application/json',cookie},body:JSON.stringify({text:'Quero uma pizza grande de calabresa'})});
  assert.equal(res.status,503);
  const data=await res.json();
  assert.equal(data.code,'AI_PERMISSION');
  assert.equal(data.provider,'gemini');
  assert.match(data.errorId,/^[a-f0-9]{12}$/);
  assert.ok(!JSON.stringify(data).includes(TEST_KEY));
  assert.ok(!JSON.stringify(data).includes('Quero uma pizza grande'));
  assert.equal(app.store.snapshot().simulation,undefined,'erro não deve gravar conversa parcialmente');
  assert.deepEqual(app.store.snapshot().orders,before.orders,'falha não pode criar pedido');
 }finally{globalThis.fetch=old;}
});
