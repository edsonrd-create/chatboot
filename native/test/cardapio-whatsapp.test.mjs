import test from 'node:test';
import assert from 'node:assert/strict';
import {cardapioChoice,asksForMenu,isCommerceIntent} from '../src/cardapio-whatsapp.mjs';
import {intelligentReply} from '../src/ai.mjs';

test('pedido de cardápio prioriza app e site',()=>{
 const session={};
 const out=cardapioChoice(session,'Pode mandar o cardápio?',{catalogSynced:true});
 assert.match(out.reply,/www.gutoexpress.com.br/);
 assert.match(out.reply,/play.google.com/);
 assert.match(out.reply,/WhatsApp/);
 assert.equal(session.cardapioChannel,'choosing');
});
test('opção 2 usa apenas catálogo previamente sincronizado',()=>{
 const session={};
 cardapioChoice(session,'cardápio',{catalogSynced:true});
 const result=cardapioChoice(session,'2',{catalogSynced:true});
 assert.equal(result.channel,'whatsapp');
 assert.match(result.reply,/PDV/);
});
test('PDV indisponível: não promete preço nem confirma pedido',()=>{
 const session={};
 cardapioChoice(session,'cardápio',{catalogSynced:false});
 const out=cardapioChoice(session,'2',{catalogSynced:false});
 assert.match(out.reply,/indisponível/);
 assert.doesNotMatch(out.reply,/R\$\s*\d+/);
});
test('o cliente pode começar a pedir sem interromper por menu',()=>{
 const session={};
 assert.equal(cardapioChoice(session,'Quero pizza grande de calabresa'),null);
 assert.equal(isCommerceIntent('Quero saber o preço da Big'),true);
 assert.equal(asksForMenu('qual horário?'),false);
});
test('motor de IA bloqueia cotação sem sincronização mesmo com cache',async()=>{
 const session={};
 const out=await intelligentReply('Qual preço da pizza grande?',session,{},{
  menuFlowEnabled:true,catalogSynced:false,apiKey:'fake'
 });
 assert.match(out,/não vou confirmar seu pedido|nao vou confirmar seu pedido/i);
});
test('opção pelo WhatsApp funciona sem chamar provedor de IA',async()=>{
 const session={};
 const a=await intelligentReply('cardápio',session,{},{
  menuFlowEnabled:true,catalogSynced:true,apiKey:'fake'
 });
 assert.match(a,/app ou site/);
 const b=await intelligentReply('2',session,{},{
  menuFlowEnabled:true,catalogSynced:true,apiKey:'fake'
 });
 assert.match(b,/PDV/);
});
