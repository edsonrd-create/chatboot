/**
 * Atendimento comercial Guto Express — camada determinística aplicada depois
 * do motor existente. NÃO altera preços, carrinho, pagamento ou pedidos.
 * Estado é persistido na sessão de cada conversa/WhatsApp.
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
  '📱 *Faça seu pedido pelos canais oficiais da Guto Express:*',
  '🤖 Android: '+GUTO_LINKS.android,
  '🍏 iPhone: '+GUTO_LINKS.ios,
  '🌐 Site: '+GUTO_LINKS.site
].join('\n');
export const GUTO_APP_OFFER='Se preferir, você também pode fazer seu pedido pelo *App Guto Express* (Android ou iPhone), ou pelo nosso site. Você pode continuar por aqui no WhatsApp! 😊';
const normalize=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const has=(value,re)=>re.test(normalize(value));
const loyaltyIntent=/\b(fidelidade|pontuacao|pontos|brinde|premio|recompensa|resgat|acumulad)\w*/;
const channelIntent=/\b(cardapio|menu|promocao|promocoes|oferta|ofertas|aplicativo|app|site|link|baixar|instalar|google play|app store)\b/;
const purchaseIntent=/\b(pizza|pizzas|pedido|pedir|quero|comprar|combo|combos|boa noite|bom dia|boa tarde|ola|oi)\b/;
const urgentIntent=/\b(atraso|atrasou|cad[eê] meu pedido|onde esta|entregador|cancelamento|reclamacao|problema|reembolso)\b/;
const safetyIntent=/\b(alergia|alergico|alergica|anafilaxia|intolerancia severa|contaminacao cruzada)\b/;
const humanIntent=/\b(atendente|humano|gerente|reclamacao|reclamar|funcionario)\b/;
const nameStopWords=new Set(['oi','ola','sim','nao','claro','obrigado','obrigada','calabresa','frango','portuguesa','pizza','grande','media','broto','big','gigante','entrega','retirada','atendente','humano','cliente','pedido','porfavor','boa','noite','tarde','dia']);
const nameSuffix=/\s+(?:e\s+(?:eu\s+)?(?:quero|gostaria|preciso|vou)|quero|gostaria|preciso|pode|pra|para|que|porque|mas)\b.*$/i;
function validCustomerName(value){
 const clean=String(value||'').trim().replace(/^[\s"'“”]+|[\s"'“”!?.;:,]+$/g,'').replace(/\s+/g,' ');
 if(clean.length<2||clean.length>70||!/^[-'\p{L} ]+$/u.test(clean))return null;
 const parts=clean.split(' ');
 if(parts.length>5||parts.some(x=>nameStopWords.has(normalize(x))))return null;
 return clean;
}
/** Extrai apenas nomes informados pelo próprio cliente. Não confunde sabores com nomes. */
export function extractCustomerName(text,{awaitingName=false}={}){
 const raw=String(text||'').trim();
 if(!raw||raw.length>500)return null;
 const explicit=raw.match(/(?:^|[.!?\n]\s*|\b)(?:meu nome (?:é|e)|me chamo|pode me chamar de|me chama de|aqui é|aqui e|sou (?:o|a) )\s+([^\n.!?;,]{2,100})/iu);
 if(explicit)return validCustomerName(explicit[1].replace(nameSuffix,''));
 if(awaitingName && /^[-'\p{L} ]{2,70}$/u.test(raw) && raw.trim().split(/\s+/).length<=4){
   return validCustomerName(raw);
 }
 return null;
}
export function isNameOnlyReply(text,{awaitingName=false}={}){
 const raw=String(text||'').trim();
 if(!awaitingName)return false;
 return !!extractCustomerName(raw,{awaitingName}) &&
    (/^[-'\p{L} ]{2,70}$/u.test(raw) ||
     /^(?:meu nome (?:é|e)|me chamo|pode me chamar de|aqui é|aqui e|sou (?:o|a) )\s+[-'\p{L} ]{2,70}[.!?]?$/iu.test(raw));
}
export function customerExperienceHints(){
 return [
  'IDENTIDADE: você é assistente VIRTUAL da Pizzaria Guto Express. Acolha o cliente e ofereça ajuda com cardápio, pedidos ou dúvidas. Use português brasileiro, emojis moderados e perguntas objetivas.',
  'NOME: pergunte como o cliente prefere ser chamado no começo do atendimento, exceto quando o nome já foi informado ou confirmado no cadastro. Não repita a pergunta se já perguntou; respeite clientes que não desejem informar o nome. Use o nome confirmado sem fingir que conhece o cliente.',
  'CANAIS OFICIAIS PARA PEDIDO: ofereça no começo, de modo opcional, fazer o pedido pelo App Guto Express ou continuar no WhatsApp. Android '+GUTO_LINKS.android+' ; iOS '+GUTO_LINKS.ios+' ; site '+GUTO_LINKS.site+'. Se o cliente escolher o WhatsApp, continue o atendimento normalmente.',
  'FIDELIDADE: a cada R$ 350,00 de compras acumuladas pelo app/site NO MESMO CADASTRO, o cliente ganha uma pizza média de brinde conforme as regras do programa. Apresente o benefício de forma natural e sem spam, uma vez quando oportuno. Não afirme saldo, elegibilidade ou resgate sem consultar o cadastro autorizado.',
  'Links oficiais e fidelidade são acrescentados por uma camada determinística: não invente URLs, não repita blocos promocionais e jamais afirme promoções ativas ou vantagens além das autorizadas.',
  'Não invente sabores, preços, horários, área de entrega, taxas, prazos, promoções, pagamento confirmado ou status de pedido. Consulte o catálogo vigente do PDV e transfira dúvidas críticas ao humano.',
  'Não interrompa urgências, alergias, reclamações, confirmação final de pedido ou pedidos de atendente com publicidade. Nunca obrigue o cliente a usar o app.'
 ].join('\n');
}
export function loyaltyInformation({balanceRequested=false}={}){
 return balanceRequested
  ?GUTO_LOYALTY_MESSAGE+'\nSeu saldo individual precisa ser conferido no cadastro oficial. Posso pedir para nossa equipe verificar.'
  :GUTO_LOYALTY_MESSAGE;
}
/**
 * Primeiro identifica o nome; depois oferece app e fidelidade UMA VEZ por
 * conversa. Perguntas diretas sobre os links/fidelidade sempre são respondidas.
 */
export function enhanceCustomerReply({userText='',reply='',session}={}){
 if(typeof reply!=='string')throw new TypeError('Resposta do chatbot inválida');
 if(!session||typeof session!=='object'||session.mode==='HUMAN'||!reply.trim())return reply;
 const message=normalize(userText),answer=normalize(reply);
 const state=session.customerExperience||{};
 const name=session.knownCustomer?.name
   ?validCustomerName(session.knownCustomer.name)
   :extractCustomerName(userText,{awaitingName:Boolean(state.nameAsked)}) ||
    (session.history||[]).filter(x=>x.role==='user').map(x=>extractCustomerName(x.content)).find(Boolean) ||
    (state.nameConfirmed?validCustomerName(session.customerName):null);
 if(name){
   session.customerName=name;state.nameConfirmed=true;
 }
 const isUrgent=has(message,urgentIntent)||has(message,safetyIntent)||has(message,humanIntent);
 const criticalStage=Boolean(session.awaitingConfirmation)||
   /(?:solicita[cç][aã]o|pedido)\s+.{0,35}(?:confer[eê]ncia|confirmad)|responda\s+\*?confirmo\*?/iu.test(reply);
 const parts=[reply];
 if(!isUrgent&&!criticalStage){
   const alreadyAsksName=/\b(como posso te chamar|qual (?:é |e )?(?:o )?seu nome|como (?:voce|você) se chama)\b/i.test(normalize(reply));
   if(!state.nameConfirmed&&!state.nameAsked){
     if(!alreadyAsksName)parts.push('Antes de continuar, como posso te chamar? 😊');
     state.nameAsked=true;
   }else if(name&&!state.greetedByName&&!has(answer,new RegExp('\\b'+normalize(name.split(' ')[0])+'\\b'))){
     // Não inserir um nome de WhatsApp não confirmado ou tornar obrigatória a apresentação.
     parts.push('Prazer, '+name.split(' ')[0]+'! 🍕');
     state.greetedByName=true;
   }
   const explicitLoyalty=loyaltyIntent.test(message);
   const opportunity=explicitLoyalty||channelIntent.test(message)||purchaseIntent.test(message)||!state.appOffered;
   if(opportunity){
     const alreadyLoyalty=/r\$\s*350(?:[,.]00)?/.test(answer)&&/pizza medi/.test(answer);
     if((explicitLoyalty||!state.loyaltyShown)&&!alreadyLoyalty){
       parts.push(loyaltyInformation({balanceRequested:explicitLoyalty&&/\b(meu|minha|quanto|saldo|faltam|tenho)\b/.test(message)}));
       state.loyaltyShown=true;
     }else if(alreadyLoyalty)state.loyaltyShown=true;
     const explicitApp=channelIntent.test(message);
     const linksAlreadyPresent=Object.values(GUTO_LINKS).every(url=>reply.includes(url));
     if((explicitApp||!state.appOffered)&&!linksAlreadyPresent){
       if(!state.appOffered)parts.push(GUTO_APP_OFFER);
       parts.push(GUTO_LINKS_MESSAGE);
       state.appOffered=true;state.linksShown=true;
     }else if(linksAlreadyPresent){state.appOffered=true;state.linksShown=true;}
   }
 }
 session.customerExperience=state;
 return parts.join('\n\n');
}
