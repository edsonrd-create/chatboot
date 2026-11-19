import test from 'node:test';
import assert from 'node:assert/strict';
import {newSession,confirmRequest} from '../src/core.mjs';
import {intelligentReply} from '../src/ai.mjs';

const business={
  sizes:[],flavors:[],drinks:[],pizzas:{},halfHalfPricing:'MAX',
  combos:[],faq:{entrega:'Consulte a equipe'},greeting:'Olá!',
};

test('confirmacao antiga (21 min) nao cria pedido e reinicia o atendimento',async()=>{
  const session=newSession();
  session.awaitingConfirmation=true;
  session.quotePresented=true;
  session.quoteSnapshot='resumo-antigo';
  session.quoteIssuedAt=Date.now()-21*60_000;
  session.cart=[{id:'produto-antigo',kind:'pizza'}];
  session.history=[{role:'assistant',content:'resumo antigo'}];
  const reply=await intelligentReply('confirmo',session,business,{});
  assert.match(reply,/venceu ap[oó]s 20 minutos/i);
  assert.equal(session.cart.length,0);
  assert.equal(session.history.length,0);
  assert.equal(session.awaitingConfirmation,false);
  assert.equal(session.quoteSnapshot,null);
  assert.equal(session.confirmedRequestId,null);
  assert.equal(session.lastConfirmed,null);
});

test('funcao de confirmacao rejeita resumo vencido sem emitir ID',()=>{
  const session=newSession();
  session.awaitingConfirmation=true;
  session.quotePresented=true;
  session.quoteSnapshot='antigo';
  session.quoteIssuedAt=Date.now()-21*60_000;
  const result=confirmRequest(session,business,{explicitConfirmation:true});
  assert.equal(result.ok,false);
  assert.equal(session.confirmedRequestId,null);
  assert.match(result.error,/expirou/i);
});

test('prazo oficial do PDV aparece em pergunta explicita e sem estimativa inventada',async()=>{
  const session=newSession();
  const withEta=await intelligentReply('qual o prazo de entrega?',session,{...business,pdvDeliveryWindow:'40 a 55 minutos'},{});
  assert.match(withEta,/40 a 55 minutos/);
  const withoutEta=await intelligentReply('qual o prazo de entrega?',newSession(),business,{});
  assert.match(withoutEta,/n[aã]o consegui consultar/i);
  assert.doesNotMatch(withoutEta,/40 a 55 minutos/);
});
