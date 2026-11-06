import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createNativeServer} from '../src/server.mjs';
import {parseWaMessage} from '../src/wa-qr.mjs';
import {AudioInputError,opusOggValid} from '../src/audio-pipeline.mjs';

const admin='secure-admin-pass-for-guto-audio-tests';
const secret='guto-audio-tests-secret-32-characters!';
const input=(id,{slot=1,from='5541999991111',type='audio',text='',self=false,history=false}={})=>({
  id,slot,from,jid:from+'@s.whatsapp.net',name:'Cliente Teste',
  text,type,fromMe:self,history,audio:type==='audio'?{buffer:Buffer.from('fake bytes normalized by mock'),mimeType:'audio/ogg',seconds:2}:null
});
function oggFixture(){
  // Páginas sintéticas somente para mock de transporte; o teste real usa FFmpeg.
  const page=(payload,granule,sequence)=>{
    const out=Buffer.alloc(28+payload.length);out.write('OggS');out[4]=0;
    out.writeBigUInt64LE(granule,6);out.writeUInt32LE(1,14);out.writeUInt32LE(sequence,18);
    out[26]=1;out[27]=payload.length;payload.copy(out,28);return out;
  };
  const head=page(Buffer.from('OpusHead\x01\x01\x00\x00\x00\x00\x00\x00','latin1'),0n,0);
  const body=page(Buffer.from('OpusTags + teste sintético'.padEnd(40,'!')),48000n,1);
  return Buffer.concat([head,body]);
}
async function fixture(t,{env={},reply='Olá! Pode informar o sabor?',transcription='Quero uma pizza grande de calabresa',normalizeVoice,synthesizeReplyVoice,respondWithAI}={}){
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'guto-audio-test-'));
 const messages=[],holder={},metrics={stt:0,tts:0,ai:0,normalize:0};
 const serviceEnv={ADMIN_PASSWORD:admin,APP_SECRET:secret,NODE_ENV:'test',HOST:'127.0.0.1',
   AI_PROVIDER:'gemini',GEMINI_API_KEY:'FAKE_FOR_UNIT_TESTS_ONLY',GEMINI_MODEL:'gemini-3.5-flash-lite',
   WA_QR_ENABLED:'true',WA_QR_AUTOREPLY:'true',WA_QR_VOICE:'true',...env};
 const factory=({onIncoming})=>{
   holder.receive=onIncoming;
   return {status:slot=>({slot,state:'connected',qr:null,number:null}),
     isConnected:()=>true,resume:async()=>{},presence:async()=>{},
     send:async(slot,jid,text)=>{messages.push({type:'text',slot,jid,text});return {id:'text-'+messages.length};},
     sendVoice:async(slot,jid,buffer)=>{messages.push({type:'audio',slot,jid,buffer});return {id:'voice-'+messages.length};}};
 };
 const app=createNativeServer({env:serviceEnv,qrManagerFactory:factory,
   dataFile:path.join(temp,'state.json'),
   normalizeVoice:normalizeVoice|| (async()=>{metrics.normalize++;return {buffer:oggFixture(),mimeType:'audio/ogg',durationSeconds:1};}),
   transcribeVoice:async()=>{metrics.stt++;return transcription;},
   synthesizeReplyVoice:synthesizeReplyVoice|| (async()=>{metrics.tts++;return oggFixture();}),
   respondWithAI:respondWithAI|| (async(_text,session)=>{metrics.ai++;session.mode='BOT';return reply;})
 });
 const address=await app.start(0),url='http://127.0.0.1:'+address.port;
 t.after(async()=>{await app.stop();fs.rmSync(temp,{recursive:true,force:true});});
 const request=(p,opts={})=>fetch(url+p,{redirect:'manual',...opts});
 const login=async()=>{const r=await request('/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:admin})});assert.equal(r.status,200);return r.headers.get('set-cookie').split(';')[0];};
 return {app,holder,messages,metrics,request,login};
}
test('WhatsApp áudio -> normalização -> STT -> motor existente -> áudio OGG/Opus no mesmo número',async t=>{
 const x=await fixture(t);assert.ok(opusOggValid(oggFixture()));await x.holder.receive(input('voice-in-1'));
 assert.equal(x.metrics.normalize,1);assert.equal(x.metrics.stt,1);assert.equal(x.metrics.ai,1);assert.equal(x.metrics.tts,1);
 assert.equal(x.messages.length,1);
 assert.equal(x.messages[0].type,'audio');assert.equal(x.messages[0].slot,1);
 assert.equal(x.messages[0].jid,'5541999991111@s.whatsapp.net');
 const d=x.app.store.snapshot().threads['qr1:5541999991111'];
 assert.equal(d.mode,'BOT');assert.equal(d.messages.length,2);assert.equal(d.messages[1].type,'audio');
 assert.equal(d.voiceDisclosureSent,true);
 assert.equal(d.session.history.at(-1).content,'Olá! Pode informar o sabor?');
 // Retransmissão do mesmo webhook não pode custar uma segunda chamada Gemini.
 await x.holder.receive(input('voice-in-1'));
 assert.equal(x.metrics.stt,1);assert.equal(x.messages.length,1);
});
test('Mesmo cliente em dois números conserva histórico e resposta em slots separados',async t=>{
 const x=await fixture(t);await x.holder.receive(input('one',{slot:1}));await x.holder.receive(input('two',{slot:2}));
 assert.deepEqual(x.messages.map(m=>m.slot),[1,2]);
 const d=x.app.store.snapshot();
 assert.ok(d.threads['qr1:5541999991111']);assert.ok(d.threads['qr2:5541999991111']);
 assert.equal(d.threads['qr1:5541999991111'].messages.length,2);
 assert.equal(d.threads['qr2:5541999991111'].messages.length,2);
});
test('Cliente manda texto -> resposta por texto, sem TTS mesmo quando voz está habilitada',async t=>{
 const x=await fixture(t);await x.holder.receive(input('text-1',{type:'text',text:'Oi, qual é o cardápio?'}));
 assert.deepEqual(x.messages.map(m=>m.type),['text']);assert.equal(x.metrics.tts,0);
 assert.equal(x.metrics.stt,0);assert.equal(x.metrics.ai,1);
});
test('Áudio com preço gera cópia escrita e voz original, sem confirmar pagamento',async t=>{
 const x=await fixture(t,{reply:'O total estimado é R$ 59,99. Confirme os itens com nossa equipe.'});
 await x.holder.receive(input('price'));
 assert.deepEqual(x.messages.map(m=>m.type),['text','audio']);
 assert.match(x.messages[0].text,/R\$ 59,99/);
 assert.equal(x.app.store.snapshot().threads['qr1:5541999991111'].messages.length,3);
 assert.equal(x.app.store.snapshot().orders.length,0);
});
test('Áudio incompreensível transfere para humano e não inventa sabor ou preço',async t=>{
 const x=await fixture(t,{transcription:''});
 await x.holder.receive(input('unclear'));
 assert.equal(x.metrics.ai,0);assert.equal(x.metrics.tts,0);
 assert.deepEqual(x.messages.map(m=>m.type),['text']);
 const d=x.app.store.snapshot().threads['qr1:5541999991111'];
 assert.equal(d.mode,'HUMAN');assert.equal(d.operationalState,'WAITING');
 assert.equal(d.qrLastBlocker,'AUDIO_INAUDIBLE');
 assert.ok(!x.messages[0].text.includes('calabresa'));
});
test('Áudio corrompido é recusado, conversa vai para atendente humano',async t=>{
 const x=await fixture(t,{normalizeVoice:async()=>{throw new AudioInputError('AUDIO_CORRUPT','Arquivo inválido');}});
 await x.holder.receive(input('corrupt'));
 assert.equal(x.metrics.ai,0);assert.equal(x.app.store.snapshot().threads['qr1:5541999991111'].mode,'HUMAN');
 assert.equal(x.app.store.snapshot().threads['qr1:5541999991111'].qrLastBlocker,'AUDIO_CORRUPT');
});
test('Falha em TTS comunica contingência textual com transparência, sem simular um áudio',async t=>{
 const x=await fixture(t,{synthesizeReplyVoice:async()=>{throw new Error('TTS 503') }});
 await x.holder.receive(input('tts-error'));
 assert.deepEqual(x.messages.map(m=>m.type),['text']);
 assert.match(x.messages[0].text,/Não consegui gerar áudio/);
 const d=x.app.store.snapshot().threads['qr1:5541999991111'];
 assert.equal(d.qrLastBlocker,'AUDIO_TTS_FAILED');
 assert.equal(d.voiceDisclosureSent,undefined);
 assert.equal(d.session.history.length,2);
});
test('Durante a geração de voz, atendimento humano assume -> cancelar qualquer envio automático',async t=>{
 let release,started;
 const begun=new Promise(resolve=>{started=resolve;});
 const waiting=new Promise(resolve=>{release=resolve;});
 const x=await fixture(t,{synthesizeReplyVoice:async()=>{started();await waiting;return oggFixture();}});
 const processing=x.holder.receive(input('race'));
 await begun;
 const cookie=await x.login();
 const r=await x.request('/api/thread/mode',{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({id:'qr1:5541999991111',mode:'HUMAN'})});
 assert.equal(r.status,200);
 release();await processing;
 assert.equal(x.messages.length,0);
 const d=x.app.store.snapshot().threads['qr1:5541999991111'];
 assert.equal(d.mode,'HUMAN');assert.equal(d.qrLastBlocker,undefined);
});
test('Histórico e eco do próprio celular jamais acionam o bot',async t=>{
 const x=await fixture(t);
 await x.holder.receive(input('my-own',{self:true}));
 await x.holder.receive(input('old-history',{history:true}));
 assert.equal(x.metrics.stt,0);assert.equal(x.metrics.ai,0);assert.equal(x.messages.length,0);
});
test('Quando o operador optou por HUMAN, a IA não transcreve nem responde áudio',async t=>{
 const x=await fixture(t);
 await x.app.store.change(d=>{d.threads['qr1:5541999991111']={id:'qr1:5541999991111',slot:1,via:'qr',jid:'5541999991111@s.whatsapp.net',customer:'5541999991111',mode:'HUMAN',messages:[],unread:0,updatedAt:'',session:{mode:'HUMAN',history:[],cart:[]}};});
 await x.holder.receive(input('human-message'));
 assert.equal(x.metrics.stt,0);assert.equal(x.metrics.tts,0);assert.equal(x.messages.length,0);
});
test('Anexo de voz MIME audio/mpeg é reconhecido como áudio; documento comum permanece documento',()=>{
 const base={key:{id:'d1',remoteJid:'5541999991111@s.whatsapp.net',fromMe:false},messageTimestamp:1111};
 const audio=parseWaMessage({...base,message:{documentMessage:{mimetype:'audio/mpeg',fileName:'mensagem.mp3',fileLength:3000}}});
 assert.equal(audio.type,'audio');assert.equal(audio.fileLength,3000);
 const document=parseWaMessage({...base,message:{documentMessage:{mimetype:'application/pdf',fileName:'conta.pdf'}}});
 assert.equal(document.type,'document');
});

test('Diagnóstico de áudio exige login e não revela chave Gemini nem transcrição',async t=>{
  const x=await fixture(t);
  assert.equal((await x.request('/api/audio/health')).status,401);
  const cookie=await x.login();
  const result=await x.request('/api/audio/health',{headers:{cookie}});
  assert.equal(result.status,200);
  const d=await result.json();
  assert.equal(d.ttsConfigured,true);
  assert.equal(d.sttConfigured,true);
  assert.equal(d.voiceFlagEnabled,true);
  assert.equal(d.productionReady,false);
  assert.equal(d.sendToPdv,false);
  assert.equal(JSON.stringify(d).includes('FAKE_FOR_UNIT_TESTS_ONLY'),false);
});
