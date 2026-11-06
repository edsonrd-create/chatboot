import crypto from 'node:crypto';

export function verifyMetaSignature(raw,signature,appSecret){
  if(!Buffer.isBuffer(raw)||typeof signature!=='string'||!/^sha256=[a-f0-9]{64}$/i.test(signature)||!appSecret)return false;
  const expected=crypto.createHmac('sha256',appSecret).update(raw).digest();
  const received=Buffer.from(signature.slice(7),'hex');
  return received.length===expected.length && crypto.timingSafeEqual(expected,received);
}

const digits = value => typeof value==='string' && /^\d{5,25}$/.test(value);
export function parseMetaWebhook(payload){
  if(!payload||payload.object!=='whatsapp_business_account'||!Array.isArray(payload.entry))return [];
  const events=[];
  for(const entry of payload.entry.slice(0,30))for(const change of (entry.changes||[]).slice(0,30)){
    const v=change?.value||{};
    const phoneId=String(v.metadata?.phone_number_id||'');
    if(!digits(phoneId))continue;
    const contactNames=new Map((v.contacts||[]).map(c=>[String(c.wa_id||''),String(c.profile?.name||'').slice(0,100)]));
    for(const m of (v.messages||[]).slice(0,100)){
      if(!digits(String(m.from||''))||typeof m.id!=='string')continue;
      events.push({kind:'incoming',phoneId,id:m.id,from:m.from,customerName:contactNames.get(String(m.from))||'',timestamp:Number(m.timestamp)||0,type:String(m.type||'unknown'),text:m.type==='text'?String(m.text?.body||'').slice(0,4000):'',mediaId:typeof m[m.type]?.id==='string'?m[m.type].id:null});
    }
    for(const s of (v.statuses||[]).slice(0,100)){
      if(typeof s.id==='string'&&typeof s.status==='string') events.push({kind:'status',phoneId,id:s.id,status:s.status,recipient:String(s.recipient_id||''),timestamp:Number(s.timestamp)||0});
    }
    // Coexistence echo is informational; never feed it to the AI as a customer message.
    for(const echo of (v.message_echoes||[]).slice(0,100)){
      if(echo?.id)events.push({kind:'echo',phoneId,id:String(echo.id),to:String(echo.to||''),text:String(echo.text?.body||'').slice(0,4000)});
    }
  }
  return events;
}

export function graphVersion(v){return /^v\d{1,2}\.\d$/.test(v||'')?v:'v25.0';}
async function graphCall(path,{token,version='v25.0',method='GET',body,fetchImpl=fetch,timeoutMs=9000}={}){
  if(!token||typeof token!=='string'||token.length>4096||/[\r\n]/.test(token))throw new Error('Token Meta ausente ou formato não permitido');
  const ctrl=new AbortController();const id=setTimeout(()=>ctrl.abort(),timeoutMs);
  try{
    const r=await fetchImpl(`https://graph.facebook.com/${graphVersion(version)}/${path}`,{
      method,redirect:'error',signal:ctrl.signal,headers:{authorization:`Bearer ${token}`,'content-type':'application/json',accept:'application/json'},...(body?{body:JSON.stringify(body)}:{})
    });
    const raw=(await r.text()).slice(0,24000);
    let parsed={};try{parsed=JSON.parse(raw);}catch{}
    if(!r.ok)throw new Error(`Meta Graph HTTP ${r.status}: ${String(parsed?.error?.message||'Falha externa').slice(0,160)}`);
    return parsed;
  } finally {clearTimeout(id);}
}
export async function checkMetaPhone({phoneId,token,version,fetchImpl}){
  if(!digits(phoneId))throw new Error('Phone number ID inválido');
  const info=await graphCall(`${phoneId}?fields=id,display_phone_number,verified_name,quality_rating`,{token,version,fetchImpl});
  if(String(info.id)!==phoneId)throw new Error('Meta retornou outro número');
  return {phoneId,number:String(info.display_phone_number||''),name:String(info.verified_name||''),quality:String(info.quality_rating||'')};
}
export async function sendMetaText({phoneId,to,text,token,version,fetchImpl}){
  if(!digits(phoneId)||!digits(to)||typeof text!=='string'||!text.trim()||text.length>4096)throw new Error('Mensagem Meta inválida');
  const response=await graphCall(`${phoneId}/messages`,{token,version,fetchImpl,method:'POST',body:{messaging_product:'whatsapp',recipient_type:'individual',to,type:'text',text:{preview_url:false,body:text}}});
  const mid=String(response?.messages?.[0]?.id||'');
  if(!mid)throw new Error('Meta não confirmou identificador da mensagem');
  return {id:mid};
}
export async function exchangeSignupCode({code,appId,appSecret,version,fetchImpl=fetch}){
  if(!/^[\w-]{6,800}$/.test(code||'')||!digits(appId)||!appSecret)throw new Error('Credenciais de cadastro incorporado inválidas');
  const url=new URL(`https://graph.facebook.com/${graphVersion(version)}/oauth/access_token`);
  url.searchParams.set('client_id',appId);url.searchParams.set('client_secret',appSecret);url.searchParams.set('code',code);
  const ctrl=new AbortController();const t=setTimeout(()=>ctrl.abort(),9000);
  try{const r=await fetchImpl(url.toString(),{signal:ctrl.signal,redirect:'error'});const data=await r.json();if(!r.ok||!data.access_token)throw new Error('Meta não autorizou este cadastro');return data.access_token;}finally{clearTimeout(t);}
}
export async function verifyPhoneInWaba({wabaId,phoneId,token,version,fetchImpl}){
  if(!digits(wabaId)||!digits(phoneId))throw new Error('Identificadores Meta inválidos');
  const data=await graphCall(`${wabaId}/phone_numbers?fields=id,display_phone_number&limit=100`,{token,version,fetchImpl});
  if(!Array.isArray(data.data)||!data.data.some(p=>String(p.id)===phoneId))throw new Error('Número não pertence à conta autorizada');
  return true;
}
export async function subscribeWaba({wabaId,token,version,fetchImpl}){
  if(!digits(wabaId))throw new Error('WABA inválida');
  const data=await graphCall(`${wabaId}/subscribed_apps`,{token,version,fetchImpl,method:'POST'});
  if(data.success!==true && data.success!=='true')throw new Error('Meta não confirmou webhook para WABA');
  return true;
}
