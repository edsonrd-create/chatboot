// Módulo isolado para escolha do canal e sincronização com a fonte única: PDV.
// Não contém tabela própria de preços; nunca confirma venda sem cotação do PDV.
export const SITE_URL='https://www.gutoexpress.com.br';
export const ANDROID_URL='https://play.google.com/store/apps/details?id=com.br.gutoexpress';
const norm=text=>String(text||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
export const asksForMenu=text=>/\b(cardapio|catalogo|menu|lista de sabores|ver sabores|mandar sabores)\b/.test(norm(text));
export const isCommerceIntent=text=>/\b(cardapio|catalogo|menu|sabores|pizza|pizzas|combo|combos|borda|bordas|preco|valor|quanto custa|pedido|comprar|pedir|promo|entrega|retirada|grande|media|broto|big|gigante)\b/.test(norm(text));
const wantsWhats=text=>/^(2|opcao 2|whatsapp|pelo whatsapp|por aqui|quero aqui|pedido por aqui|envia aqui|manda aqui|pode mandar)$/i.test(norm(text));
const wantsApp=text=>/^(1|opcao 1|site|app|aplicativo|android|ios|iphone|pelo site|pelo app)$/i.test(norm(text));

export function cardapioChoice(session,text,{iosUrl='',catalogSynced=false}={}){
  if(!session||typeof session!=='object')return null;
  const channels=[
    '🌐 Site: '+SITE_URL,
    '📱 App Android: '+ANDROID_URL,
    iosUrl?'🍎 iPhone: '+iosUrl:'🍎 iPhone: procure Guto Express na App Store.',
  ];
  if(session.cardapioChannel==='choosing'){
    if(wantsWhats(text)){
      session.cardapioChannel='whatsapp';
      return {reply:catalogSynced
        ?'🍕 Perfeito! Vou apresentar as opções do cardápio oficial do PDV aqui no WhatsApp. Qual tamanho ou sabor você gostaria?'
        :'🍕 Você pode consultar o cardápio no site: https://www.gutoexpress.com.br/cardapio. A consulta ao PDV está indisponível neste momento, então não vou informar preços sem confirmação. Posso chamar um atendente.',
        channel:'whatsapp'};
    }
    if(wantsApp(text))return {reply:['Claro! Faça seu pedido nos canais oficiais:',...channels,'Se preferir continuar por aqui, responda *2*.'].join('\n'),channel:'own'};
    if(isCommerceIntent(text)){session.cardapioChannel='whatsapp';return null;}
    return {reply:'Como prefere pedir? Responda *1* para app/site ou *2* para WhatsApp.',channel:'choice'};
  }
  if(asksForMenu(text)){
    session.cardapioChannel='choosing';
    return {reply:['🍕 *Cardápio Guto Express*','Para pedir com praticidade, recomendamos primeiro o app ou site:',...channels,'','*1* — Pedir pelo aplicativo ou site','*2* — Pedir aqui pelo WhatsApp (cardápio sincronizado com o PDV)'].join('\n'),channel:'choice'};
  }
  return null;
}
