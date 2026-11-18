// Montagem determinística: um combo é UM item do PDV, nunca pizzas avulsas.
import crypto from 'node:crypto';
const norm=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\bcom\b/g,' ').replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');
const options=(items)=>items.map(v=>'• '+v.label).join('\n');
export function findComboRequest(text,business){
 const q=norm(text);
 if(!/\b(combo|familia|promocao)\b/.test(q))return null;
 const combos=(business.combos||[]).filter(x=>x.available!==false);
 return combos.find(c=>q.includes(norm(c.label)) && norm(c.label).length>3) ||
   combos.find(c=>q.includes('familia')&&norm(c.label).includes('familia')) || null;
}
function slotFlavors(combo,slot,business){
 const allowed=new Set(slot.allowedFlavorIds||[]);
 return (business.flavors||[]).filter(f=>f.available && allowed.has(f.productId) && business.pizzas?.[f.id]?.[norm(slot.sizeHint)]!==undefined);
}
function slotDrinks(combo,slot,business){
 const allowed=new Set(slot.allowedDrinkIds||[]);
 return (business.drinks||[]).filter(d=>d.available && allowed.has(d.productId));
}
export function startCombo(session,combo,business){
 const rules=combo?.comboRules;
 if(!rules || !Array.isArray(rules.pizzaSlots)||!rules.pizzaSlots.length || !Number.isSafeInteger(combo.botCheckoutPriceCents)||combo.botCheckoutPriceCents<=0)
   return {ok:false,error:'O PDV ainda não informou a composição e o preço verificáveis deste combo.'};
 if(!Array.isArray(rules.drinkSlots))return {ok:false,error:'Falta a configuração de bebidas do combo no PDV.'};
 for(const slot of rules.pizzaSlots){
  if(!slotFlavors(combo,slot,business).length)return {ok:false,error:'Nenhum sabor autorizado disponível na pizza '+slot.label+'.'};
 }
 for(const slot of rules.drinkSlots){
  if(!slotDrinks(combo,slot,business).length)return {ok:false,error:'Nenhuma bebida autorizada disponível para '+slot.label+'.'};
 }
 session.comboDraft={comboId:combo.id,stage:'pizza',index:0,pizzas:[],drinks:[],startedAt:new Date().toISOString()};
 return {ok:true,reply:nextComboQuestion(session,business)};
}
export function nextComboQuestion(session,business){
 const draft=session.comboDraft;const combo=(business.combos||[]).find(c=>c.id===draft?.comboId);
 if(!combo)return 'Não encontrei este combo no cardápio atual do PDV.';
 if(draft.stage==='pizza'){
  const slot=combo.comboRules.pizzaSlots[draft.index];const permitted=slotFlavors(combo,slot,business);
  return '🍕 *'+combo.label+'* — Pizza '+(draft.index+1)+' de '+combo.comboRules.pizzaSlots.length+' ('+slot.label+').\nEscolha até '+slot.maxFlavors+' sabor(es):\n'+options(permitted)+'\n\nEscreva os sabores separados por vírgula.';
 }
 const slot=combo.comboRules.drinkSlots[draft.index];const permitted=slotDrinks(combo,slot,business);
 return '🥤 Agora escolha a bebida inclusa ('+slot.label+'):\n'+options(permitted);
}
function matchAnswers(message,candidates){
 const parts=String(message||'').split(/\s*[,;/+]\s*/).map(norm).filter(Boolean);
 if(!parts.length)return null;
 const chosen=[];
 for(const value of parts){
  const found=candidates.filter(f=>norm(f.label)===value || norm(f.label).replace(/\bde\b/g,'').trim()===value);
  if(found.length!==1||chosen.some(x=>x.id===found[0].id))return null;
  chosen.push(found[0]);
 }
 return chosen;
}
export function consumeCombo(session,text,business){
 const draft=session.comboDraft;if(!draft)return null;
 const combo=(business.combos||[]).find(c=>c.id===draft.comboId);
 if(!combo||!combo.comboRules){session.comboDraft=null;return {ok:false,error:'O combo foi removido ou alterado no PDV. Vou chamar a equipe.'};}
 if(draft.stage==='pizza'){
  const slot=combo.comboRules.pizzaSlots[draft.index];if(!slot){session.comboDraft=null;return {ok:false,error:'Composição inválida no PDV.'};}
  const valid=slotFlavors(combo,slot,business),chosen=matchAnswers(text,valid);
  if(!chosen||chosen.length>slot.maxFlavors)
   return {ok:true,reply:'Por favor, escolha de 1 a '+slot.maxFlavors+' sabor(es) da lista oficial para '+slot.label+'.\n'+options(valid)};
  draft.pizzas.push({label:slot.label,flavors:chosen.map(c=>c.label)});
  draft.index++;
  if(draft.index<combo.comboRules.pizzaSlots.length)return {ok:true,reply:nextComboQuestion(session,business)};
  draft.stage='drink';draft.index=0;
 }
 if(draft.stage==='drink'){
  if(combo.comboRules.drinkSlots.length===0)return finishCombo(session,combo);
  // Não interpretar a resposta sobre a última pizza como escolha da bebida.
  if(draft.pizzas.length===combo.comboRules.pizzaSlots.length && draft.drinks.length===0 && draft.index===0 && !/\b(coca|guarana|fanta|sprite|cini|refrigerante|refri)\b/i.test(text))
    return {ok:true,reply:nextComboQuestion(session,business)};
  const slot=combo.comboRules.drinkSlots[draft.index],valid=slotDrinks(combo,slot,business);
  const chosen=matchAnswers(text,valid);
  if(!chosen||chosen.length!==1)return {ok:true,reply:'Preciso que escolha uma bebida exata da lista:\n'+options(valid)};
  draft.drinks.push(chosen[0].label);draft.index++;
  if(draft.index<combo.comboRules.drinkSlots.length)return {ok:true,reply:nextComboQuestion(session,business)};
 }
 return finishCombo(session,combo);
}
function finishCombo(session,combo){
 const draft=session.comboDraft;
 if(!draft||draft.pizzas.length!==combo.comboRules.pizzaSlots.length||draft.drinks.length!==combo.comboRules.drinkSlots.length)
  return {ok:false,error:'Faltam ingredientes do combo.'};
 const notes=[...draft.pizzas.map(p=>p.label+': '+p.flavors.join(' / ')),...(draft.drinks.length?['Refri: '+draft.drinks.join(' / ')]:[])].join(' · ');
 if(notes.length>200)return {ok:false,error:'Composição do combo excedeu o limite do PDV. Vou chamar um atendente.'};
 session.cart.push({id:crypto.randomUUID(),kind:'combo',comboId:combo.id,productId:combo.productId,description:combo.label,quantity:1,notes,unitPriceCents:combo.botCheckoutPriceCents});
 session.comboDraft=null;session.comboReview=null;
 session.awaitingConfirmation=false;session.quotePresented=false;session.quoteSnapshot=null;session.confirmedRequestId=null;
 return {ok:true,finished:true,reply:'✅ *'+combo.label+'* montado!\n'+draft.pizzas.map(p=>p.label+': '+p.flavors.join(' / ')).join('\n')+
 (draft.drinks.length?'\nBebida: '+draft.drinks.join(', '):'')+
 '\nPreço do combo no PDV: '+new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(combo.botCheckoutPriceCents/100)+
 '\n\nDeseja acrescentar algo ou *fechar o pedido*?'};
}
