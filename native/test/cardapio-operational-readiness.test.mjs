import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const server=fs.readFileSync(new URL('../src/server.mjs',import.meta.url),'utf8');
const ui=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');

test('status do cardápio valida IA/horário, não somente conexão com PDV',()=>{
  assert.match(server,/const scheduleActive=botActiveNow\(\)/);
  assert.match(server,/AUTOREPLY_DISABLED/);
  assert.match(server,/SCHEDULE_PAUSED/);
  assert.match(server,/WHATSAPP_DISCONNECTED/);
  assert.match(server,/eligibleThreads/);
  assert.doesNotMatch(server,/pricesFrom:'PDV',ordersMode:'HOMOLOGATION'/);
});
test('painel exibe causa real do bloqueio na aba Cardápio WhatsApp',()=>{
  assert.match(ui,/Atendimento automático bloqueado:/);
  assert.match(ui,/IA desligada ou fora do horário no painel/);
  assert.match(ui,/Autorresposta desligada no Railway/);
  assert.match(ui,/Atendimento WhatsApp/);
});
