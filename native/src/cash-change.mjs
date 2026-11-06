import {getSummary,formatMoney} from './core.mjs';

/** Valor em reais informado pelo cliente; valores monetários permanecem inteiros em centavos. */
export function parseCashAmount(value){
  if(typeof value!=='string')return null;
  const t=value.trim().toLowerCase().replace(/^troco\s+(?:para|de)\s+/,'').replace(/^para\s+/,'').replace(/^r\$\s*/,'').replace(/\s*reais?$/,'').trim();
  if(!t)return null;
  let normalized;
  if(/^\d{1,3}(?:\.\d{3})+\,\d{2}$/.test(t))normalized=t.replace(/\./g,'').replace(',','.');
  else if(/^\d{1,5}[,.]\d{2}$/.test(t))normalized=t.replace(',','.');
  else if(/^\d{1,5}$/.test(t))normalized=t+'.00';
  else return null;
  const parts=normalized.split('.');
  const cents=Number(parts[0])*100+Number(parts[1]);
  return Number.isSafeInteger(cents)&&cents>0&&cents<=1000000?cents:null;
}
export function setCashChange(session,needChange,receivedCents=null,business=null){
  if(session.payment!=='DINHEIRO')return {ok:false,error:'Troco só se aplica a pagamento em dinheiro.'};
  if(typeof needChange!=='boolean')return {ok:false,error:'Informe se precisa de troco.'};
  if(needChange){
    if(receivedCents!==null && (!Number.isSafeInteger(receivedCents)||receivedCents<1))
      return {ok:false,error:'Informe um valor válido em reais.'};
    const total=business?getSummary(session,business).totalCents:null;
    if(Number.isSafeInteger(total)&&Number.isSafeInteger(receivedCents)&&receivedCents<total)
      return {ok:false,error:'O valor informado é menor que o total '+formatMoney(total)+'. Para quanto precisa de troco?'};
  }
  session.cashChangeNeeded=needChange;
  session.cashReceivedCents=needChange?receivedCents:null;
  session.awaitingConfirmation=false;
  session.quotePresented=false;
  session.quoteSnapshot=null;
  session.confirmedRequestId=null;
  return {ok:true,cashChangeNeeded:needChange,cashReceivedCents:session.cashReceivedCents};
}
export function consumeCashAnswer(session,text,business){
  if(session.payment!=='DINHEIRO'||!session.checkoutRequested||!session.cart?.length)return null;
  const t=String(text||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim().replace(/[.!?]+$/,'');
  if(session.cashChangeNeeded===null||session.cashChangeNeeded===undefined){
    if(/^(nao|nao precisa|sem troco|valor exato|certinho)$/.test(t)){
      setCashChange(session,false);
      return {ok:true,completed:true};
    }
    if(/^(sim|preciso|precisa|sim preciso|com troco)$/.test(t)){
      setCashChange(session,true);
      return {ok:true,completed:false,message:'Claro! 😊 O total é '+formatMoney(getSummary(session,business).totalCents)+'. *Troco para quanto?*'};
    }
    const amount=parseCashAmount(t);
    if(amount!==null){
      const result=setCashChange(session,true,amount,business);
      return result.ok?{ok:true,completed:true}:result;
    }
    return {ok:false,error:'Combinado! 😊 Você vai precisar de troco? Responda *sim* ou *não*.'};
  }
  if(session.cashChangeNeeded===true&&session.cashReceivedCents===null){
    const amount=parseCashAmount(t);
    if(amount===null)return {ok:false,error:'Para quanto você precisa de troco? Pode informar, por exemplo, *R$ 100,00*.'};
    const result=setCashChange(session,true,amount,business);
    return result.ok?{ok:true,completed:true}:result;
  }
  return null;
}
