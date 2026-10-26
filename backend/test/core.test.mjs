import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyChatwootSignature,normalizeEvent,newSession,addPizza,addDrink,getSummary,setAddress,setPayment,requestConfirmation,confirmRequest,quoteFingerprint} from '../src/core.mjs';
import {applyTool,explicitYes,wantsHuman,localReply} from '../src/ai.mjs';
import {FileStore} from '../src/store.mjs';
import os from 'node:os';
const business=JSON.parse(fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../config/business.json'),'utf8'));
function validBusiness(){const b=structuredClone(business);b.pizzas.calabresa.grande=5999;b.pizzas.frango_catupiry.grande=6499;b.drinks[0].priceCents=1200;b.halfHalfPricing='MAX';b.deliveryFeeCents=700;return b;}
const event={event:'message_created',id:900,content:'Oi',message_type:'incoming',private:false,inbox:{id:11},account:{id:9},conversation:{id:88,inbox_id:11},sender:{name:'Cliente'}};
test('Chatwoot assinatura é conferida sobre bytes brutos e timestamp',()=>{
 const b=Buffer.from('{"event":"message_created"}');const timestamp=String(Math.floor(Date.now()/1000));
 const signature='sha256='+crypto.createHmac('sha256','secret').update(`${timestamp}.`).update(b).digest('hex');
 assert.equal(verifyChatwootSignature(b,timestamp,signature,'secret'),true);
 assert.equal(verifyChatwootSignature(Buffer.concat([b,Buffer.from(' ')]),timestamp,signature,'secret'),false);
 assert.equal(verifyChatwootSignature(b,timestamp,'sha256='+'a'.repeat(64),'secret'),false);
 assert.equal(verifyChatwootSignature(b,String(Number(timestamp)-600),signature,'secret'),false);
 assert.equal(verifyChatwootSignature(b,timestamp,'malformed','secret'),false);
});
test('somente mensagens recebidas de canais autorizados são processadas',()=>{
 const e=normalizeEvent(event,[11,22],9);assert.equal(e.key,'9:11:88');assert.equal(e.eventKey,'9:900');
 assert.equal(normalizeEvent({...event,inbox:{id:33}},[11,22],9),null);
 assert.equal(normalizeEvent({...event,account:{id:8}},[11,22],9),null);
 assert.equal(normalizeEvent({...event,message_type:'outgoing'},[11,22],9),null);
 assert.equal(normalizeEvent({...event,private:true},[11,22],9),null);
});
test('meio a meio é cotado com política de maior preço',()=>{
 const b=validBusiness(),s=newSession();assert.equal(addPizza(s,b,{size:'grande',flavors:['calabresa','frango_catupiry']}).ok,true);
 assert.equal(getSummary(s,b).items[0].unitPriceCents,6499);
});
test('sem política de meia a meia a IA não inventa preço',()=>{
 const b=validBusiness(),s=newSession();b.halfHalfPricing=null;
 addPizza(s,b,{size:'grande',flavors:['calabresa','frango_catupiry']});
 assert.equal(getSummary(s,b).subtotalCents,null);
 assert.ok(getSummary(s,b).missing.includes('preços válidos'));
});
test('sem preço ou entrega não registra solicitação',()=>{
 const b=structuredClone(business),s=newSession();addPizza(s,b,{size:'grande',flavors:['calabresa']});
 setAddress(s,{address:'Rua Exemplo 100 Bairro Centro, Curitiba'});setPayment(s,{method:'PIX'});
 assert.equal(requestConfirmation(s,b).ok,false);assert.equal(confirmRequest(s,b,{explicitConfirmation:true}).ok,false);
});
test('suporta pedido com bebida, endereço e total em centavos',()=>{
 const b=validBusiness(),s=newSession();addPizza(s,b,{size:'grande',flavors:['calabresa']});addDrink(s,b,{drinkId:'cini_abacaxi_2l'});
 setAddress(s,{address:'Rua das Palmeiras 100, Bairro Jardim, Curitiba'});setPayment(s,{method:'PIX'});
 const q=getSummary(s,b);assert.equal(q.subtotalCents,7199);assert.equal(q.deliveryFeeCents,700);assert.equal(q.totalCents,7899);
});
test('não confirma sem resumo efetivamente apresentado ao cliente',()=>{
 const b=validBusiness(),s=newSession();addPizza(s,b,{size:'grande',flavors:['calabresa']});setAddress(s,{address:'Rua Exemplo 100, bairro centro, Curitiba'});setPayment(s,{method:'PIX'});
 assert.equal(requestConfirmation(s,b).ok,true);
 assert.equal(confirmRequest(s,b,{explicitConfirmation:true}).ok,false);
 s.quotePresented=true;
 assert.equal(confirmRequest(s,b,{explicitConfirmation:true}).ok,true);
});
test('duplicação da confirmação mantém mesmo identificador',()=>{
 const b=validBusiness(),s=newSession();addPizza(s,b,{size:'grande',flavors:['calabresa']});setAddress(s,{address:'Rua Exemplo 100, bairro centro, Curitiba'});setPayment(s,{method:'PIX'});
 requestConfirmation(s,b);s.quotePresented=true;
 const first=confirmRequest(s,b,{explicitConfirmation:true});const second=confirmRequest(s,b,{explicitConfirmation:true});
 assert.equal(first.requestId,second.requestId);
});
test('alteração de preço entre orçamento e confirmação bloqueia registro',()=>{
 const b=validBusiness(),s=newSession();addPizza(s,b,{size:'grande',flavors:['calabresa']});setAddress(s,{address:'Rua Exemplo 100, bairro centro, Curitiba'});setPayment(s,{method:'PIX'});
 requestConfirmation(s,b);s.quotePresented=true;b.pizzas.calabresa.grande=6999;
 assert.equal(confirmRequest(s,b,{explicitConfirmation:true}).ok,false);
});
test('alterar endereço invalida orçamento anterior',()=>{
 const b=validBusiness(),s=newSession();addPizza(s,b,{size:'grande',flavors:['calabresa']});setAddress(s,{address:'Rua Exemplo 100, bairro centro, Curitiba'});setPayment(s,{method:'PIX'});
 requestConfirmation(s,b);s.quotePresented=true;
 setAddress(s,{address:'Rua Exemplo 111, bairro centro, Curitiba'});
 assert.equal(confirmRequest(s,b,{explicitConfirmation:true}).ok,false);
});
test('expressões de confirmação restritas: não aceita pergunta ou resposta ambígua',()=>{
 assert.equal(explicitYes('Confirmo'),true);assert.equal(explicitYes('sim'),true);
 assert.equal(explicitYes('sim, mas troca a pizza'),false);
 assert.equal(explicitYes('acho que sim'),false);
});
test('atendimento humano solicitado desativa bot local',()=>{
 const s=newSession();assert.equal(wantsHuman('Quero falar com um atendente'),true);
 const response=localReply('Quero falar com um atendente',s,business);
 assert.equal(s.mode,'HUMAN');assert.match(response,/equipe/i);
});
test('valida quantidade, tamanho e disponibilidade sem modificar carrinho',()=>{
 const b=validBusiness(),s=newSession();
 assert.equal(addPizza(s,b,{size:'enorme',flavors:['calabresa']}).ok,false);
 assert.equal(addPizza(s,b,{size:'grande',flavors:['calabresa'],quantity:-1}).ok,false);
 assert.equal(addPizza(s,b,{size:'grande',flavors:['inventado']}).ok,false);
 assert.equal(s.cart.length,0);
});
test('FileStore persiste operações e serializa gravações',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gutobot-test-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const file=path.join(dir,'state.json'),store=new FileStore(file).init();
 await Promise.all(Array.from({length:30},()=>store.tx(d=>{d.nextOrder++;})));
 assert.equal(store.snapshot().nextOrder,31);assert.equal(new FileStore(file).init().snapshot().nextOrder,31);
});
