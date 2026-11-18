import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const MAX_PDF_SIZE=20*1024*1024;
export function pdfDirectory(dataFile){return path.join(path.dirname(dataFile),'cardapios');}
function metaFile(dataFile){return path.join(pdfDirectory(dataFile),'catalog.json');}
function load(dataFile){try{const m=JSON.parse(fs.readFileSync(metaFile(dataFile),'utf8'));return {active:m.active||null,versions:Array.isArray(m.versions)?m.versions:[]};}catch{return {active:null,versions:[]};}}
function write(dataFile,meta){const file=metaFile(dataFile);fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});const temp=file+'.tmp';fs.writeFileSync(temp,JSON.stringify(meta,null,2),{mode:0o600});fs.renameSync(temp,file);}
export function pdfStatus(dataFile){
 const m=load(dataFile);
 return {active:m.versions.find(x=>x.id===m.active)||null,versions:m.versions.map(x=>({id:x.id,name:x.name,size:x.size,uploadedAt:x.uploadedAt,active:x.id===m.active}))};
}
export function getActivePdf(dataFile){const m=load(dataFile),item=m.versions.find(x=>x.id===m.active);if(!item)return null;const file=path.join(pdfDirectory(dataFile),item.id+'.pdf');return fs.existsSync(file)?{...item,file}:null;}
export function uploadPdf(dataFile,bytes,originalName='cardapio.pdf'){
 if(!Buffer.isBuffer(bytes)||bytes.length<100||bytes.length>MAX_PDF_SIZE)throw Object.assign(new Error('PDF vazio ou acima de 20 MB'),{status:422});
 if(bytes.subarray(0,5).toString('ascii')!=='%PDF-')throw Object.assign(new Error('Arquivo não é um PDF válido'),{status:422});
 const end=bytes.subarray(Math.max(0,bytes.length-2048)).toString('latin1');if(!end.includes('%%EOF'))throw Object.assign(new Error('PDF incompleto'),{status:422});
 const id=crypto.randomUUID(),dir=pdfDirectory(dataFile),name=path.basename(String(originalName)).replace(/[^a-zA-Z0-9._ -]/g,'').slice(0,100)||'cardapio.pdf';
 fs.mkdirSync(dir,{recursive:true,mode:0o700});const filepath=path.join(dir,id+'.pdf');fs.writeFileSync(filepath,bytes,{mode:0o600,flag:'wx'});
 const m=load(dataFile),item={id,name:name.toLowerCase().endsWith('.pdf')?name:name+'.pdf',size:bytes.length,uploadedAt:new Date().toISOString(),sha256:crypto.createHash('sha256').update(bytes).digest('hex')};
 m.versions.unshift(item);m.active=id;
 try{write(dataFile,m);}catch(e){fs.rmSync(filepath,{force:true});throw e;}
 return pdfStatus(dataFile);
}
export function activatePdf(dataFile,id){const m=load(dataFile);if(!m.versions.some(x=>x.id===id&&fs.existsSync(path.join(pdfDirectory(dataFile),x.id+'.pdf'))))return false;m.active=id;write(dataFile,m);return true;}
