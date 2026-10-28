// Áudio do WhatsApp: transcrição (cliente → texto) e voz da resposta (texto → nota de voz).
// Usa a mesma GEMINI_API_KEY. A chave nunca é registrada em log nem devolvida ao navegador.
import {spawn} from 'node:child_process';

const GEMINI = 'https://generativelanguage.googleapis.com/v1beta/models';
const MAX_AUDIO_BYTES = 12 * 1024 * 1024; // ~10 min de nota de voz; acima disso vai para atendente

async function gemini(model, body, apiKey, fetchImpl, timeoutMs = 45000) {
  if (!/^[a-z][a-z0-9._-]{2,80}$/i.test(String(model || ''))) throw new Error('Modelo Gemini inválido');
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetchImpl(`${GEMINI}/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST', signal: ac.signal,
      headers: {'x-goog-api-key': apiKey, 'content-type': 'application/json'},
      body: JSON.stringify(body)
    });
    if (!r.ok) throw new Error(`Gemini HTTP ${r.status}`);
    return await r.json();
  } finally { clearTimeout(timer); }
}

/** Transcreve a nota de voz do cliente. Retorna texto ('' se não houver fala). */
export async function transcribeAudio({apiKey, model, fetchImpl = globalThis.fetch}, buffer, mimeType = 'audio/ogg') {
  if (!apiKey) throw new Error('GEMINI_API_KEY ausente');
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new Error('Áudio vazio');
  if (buffer.length > MAX_AUDIO_BYTES) throw new Error('Áudio longo demais');
  const mime = String(mimeType || 'audio/ogg').split(';')[0].trim() || 'audio/ogg';
  const r = await gemini(model, {
    contents: [{role: 'user', parts: [
      {text: 'Transcreva fielmente esta mensagem de voz de um cliente de pizzaria, em português do Brasil. Responda SOMENTE com a transcrição, sem comentários. Se não houver fala compreensível, responda exatamente: [inaudível]'},
      {inlineData: {mimeType: mime, data: buffer.toString('base64')}}
    ]}],
    generationConfig: {temperature: 0, maxOutputTokens: 1200}
  }, apiKey, fetchImpl);
  const text = (r?.candidates?.[0]?.content?.parts || []).filter(p => p.text && !p.thought).map(p => p.text).join('').trim();
  return /^\[inaud[ií]vel\]$/i.test(text) ? '' : text.slice(0, 3000);
}

/** Texto falado: remove formatação do WhatsApp, emojis e listas que soam mal na voz. */
export function speakable(text) {
  return String(text || '')
    .replace(/[*_~`]/g, '')
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, '')
    .replace(/^\s*[•\-]\s*/gm, '')
    .replace(/R\$\s?(\d+),(\d{2})/g, '$1 reais e $2 centavos')
    .replace(/\s+\n/g, '\n').trim()
    .slice(0, 1200);
}

/** Gera a resposta em voz (PCM 24 kHz do Gemini TTS) e converte para OGG/Opus (nota de voz do WhatsApp). */
export async function synthesizeVoice({apiKey, ttsModel = 'gemini-2.5-flash-preview-tts', voice = 'Kore', fetchImpl = globalThis.fetch, ffmpegPath = 'ffmpeg'}, text) {
  if (!apiKey) throw new Error('GEMINI_API_KEY ausente');
  const say = speakable(text);
  if (!say) throw new Error('Texto vazio para voz');
  const r = await gemini(ttsModel, {
    contents: [{role: 'user', parts: [{text: `Fale em português do Brasil, tom simpático e natural de atendente de pizzaria: ${say}`}]}],
    generationConfig: {responseModalities: ['AUDIO'], speechConfig: {voiceConfig: {prebuiltVoiceConfig: {voiceName: voice}}}}
  }, apiKey, fetchImpl, 60000);
  const part = (r?.candidates?.[0]?.content?.parts || []).find(p => p.inlineData?.data);
  if (!part) throw new Error('Gemini TTS não retornou áudio');
  const pcm = Buffer.from(part.inlineData.data, 'base64');
  const rate = Number(/rate=(\d+)/.exec(part.inlineData.mimeType || '')?.[1]) || 24000;
  return pcmToOggOpus(pcm, rate, ffmpegPath);
}

export function pcmToOggOpus(pcm, sampleRate = 24000, ffmpegPath = 'ffmpeg') {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-f', 's16le', '-ar', String(sampleRate), '-ac', '1', '-i', 'pipe:0', '-c:a', 'libopus', '-b:a', '32k', '-ar', '48000', '-f', 'ogg', 'pipe:1']);
    const out = []; let err = '';
    const timer = setTimeout(() => { p.kill('SIGKILL'); reject(new Error('ffmpeg demorou demais')); }, 30000);
    p.stdout.on('data', c => out.push(c));
    p.stderr.on('data', c => { err += c; });
    p.on('error', e => { clearTimeout(timer); reject(new Error('ffmpeg indisponível: ' + e.message)); });
    p.on('close', code => {
      clearTimeout(timer);
      const ogg = Buffer.concat(out);
      if (code === 0 && ogg.length > 100) resolve(ogg); else reject(new Error('Falha ao converter áudio: ' + err.slice(0, 120)));
    });
    p.stdin.on('error', () => {});
    p.stdin.end(pcm);
  });
}

/**
 * Regra de formato da resposta: TEXTO é o padrão.
 * Voz somente quando o cliente mandou áudio ou pediu áudio — e nunca para resumo/valores/confirmação,
 * que precisam ficar escritos para o cliente conferir.
 */
export function shouldReplyWithVoice({incomingType, incomingText = '', reply = ''}) {
  const t = String(incomingText).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const asked = /\b(manda|mande|envia|envie|responde|responda|fala|fale|grava|grave)\b.{0,20}\b(audio|voz)\b/.test(t)
    || /\b(nao (sei|consigo) ler|prefiro (audio|voz))\b/.test(t);
  if (!(incomingType === 'audio' || asked)) return false;
  if (/R\$|Total:|Subtotal|Confirmo|solicita[cç][aã]o [0-9a-f]{4}|\bPIX\b.*chave/i.test(reply)) return false;
  return reply.length > 0 && reply.length <= 900;
}
