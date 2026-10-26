import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const initialState=()=>({version:2,settings:{autoReply:false,approvedForProduction:false,pdv:{enabled:false,baseUrl:'https://pdvgutoexpress.com.br',ordersMode:'DISABLED'}},channels:[{slot:1,phoneId:'',wabaId:'',display:'',tokenEncrypted:'',checkedAt:null,lastInboundAt:null,lastOutboundAt:null},{slot:2,phoneId:'',wabaId:'',display:'',tokenEncrypted:'',checkedAt:null,lastInboundAt:null,lastOutboundAt:null}],threads:{},events:{},outbox:{},orders:[],nextOrder:1});
export class JsonStore{
  constructor(file){this.path=path.resolve(file);this.data=initialState();this.lock=Promise.resolve();}
  init(){fs.mkdirSync(path.dirname(this.path),{recursive:true});if(fs.existsSync(this.path)){this.data={...initialState(),...JSON.parse(fs.readFileSync(this.path,'utf8'))};}return this;}
  async change(fn){const job=this.lock.catch(()=>{}).then(async()=>{const draft=structuredClone(this.data);const result=await fn(draft);const tmp=`${this.path}.${process.pid}.tmp`;fs.writeFileSync(tmp,JSON.stringify(draft,null,2),{mode:0o600});fs.renameSync(tmp,this.path);this.data=draft;return result;});this.lock=job.then(()=>{},()=>{});return job;}
  snapshot(){return structuredClone(this.data);}
}
export function protectToken(text,secret){if(typeof text!=='string'||!text)return '';const iv=crypto.randomBytes(12),key=crypto.createHash('sha256').update(secret).digest(),cipher=crypto.createCipheriv('aes-256-gcm',key,iv),data=Buffer.concat([cipher.update(text,'utf8'),cipher.final()]);return [iv,cipher.getAuthTag(),data].map(x=>x.toString('base64url')).join('.');}
export function revealToken(encoded,secret){if(!encoded)return '';const [iv,tag,data]=(encoded||'').split('.').map(x=>Buffer.from(x||'','base64url'));if(iv.length!==12||tag.length!==16)throw new Error('Token armazenado inválido');const decipher=crypto.createDecipheriv('aes-256-gcm',crypto.createHash('sha256').update(secret).digest(),iv);decipher.setAuthTag(tag);return Buffer.concat([decipher.update(data),decipher.final()]).toString('utf8');}
export function safeCompare(a,b){const x=Buffer.from(String(a||'')),y=Buffer.from(String(b||''));return x.length===y.length&&crypto.timingSafeEqual(x,y);}
