import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createNativeServer} from '../src/server.mjs';

const env={FREE_PREVIEW_MODE:'true',NODE_ENV:'production',HOST:'127.0.0.1',PORT:'8080',DATA_FILE:'/app/data/state.json',META_TOKEN_1:'secret-token-should-never-appear',META_PHONE_ID_1:'12345678',META_APP_ID:'abc-secret'};
async function fixture(t,overrides={}){
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'guto-preview-no-secrets-'));
  const file=path.join(tmp,'state.json');
  const app=createNativeServer({env:{...env,...overrides},dataFile:file});
  const addr=await app.start(0,'127.0.0.1');
  t.after(async()=>{await app.stop();fs.rmSync(tmp,{force:true,recursive:true});});
  const request=(url,opts={})=>fetch('http://127.0.0.1:'+addr.port+url,{redirect:'manual',...opts});
  const post=(url,body={})=>request(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  return {app,request,post,file};
}

test('free: inicia em produção sem senha ou URL externa',async t=>{
  const {request}=await fixture(t);
  const r=await request('/health'),data=await r.json();
  assert.equal(r.status,200);
  assert.deepEqual(data,{ok:true,service:'guto-bot-nativo',ready:false,freePreview:true});
});
test('free: painel disponível sem login, cookies ou credenciais',async t=>{
  const {request}=await fixture(t);
  const r=await request('/painel'),html=await r.text();
  assert.equal(r.status,200);
  assert.match(html,/SOMENTE LEITURA/);
  assert.match(html,/Conversas 100% fictícias/);
  assert.equal(r.headers.has('set-cookie'),false);
  assert.equal((await request('/app.js')).status,200);
  assert.equal((await request('/app.css')).status,200);
});
test('free: status público seguro e sem vazamento de tokens/IDs',async t=>{
  const {request}=await fixture(t);
  const r=await request('/api/status'),raw=await r.text(),s=JSON.parse(raw);
  assert.equal(r.status,200);assert.equal(s.ready,false);assert.equal(s.hosting.readOnly,true);
  assert.equal(s.autoReplyEnabled,false);assert.equal(s.channels.length,2);
  assert.equal(s.channels[0].hasToken,false);assert.equal(s.channels[0].phoneId,'');
  assert.equal(s.oauth.appId,null);assert.equal(s.ai.configured,false);
  assert.doesNotMatch(raw,/secret-token-should-never-appear|12345678|abc-secret/);
});
test('free: conversa fictícia em cada canal com filtro funcional',async t=>{
  const {request}=await fixture(t);
  const items=(await(await request('/api/conversations')).json()).items;
  assert.equal(items.length,2);
  assert.deepEqual(items.map(x=>x.slot),[1,2]);
  assert.ok(items.every(x=>x.customer.includes('FICTICIO')));
  const one=(await(await request('/api/conversations?slot=1')).json()).items;
  assert.equal(one.length,1);
  const d=await(await request('/api/thread?id=demo%3A1')).json();
  assert.equal(d.messages.length,2);assert.match(d.messages[0].source,/FICTÍCIO/);
  assert.equal((await request('/api/thread?id=real')).status,404);
});
test('free: configurações de produção desligadas e sem pedidos reais',async t=>{
  const {request}=await fixture(t);
  const settings=await(await request('/api/settings')).json();
  assert.equal(settings.pdv.enabled,false);
  assert.equal(settings.approval.production,false);
  assert.equal(settings.meta.appConfigured,false);
  assert.equal(settings.meta.webhookUrl,null);
  assert.deepEqual((await(await request('/api/orders')).json()).items,[]);
});
test('free: webhook Meta bloqueado por GET e POST',async t=>{
  const {request}=await fixture(t);
  assert.equal((await request('/webhooks/meta?hub.mode=subscribe&hub.verify_token=a&hub.challenge=42')).status,503);
  assert.equal((await request('/webhooks/meta',{method:'POST',body:'{}'})).status,503);
});
test('free: todos os métodos de escrita são bloqueados, mesmo com cookie',async t=>{
  const {post,request,app,file}=await fixture(t);
  const routes=['/api/login','/api/logout','/api/channels/1/configure','/api/channels/2/verify','/api/meta/signup/complete','/api/reply','/api/ai/test','/api/simulate','/api/pdv/test','/api/settings','/api/thread/read','/api/thread/mode','/api/simulate/reset'];
  for(const route of routes){const r=await post(route,{password:'not-relevant',text:'ola'});assert.equal(r.status,403,route);}
  const put=await request('/api/settings',{method:'PUT',headers:{cookie:'guto_sid=fake.valid'},body:'{}'});
  assert.equal(put.status,403);assert.equal(fs.existsSync(file),false);
  assert.equal(Object.keys(app.store.snapshot().threads).length,0);
  assert.equal(Object.keys(app.store.snapshot().outbox).length,0);
});
test('free: proteção de credenciais continua obrigatória fora do modo de prévia',()=>{
  assert.throws(()=>createNativeServer({env:{NODE_ENV:'production',ADMIN_PASSWORD:'short',APP_SECRET:''}}),/ADMIN_PASSWORD/);
  assert.throws(()=>createNativeServer({env:{NODE_ENV:'production',ADMIN_PASSWORD:'a-password-with-12-chars',APP_SECRET:'long-secret-123456789012345678901234567890',DATA_FILE:'/tmp/example'}}),/HTTPS/);
});
