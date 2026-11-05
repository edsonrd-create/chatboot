// Envio do pedido confirmado ao PDV (POST /api/v1/bot/order).
// O PDV recalcula preço, taxa e total e decide se grava (modo "active") ou só valida (modo "test").
// O bot NUNCA declara pagamento confirmado: o Pix só é dado como pago pela conciliação do PDV.
import {formatMoney,resetCartAfterOrder} from './core.mjs';
import {reconcilePdvOrder} from './pdv-reconcile.mjs';

const PAY = {PIX: 'pix', CARTAO: 'card', DINHEIRO: 'cash'};

export function buildPdvOrder(session, business, quote, requestId) {
  const sizeLabel = id => business.sizes.find(s => s.id === id)?.label || null;
  const flavorLabel = id => business.flavors.find(f => f.id === id)?.label || id;
  const items = quote.items.map(it => {
    if (it.kind === 'pizza') return {name: (it.flavors || []).map(flavorLabel).join(' / '), sizeLabel: sizeLabel(it.size), qty: it.quantity, notes: String(it.notes || '').slice(0, 200)};
    if (it.kind === 'drink') return {name: business.drinks.find(d => d.id === it.drinkId)?.label || it.description || it.drinkId, sizeLabel: null, qty: it.quantity, notes: ''};
    return {name: String(it.description || ''), sizeLabel: null, qty: it.quantity, notes: String(it.notes || '')};
  });
  return {
    externalId: `gutobot:${requestId}`,
    fulfillment: quote.fulfillment === 'PICKUP' ? 'pickup' : 'delivery',
    paymentMethod: PAY[quote.payment] || '',
    customerPhone: String(session.customerPhone || '').replace(/\D/g, ''),
    customerName: String(session.customerName || '').trim().slice(0, 80),
    address: quote.fulfillment === 'PICKUP' ? '' : String(quote.address || ''),
    neighborhood: String(session.neighborhood || ''),
    items,
    // A comanda recebe o valor entregue em dinheiro. O PDV recalcula o total;
    // a diferença final deve ser calculada a partir do total que o PDV confirmar.
    notes: quote.payment==='DINHEIRO'
      ? 'Pedido WhatsApp · Guto Bot · ' +
        (quote.cashChangeNeeded===false?'Sem troco':
          Number.isSafeInteger(quote.cashReceivedCents)?
            'Troco para '+formatMoney(quote.cashReceivedCents)+' · conferir total do PDV':'Troco pendente')
      : 'Pedido WhatsApp · Guto Bot',
  };
}

/** Mensagem ao cliente a partir da resposta do PDV. Nunca afirma pagamento aprovado. */
export function pdvOrderMessage(res, quote) {
  if (!res?.ok) return null;
  if (res.dryRun) return null; // modo teste: mantém a mensagem padrão de conferência
  const lines = [`Pedido nº ${res.number} registrado! 🍕`];
  const total = Number.isInteger(res.totalCents) ? res.totalCents : null;
  if (total !== null) lines.push(`Total: ${formatMoney(total)}${quote && total !== quote.totalCents ? ' (valor conferido pelo sistema da loja)' : ''}`);
  if(quote?.payment==='DINHEIRO'){
    if(quote.cashChangeNeeded===false)lines.push('Dinheiro: sem troco.');
    else if(quote.cashChangeNeeded===true&&Number.isSafeInteger(quote.cashReceivedCents)){
      lines.push('Dinheiro: troco para '+formatMoney(quote.cashReceivedCents)+'.');
      if(total!==null&&quote.cashReceivedCents>=total)
        lines.push('Troco calculado pelo total do PDV: '+formatMoney(quote.cashReceivedCents-total)+'.');
      else lines.push('O valor do troco precisa de conferência da equipe.');
    }
  }
  if (res.pixCopiaECola) lines.push('', 'Pague com Pix Copia e Cola (copie o código abaixo):', res.pixCopiaECola, '', 'Assim que o pagamento for confirmado pelo banco, seu pedido segue para a cozinha.');
  else if (quote?.payment === 'PIX') lines.push('O código Pix não foi gerado agora; um atendente vai te enviar.');
  return lines.join('\n');
}

export async function submitPdvOrder(session, business, confirmed) {
  if (session.lastCompletedRequestId===confirmed?.requestId)
    return {ok:true,alreadyProcessed:true,number:session.lastCompletedOrderNumber};
  if (typeof business.submitOrder !== 'function') {
    session.mode='HUMAN';session.reason='Integração com PDV não configurada';
    session.pdvOrder={at:new Date().toISOString(),ok:false,error:'PDV_ORDER_INTEGRATION_DISABLED'};
    return {ok:false,error:'PDV_ORDER_INTEGRATION_DISABLED'};
  }
  if (!session.customerNameConfirmed || !String(session.customerName||'').trim() || !confirmed.quote?.payment) {
    session.mode='HUMAN';session.reason='Nome ou pagamento não confirmado';
    return {ok:false,error:'INCOMPLETE_CUSTOMER_OR_PAYMENT'};
  }
  const body = buildPdvOrder(session, business, confirmed.quote, confirmed.requestId);
  if(!/^\d{10,13}$/.test(body.customerPhone) || !body.items.length ||
     body.items.some(i=>!i.qty||!i.name||!['string','object'].includes(typeof i.sizeLabel))){
    session.mode='HUMAN';session.reason='Dados incompletos para integração ao PDV';
    session.pdvOrder={at:new Date().toISOString(),ok:false,error:'ORDER_PAYLOAD_INVALID'};
    return {ok:false,error:'ORDER_PAYLOAD_INVALID'};
  }
  try {
    // Antes de enviar, confirmar se token e modo de operação do PDV respondem.
    // Nunca transformar 'test' em 'active' nem registrar em produção automaticamente.
    if(typeof business.pdvMode==='function'){
      const mode=await business.pdvMode();
      if(mode!=='test'&&mode!=='active'){
        session.pdvOrder={at:new Date().toISOString(),ok:false,error:'PDV_AUTH_OR_MODE_UNAVAILABLE'};
        session.mode='HUMAN';session.reason='Token inválido, integração desligada ou PDV sem modo autorizado';
        return {ok:false,error:'PDV_AUTH_OR_MODE_UNAVAILABLE'};
      }
    }
    // Simulador do painel nunca grava pedido real: só envia quando o PDV está em modo teste.
    if (session.simulation && (typeof business.pdvMode !== 'function' || await business.pdvMode() !== 'test')) {
      session.pdvOrder = {at: new Date().toISOString(), ok: false, error: 'Simulador só envia ao PDV em modo teste'};
      session.mode='HUMAN';session.reason='Simulador sem modo teste validado no PDV';
      return {ok:false,error:'SIMULATION_REQUIRES_TEST_MODE'};
    }
    let res;
    try{res=await business.submitOrder(body);}
    catch(e){res={ok:false,error:'PDV_NO_RESPONSE'};}
    if(!res?.dryRun && (!res?.ok || !Number.isSafeInteger(Number(res.number)) || Number(res.number)<1)){
      const recovered=await reconcilePdvOrder(body.externalId,business.orderStatus);
      if(recovered)res=recovered;
      else if(res?.ok)res={ok:false,error:'PDV_REGISTRATION_UNCONFIRMED'};
    }
    session.pdvOrder = {at: new Date().toISOString(), ok: !!res?.ok, dryRun: !!res?.dryRun, number: res?.number ?? null, totalCents: res?.totalCents ?? null, paymentStatus: res?.paymentStatus ?? null, error: res?.ok ? null : String(res?.error || 'erro').slice(0, 200)};
    session.pdvOrder.externalId = body.externalId;
    if(res?.ok && res?.dryRun){
      // Modo teste NÃO é pedido finalizado: preserve o carrinho para revisão.
      // O cliente pode solicitar "novo pedido" para iniciar outro teste sem repetir itens.
      session.lastDryRunRequestId=confirmed.requestId;
    }else if(res?.ok){
      session.orderRefs=[...new Set([...(session.orderRefs||[]),body.externalId])].slice(-5);
      resetCartAfterOrder(session,{requestId:confirmed.requestId,orderNumber:res.number??null});
    }
    if (!res?.ok) { session.mode = 'HUMAN'; session.reason = `PDV recusou o pedido: ${session.pdvOrder.error}`; }
    return res;
  } catch (e) {
    session.pdvOrder = {at: new Date().toISOString(), ok: false, error: String(e?.message || e).slice(0, 200)};
    session.mode = 'HUMAN'; session.reason = 'PDV indisponível ao registrar o pedido';
    return {ok: false, error: session.pdvOrder.error};
  }
}

export async function confirmationReply(session, business, out, fallback) {
  const res = await submitPdvOrder(session, business, out);
  if (res?.alreadyProcessed) return 'Esse pedido já foi processado; não vou enviá-lo novamente ao PDV.';
  if (res?.skipped) return 'Não consegui enviar a solicitação ao PDV. Vou chamar um atendente para verificar antes de confirmar.';
  if (!res?.ok) return '⚠️ Ainda não consegui confirmar o registro do pedido no PDV. Vou encaminhar para conferência de um atendente. Não repita as pizzas nem faça pagamento até confirmarmos o número do pedido.';
  if(res.dryRun)return 'Sua solicitação foi validada em *homologação*, mas não foi registrada como pedido no PDV nem enviada à cozinha. Um atendente pode conferir os dados.';
  return pdvOrderMessage(res, out.quote) || fallback;
}
