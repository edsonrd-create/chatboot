/** Pré-validação de um pedido confirmado: usa exclusivamente modo de teste do PDV.
 * Não cria pedido nem pagamento. Ativação comercial é outro fluxo, proibido aqui.
 */
export function buildPdvDryRunPayload(confirmation,session,business){
  const quote=confirmation?.quote;
  if(!confirmation?.requestId||!quote||quote.missing?.length||!Array.isArray(quote.items)||!quote.items.length)
    return {ok:false,error:'QUOTE_INCOMPLETE'};
  if(!session.customerName||!session.customerPhone)return {ok:false,error:'CUSTOMER_REQUIRED'};
  const paymentMethod={PIX:'pix',CARTAO:'card',DINHEIRO:'cash'}[session.payment];
  if(!paymentMethod)return {ok:false,error:'PAYMENT_REQUIRED'};
  if(quote.fulfillment!=='PICKUP' && (!session.address||!session.neighborhood))
    return {ok:false,error:'DELIVERY_NEIGHBORHOOD_REQUIRED'};
  const items=[];
  for(const item of quote.items){
    if(!Number.isSafeInteger(item.quantity)||item.quantity<1||item.quantity>20
       ||!Number.isSafeInteger(item.unitPriceCents))return {ok:false,error:'ITEM_UNQUOTED'};
    const size= item.kind==='pizza' ? business.sizes.find(s=>s.id===item.size) : null;
    if(item.kind==='pizza'&&!size)return {ok:false,error:'INVALID_SIZE'};
    if(!['pizza','drink'].includes(item.kind))return {ok:false,error:'UNSUPPORTED_ITEM'};
    items.push({
      name:String(item.description??'').slice(0,160),
      sizeLabel:size?size.label:null,
      qty:item.quantity,
      notes:Array.isArray(item.notes)?item.notes.join('; ').slice(0,200):'',
      extras:[],
    });
  }
  return {ok:true,payload:{
    externalId:'WA-'+String(confirmation.requestId).replace(/-/g,''),
    fulfillment:quote.fulfillment==='PICKUP'?'pickup':'delivery',
    paymentMethod,
    customerName:session.customerName,
    customerPhone:session.customerPhone,
    address:quote.fulfillment==='PICKUP'?'':session.address,
    neighborhood:quote.fulfillment==='PICKUP'?'':session.neighborhood,
    items,
  }};
}
export async function previewPdvOrder(config,confirmation,session,business,fetchImpl=fetch){
  if(config.PDV_BOT_ORDER_TEST_ENABLED!=='true')return {ok:false,error:'DRY_RUN_DISABLED'};
  const draft=buildPdvDryRunPayload(confirmation,session,business);
  if(!draft.ok)return draft;
  const token=config.PDV_BOT_ORDER_TOKEN;
  if(typeof token!=='string'||token.length<24)return {ok:false,error:'BOT_TOKEN_MISSING'};
  let url;
  try{
    url=new URL(config.PDV_BOT_ORDER_API_URL);
    if(url.protocol!=='https:'||url.pathname!=='/api/v1/bot/order'||url.username||url.password)throw Error('INVALID_ENDPOINT');
  }catch{return {ok:false,error:'INVALID_ENDPOINT'};}
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),9000);
  try{
    const response=await fetchImpl(url.toString(),{method:'POST',signal:controller.signal,
      headers:{authorization:'Bearer '+token,'content-type':'application/json'},
      body:JSON.stringify(draft.payload)});
    if(!response.ok)return {ok:false,error:'PDV_HTTP_'+response.status};
    const result=await response.json();
    // A resposta de modo ativo não é aceita por este adaptador.
    if(result?.ok!==true||result.dryRun!==true||result.mode!=='test')
      return {ok:false,error:'PDV_NOT_IN_TEST_MODE'};
    return {ok:true,dryRun:true,externalId:draft.payload.externalId};
  }catch{return {ok:false,error:'PDV_DRY_RUN_UNAVAILABLE'};}
  finally{clearTimeout(timer);}
}
