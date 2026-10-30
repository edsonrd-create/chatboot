import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createNativeServer} from '../src/server.mjs';

const P = 'admin-pass-for-qr-load-tests';
const S = 'qr-load-secret-for-tests-32-characters-long!!';
const env = {NODE_ENV: 'test', HOST: '127.0.0.1', ADMIN_PASSWORD: P, APP_SECRET: S, AI_PROVIDER: 'gemini', GEMINI_MODEL: 'gemini-3.5-flash-lite', GEMINI_API_KEY: 'FAKE_KEY_FOR_UNIT_TESTS_ONLY', WA_QR_ENABLED: 'true', WA_QR_AUTOREPLY: 'true', WA_QR_VOICE: 'false', AI_MAX_CONCURRENCY: '6'};
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fixture(t, {aiDelay = 40} = {}) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'guto-qr-load-'));
  const sent = [], files = [], holder = {}, stats = {active: 0, max: 0, order: {}};
  const qrManagerFactory = ({onIncoming, onStatus}) => {
    Object.assign(holder, {onIncoming, onStatus});
    return {status: slot => ({slot, state: 'connected', number: '55419990000' + slot, qr: null, error: null}), isConnected: () => true,
      send: async (slot, jid, text) => { sent.push({jid, text}); return {id: 'out-' + sent.length}; },
      sendMedia: async (slot, jid, f) => { files.push({jid, ...f}); return {id: 'file-' + files.length}; },
      sendVoice: async () => ({id: null}), presence: async () => {}, resume: async () => {}, start: async () => {}, logout: async () => {}, avatar: async () => null};
  };
  const respondWithAI = async (message, session) => {
    stats.active++; stats.max = Math.max(stats.max, stats.active);
    await sleep(aiDelay);
    stats.active--; session.mode = 'BOT';
    return 'resposta para: ' + message;
  };
  const app = createNativeServer({env, dataFile: path.join(temp, 'state.json'), qrManagerFactory, respondWithAI});
  const address = await app.start(0), url = 'http://127.0.0.1:' + address.port;
  t.after(async () => { await app.stop(); fs.rmSync(temp, {recursive: true, force: true}); });
  const login = async () => (await fetch(url + '/api/login', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({password: P})})).headers.get('set-cookie').split(';')[0];
  return {app, holder, sent, files, stats, url, login};
}
const msg = (i, from) => ({slot: 1, id: 'in-' + i, from, jid: from + '@s.whatsapp.net', name: 'Cliente ' + from.slice(-2), text: 'mensagem ' + i, type: 'text'});

test('carga: 200 mensagens de 40 clientes ao mesmo tempo — nenhuma perdida, todas respondidas, IA limitada', async t => {
  const {app, holder, sent, stats} = await fixture(t);
  const clients = Array.from({length: 40}, (_, i) => '55419990' + String(i).padStart(4, '0'));
  const jobs = [];
  for (let i = 0; i < 200; i++) jobs.push(holder.onIncoming(msg(i, clients[i % 40])));
  const started = Date.now();
  await Promise.all(jobs);
  const took = Date.now() - started;
  const threads = Object.values(app.store.snapshot().threads);
  assert.equal(threads.length, 40);
  assert.equal(threads.reduce((n, t) => n + t.messages.filter(m => m.direction === 'incoming').length, 0), 200, 'nenhuma mensagem recebida pode sumir');
  assert.equal(sent.length, 200, 'cada mensagem recebe uma resposta');
  assert.ok(stats.max <= 6, `no máximo 6 chamadas simultâneas à IA (teve ${stats.max})`);
  assert.ok(stats.max >= 4, 'conversas diferentes devem ser atendidas em paralelo');
  assert.ok(took < 200 * 40, `paralelismo real: ${took} ms`);
});

test('mesmo cliente mandando 5 mensagens seguidas: respostas em ordem, sem embaralhar', async t => {
  const {holder, sent} = await fixture(t, {aiDelay: 15});
  const from = '5541988880000';
  await Promise.all([0, 1, 2, 3, 4].map(i => holder.onIncoming(msg(i, from))));
  assert.deepEqual(sent.map(s => s.text), [0, 1, 2, 3, 4].map(i => 'resposta para: mensagem ' + i));
});

test('histórico de 3.000 mensagens é gravado em lote e o painel continua respondendo', async t => {
  const {app, holder, url, login} = await fixture(t);
  const cookie = await login();
  const imports = [];
  for (let i = 0; i < 3000; i++) imports.push(holder.onIncoming({...msg(i, '55419770' + String(i % 100).padStart(4, '0')), history: true, at: new Date(Date.now() - (3000 - i) * 1000).toISOString()}));
  const t0 = Date.now();
  const r = await fetch(url + '/api/conversations', {headers: {cookie}});
  assert.equal(r.status, 200);
  assert.ok(Date.now() - t0 < 2000, 'painel não pode travar durante a importação');
  await Promise.all(imports); await sleep(700);
  const total = Object.values(app.store.snapshot().threads).reduce((n, t) => n + t.messages.length, 0);
  assert.equal(total, 3000);
  assert.ok(app.store.snapshot().revision < 60, `gravações agrupadas (revisões: ${app.store.snapshot().revision})`);
});

test('anexo: atendente envia PDF pela central e a conversa passa para humano', async t => {
  const {app, holder, files, url, login} = await fixture(t);
  await holder.onIncoming(msg(1, '5541966660000'));
  const cookie = await login();
  const body = {id: 'qr1:5541966660000', name: 'cardapio.pdf', type: 'application/pdf', data: Buffer.from('%PDF-1.4 teste').toString('base64'), caption: 'Nosso cardápio'};
  const r = await fetch(url + '/api/send-file', {method: 'POST', headers: {cookie, 'content-type': 'application/json'}, body: JSON.stringify(body)});
  assert.equal(r.status, 202);
  assert.equal(files[0].fileName, 'cardapio.pdf');
  assert.equal(files[0].mimeType, 'application/pdf');
  const t0 = app.store.snapshot().threads['qr1:5541966660000'];
  const last = t0.messages.at(-1);
  assert.equal(last.type, 'document'); assert.equal(t0.mode, 'HUMAN');
  const dl = await fetch(url + '/api/media?f=' + last.media, {headers: {cookie}});
  assert.equal(dl.status, 200); assert.match(dl.headers.get('content-disposition'), /attachment/);
  const bad = await fetch(url + '/api/send-file', {method: 'POST', headers: {cookie, 'content-type': 'application/json'}, body: JSON.stringify({...body, type: 'application/x-msdownload', name: 'virus.exe'})});
  assert.equal(bad.status, 415, 'executáveis são recusados');
});

test('desconectar apaga as conversas e mídias daquele WhatsApp e mantém o outro', async t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'guto-qr-purge-'));
  const holder = {};
  const qrManagerFactory = ({onIncoming, onLoggedOut}) => {
    Object.assign(holder, {onIncoming, onLoggedOut});
    return {status: slot => ({slot, state: 'connected'}), isConnected: () => true, hasSession: () => true,
      send: async () => ({id: 'o' + Math.random()}), sendVoice: async () => ({}), presence: async () => {}, resume: async () => {}, start: async () => {},
      logout: async slot => { await onLoggedOut(slot); return {slot, state: 'disconnected'}; }};
  };
  const app = createNativeServer({env, dataFile: path.join(temp, 'state.json'), qrManagerFactory, respondWithAI: async () => 'ok'});
  const address = await app.start(0), url = 'http://127.0.0.1:' + address.port;
  t.after(async () => { await app.stop(); fs.rmSync(temp, {recursive: true, force: true}); });
  await holder.onIncoming({...msg(1, '5541911110000'), media: {buffer: Buffer.from('img'), mimeType: 'image/jpeg'}, type: 'image', text: '📷 Foto'});
  await holder.onIncoming({...msg(2, '5541922220000'), slot: 2});
  const mediaFile = Object.values(app.store.snapshot().threads).find(t => t.slot === 1).messages[0].media;
  assert.ok(fs.existsSync(path.join(temp, 'media', mediaFile)));
  const cookie = (await fetch(url + '/api/login', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({password: P})})).headers.get('set-cookie').split(';')[0];
  const r = await fetch(url + '/api/qr/1/logout', {method: 'POST', headers: {cookie, 'content-type': 'application/json'}, body: '{}'});
  assert.equal(r.status, 200);
  const left = Object.values(app.store.snapshot().threads);
  assert.equal(left.filter(t => t.slot === 1).length, 0, 'conversas do WhatsApp 01 apagadas');
  assert.equal(left.filter(t => t.slot === 2).length, 1, 'WhatsApp 02 intacto');
  assert.equal(fs.existsSync(path.join(temp, 'media', mediaFile)), false, 'mídia apagada');
});
