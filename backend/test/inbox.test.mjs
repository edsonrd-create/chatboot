import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {setTimeout as sleep} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
async function setup(t){
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'guto-v18-test-'));
 const port=await new Promise(res=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>res(p));});});
 const env={...process.env,PORT:String(port),HOST:'127.0.0.1',ADMIN_PASSWORD:'long-test-admin-password',APP_SECRET:'a-super-secret-string-for-tests-only-12345678',DATA_FILE:path.join(tmp,'state.json'),BUSINESS_FILE:path.join(tmp,'business.json'),NODE_ENV:'test',OPENAI_API_KEY:'',CHATWOOT_ACCOUNT_ID:'9',CHATWOOT_INBOX_1:'11',CHATWOOT_INBOX_2:'22',CHATWOOT_BASE_URL:'https://chatwoot.invalid',CHATWOOT_API_TOKEN:'testtoken',CHATWOOT_WEBHOOK_SECRET:'webhook-secret'};
 const child=spawn(process.execPath,['src/server.mjs'],{cwd:root,env,stdio:'ignore'});
 t.after(()=>{child.kill();fs.rmSync(tmp,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+port;
 let ready=false;for(let i=0;i<80;i++){try{if((await fetch(base+'/health')).ok){ready=true;break;}}catch{}await sleep(70);}
 assert.ok(ready,'backend inicializa');
 const login=await fetch(base+'/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:'long-test-admin-password'})});
 assert.equal(login.status,200);
 const cookie=login.headers.get('set-cookie').split(';')[0];
 const request=(url,opts={})=>fetch(base+url,{headers:{cookie,'content-type':'application/json'},...opts});
 const webhook=async(inbox,id,content)=>{const event={event:'message_created',id,content,message_type:'incoming',private:false,account:{id:9},inbox:{id:inbox},conversation:{id:500+inbox,inbox_id:inbox},sender:{name:'Cliente '+inbox}};const body=JSON.stringify(event),timestamp=String(Math.floor(Date.now()/1000)),signature='sha256='+crypto.createHmac('sha256','webhook-secret').update(timestamp+'.'+body).digest('hex');const r=await fetch(base+'/webhooks/chatwoot',{method:'POST',headers:{'x-chatwoot-timestamp':timestamp,'x-chatwoot-signature':signature},body});assert.equal(r.status,202);};
 const wait=async(expected)=>{for(let i=0;i<80;i++){const r=await (await request('/api/inbox/conversations')).json();if(r.items.length===expected)return r;await sleep(70);}throw Error('Eventos não processados');};
 return {base,request,webhook,wait,tmp};
}
test('central WhatsApp expõe interface mas APIs privadas exigem login',async t=>{
 const {base,request}=await setup(t);
 assert.equal((await fetch(base+'/inbox')).status,200);
 assert.equal((await fetch(base+'/inbox.css')).status,200);
 assert.equal((await fetch(base+'/inbox.js')).status,200);
 assert.equal((await fetch(base+'/api/inbox/conversations')).status,401);
 const st=await (await request('/api/channels/status')).json();
 assert.equal(st.channels.length,2);
 assert.equal(st.qrGenerated,false);
 assert.equal(st.channels[0].connection,'UNVERIFIED');
});
test('inboxes separados e envio manual bloqueado na homologação',async t=>{
 const {request,webhook,wait,tmp}=await setup(t);
 await webhook(11,31001,'Preciso de uma pizza grande');
 await webhook(22,31002,'Qual o tamanho da gigante?');
 const rows=await wait(2);assert.equal(rows.items.length,2);
 const a='9:11:511',b='9:22:522';
 let detail=await (await request('/api/inbox/conversations/'+encodeURIComponent(a))).json();
 assert.equal(detail.name,'Cliente 11');
 assert.ok(!detail.history.some(m=>m.content.includes('gigante')));
 assert.equal((await request('/api/inbox/conversations/9%3A33%3A533')).status,404);
 const url='/api/inbox/conversations/'+encodeURIComponent(a)+'/messages';
 const body=JSON.stringify({content:'Boa noite! Vou confirmar o pedido.',requestId:'request-123456789'});
 const first=await request(url,{method:'POST',body});assert.equal(first.status,403);
 const second=await request(url,{method:'POST',body});assert.equal(second.status,403);
 const dashboard=await (await request('/api/dashboard')).json();assert.equal(dashboard.outboundEnabled,false);
 const channels=await (await request('/api/channels/status')).json();assert.equal(channels.channels[0].outboundEnabled,false);
 detail=await (await request('/api/inbox/conversations/'+encodeURIComponent(a))).json();
 assert.equal(detail.history.filter(m=>m.role==='human').length,0);
 const db=JSON.parse(fs.readFileSync(path.join(tmp,'state.json'),'utf8'));
 assert.equal(Object.keys(db.outbox).filter(id=>id.startsWith('manual:')).length,0);
 assert.equal((await request('/api/conversations/'+encodeURIComponent(a)+'/mode',{method:'POST',body:JSON.stringify({mode:'BOT'})})).status,200);
 assert.equal((await request(url,{method:'POST',body:JSON.stringify({content:'test',requestId:'request-abcdef123'})})).status,403);
 const detailB=await (await request('/api/inbox/conversations/'+encodeURIComponent(b))).json();assert.equal(detailB.name,'Cliente 22');
});
test('mensagens recebidas não somem após transferência humana',async t=>{
 const {request,webhook,wait}=await setup(t);
 await webhook(11,41001,'Boa noite');await wait(1);
 const url='/api/inbox/conversations/9%3A11%3A511';
 const initial=await (await request(url)).json();assert.equal(initial.mode,'HUMAN');
 await webhook(11,41002,'Quero duas pizzas, posso pedir?');
 let result;for(let i=0;i<80;i++){result=await (await request(url)).json();if(result.history.some(m=>m.content.includes('duas pizzas')))break;await sleep(70);}
 assert.equal(result.history.at(-1).role,'incoming');
 assert.equal(result.history.length,initial.history.length+1);
});
