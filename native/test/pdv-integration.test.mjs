import test from 'node:test';import assert from 'node:assert/strict';
import {PDV_DEFAULTS,validatePdvSettings,normalizePdvMenu,normalizePdvStore,pdvReadStatus,buildReadiness} from '../src/pdv-integration.mjs';
const allowed=['pdvgutoexpress.com.br'];
const valid={enabled:true,baseUrl:'https://pdvgutoexpress.com.br/',ordersMode:'DISABLED'};
const fixture={ok:true,items:[{id:21,name:'Calabresa',description:'Calabresa e mussarela',category:'Tradicionais',kind:'pizza',inStock:true,priceCents:5999,promoPriceCents:null,comboPriceCents:null,sizes:[{label:'Grande',priceCents:5999,maxFlavors:2}]}]};
test('modo de produção bloqueado por padrão',()=>{assert.equal(PDV_DEFAULTS.enabled,false);assert.equal(PDV_DEFAULTS.ordersMode,'DISABLED');assert.equal(buildReadiness({aiKeyConfigured:true,chatwootConfigured:true,pdvTest:{ok:true,at:'2026-10-26'}}).ready,false)});
test('configuração segura do PDV',()=>assert.deepEqual(validatePdvSettings(valid,{allowedHosts:allowed}),{...valid,baseUrl:'https://pdvgutoexpress.com.br'}));
for(const baseUrl of ['http://pdvgutoexpress.com.br/','https://localhost/','https://127.0.0.1/','https://pdvgutoexpress.com.br.evil.tld/','https://pdvgutoexpress.com.br:8443/','https://root:pw@pdvgutoexpress.com.br/','https://pdvgutoexpress.com.br/a','https://pdvgutoexpress.com.br/?a=b']){
 test('rejeita host/esquema não autorizado '+baseUrl,()=>assert.throws(()=>validatePdvSettings({...valid,baseUrl},{allowedHosts:allowed}),/não autorizado/));
}
test('bloqueia envio de pedidos não homologado',()=>assert.throws(()=>validatePdvSettings({...valid,ordersMode:'ACTIVE'},{allowedHosts:allowed}),/bloqueado/));
test('normaliza itens sem expor custos internos',()=>{const x=normalizePdvMenu(fixture);assert.equal(x.items[0].name,'Calabresa');assert.equal(x.items[0].sizes[0].priceCents,5999);assert.equal(x.readOnly,true)});
test('rejeita IDs duplicados',()=>assert.throws(()=>normalizePdvMenu({...fixture,items:[fixture.items[0],fixture.items[0]]}),/duplicados/));
test('rejeita preço inválido',()=>assert.throws(()=>normalizePdvMenu({...fixture,items:[{...fixture.items[0],priceCents:-1}]}),/Preço/));
test('valida disponibilidade da loja',()=>assert.equal(normalizePdvStore({ok:true,open:false,delivery:false,pickup:true}).pickup,true));
test('rejeita resposta incompleta da loja',()=>assert.throws(()=>normalizePdvStore({ok:true,open:true}),/incompatível/));
test('consulta PDV somente leitura e caminhos conhecidos',async()=>{
 const calls=[];const fake=async(u,opts)=>{calls.push({u,opts});return {ok:true,headers:{get:()=> 'application/json; charset=utf-8'},text:async()=>JSON.stringify(u.endsWith('menu')?fixture:{ok:true,open:true,delivery:true,pickup:true,name:'Guto Express'})};};
 const result=await pdvReadStatus(valid,{allowedHosts:allowed,fetchImpl:fake});assert.equal(result.catalog.items.length,1);assert.equal(result.operation.open,true);assert.deepEqual(calls.map(x=>new URL(x.u).pathname),['/api/v1/menu','/api/v1/store']);assert.ok(calls.every(x=>x.opts.method==='GET'&&x.opts.redirect==='error'));
});
test('nenhum pedido real pode ser escrito',()=>{const x=buildReadiness({aiKeyConfigured:true,chatwootConfigured:true,liveEnabled:true,pdvTest:{ok:true,at:'today'}});assert.equal(x.canWritePdv,false);assert.equal(x.canAutoReply,false)});
test('falha fechada quando o PDV retorna 503',async()=>await assert.rejects(()=>pdvReadStatus(valid,{allowedHosts:allowed,fetchImpl:async()=>({ok:false,status:503})}),/503/));
test('PDV desativado impede consulta externa',async()=>await assert.rejects(()=>pdvReadStatus(PDV_DEFAULTS,{allowedHosts:allowed,fetchImpl:()=>{throw Error('Nao deve chamar');}}),/desativada/));
