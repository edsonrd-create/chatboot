/** Consultas de pedidos próprios: falha fechada, sem credenciais expostas ao modelo. */
export async function readMyPdvOrders(config, trustedPhone, orderNumber=null, fetchImpl=fetch) {
  if(config.PDV_OPERATIONS_READ_ENABLED!=='true')
    return {ok:false,error:'PDV_OPERATIONS_DISABLED'};
  if(typeof trustedPhone!=='string'||!/^\+55\d{10,11}$/.test(trustedPhone))
    return {ok:false,error:'WHATSAPP_IDENTITY_REQUIRED'};
  if(orderNumber!==null&&(!Number.isSafeInteger(orderNumber)||orderNumber<=0))
    return {ok:false,error:'INVALID_ORDER_NUMBER'};
  const endpoint=config.PDV_OPERATIONS_API_URL;
  const token=config.PDV_OPERATIONS_READ_TOKEN;
  if(typeof endpoint!=='string'||typeof token!=='string'||token.length<32)
    return {ok:false,error:'PDV_OPERATIONS_NOT_CONFIGURED'};
  let url;
  try {
    url=new URL(endpoint);
    if(url.protocol!=='https:'||url.pathname!=='/api/v1/bot-operations'||url.username||url.password)
      throw Error('INVALID_ENDPOINT');
  } catch { return {ok:false,error:'PDV_OPERATIONS_INVALID_ENDPOINT'}; }
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),7000);
  try {
    const response=await fetchImpl(url.toString(),{
      method:'POST',signal:controller.signal,
      headers:{authorization:'Bearer '+token,accept:'application/json','content-type':'application/json'},
      body:JSON.stringify({action:'my_orders',phone:trustedPhone,orderNumber}),
    });
    if(!response.ok)return {ok:false,error:'PDV_HTTP_'+response.status};
    const data=await response.json();
    if(data?.ok!==true||!Array.isArray(data.orders))throw Error('INVALID_PAYLOAD');
    const orders=data.orders.slice(0,5).map(o=>({
      number:Number(o.number),status:String(o.status||'unknown').slice(0,45),
      channel:String(o.channel||'pdv').slice(0,35),
      fulfillment:String(o.fulfillment||'').slice(0,30),
      etaAt:o.etaAt?String(o.etaAt):null,
      dispatchedAt:o.dispatchedAt?String(o.dispatchedAt):null,
      deliveredAt:o.deliveredAt?String(o.deliveredAt):null,
    })).filter(o=>Number.isSafeInteger(o.number)&&o.number>0);
    return {ok:true,source:'pdv',orders};
  } catch {
    return {ok:false,error:'PDV_OPERATIONS_UNAVAILABLE'};
  } finally {clearTimeout(timer);}
}

/** Painel administrativo separado da IA dos clientes. Retorna apenas dados agregados.
 * A autenticação do funcionário deve ocorrer antes de chamar esta função.
 */
export async function readPdvOperationsSummary(config,fetchImpl=fetch){
  if(config.PDV_OPERATIONS_READ_ENABLED!=='true')return {ok:false,error:'PDV_OPERATIONS_DISABLED'};
  if(!config.PDV_OPERATIONS_API_URL?.startsWith('https://')||!config.PDV_OPERATIONS_READ_TOKEN||config.PDV_OPERATIONS_READ_TOKEN.length<32)
    return {ok:false,error:'PDV_OPERATIONS_NOT_CONFIGURED'};
  const url=new URL(config.PDV_OPERATIONS_API_URL);
  if(url.pathname!=='/api/v1/bot-operations')return {ok:false,error:'PDV_OPERATIONS_INVALID_ENDPOINT'};
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),7000);
  try{
    const response=await fetchImpl(url.toString(),{method:'POST',signal:controller.signal,
      headers:{authorization:'Bearer '+config.PDV_OPERATIONS_READ_TOKEN,'content-type':'application/json'},
      body:JSON.stringify({action:'operations_summary'})});
    if(!response.ok)return {ok:false,error:'PDV_HTTP_'+response.status};
    const data=await response.json();
    if(data?.ok!==true||!Array.isArray(data.orders)||!Array.isArray(data.deliveries))
      return {ok:false,error:'PDV_OPERATIONS_INVALID_RESPONSE'};
    return {ok:true,source:'pdv',period:'24h',
      orders:data.orders.slice(0,100),deliveries:data.deliveries.slice(0,30)};
  }catch{return {ok:false,error:'PDV_OPERATIONS_UNAVAILABLE'};}
  finally{clearTimeout(timer);}
}

/** Consulta cadastro mínimo do próprio número WhatsApp, sem expor endereços.
 * Nome cadastrado é uma sugestão que o cliente ainda precisa confirmar.
 */
export async function readRegisteredPdvCustomer(config,trustedPhone,fetchImpl=fetch){
  if(config.PDV_OPERATIONS_READ_ENABLED!=='true')
    return {ok:false,error:'PDV_OPERATIONS_DISABLED'};
  if(typeof trustedPhone!=='string'||!/^\+55\d{10,11}$/.test(trustedPhone))
    return {ok:false,error:'WHATSAPP_IDENTITY_REQUIRED'};
  if(!config.PDV_OPERATIONS_API_URL?.startsWith('https://')||
     !config.PDV_OPERATIONS_READ_TOKEN||config.PDV_OPERATIONS_READ_TOKEN.length<32)
    return {ok:false,error:'PDV_OPERATIONS_NOT_CONFIGURED'};
  const url=new URL(config.PDV_OPERATIONS_API_URL);
  if(url.pathname!=='/api/v1/bot-operations'||url.username||url.password)
    return {ok:false,error:'PDV_OPERATIONS_INVALID_ENDPOINT'};
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),7000);
  try{
    const response=await fetchImpl(url.toString(),{method:'POST',signal:controller.signal,
      headers:{authorization:'Bearer '+config.PDV_OPERATIONS_READ_TOKEN,
        'content-type':'application/json'},
      body:JSON.stringify({action:'customer_profile',phone:trustedPhone})});
    if(!response.ok)return {ok:false,error:'PDV_HTTP_'+response.status};
    const data=await response.json();
    if(data?.ok!==true)return {ok:false,error:'PDV_OPERATIONS_INVALID_RESPONSE'};
    if(data.ambiguous)return {ok:true,found:false,ambiguous:true};
    const name=typeof data.name==='string'?data.name.trim().slice(0,80):'';
    return {ok:true,found:data.found===true&&name.length>=2,
      name:data.found===true&&name.length>=2?name:null,
      blocked:data.blocked===true};
  }catch{return {ok:false,error:'PDV_OPERATIONS_UNAVAILABLE'};}
  finally{clearTimeout(timer);}
}
