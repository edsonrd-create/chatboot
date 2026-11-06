import {getSummary,formatMoney} from './core.mjs';

const norm=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
export function wantsToFinishOrder(text){
  const message=norm(text).replace(/[!?.,;:]/g,' ').replace(/\s+/g,' ').trim();
  return /^(?:so isso|e so|era so isso|pode|sim|isso|pode sim|sim pode|pode fechar|pode finalizar|pode concluir|pode confirmar|fechar|fechar o pedido|fechar pedido|fechar seu pedido|fecha meu pedido|fecha o pedido|pode fechar meu pedido|pode fechar seu pedido|finalizar|finalizar pedido|finalizar o pedido|finaliza meu pedido|concluir|concluir pedido|concluir o pedido|terminar pedido|pronto|pronto pode fechar|nao quero mais nada|quero finalizar|quero confirmar|vamos fechar|pode mandar o resumo|manda o resumo|pode enviar o resumo|pode fechar sim|vamos finalizar)$/.test(message);
}
export function asksForCurrentPrice(text){
  return /^(?:qual (?:o )?valor(?: total)?|quanto (?:deu|ficou|vai ficar|custa|e o total)|qual o total|me passa o valor|me fala o valor|valor total|preco total|total(?: do pedido)?|quanto ta(?: meu pedido)?|qual o preco)$/.test(norm(text).replace(/[.!?,;:]+$/,''));
}
export function checkoutNextQuestion(session,business){
  if(!session.checkoutRequested || !Array.isArray(session.cart)||!session.cart.length)return null;
  const summary=getSummary(session,business);
  if(!session.customerNameConfirmed){
    session.awaitingCustomerName=true;
    return 'Ótimo! 🍕 Já separei suas escolhas. Para deixar tudo certinho, como posso anotar seu *nome*?';
  }
  const first=String(session.customerName||'').trim().split(/\s+/)[0]||'';
  if(session.fulfillment!=='PICKUP'&&!session.fulfillmentChosen&&!session.address)
    return `Perfeito, ${first}! 😊 Você prefere receber em casa ou retirar na pizzaria?`;
  if(session.fulfillment!=='PICKUP'&&!session.address)
    return 'Combinado! 🛵 Me passa a *rua, número e bairro* para eu conferir a entrega e a taxa certinha?';
  if(summary.missing.includes('taxa de entrega validada'))
    return 'Já tenho seu endereço! Só preciso confirmar a taxa de entrega com o PDV antes de seguir. Se não conseguir validar, vou chamar nossa equipe. 😊';
  if(summary.missing.includes('preços válidos'))
    return 'Estou conferindo os valores atualizados do cardápio. Para não cobrar errado, vou precisar da confirmação do sistema antes de finalizar.';
  if(!session.payment)
    return `Tudo certo, ${first}! 🍕 Nosso subtotal é ${formatMoney(summary.subtotalCents)} e ${session.fulfillment==='PICKUP'?'você vai retirar na pizzaria':'a taxa de entrega é '+formatMoney(summary.deliveryFeeCents)}. *Total: ${formatMoney(summary.totalCents)}.* Para finalizar, prefere pagar por *PIX, cartão ou dinheiro*?`;
  if(session.payment==='DINHEIRO'){
    if(session.cashChangeNeeded===null||session.cashChangeNeeded===undefined)
      return `Perfeito, ${first}! 😊 O total é *${formatMoney(summary.totalCents)}*. Vai precisar de *troco*?`;
    if(session.cashChangeNeeded===true && session.cashReceivedCents===null)
      return `Claro! 😊 O total é *${formatMoney(summary.totalCents)}*. *Troco para quanto?*`;
    if(summary.missing.includes('valor do troco válido'))
      return `O total atualizado ficou em *${formatMoney(summary.totalCents)}*. Para quanto você vai pagar? Preciso conferir o troco certinho. 😊`;
  }
  if(summary.missing.includes('telefone para contato')) {
    session.awaitingCustomerPhone=true;
    return 'Só falta confirmar um telefone para contato do pedido. 📱 Qual é o seu número com DDD?';
  }
  return null;
}
export function asksPaymentBeforeCheckout(text){
  return /(?:como|qual).*?(?:forma de pagamento|pagar)|(?:pix,? cart[aã]o|cart[aã]o ou dinheiro)|como prefere pagar/i.test(String(text||''));
}
