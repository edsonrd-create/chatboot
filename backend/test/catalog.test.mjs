import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {publicMenuKnowledge, newSession, addPizza, getSummary} from '../src/core.mjs';
import {localReply} from '../src/ai.mjs';
const b=JSON.parse(fs.readFileSync(new URL('../config/business.json',import.meta.url)));
test('cardapio publico tem categorias, ingredientes e combos pesquisaveis',()=>{
 const m=publicMenuKnowledge(b);
 assert.equal(m.flavors.length,74);
 assert.equal(m.combos.length,7);
 assert.equal(m.drinks.length,20);
 assert.ok(m.flavors.find(f=>f.id==='portuguesa').ingredients.includes('Ovos'));
 assert.ok(m.combos.every(c=>c.autoCheckoutEnabled===false));
});
test('preco publicado a partir de nao libera compra por tamanho',()=>{
 const s=newSession(),r=addPizza(s,b,{size:'grande',flavors:['calabresa']});
 assert.equal(r.ok,true);
 assert.equal(getSummary(s,b).subtotalCents,null);
 assert.ok(getSummary(s,b).missing.includes('preços válidos'));
});
test('resposta local informa promocao como valor anunciado a confirmar',()=>{
 const r=localReply('Quais combos vocês têm?',newSession(),b);
 assert.match(r,/Combo Big/);
 assert.match(r,/confirmar/i);
});
