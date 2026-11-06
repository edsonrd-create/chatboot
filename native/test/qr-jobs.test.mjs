import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createNativeServer} from '../src/server.mjs';

const env = {NODE_ENV: 'test', HOST: '127.0.0.1', ADMIN_PASSWORD: 'admin-pass-for-qr-jobs-test', APP_SECRET: 'qr-jobs-secret-for-tests-with-32-characters', AI_PROVIDER: 'gemini', GEMINI_MODEL: 'gemini-3.5-flash-lite', GEMINI_API_KEY: 'FAKE_KEY_FOR_UNIT_TESTS_ONLY', WA_QR_ENABLED: 'true', WA_QR_AUTOREPLY: 'true', WA_QR_VOICE: 'false', QR_JOB_BACKOFF_MS: '20', QR_JOB_MAX_ATTEMPTS: '3'};
const msg = (id, from = '5541933330000') => ({slot: 1, id, from, jid: from + '@s.whatsapp.net', name: 'Cliente', text: 'quero uma pizza', type: 'text'});

function build(t, {dir, respondWithAI, send}) {
  const holder = {}, sent = [];
  const qrManagerFactory = ({onIncoming}) => {
    holder.onIncoming = onIncoming;
    return {status: slot => ({slot, state: 'connected'}), isConnected: () => true, hasSession: () => true,
      send: send || (async (slot, jid, text) => { sent.push(text); return {id: 'out-' + sent.length}; }),
      sendVoice: async () => ({id: null}), presence: async () => {}, resume: async () => {}, start: async () => {}, logout: async () => {}};
  };
  const app = createNativeServer({env, dataFile: path.join(dir, 'state.json'), qrManagerFactory, respondWithAI});
  return {app, holder, sent};
}
const tmp = t => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'guto-qr-jobs-')); t.after(() => fs.rmSync(dir, {recursive: true, force: true})); return dir; };
const aiFail = code => Object.assign(new Error('falha simulada'), {aiCode: code});

test('falha temporária da IA: tenta de novo e responde uma única vez', async t => {
  let calls = 0;
  const {app, holder, sent} = build(t, {dir: tmp(t), respondWithAI: async () => { calls++; if (calls < 3) throw aiFail('AI_UPSTREAM'); return 'Olá! Qual sabor?'; }});
  t.after(() => app.store.close());
  await holder.onIncoming(msg('m1'));
  assert.equal(calls, 3);
  assert.deepEqual(sent, ['Olá! Qual sabor?']);
  assert.deepEqual(Object.keys(app.store.snapshot().qrJobs || {}), [], 'tarefa concluída sai da fila');
});

test('falha definitiva: vai para a fila de falhas e a conversa passa ao atendente, sem resposta inventada', async t => {
  const {app, holder, sent} = build(t, {dir: tmp(t), respondWithAI: async () => { throw aiFail('AI_TIMEOUT'); }});
  t.after(() => app.store.close());
  await holder.onIncoming(msg('m2'));
  const d = app.store.snapshot();
  assert.equal(sent.length, 0);
  assert.equal(d.qrDeadJobs.length, 1);
  assert.equal(d.qrDeadJobs[0].code, 'AI_TIMEOUT');
  assert.equal(d.qrDeadJobs[0].attempts, 3);
  assert.equal(d.threads['qr1:5541933330000'].mode, 'HUMAN');
});

test('chave inválida não fica tentando à toa (erro não temporário)', async t => {
  let calls = 0;
  const {app, holder} = build(t, {dir: tmp(t), respondWithAI: async () => { calls++; throw aiFail('AI_KEY_INVALID'); }});
  t.after(() => app.store.close());
  await holder.onIncoming(msg('m3'));
  assert.equal(calls, 1);
});

test('reinício no meio do atendimento: a tarefa salva é retomada e respondida', async t => {
  const dir = tmp(t);
  // 1º servidor: recebe e "cai" antes de responder (IA nunca termina).
  const first = build(t, {dir, respondWithAI: () => new Promise(() => {})});
  first.holder.onIncoming(msg('m4'));
  await new Promise(r => setTimeout(r, 300));
  assert.equal(Object.keys(first.app.store.snapshot().qrJobs).length, 1, 'tarefa gravada no disco');
  // 2º servidor (mesmo arquivo): retoma.
  const second = build(t, {dir, respondWithAI: async () => 'Retomado: qual sabor?'});
  await second.app.start(0);
  t.after(() => second.app.stop());
  await new Promise(r => setTimeout(r, 9500));
  assert.deepEqual(second.sent, ['Retomado: qual sabor?']);
  assert.deepEqual(Object.keys(second.app.store.snapshot().qrJobs || {}), []);
});
