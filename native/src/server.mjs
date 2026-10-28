import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {JsonStore,safeCompare,protectToken,revealToken} from './storage.mjs';
import {verifyMetaSignature,parseMetaWebhook,checkMetaPhone,sendMetaText,exchangeSignupCode,verifyPhoneInWaba,subscribeWaba,graphVersion} from './meta.mjs';
import {newSession,getSummary} from './core.mjs';
import {intelligentReply,testAIConnection,describeAIError} from './ai.mjs';
import {validatePdvSettings,pdvReadStatus} from './pdv-integration.mjs';
import {createQrManager} from './wa-qr.mjs';
import {transcribeAudio,synthesizeVoice,shouldReplyWithVoice} from './voice.mjs';
import {channelConfig,setChannelConfig,listThreads,transition,threadInfo,operationalOverview,audit,stateOf} from './operations.mjs';

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
const userView=threadInfo;
const publicChannel=c=>({slot:c.slot,phoneId:c.phoneId,number:c.display,apiVerifiedAt:c.checkedAt,lastInboundAt:c.lastInboundAt,lastOutboundAt:c.lastOutboundAt,hasToken:Boolean(c.tokenEncrypted),status:c.checkedAt?'API_VERIFIED_NOT_END_TO_END':'NOT_VERIFIED'});
const serializeMessage=m=>({id:m.id,direction:m.direction,text:m.text,type:m.type,at:m.at,delivery:m.delivery||'',source:m.source||''});
const getToken=(c,env)=>c.tokenEncrypted?revealToken(c.tokenEncrypted,env.APP_SECRET):String(env[`META_TOKEN_${c.slot}`]||'');

export function createNativeServer({env=process.env,fetchImpl=globalThis.fetch,dataFile,clock=()=>Date.now()}={}){
  // Homologação pode iniciar sem credenciais Meta; webhooks ficam desligados até configurá-las.
  // Não gerar ou simular segredos Meta, números conectados nem mensagens reais.
  // Em FREE_PREVIEW_MODE, liberar apenas prévia anônima e IMUTÁVEL; nunca credenciais reais.
  const freePreview=String(env.FREE_PREVIEW_MODE||'').toLowerCase()==='true';
  if(!freePreview && (!env.ADMIN_PASSWORD||env.ADMIN_PASSWORD.length<12||!env.APP_SECRET||env.APP_SECRET.length<32)){throw new Error('ADMIN_PASSWORD (12+) e APP_SECRET (32+) são exigidos.');}
  const appUrl=String(env.APP_PUBLIC_URL||env.RENDER_EXTERNAL_URL||'');
  if(!freePreview && env.NODE_ENV==='production' && (!/^https:\/\/[^/]+$/.test(appUrl)||!env.DATA_FILE&&!dataFile))throw new Error('Produção exige APP_PUBLIC_URL ou RENDER_EXTERNAL_URL HTTPS e armazenamento persistente.');
  const statePath=dataFile||path.resolve(root,env.DATA_FILE||'data/state.json');
  // Sem leitura de dados locais durante prévia: nenhum cliente real pode ser exposto.
  const store=freePreview?new JsonStore(statePath):new JsonStore(statePath,{databaseUrl:String(env.DATABASE_URL||''),log:x=>console.log(x)}).init();
  const allowedHosts=String(env.PDV_ALLOWED_HOSTS||'pdvgutoexpress.com.br').split(',').map(x=>x.trim()).filter(Boolean);
  const attempts=new Map();
  let pumping=false;
  let timer;
  const business=JSON.parse(fs.readFileSync(path.join(root,'config','business.json'),'utf8'));
  const version=graphVersion(env.META_GRAPH_VERSION);
  // Seleção explícita do provedor; chave NUNCA é devolvida ao navegador.
  const aiProvider=String(env.AI_PROVIDER||(env.GEMINI_API_KEY?'gemini':'openai')).trim().toLowerCase();
  if(!['gemini','openai'].includes(aiProvider))throw new Error('AI_PROVIDER deve ser gemini ou openai.');
  // ===== WhatsApp por QR Code (Baileys, canal NÃO oficial; ative com WA_QR_ENABLED=true) =====
const qrEnabled=!freePreview&&String(env.WA_QR_ENABLED||'').toLowerCase()==='true';
const qrAutoReply=String(env.WA_QR_AUTOREPLY||'').toLowerCase()==='true';
// Homologação: se WA_QR_TEST_NUMBERS tiver números (ex.: 5541999990000,5541988887777), a IA só responde a eles.
const qrTestNumbers=String(env.WA_QR_TEST_NUMBERS||'').split(',').map(x=>x.replace(/\D/g,'')).filter(Boolean);
const qrVoiceEnabled=String(env.WA_QR_VOICE||'true').toLowerCase()!=='false';
const qrAllowed=from=>!qrTestNumbers.length||qrTestNumbers.includes(String(from).replace(/\D/g,''));
let qr=null;
async function onQrIncoming(m){
const tid=`qr${m.slot}:${m.from}`;
// 1) Áudio do cliente → texto (fora do lock do armazenamento; pode levar alguns segundos).
let text=m.text||'',transcribed=false,audioError='';
if(m.type==='audio'){
  if(m.audio?.buffer&&aiCfg.provider==='gemini'&&aiCfg.apiKey){
    try{text=await transcribeAudio({apiKey:aiCfg.apiKey,model:aiCfg.model,fetchImpl},m.audio.buffer,m.audio.mimeType);transcribed=Boolean(text);}
    catch(e){audioError=String(e.message||e).slice(0,100);console.error('[QR áudio]',audioError);}
  }else audioError=m.audio?.buffer?'Transcrição exige Gemini configurado':'Áudio não baixado';
}
const shown=m.type==='audio'?(transcribed?`🎤 ${text}`:'🎤 [áudio não transcrito — ouvir no celular]'):(text||`[${m.type}: encaminhar ao atendente]`);
let session=null,canReply=false;
await store.change(d=>{
const now=new Date(clock()).toISOString();
const t=d.threads[tid]||{id:tid,slot:m.slot,via:'qr',jid:m.jid,customer:m.from,customerName:m.name||m.from,mode:qrAutoReply&&qrAllowed(m.from)?'BOT':'HUMAN',unread:0,updatedAt:'',messages:[],session:newSession(),orders:[]};
t.via='qr';t.jid=m.jid;if(m.name)t.customerName=m.name;
if(t.messages.some(x=>x.id===m.id))return;
append(t,{id:m.id,direction:'incoming',text:shown,type:m.type,at:now,delivery:'received',source:transcribed?'WhatsApp QR · áudio transcrito':'WhatsApp QR'});
t.unread=(t.unread||0)+1;t.lastInboundAt=now;d.threads[tid]=t;
canReply=qrAutoReply&&qrAllowed(m.from)&&t.mode==='BOT'&&Boolean(text)&&Boolean(aiCfg.apiKey);
if(canReply)session=structuredClone(t.session);
});
if(!canReply)return;
// 2) IA responde (texto é o padrão).
const voice=qrVoiceEnabled&&aiCfg.provider==='gemini';
await qr.presence(m.slot,m.jid,m.type==='audio'&&voice?'recording':'composing');
let reply='';
try{reply=await intelligentReply(text,session,business,aiCfg);}
catch(e){console.error('[QR IA]',String(e.message||e).slice(0,160));await qr.presence(m.slot,m.jid,'paused');return;}
session.history.push({role:'user',content:text},{role:'assistant',content:reply});session.history=session.history.slice(-30);
// 3) Voz só quando necessário: cliente mandou áudio ou pediu áudio, e a resposta não tem valores/resumo.
let sent=null,asVoice=false;
if(voice&&shouldReplyWithVoice({incomingType:m.type,incomingText:text,reply})){
  try{const ogg=await synthesizeVoice({apiKey:aiCfg.apiKey,ttsModel:env.GEMINI_TTS_MODEL||'gemini-2.5-flash-preview-tts',voice:env.GEMINI_TTS_VOICE||'Kore',fetchImpl},reply);sent=await qr.sendVoice(m.slot,m.jid,ogg);asVoice=true;}
  catch(e){console.error('[QR voz] enviando como texto:',String(e.message||e).slice(0,120));}
}
try{if(!sent)sent=await qr.send(m.slot,m.jid,reply);}
catch(e){console.error('[QR envio]',String(e.message||e).slice(0,160));return;}
finally{await qr.presence(m.slot,m.jid,'paused');}
await store.change(d=>{const t=d.threads[tid];if(!t)return;t.session=session;if(session.mode==='HUMAN')t.mode='HUMAN';append(t,{id:sent.id||crypto.randomUUID(),direction:'outgoing',type:asVoice?'audio':'text',text:asVoice?`🔊 ${reply}`:reply,at:new Date(clock()).toISOString(),delivery:'sent',source:asVoice?'IA · voz':'IA'});});
}
if(qrEnabled){qr=createQrManager({authDir:path.join(path.dirname(statePath),'wa-auth'),onIncoming:onQrIncoming,log:x=>console.log(x)});setTimeout(()=>qr.resume(),1500);}
const aiCfg=aiProvider==='gemini'

    ?{provider:'gemini',apiKey:env.GEMINI_API_KEY||'',model:env.GEMINI_MODEL||'gemini-3.5-flash-lite'}
    :{provider:'openai',apiKey:env.OPENAI_API_KEY||'',model:env.OPENAI_MODEL||'gpt-4.1-mini'};
  const configuredChannels=d=>d.channels.map(c=>{const phoneId=c.phoneId||String(env[`META_PHONE_ID_${c.slot}`]||'');return {...c,phoneId};});
  // Conversas fictícias, somente para revisão do layout; nunca números telefônicos reais.
  const sampleMessages=[
    {id:'demo-a-1',direction:'incoming',text:'Boa noite! Quero uma grande metade calabresa, metade frango com catupiry.',type:'text',at:'2026-10-26T18:00:00.000Z',delivery:'received',source:'EXEMPLO FICTÍCIO'},
    {id:'demo-a-2',direction:'outgoing',text:'Exemplo de resposta: prefere entrega ou retirada? Este ambiente não envia mensagens.',type:'text',at:'2026-10-26T18:01:00.000Z',delivery:'demo',source:'EXEMPLO FICTÍCIO'},
  ];
  const demoThreads=[
    {id:'demo:1',slot:1,customer:'CLIENTE-FICTICIO-01',customerName:'Exemplo fictício · Ana',mode:'HUMAN',unread:0,updatedAt:'2026-10-26T18:01:00.000Z',messages:sampleMessages},
    {id:'demo:2',slot:2,customer:'CLIENTE-FICTICIO-02',customerName:'Exemplo fictício · Bruno',mode:'HUMAN',unread:0,updatedAt:'2026-10-26T18:02:00.000Z',messages:[{id:'demo-b-1',direction:'incoming',text:'Quais são as opções de pizza gigante? É para retirar no balcão.',type:'text',at:'2026-10-26T18:02:00.000Z',delivery:'received',source:'EXEMPLO FICTÍCIO'}]},
  ];
  const previewStatus=()=>({mode:'PREVIA_PUBLICA',ready:false,autoReplyEnabled:false,reason:'Prévia visual somente leitura; nenhum WhatsApp ou PDV conectado',hosting:{freePreview:true,ephemeralData:true,customerMessagingDisabled:true,readOnly:true},channels:[1,2].map(slot=>({slot,phoneId:'',number:'Não conectado',apiVerifiedAt:null,lastInboundAt:null,lastOutboundAt:null,hasToken:false,status:'NOT_VERIFIED'})),ai:{configured:false,model:'',realTest:false,testAt:null},pdv:{enabled:false,baseUrl:'https://pdvgutoexpress.com.br',ordersMode:'DISABLED',lastTest:null},integration:{provider:'META_CLOUD_API_DIRECT',chatwoot:false,qr:'META_OFFICIAL_ONBOARDING_ONLY'},stats:{conversations:2,messages:3,pendingOrders:0},oauth:{available:false,appId:null,configId:null}});
  const status=()=>{const d=store.snapshot();const channels=configuredChannels(d);return {mode:'HOMOLOGACAO',ready:false,autoReplyEnabled:false,reason:'Liberação integral pendente: prova real de 2 números, PDV e IA',hosting:{freePreview,ephemeralData:freePreview,customerMessagingDisabled:freePreview},channels:channels.map(c=>({...publicChannel(c),hasToken:Boolean(c.tokenEncrypted||env[`META_TOKEN_${c.slot}`])})),ai:{configured:Boolean(aiCfg.apiKey),model:aiCfg.model,provider:aiCfg.provider,realTest:Boolean(d.aiTest?.ok&&d.aiTest?.provider===aiCfg.provider&&d.aiTest?.model===aiCfg.model),testAt:d.aiTest?.at||null},pdv:{...d.settings.pdv,lastTest:d.settings.pdvTest||null},integration:{provider:'META_CLOUD_API_DIRECT',chatwoot:false,qr:'META_OFFICIAL_ONBOARDING_ONLY'},stats:{conversations:Object.keys(d.threads).length,messages:Object.values(d.threads).reduce((n,t)=>n+t.messages.length,0),pendingOrders:d.orders.filter(o=>o.status==='PENDING_STAFF_REVIEW').length},oauth:{available:Boolean(env.META_APP_ID&&env.META_CONFIG_ID),appId:env.META_APP_ID||null,configId:env.META_CONFIG_ID||null}};};
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
        t.unread=(t.unread||0)+1;t.lastInboundAt=new Date(clock()).toISOString();
        if(stateOf(t)==='CLOSED'){t.operationalState='WAITING';t.version=(t.version||0)+1;audit(d,{actor:'system',action:'THREAD_REOPENED_BY_MESSAGE',slot:t.slot,clock});}
        d.threads[tid]=t;stored.lastInboundAt=new Date(clock()).toISOString();applied.push({id:evt.id,threadId:tid});
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
      }catch(e){await store.change(d=>{const entry=d.outbox[o.id];if(!entry)return;entry.attempts++;entry.nextAt=clock()+Math.min(300000,1000*2**entry.attempts);if(entry.attempts>=7 || /abort|timeout|network|fetch failed|HTTP 5\d\d|HTTP 429/i.test(String(e.message||''))){entry.state='failed';entry.delivery='needs_review';const msg=d.threads[entry.threadId]?.messages.find(m=>m.outboxId===o.id);if(msg)msg.delivery='failed';}});}
    }
  }finally{pumping=false;}}
  const fileRoutes={'/':'index.html','/painel':'index.html','/whatsapp':'index.html','/app.css':'app.css','/app.js':'app.js','/privacidade':'privacidade.html','/privacidade.html':'privacidade.html','/logo.png':'logo.png','/favicon.png':'favicon.png'};
  async function router(req,res){const url=new URL(req.url||'/',`http://${req.headers.host||'localhost'}`),p=url.pathname;
    if(p==='/health'&&req.method==='GET')return json(res,200,{ok:true,service:'guto-bot-nativo',ready:false,freePreview});
    // A prévia Free atende somente GETs seguros; todos os POSTs/PUTs são bloqueados sem exceção.
    if(freePreview && p.startsWith('/api/')){
      if(req.method!=='GET')return json(res,403,{error:'Prévia gratuita: somente visualização. Operações, login e conexões reais desativados.'});
      if(p==='/api/status')return json(res,200,previewStatus());
      if(p==='/api/operations/overview'){
        const fake={threads:Object.fromEntries(demoThreads.map(t=>[t.id,t]))};
        return json(res,200,{...operationalOverview(fake),preview:true,readOnly:true});
      }
      if(p==='/api/operations/channels')return json(res,200,{items:[channelConfig({},1),channelConfig({},2)],readOnly:true});
      if(p==='/api/operations/audit')return json(res,200,{items:[],readOnly:true});
      if(p==='/api/conversations'){
        const slot=Number(url.searchParams.get('slot')||0);
        return json(res,200,{items:demoThreads.filter(t=>!slot||t.slot===slot).map(userView)});
      }
      if(p==='/api/thread'){
        const demo=demoThreads.find(t=>t.id===url.searchParams.get('id'));
        return demo?json(res,200,{thread:userView(demo),messages:demo.messages.map(serializeMessage),cart:{items:[],missing:['Ambiente apenas visual']}}):json(res,404,{error:'Conversa não encontrada na demonstração'});
      }
      if(p==='/api/orders')return json(res,200,{items:[]});
      if(p==='/api/settings')return json(res,200,{pdv:previewStatus().pdv,approval:{autoReply:false,production:false},meta:{appConfigured:false,version,webhookUrl:null,verifyTokenConfigured:false},readiness:previewStatus()});
      return json(res,404,{error:'Rota não disponível na prévia pública'});
    }
    if(p==='/webhooks/meta'&&req.method==='GET'){
      if(freePreview)return json(res,503,{error:'Prévia gratuita: WhatsApp real desativado porque o armazenamento é temporário'});
      if(!env.META_APP_SECRET||!env.META_VERIFY_TOKEN)return json(res,503,{error:'Webhook Meta não configurado para homologação'});
      const ok=url.searchParams.get('hub.mode')==='subscribe'&&safeCompare(url.searchParams.get('hub.verify_token'),env.META_VERIFY_TOKEN);
      const challenge=url.searchParams.get('hub.challenge')||'';
      return ok&&/^\d{1,200}$/.test(challenge)?respond(res,200,challenge,{'content-type':'text/plain; charset=utf-8'}):json(res,403,{error:'Token de verificação inválido'});
    }
    if(p==='/webhooks/meta'&&req.method==='POST'){
      if(freePreview)return json(res,503,{error:'Prévia gratuita: WhatsApp real desativado porque o armazenamento é temporário'});
      if(!env.META_APP_SECRET||!env.META_VERIFY_TOKEN)return json(res,503,{error:'Webhook Meta não configurado para homologação'});
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
      if(freePreview && (/^\/api\/channels\/[12]\/(configure|verify)$/.test(p)||['/api/reply','/api/meta/signup/complete','/api/ai/test','/api/simulate','/api/pdv/test'].includes(p)))return json(res,409,{error:'Prévia gratuita: conexão, envio e IA pagos bloqueados; armazenamento temporário.'});
      if(p==='/api/qr/status'&&req.method==='GET')return json(res,200,{enabled:qrEnabled,autoReply:qrAutoReply,voice:qrVoiceEnabled,testNumbersOnly:qrTestNumbers.length>0,slots:qr?[qr.status(1),qr.status(2)]:[]});
const qrPath=p.match(/^\/api\/qr\/([12])\/(start|logout)$/);
if(qrPath&&req.method==='POST'){if(!qr)return json(res,409,{error:'Conexão por QR desativada no servidor (WA_QR_ENABLED=true).'});const slot=Number(qrPath[1]);try{return json(res,200,qrPath[2]==='start'?await qr.start(slot):await qr.logout(slot));}catch(e){return json(res,503,{error:'Falha no WhatsApp QR: '+String(e.message||e).slice(0,140)});}}
if(p==='/api/status'&&req.method==='GET')return json(res,200,status());
      if(p==='/api/operations/overview'&&req.method==='GET'){
        return json(res,200,operationalOverview(store.snapshot()));
      }
      if(p==='/api/operations/channels'&&req.method==='GET'){
        const d=store.snapshot();
        return json(res,200,{items:[channelConfig(d,1),channelConfig(d,2)],readOnly:false});
      }
      const opsChannel=p.match(/^\/api\/operations\/channels\/([12])$/);
      if(opsChannel&&req.method==='PUT'){
        let cfg;try{cfg=JSON.parse((await readBody(req,7000)).toString());}catch{return json(res,400,{error:'JSON inválido'});}
        let updated;
        try{await store.change(d=>{updated=setChannelConfig(d,Number(opsChannel[1]),cfg,{clock,actor:'admin'});});}
        catch(e){return json(res,e.status||422,{error:e.message});}
        return json(res,200,{ok:true,channel:updated,notice:'Preferências salvas por número. IA automática continua DESATIVADA.'});
      }
      if(p==='/api/operations/thread/action'&&req.method==='POST'){
        let input;try{input=JSON.parse((await readBody(req,3500)).toString());}catch{return json(res,400,{error:'JSON inválido'});}
        let item;
        try{await store.change(d=>{item=transition(d,{id:input.id,action:input.action,expectedVersion:input.expectedVersion,clock,actor:'admin'});});}
        catch(e){return json(res,e.status||422,{error:e.message});}
        return json(res,200,{ok:true,thread:item,autoReplyEnabled:false});
      }
      if(p==='/api/operations/audit'&&req.method==='GET'){
        const d=store.snapshot();
        return json(res,200,{items:(d.auditLog||[]).slice(-100).reverse(),revision:d.revision||0});
      }
      if(p==='/api/operations/events'&&req.method==='GET'){
        res.writeHead(200,{'content-type':'text/event-stream; charset=utf-8','cache-control':'no-cache, no-transform','connection':'keep-alive','x-content-type-options':'nosniff','x-accel-buffering':'no'});
        const emitRevision=revision=>{if(!res.destroyed)res.write('event: revision\ndata: '+JSON.stringify({revision})+'\n\n');};
        res.write('retry: 5000\n\n');
        emitRevision(store.snapshot().revision||0);
        const unsubscribe=store.subscribe(emitRevision);
        const heartbeat=setInterval(()=>{if(!res.destroyed)res.write(': heartbeat\n\n');},20000);
        heartbeat.unref?.();
        req.once('close',()=>{unsubscribe();clearInterval(heartbeat);});
        return;
      }
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
        let changed;
        try{await store.change(d=>{changed=transition(d,{id:v.id,action:'takeover',clock,actor:'admin'});});}
        catch(e){return json(res,e.status||422,{error:e.message});}
        return json(res,200,{ok:true,thread:changed});
      }
      if(p==='/api/reply'&&req.method==='POST'){
        let v;try{v=JSON.parse((await readBody(req,5000)).toString());}catch{return json(res,400,{error:'JSON inválido'});}
        if(typeof v.id!=='string'||typeof v.text!=='string'||v.text.trim().length<1||v.text.length>4000)return json(res,422,{error:'Mensagem inválida'});
const qt=store.snapshot().threads[v.id];
if(qt?.via==='qr'){if(!qr)return json(res,409,{error:'Conexão por QR desativada'});if(qt.mode!=='HUMAN')return json(res,409,{error:'Assuma a conversa antes de enviar'});try{const r=await qr.send(qt.slot,qt.jid,v.text.trim());await store.change(d=>{const t=d.threads[v.id];if(t)append(t,{id:r.id||crypto.randomUUID(),direction:'outgoing',type:'text',text:v.text.trim(),at:new Date(clock()).toISOString(),delivery:'sent',source:'Atendente'});});return json(res,202,{ok:true,state:'sent'});}catch(e){return json(res,e.status||503,{error:String(e.message||e).slice(0,140)});}}
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
        if(!aiCfg.apiKey)return json(res,409,{error:'Chave da IA não configurada no servidor'});
        try{const v=await testAIConnection(aiCfg);await store.change(d=>{d.aiTest={ok:true,provider:aiCfg.provider,model:aiCfg.model,at:new Date(clock()).toISOString()};});return json(res,200,v);}
        catch(e){const fault=describeAIError(e,aiCfg.provider),errorId=crypto.randomUUID().replaceAll('-','').slice(0,12);console.error('[GutoBot AI]',JSON.stringify({errorId,code:fault.code,status:fault.status,operation:'test'}));return json(res,fault.status,{error:fault.error,code:fault.code,errorId,provider:aiCfg.provider});}
      }
      if(p==='/api/simulate'&&req.method==='POST'){
        let v;try{v=JSON.parse((await readBody(req,7000)).toString());}catch{return json(res,400,{error:'JSON inválido'});}
        if(typeof v.text!=='string'||!v.text.trim()||v.text.length>2000)return json(res,422,{error:'Mensagem inválida'});
        if(!aiCfg.apiKey)return json(res,503,{error:`Modelo de IA indisponível: configure ${aiCfg.provider==='gemini'?'GEMINI_API_KEY':'OPENAI_API_KEY'} no servidor. Não há resposta simulada.`});
        try{
          let reply,summary,mode;
          await store.change(async d=>{const session=d.simulation||newSession();reply=await intelligentReply(v.text,session,business,aiCfg);session.history.push({role:'user',content:v.text},{role:'assistant',content:reply});session.history=session.history.slice(-30);d.simulation=session;summary=getSummary(session,business);mode=session.mode;});
          return json(res,200,{reply,summary,mode,demo:true,provider:aiCfg.provider});
        }catch(e){
          const fault=describeAIError(e,aiCfg.provider),errorId=crypto.randomUUID().replaceAll('-','').slice(0,12);
          console.error('[GutoBot AI]',JSON.stringify({errorId,code:fault.code,status:fault.status,operation:'simulate'}));
          return json(res,fault.status,{error:fault.error,code:fault.code,errorId,provider:aiCfg.provider});
        }
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
    if(req.method!=='GET')return json(res,405,{error:'Método não permitido'});
    const file=fileRoutes[p];if(!file)return json(res,404,{error:'Arquivo não encontrado'});
    const mime=file.endsWith('.png')?'image/png':file.endsWith('.js')?'text/javascript; charset=utf-8':file.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8';
    const headers={'content-type':mime,'content-security-policy':"default-src 'self'; connect-src 'self' https://graph.facebook.com; script-src 'self' https://connect.facebook.net; style-src 'self'; img-src 'self' data: https://*.fbcdn.net; frame-src https://*.facebook.com; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"};
    return respond(res,200,fs.readFileSync(path.join(STATIC,file)),headers);
  }
  const server=http.createServer((req,res)=>router(req,res).catch(e=>{if(!res.headersSent)json(res,e.status||500,{error:e.status?e.message:'Erro interno; consulte logs'});console.error('[Guto Nativo]',String(e.message||'Falha').slice(0,160));}));
  return {server,store,receive,pump,status,start:(port=Number(env.PORT||8080),host=env.HOST||'127.0.0.1')=>store.ready().then(()=>new Promise(resolve=>{server.listen(port,host,()=>{timer=setInterval(pump,2500);timer.unref();resolve(server.address());});})),stop:()=>new Promise(resolve=>{clearInterval(timer);server.close(()=>resolve());})};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(fs.existsSync(path.join(root,'.env'))&&typeof process.loadEnvFile==='function')process.loadEnvFile(path.join(root,'.env'));
  const app=createNativeServer();app.start().then(addr=>console.log(`Guto Bot próprio — ${addr.address}:${addr.port} | Meta API direta | Autoatendimento bloqueado até homologação`));
}
