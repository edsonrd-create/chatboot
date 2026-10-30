import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {FileStore} from './store.mjs';
import {verifyChatwootSignature,normalizeEvent,newSession,getSummary} from './core.mjs';
import {intelligentReply,wantsHuman,quoteText,testAIConnection} from './ai.mjs';

const projectRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
if(fs.existsSync(path.join(projectRoot,'.env')) && typeof process.loadEnvFile==='function')process.loadEnvFile(path.join(projectRoot,'.env'));
const env=process.env;
const PORT=Number(env.PORT||8080);
const HOST=env.HOST||'127.0.0.1';
const ADMIN_PASSWORD=env.ADMIN_PASSWORD||'';
const APP_SECRET=env.APP_SECRET||'';
const CHATWOOT_WEBHOOK_SECRET=env.CHATWOOT_WEBHOOK_SECRET||'';
const CW_ACCOUNT=Number(env.CHATWOOT_ACCOUNT_ID||0);
const RAW_INBOXES=[env.CHATWOOT_INBOX_1,env.CHATWOOT_INBOX_2].map(Number);
const INBOXES=RAW_INBOXES.filter(x=>Number.isSafeInteger(x)&&x>0);
const DATA_FILE=path.resolve(projectRoot,env.DATA_FILE||'./data/state.json');
const BUSINESS_FILE=path.resolve(projectRoot,env.BUSINESS_FILE||'./config/business.json');
const CW_HOST=env.CHATWOOT_BASE_URL||'';
const CW_TOKEN=env.CHATWOOT_API_TOKEN||'';
const BASE_URL=env.APP_PUBLIC_URL||env.RENDER_EXTERNAL_URL||'';
const OUTBOUND_ENABLED=env.WHATSAPP_OUTBOUND_ENABLED==='true' && env.NODE_ENV==='production';
const ONLINE=Boolean(CHATWOOT_WEBHOOK_SECRET&&CW_ACCOUNT&&INBOXES.length===2&&new Set(INBOXES).size===2&&CW_HOST&&CW_TOKEN);
if(ADMIN_PASSWORD.length<12||APP_SECRET.length<32)throw new Error('Defina ADMIN_PASSWORD (12+ caracteres) e APP_SECRET (32+ caracteres) no .env.');
if(env.NODE_ENV==='production'&&!BASE_URL.startsWith('https://'))throw new Error('APP_PUBLIC_URL HTTPS é obrigatório em produção.');
if(CW_HOST && !CW_HOST.startsWith('https://'))throw new Error('CHATWOOT_BASE_URL exige HTTPS.');
if(ONLINE && env.NODE_ENV==='production' && env.DATA_FILE?.includes('tmp'))throw new Error('Use volume persistente para DATA_FILE.');
const store=new FileStore(DATA_FILE).init();
if(!fs.existsSync(BUSINESS_FILE)){fs.mkdirSync(path.dirname(BUSINESS_FILE),{recursive:true});fs.copyFileSync(path.join(projectRoot,'config','business.json'),BUSINESS_FILE);}
let business=JSON.parse(fs.readFileSync(BUSINESS_FILE,'utf8'));
const PUBLIC=path.join(projectRoot,'public');

const json=(res,status,obj,headers={})=>respond(res,status,JSON.stringify(obj),{'content-type':'application/json; charset=utf-8',...headers});
const respond=(res,status,data,headers={})=>{res.writeHead(status,{'x-content-type-options':'nosniff','referrer-policy':'no-referrer','cache-control':'no-store','x-frame-options':'DENY','content-security-policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; object-src 'none'; frame-ancestors 'none'",...headers});res.end(data);};
const safe=(a,b)=>{const x=Buffer.from(String(a));const y=Buffer.from(String(b));return x.length===y.length&&crypto.timingSafeEqual(x,y);};
const sign=(value)=>crypto.createHmac('sha256',APP_SECRET).update(value).digest('hex');
const cookie=(req)=>{try{return Object.fromEntries((req.headers.cookie||'').split(';').map(x=>x.trim().split('=').map(decodeURIComponent)).filter(x=>x.length===2));}catch{return {};}};
function authed(req){const raw=cookie(req).guto_sid||'';const i=raw.lastIndexOf('.');if(i<0)return false;const payload=raw.slice(0,i),sig=raw.slice(i+1);if(!safe(sign(payload),sig))return false;const [u,exp]=payload.split(':');return u==='admin'&&Number(exp)>Date.now()&&Number(exp)<Date.now()+86400000;}
const clientIp=(req)=>req.socket.remoteAddress||'unknown';
const attempts=new Map();
function checkRate(req){const key=clientIp(req),now=Date.now();let b=attempts.get(key)||{n:0,start:now};if(now-b.start>15*60e3)b={n:0,start:now};b.n++;attempts.set(key,b);return b.n<=12;}
function sameOrigin(req){if(!['POST','PUT','PATCH','DELETE'].includes(req.method))return true;const origin=req.headers.origin;const host=BASE_URL||`http://${req.headers.host}`;return req.headers['sec-fetch-site']!=='cross-site'&&(!origin||origin===host);}
async function readBody(req,limit=128*1024){let length=0,chunks=[];for await (const chunk of req){length+=chunk.length;if(length>limit)throw Object.assign(new Error('Payload muito grande'),{status:413});chunks.push(chunk);}return Buffer.concat(chunks);}
const webData=()=>{const d=store.snapshot();return {onlineConfigured:ONLINE,outboundEnabled:OUTBOUND_ENABLED,aiConfigured:!!env.OPENAI_API_KEY,aiMode:env.OPENAI_API_KEY?'MODEL_CONFIGURED':'UNCONFIGURED',inboxes:INBOXES.map((id,i)=>({id,label:`WhatsApp ${i+1}`})),conversations:Object.entries(d.sessions).map(([key,s])=>({key,mode:s.mode,updatedAt:s.updatedAt||'',customer:s.sender||'Cliente',inboxId:s.inboxId,items:s.cart.length,lastMessage:s.history.at(-1)?.content||''})).sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt))),orders:d.orders.map(o=>({...o})).reverse(),stats:{orders:d.orders.length,pending:d.orders.filter(o=>o.status==='PENDING_STAFF_REVIEW').length,conversations:Object.keys(d.sessions).length}};};
function validateBusiness(b){
 if(!b||typeof b!=='object'||typeof b.businessName!=='string'||b.businessName.length>120||!Array.isArray(b.sizes)||!Array.isArray(b.flavors)||!Array.isArray(b.drinks)||!b.faq||typeof b.faq!=='object')return false;
 if(!b.sizes.every(s=>typeof s.id==='string'&&Number.isInteger(s.slices)&&s.slices>0&&s.slices<=32))return false;
 if(!b.flavors.every(f=>typeof f.id==='string'&&typeof f.available==='boolean'))return false;
 if(!b.drinks.every(d=>typeof d.id==='string'&&typeof d.available==='boolean'&&(d.priceCents===null||(Number.isSafeInteger(d.priceCents)&&d.priceCents>=0))))return false;
 if(![null,'MAX','AVERAGE'].includes(b.halfHalfPricing))return false;
 if(!(b.deliveryFeeCents===null||(Number.isSafeInteger(b.deliveryFeeCents)&&b.deliveryFeeCents>=0)))return false;
 for(const prices of Object.values(b.pizzas||{})) for(const p of Object.values(prices||{}))if(!(p===null||(Number.isSafeInteger(p)&&p>=0)))return false;
 return true;
}
// Credentials configured does not prove that the WhatsApp number is connected or eligible.
function channelStatus(){
 return [0,1].map(index=>({
   slot:index+1,
   inboxId:Number.isSafeInteger(RAW_INBOXES[index]) && RAW_INBOXES[index]>0 ? RAW_INBOXES[index]:null,
   accountConfigured:Boolean(CW_ACCOUNT),connection:'UNVERIFIED',
   setup:'META_EMBEDDED_SIGNUP',
   outboundEnabled:OUTBOUND_ENABLED,
   configured:Boolean(ONLINE && Number.isSafeInteger(RAW_INBOXES[index]) && RAW_INBOXES[index]>0),
   chatwootUrl:CW_HOST && CW_HOST.startsWith('https://') ? CW_HOST : null,
   caption:ONLINE && RAW_INBOXES[index] ? 'Credenciais informadas · conexão ainda não verificada':'Aguardando configuração oficial'
 }));
}
const validSessionKey=key=>/^\d+:\d+:\d+$/.test(key) && INBOXES.includes(Number(key.split(':')[1])) && Number(key.split(':')[0])===CW_ACCOUNT;
const inboxRows=()=>Object.entries(store.snapshot().sessions)
 .filter(([key,s])=>validSessionKey(key)&&s&&Array.isArray(s.history))
 .map(([key,s])=>({key,name:s.sender||'Cliente',inboxId:s.inboxId,mode:s.mode,updatedAt:s.updatedAt||'',preview:s.history.at(-1)?.content?.slice(0,160)||'',messages:s.history.length,items:s.cart?.length||0}))
 .sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
const orderSummary=(s)=>({cart:getSummary(s,business).items,address:s.address,payment:s.payment});

async function postMessage(accountId,conversationId,content,isPrivate=false){
 const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),12000);
 try{
  const url=`${CW_HOST.replace(/\/$/,'')}/api/v1/accounts/${accountId}/conversations/${conversationId}/messages`;
  const r=await fetch(url,{method:'POST',signal:controller.signal,headers:{api_access_token:CW_TOKEN,'content-type':'application/json'},body:JSON.stringify({content,message_type:'outgoing',private:isPrivate})});
  if(!r.ok)throw new Error(`Chatwoot HTTP ${r.status}`);
 }finally{clearTimeout(timer);}
}

// Webhook ingress -> durably persisted inbox -> one serialized worker; single-instance MVP.
async function acceptWebhook(event,delivery){
 const n=normalizeEvent(event,INBOXES,CW_ACCOUNT);if(!n)return {accepted:false,ignored:true};
 const id=n.eventKey;
 return store.tx(d=>{if(d.events[id])return {accepted:true,duplicate:true};d.events[id]={id,n,delivery,attempts:0,nextAt:Date.now(),state:'pending',receivedAt:new Date().toISOString()};return {accepted:true,duplicate:false};});
}
let pumping=false;
let flushing=false;
async function pump(){
 if(pumping)return;pumping=true;
 try{
  const now=Date.now();const events=Object.values(store.snapshot().events).filter(x=>x.state==='pending'&&x.nextAt<=now).sort((a,b)=>a.receivedAt.localeCompare(b.receivedAt));
  for(const e of events){
   try{
    // All business writes are committed together with marking the event processed.
    const result=await store.tx(async d=>{
     const evt=d.events[e.id];if(!evt||evt.state!=='pending')return null;
     const {n}=evt;const session=d.sessions[n.key]||newSession();
     session.sender=n.sender;session.inboxId=n.inboxId;session.updatedAt=new Date().toISOString();
     // Keep incoming messages visible to human attendants even after handoff.
     session.history.push({role:'user',content:n.content.slice(0,2000)});
     session.history=session.history.slice(-100);
     if(session.mode==='BOT'){
       const previouslyHuman = session.mode === 'HUMAN';
       let reply;
       if(!env.OPENAI_API_KEY){
         // Never claim to have an AI agent responding when the model is not configured.
         session.mode='HUMAN';session.reason='Modelo de IA não configurado';
         reply='Nosso atendimento automático está indisponível no momento. Vou encaminhar sua conversa à equipe. 😊';
       }else try{reply=await intelligentReply(n.content,session,business,{apiKey:env.OPENAI_API_KEY,model:env.OPENAI_MODEL||'gpt-4.1-mini'});}
       catch(error){console.error('AI processing failure',error.message);reply='Tive uma dificuldade para consultar as informações agora. Vou encaminhar sua conversa para a equipe. 🙏';session.mode='HUMAN';session.reason='Falha no processamento de IA';}
       if(session.mode==='HUMAN'&&wantsHuman(n.content))reply='Claro! Vou encaminhar seu atendimento para nossa equipe. 😊';
       if(!previouslyHuman && session.mode==='HUMAN'){
         const noteId=`handoff:${evt.id}`;
         if(!d.outbox[noteId])d.outbox[noteId]={id:noteId,accountId:n.accountId,conversationId:n.conversationId,content:`[Guto Bot] Atendimento humano solicitado. Motivo: ${String(session.reason||'necessita conferência').slice(0,200)}. IA pausada para esta conversa.`,private:true,state:'pending',attempts:0,nextAt:Date.now()};
       }
       session.history.push({role:'assistant',content:reply.slice(0,3000),delivery:'queued',outboxId:`reply:${evt.id}`});
       session.history=session.history.slice(-100);
       const oid=`reply:${evt.id}`;
       if(!d.outbox[oid])d.outbox[oid]={id:oid,accountId:n.accountId,conversationId:n.conversationId,content:reply.slice(0,3000),state:'pending',attempts:0,nextAt:Date.now()};
       if(session.lastConfirmed){
         if(!d.orders.some(o=>o.requestId===session.lastConfirmed.requestId)){
           d.orders.push({id:crypto.randomUUID(),requestId:session.lastConfirmed.requestId,number:`GX-${String(d.nextOrder++).padStart(6,'0')}`,accountId:n.accountId,inboxId:n.inboxId,conversationId:n.conversationId,customer:n.sender,status:'PENDING_STAFF_REVIEW',createdAt:new Date().toISOString(),...orderSummary(session),quote:session.lastConfirmed.quote});
         }
         delete session.lastConfirmed;
       }
     }
     d.sessions[n.key]=session;evt.state='done';evt.processedAt=new Date().toISOString();return true;
    });
   }catch(error){console.error('event processing error',e.id,error.message);await store.tx(d=>{const x=d.events[e.id];if(x){x.attempts++;x.nextAt=Date.now()+Math.min(300000,2000*2**Math.min(x.attempts,7));if(x.attempts>=8)x.state='dead';}});}
  }
 }finally{pumping=false;}
 // Independent outbox: a slow Chatwoot delivery must not block the next inbound message.
 void flushOutbox();
}
async function flushOutbox(){
 if(flushing)return;flushing=true;
 try{
  if(!ONLINE || !OUTBOUND_ENABLED)return;
  const outgoing=Object.values(store.snapshot().outbox).filter(x=>x.state==='pending'&&x.nextAt<=Date.now());
  for(const o of outgoing){
    try{await postMessage(o.accountId,o.conversationId,o.content,Boolean(o.private));await store.tx(d=>{if(d.outbox[o.id]){d.outbox[o.id].state='sent';d.outbox[o.id].sentAt=new Date().toISOString();for(const sess of Object.values(d.sessions)){const item=sess.history?.find(h=>h.outboxId===o.id);if(item)item.delivery='sent';}}});}
    catch(error){console.error('Chatwoot send error',o.id,error.message);await store.tx(d=>{const x=d.outbox[o.id];if(x){x.attempts++;x.nextAt=Date.now()+Math.min(300000,2000*2**Math.min(x.attempts,7));if(x.attempts>=8){x.state='failed';for(const sess of Object.values(d.sessions)){const item=sess.history?.find(h=>h.outboxId===o.id);if(item)item.delivery='failed';}}}});}
  }
 }finally{flushing=false;}
}

async function router(req,res){
 const url=new URL(req.url||'/',`http://${req.headers.host||'localhost'}`);const p=url.pathname;
 if(p==='/health')return json(res,200,{ok:true,service:'guto-bot',configured:ONLINE,outboundEnabled:OUTBOUND_ENABLED});
 if(p==='/webhooks/chatwoot'&&req.method==='POST'){
  if(!CHATWOOT_WEBHOOK_SECRET||!ONLINE)return json(res,503,{error:'Integração ainda não configurada'});
  const body=await readBody(req);
  const signature=req.headers['x-chatwoot-signature'];const timestamp=req.headers['x-chatwoot-timestamp'];
  if(!verifyChatwootSignature(body,timestamp,signature,CHATWOOT_WEBHOOK_SECRET))return json(res,401,{error:'Assinatura inválida'});
  let event;try{event=JSON.parse(body.toString('utf8'));}catch{return json(res,400,{error:'JSON inválido'});}
  const result=await acceptWebhook(event,req.headers['x-chatwoot-delivery']||'');
  setImmediate(()=>pump());return json(res,202,result);
 }
 if(p==='/api/login'&&req.method==='POST'){
  if(!sameOrigin(req))return json(res,403,{error:'Origem inválida'});
  if(!checkRate(req))return json(res,429,{error:'Muitas tentativas. Tente mais tarde.'});
  let payload;try{payload=JSON.parse((await readBody(req,2048)).toString());}catch{return json(res,400,{error:'JSON inválido'});}
  if(!safe(payload.password||'',ADMIN_PASSWORD))return json(res,401,{error:'Senha incorreta'});
  const token=`admin:${Date.now()+8*60*60*1000}`;const secured=BASE_URL.startsWith('https://')?'; Secure':'';
  return json(res,200,{ok:true},{'set-cookie':`guto_sid=${token}.${sign(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800${secured}`});
 }
 if(p==='/api/logout'&&req.method==='POST'){
  if(!sameOrigin(req))return json(res,403,{error:'Origem inválida'});
  return json(res,200,{ok:true},{'set-cookie':'guto_sid=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0'});
 }
 if(p.startsWith('/api/')){
   if(!authed(req))return json(res,401,{error:'Faça login para acessar'});
   if(!sameOrigin(req))return json(res,403,{error:'Origem inválida'});
   if(p==='/api/dashboard'&&req.method==='GET')return json(res,200,webData());
   if(p==='/api/channels/status'&&req.method==='GET')return json(res,200,{provider:'Chatwoot / Meta Cloud API',channels:channelStatus(),qrGenerated:false,notice:'O QR Code ou código de verificação, quando disponível, é gerado apenas pela Meta no fluxo oficial.'});
   if(p==='/api/inbox/conversations'&&req.method==='GET')return json(res,200,{items:inboxRows(),channels:channelStatus()});
   const inboxDetail=p.match(/^\/api\/inbox\/conversations\/([^/]+)$/);
   if(inboxDetail&&req.method==='GET'){
     const key=decodeURIComponent(inboxDetail[1]);if(!validSessionKey(key))return json(res,404,{error:'Conversa não encontrada'});
     const session=store.snapshot().sessions[key];if(!session)return json(res,404,{error:'Conversa não encontrada'});
     return json(res,200,{key,name:session.sender||'Cliente',inboxId:session.inboxId,mode:session.mode,updatedAt:session.updatedAt||'',history:(session.history||[]).slice(-100).map((m,i)=>({id:m.outboxId||String(i),role:m.role==='user'?'incoming':m.manual?'human':'bot',content:m.content,delivery:m.delivery||null})),summary:getSummary(session,business)});
   }
   const inboxMessage=p.match(/^\/api\/inbox\/conversations\/([^/]+)\/messages$/);
   if(inboxMessage&&req.method==='POST'){
     if(!ONLINE)return json(res,503,{error:'Dois canais Chatwoot ainda não estão configurados.'});
     if(!OUTBOUND_ENABLED)return json(res,403,{error:'Envio real bloqueado em homologação. A ativação exige produção e autorização explícita no servidor.'});
     const key=decodeURIComponent(inboxMessage[1]);if(!validSessionKey(key))return json(res,404,{error:'Conversa não encontrada'});
     let body;try{body=JSON.parse((await readBody(req,8192)).toString('utf8'));}catch{return json(res,400,{error:'JSON inválido'});}
     if(typeof body.content!=='string'||!body.content.trim()||body.content.length>2000||typeof body.requestId!=='string'||!/^[-a-zA-Z0-9_]{8,90}$/.test(body.requestId))return json(res,422,{error:'Mensagem ou chave de idempotência inválida'});
     const oid=`manual:${key}:${body.requestId}`;
     const result=await store.tx(d=>{
       const session=d.sessions[key];if(!session)return 'not_found';
       if(session.mode!=='HUMAN')return 'requires_human';
       if(d.outbox[oid])return 'duplicate';
       const [accountId,inboxId,conversationId]=key.split(':').map(Number);
       d.outbox[oid]={id:oid,accountId,conversationId,content:body.content.trim(),private:false,state:'pending',attempts:0,nextAt:Date.now()};
       session.history.push({role:'assistant',manual:true,content:body.content.trim(),delivery:'queued',outboxId:oid});
       session.history=session.history.slice(-100);session.updatedAt=new Date().toISOString();return 'queued';
     });
     if(result==='queued'){setImmediate(flushOutbox);return json(res,202,{queued:true,requestId:body.requestId});}
     if(result==='duplicate')return json(res,200,{queued:true,duplicate:true,requestId:body.requestId});
     if(result==='requires_human')return json(res,409,{error:'Desative a IA e assuma a conversa antes de responder manualmente.'});
     return json(res,404,{error:'Conversa não encontrada'});
   }

   if(p==='/api/business'&&req.method==='GET')return json(res,200,business);
   if(p==='/api/business'&&req.method==='PUT'){
     let b;try{b=JSON.parse((await readBody(req,200*1024)).toString());}catch{return json(res,400,{error:'JSON inválido'});}
     if(!validateBusiness(b))return json(res,422,{error:'Cardápio inválido: confira preços em centavos, tamanhos, bebidas e políticas de meia a meia.'});
     const temp=BUSINESS_FILE+'.tmp';fs.writeFileSync(temp,JSON.stringify(b,null,2));fs.renameSync(temp,BUSINESS_FILE);business=b;return json(res,200,{ok:true});
   }
   if(p==='/api/ai/check'&&req.method==='POST'){
     if(!env.OPENAI_API_KEY)return json(res,503,{ok:false,error:'IA real não configurada. Configure OPENAI_API_KEY somente no servidor.'});
     try {const result=await testAIConnection({apiKey:env.OPENAI_API_KEY,model:env.OPENAI_MODEL||'gpt-4.1-mini'});return json(res,200,{ok:true,model:result.model,message:'Modelo respondeu ao teste de conectividade.'});}
     catch(error){console.error('AI connectivity failure',error.message);return json(res,503,{ok:false,error:'Conexão com IA falhou. Confira a chave, o modelo e a disponibilidade do provedor no servidor.'});}
   }
   if(p==='/api/simulate'&&req.method==='POST'){
     if(!env.OPENAI_API_KEY)return json(res,503,{error:'O atendimento por IA real ainda não está configurado. Adicione OPENAI_API_KEY à hospedagem para ativar o simulador.'});
     let m;try{m=JSON.parse((await readBody(req,10000)).toString());}catch{return json(res,400,{error:'JSON inválido'});}
     if(typeof m.content!=='string'||!m.content.trim()||m.content.length>2000)return json(res,422,{error:'Mensagem inválida'});
     const key='demo:0:1';const session=store.snapshot().sessions[key]||newSession();
     if(session.mode==='HUMAN')return json(res,200,{reply:'A conversa está com um atendente. Reinicie o teste para retornar ao bot.',session});
     let reply;
     try{reply=await intelligentReply(m.content,session,business,{apiKey:env.OPENAI_API_KEY,model:env.OPENAI_MODEL||'gpt-4.1-mini'});}catch(e){return json(res,503,{error:'IA indisponível: '+e.message});}
     session.history.push({role:'user',content:m.content},{role:'assistant',content:reply});session.history=session.history.slice(-30);
     await store.tx(d=>{if(session.lastConfirmed){if(!d.orders.some(o=>o.requestId===session.lastConfirmed.requestId))d.orders.push({id:crypto.randomUUID(),requestId:session.lastConfirmed.requestId,number:`GX-${String(d.nextOrder++).padStart(6,'0')}`,accountId:0,inboxId:0,conversationId:1,customer:'Cliente (simulador)',status:'PENDING_STAFF_REVIEW',createdAt:new Date().toISOString(),...orderSummary(session),quote:session.lastConfirmed.quote,demo:true});delete session.lastConfirmed;}d.sessions[key]=session;});
     return json(res,200,{reply,summary:getSummary(session,business),mode:session.mode});
   }
   if(p==='/api/simulate/reset'&&req.method==='POST'){
     await store.tx(d=>{delete d.sessions['demo:0:1'];});return json(res,200,{ok:true});
   }
   const handoff=p.match(/^\/api\/conversations\/([^/]+)\/mode$/);
   if(handoff&&req.method==='POST'){
     const key=decodeURIComponent(handoff[1]);if(!validSessionKey(key))return json(res,404,{error:'Conversa não encontrada'});let b;try{b=JSON.parse((await readBody(req,2048)).toString());}catch{return json(res,400,{error:'JSON inválido'});}
     if(!['BOT','HUMAN'].includes(b.mode))return json(res,422,{error:'Modo inválido'});
     const ok=await store.tx(d=>{if(!d.sessions[key])return false;d.sessions[key].mode=b.mode;return true;});return json(res,ok?200:404,{ok});
   }
   const orderRoute=p.match(/^\/api\/orders\/([\w-]+)\/status$/);
   if(orderRoute&&req.method==='POST'){
     let b;try{b=JSON.parse((await readBody(req,2048)).toString());}catch{return json(res,400,{error:'JSON inválido'});}
     const allowed={PENDING_STAFF_REVIEW:['CONFIRMED','REJECTED'],CONFIRMED:['PREPARING','CANCELED'],PREPARING:['READY','CANCELED'],READY:['DISPATCHED','CANCELED'],DISPATCHED:['DELIVERED']};
     const result=await store.tx(d=>{const o=d.orders.find(x=>x.id===orderRoute[1]);if(!o)return 'missing';if(!allowed[o.status]?.includes(b.status))return 'invalid';o.status=b.status;o.updatedAt=new Date().toISOString();return 'ok';});
     return json(res,result==='ok'?200:result==='missing'?404:422,{ok:result==='ok',result});
   }
   return json(res,404,{error:'Rota não encontrada'});
 }
 if(req.method!=='GET')return json(res,405,{error:'Método não permitido'});
 const assets={'/':'index.html','/app.js':'app.js','/style.css':'style.css','/inbox':'inbox.html','/inbox.js':'inbox.js','/inbox.css':'inbox.css'};
 if(!assets[p])return json(res,404,{error:'Não encontrado'});
 const filename=path.join(PUBLIC,assets[p]);
 const mime=p.endsWith('.js')?'text/javascript; charset=utf-8':p.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8';
 return respond(res,200,fs.readFileSync(filename),{'content-type':mime});
}
export function startServer(){const server=http.createServer((req,res)=>router(req,res).catch(e=>{console.error('request error',e.message);if(!res.headersSent)json(res,e.status||500,{error:e.status?'Solicitação rejeitada':'Erro interno'});}));server.listen(PORT,HOST,()=>console.log(`Guto Bot ${HOST}:${PORT} | Chatwoot ${ONLINE?'configurado':'não configurado'} | IA ${env.OPENAI_API_KEY?'configurada':'modo local'}`));const timer=setInterval(pump,2500);timer.unref();setImmediate(pump);return server;}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url))startServer();
