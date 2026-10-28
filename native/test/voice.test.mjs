import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {transcribeAudio, synthesizeVoice, shouldReplyWithVoice, speakable, pcmToOggOpus} from '../src/voice.mjs';

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;
const ok = body => ({ok: true, status: 200, json: async () => body});

test('transcrição envia o áudio ao Gemini e devolve só o texto', async () => {
  let sent;
  const fetchImpl = async (url, init) => { sent = {url, body: JSON.parse(init.body), headers: init.headers}; return ok({candidates: [{content: {parts: [{text: ' Quero uma pizza grande de calabresa '}]}}]}); };
  const text = await transcribeAudio({apiKey: 'k', model: 'gemini-flash-lite-latest', fetchImpl}, Buffer.from('OggS-fake'), 'audio/ogg; codecs=opus');
  assert.equal(text, 'Quero uma pizza grande de calabresa');
  assert.match(sent.url, /gemini-flash-lite-latest:generateContent$/);
  const inline = sent.body.contents[0].parts.find(p => p.inlineData).inlineData;
  assert.equal(inline.mimeType, 'audio/ogg');
  assert.equal(Buffer.from(inline.data, 'base64').toString(), 'OggS-fake');
  assert.equal(sent.headers['x-goog-api-key'], 'k');
});

test('áudio sem fala vira texto vazio (vai para o atendente)', async () => {
  const fetchImpl = async () => ok({candidates: [{content: {parts: [{text: '[inaudível]'}]}}]});
  assert.equal(await transcribeAudio({apiKey: 'k', model: 'm-1x', fetchImpl}, Buffer.from('x')), '');
});

test('erros do Gemini não vazam a chave', async () => {
  const fetchImpl = async () => ({ok: false, status: 429, json: async () => ({})});
  await assert.rejects(transcribeAudio({apiKey: 'segredo', model: 'm-1x', fetchImpl}, Buffer.from('x')), e => !String(e.message).includes('segredo'));
});

test('texto é o padrão; voz só quando o cliente manda ou pede áudio', () => {
  assert.equal(shouldReplyWithVoice({incomingType: 'text', incomingText: 'oi', reply: 'Olá! Qual sabor?'}), false);
  assert.equal(shouldReplyWithVoice({incomingType: 'audio', incomingText: 'oi', reply: 'Olá! Qual sabor?'}), true);
  assert.equal(shouldReplyWithVoice({incomingType: 'text', incomingText: 'me manda um áudio por favor', reply: 'Claro!'}), true);
});

test('resumo, valores e confirmação sempre vão por escrito', () => {
  for (const reply of ['Total: R$ 59,90', 'Subtotal: R$ 40,00', 'Responda *Confirmo* para enviar']) {
    assert.equal(shouldReplyWithVoice({incomingType: 'audio', reply}), false, reply);
  }
});

test('texto falado sem asteriscos, emojis e marcadores', () => {
  assert.equal(speakable('*Olá!* 🍕\n• Calabresa\n• Frango'), 'Olá!\nCalabresa\nFrango');
});

test('PCM do Gemini vira nota de voz OGG/Opus', {skip: !hasFfmpeg && 'ffmpeg ausente'}, async () => {
  const pcm = Buffer.alloc(24000 * 2); // 1 s de silêncio, 16 bits
  const ogg = await pcmToOggOpus(pcm, 24000);
  assert.equal(ogg.subarray(0, 4).toString(), 'OggS');
  assert.ok(ogg.includes(Buffer.from('OpusHead')));
});

test('síntese completa: Gemini TTS → OGG', {skip: !hasFfmpeg && 'ffmpeg ausente'}, async () => {
  let body;
  const fetchImpl = async (_u, init) => { body = JSON.parse(init.body); return ok({candidates: [{content: {parts: [{inlineData: {mimeType: 'audio/L16;codec=pcm;rate=24000', data: Buffer.alloc(9600).toString('base64')}}]}}]}); };
  const ogg = await synthesizeVoice({apiKey: 'k', fetchImpl}, '*Oi!* Sua pizza sai em 40 minutos 🍕');
  assert.equal(ogg.subarray(0, 4).toString(), 'OggS');
  assert.deepEqual(body.generationConfig.responseModalities, ['AUDIO']);
  assert.doesNotMatch(body.contents[0].parts[0].text, /[*🍕]/u);
});
