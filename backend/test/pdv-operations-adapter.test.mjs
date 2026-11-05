import test from 'node:test';
import assert from 'node:assert/strict';
import {readMyPdvOrders,readPdvOperationsSummary} from '../src/pdv-operations-adapter.mjs';

const cfg={
 PDV_OPERATIONS_READ_ENABLED:'true',
 PDV_OPERATIONS_API_URL:'https://pdv-preview.example.test/api/v1/bot-operations',
 PDV_OPERATIONS_READ_TOKEN:'x'.repeat(48),
};
test('conexão operacional permanece desligada por padrão e sem consulta de terceiros',async()=>{
 let calls=0;
 const stub=async()=>{calls++;throw Error('não deve acessar API');};
 assert.equal((await readMyPdvOrders({...cfg,PDV_OPERATIONS_READ_ENABLED:'false'},'+5541999998888',null,stub)).error,'PDV_OPERATIONS_DISABLED');
 assert.equal((await readMyPdvOrders(cfg,'41999998888',null,stub)).error,'WHATSAPP_IDENTITY_REQUIRED');
 assert.equal((await readMyPdvOrders(cfg,'+5541999998888',-1,stub)).error,'INVALID_ORDER_NUMBER');
 assert.equal(calls,0);
});
test('somente telefone confiável do WhatsApp vai para consulta ao próprio pedido',async()=>{
 let calls=0;
 const fetchMock=async(url,options)=>{
   calls++;
   assert.equal(url,cfg.PDV_OPERATIONS_API_URL);
   assert.equal(options.method,'POST');
   assert.equal(options.headers.authorization,'Bearer '+cfg.PDV_OPERATIONS_READ_TOKEN);
   assert.deepEqual(JSON.parse(options.body),{action:'my_orders',phone:'+5541999998888',orderNumber:123});
   return {ok:true,json:async()=>({ok:true,orders:[{number:123,status:'dispatched',channel:'ifood',fulfillment:'delivery',address:'NÃO EXPOR',customerPhone:'NÃO EXPOR'}]})};
 };
 const out=await readMyPdvOrders(cfg,'+5541999998888',123,fetchMock);
 assert.equal(out.ok,true);
 assert.equal(out.orders.length,1);
 assert.equal(out.orders[0].channel,'ifood');
 assert.equal('address' in out.orders[0],false);
 assert.equal('customerPhone' in out.orders[0],false);
 assert.equal(calls,1);
});
test('erro de API bloqueia consulta, sem inventar status',async()=>{
 const out=await readMyPdvOrders(cfg,'+5541999998888',null,async()=>({ok:false,status:503}));
 assert.equal(out.ok,false);assert.equal(out.error,'PDV_HTTP_503');
});
test('consulta administrativa recebe apenas indicadores agregados de marketplace e entregas',async()=>{
 const out=await readPdvOperationsSummary(cfg,async(_url,options)=>{
   assert.deepEqual(JSON.parse(options.body),{action:'operations_summary'});
   return {ok:true,json:async()=>({ok:true,orders:[{channel:'99food',status:'ready',count:3},{channel:'ifood',status:'new',count:2}],deliveries:[{status:'dispatched',count:1}]})};
 });
 assert.equal(out.ok,true);assert.equal(out.orders.length,2);assert.equal(out.deliveries[0].count,1);
});
