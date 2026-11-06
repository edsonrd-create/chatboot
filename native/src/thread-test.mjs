/** Liberação temporária por conversa, sem ativar os outros WhatsApps. */
export const QA_WINDOW_MS=15*60*1000;
export function isThreadTestActive(thread,{now=Date.now(),slot=null,customer=null}={}){
 if(!thread||thread.mode!=='BOT'||!Number.isSafeInteger(thread.testReplyUntil))return false;
 if(thread.testReplyUntil<=now||thread.testReplyUntil>now+QA_WINDOW_MS)return false;
 if(slot!==null&&Number(thread.slot)!==Number(slot))return false;
 if(customer!==null&&String(thread.customer).replace(/\D/g,'')!==String(customer).replace(/\D/g,''))return false;
 return true;
}
export function enableThreadTest(thread,now=Date.now()){
 if(!thread||thread.via!=='qr')throw new Error('Apenas WhatsApp QR admite teste individual.');
 thread.mode='BOT';
 thread.testReplyUntil=now+QA_WINDOW_MS;
 if(thread.session)thread.session.mode='BOT';
 return thread.testReplyUntil;
}
export function clearThreadTest(thread){
 if(thread)delete thread.testReplyUntil;
}
