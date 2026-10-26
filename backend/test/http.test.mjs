import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {setTimeout as sleep} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
async function freePort(){return new Promise((resolve,reject)=>{const s=net.createServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});}
async function start(t,online=false){
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'guto-http-'));const port=await freePort();
 const env={...process.env,PORT:String(port),HOST:'127.0.0.1',ADMIN_PASSWORD:'testing_password_for_admin',APP_SECRET:'long_long_secret_for_testing_1234567890',DATA_FILE:path.join(tmp,'state.json'),BUSINESS_FILE:path.join(tmp,'business.json'),NODE_ENV:'test',OPENAI_API_KEY:''};
 if(online)Object.assign(env,{CHATWOOT_ACCOUNT_ID:'9',CHATWOOT_INBOX_1:'11',CHATWOOT_INBOX_2:'22',CHATWOOT_BASE_URL:'https://chatwoot.invalid',CHATWOOT_API_TOKEN:'test_token',CHATWOOT_WEBHOOK_SECRET:'my_webhook_secret'});
 const child=spawn(process.execPath,[path.join(root,'src/server.mjs')],{env,stdio:'ignore'});
 t.after(()=>{child.kill();fs.rmSync(tmp,{recursive:true,force:true});});
 const base=`http://127.0.0.1:${port}`;let alive=false;
 for(let i=0;i<80;i++){if(child.exitCode!==null)break;try{const r=await fetch(base+'/health');if(r.ok){alive=true;break;}}catch{}await sleep(60);}
 assert.equal(alive,true,'Servidor deve inicializar');
 return {base,tmp};
}
test('servidor inicializa, exige login e protege APIs administrativas',async t=>{
 const {base}=await start(t);
 const health=await (await fetch(base+'/health')).json();assert.equal(health.ok,true);
 assert.equal((await fetch(base+'/api/dashboard')).status,401);
 assert.equal((await fetch(base+'/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:'errada'})})).status,401);
 const login=await fetch(base+'/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:'testing_password_for_admin'})});
 assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0];
 const dashboard=await (await fetch(base+'/api/dashboard',{headers:{cookie}})).json();
 assert.equal(dashboard.stats.orders,0);
 assert.equal(dashboard.onlineConfigured,false);
 const sim=await fetch(base+'/api/simulate',{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({content:'quais sabores vocês têm?'})});
 assert.equal(sim.status,503);assert.match((await sim.json()).error,/atendimento por IA real/i);
 const check=await fetch(base+'/api/ai/check',{method:'POST',headers:{cookie}});assert.equal(check.status,503);
 assert.equal((await fetch(base+'/api/dashboard',{headers:{cookie,'origin':'https://site-malicioso.example','sec-fetch-site':'cross-site'},method:'POST'})).status,403);
});
test('dois canais recebem evento autêntico sem duplicar e rejeitam origem desconhecida',async t=>{
 const {base,tmp}=await start(t,true);
 const event=(inbox,id)=>({event:'message_created',id,content:'Boa noite! Quanto custa?',message_type:'incoming',private:false,account:{id:9},inbox:{id:inbox},conversation:{id:100+inbox,inbox_id:inbox},sender:{name:'Cliente'}});
 const send=async (obj,sign=true)=>{const body=JSON.stringify(obj),timestamp=String(Math.floor(Date.now()/1000));const signature='sha256='+crypto.createHmac('sha256','my_webhook_secret').update(`${timestamp}.${body}`).digest('hex');return fetch(base+'/webhooks/chatwoot',{method:'POST',headers:{'content-type':'application/json','x-chatwoot-timestamp':timestamp,'x-chatwoot-signature':sign?signature:'sha256='+'0'.repeat(64)},body});};
 const a=await send(event(11,101));assert.equal(a.status,202);assert.equal((await a.json()).duplicate,false);
 const b=await send(event(11,101));assert.equal(b.status,202);assert.equal((await b.json()).duplicate,true);
 const c=await send(event(22,102));assert.equal(c.status,202);assert.equal((await c.json()).duplicate,false);
 const bad=await send(event(22,103),false);assert.equal(bad.status,401);
 const unknown=await send(event(33,104));assert.equal(unknown.status,202);assert.equal((await unknown.json()).ignored,true);
 // Store incoming events before attempting Chatwoot delivery; avoids dependence on external network.
 const db=JSON.parse(fs.readFileSync(path.join(tmp,'state.json'),'utf8'));
 assert.equal(Object.keys(db.events).length,2);
 assert.equal(db.events['9:101'].n.key,'9:11:111');assert.equal(db.events['9:102'].n.key,'9:22:122');
});

test('regressão: sem IA, webhooks dos dois canais encaminham para humanos sem travar fila',async t=>{
 const {base,tmp}=await start(t,true);
 const makeEvent=(inbox,id)=>({event:'message_created',id,content:'Preciso fazer um pedido, pode me ajudar?',message_type:'incoming',private:false,account:{id:9},inbox:{id:inbox},conversation:{id:700+inbox,inbox_id:inbox},sender:{name:'Cliente homologação'}});
 for(const [inbox,id] of [[11,811],[22,822]]){
  const body=JSON.stringify(makeEvent(inbox,id)),timestamp=String(Math.floor(Date.now()/1000));
  const signature='sha256='+crypto.createHmac('sha256','my_webhook_secret').update(`${timestamp}.${body}`).digest('hex');
  const resp=await fetch(base+'/webhooks/chatwoot',{method:'POST',headers:{'content-type':'application/json','x-chatwoot-timestamp':timestamp,'x-chatwoot-signature':signature},body});
  assert.equal(resp.status,202);
 }
 let db;
 for(let i=0;i<50;i++){
  try{db=JSON.parse(fs.readFileSync(path.join(tmp,'state.json'),'utf8'));}catch{}
  if(db&&db.events['9:811']?.state==='done'&&db.events['9:822']?.state==='done')break;
  await sleep(80);
 }
 assert.equal(db.events['9:811'].state,'done');assert.equal(db.events['9:822'].state,'done');
 assert.equal(db.sessions['9:11:711'].mode,'HUMAN');assert.equal(db.sessions['9:22:722'].mode,'HUMAN');
 assert.match(db.sessions['9:11:711'].history.at(-1).content,/indisponível/);
 for(const id of ['9:811','9:822']){
  assert.equal(db.outbox[`handoff:${id}`].private,true);
  assert.match(db.outbox[`reply:${id}`].content,/equipe/);
 }
});

test('central dupla exige login e não expõe conversas reais sem Chatwoot',async t=>{
 const {base}=await start(t);
 const page=await fetch(base+'/inbox');assert.equal(page.status,200);assert.match(await page.text(),/Duplo WhatsApp/);
 assert.match(page.headers.get('content-security-policy'),/script-src 'self'/);
 assert.equal((await fetch(base+'/inbox.js')).status,200);
 assert.equal((await fetch(base+'/inbox.css')).status,200);
 assert.equal((await fetch(base+'/api/inbox/channels')).status,401);
 assert.equal((await fetch(base+'/api/inbox/conversations?inboxId=11')).status,401);
 const login=await fetch(base+'/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:'testing_password_for_admin'})});
 const cookie=login.headers.get('set-cookie').split(';')[0];
 const r=await fetch(base+'/api/inbox/channels',{headers:{cookie}});
 assert.equal(r.status,200);const d=await r.json();assert.equal(d.channels.length,2);assert.equal(d.chatwootConfigured,false);
 assert.equal((await fetch(base+'/api/inbox/conversations?inboxId=11',{headers:{cookie}})).status,403);
 const send=await fetch(base+'/api/inbox/conversations/1/reply?inboxId=11',{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({content:'Oi'})});
 assert.equal(send.status,403);
});
