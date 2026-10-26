import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const base=new URL('../',import.meta.url);
const catalog=JSON.parse(fs.readFileSync(new URL('config/cardapio-publico.json',base),'utf8'));
const suite=JSON.parse(fs.readFileSync(new URL('training/realistic-cases.json',base),'utf8'));
const ctx={Intl};vm.createContext(ctx);vm.runInContext(fs.readFileSync(new URL('public/simulator.js',base),'utf8'),ctx);
const {createSession,respond}=ctx.GutoSimulator;
for(const scenario of suite.cases){
 test('conversa realista — '+scenario.id,()=>{
   const s=createSession();let last='';for(const [i,message] of scenario.messages.entries()){last=respond(message,s,catalog);assert.equal(typeof last,'string');assert.ok(last.length>15);if(scenario.turnChecks?.[i]!=null)assert.match(last,new RegExp(scenario.turnChecks[i],'i'),scenario.id+': resposta à mensagem '+(i+1));assert.doesNotMatch(last,/pedido (foi )?(confirmado|enviado para a cozinha)|pagamento aprovado/i,'simulação não pode inventar operação real');}
   const e=scenario.expect;
   if(e.pizzas!=null)assert.equal(s.cart.filter(c=>c.kind==='pizza').length,e.pizzas,scenario.id+': pizzas');
   if(e.drinks!=null)assert.equal(s.cart.filter(c=>c.kind==='drink').length,e.drinks,scenario.id+': bebidas');
   if(e.pizzaSize)assert.equal(s.cart.find(c=>c.kind==='pizza')?.size,e.pizzaSize);
   if(e.pizzaQuantity)assert.equal(s.cart.find(c=>c.kind==='pizza')?.quantity,e.pizzaQuantity);
   if(e.pizzaFlavors)assert.deepEqual([...s.cart.find(c=>c.kind==='pizza').flavors].sort(),[...e.pizzaFlavors].sort());
   if(e.payment)assert.equal(s.payment,e.payment);
   if(e.address!=null)assert.equal(Boolean(s.address),e.address);
   if(e.delivery)assert.equal(s.delivery,e.delivery);
   if(e.human!=null)assert.equal(s.human,e.human);
   if(e.pendingCombo)assert.equal(s.pendingCombo,e.pendingCombo);
   if(e.notes)assert.deepEqual([...s.cart.find(c=>c.kind==='pizza')?.notes||[]],[...e.notes]);
   if(e.text)assert.match(last,new RegExp(e.text,'i'));
   assert.ok(!('confirmedRequestId' in s),'demonstração não confirma pedidos');
 });
}
test('dois números devem ter sessões separadas para a mesma frase',()=>{
 const a=createSession(),b=createSession();respond('quero uma grande de calabresa',a,catalog);respond('quero uma média de portuguesa',b,catalog);
 assert.equal(a.cart[0].size,'grande');assert.equal(b.cart[0].size,'media');
 respond('cancela tudo',a,catalog);assert.equal(a.cart.length,0);assert.equal(b.cart.length,1);
});
test('confirmações repetidas nunca criam pedido nem pagamento no simulador',()=>{
 const s=createSession();respond('uma grande de calabresa',s,catalog);
 for(const x of ['confirmo','confirmo','pode fechar'])assert.match(respond(x,s,catalog),/não vou registrar/);
 assert.equal(s.cart.length,1);
});
test('frases semelhantes com endereços distintos ficam isoladas',()=>{
 const a=createSession(),b=createSession();respond('Rua Afonso Pena 12 Centro Colombo',a,catalog);respond('Avenida Brasil 99 Jardim Curitiba',b,catalog);
 assert.ok(a.address?.includes('Afonso'));assert.ok(b.address?.includes('Brasil'));
});
