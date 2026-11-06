import fs from 'node:fs';
import path from 'node:path';

const blank = () => ({version:1, sessions:{}, events:{}, outbox:{}, orders:[], nextOrder:1});
export class FileStore {
  constructor(file){this.file=path.resolve(file);this.data=blank();this.lock=Promise.resolve();}
  init(){fs.mkdirSync(path.dirname(this.file),{recursive:true});if(fs.existsSync(this.file)){const d=JSON.parse(fs.readFileSync(this.file,'utf8'));this.data={...blank(),...d};}return this;}
  async tx(fn){
    const work=this.lock.catch(()=>{}).then(async()=>{
      const copy=structuredClone(this.data);
      const result=await fn(copy);
      const temp=`${this.file}.${process.pid}.tmp`;
      fs.writeFileSync(temp,JSON.stringify(copy,null,2),{mode:0o600});
      fs.renameSync(temp,this.file);
      this.data=copy;
      return result;
    });this.lock=work.then(()=>{},()=>{});return work;
  }
  snapshot(){return structuredClone(this.data);}
}
