/** Verifica o registro REAL pelo identificador idempotente retornado pelo PDV. */
export async function reconcilePdvOrder(externalId,lookup){
 if(!/^[A-Za-z0-9:_-]{8,80}$/.test(String(externalId||''))||typeof lookup!=='function')return null;
 try{
  const response=await lookup([externalId]);
  if(!response?.ok||!Array.isArray(response.orders))return null;
  const found=response.orders.find(x=>x.externalId===externalId && Number.isSafeInteger(Number(x.number)) && Number(x.number)>0);
  if(!found)return null;
  return {ok:true,registered:true,recovered:true,number:Number(found.number),
    totalCents:Number(found.totalCents),paymentStatus:String(found.paymentStatus||'pending'),
    status:String(found.status||'new'),pixCopiaECola:null};
 }catch{return null;}
}
