import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {QA_WINDOW_MS,isThreadTestActive,enableThreadTest,clearThreadTest} from '../src/thread-test.mjs';
import {threadInfo} from '../src/operations.mjs';

const now=Date.parse('2026-11-05T22:00:00Z');
const conversation=()=>({id:'qr1:5541999990000',via:'qr',mode:'HUMAN',slot:1,customer:'5541999990000',messages:[],session:{mode:'HUMAN'}});
test('ativação somente da conversa selecionada por 15 minutos',()=>{
 const chosen=conversation(),other={...conversation(),id:'qr1:5541888880000',customer:'5541888880000'};
 enableThreadTest(chosen,now);
 assert.equal(chosen.mode,'BOT');
 assert.equal(chosen.session.mode,'BOT');
 assert.equal(chosen.testReplyUntil,now+QA_WINDOW_MS);
 assert.equal(isThreadTestActive(chosen,{now:now+1000,slot:1,customer:'5541999990000'}),true);
 assert.equal(isThreadTestActive(chosen,{now:now+1000,slot:2,customer:'5541999990000'}),false);
 assert.equal(isThreadTestActive(chosen,{now:now+1000,slot:1,customer:'5541888880000'}),false);
 assert.equal(isThreadTestActive(other,{now:now+1000,slot:1,customer:other.customer}),false);
 assert.equal(isThreadTestActive(chosen,{now:now+QA_WINDOW_MS,slot:1,customer:chosen.customer}),false);
 assert.equal(isThreadTestActive(chosen,{now:now+QA_WINDOW_MS+1,slot:1,customer:chosen.customer}),false);
 assert.equal(threadInfo(chosen).testReplyUntil,now+QA_WINDOW_MS);
 clearThreadTest(chosen);
 assert.equal(isThreadTestActive(chosen,{now:now+1000}),false);
});
test('teste individual rejeita canais não QR e não muda os clientes',()=>{
 assert.throws(()=>enableThreadTest({...conversation(),via:'meta'},now),/Apenas WhatsApp QR/);
 const c=conversation(); c.mode='BOT';c.testReplyUntil=now+QA_WINDOW_MS+1;
 assert.equal(isThreadTestActive(c,{now}),false);
});
test('atendimento real respeita limite de duração, login e UI com opt-in explícito',()=>{
 const server=fs.readFileSync(new URL('../src/server.mjs',import.meta.url),'utf8');
 const ui=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
 assert.match(server,/if\(!authed\(req\)\)return json\(res,401/);
 assert.match(server,/replyAllowedForThread\(t\)/);
 assert.match(server,/replyAllowedForThread\(existing\)/);
 assert.match(server,/testReplyUntil=enableThreadTest\(t,clock\(\)\)/);
 assert.match(server,/numberAllowed:qrAllowed\(t0.customer\)/);
 assert.match(server,/clearThreadTest\(d.threads\[v.id\]\)/);
 assert.match(ui,/Ativar teste nesta conversa \(15 min\)/);
 assert.match(ui,/testReplyUntil/);
});
