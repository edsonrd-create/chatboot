import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createNativeServer} from '../src/server.mjs';

const ADMIN='homologation-only-secure-password';
const SECRET='homologation-only-secret-with-at-least-32';
async function fixture(t,{free=false}={}){
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'guto-ops-http-'));
 const env=free?{NODE_ENV:'production',FREE_PREVIEW_MODE:'true',HOST:'127.0.0.1'}:
 {NODE_ENV:'test',HOST:'127.0.0.1',ADMIN_PASSWORD:ADMIN,APP_SECRET:SECRET,WA_QR_ENABLED:'false',WA_QR_AUTOREPLY:'false'};
 const app=createNativeServer({env,dataFile:path.join(temp,'state.json')});
 const address=await app.start(0),base='http://127.0.0.1:'+address.port;
 t.after(async()=>{await app.stop();fs.rmSync(temp,{recursive:true,force:true});});
 const req=(route,opt={})=>fetch(base+route,{redirect:'manual',...opt});
 const login=async()=>{const resp=await req('/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:ADMIN})});assert.equal(resp.status,200);return resp.headers.get('set-cookie').split(';')[0];};
 const createData=async()=>{
  await app.store.change(d=>{
   for(const slot of [1,2]){
    const id=slot+':554199998877';
    d.threads[id]={id,slot,customer:'554199998877',customerName:'Cliente Teste',mode:'HUMAN',updatedAt:'2026-10-28T01:00:00Z',unread:1,messages:[{id:'m'+slot,direction:'incoming',text:slot===1?'Grande calabresa':'Broto doce',type:'text',at:'2026-10-28T01:00:00Z',delivery:'received'}],session:{cart:[],history:[]},orders:[]};
   }
  });
 };
 return {app,req,login,createData,base};
}
test('Operações: todas as consultas e mudanças exigem login',async t=>{
 const {req}=await fixture(t);
 for(const url of ['/api/operations/overview','/api/operations/channels','/api/operations/audit','/api/operations/events'])assert.equal((await req(url)).status,401,url);
 assert.equal((await req('/api/operations/thread/action',{method:'POST',body:'{}'})).status,401);
 assert.equal((await req('/api/operations/channels/1',{method:'PUT',body:'{}'})).status,401);
});
test('Canal 01 e 02: mesmo cliente nunca mistura mensagens',async t=>{
 const {req,login,createData}=await fixture(t);await createData();const cookie=await login(),headers={cookie};
 const view=await req('/api/operations/overview',{headers});
 assert.equal(view.status,200);const data=await view.json();
 assert.equal(data.channels.length,2);
 assert.deepEqual(data.channels.map(c=>c.conversations.length),[1,1]);
 assert.deepEqual(data.channels.map(c=>c.slot),[1,2]);
 assert.equal(data.release.production,false);
 const first=await(await req('/api/thread?id=1%3A554199998877',{headers})).json();
 const second=await(await req('/api/thread?id=2%3A554199998877',{headers})).json();
 assert.equal(first.thread.slot,1);assert.equal(second.thread.slot,2);
 assert.equal(first.messages[0].text,'Grande calabresa');assert.equal(second.messages[0].text,'Broto doce');
});
test('Transições administrativas: concorrência, auditoria e nenhum BOT ativo',async t=>{
 const {req,login,createData,app}=await fixture(t);await createData();const cookie=await login(),headers={cookie,'content-type':'application/json'},id='1:554199998877';
 const post=async(action,expectedVersion)=>req('/api/operations/thread/action',{method:'POST',headers,body:JSON.stringify({id,action,expectedVersion})});
 let r=await post('wait',0);assert.equal(r.status,200);let d=await r.json();assert.equal(d.thread.state,'WAITING');assert.equal(d.autoReplyEnabled,false);
 r=await post('close',0);assert.equal(r.status,409);
 r=await post('close',1);assert.equal(r.status,200);
 r=await post('takeover',2);assert.equal(r.status,409);
 r=await post('reopen',2);assert.equal(r.status,200);
 assert.equal(app.store.snapshot().threads[id].mode,'HUMAN');
 assert.equal(app.store.snapshot().threads['2:554199998877'].mode,'HUMAN');
 assert.equal(app.store.snapshot().settings.autoReply,false);
 const log=await(await req('/api/operations/audit',{headers:{cookie}})).json();
 assert.ok(log.items.length>=3);
 const record=JSON.stringify(log);
 assert.ok(!record.includes('554199998877'));
});
test('Gemini separado por canal salva e carrega; nunca liga a automação',async t=>{
 const {req,login,app}=await fixture(t),cookie=await login(),headers={cookie,'content-type':'application/json'};
 let r=await req('/api/operations/channels/1',{method:'PUT',headers,body:JSON.stringify({provider:'gemini',model:'gemini-2.5-flash',personality:'Atenciosa',instructions:'Atender com clareza',requestedEnabled:true,hours:{start:'15:00',end:'23:45'}})});
 assert.equal(r.status,200);
 const j=await r.json();assert.equal(j.channel.enabled,false);assert.equal(j.channel.requestedEnabled,true);
 const result=await(await req('/api/operations/channels',{headers:{cookie}})).json();
 assert.equal(result.items[0].personality,'Atenciosa');
 assert.equal(result.items[1].personality,'Atendimento claro e cordial');
 assert.equal(result.items[1].requestedEnabled,false);
 assert.equal(app.store.snapshot().settings.approvedForProduction,false);
 assert.equal(app.store.snapshot().settings.autoReply,false);
 r=await req('/api/operations/channels/2',{method:'PUT',headers,body:JSON.stringify({model:'gpt-4o',apiKey:'SECRET_TEST_VALUE'})});
 assert.equal(r.status,422);
});
test('Prévia gratuita: opera apenas com conversas fictícias e não permite gravações',async t=>{
 const {req,app}=await fixture(t,{free:true});
 const view=await req('/api/operations/overview');assert.equal(view.status,200);
 const data=await view.json();assert.equal(data.readOnly,true);
 assert.deepEqual(data.channels.map(c=>c.slot),[1,2]);
 assert.equal(data.totals.conversations,2);
 const safe=JSON.stringify(data);assert.ok(!safe.includes('554199998877'));
 assert.equal((await req('/api/operations/channels')).status,200);
 assert.equal((await req('/api/operations/audit')).status,200);
 assert.equal((await req('/api/operations/thread/action',{method:'POST',body:'{}'})).status,403);
 assert.equal((await req('/api/operations/channels/1',{method:'PUT',body:'{}'})).status,403);
 assert.equal(Object.keys(app.store.snapshot().threads).length,0);
});
test('SSE autenticado emite evento de revisão após persistir nova alteração',async t=>{
 const {req,login,createData,app}=await fixture(t);await createData();const cookie=await login(),controller=new AbortController();
 const res=await req('/api/operations/events',{headers:{cookie},signal:controller.signal});
 assert.equal(res.status,200);
 assert.match(res.headers.get('content-type'),/text\/event-stream/);
 const reader=res.body.getReader(),decoder=new TextDecoder();
 const first=decoder.decode((await reader.read()).value);
 assert.match(first,/event: revision/);
 let number=(await(await req('/api/operations/overview',{headers:{cookie}})).json()).revision;
 await app.store.change(d=>{d.settings.autoReply=false;});
 const second=await Promise.race([reader.read(),new Promise((_,reject)=>setTimeout(()=>reject(Error('SSE timeout')),3500))]);
 const message=decoder.decode(second.value);
 assert.match(message,/event: revision/);
 assert.match(message,new RegExp('revision":'+(number+1)));
 controller.abort();try{await reader.cancel();}catch{}
});
test('Frontend possui layout duplo e controles sem ativar produção',async t=>{
 const {req}=await fixture(t,{free:true});
 const html=await(await req('/painel')).text(),js=await(await req('/app.js')).text();
 for(const id of ['split-toggle','dual-view','dual-list-1','dual-list-2','dual-messages-1','dual-messages-2','gemini-channel-settings','ops-filter'])assert.ok(html.includes('id="'+id+'"'),id);
 assert.match(js,/function renderDualView\(/);
 assert.match(js,/function beginLiveUpdates\(/);
 assert.match(js,/\/api\/operations\/thread\/action/);
 assert.match(html,/PRÉVIA PÚBLICA — SOMENTE LEITURA/);
});
