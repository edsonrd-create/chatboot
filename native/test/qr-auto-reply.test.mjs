import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createNativeServer} from '../src/server.mjs';
import {envFlag,qrPreflight,qrSupportStatus,qrBlockerMessage} from '../src/qr-automation.mjs';

const P='admin-pass-for-qr-automation-tests';
const S='qr-automation-secret-for-tests-32-characters-long';
const baseEnv={NODE_ENV:'test',HOST:'127.0.0.1',ADMIN_PASSWORD:P,APP_SECRET:S,AI_PROVIDER:'gemini',GEMINI_MODEL:'gemini-3.5-flash-lite',GEMINI_API_KEY:'FAKE_KEY_FOR_UNIT_TESTS_ONLY',WA_QR_ENABLED:'true',WA_QR_AUTOREPLY:'true',WA_QR_VOICE:'false'};
const incoming=(id,from='5541999990001',slot=1)=>({id,slot,from,jid:from+'@s.whatsapp.net',name:'Cliente teste',text:'Boa noite, quero uma pizza grande.',type:'text'});
async function fixture(t,overrides={}){
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'guto-qr-autoreply-'));
 const env={...baseEnv,...overrides},sent=[],calls=[],holder={};
 const qrManagerFactory=({onIncoming})=>{
   holder.onIncoming=onIncoming;
   return {status:slot=>({slot,state:'connected',number:'554199900000'+slot,qr:null,error:null}),isConnected:slot=>slot===1||slot===2,
    send:async(slot,jid,text)=>{sent.push({slot,jid,text});return {id:'sent-'+sent.length};},
    sendVoice:async()=>{throw Error('Not expected')},
    presence:async()=>{},resume:async()=>{},start:async()=>{},logout:async()=>{}};
 };
 const app=createNativeServer({env,dataFile:path.join(temp,'state.json'),qrManagerFactory,respondWithAI:async(message,session)=>{
   calls.push(message);session.mode='BOT';return 'Olá! Qual sabor você deseja?';
 }});
 const address=await app.start(0),url='http://127.0.0.1:'+address.port;
 t.after(async()=>{await app.stop();fs.rmSync(temp,{recursive:true,force:true});});
 const request=(p,opts={})=>fetch(url+p,{redirect:'manual',...opts});
 const login=async()=>{const resp=await request('/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:P})});assert.equal(resp.status,200);return resp.headers.get('set-cookie').split(';')[0];};
 return {app,env,sent,calls,holder,request,login};
}
test('Railway: booleans verdadeiros com espaços/aspas são reconhecidos',()=>{
 for(const v of [true,'true',' TRUE ','"true"',"'true'",'1','on','SIM'])assert.equal(envFlag(v),true,String(v));
 for(const v of [false,undefined,'false','off','0','',' WA_QR_AUTOREPLY=true '])assert.equal(envFlag(v),false,String(v));
});
test('Status QR aponta precisamente os requisitos ausentes e não divulga segredos',()=>{
 const x=qrSupportStatus({enabled:true,autoReply:true,aiConfigured:false,slots:[{slot:1,state:'connected'},{slot:2,state:'disconnected'}]});
 assert.equal(x.autoReplyConfigured,true);
 assert.equal(x.active,false);
 assert.deepEqual(x.slots[0].blockers,['AI_API_KEY']);
 assert.ok(x.slots[1].blockers.includes('WHATSAPP_DISCONNECTED'));
 assert.match(x.help,/chave da IA/);
 assert.equal(qrPreflight({enabled:true,autoReply:true,aiConfigured:true,connected:true}).ready,true);
 assert.match(qrBlockerMessage(['THREAD_HUMAN']),/Ativar IA/);
});
test('Autorresposta real simulada: nova conversa BOT recebe 1 resposta e nunca duplica',async t=>{
 const {holder,app,sent,calls,request,login}=await fixture(t);
 await holder.onIncoming(incoming('q1'));
 assert.equal(sent.length,1);assert.equal(sent[0].slot,1);
 assert.equal(sent[0].jid,'5541999990001@s.whatsapp.net');
 assert.match(sent[0].text,/Qual sabor/);
 let thread=app.store.snapshot().threads['qr1:5541999990001'];
 assert.equal(thread.mode,'BOT');
 assert.equal(thread.messages.length,2);
 await holder.onIncoming(incoming('q1'));
 assert.equal(sent.length,1,'replay do evento não pode gerar segundo envio');
 const cookie=await login();
 const status=await (await request('/api/qr/status',{headers:{cookie}})).json();
 assert.equal(status.active,true);assert.equal(status.aiConfigured,true);
 assert.equal(status.slots[0].replyReady,true);
 assert.equal(status.slots[1].replyReady,true);
 const general=await(await request('/api/status',{headers:{cookie}})).json();
 assert.equal(general.autoReplyEnabled,true);
 assert.equal(general.ready,false,'integração com PDV continua em homologação');
 assert.equal(calls.length,1);
 assert.ok(!JSON.stringify(status).includes(baseEnv.GEMINI_API_KEY));
});
test('Conversas antigas HUMAN podem passar a BOT sem apagar histórico e podem voltar a HUMAN',async t=>{
 const {app,holder,sent,request,login}=await fixture(t);
 await app.store.change(d=>{
   const id='qr1:5541999990001';
   d.threads[id]={id,slot:1,via:'qr',jid:'5541999990001@s.whatsapp.net',customer:'5541999990001',customerName:'Cliente Antigo',mode:'HUMAN',messages:[{id:'old-1',direction:'incoming',text:'Pedido antigo',at:'2026-10-26T18:00:00Z'}],session:{mode:'HUMAN',cart:[],history:[]},orders:[],unread:0,updatedAt:'2026-10-26T18:00:00Z'};
 });
 await holder.onIncoming(incoming('q2'));assert.equal(sent.length,0,'humano não pode ser reativado silenciosamente');
 const cookie=await login(),headers={cookie,'content-type':'application/json'};
 const set=async mode=>request('/api/thread/mode',{method:'POST',headers,body:JSON.stringify({id:'qr1:5541999990001',mode})});
 const enabled=await set('BOT');assert.equal(enabled.status,200,await enabled.text());
 assert.equal(app.store.snapshot().threads['qr1:5541999990001'].mode,'BOT');
 await holder.onIncoming(incoming('q3'));assert.equal(sent.length,1);
 const disabled=await set('HUMAN');assert.equal(disabled.status,200);
 await holder.onIncoming(incoming('q4'));assert.equal(sent.length,1);
 assert.equal(app.store.snapshot().threads['qr1:5541999990001'].messages[0].text,'Pedido antigo');
});
test('Flag WA_QR_AUTOREPLY desligada: botão retorna diagnóstico preciso sem forçar BOT',async t=>{
 const {app,request,login}=await fixture(t,{WA_QR_AUTOREPLY:'false'});
 const id='qr1:5541999990001';
 await app.store.change(d=>{d.threads[id]={id,slot:1,via:'qr',jid:'5541999990001@s.whatsapp.net',customer:'5541999990001',mode:'HUMAN',session:{mode:'HUMAN',cart:[],history:[]},messages:[],unread:0,updatedAt:''};});
 const cookie=await login(),headers={cookie,'content-type':'application/json'};
 const r=await request('/api/thread/mode',{method:'POST',headers,body:JSON.stringify({id,mode:'BOT'})});
 assert.equal(r.status,409);const j=await r.json();assert.equal(j.code,'QR_NOT_READY');
 assert.ok(j.blockers.includes('WA_QR_AUTOREPLY'));
 assert.match(j.error,/WA_QR_AUTOREPLY=true/);
 assert.equal(app.store.snapshot().threads[id].mode,'HUMAN');
 const status=await(await request('/api/qr/status',{headers:{cookie}})).json();
 assert.equal(status.autoReplyConfigured,false);
 assert.equal(status.active,false);
});
test('Chave Gemini ausente: flag ligada não mascara a falta do provedor',async t=>{
 const {holder,sent,request,login}=await fixture(t,{GEMINI_API_KEY:''});
 await holder.onIncoming(incoming('no-key'));
 assert.equal(sent.length,0);
 const cookie=await login(),status=await(await request('/api/qr/status',{headers:{cookie}})).json();
 assert.equal(status.autoReply,true);
 assert.equal(status.active,false);
 assert.ok(status.blockers.includes('AI_API_KEY'));
});
test('Lista de números de teste impede resposta a outro telefone',async t=>{
 const {holder,sent,app,login,request}=await fixture(t,{WA_QR_TEST_NUMBERS:'5541999990001'});
 await holder.onIncoming(incoming('other','5541999999999'));
 assert.equal(sent.length,0);
 assert.equal(app.store.snapshot().threads['qr1:5541999999999'].mode,'HUMAN');
 await holder.onIncoming(incoming('allowed','5541999990001'));
 assert.equal(sent.length,1);
 const cookie=await login();
 const status=await(await request('/api/qr/status',{headers:{cookie}})).json();
 assert.equal(status.testNumbersOnly,true);
 assert.equal(JSON.stringify(status).includes('5541999990001'),false,'não divulgar lista completa de testes');
});
test('Canal QR real fica isolado por número na mesma conta do cliente',async t=>{
 const {holder,app,sent}=await fixture(t);
 await holder.onIncoming(incoming('a1','5541999990001',1));
 await holder.onIncoming(incoming('a2','5541999990001',2));
 assert.deepEqual(sent.map(s=>s.slot),[1,2]);
 const s=app.store.snapshot();
 assert.equal(s.threads['qr1:5541999990001'].messages.length,2);
 assert.equal(s.threads['qr2:5541999990001'].messages.length,2);
});
