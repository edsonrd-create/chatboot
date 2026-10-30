import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {catalogFromPdvMenu} from '../src/pdv-catalog.mjs';
import {newSession,addPizza,addDrink,setFulfillment,setPayment,getSummary} from '../src/core.mjs';
import {buildPdvOrder,confirmationReply} from '../src/pdv-order.mjs';

const base=JSON.parse(fs.readFileSync(new URL('../config/business.json',import.meta.url),'utf8'));
const sz=p=>[{label:'Grande',priceCents:p,maxFlavors:3}];
const menu={ok:true,items:[{kind:'pizza',name:'Baiana',sizes:sz(5999)},{kind:'pizza',name:'Mussarela',sizes:sz(5999)},{kind:'item',name:'Coca-Cola 2L',category:'Bebidas',priceCents:1499}]};
function cart(){const b=catalogFromPdvMenu(menu,base);const s=newSession();s.customerPhone='5541999990000';s.customerName='Ana';
  addPizza(s,b,{size:'grande',flavors:['baiana','mussarela']});addDrink(s,b,{drinkId:b.drinks[0].id,quantity:2});setFulfillment(s,{method:'PICKUP'});setPayment(s,{method:'PIX'});return {b,s};}

test('monta o corpo no formato do PDV', ()=>{
  const {b,s}=cart();const body=buildPdvOrder(s,b,getSummary(s,b),'11111111-2222-3333-4444-555555555555');
  assert.match(body.externalId,/^[A-Za-z0-9:_-]{8,80}$/);
  assert.equal(body.paymentMethod,'pix');assert.equal(body.fulfillment,'pickup');
  assert.deepEqual(body.items[0],{name:'Baiana / Mussarela',sizeLabel:'Grande',qty:1,notes:''});
  assert.deepEqual(body.items[1],{name:'Coca-Cola 2L',sizeLabel:null,qty:2,notes:''});
});

test('modo ativo: devolve número, total do PDV e Pix; nunca diz pago', async ()=>{
  const {b,s}=cart();let sent;b.submitOrder=async x=>{sent=x;return {ok:true,number:42,totalCents:8997,pixCopiaECola:'000201PIXTESTE',paymentStatus:'pending'};};
  const q=getSummary(s,b);const msg=await confirmationReply(s,b,{requestId:'abcdefgh-1234',quote:q},'fallback');
  assert.ok(sent);assert.match(msg,/nº 42/);assert.match(msg,/R\$\s?89,97/);assert.match(msg,/000201PIXTESTE/);assert.doesNotMatch(msg,/pagamento (aprovado|confirmado)!/i);
});

test('modo teste mantém mensagem padrão; falha passa para atendente', async ()=>{
  const {b,s}=cart();const q=getSummary(s,b);
  b.submitOrder=async()=>({ok:true,dryRun:true});
  assert.equal(await confirmationReply(s,b,{requestId:'abcdefgh-1',quote:q},'padrao'),'padrao');
  b.submitOrder=async()=>({ok:false,error:'Endereço não validado'});
  assert.match(await confirmationReply(s,b,{requestId:'abcdefgh-2',quote:q},'padrao'),/atendente/);
  assert.equal(s.mode,'HUMAN');
  const s2=cart().s;b.submitOrder=async()=>{throw new Error('timeout');};
  await confirmationReply(s2,b,{requestId:'abcdefgh-3',quote:q},'padrao');assert.equal(s2.mode,'HUMAN');
});

test('pedido real guarda referência; consultar_pedido traz status do PDV', async ()=>{
  const {applyTool}=await import('../src/ai.mjs');
  const {b,s}=cart();b.submitOrder=async()=>({ok:true,number:9,totalCents:8997});
  await confirmationReply(s,b,{requestId:'abcdefgh-9',quote:getSummary(s,b)},'x');
  assert.deepEqual(s.orderRefs,['gutobot:abcdefgh-9']);
  b.orderStatus=async ids=>({ok:true,orders:[{externalId:ids[0],number:9,statusLabel:'No forno',totalCents:8997,paymentStatus:'paid'}]});
  const r=await applyTool('consultar_pedido',{},s,b,'');
  assert.equal(r.pedidos[0].status,'No forno');assert.equal(r.pedidos[0].pagamento,'pago');
  const vazio=await applyTool('consultar_pedido',{},newSession(),b,'');assert.equal(vazio.ok,false);
});
