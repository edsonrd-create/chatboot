import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const catalogBlock = html.match(/<script id="catalogData" type="application\/json">([\s\S]*?)<\/script>/);
assert.ok(catalogBlock, 'Catálogo ausente na prévia');
const catalog = JSON.parse(catalogBlock[1]);
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
assert.ok(scripts.length > 0, 'Motor de simulação ausente na prévia');
const sandbox = { Intl };
vm.createContext(sandbox);
vm.runInContext(scripts[0][1], sandbox);
const { createSession, respond } = sandbox.GutoSimulator;
const cases = [
  {name:'pedido livre e cumprimento',messages:['oi boa noite','me vê uma grande de calabresa'],pizzas:1,size:'grande',flavors:['calabresa']},
  {name:'meio a meio em um turno',messages:['uma grande metade calabresa metade frango com catupiry'],pizzas:1,flavors:['calabresa','frango_catupiry']},
  {name:'meio a meio em mensagens separadas',messages:['uma média metade calabresa','a outra metade portuguesa'],pizzas:1,flavors:['calabresa','portuguesa']},
  {name:'gírias e erro ortográfico',messages:['manda 2 pizzas grandes de calabreza'],pizzas:1,quantity:2,flavors:['calabresa']},
  {name:'dados misturados no primeiro texto',messages:['manda uma grande calabresa com coca 2 litros, pix, Rua das Flores 123, Centro, Colombo'],pizzas:1,drinks:1,payment:'PIX',address:true},
  {name:'pedido com dois tamanhos',messages:['uma grande calabresa e uma média portuguesa'],pizzas:2},
  {name:'pergunta durante compra preserva carrinho',messages:['uma grande calabresa','o que vai na portuguesa?'],pizzas:1,flavors:['calabresa'],last:/ovos/i},
  {name:'referência ao sabor anterior',messages:['tem calabresa?','manda uma grande dela'],pizzas:1,flavors:['calabresa']},
  {name:'alteração de sabor',messages:['uma grande calabresa','troca calabresa por portuguesa'],pizzas:1,flavors:['portuguesa']},
  {name:'alteração ambígua de duas unidades',messages:['duas pizzas grandes de calabresa','troca calabresa por portuguesa'],pizzas:1,quantity:2,flavors:['calabresa'],last:/qual delas/i},
  {name:'bebida sem tamanho',messages:['bota uma coca'],drinks:0,last:/lata ou 2 litros/i},
  {name:'bebida em mensagens separadas',messages:['bota uma coca','2 litros'],drinks:1},
  {name:'duas bebidas de 2 litros',messages:['duas cocas 2 litros'],drinks:1,drinkQuantity:2},
  {name:'retirar bebida sem tirar pizza',messages:['uma grande calabresa','coloca coca 2 litros','tira a coca'],pizzas:1,drinks:0},
  {name:'anotação de cozinha',messages:['uma grande calabresa sem cebola'],pizzas:1,notes:['sem cebola']},
  {name:'pagamento cartão no primeiro turno',messages:['uma grande calabresa pago cartão'],pizzas:1,payment:'CARTAO'},
  {name:'retirada declarada',messages:['grande calabresa, vou retirar no balcão'],pizzas:1,delivery:'RETIRADA'},
  {name:'cliente desiste',messages:['uma grande calabresa','esquece tudo'],pizzas:0},
  {name:'cliente pede humano',messages:['falar com atendente','uma pizza grande de calabresa'],pizzas:0,human:true},
  {name:'intolerância ou alergia',messages:['sou alérgica a leite'],pizzas:0,last:/cozinha/i},
  {name:'combo precisa de validação',messages:['quero combo família'],pizzas:0,combo:'familia',last:/confirm/i},
  {name:'pedido anterior não disponível',messages:['quero o de sempre'],pizzas:0,last:/não acessa/i},
  {name:'tentar confirmar sem total',messages:['uma grande calabresa','confirmo','pode fechar'],pizzas:1,last:/não vou registrar/i},
  {name:'perguntas de ingrediente',messages:['o que vai na portuguesa?'],pizzas:0,last:/ovos/i},
];
for (const scenario of cases) {
  test('conversa semelhante à realidade: '+scenario.name, () => {
    const session = createSession();
    let answer = '';
    for (const message of scenario.messages) {
      answer = respond(message, session, catalog);
      assert.equal(typeof answer, 'string');
      assert.ok(answer.length > 12);
      assert.doesNotMatch(answer,/pedido (foi )?(confirmado|enviado para a cozinha)|pagamento aprovado/i);
    }
    const pizzas = session.cart.filter(x=>x.kind==='pizza');
    const drinks = session.cart.filter(x=>x.kind==='drink');
    if (scenario.pizzas!==undefined) assert.equal(pizzas.length,scenario.pizzas);
    if (scenario.drinks!==undefined) assert.equal(drinks.length,scenario.drinks);
    if (scenario.size) assert.equal(pizzas[0]?.size,scenario.size);
    if (scenario.quantity) assert.equal(pizzas[0]?.quantity,scenario.quantity);
    if (scenario.drinkQuantity) assert.equal(drinks[0]?.quantity,scenario.drinkQuantity);
    if (scenario.flavors) assert.deepEqual([...pizzas[0].flavors].sort(),[...scenario.flavors].sort());
    if (scenario.payment) assert.equal(session.payment,scenario.payment);
    if (scenario.address) assert.ok(session.address);
    if (scenario.delivery) assert.equal(session.delivery,scenario.delivery);
    if (scenario.human) assert.equal(session.human,true);
    if (scenario.combo) assert.equal(session.pendingCombo,scenario.combo);
    if (scenario.notes) assert.deepEqual(pizzas[0]?.notes,scenario.notes);
    if (scenario.last) assert.match(answer,scenario.last);
  });
}
test('dois números não compartilham conversas ou carrinhos',()=>{
 const a=createSession(),b=createSession();
 respond('uma grande de calabresa',a,catalog);
 respond('uma média de portuguesa',b,catalog);
 respond('cancela tudo',a,catalog);
 assert.equal(a.cart.length,0);
 assert.equal(b.cart.length,1);
 assert.equal(b.cart[0].size,'media');
});
test('o simulador nunca cria pedido real ou pagamento',()=>{
 const s=createSession();
 for(const msg of ['grande calabresa','confirmo','confirmo','pode fechar']){
  assert.doesNotMatch(respond(msg,s,catalog),/pedido confirmado|pagamento aprovado/i);
 }
 assert.equal(s.cart.length,1);
 assert.equal('confirmedRequestId' in s,false);
});
