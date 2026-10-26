import crypto from 'node:crypto';

export function verifyChatwootSignature(body, timestamp, signature, secret, nowSeconds = Math.floor(Date.now()/1000)) {
  if (!secret || !/^[0-9]{10,}$/.test(String(timestamp ?? '')) || !/^sha256=[a-f0-9]{64}$/i.test(String(signature ?? ''))) return false;
  if (Math.abs(nowSeconds - Number(timestamp)) > 300) return false;
  const expected = `sha256=${crypto.createHmac('sha256', secret).update(`${timestamp}.`).update(body).digest('hex')}`;
  const a=Buffer.from(expected);const b=Buffer.from(signature.toLowerCase());
  return a.length === b.length && crypto.timingSafeEqual(a,b);
}

export function normalizeEvent(event, configuredInboxes=[], configuredAccount=null) {
  if (event?.event !== 'message_created' || !['incoming', 0].includes(event.message_type) || event.private === true) return null;
  if (typeof event.content !== 'string' || event.content.trim().length === 0 || event.content.length > 5000) return null;
  const inboxId=Number(event.inbox?.id ?? event.conversation?.inbox_id);
  const conversationId=Number(event.conversation?.id);
  const accountId=Number(event.account?.id ?? event.conversation?.account_id);
  const messageId=String(event.id || '');
  if (![inboxId,conversationId,accountId].every(n=>Number.isSafeInteger(n)&&n>0) || !messageId || !/^\d+$/.test(messageId)) return null;
  if (!configuredInboxes.includes(inboxId) || (configuredAccount && accountId !== configuredAccount)) return null;
  return {inboxId,conversationId,accountId,messageId,content:event.content.trim(),sender: String(event.sender?.name || 'Cliente').slice(0,80),key:`${accountId}:${inboxId}:${conversationId}`,eventKey:`${accountId}:${messageId}`};
}

export const newSession = ()=>({mode:'BOT',cart:[],address:null,payment:null,fulfillment:'DELIVERY',awaitingConfirmation:false,quotePresented:false,quoteSnapshot:null,confirmedRequestId:null,history:[]});
function invalidateQuote(session){session.awaitingConfirmation=false;session.quotePresented=false;session.quoteSnapshot=null;session.confirmedRequestId=null;}
export function quoteFingerprint(quote){return JSON.stringify({items:quote.items.map(x=>({id:x.id,quantity:x.quantity,kind:x.kind,size:x.size,flavors:x.flavors,notes:x.notes,unitPriceCents:x.unitPriceCents})),address:quote.address,payment:quote.payment,fulfillment:quote.fulfillment,subtotalCents:quote.subtotalCents,deliveryFeeCents:quote.deliveryFeeCents,totalCents:quote.totalCents});}
export function extractText(response) {
  if (typeof response?.output_text === 'string') return response.output_text.trim();
  return (response?.output||[]).filter(x=>x.type==='message').flatMap(x=>x.content||[]).filter(x=>x.type==='output_text').map(x=>x.text).join('\n').trim();
}

export function availableCatalog(business) {
  return {
    sizes: business.sizes,
    flavors: business.flavors.filter(x=>x.available),
    drinks: business.drinks.filter(x=>x.available),
    pricesConfigured: Object.values(business.pizzas||{}).some(prices=>Object.values(prices).some(Number.isInteger)),
    halfHalfPricing: business.halfHalfPricing,
    deliveryFeeConfigured: Number.isInteger(business.deliveryFeeCents)
  };
}

export function addPizza(session, business, {size,flavors,quantity=1}) {
  if (!Array.isArray(flavors) || ![1,2].includes(flavors.length)) return {ok:false,error:'Escolha um ou dois sabores.'};
  const s=business.sizes.find(x=>x.id===size);
  if (!s) return {ok:false,error:'Tamanho indisponível.'};
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 10) return {ok:false,error:'Quantidade inválida.'};
  const distinct=[...new Set(flavors)];if(distinct.length !== flavors.length)return {ok:false,error:'Sabores repetidos.'};
  for(const flavor of flavors) if (!business.flavors.some(x=>x.id===flavor && x.available))return {ok:false,error:'Sabor indisponível.'};
  const prices=flavors.map(f=>business.pizzas[f]?.[size]);
  let priceCents=null;
  if (prices.every(p=>Number.isSafeInteger(p)&&p>=0)) {
    if (prices.length === 1) priceCents=prices[0];
    else if (business.halfHalfPricing === 'MAX') priceCents=Math.max(...prices);
    else if (business.halfHalfPricing === 'AVERAGE') priceCents=Math.round((prices[0]+prices[1])/2);
  }
  const labels=flavors.map(f=>business.flavors.find(x=>x.id===f).label);
  const item={id:crypto.randomUUID(),kind:'pizza',size,flavors,description:`Pizza ${s.label} (${s.slices} fatias), ${labels.join(' + ')}`,quantity,unitPriceCents:priceCents};
  session.cart.push(item);invalidateQuote(session);
  return {ok:true,item,requiresPriceValidation:priceCents===null};
}
/** Altera sabor sem criar nova pizza; exige identificação inequívoca. */
export function replaceFlavor(session,business,{fromFlavorId,toFlavorId}){
 if(!business.flavors.some(f=>f.id===toFlavorId&&f.available))return {ok:false,error:'Novo sabor não disponível.'};
 const matches=session.cart.filter(x=>x.kind==='pizza'&&x.flavors.includes(fromFlavorId));
 if(matches.length!==1)return {ok:false,error:matches.length?'Há várias pizzas com esse sabor; informe qual deseja alterar.':'Não encontrei esse sabor no carrinho.'};
 const pizza=matches[0];if(pizza.quantity!==1)return {ok:false,error:'Este item representa várias pizzas; informe qual unidade deseja alterar para não modificar todas.'};if(pizza.flavors.includes(toFlavorId))return {ok:false,error:'Esse sabor já está na pizza.'};
 pizza.flavors=pizza.flavors.map(f=>f===fromFlavorId?toFlavorId:f);const size=business.sizes.find(s=>s.id===pizza.size);pizza.description=`Pizza ${size.label} (${size.slices} fatias), ${pizza.flavors.map(id=>business.flavors.find(f=>f.id===id).label).join(' + ')}`;pizza.unitPriceCents=null;invalidateQuote(session);
 return {ok:true,item:pizza,quoteMustBeRefreshed:true};
}
/** Troca sabor de uma única pizza quando uma linha do carrinho tem quantidade > 1.
 *  Evita modificar todas as unidades por engano ("troca uma das duas"). */
export function replaceFlavorOneUnit(session,business,{itemId,fromFlavorId,toFlavorId}){
  const item=session.cart.find(x=>x.id===itemId&&x.kind==='pizza');
  if(!item)return {ok:false,error:'Pizza não localizada. Consulte o resumo para identificar o item.'};
  if(!Number.isSafeInteger(item.quantity)||item.quantity<2)return {ok:false,error:'Esta linha não contém mais de uma unidade; utilize substituição normal.'};
  if(!item.flavors.includes(fromFlavorId))return {ok:false,error:'O sabor anterior não pertence à pizza escolhida.'};
  const newFlavor=business.flavors.find(f=>f.id===toFlavorId&&f.available);
  if(!newFlavor||item.flavors.includes(toFlavorId))return {ok:false,error:'Novo sabor inválido ou repetido.'};
  item.quantity--;
  const single={...item,id:crypto.randomUUID(),quantity:1,flavors:item.flavors.map(f=>f===fromFlavorId?toFlavorId:f),unitPriceCents:null};
  const size=business.sizes.find(s=>s.id===item.size);
  single.description=`Pizza ${size.label} (${size.slices} fatias), ${single.flavors.map(id=>business.flavors.find(f=>f.id===id).label).join(' + ')}`;
  session.cart.splice(session.cart.indexOf(item)+1,0,single);
  invalidateQuote(session);
  return {ok:true,item:single,remainingOriginal:item.quantity,quoteMustBeRefreshed:true};
}
/** Exige ID de item, evita excluir a pizza errada em pedidos com várias unidades. */
export function removeCartItem(session,{itemId}){
 const n=session.cart.findIndex(x=>x.id===itemId);if(n<0)return {ok:false,error:'Item não localizado no carrinho; consulte o resumo.'};
 const [item]=session.cart.splice(n,1);invalidateQuote(session);return {ok:true,removed:item};
}
export function addCartNote(session,{itemId,note}){
 if(typeof note!=='string'||note.length<2||note.length>150)return {ok:false,error:'Observação inválida.'};
 const item=session.cart.find(x=>x.id===itemId&&x.kind==='pizza');if(!item)return {ok:false,error:'Pizza não localizada.'};
 if(!item.notes)item.notes=[];if(!item.notes.includes(note.trim()))item.notes.push(note.trim());
 invalidateQuote(session);return {ok:true,item,requiresKitchenReview:true};
}
export function addDrink(session,business,{drinkId,quantity=1}) {
  const drink=business.drinks.find(x=>x.id===drinkId && x.available);
  if(!drink)return {ok:false,error:'Bebida não disponível.'};
  if(!Number.isSafeInteger(quantity)||quantity<1||quantity>10)return {ok:false,error:'Quantidade inválida.'};
  const item={id:crypto.randomUUID(),kind:'drink',drinkId,description:drink.label,quantity,unitPriceCents:Number.isSafeInteger(drink.priceCents)?drink.priceCents:null};
  session.cart.push(item);invalidateQuote(session);
  return {ok:true,item};
}
export function getSummary(session,business) {
  // Recalcular sempre da fonte atual evita finalizar preços antigos quando o cardápio muda.
  const items=session.cart.map(item=>{
    if(item.kind==='pizza'){
      const size=business.sizes.find(s=>s.id===item.size);
      const flavors=(item.flavors||[]).map(id=>business.flavors.find(f=>f.id===id && f.available));
      const prices=flavors.map(f=>f && business.pizzas?.[f.id]?.[item.size]);
      const valid=size && flavors.every(Boolean) && prices.every(p=>Number.isSafeInteger(p)&&p>=0);
      const unitPriceCents=valid?(prices.length===1?prices[0]:business.halfHalfPricing==='MAX'?Math.max(...prices):business.halfHalfPricing==='AVERAGE'?Math.round((prices[0]+prices[1])/2):null):null;
      const description=size?`Pizza ${size.label} (${size.slices} fatias), ${flavors.map((f,i)=>f?.label||`Sabor indisponível (${item.flavors[i]})`).join(' + ')}`:item.description;
      return {...item,description,unitPriceCents};
    }
    if(item.kind==='drink'){
      const drink=business.drinks.find(d=>d.id===item.drinkId&&d.available);
      return {...item,unitPriceCents:drink&&Number.isSafeInteger(drink.priceCents)?drink.priceCents:null};
    }
    return {...item,unitPriceCents:null};
  });
  const subtotalKnown=items.length>0 && items.every(x=>Number.isSafeInteger(x.unitPriceCents));
  const subtotalCents=subtotalKnown?items.reduce((sum,x)=>sum+x.quantity*x.unitPriceCents,0):null;
  const fulfillment=session.fulfillment||'DELIVERY';
  const deliveryFeeCents=fulfillment==='PICKUP'?0:Number.isSafeInteger(business.deliveryFeeCents) && session.address?business.deliveryFeeCents:null;
  const totalCents=subtotalCents!==null && deliveryFeeCents!==null?subtotalCents+deliveryFeeCents:null;
  return {items,subtotalCents,deliveryFeeCents,totalCents,fulfillment,address:fulfillment==='PICKUP'?null:session.address,payment:session.payment,missing:[...(items.length?[]:['itens']),...(fulfillment==='PICKUP'||session.address?[]:['endereço']),...(session.payment?[]:['pagamento']),...(subtotalCents===null?['preços válidos']:[]),...(deliveryFeeCents===null?['taxa de entrega validada']:[])]};
}

/** Modalidade explícita, sem presumir entrega quando o cliente escolheu retirada. */
export function setFulfillment(session,{method}){
  if(!['DELIVERY','PICKUP'].includes(method))return {ok:false,error:'Selecione entrega ou retirada.'};
  session.fulfillment=method;
  if(method==='PICKUP')session.address=null;
  invalidateQuote(session);
  return {ok:true,fulfillment:method};
}
export function setAddress(session,{address}) {
  if(typeof address!=='string'||address.trim().length<12 || address.length>500)return {ok:false,error:'Solicite endereço completo com rua, número, bairro e cidade.'};
  session.address=address.trim();session.fulfillment='DELIVERY';invalidateQuote(session);return {ok:true,address:session.address};
}
export function setPayment(session,{method}){
  if(!['PIX','CARTAO','DINHEIRO'].includes(method))return {ok:false,error:'Forma de pagamento inválida.'};
  session.payment=method;invalidateQuote(session);return {ok:true,payment:method};
}
export function requestConfirmation(session,business){
  const quote=getSummary(session,business);
  if(quote.missing.length)return {ok:false,error:'Não é possível apresentar total final ou confirmar pedido; pendências: '+quote.missing.join(', ')+'.',quote};
  session.awaitingConfirmation=true;session.quoteSnapshot=quoteFingerprint(quote);return {ok:true,quote};
}
export function confirmRequest(session,business,{explicitConfirmation}){
  if(session.confirmedRequestId)return {ok:true,alreadyConfirmed:true,requestId:session.confirmedRequestId};
  if(explicitConfirmation!==true || !session.awaitingConfirmation || !session.quotePresented)return {ok:false,error:'É necessário apresentar o resumo ao cliente e receber uma confirmação explícita em mensagem posterior.'};
  const quote=getSummary(session,business);
  if(quote.missing.length || quoteFingerprint(quote)!==session.quoteSnapshot)return {ok:false,error:'Orçamento incompleto ou alterado; gere um novo resumo para o cliente.',quote};
  const requestId=crypto.randomUUID();session.confirmedRequestId=requestId;session.awaitingConfirmation=false;
  return {ok:true,requestId,quote,status:'PENDING_STAFF_REVIEW',note:'Solicitação para conferência humana: ainda não foi enviada à cozinha nem registrada como pedido confirmado.'};
}
export function formatMoney(cents){return Number.isInteger(cents)?new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(cents/100):'a confirmar';}

/** Catálogo informativo: preços publicados NÃO substituem cotação do backend. */
export function publicMenuKnowledge(business){
 return {source:business.catalogSource?.source||null,sizes:business.sizes,flavors:(business.flavors||[]).filter(f=>f.available).map(f=>({id:f.id,name:f.label,category:f.category,ingredients:f.ingredients,startingPriceCents:f.startingPriceCents,priceType:f.priceType})),combos:(business.combos||[]).map(c=>({id:c.id,name:c.label,description:c.description,publishedPriceCents:c.publishedPriceCents,restrictions:c.restrictions,autoCheckoutEnabled:false})),drinks:business.drinks.map(d=>({id:d.id,name:d.label,publishedPriceCents:d.priceCents})),policy:'Valores publicados podem mudar e não autorizam checkout. Pizzas e combos só podem ser cotados quando preços exatos do tamanho, condições e taxa de entrega estiverem validados.'};
}
