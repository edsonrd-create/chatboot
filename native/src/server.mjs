import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {JsonStore,safeCompare,protectToken,revealToken} from './storage.mjs';
import {verifyMetaSignature,parseMetaWebhook,checkMetaPhone,sendMetaText,exchangeSignupCode,verifyPhoneInWaba,subscribeWaba,graphVersion} from './meta.mjs';
import {newSession,getSummary} from './core.mjs';
import {intelligentReply,testAIConnection} from './ai.mjs';
import {validatePdvSettings,pdvReadStatus} from './pdv-integration.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const STATIC=path.join(root,'public');
const sign=(payload,secret)=>crypto.createHmac('sha256',secret).update(payload).digest('hex');
const e164=x=>typeof x==='string'&&/^\d{5,25}$/.test(x);
const csrfSafe=(req,appUrl)=>{if(req.headers['sec-fetch-site']==='cross-site')return false;const origin=req.headers.origin;if(!origin)return true;const expected=appUrl?new URL(appUrl).origin:`http://${req.headers.host}`;return origin===expected;};
const cookieValue=req=>{const raw=String(req.headers.cookie||'');return raw.split(';').map(x=>x.trim()).find(x=>x.startsWith('guto_sid='))?.slice(9)||'';};
const respond=(res,status,body,extra={})=>{res.writeHead(status,{'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','x-frame-options':'DENY',...extra});res.end(body);};
const json=(res,status,data,extra={})=>respond(res,status,JSON.stringify(data),{'content-type':'application/json; charset=utf-8',...extra});
async function readBody(req,limit=128000){let n=0;const chunks=[];for await(const piece of req){n+=piece.length;if(n>limit)throw Object.assign(new Error('Payload excede limite'),{status:413});chunks.push(piece);}return Buffer.concat(chunks);}
const short=x=>String(x||'').slice(0,3000);
const userView=t=>({id:t.id,slot:t.slot,customer:t.customer,customerName:t.customerName,mode:t.mode,updatedAt:t.updatedAt,unread:t.unread||0,lastText:t.messages?.at(-1)?.text||'',messageCount:t.messages?.length||0,orderCount:t.orders?.length||0});
const publicChannel=c=>({slot:c.slot,phoneId:c.phoneId,number:c.display,apiVerifiedAt:c.checkedAt,lastInboundAt:c.lastInboundAt,lastOutboundAt:c.lastOutboundAt,hasToken:Boolean(c.tokenEncrypted),status:c.checkedAt?'API_VERIFIED_NOT_END_TO_END':'NOT_VERIFIED'});
const serializeMessage=m=>({id:m.id,direction:m.direction,text:m.text,type:m.type,at:m.at,delivery:m.delivery||'',source:m.source||''});
const getToken=(c,env)=>c.tokenEncrypted?revealToken(c.tokenEncrypted,env.APP_SECRET):String(env[`META_TOKEN_${c.slot}`]||'');

export function createNativeServer({env=process.env,fetchImpl=globalThis.fetch,dataFile,clock=()=>Date.now()}={}){
  if(!env.ADMIN_PASSWORD||env.ADMIN_PASSWORD.length<12||!env.APP_SECRET||env.APP_SECRET.length<32||!env.META_APP_SECRET||!env.META_VERIFY_TOKEN){throw new Error('ADMIN_PASSWORD (12+), APP_SECRET (32+), META_APP_SECRET e META_VERIFY_TOKEN são exigidos.');}
  if(env.NODE_ENV==='production' && (!env.APP_PUBLIC_URL?.startsWith('https://')||!env.DATA_FILE&&!dataFile))throw new Error('Produção exige APP_PUBLIC_URL HTTPS e armazenamento persistente.');
  const store=new JsonStore(dataFile||path.join(root,env.DATA_FILE||'data/state.json')).init();
  const appUrl=env.APP_PUBLIC_URL||'';
  const allowedHosts=String(env.PDV_ALLOWED_HOSTS||'pdvgutoexpress.com.br').split(',').map(x=>x.trim()).filter(Boolean);
  const attempts=new Map();
  let pumping=false;
  let timer;
  const business=JSON.parse(fs.readFileSync(path.join(root,'config','business.json'),'utf8'));
  const version=graphVersion(env.META_GRAPH_VERSION);
  const configuredChannels=d=>d.channels.map(c=>{const phoneId=c.phoneId||String(env[`META_PHONE_ID_${c.slot}`]||'');return {...c,phoneId};});
  const status=()=>{const d=store.snapshot();const channels=configuredChannels(d);return {mode:'HOMOLOGACAO',ready:false,autoReplyEnabled:false,reason:'Liberação integral pendente: prova real de 2 números, PDV e IA',channels:channels.map(publicChannel),ai:{configured:Boolean(env.OPENAI_API_KEY),model:env.OPENAI_MODEL||'gpt-4.1-mini',realTest:!!d.aiTest?.ok,testAt:d.aiTest?.at||null},pdv:{...d.settings.pdv,lastTest:d.settings.pdvTest||null},integration:{provider:'META_CLOUD_API_DIRECT',chatwoot:false,qr:'META_OFFICIAL_ONBOARDING_ONLY'},stats:{conversations:Object.keys(d.threads).length,messages:Object.values(d.threads).reduce((n,t)=>n+t.messages.length,0),pendingOrders:d.orders.filter(o=>o.status==='PENDING_STAFF_REVIEW').length},oauth:{available:Boolean(env.META_APP_ID&&env.META_CONFIG_ID),appId:env.META_APP_ID||null,configId:env.META_CONFIG_ID||null}};};
  function authed(req){const raw=cookieValue(req);const n=raw.lastIndexOf('.');if(n<0)return false;const payload=raw.slice(0,n),mac=raw.slice(n+1);if(!safeCompare(sign(payload,env.APP_SECRET),mac))return false;const parts=payload.split(':');return parts[0]==='admin'&&Number(parts[1])>clock()&&Number(parts[1])<clock()+86400000;}
  function checkLoginRate(req){const ip=req.socket?.remoteAddress||'unknown',now=clock();let old=attempts.get(ip)||{at:now,n:0};if(now-old.at>15*60e3)old={at:now,n:0};old.n++;attempts.set(ip,old);return old.n<=12;}
  function append(t,m){t.messages.push(m);if(t.messages.length>250)t.messages=t.messages.slice(-250);t.updatedAt=m.at;}
  async function receive(events){const applied=[];await store.change(d=>{
    for(const evt of events){const c=configuredChannels(d).find(c=>c.phoneId===evt.phoneId);if(!c)continue;
      const unique=`${evt.phoneId}:${evt.kind}:${evt.id}:${evt.status||''}`;if(d.events[unique])continue;d.events[unique]={at:new Date(clock()).toISOString()};
      const stored=d.channels.find(x=>x.slot===c.slot);
      if(evt.kind==='incoming'){
        const tid=`${c.slot}:${evt.from}`,t=d.threads[tid]||{id:tid,slot:c.slot,customer:evt.from,customerName:evt.customerName||evt.from,mode:'HUMAN',unread:0,updatedAt:'',messages:[],session:newSession(),orders:[]};
        if(evt.customerName)t.customerName=evt.customerName;
        append(t,{id:evt.id,direction:'incoming',text:evt.text||`[${evt.type}: encaminhar ao atendente]`,type:evt.type,at:new Date(clock()).toISOString(),delivery:'received',source:'Meta'});
        t.unread=(t.unread||0)+1;t.lastInboundAt=new Date(clock()).toISOString();d.threads[tid]=t;stored.lastInboundAt=new Date(clock()).toISOString();applied.push({id:evt.id,threadId:tid});
      } else if(evt.kind==='status'){
        const out=Object.values(d.outbox).find(x=>x.metaMessageId===evt.id&&x.slot===c.slot);
        if(out){out.delivery=evt.status;const t=d.threads[out.threadId];const msg=t?.messages.find(m=>m.outboxId===out.id);if(msg)msg.delivery=evt.status;}
      } else if(evt.kind==='echo'){
        const id=`${c.slot}:${evt.to}`,t=d.threads[id];if(t){append(t,{id:evt.id,direction:'outgoing',text:evt.text,type:'text',source:'WhatsApp Business app',at:new Date(clock()).toISOString(),delivery:'echo'});t.mode='HUMAN';}
      }
    }
    // Retain dedup keys for 30 days; messages remain independently stored under the retention policy.
    const cut=clock()-30*864e5;for(const [k,v] of Object.entries(d.events))if(new Date(v.at).getTime()<cut)delete d.events[k];
  });return applied;}
  async function enqueueManual(tid,content){let record;await store.change(d=>{
    const t=d.threads[tid];if(!t)throw Object.assign(new Error('Conversa não encontrada'),{status:404});
    if(t.mode!=='HUMAN')throw Object.assign(new Error('Assuma a conversa antes de enviar'),{status:409});
    const channel=configuredChannels(d).find(x=>x.slot===t.slot);if(!channel?.checkedAt)throw Object.assign(new Error('Valide a API do número antes de responder'),{status:409});
    if(!channel.phoneId||!getToken(channel,env))throw Object.assign(new Error('Canal sem credenciais'),{status:409});
    if(!t.lastInboundAt || clock()-new Date(t.lastInboundAt).getTime()>24*60*60*1000)throw Object.assign(new Error('Janela de 24 horas vencida; use modelo aprovado pela Meta'),{status:409});
    const id=crypto.randomUUID();record={id,threadId:tid,slot:t.slot,to:t.customer,text:content,state:'pending',delivery:'queued',attempts:0,nextAt:clock(),createdAt:new Date(clock()).toISOString()};d.outbox[id]=record;
    append(t,{id,direction:'outgoing',type:'text',text:content,at:record.createdAt,delivery:'queued',outboxId:id,source:'Atendente'});
  });return record;}
  async function pump(){if(pumping)return;pumping=true;try{
    const data=store.snapshot();
    for(const o of Object.values(data.outbox).filter(x=>x.state==='pending'&&x.nextAt<=clock()).slice(0,20)){
      try{const channel=configuredChannels(store.snapshot()).find(c=>c.slot===o.slot);if(!channel?.checkedAt)continue;
        const meta=await sendMetaText({phoneId:channel.phoneId,to:o.to,text:o.text,token:getToken(channel,env),version,fetchImpl});
        await store.change(d=>{const entry=d.outbox[o.id];if(!entry)return;entry.state='sent';entry.delivery='sent';entry.metaMessageId=meta.id;const c=d.channels.find(c=>c.slot===o.slot);c.lastOutboundAt=new Date(clock()).toISOString();const t=d.threads[o.threadId];const msg=t?.messages.find(m=>m.outboxId===o.id);if(msg){msg.delivery='sent';msg.id=meta.id;}});
      }catch(e){await store.change(d=>{const entry=d.outbox[o.id];if(!entry)return;entry.attempts++;entry.nextAt=clock()+Math.min(300000,1000*2**entry.attempts);if(entry.attempts>=7 || /abort|timeout|network|fetch failed/i.test(String(e.message||''))){entry.state='failed';entry.delivery='needs_review';const msg=d.threads[entry.threadId]?.messages.find(m=>m.outboxId===o.id);if(msg)msg.delivery='failed';}});}
    }
  }finally{pumping=false;}}
  const fileRoutes={'/':'index.html','/painel':'index.html','/app.css':'app.css','/app.js':'app.js'};
  async function router(req,res){const url=new URL(req.url||'/',`http://${req.headers.host||'localhost'}`),p=url.pathname;
    if(p==='/health'&&req.method==='GET')return json(res,200,{ok:true,service:'guto-bot-nativo',ready:false});
    if(p==='/webhooks/meta'&&req.method==='GET'){
      const ok=url.searchParams.get('hub.mode')==='subscribe'&&safeCompare(url.searchParams.get('hub.verify_token'),env.META_VERIFY_TOKEN);
      const challenge=url.searchParams.get('hub.challenge')||'';
      return ok&&/^\d{1,200}$/.test(challenge)?respond(res,200,challenge,{'content-type':'text/plain; charset=utf-8'}):json(res,403,{error:'Token de verificação inválido'});
    }
    if(p==='/webhooks/meta'&&req.method==='POST'){
      const raw=await readBody(req,1024*1024);
      if(!verifyMetaSignature(raw,req.headers['x-hub-signature-256'],env.META_APP_SECRET))return json(res,401,{error:'Assinatura Meta inválida'});
      let data;try{data=JSON.parse(raw.toString('utf8'));}catch{return json(res,400,{error:'JSON inválido'});}
      const applied=await receive(parseMetaWebhook(data));
      // Bloqueio deliberado: nenhuma IA de produção antes de validação e aprovação real.
      return json(res,200,{received:true,accepted:applied.length});
    }
    if(p==='/api/login'&&req.method==='POST'){
      if(!csrfSafe(req,appUrl))return json(res,403,{error:'Origem inválida'});
      if(!checkLoginRate(req))return json(res,429,{error:'Tentativas excedidas'});
      let body;try{body=JSON.parse((await readBody(req,2048)).toString('utf8'));}catch{return json(res,400,{error:'JSON inválido'});}
      if(!safeCompare(body.password,env.ADMIN_PASSWORD))return json(res,401,{error:'Credenciais inválidas'});
      const expires=clock()+8*60*60*1000,v=`admin:${expires}`;
      return json(res,200,{ok:true},{'set-cookie':`guto_sid=${v}.${sign(v,env.APP_SECRET)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800${appUrl.startsWith('https://')?'; Secure':''}`});
    }
    if(p==='/api/logout'&&req.method==='POST')return json(res,200,{ok:true},{'set-cookie':'guto_sid=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0'});
    if(p.startsWith('/api/')){
      if(!authed(req))return json(res,401,{error:'Login obrigatório'});
      if(!csrfSafe(req,appUrl))return json(res,403,{error:'Origem inválida'});
      if(p==='/api/status'&&req.method==='GET')return json(res,200,status());
      if(p==='/api/conversations'&&req.method==='GET'){
        const d=store.snapshot();const slot=Number(url.searchParams.get('slot')||0);
        const items=Object.values(d.threads).filter(t=>!slot||t.slot===slot).sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt))).map(userView);
        return json(res,200,{items});
      }
      if(p==='/api/thread'&&req.method==='GET'){
        const t=store.snapshot().threads[url.searchParams.get('id')||''];if(!t)return json(res,404,{error:'Conversa não encontrada'});
        return json(res,200,{thread:userView(t),messages:t.messages.map(serializeMessage),cart:getSummary(t.session,business)});
      }
      if(p==='/api/thread/read'&&req.method==='POST'){
        const v=JSON.parse((await readBody(req,1024)).toString());await store.change(d=>{if(d.threads[v.id])d.threads[v.id].unread=0;});return json(res,200,{ok:true});
      }
      if(p==='/api/thread/mode'&&req.method==='POST'){
        let v;try{v=JSON.parse((await readBody(req,2048)).toString());}catch{return json(res,400,{error:'JSON inválido'});}
        if(!['HUMAN','BOT'].includes(v.mode))return json(res,422,{error:'Modo inválido'});
        if(v.mode==='BOT')return json(res,409,{error:'IA bloqueada até homologação integral de dois números e PDV'});
        const ok=await store.change(d=>{const t=d.threads[v.id];if(!t)return false;t.mode='HUMAN';return true;});return json(res,ok?200:404,{ok});
      }
      if(p==='/api/reply'&&req.method==='POST'){
        let v;try{v=JSON.parse((await readBody(req,5000)).toString());}catch{return json(res,400,{error:'JSON inválido'});}
        if(typeof v.id!=='string'||typeof v.text!=='string'||v.text.trim().length<1||v.text.length>4000)return json(res,422,{error:'Mensagem inválida'});
        const message=await enqueueManual(v.id,v.text.trim());setImmediate(()=>pump());return json(res,202,{ok:true,outboxId:message.id,state:'queued'});
      }
      const verifyPath=p.match(/^\/api\/channels\/([12])\/verify$/);
      if(verifyPath&&req.method==='POST'){
        const slot=Number(verifyPath[1]),c=configuredChannels(store.snapshot()).find(x=>x.slot===slot);
        if(!c?.phoneId||!getToken(c,env))return json(res,409,{error:'Configure o número e credenciais primeiro'});
        let info;try{info=await checkMetaPhone({phoneId:c.phoneId,token:getToken(c,env),version,fetchImpl});}catch(e){return json(res,503,{error:e.message});}
        await store.change(d=>{const cc=d.channels.find(x=>x.slot===slot);cc.checkedAt=new Date(clock()).toISOString();cc.display=info.number;cc.phoneId=info.phoneId;});
        return json(res,200,{ok:true,apiVerified:true,info});
      }
      const configurePath=p.match(/^\/api\/channels\/([12])\/configure$/);
      if(configurePath&&req.method==='POST'){
        let v;try{v=JSON.parse((await readBody(req,10000)).toString());}catch{return json(res,400,{error:'JSON inválido'});}
        const slot=Number(configurePath[1]);if(!e164(v.phoneId)||!e164(v.wabaId)||typeof v.token!=='string'||v.token.length<20||v.token.length>4096)return json(res,422,{error:'IDs e token Meta válidos são obrigatórios'});
        try{await verifyPhoneInWaba({wabaId:v.wabaId,phoneId:v.phoneId,token:v.token,version,fetchImpl});await checkMetaPhone({phoneId:v.phoneId,token:v.token,version,fetchImpl});}catch(e){return json(res,503,{error:e.message});}
        if(configuredChannels(store.snapshot()).some(c=>c.slot!==slot&&c.phoneId===v.phoneId))return json(res,409,{error:'Número já cadastrado no outro canal'});
        await store.change(d=>{const c=d.channels.find(c=>c.slot===slot);c.phoneId=v.phoneId;c.wabaId=v.wabaId;c.tokenEncrypted=protectToken(v.token,env.APP_SECRET);c.checkedAt=new Date(clock()).toISOString();c.display='Verificado na API Meta';});
        return json(res,200,{ok:true,slot,notice:'API validada. Webhook e envio precisam de testes reais antes da produção.'});
      }
      if(p==='/api/meta/signup/complete'&&req.method==='POST'){
        if(!env.META_APP_ID||!env.META_CONFIG_ID)return json(res,409,{error:'Cadastro incorporado não configurado para este aplicativo Meta'});
        let v;try{v=JSON.parse((await readBody(req,10000)).toString());}catch{return json(res,400,{error:'JSON inválido'});}
        if(![1,2].includes(v.slot)||!e164(v.phoneId)||!e164(v.wabaId))return json(res,422,{error:'Dados de cadastro Meta inválidos'});
        let token;
        try{
          token=await exchangeSignupCode({code:v.code,appId:env.META_APP_ID,appSecret:env.META_APP_SECRET,version,fetchImpl});
          await verifyPhoneInWaba({wabaId:v.wabaId,phoneId:v.phoneId,token,version,fetchImpl});
          await checkMetaPhone({phoneId:v.phoneId,token,version,fetchImpl});
          await subscribeWaba({wabaId:v.wabaId,token,version,fetchImpl});
        }catch(e){return json(res,503,{error:`Cadastro oficial não concluído: ${e.message}`});}
        if(configuredChannels(store.snapshot()).some(c=>c.slot!==v.slot&&c.phoneId===v.phoneId))return json(res,409,{error:'Número já conectado no outro canal'});
        await store.change(d=>{const c=d.channels.find(x=>x.slot===v.slot);c.phoneId=v.phoneId;c.wabaId=v.wabaId;c.tokenEncrypted=protectToken(token,env.APP_SECRET);c.checkedAt=new Date(clock()).toISOString();c.display='Autorizado pela Meta';});
        return json(res,200,{ok:true,slot:v.slot,notice:'Autorização concluída; faltam teste real de webhook e envio e validação da elegibilidade do número.'});
      }
      if(p==='/api/ai/test'&&req.method==='POST'){
        if(!env.OPENAI_API_KEY)return json(res,409,{error:'Chave da IA não configurada no servidor'});
        try{const v=await testAIConnection({apiKey:env.OPENAI_API_KEY,model:env.OPENAI_MODEL||'gpt-4.1-mini'});await store.change(d=>{d.aiTest={ok:true,at:new Date(clock()).toISOString()};});return json(res,200,v);}catch(e){return json(res,503,{error:e.message});}
      }
      if(p==='/api/simulate'&&req.method==='POST'){
        let v;try{v=JSON.parse((await readBody(req,7000)).toString());}catch{return json(res,400,{error:'JSON inválido'});}
        if(typeof v.text!=='string'||!v.text.trim()||v.text.length>2000)return json(res,422,{error:'Mensagem inválida'});
        if(!env.OPENAI_API_KEY)return json(res,503,{error:'Modelo de IA real indisponível: configure OPENAI_API_KEY no servidor. Não há resposta simulada.'});
        let reply,summary,mode;
        await store.change(async d=>{const session=d.simulation||newSession();reply=await intelligentReply(v.text,session,business,{apiKey:env.OPENAI_API_KEY,model:env.OPENAI_MODEL||'gpt-4.1-mini'});session.history.push({role:'user',content:v.text},{role:'assistant',content:reply});session.history=session.history.slice(-30);d.simulation=session;summary=getSummary(session,business);mode=session.mode;});
        return json(res,200,{reply,summary,mode,demo:true});
      }
      if(p==='/api/simulate/reset'&&req.method==='POST'){await store.change(d=>{delete d.simulation;});return json(res,200,{ok:true});}
      if(p==='/api/settings'&&req.method==='GET'){const d=store.snapshot();return json(res,200,{pdv:d.settings.pdv,approval:{autoReply:false,production:false},meta:{appConfigured:Boolean(env.META_APP_ID&&env.META_CONFIG_ID),version,webhookUrl:appUrl?appUrl+'/webhooks/meta':null,verifyTokenConfigured:!!env.META_VERIFY_TOKEN},readiness:status()});}
      if(p==='/api/settings'&&req.method==='PUT'){
        let v;try{v=JSON.parse((await readBody(req,10000)).toString());}catch{return json(res,400,{error:'JSON inválido'});}
        let setting;try{setting=validatePdvSettings(v.pdv,{allowedHosts});}catch(e){return json(res,422,{error:e.message});}
        await store.change(d=>{d.settings.pdv=setting;d.settings.pdvTest=null;d.settings.autoReply=false;d.settings.approvedForProduction=false;});return json(res,200,{ok:true,pdv:setting,notice:'Configuração salva. Escrita no PDV e IA automática continuam bloqueadas.'});
      }
      if(p==='/api/pdv/test'&&req.method==='POST'){
        const d=store.snapshot();if(!d.settings.pdv.enabled)return json(res,409,{error:'Leitura do PDV desativada'});
        try{const result=await pdvReadStatus(d.settings.pdv,{allowedHosts,fetchImpl});await store.change(s=>{s.settings.pdvTest={ok:true,at:new Date(clock()).toISOString(),items:result.catalog.items.length,storeOpen:result.operation.open};});return json(res,200,{ok:true,items:result.catalog.items.length,store:result.operation});}catch(e){return json(res,503,{error:'PDV indisponível para consulta',reason:e.message});}
      }
      if(p==='/api/orders'&&req.method==='GET')return json(res,200,{items:store.snapshot().orders});
      return json(res,404,{error:'Rota não encontrada'});
    }
    if(req.method!=='GET'&&!['/','/painel'].includes(p))return json(res,405,{error:'Método não permitido'});
    const file=fileRoutes[p];if(!file)return json(res,404,{error:'Arquivo não encontrado'});
    const mime=file.endsWith('.js')?'text/javascript; charset=utf-8':file.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8';
    const headers={'content-type':mime,'content-security-policy':"default-src 'self'; connect-src 'self' https://graph.facebook.com; script-src 'self' https://connect.facebook.net; style-src 'self'; img-src 'self' data: https://*.fbcdn.net; frame-src https://*.facebook.com; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"};
    return respond(res,200,fs.readFileSync(path.join(STATIC,file)),headers);
  }
  const server=http.createServer((req,res)=>router(req,res).catch(e=>{if(!res.headersSent)json(res,e.status||500,{error:e.status?e.message:'Erro interno; consulte logs'});console.error('[Guto Nativo]',String(e.message||'Falha').slice(0,160));}));
  return {server,store,receive,pump,status,start:(port=Number(env.PORT||8080),host=env.HOST||'127.0.0.1')=>new Promise(resolve=>{server.listen(port,host,()=>{timer=setInterval(pump,2500);timer.unref();resolve(server.address());});}),stop:()=>new Promise(resolve=>{clearInterval(timer);server.close(()=>resolve());})};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(fs.existsSync(path.join(root,'.env'))&&typeof process.loadEnvFile==='function')process.loadEnvFile(path.join(root,'.env'));
  const app=createNativeServer();app.start().then(addr=>console.log(`Guto Bot próprio — ${addr.address}:${addr.port} | Meta API direta | Autoatendimento bloqueado até homologação`));
}
