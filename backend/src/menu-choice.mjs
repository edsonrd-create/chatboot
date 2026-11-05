export const OFFICIAL_SITE='https://www.gutoexpress.com.br';
export const ANDROID_URL='https://play.google.com/store/apps/details?id=com.br.gutoexpress';
const clean=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
const isMenu=s=>/\b(cardapio|catalogo|menu|lista de sabores|ver sabores)\b/.test(clean(s));
const wantsWhatsapp=s=>/^(2|opcao 2|por aqui|pelo whatsapp|quero pelo whatsapp|manda o cardapio aqui|pode mandar o cardapio)$/.test(clean(s));
const wantsApp=s=>/^(1|opcao 1|app|aplicativo|site|android|ios|iphone|pelo site|pelo app)$/.test(clean(s));
export function menuChoiceReply(session,input,{pdfAvailable=false,iosUrl=''}={}){
 const site='🌐 Site: '+OFFICIAL_SITE;
 const app='📱 Android: '+ANDROID_URL;
 const iphone=iosUrl?'🍎 iPhone: '+iosUrl:'🍎 iPhone: procure Guto Express na App Store.';
 if(session.menuChoice==='awaiting'){
   if(wantsWhatsapp(input)){
     session.menuChoice='whatsapp';
     return {reply:pdfAvailable?'🍕 Perfeito! Vou enviar nosso cardápio em PDF. Qual pizza ou combo você gostaria? Os preços serão confirmados no PDV.':'🍕 Vamos pedir por aqui! Consulte o cardápio em https://www.gutoexpress.com.br/cardapio e me diga a pizza e o tamanho. Confirmaremos os valores no PDV.',sendPdf:pdfAvailable};
   }
   if(wantsApp(input)){session.menuChoice='app';return {reply:[site,app,iphone,'Se preferir o WhatsApp, responda 2.'].join('\n')};}
   if(/\b(quero|pizza|combo|calabresa|broto|media|grande|big|gigante)\b/.test(clean(input))){session.menuChoice='whatsapp';return null;}
   return {reply:'Responda *1* para pedir pelo app/site ou *2* para pedir aqui no WhatsApp.'};
 }
 if(isMenu(input)){
   session.menuChoice='awaiting';
   return {reply:['🍕 *Cardápio Guto Express*','Recomendamos pedir primeiro pelo nosso app ou site:',site,app,iphone,'','*1* — Fazer pedido pelo app ou site','*2* — Fazer pedido pelo WhatsApp (envio o cardápio)'].join('\n')};
 }
 return null;
}
