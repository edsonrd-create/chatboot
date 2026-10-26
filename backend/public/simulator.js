/* Guto Bot — simulador local conversacional, sem IA ou acesso a pedidos reais.
 * O mesmo motor é executado pela prévia do GitHub Pages e pelos testes de regressão.
 */
(function(root){
'use strict';
const norm=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9\s]/g,' ').replace(/\s+/g,' ').trim();
const money=n=>Number.isInteger(n)?new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(n/100):'a confirmar';
const contains=(s,re)=>re.test(s);
const names={broto:'Broto',media:'Média',grande:'Grande',big:'Big',gigante:'Gigante'};
const createSession=()=>({cart:[],draft:null,pendingCombo:null,pendingDrink:false,address:null,delivery:'ENTREGA',payment:null,human:false,lastQuestion:'',lastMentionedFlavor:null,turns:0,history:[]});
const human=/\b(atendente|humano|gerente|funcionario|pessoa de verdade|falar com alguem)\b/;
const confirm=/^(confirmo|pode fechar|fechar pedido|esta certo|pode enviar|sim confirma|pode confirmar|fechado|confirmado)$/;
const cancelAll=/\b(cancela tudo|cancela meu pedido|desiste de tudo|esquece o pedido|esquece tudo|apaga tudo|nao quero mais nada)\b/;
const sizeRe={gigante:/\b(gigante|16 fatias)\b/,big:/\b(big|12 fatias)\b/,grande:/\b(grandes?|10 fatias)\b/,media:/\b(medias?|8 fatias)\b/,broto:/\b(broto|6 fatias)\b/};
function sizeFrom(t){for(const [k,re] of Object.entries(sizeRe))if(re.test(t))return k;return null;}
function quantity(t){let m=t.match(/\b([2-9])\s*(?:pizzas?|unidades?)\b/)||t.match(/\b(duas|dois|tres|quatro)\s+pizzas?\b/); if(!m)return 1;const n={duas:2,dois:2,tres:3,quatro:4};return n[m[1]]||Number(m[1])||1;}
const alias={
 calabresa:['calabreza','calabresa'],frango_catupiry:['frango com catupiry','frango c catupiry','frango catupiry','frango e catupiry','frango catupa','frango c catupa'],
 quatro_queijos:['4 queijos','quatro queijos'],portuguesa:['portuga','portuguesa'],marguerita:['margarita','marguerita'],mussarela:['mucarela','mussarela','mozarela'],
};
function flavorsIn(t,data){
 const variants=[];for(const f of data.flavors){let keys=[norm(f.label),...(alias[f.id]||[])];for(const key of keys)if(key.length>2)variants.push({id:f.id,key,display:f.label});}
 variants.sort((a,b)=>b.key.length-a.key.length);
 const used=[];const found=[];for(const v of variants){const escaped=v.key.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');const re=new RegExp('(?:^|\\b)'+escaped+'(?:\\b|$)');const match=re.exec(t);if(!match)continue;const start=match.index+match[0].indexOf(v.key),end=start+v.key.length;if(used.some(([s,e])=>start<e&&s<end))continue;used.push([start,end]);if(!found.includes(v.id))found.push(v.id);}
 return found;
}
function drinkIn(t,data){
 const drinkAliases=[['coca_zero_2l',/\b(coca zero|zero)\s*(2\s*l|2\s*litros?)\b/],['coca_cola_2l',/\b(cocas?|coca cola)\s*(2\s*l|2\s*litros?)\b/],['coca_cola_350ml',/\b(coca|coca cola)\s*(lata|350)\b/],['guarana_antartica_2l',/\bguarana\s*(2\s*l|2\s*litros?)\b/]];
 for(const [id,re] of drinkAliases){const item=data.drinks.find(d=>d.id===id);if(item&&re.test(t))return item;}
 const full=[...data.drinks].sort((a,b)=>b.label.length-a.label.length).find(d=>t.includes(norm(d.label)));return full||null;
}
function isOrder(t){return /\b(quero|queria|manda|mandar|pede|pedir|pedido|faz|fazer|separa|pizzas?|metade|meia|sabores?|coloca|adiciona|inclui|mais uma|combo)\b/.test(t);}
function lookupCombo(t,data){if(!/\b(combo|promocao|familia|super big|barato do dia)\b/.test(t))return null;
 const aliases=[['super-big',/\b(super big|combo super big)\b/],['familia',/\b(familia|combo familia)\b/],['gigante',/\bcombo gigante\b/],['big',/\bcombo big\b/],['grande-coca-2l',/\b(grande com coca|grande \+ coca)\b/],['grande-promocional',/\b(grande promocional|combo grande promocional)\b/],['barato-dia',/\b(barato do dia)\b/]];
 const choice=aliases.find(([,re])=>re.test(t));return choice?data.combos.find(c=>c.id===choice[0]):null;
}
function describeCart(s,data){if(!s.cart.length)return 'Ainda não adicionamos nenhuma pizza ou bebida.';return s.cart.map((item,i)=>{
 if(item.kind==='drink')return `${i+1}. ${item.quantity}x ${item.label}`;
 return `${i+1}. ${item.quantity}x Pizza ${names[item.size]} — ${item.flavors.map(id=>data.flavors.find(f=>f.id===id)?.label||id).join(' + ')}${item.notes?.length?' ('+item.notes.join(', ')+')':''}`;
 }).join('\n');}
function nextMissing(s){if(s.draft)return 'Ainda preciso do tamanho e dos sabores para terminar a pizza.';if(!s.cart.length)return 'Qual tamanho e sabor você gostaria?';if(s.delivery==='ENTREGA'&&!s.address)return 'Qual o endereço completo, com rua, número, bairro e cidade?';if(!s.payment)return 'Prefere pagar com Pix, cartão ou dinheiro?';return 'Para enviar esse pedido à equipe, precisamos consultar preços atualizados e validar a taxa de entrega no sistema conectado.';}
function respond(message,s,data){
 const t=norm(message);s.turns++;let reply;
 function answer(text){reply=text;s.history.push({customer:message,assistant:reply});s.history=s.history.slice(-40);return reply;}
 function parseSeveralPizzas(){
   if(!/\b(uma|um|duas|dois|1|2|3|mais uma)\b/.test(t))return null;
   const matches=[...t.matchAll(/\b(brotos?|medias?|grandes?|big|gigantes?)\b/g)];
   if(matches.length<2 || /\bcombo\b/.test(t))return null;
   const created=[];
   for(let i=0;i<matches.length;i++){
     const m=matches[i]; const next=matches[i+1];
     const prev=t.slice(Math.max(0,m.index-18),m.index);const part=t.slice(m.index,next?.index??t.length);
     const pieceFlavors=flavorsIn(part,data),pieceSize=sizeFrom(m[0]);
     if(!pieceFlavors.length || !pieceSize)return null;
     const q=prev.match(/(?:\b|^)(2|3|4|duas|dois|tres|quatro)\s*$/);
     const quant=q?({duas:2,dois:2,tres:3,quatro:4}[q[1]]||Number(q[1])):1;
     created.push({kind:'pizza',size:pieceSize,flavors:pieceFlavors.slice(0,2),quantity:quant,notes:[]});
   }
   return created;
 }
 if(!t)return answer('Pode me contar o que deseja pedir? 🍕');
 if(human.test(t)){s.human=true;return answer('Claro! Vou encaminhar para uma pessoa da equipe. Nesta demonstração não há atendentes conectados, então nenhum contato foi enviado.');}
 if(s.human)return answer('Você solicitou atendimento humano. Na operação real o robô pausaria até a equipe assumir. Aqui, use “Reiniciar conversa” para testar novamente.');
 if(cancelAll.test(t)){s.cart=[];s.draft=null;s.pendingCombo=null;s.pendingDrink=false;s.address=null;s.payment=null;return answer('Tudo bem, cancelei o carrinho desta simulação. Não havia pedido real registrado. Quer começar outro?');}
 if(confirm.test(t))return answer('Entendi sua intenção de confirmar! Porém ainda precisamos de cotação válida de cada item, disponibilidade, taxa e revisão final. Nesta demonstração não vou registrar nem cobrar um pedido real. 🍕\n'+describeCart(s,data)+'\n'+nextMissing(s));
 if(/\b(meu ultimo pedido|igual (ao|o) ultimo|mesmo endereco|o de sempre|repete o pedido)\b/.test(t))return answer('Consigo ajudar, sim! 😊 Mas esta demonstração não acessa seu histórico nem endereço anterior. Você pode me dizer o tamanho e sabores, ou o endereço completo, para eu conferir?');
 if(/\b(tira|remove|exclui)\s+(a\s+)?(pizza|coca|bebida|refrigerante)\b/.test(t)){
  const kind=/coca|bebida|refrigerante/.test(t)?'drink':'pizza';const hits=s.cart.filter(x=>x.kind===kind);if(hits.length>1)return answer('Tenho mais de um item desse tipo no seu carrinho. Qual exatamente você quer retirar?');const n=s.cart.findLastIndex(x=>x.kind===kind);if(n>=0){const item=s.cart.splice(n,1)[0];return answer('Certo, retirei '+(item.kind==='drink'?item.label:'a pizza')+' do carrinho da simulação. ✅\n'+describeCart(s,data));}return answer('Não encontrei esse item no seu carrinho. Pode me dizer qual deseja retirar?');
 }
 if(/\b(troca|trocar|substitui|muda)\b/.test(t)&&s.cart.some(x=>x.kind==='pizza')){
  const [fromText,toText]=t.split(/\bpor\b/);const from=flavorsIn(fromText||'',data)[0];const target=flavorsIn(toText||'',data)[0];const idx=s.cart.findLastIndex(x=>x.kind==='pizza');const pizza=s.cart[idx];
  if(from&&target){const matches=s.cart.filter(x=>x.kind==='pizza'&&x.flavors.includes(from));if(matches.length!==1||matches[0].quantity!==1)return answer('Você tem mais de uma pizza com esse sabor. Qual delas deseja alterar? Me diga o tamanho e qual pizza, para eu não trocar a errada.');const fi=pizza.flavors.indexOf(from);if(fi!==-1){pizza.flavors[fi]=target;return answer('Pronto, troquei o sabor. A pizza ficou: '+pizza.flavors.map(id=>data.flavors.find(f=>f.id===id)?.label).join(' + ')+'. Vou recalcular quando tivermos preços oficiais atualizados.');}}
  return answer('Claro! Qual sabor você quer retirar e qual vai entrar no lugar? Por exemplo: “troca calabresa por portuguesa”.');
 }
 if(/\b(sem\s+(cebola|azeitona|oregano|milho|pimentao|tomate)|borda\s+(catupiry|cheddar)|extra\s+queijo|bem passada|pouco molho)\b/.test(t)&&s.cart.some(x=>x.kind==='pizza')){
   const match=t.match(/\b(sem\s+(?:cebola|azeitona|oregano|milho|pimentao|tomate)|borda\s+(?:catupiry|cheddar)|extra\s+queijo|bem passada|pouco molho)\b/);
   const note=match?.[0];const pizza=s.cart.findLast(x=>x.kind==='pizza');if(note&&!pizza.notes.includes(note))pizza.notes.push(note);
   return answer('Anotei “'+note+'” na pizza. 😊 '+(/borda|extra/.test(note)?'Adicionais podem alterar o valor; precisamos confirmar preço e disponibilidade com a equipe.':'A cozinha precisa confirmar que consegue atender à observação.')+'\n'+nextMissing(s));
 }
 if(/\b(alergia|alergico|alergica|celiaco|contaminacao cruzada|lactose)\b/.test(t))return answer('Para alergias e restrições, preciso encaminhar a confirmação à equipe de cozinha. Não consigo garantir ausência de ingredientes ou contaminação cruzada pelo catálogo. Quer que eu registre sua dúvida para atendimento humano?');
 const combo=lookupCombo(t,data);
 if(combo){s.pendingCombo=combo.id;return answer('O '+combo.label+' anunciado inclui: '+combo.description+'. O valor divulgado foi '+money(combo.publishedPriceCents)+', sujeito à confirmação de vigência, composição e disponibilidade. 🍕 Quer escolher os sabores? Não vou lançar um combo como pedido antes de validar a oferta.');}
 if(/\b(quais combos|combos|promocoes|ofertas)\b/.test(t))return answer('Estas ofertas aparecem no catálogo publicado:\n'+data.combos.map(c=>'• '+c.label+' — '+money(c.publishedPriceCents)+' (anunciado)').join('\n')+'\nQual chamou sua atenção? Vamos confirmar as condições antes do pedido.');
 if(/\b(quero|manda|faz|pizzas?|pedir)\b/.test(t)){
   const several=parseSeveralPizzas();
   if(several){s.cart.push(...several);s.draft=null;return answer('Anotei as '+several.length+' pizzas separadamente! 🍕\n'+describeCart(s,data)+'\n'+nextMissing(s));}
 }
 // Leia todos os dados informados na MESMA mensagem antes de pedir uma informação de novo.
 const street=message.match(/\b(?:rua|avenida|av\.?|travessa|alameda|estrada)\s+[^,;\n]{3,100}?\s*,?\s*\d{1,5}\b(?:[^;\n]{0,120})?/i);
 if(street && /\b(rua|avenida|av|travessa|alameda|estrada)\b/.test(t))s.address=street[0].trim();
 if(/\b(pix|cartao|debito|credito|dinheiro)\b/.test(t))s.payment=/\bpix\b/.test(t)?'PIX':/\b(cartao|debito|credito)\b/.test(t)?'CARTAO':'DINHEIRO';
 if(/\b(retirar|retirada|buscar|balcao)\b/.test(t)){s.delivery='RETIRADA';s.address=null;}
 const size=sizeFrom(t),ids=flavorsIn(t,data),drink=drinkIn(t,data),wantsItem=isOrder(t);
 // Referência ao último sabor citado em diálogo: 'uma grande dela'. Não usa histórico de outro cliente.
 if(!ids.length && s.lastMentionedFlavor && /\b(dela|desse sabor|dessa pizza|daquela|dessa)\b/.test(t) && /\b(quero|faz|manda|coloca|uma|pizza)\b/.test(t))ids.push(s.lastMentionedFlavor);
 if(ids.length===1)s.lastMentionedFlavor=ids[0];
 // “Uma Coca” não especifica embalagem; pergunte sem inventar 350ml ou 2 litros.
 const vagueCoca=/\b(coca|coca cola)\b/.test(t)&&!/\b(2\s*l|2\s*litros?|350\s*ml|lata|zero)\b/.test(t);
 if(vagueCoca && !drink && /\b(quero|manda|coloca|adiciona|bota|inclui|uma|um)\b/.test(t))s.pendingDrink=true;
 if(s.pendingDrink&&/^(2\s*l|2\s*litros?|dois litros|lata|350\s*ml)$/.test(t)){
   const id=/lata|350/.test(t)?'coca_cola_350ml':'coca_cola_2l';
   const chosen=data.drinks.find(d=>d.id===id);
   if(chosen){s.cart.push({kind:'drink',id:chosen.id,label:chosen.label,quantity:1});s.pendingDrink=false;return answer('Anotei '+chosen.label+'! 🥤\n'+nextMissing(s));}
 }

 if(/\b(o que (leva|tem|vai)|o que vai na|o que tem na|ingredientes?|alergicos?|composicao|vai o que|que vai na|que tem na)\b/.test(t)&&ids.length){return answer(ids.slice(0,3).map(id=>{const f=data.flavors.find(x=>x.id===id);return f.label+' leva: '+f.ingredients.join(', ')+'.';}).join('\n')+'\nIngredientes declarados no cardápio; informações sobre alergênicos precisam ser confirmadas com a cozinha.');}
 if(/\b(quanto custa|preco|valor|quanto fica)\b/.test(t)&&ids.length){const f=data.flavors.find(x=>x.id===ids[0]);return answer('O cardápio anuncia '+f.label+' a partir de '+money(f.startingPriceCents)+'. O preço exato depende do tamanho, combinações e promoções válidas. Qual tamanho você gostaria?');}
 if(/\b(tem |têm |voces tem|voces possuem|vende|vendem)\b/.test(t)&&ids.length&&!wantsItem){return answer('O sabor '+data.flavors.find(f=>f.id===ids[0]).label+' aparece no nosso cardápio. 😊 Posso explicar os ingredientes; a disponibilidade atual será confirmada pela equipe.');}
 if(drink && (/\b(quero|manda|adiciona|coloca|inclui|pede|pedir|mais|bota|uma|um|ve)\b/.test(t)||/\b(2|3|4|duas|dois|tres|quatro)\s+(?:cocas?|refrigerantes?|garrafas?|latas?)\b/.test(t))){
  const countMatch=t.match(/\b(2|3|4|duas|dois|tres|quatro)\s+(?:cocas?|refrigerantes?|garrafas?|latas?)\b/);const drinkCount={duas:2,dois:2,tres:3,quatro:4};const q=countMatch?(drinkCount[countMatch[1]]||Number(countMatch[1])):1;s.cart.push({kind:'drink',id:drink.id,label:drink.label,quantity:q});
  if(!size&&!ids.length)return answer('Incluí '+q+'x '+drink.label+' no carrinho desta simulação. 🥤\n'+nextMissing(s));
 }
 if(size||ids.length||s.draft){
  if(!wantsItem&&!s.draft&&ids.length&&!size)return answer('Temos '+ids.map(id=>data.flavors.find(f=>f.id===id).label).join(' e ')+'. 🍕 Quer que eu monte uma pizza? Qual tamanho prefere?');
  const draft=s.draft||{size:null,flavors:[],quantity:1,notes:[]};
  if(size)draft.size=size;
  if(ids.length){draft.flavors=draft.waitingSecond && ids.length===1 ? [...new Set([...draft.flavors,...ids])].slice(0,2) : ids.slice(0,2);}
  if(/\b(duas|dois|tres|quatro|[2-9])\s+pizzas?\b/.test(t))draft.quantity=quantity(t);
  if(/\b(meio a meio|meia meia|metade|meio|dois sabores|2 sabores)\b/.test(t)&&draft.flavors.length===1)draft.waitingSecond=true;
  if(draft.waitingSecond&&draft.flavors.length===2)draft.waitingSecond=false;
  if(draft.flavors.length>2)return answer('Trabalhamos com até dois sabores por pizza. Quais dois você escolhe?');
  if(!draft.size){s.draft=draft;return answer('Boa escolha! 🍕 Qual tamanho você prefere? Broto 6, Média 8, Grande 10, Big 12 ou Gigante 16 fatias?');}
  if(!draft.flavors.length){s.draft=draft;return answer('Perfeito, pizza '+names[draft.size]+'. Qual sabor gostaria? Pode escolher até dois.');}
  if(draft.waitingSecond){s.draft=draft;return answer('Anotei a primeira metade! Qual sabor deseja na outra metade?');}
  if(s.pendingCombo){s.draft=draft;return answer('Anotei a pizza '+names[draft.size]+' de '+draft.flavors.map(id=>data.flavors.find(f=>f.id===id)?.label).join(' + ')+'. Como é um combo anunciado, ainda precisamos validar as regras e os demais itens com a equipe antes de adicionar como venda.');}
  const extraNote=t.match(/\b(sem\s+(?:cebola|azeitona|oregano|milho|pimentao|tomate)|borda\s+(?:catupiry|cheddar)|extra\s+queijo|bem passada|pouco molho)\b/);if(extraNote&&!draft.notes.includes(extraNote[0]))draft.notes.push(extraNote[0]);
  s.cart.push({kind:'pizza',size:draft.size,flavors:draft.flavors,quantity:draft.quantity,notes:draft.notes});s.draft=null;
  return answer('Perfeito! 🍕 Coloquei no carrinho da simulação: '+draft.quantity+'x pizza '+names[draft.size]+' ('+draft.flavors.map(id=>data.flavors.find(f=>f.id===id).label).join(' + ')+').\n'+(s.pendingDrink?'Você quer Coca-Cola lata ou 2 litros?':nextMissing(s)));
 }
 if(s.pendingDrink)return answer('Claro! Para eu anotar certinho, você quer Coca-Cola lata ou 2 litros?');
 if(/\b(retirar|retirada|buscar|balcao)\b/.test(t)){s.delivery='RETIRADA';s.address=null;return answer('Anotei retirada no balcão. O horário e a confirmação da loja precisam ser validados. Como prefere pagar?');}
 if(/\b(endereco|rua|avenida|av\s|travessa)\b/.test(t)&& /\d{1,5}/.test(t)){
   s.address=message.trim();return answer('Anotei o endereço informado. ✅ Ainda preciso validar a área atendida e a taxa no sistema conectado. '+nextMissing(s));
 }
 if(/\b(pix|cartao|debito|credito|dinheiro)\b/.test(t)){
   s.payment= t.includes('pix')?'PIX':/cartao|debito|credito/.test(t)?'CARTAO':'DINHEIRO';return answer('Anotei pagamento em '+(s.payment==='CARTAO'?'cartão':s.payment==='PIX'?'Pix':'dinheiro')+'. '+nextMissing(s));
 }
 if(/\b(quanto fica|total do pedido|valor do pedido|quanto deu)\b/.test(t))return answer('Vou precisar consultar os preços atualizados de cada item e validar a entrega antes de informar o total. 🍕\n'+describeCart(s,data));
 if(/\b(resumo|carrinho|como ficou|o que pedi|meu pedido)\b/.test(t))return answer('Seu carrinho desta simulação:\n'+describeCart(s,data)+'\n'+nextMissing(s));
 if(/\b(quanto fica|total do pedido|valor do pedido|quanto deu)\b/.test(t))return answer('Vou precisar consultar os preços atualizados de cada item e validar a entrega antes de informar o total. 🍕\n'+describeCart(s,data));
 if(/\b(tamanhos?|fatias)\b/.test(t))return answer('Nossos tamanhos são: '+data.sizes.map(x=>x.label+' ('+x.slices+' fatias)').join(', ')+'. Qual você prefere?');
 if(/\b(entrega|frete|taxa|demora|prazo)\b/.test(t))return answer('Para entrega, preciso verificar seu endereço e consultar a taxa e o prazo atuais. Sem essa consulta eu não vou inventar um valor. Qual é a rua, número, bairro e cidade?');
 if(/\b(fidelidade|premio|pontos)\b/.test(t))return answer('O programa de fidelidade depende do cadastro e das compras reais. A consulta ao saldo não está conectada nesta demonstração; a equipe poderá confirmar.');
 if(/\b(oi|ola|boa noite|boa tarde|bom dia|e ai|opa)\b/.test(t))return answer('Oi! 😊 Eu sou a assistente virtual da Guto Express. Quer uma ajudinha para escolher pizza, consultar sabores ou montar seu pedido?');
 if(/\b(cardapio|sabores|tradicionais|especiais|doces)\b/.test(t))return answer('Temos '+data.flavors.length+' sabores no catálogo de referência, como Calabresa, Frango com Catupiry, Portuguesa e Quatro Queijos. Você quer saber ingredientes ou montar uma pizza?');
 if(wantsItem)return answer('Com prazer! 🍕 Vamos montar seu pedido. Qual tamanho e sabor você quer?');
 return answer('Entendi! 😊 Para eu não anotar errado, pode me explicar com outras palavras? Posso ajudar com pizzas, bebidas e combos, ou encaminhar um atendimento humano.');
}
root.GutoSimulator={createSession,respond,describeCart};
})(typeof window!=='undefined'?window:globalThis);
