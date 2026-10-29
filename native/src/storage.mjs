import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const initialState=()=>({version:2,revision:0,auditLog:[],settings:{autoReply:false,approvedForProduction:false,pdv:{enabled:false,baseUrl:'https://pdvgutoexpress.com.br',ordersMode:'DISABLED'}},channels:[{slot:1,phoneId:'',wabaId:'',display:'',tokenEncrypted:'',checkedAt:null,lastInboundAt:null,lastOutboundAt:null},{slot:2,phoneId:'',wabaId:'',display:'',tokenEncrypted:'',checkedAt:null,lastInboundAt:null,lastOutboundAt:null}],threads:{},events:{},outbox:{},orders:[],nextOrder:1});

// Persistência opcional em Postgres (ex.: Neon). Sem DATABASE_URL tudo funciona só com o arquivo JSON.
// O estado completo é gravado como um documento JSONB por revisão; ao iniciar, a versão mais nova é recarregada.
function pgConfig(url){
const u=new URL(url);
u.searchParams.delete('channel_binding');
const sslmode=u.searchParams.get('sslmode');u.searchParams.delete('sslmode');
return {connectionString:u.toString(),ssl:sslmode==='disable'?false:{rejectUnauthorized:true},max:2,idleTimeoutMillis:10000,connectionTimeoutMillis:10000};
}
export class PgMirror{
constructor(url,{key='main',log=()=>{}}={}){this.url=url;this.key=key;this.log=log;this.pool=null;}
async connect(){if(this.pool)return this.pool;const pg=(await import('pg')).default;this.pool=new pg.Pool(pgConfig(this.url));this.pool.on('error',e=>this.log(`[DB] ${String(e.message||e).slice(0,120)}`));await this.pool.query(`create table if not exists guto_state(id text primary key,revision bigint not null default 0,data jsonb not null,updated_at timestamptz not null default now())`);return this.pool;}
async load(){const pool=await this.connect();const r=await pool.query('select revision,data from guto_state where id=$1',[this.key]);return r.rows[0]?{revision:Number(r.rows[0].revision),data:r.rows[0].data}:null;}
async save(data){const pool=await this.connect();await pool.query(`insert into guto_state(id,revision,data,updated_at) values($1,$2,$3::jsonb,now()) on conflict(id) do update set revision=excluded.revision,data=excluded.data,updated_at=now() where guto_state.revision<=excluded.revision`,[this.key,Number(data.revision)||0,JSON.stringify(data)]);}
async close(){if(this.pool){const p=this.pool;this.pool=null;await p.end().catch(()=>{});}}
}

export class JsonStore{
constructor(file,{databaseUrl='',log=()=>{}}={}){this.path=path.resolve(file);this.data=initialState();this.lock=Promise.resolve();this.listeners=new Set();this.log=log;this.mirror=databaseUrl?new PgMirror(databaseUrl,{log}):null;this.dbStatus=this.mirror?'pending':'disabled';}
subscribe(listener){if(typeof listener!=='function')throw new TypeError('Listener inválido');this.listeners.add(listener);return ()=>this.listeners.delete(listener);}
init(){fs.mkdirSync(path.dirname(this.path),{recursive:true});if(fs.existsSync(this.path)){this.data={...initialState(),...JSON.parse(fs.readFileSync(this.path,'utf8'))};}return this;}
/** Carrega do Postgres a revisão mais nova (chamar antes de aceitar requisições). */
async ready(){
if(!this.mirror)return this;
try{
const row=await this.mirror.load();
if(row&&row.data&&row.revision>=(Number(this.data.revision)||0)){this.data={...initialState(),...row.data};this.writeFile(this.data);this.log(`[DB] estado carregado do Postgres (revisão ${row.revision})`);}
else{await this.mirror.save(this.data);this.log('[DB] Postgres inicializado');}
this.dbStatus='ok';
}catch(e){this.dbStatus='error';this.log(`[DB] falha ao carregar do Postgres; seguindo com arquivo local: ${String(e.message||e).slice(0,120)}`);}
return this;
}
writeFile(data){fs.mkdirSync(path.dirname(this.path),{recursive:true});const tmp=`${this.path}.${process.pid}.tmp`;fs.writeFileSync(tmp,JSON.stringify(data,null,2),{mode:0o600});fs.renameSync(tmp,this.path);}
async change(fn){const job=this.lock.catch(()=>{}).then(async()=>{const draft=structuredClone(this.data);const result=await fn(draft);draft.revision=(Number(draft.revision)||0)+1;this.writeFile(draft);this.data=draft;
if(this.mirror){try{await this.mirror.save(draft);this.dbStatus='ok';}catch(e){this.dbStatus='error';this.log(`[DB] falha ao gravar revisão ${draft.revision}: ${String(e.message||e).slice(0,120)}`);}}
for(const listener of this.listeners){try{listener(draft.revision);}catch{}}return result;});this.lock=job.then(()=>{},()=>{});return job;}
snapshot(){return structuredClone(this.data);}
/** Leitura sem cópia (somente leitura!). Usar só para montar respostas da API; nunca alterar o objeto. */
peek(){return this.data;}
async close(){if(this.mirror)await this.mirror.close();}
}
export function protectToken(text,secret){if(typeof text!=='string'||!text)return '';const iv=crypto.randomBytes(12),key=crypto.createHash('sha256').update(secret).digest(),cipher=crypto.createCipheriv('aes-256-gcm',key,iv),data=Buffer.concat([cipher.update(text,'utf8'),cipher.final()]);return [iv,cipher.getAuthTag(),data].map(x=>x.toString('base64url')).join('.');}
export function revealToken(encoded,secret){if(!encoded)return '';const [iv,tag,data]=(encoded||'').split('.').map(x=>Buffer.from(x||'','base64url'));if(iv.length!==12||tag.length!==16)throw new Error('Token armazenado inválido');const decipher=crypto.createDecipheriv('aes-256-gcm',crypto.createHash('sha256').update(secret).digest(),iv);decipher.setAuthTag(tag);return Buffer.concat([decipher.update(data),decipher.final()]).toString('utf8');}
export function safeCompare(a,b){const x=Buffer.from(String(a||'')),y=Buffer.from(String(b||''));return x.length===y.length&&crypto.timingSafeEqual(x,y);}
