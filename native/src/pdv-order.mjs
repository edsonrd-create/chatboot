// Envio do pedido confirmado ao PDV (POST /api/v1/bot/order).
// O PDV recalcula preço, taxa e total e decide se grava (modo "active") ou só valida (modo "test").
// O bot NUNCA declara pagamento confirmado: o Pix só é dado como pago pela conciliação do PDV.
import {formatMoney} from './core.mjs';

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
    customerName: String(session.customerName || '').trim().slice(0, 80) || 'Cliente WhatsApp',
    address: quote.fulfillment === 'PICKUP' ? '' : String(quote.address || ''),
    neighborhood: String(session.neighborhood || ''),
    items,
    notes: 'Pedido WhatsApp · Guto Bot',
  };
}

/** Mensagem ao cliente a partir da resposta do PDV. Nunca afirma pagamento aprovado. */
export function pdvOrderMessage(res, quote) {
  if (!res?.ok) return null;
  if (res.dryRun) return null; // modo teste: mantém a mensagem padrão de conferência
  const lines = [`Pedido nº ${res.number} registrado! 🍕`];
  const total = Number.isInteger(res.totalCents) ? res.totalCents : null;
  if (total !== null) lines.push(`Total: ${formatMoney(total)}${quote && total !== quote.totalCents ? ' (valor conferido pelo sistema da loja)' : ''}`);
  if (res.pixCopiaECola) lines.push('', 'Pague com Pix Copia e Cola (copie o código abaixo):', res.pixCopiaECola, '', 'Assim que o pagamento for confirmado pelo banco, seu pedido segue para a cozinha.');
  else if (quote?.payment === 'PIX') lines.push('O código Pix não foi gerado agora; um atendente vai te enviar.');
  return lines.join('\n');
}

export async function submitPdvOrder(session, business, confirmed) {
  if (typeof business.submitOrder !== 'function') return {skipped: true};
  const body = buildPdvOrder(session, business, confirmed.quote, confirmed.requestId);
  try {
    const res = await business.submitOrder(body);
    session.pdvOrder = {at: new Date().toISOString(), ok: !!res?.ok, dryRun: !!res?.dryRun, number: res?.number ?? null, totalCents: res?.totalCents ?? null, paymentStatus: res?.paymentStatus ?? null, error: res?.ok ? null : String(res?.error || 'erro').slice(0, 200)};
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
  if (res?.skipped) return fallback;
  if (!res?.ok) return 'Recebi sua confirmação! Não consegui registrar automaticamente no sistema da loja, então um atendente vai finalizar seu pedido agora. 🙏';
  return pdvOrderMessage(res, out.quote) || fallback;
}
