import {getSummary} from './core.mjs';

const norm=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
export function wantsToFinishOrder(text){
  return /^(?:so isso|e so|era so isso|pode fechar|pode finalizar|finalizar(?: o pedido)?|fechar(?: o pedido)?|concluir(?: o pedido)?|pode concluir|terminar pedido|pronto(?: pode fechar)?|nao quero mais nada|quero finalizar|vamos fechar|pode mandar o resumo)$/.test(norm(text).replace(/[.!?]+$/,''));
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
    return `Tudo certo, ${first}! 🍕 Já conferimos seu pedido e ${session.fulfillment==='PICKUP'?'a retirada':'a entrega'}. Agora, *para finalizar*, prefere pagar por *PIX, cartão ou dinheiro*?`;
  return null;
}
export function asksPaymentBeforeCheckout(text){
  return /(?:como|qual).*?(?:forma de pagamento|pagar)|(?:pix,? cart[aã]o|cart[aã]o ou dinheiro)|como prefere pagar/i.test(String(text||''));
}
