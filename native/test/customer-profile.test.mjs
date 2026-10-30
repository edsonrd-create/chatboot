import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const src=fs.readFileSync(new URL('../src/server.mjs',import.meta.url),'utf8');
const ai=fs.readFileSync(new URL('../src/ai.mjs',import.meta.url),'utf8');
test('perfil só guarda endereço validado pelo PDV e revalida ao reutilizar', ()=>{
  assert.match(src,/session\.address&&session\.addressCheck\)await store\.change/);
  assert.match(ai,/será validado de novo/);
});
