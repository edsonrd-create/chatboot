/**
 * Comunicação e fidelidade oficiais da Guto Express.
 * Mantém a campanha separada dos preços do PDV, do saldo de pontos e das confirmações.
 * Não modifica carrinho, pedido, pagamento, status de cozinha ou status de entrega.
 */
export const GUTO_LINKS=Object.freeze({
  android:'https://play.google.com/store/apps/details?id=com.br.gutoexpress',
  ios:'https://apps.apple.com/br/app/guto-express/id6443589583',
  site:'https://loja.neemo.com.br/gutoexpress'
});
export const GUTO_LOYALTY=Object.freeze({
  thresholdCents:35000,
  reward:'pizza média',
  requiresSameAccount:true,
  channels:['app','site']
});
export const GUTO_LOYALTY_MESSAGE='🍕 *Fidelidade Guto Express:* acumulando R$ 350,00 em compras pelo nosso app ou site, no mesmo cadastro, você ganha uma *pizza média de brinde*! O saldo e o resgate precisam ser conferidos no cadastro, conforme as regras do programa.';
export const GUTO_LINKS_MESSAGE=[
  '📱 *Peça pelos nossos canais oficiais:*',
  '🤖 Android: '+GUTO_LINKS.android,
  '🍏 iPhone: '+GUTO_LINKS.ios,
  '🌐 Site: '+GUTO_LINKS.site
].join('\n');
const normalize=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const has=(value,re)=>re.test(normalize(value));
const loyaltyIntent=/\b(fidelidade|pontuacao|pontos|brinde|premio|recompensa|resgat|acumulad)\w*/;
const channelIntent=/\b(cardapio|menu|promocao|promocoes|oferta|ofertas|aplicativo|app|site|link|baixar|instalar|google play|app store)\b/;
const purchaseIntent=/\b(pizza|pizzas|pedido|pedir|quero|comprar|combo|combos|boa noite|bom dia|boa tarde|ola|oi)\b/;
const statusOnly=/\b(onde esta|cad[eê] meu pedido|atrasou|atraso|entregador|cancelamento|reclamacao|problema)\b/;
const safetyIntent=/\b(alergia|alergico|anafilaxia|intolerancia severa|contaminacao cruzada)\b/;
const humanIntent=/\b(atendente|humano|gerente|reclamacao|reclamar|funcionario)\b/;

export function customerExperienceHints(){
 return [
  'IDENTIDADE: você é atendente VIRTUAL da Pizzaria Guto Express. Seja acolhedora, profissional, rápida e objetiva. Use português brasileiro, emojis moderados e perguntas curtas.',
  'CANAIS PRÓPRIOS OFICIAIS: Android '+GUTO_LINKS.android+' ; iOS '+GUTO_LINKS.ios+' ; site '+GUTO_LINKS.site+'. Para cardápio, promoções e pedidos, ofereça esses canais quando oportuno, mas não mande todos os links em toda mensagem.',
  'FIDELIDADE OFICIAL: compras acumuladas de R$ 350,00 no MESMO CADASTRO do app ou site dão direito a uma pizza MÉDIA de brinde, conforme as condições do programa. O saldo, a elegibilidade, o registro e o resgate exigem validação no sistema. Não afirme que o cliente já ganhou sem essa consulta.',
  'Ao começar atendimento, apresentar cardápio, falar de ofertas ou encerrar a conversa, informe a fidelidade pelo menos uma vez quando adequado, sem insistência ou duplicação por mensagem. Ao pedir saldo pessoal, explique que precisa validar no cadastro oficial.',
  'Nunca invente preços, promoções ativas, sabores, taxas, área de entrega, horário, saldo de fidelidade, disponibilidade, confirmação de pagamento ou situação do pedido. Priorize dados atuais do PDV e encaminhe dúvidas críticas para atendimento humano.',
  'Não acrescente venda promocional quando cliente pedir humano, relatar problema grave ou possível alergia. Não troque o pedido por uma propaganda.'
 ].join('\n');
}
export function loyaltyInformation({balanceRequested=false}={}){
 return balanceRequested
  ?GUTO_LOYALTY_MESSAGE+'\nNão consigo consultar seu saldo individual nesta conversa sem uma verificação autorizada. Posso encaminhar à equipe para conferir seu cadastro.'
  :GUTO_LOYALTY_MESSAGE;
}
/**
 * Personalização determinística após o motor de pedidos: anuncia regras corretas uma vez
 * e fornece links exatos sem depender da geração livre do modelo.
 */
export function enhanceCustomerReply({userText='',reply='',session,business}={}){
 if(typeof reply!=='string')throw new TypeError('Resposta do chatbot inválida');
 if(!session||typeof session!=='object'||session.mode==='HUMAN')return reply;
 const message=normalize(userText),answer=normalize(reply);
 if(!reply.trim())return reply;
 // Não transformar reclamações, atrasos, alergias ou atendimento humano em publicidade.
 if(has(message,safetyIntent)||has(message,humanIntent)||has(message,statusOnly))return reply;
 const promo=session.customerExperience||{};
 const explicitLoyalty=loyaltyIntent.test(message);
 const explicitLinks=channelIntent.test(message);
 const opportunity=explicitLoyalty||explicitLinks||purchaseIntent.test(message);
 if(!opportunity)return reply;
 const alreadyMentionsLoyalty=/r\$\s*350(?:[,.]00)?/.test(answer)&&/pizza medi/.test(answer);
 const loyaltyNeeded=(explicitLoyalty||!promo.loyaltyShown)&&!alreadyMentionsLoyalty;
 const parts=[reply];
 if(loyaltyNeeded)parts.push(loyaltyInformation({balanceRequested:/\b(meu|minha|quanto|saldo|faltam|tenho)\b/.test(message)&&explicitLoyalty}));
 if(loyaltyNeeded||alreadyMentionsLoyalty)promo.loyaltyShown=true;
 // Links são adicionados no pedido expresso de app/site ou no primeiro envio de menu/promoções.
 const linkNeeded=(explicitLinks||(!promo.linksShown&&/\b(cardapio|promocao|promocoes|oferta|ofertas|combo|combos)\b/.test(message)))&&
   !Object.values(GUTO_LINKS).every(url=>reply.includes(url));
 if(linkNeeded)parts.push(GUTO_LINKS_MESSAGE);
 if(linkNeeded||Object.values(GUTO_LINKS).every(url=>reply.includes(url)))promo.linksShown=true;
 session.customerExperience=promo;
 return parts.join('\n\n');
}
