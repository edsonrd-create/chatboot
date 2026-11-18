// Regras determinísticas de negociação de pagamento. Nunca declara PIX pago.
export function normalizePaymentText(value=''){return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();}
export function paymentIntent(value=''){
 const text=normalizePaymentText(value);
 if(/\b(maquininha|maquina|cartao na entrega|cartao quando chegar|pagar na entrega|passar cartao)\b/.test(text))return 'CARD_ON_DELIVERY';
 if(/\b(pix)\b/.test(text))return 'PIX';
 if(/\b(cartao|credito|debito)\b/.test(text))return 'CARD';
 return null;
}
export function handlePaymentMessage(value,session,{pixLinkAvailable=false}={}){
 const normalized=normalizePaymentText(value).trim();
 if(session.awaitingPixLinkConsent){
  if(/^(sim|pode|pode mandar|pode enviar|envia|manda|quero|sim por favor)[!. ]*$/.test(normalized)){
   session.awaitingPixLinkConsent=false;
   session.pixLinkConsent=true;
   // Link deve vir da cobrança do pedido já criado no PDV, nunca de endereço genérico.
   return {kind:'PIX_LINK_REQUEST',text:pixLinkAvailable?'Vou gerar o link PIX do valor confirmado do seu pedido. 🍕':'Perfeito! Vou solicitar à equipe o link PIX do valor exato do seu pedido. Não precisa pagar antes de receber o link oficial.'};
  }
  if(/^(nao|não|agora nao|depois|prefiro na entrega)[!. ]*$/.test(normalized)){
   session.awaitingPixLinkConsent=false;
   return {kind:'PIX_DECLINED',text:'Sem problema! Como você prefere pagar? Podemos conferir as opções disponíveis para entrega.'};
  }
 }
 const kind=paymentIntent(value);
 if(kind==='PIX'){
   session.payment='PIX';session.paymentTiming='AWAITING_PIX_CONSENT';session.awaitingPixLinkConsent=true;
   return {kind:'PIX_CONSENT',text:'Você prefere pagar por PIX? Posso enviar o link de pagamento com o valor correto do seu pedido?'};
 }
 if(kind==='CARD_ON_DELIVERY'){
   session.payment='CARTAO';session.paymentTiming='ON_DELIVERY';session.awaitingPixLinkConsent=false;
   return {kind:'CARD_ON_DELIVERY',text:'Combinado! 🍕 Pagamento na maquininha no momento da entrega. O pedido pode seguir para conferência e produção após a confirmação dos itens, sem aguardar pagamento antecipado. Qual será seu pedido?'};
 }
 if(kind==='CARD'){
   session.payment='CARTAO';session.paymentTiming='TO_CONFIRM';session.awaitingPixLinkConsent=false;
   return {kind:'CARD_CHOICE',text:'Aceitamos cartão conforme as opções habilitadas no PDV. Você prefere pagar na maquininha durante a entrega? 😊'};
 }
 return null;
}
