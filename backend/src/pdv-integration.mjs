/** Integração Guto Express PDV: consulta somente leitura, sem API de pedidos homologada. */
const DEFAULT_HOST='pdvgutoexpress.com.br';
export const PDV_DEFAULTS=Object.freeze({enabled:false,baseUrl:`https://${DEFAULT_HOST}`,ordersMode:'DISABLED'});
export function validatePdvSettings(input,{allowedHosts=[DEFAULT_HOST]}={}){
  if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('Configuração do PDV inválida');
  const enabled=input.enabled===true;
  if(typeof input.enabled!=='boolean')throw new Error('Informe explicitamente se a consulta ao PDV está ativada');
  if(typeof input.baseUrl!=='string')throw new Error('Informe o domínio oficial do PDV');
  let u;try{u=new URL(input.baseUrl);}catch{throw new Error('URL do PDV inválida');}
  if(u.protocol!=='https:'||u.username||u.password||u.port||u.pathname!=='/'||u.search||u.hash||!allowedHosts.includes(u.hostname))
    throw new Error('PDV não autorizado: use apenas domínio HTTPS cadastrado na lista segura do servidor');
  if(input.ordersMode!=='DISABLED')throw new Error('Envio automático ao PDV bloqueado até API de pedidos ser validada');
  return {enabled,baseUrl:u.origin,ordersMode:'DISABLED'};
}
async function getJson(baseUrl,endpoint,{fetchImpl=fetch,timeoutMs=5500}={}){
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    const r=await fetchImpl(baseUrl+endpoint,{method:'GET',redirect:'error',signal:controller.signal,headers:{accept:'application/json'},cache:'no-store'});
    if(!r.ok)throw new Error(`PDV HTTP ${r.status}`);
    if(!String(r.headers?.get?.('content-type')||'').includes('application/json'))throw new Error('PDV retornou conteúdo inesperado');
    const raw=await r.text();if(raw.length>1048576)throw new Error('Resposta do PDV excede tamanho permitido');
    let result;try{result=JSON.parse(raw);}catch{throw new Error('PDV retornou JSON inválido');}
    if(!result||result.ok!==true)throw new Error('PDV não confirmou resposta válida');
    return result;
  }finally{clearTimeout(timer);}
}
export function normalizePdvMenu(response){
  if(!response||response.ok!==true||!Array.isArray(response.items))throw new Error('Formato do cardápio do PDV incompatível');
  if(response.items.length>2500)throw new Error('Cardápio excede limite');
  const items=response.items.map(x=>{
    if(!x||!Number.isSafeInteger(x.id)||x.id<=0||typeof x.name!=='string'||!['pizza','item'].includes(x.kind)||typeof x.inStock!=='boolean')throw new Error('Item do PDV inválido');
    const sizes=Array.isArray(x.sizes)?x.sizes.map(s=>{if(typeof s.label!=='string'||!Number.isSafeInteger(s.priceCents)||s.priceCents<0||s.priceCents>20000000)throw new Error('Tamanho/preço do PDV inválido');return {label:s.label.slice(0,70),priceCents:s.priceCents,maxFlavors:Number.isInteger(s.maxFlavors)?s.maxFlavors:null};}):[];
    if(!Number.isSafeInteger(x.priceCents)||x.priceCents<0||x.priceCents>20000000)throw new Error('Preço do PDV inválido');
    return {id:x.id,name:x.name.slice(0,130),description:String(x.description||'').slice(0,500),category:String(x.category||'').slice(0,90),kind:x.kind,inStock:x.inStock,priceCents:x.priceCents,promoPriceCents:Number.isSafeInteger(x.promoPriceCents)?x.promoPriceCents:null,comboPriceCents:Number.isSafeInteger(x.comboPriceCents)?x.comboPriceCents:null,sizes};
  });
  if(new Set(items.map(x=>x.id)).size!==items.length)throw new Error('Catálogo do PDV contém IDs duplicados');
  return {items,checkedAt:new Date().toISOString(),source:'PDV_GUTO_EXPRESS',readOnly:true};
}
export function normalizePdvStore(r){
  if(!r||r.ok!==true||typeof r.open!=='boolean'||typeof r.delivery!=='boolean'||typeof r.pickup!=='boolean')throw new Error('Resposta de funcionamento incompatível');
  return {open:r.open,delivery:r.delivery,pickup:r.pickup,name:String(r.name||'Guto Express').slice(0,120),checkedAt:new Date().toISOString()};
}
export async function pdvReadStatus(settings,opts={}){
  const s=validatePdvSettings(settings,opts);if(!s.enabled)throw new Error('Consulta ao PDV desativada pelo administrador');
  const [menu,store]=await Promise.all([getJson(s.baseUrl,'/api/v1/menu',opts),getJson(s.baseUrl,'/api/v1/store',opts)]);
  return {catalog:normalizePdvMenu(menu),operation:normalizePdvStore(store)};
}
export function buildReadiness({aiKeyConfigured=false,chatwootConfigured=false,liveEnabled=false,pdvTest=null}={}){
  const checklist=[
    {id:'ai',label:'Modelo de IA real com teste concluído',ok:false,details:aiKeyConfigured?'Chave presente; falta validação de diálogo real':'Chave não configurada'},
    {id:'channels',label:'Dois números WhatsApp testados',ok:false,details:chatwootConfigured?'Credenciais presentes; conexão real não homologada':'Conexão ausente'},
    {id:'pdv_read',label:'Leitura PDV validada',ok:Boolean(pdvTest?.ok&&pdvTest?.at),details:pdvTest?.ok?'Consulta de cardápio/loja validada no servidor':'Não comprovada'},
    {id:'pdv_orders',label:'Pedidos integrados ao PDV com idempotência',ok:false,details:'Sem endpoint de inclusão homologado; envio desativado'},
    {id:'acceptance',label:'Homologação de ponta a ponta aprovada',ok:false,details:'Pendente de teste real de dois números, orçamento e cozinha'}
  ];
  return {ready:false,liveEnabled,canAutoReply:false,canWritePdv:false,checklist,reason:'Homologação integral pendente; não liberar vendas automáticas'};
}