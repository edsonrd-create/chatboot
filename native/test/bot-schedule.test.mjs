import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {defaultSchedule, normalizeSchedule, isBotActive} from '../src/bot-schedule.mjs';
import {createNativeServer} from '../src/server.mjs';

// Horários em Brasília (UTC-3): 2026-10-30 é sexta-feira.
const at = (iso) => new Date(iso + '-03:00');
const sched = (mode, days) => normalizeSchedule({mode, days});
const allDays = r => Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map(d => [d, r]));

test('padrão = sempre ligada (não muda o comportamento atual)', () => {
  assert.equal(defaultSchedule().mode, 'on');
  assert.equal(isBotActive(defaultSchedule(), at('2026-10-30T04:00:00')), true);
});
test('manual: desligada nunca responde, ligada sempre responde', () => {
  assert.equal(isBotActive(sched('off', allDays([{start: '00:00', end: '23:59'}])), at('2026-10-30T20:00:00')), false);
  assert.equal(isBotActive(sched('on', allDays([])), at('2026-10-30T03:00:00')), true);
});
test('automático: dentro e fora do horário, limite final exclusivo', () => {
  const s = sched('auto', allDays([{start: '18:00', end: '23:30'}]));
  assert.equal(isBotActive(s, at('2026-10-30T17:59:00')), false);
  assert.equal(isBotActive(s, at('2026-10-30T18:00:00')), true);
  assert.equal(isBotActive(s, at('2026-10-30T23:29:00')), true);
  assert.equal(isBotActive(s, at('2026-10-30T23:30:00')), false);
});
test('faixa que passa da meia-noite vale até a madrugada do dia seguinte', () => {
  const days = allDays([]); days[5] = [{start: '18:00', end: '02:00'}]; // sexta
  const s = sched('auto', days);
  assert.equal(isBotActive(s, at('2026-10-30T23:00:00')), true);  // sexta 23h
  assert.equal(isBotActive(s, at('2026-10-31T01:30:00')), true);  // sábado 01:30
  assert.equal(isBotActive(s, at('2026-10-31T02:00:00')), false); // sábado 02:00
  assert.equal(isBotActive(s, at('2026-10-31T20:00:00')), false); // sábado sem horário
});
test('dia sem horário = fechado; horários inválidos são recusados', () => {
  const days = allDays([{start: '18:00', end: '23:00'}]); days[1] = [];
  assert.equal(isBotActive(sched('auto', days), at('2026-10-26T19:00:00')), false); // segunda
  assert.throws(() => normalizeSchedule({mode: 'auto', days: {0: [{start: '25:00', end: '10:00'}]}}), /inválido/);
  assert.throws(() => normalizeSchedule({mode: 'xyz'}), /Modo/);
});

test('API: painel salva o horário e a IA não responde fora dele', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'guto-sched-'));
  let now = at('2026-10-30T15:00:00').getTime(); // sexta 15h
  const holder = {}, sent = [];
  const qrManagerFactory = ({onIncoming}) => { holder.onIncoming = onIncoming; return {status: s => ({slot: s, state: 'connected'}), isConnected: () => true, hasSession: () => true, send: async (s, j, text) => { sent.push(text); return {id: 'o' + sent.length}; }, sendVoice: async () => ({}), presence: async () => {}, resume: async () => {}, start: async () => {}, logout: async () => {}}; };
  const env = {NODE_ENV: 'test', HOST: '127.0.0.1', ADMIN_PASSWORD: 'admin-pass-for-sched-tests', APP_SECRET: 'sched-secret-for-tests-with-32-characters!!', AI_PROVIDER: 'gemini', GEMINI_MODEL: 'gemini-3.5-flash-lite', GEMINI_API_KEY: 'FAKE', WA_QR_ENABLED: 'true', WA_QR_AUTOREPLY: 'true', WA_QR_VOICE: 'false'};
  const app = createNativeServer({env, dataFile: path.join(dir, 'state.json'), clock: () => now, qrManagerFactory, respondWithAI: async () => 'Olá!'});
  const address = await app.start(0), url = 'http://127.0.0.1:' + address.port;
  t.after(async () => { await app.stop(); fs.rmSync(dir, {recursive: true, force: true}); });
  const cookie = (await fetch(url + '/api/login', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({password: env.ADMIN_PASSWORD})})).headers.get('set-cookie').split(';')[0];
  const put = await fetch(url + '/api/bot/schedule', {method: 'PUT', headers: {cookie, 'content-type': 'application/json'}, body: JSON.stringify({mode: 'auto', days: allDays([{start: '18:00', end: '23:30'}])})});
  assert.equal(put.status, 200);
  assert.equal((await put.json()).active, false);
  const msg = (id, from) => ({slot: 1, id, from, jid: from + '@s.whatsapp.net', name: 'C', text: 'oi', type: 'text'});
  await holder.onIncoming(msg('a', '5541900000001'));
  assert.equal(sent.length, 0, 'fora do horário: sem resposta automática');
  assert.equal(app.store.snapshot().threads['qr1:5541900000001'].messages.length, 1, 'mensagem registrada para o atendente');
  now = at('2026-10-30T19:00:00').getTime();
  await holder.onIncoming(msg('b', '5541900000002'));
  assert.deepEqual(sent, ['Olá!'], 'dentro do horário: IA responde');
  const off = await fetch(url + '/api/bot/schedule', {method: 'PUT', headers: {cookie, 'content-type': 'application/json'}, body: JSON.stringify({mode: 'off'})});
  assert.equal((await off.json()).active, false);
  await holder.onIncoming(msg('c', '5541900000003'));
  assert.equal(sent.length, 1, 'botão manual desligado: sem resposta');
  const bad = await fetch(url + '/api/bot/schedule', {method: 'PUT', headers: {cookie, 'content-type': 'application/json'}, body: JSON.stringify({mode: 'auto', days: {0: [{start: '9', end: 'x'}]}})});
  assert.equal(bad.status, 422);
});
