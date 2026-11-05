import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {newSession,addPizza} from '../src/core.mjs';
import {intelligentReply,isNewOrderIntent} from '../src/ai.mjs';

const business=JSON.parse(fs.readFileSync(new URL('../config/business.json',import.meta.url),'utf8'));
for(const phrase of ['novo pedido','Novo pedido!','Quero fazer outro pedido','vamos fazer um novo pedido','começar outro pedido','limpar o carrinho']){
 test('reconhece comando real: '+phrase,()=>assert.equal(isNewOrderIntent(phrase),true));
}
for(const phrase of ['quero pizza grande','o pedido novo já chegou?','quero confirmar o pedido']){
 test('não trata outra intenção como novo pedido: '+phrase,()=>assert.equal(isNewOrderIntent(phrase),false));
}
test('novo pedido limpa compras antigas e não antecipa nome ou pagamento',async()=>{
 const session=newSession();
 session.customerPhone='5541999990000';
 addPizza(session,business,{size:'grande',flavors:['calabresa']});
 session.payment='DINHEIRO';
 session.cashChangeNeeded=true;
 session.cashReceivedCents=10000;
 session.customerName='Ana Silva';
 session.customerNameConfirmed=true;
 session.history=[{role:'assistant',content:'🍕 Certo! Começamos um pedido novo, sem os produtos anteriores. Qual pizza ou combo você deseja? Vou perguntar seu nome e a forma de pagamento novamente.'}];
 const reply=await intelligentReply('Novo pedido!',session,business,{});
 assert.match(reply,/Qual sabor ou combo você prefere/);
 assert.doesNotMatch(reply,/nome|pagamento|carrinho|anteriores/i);
 assert.equal(session.cart.length,0);
 assert.equal(session.history.length,0);
 assert.equal(session.payment,null);
 assert.equal(session.customerNameConfirmed,false);
 assert.equal(session.cashReceivedCents,null);
});
test('repetir comando não restaura carrinho e não pede dados antes da escolha',async()=>{
 const session=newSession();
 const first=await intelligentReply('quero fazer outro pedido',session,business,{});
 const next=await intelligentReply('novo pedido',session,business,{});
 assert.equal(first,next);
 assert.equal(session.cart.length,0);
 assert.doesNotMatch(next,/nome|forma de pagamento/i);
});
