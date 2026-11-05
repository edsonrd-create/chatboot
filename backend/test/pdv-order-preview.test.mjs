import test from 'node:test';
import assert from 'node:assert/strict';
import {buildPdvDryRunPayload,previewPdvOrder} from '../src/pdv-order-preview.mjs';

const session={customerName:'Cliente Teste',customerPhone:'+5541999998888',payment:'PIX',
 address:null,neighborhood:null};
const business={sizes:[{id:'grande',label:'Grande',slices:10}]};
const confirmation={requestId:'123e4567-e89b-12d3-a456-426614174000',quote:{
 missing:[],fulfillment:'PICKUP',items:[{kind:'pizza',size:'grande',description:'Pizza Grande, Calabresa',quantity:1,unitPriceCents:5999}]
}};
const cfg={PDV_BOT_ORDER_TEST_ENABLED:'true',
 PDV_BOT_ORDER_API_URL:'https://pdv-preview.example.test/api/v1/bot/order',
 PDV_BOT_ORDER_TOKEN:'x'.repeat(40)};
test('monta pedido para pré-validação sem confiar em preço enviado pelo cliente',()=>{
 const out=buildPdvDryRunPayload(confirmation,session,business);
 assert.equal(out.ok,true);assert.equal(out.payload.fulfillment,'pickup');
 assert.equal(out.payload.items[0].sizeLabel,'Grande');
 assert.equal(out.payload.items[0].qty,1);
 assert.equal('unitPriceCents' in out.payload.items[0],false);
 assert.equal(out.payload.externalId,'WA-123e4567e89b12d3a456426614174000');
});
test('entrega sem bairro explícito não pode ser pré-validada',()=>{
 const draft=structuredClone(confirmation);draft.quote.fulfillment='DELIVERY';
 const out=buildPdvDryRunPayload(draft,{...session,address:'Rua Exemplo 100, Colombo'},business);
 assert.equal(out.ok,false);assert.equal(out.error,'DELIVERY_NEIGHBORHOOD_REQUIRED');
});
test('a integração está desligada por padrão',async()=>{
 let calls=0;
 const r=await previewPdvOrder({...cfg,PDV_BOT_ORDER_TEST_ENABLED:'false'},confirmation,session,business,async()=>{calls++;return {}});
 assert.equal(r.ok,false);assert.equal(calls,0);
});
test('não aceita retorno de PDV ativo, evitando criar venda real',async()=>{
 const result=await previewPdvOrder(cfg,confirmation,session,business,
 async()=>({ok:true,json:async()=>({ok:true,mode:'active',number:123})}));
 assert.equal(result.ok,false);assert.equal(result.error,'PDV_NOT_IN_TEST_MODE');
});
test('aceita somente resposta dry-run sem gravação',async()=>{
 let calls=0;
 const result=await previewPdvOrder(cfg,confirmation,session,business,async(url,options)=>{
   calls++;assert.equal(url,cfg.PDV_BOT_ORDER_API_URL);
   const p=JSON.parse(options.body);assert.equal(p.customerName,'Cliente Teste');
   assert.equal(p.paymentMethod,'pix');assert.equal(p.items.length,1);
   return {ok:true,json:async()=>({ok:true,dryRun:true,mode:'test'})};
 });
 assert.equal(result.ok,true);assert.equal(result.dryRun,true);assert.equal(calls,1);
});
