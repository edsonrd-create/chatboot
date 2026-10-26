/** Chatwoot API proxy: token is exclusively server-side. */
export function makeInboxClient({baseUrl='',apiToken='',accountId=0,allowedInboxIds=[],fetchImpl=fetch}){
 const allowed=new Set(allowedInboxIds.map(Number).filter(Number.isSafeInteger));
 const configured=Boolean(/^https:\/\//.test(baseUrl)&&apiToken&&Number.isSafeInteger(+accountId)&&+accountId>0&&allowed.size===2);
 function checkInbox(id){const n=Number(id);if(!Number.isSafeInteger(n)||!allowed.has(n))throw Object.assign(new Error('Canal WhatsApp não autorizado'),{status:403});return n;}
 function checkConversation(id){const n=Number(id);if(!Number.isSafeInteger(n)||n<=0)throw Object.assign(new Error('Conversa inválida'),{status:422});return n;}
 async function request(resource,{method='GET',body}={}){
  if(!configured)throw Object.assign(new Error('Chatwoot ainda não configurado'),{status:503});
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),10000);
  try{
   const r=await fetchImpl(`${baseUrl.replace(/\/$/,'')}/api/v1/accounts/${accountId}${resource}`,{method,signal:controller.signal,headers:{api_access_token:apiToken,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
   if(!r.ok)throw Object.assign(new Error(`Chatwoot HTTP ${r.status}`),{status:r.status===404?404:r.status===403?403:502});
   return r.json();
  }catch(e){if(e.name==='AbortError')throw Object.assign(new Error('Chatwoot não respondeu'),{status:504});throw e;}finally{clearTimeout(timeout);}
 }
 async function verifyChannelIds(){
  if(!configured)return [];
  const r=await request('/inboxes');
  const found=new Set((Array.isArray(r.payload)?r.payload:Array.isArray(r)?r:[]).map(x=>Number(x.id)));
  return [...allowed].map(id=>({id,found:found.has(id)}));
 }
 async function conversations(inboxId){
  const id=checkInbox(inboxId),r=await request(`/conversations?status=all&assignee_type=all&inbox_id=${id}&page=1`);
  const arr=Array.isArray(r.data?.payload)?r.data.payload:Array.isArray(r.payload)?r.payload:[];
  return arr.filter(c=>Number(c.inbox_id)===id).map(c=>({id:Number(c.id),inboxId:id,status:String(c.status||'open'),name:String(c.meta?.sender?.name||c.meta?.sender?.phone_number||c.contact?.name||'Cliente'),phone:String(c.meta?.sender?.phone_number||''),lastMessage:String(c.last_non_activity_message?.content||c.messages?.at(-1)?.content||''),unread:Number(c.unread_count||0),timestamp:c.last_activity_at||c.timestamp||null}));
 }
 async function conversation(inboxId,conversationId){
  const inbox=checkInbox(inboxId),id=checkConversation(conversationId);
  const c=await request(`/conversations/${id}`);
  if(Number(c.inbox_id)!==inbox)throw Object.assign(new Error('Conversa não pertence ao canal selecionado'),{status:403});return c;
 }
 async function messages(inboxId,conversationId){
  const c=await conversation(inboxId,conversationId),r=await request(`/conversations/${c.id}/messages`);
  return (Array.isArray(r.payload)?r.payload:[]).filter(m=>!m.private).map(m=>({id:m.id,content:String(m.content||''),type:m.message_type===1||m.message_type==='outgoing'?'outgoing':'incoming',timestamp:m.created_at||null,attachments:Array.isArray(m.attachments)?m.attachments.map(a=>({type:a.file_type||'file'})):[]}));
 }
 async function reply(inboxId,conversationId,content){
  const clean=String(content||'').trim();
  if(!clean||clean.length>2000)throw Object.assign(new Error('Mensagem inválida (máximo 2000 caracteres)'),{status:422});
  const c=await conversation(inboxId,conversationId);
  return request(`/conversations/${c.id}/messages`,{method:'POST',body:{content:clean,message_type:'outgoing',private:false}});
 }
 return {configured,allowedInboxIds:[...allowed],verifyChannelIds,conversations,conversation,messages,reply};
}
