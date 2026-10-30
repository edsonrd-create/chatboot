import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {normalizeIncomingAudio,detectAudioFormat,AUDIO_MIME,opusOggValid,MAX_INPUT_BYTES} from '../src/audio-pipeline.mjs';
import {synthesizeVoice} from '../src/voice.mjs';
const hasFfmpeg=spawnSync('ffmpeg',['-version'],{encoding:'utf8'}).status===0;
const wav=seconds=>{
 const rate=16000,samples=Math.floor(seconds*rate),data=Buffer.alloc(samples*2),h=Buffer.alloc(44);
 h.write('RIFF',0);h.writeUInt32LE(36+data.length,4);h.write('WAVE',8);
 h.write('fmt ',12);h.writeUInt32LE(16,16);h.writeUInt16LE(1,20);h.writeUInt16LE(1,22);
 h.writeUInt32LE(rate,24);h.writeUInt32LE(rate*2,28);h.writeUInt16LE(2,32);h.writeUInt16LE(16,34);
 h.write('data',36);h.writeUInt32LE(data.length,40);
 return Buffer.concat([h,data]);
};
test('Reconhece WAV por assinatura de arquivo, independentemente de extensão',()=>{
 assert.equal(detectAudioFormat(wav(.5)),'wav');
 assert.equal(detectAudioFormat(Buffer.from('texto comum')),null);
 assert.ok(AUDIO_MIME.has('audio/ogg'));
});
test('Bloqueia áudio vazio, formato incompatível e tamanho acima do limite antes de chamar FFmpeg',async()=>{
 for(const input of [
  {buffer:Buffer.alloc(0),mimeType:'audio/wav',code:'AUDIO_EMPTY'},
  {buffer:Buffer.from('not audio'),mimeType:'audio/ogg',code:'AUDIO_UNSUPPORTED'},
  {buffer:wav(0.3),mimeType:'application/javascript',code:'AUDIO_UNSUPPORTED'},
  {buffer:Buffer.alloc(MAX_INPUT_BYTES+1),mimeType:'audio/ogg',code:'AUDIO_TOO_LARGE'},
  {buffer:wav(.3),mimeType:'audio/wav',seconds:185,code:'AUDIO_TOO_LONG'}
 ])await assert.rejects(normalizeIncomingAudio(input),err=>err.code===input.code);
});
test('Converte áudio WAV válido em nota de entrada OGG Opus mono e calcula duração', {skip: !hasFfmpeg&&'FFmpeg ausente no runner'},async()=>{
 const result=await normalizeIncomingAudio({buffer:wav(.8),mimeType:'audio/wav'});
 assert.equal(result.mimeType,'audio/ogg');
 assert.equal(result.format,'opus');
 assert.ok(opusOggValid(result.buffer));
 assert.ok(result.durationSeconds>.75&&result.durationSeconds<.9);
});
test('Rejeita arquivo que parece OGG mas está danificado', {skip: !hasFfmpeg&&'FFmpeg ausente no runner'},async()=>{
 await assert.rejects(normalizeIncomingAudio({buffer:Buffer.from('OggS'.padEnd(200,'!')),mimeType:'audio/ogg'}),err=>err.code==='AUDIO_CORRUPT');
});
test('Bloqueia duração real maior do que três minutos (mesmo com metadados enganadores)',{skip: !hasFfmpeg&&'FFmpeg ausente no runner',timeout:60000},async()=>{
 // Header anuncia menos; FFmpeg determina a duração real. Usar silêncio pequeno comprimido em WAV é pesado:
 const bytes=wav(181);
 await assert.rejects(normalizeIncomingAudio({buffer:bytes,mimeType:'audio/wav',seconds:0}),e=>e.code==='AUDIO_TOO_LONG');
});
test('Quando ffmpeg não existe, classifica falha sem retornar resposta inventada',async()=>{
 await assert.rejects(normalizeIncomingAudio({buffer:wav(.5),mimeType:'audio/wav',ffmpegPath:'ffmpeg_nonexistent_guto'}),e=>e.code==='FFMPEG_UNAVAILABLE');
});
test('Gemini TTS reconhece WAV moderno e gera áudio Opus para WhatsApp',{skip:!hasFfmpeg&&'FFmpeg ausente no runner'},async()=>{
 const fetchImpl=async()=>({ok:true,json:async()=>({candidates:[{content:{parts:[{inlineData:{mimeType:'audio/wav',data:wav(.4).toString('base64')}}]}}]})});
 const out=await synthesizeVoice({apiKey:'TEST_KEY_NOT_REAL',fetchImpl,ttsModel:'gemini-2.5-flash-preview-tts'},'Olá. Sou a assistente virtual.');
 assert.ok(opusOggValid(out));
});
