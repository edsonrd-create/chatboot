// Pré-processamento de áudio recebido (Baileys -> FFmpeg -> Gemini).
// Entrada de bytes não confiáveis: recusar formatos falsos, arquivos longos e blobs malformados.
// Nenhuma mídia é executada em um shell. O FFmpeg lê e escreve exclusivamente via pipes.
import {spawn} from 'node:child_process';

export const MAX_INPUT_BYTES=12*1024*1024;
export const MAX_DURATION_SECONDS=180;
const MAX_OUTPUT_BYTES=8*1024*1024;
const MAX_FFMPEG_MS=45000;

export class AudioInputError extends Error {
  constructor(code,message){super(message);this.name='AudioInputError';this.code=code;}
}
export const audioBaseMime=value=>String(value||'').split(';')[0].trim().toLowerCase();
export const AUDIO_MIME=new Set(['audio/ogg','audio/opus','audio/mpeg','audio/mp3','audio/mp4','audio/x-m4a','audio/m4a','audio/wav','audio/x-wav','audio/aac','audio/flac','audio/webm','audio/aiff','audio/x-aiff']);
export function detectAudioFormat(bytes){
  if(!Buffer.isBuffer(bytes)||bytes.length<8)return null;
  if(bytes.toString('ascii',0,4)==='OggS')return 'ogg';
  if(bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WAVE')return 'wav';
  if(bytes.toString('ascii',0,4)==='fLaC')return 'flac';
  if(bytes[0]===0x1a&&bytes[1]===0x45&&bytes[2]===0xdf&&bytes[3]===0xa3)return 'webm';
  if(bytes.toString('ascii',4,8)==='ftyp')return 'mp4';
  if(bytes.toString('ascii',0,3)==='ID3'||(bytes[0]===0xff&&(bytes[1]&0xe0)===0xe0))return 'mpeg';
  return null;
}
function oggSeconds(bytes){
  let cursor=0,last=null;
  while(cursor+27<=bytes.length){
    if(bytes.toString('ascii',cursor,cursor+4)!=='OggS')return null;
    const segments=bytes[cursor+26];
    if(cursor+27+segments>bytes.length)return null;
    let payloadLength=0;
    for(let i=0;i<segments;i++)payloadLength+=bytes[cursor+27+i];
    const advance=27+segments+payloadLength;
    if(cursor+advance>bytes.length)return null;
    const granule=bytes.readBigUInt64LE(cursor+6);
    if(granule!==0xffffffffffffffffn)last=granule;
    cursor+=advance;
  }
  if(cursor!==bytes.length||last===null)return null;
  const seconds=Number(last)/48000; // Opus OGG usa granularidade de 48 kHz
  return Number.isFinite(seconds)?seconds:null;
}
export function opusOggValid(bytes){
  return Buffer.isBuffer(bytes)&&bytes.length>60&&bytes.toString('ascii',0,4)==='OggS'&&bytes.includes(Buffer.from('OpusHead'))&&oggSeconds(bytes)!==null;
}
function transcodeToOpus(input,ffmpegPath){
  return new Promise((resolve,reject)=>{
    let settled=false,limitExceeded=false,timeout=null;
    const fail=err=>{if(settled)return;settled=true;clearTimeout(timeout);try{p.kill('SIGKILL');}catch{}reject(err);};
    const args=['-hide_banner','-nostdin','-loglevel','error','-threads','1','-i','pipe:0','-vn','-map','0:a:0',
      '-ac','1','-ar','16000','-c:a','libopus','-b:a','24k','-t',String(MAX_DURATION_SECONDS+1),'-f','ogg','pipe:1'];
    const p=spawn(ffmpegPath,args,{stdio:['pipe','pipe','pipe']});
    const out=[];let count=0;
    timeout=setTimeout(()=>fail(new AudioInputError('AUDIO_TIMEOUT','Conversão excedeu o tempo de segurança')),MAX_FFMPEG_MS);
    p.stdout.on('data',chunk=>{
      count+=chunk.length;
      if(count>MAX_OUTPUT_BYTES){limitExceeded=true;fail(new AudioInputError('AUDIO_TOO_LARGE','Áudio convertido excede o limite'));}
      else if(!settled)out.push(chunk);
    });
    p.stderr.on('data',()=>{}); // nunca registrar mídia, metadados ou nomes do cliente em logs
    p.on('error',()=>fail(new AudioInputError('FFMPEG_UNAVAILABLE','FFmpeg não está disponível no servidor')));
    p.on('close',code=>{
      if(settled)return;
      settled=true;clearTimeout(timeout);
      if(limitExceeded||code!==0)return reject(new AudioInputError('AUDIO_CORRUPT','Arquivo de áudio danificado ou não decodificável'));
      resolve(Buffer.concat(out));
    });
    p.stdin.on('error',()=>{}); // o FFmpeg pode recusar bytes antes de consumir o pipe
    p.stdin.end(input);
  });
}
/** Resultado validado: sempre OGG Opus, mono, áudio decodificado, até 3 minutos. */
export async function normalizeIncomingAudio({buffer,mimeType,seconds=0,ffmpegPath='ffmpeg'}={}){
  if(!Buffer.isBuffer(buffer)||!buffer.length)throw new AudioInputError('AUDIO_EMPTY','Mensagem sem áudio baixado');
  if(buffer.length>MAX_INPUT_BYTES)throw new AudioInputError('AUDIO_TOO_LARGE','Áudio excede 12 MB');
  const declared=audioBaseMime(mimeType);
  if(declared&&!AUDIO_MIME.has(declared))throw new AudioInputError('AUDIO_UNSUPPORTED','Formato de áudio não permitido');
  const format=detectAudioFormat(buffer);
  if(!format)throw new AudioInputError('AUDIO_UNSUPPORTED','Formato ou assinatura de áudio inválida');
  if(Number(seconds)>MAX_DURATION_SECONDS)throw new AudioInputError('AUDIO_TOO_LONG','Áudio excede 3 minutos');
  const ogg=await transcodeToOpus(buffer,ffmpegPath);
  if(!opusOggValid(ogg))throw new AudioInputError('AUDIO_CORRUPT','Conversão de áudio incompleta');
  const duration=oggSeconds(ogg);
  if(duration>MAX_DURATION_SECONDS+0.25)throw new AudioInputError('AUDIO_TOO_LONG','Áudio excede 3 minutos');
  if(duration<0.1)throw new AudioInputError('AUDIO_EMPTY','Áudio curto demais ou vazio');
  return {buffer:ogg,mimeType:'audio/ogg',durationSeconds:Number(duration.toFixed(2)),format:'opus'};
}

/** Duração declarada/estimada sem FFmpeg (OGG lê o granule; outros formatos usam o metadado do WhatsApp). */
export function audioSeconds(bytes,declaredSeconds=0){
  const fromOgg=Buffer.isBuffer(bytes)&&bytes.toString('ascii',0,4)==='OggS'?oggSeconds(bytes):null;
  const declared=Number(declaredSeconds);
  if(Number.isFinite(fromOgg)&&fromOgg>0)return Number(fromOgg.toFixed(2));
  return Number.isFinite(declared)&&declared>0?Number(declared.toFixed(2)):0;
}
/**
 * Validação sem FFmpeg: mesmas recusas de tamanho, MIME, assinatura e duração do
 * normalizador, mas devolve os bytes originais. Usada quando o FFmpeg não está
 * instalado no servidor, para não derrubar a transcrição (degradação controlada).
 */
const CANONICAL_MIME={ogg:'audio/ogg',wav:'audio/wav',flac:'audio/flac',webm:'audio/webm',mp4:'audio/mp4',mpeg:'audio/mpeg'};
export function inspectIncomingAudio({buffer,mimeType,seconds=0}={}){
  if(!Buffer.isBuffer(buffer)||!buffer.length)throw new AudioInputError('AUDIO_EMPTY','Mensagem sem áudio baixado');
  if(buffer.length>MAX_INPUT_BYTES)throw new AudioInputError('AUDIO_TOO_LARGE','Áudio excede 12 MB');
  const declared=audioBaseMime(mimeType);
  if(declared&&!AUDIO_MIME.has(declared))throw new AudioInputError('AUDIO_UNSUPPORTED','Formato de áudio não permitido');
  const format=detectAudioFormat(buffer);
  if(!format)throw new AudioInputError('AUDIO_UNSUPPORTED','Formato ou assinatura de áudio inválida');
  const duration=audioSeconds(buffer,seconds);
  if(duration>MAX_DURATION_SECONDS)throw new AudioInputError('AUDIO_TOO_LONG','Áudio excede 3 minutos');
  // MIME canônico pela assinatura real, aceito pelo serviço de transcrição.
  return {buffer,mimeType:CANONICAL_MIME[format]||'audio/ogg',durationSeconds:duration,format,transcoded:false};
}
