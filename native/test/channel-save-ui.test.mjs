import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const app=fs.readFileSync(path.join(root,'public/app.js'),'utf8');
const css=fs.readFileSync(path.join(root,'public/app.css'),'utf8');
const begin=app.indexOf('// Confirma o que a API de fato guardou');
const end=app.indexOf('// SSE envia apenas o número de revisão',begin);
assert.ok(begin>0&&end>begin,'Isolar lógica de salvamento do front-end real');
const source=app.slice(begin,end);

class Element{
 constructor(tag='div',cls='',content=''){
  this.tag=tag;this.className=cls;this.textContent=content;this.children=[];
  this.disabled=false;this.value='';this.name='';this.type='';this.checked=false;
  this.dataset={};this.attrs={};this.events={};
  this.classList={
   add:cls=>{this.className=Array.from(new Set([...this.className.split(' ').filter(Boolean),cls])).join(' ');},
   remove:cls=>{this.className=this.className.split(' ').filter(x=>x!==cls).join(' ');},
   contains:cls=>this.className.split(' ').includes(cls)
  };
 }
 append(...children){this.children.push(...children);}
 replaceChildren(...children){this.children=[...children];}
 setAttribute(k,v){this.attrs[k]=String(v);}
 addEventListener(k,fn){this.events[k]=fn;}
 emit(k){this.events[k]?.();}
 querySelectorAll(selector){
  const allowed=selector.split(',').map(s=>s.trim());
  const out=[];
  const visit=node=>{
   for(const c of node.children){
    if(allowed.includes(c.tag))out.push(c);
    visit(c);
   }
  };
  visit(this);return out;
 }
 get elements(){return {namedItem:name=>this.querySelectorAll('input,textarea,button').find(x=>x.name===name)};}
}
const defaults=slot=>({
  slot,provider:'gemini',model:'gemini-2.5-flash',instructions:'',
  personality:'Atendimento claro e cordial',requestedEnabled:false,humanTransfer:true,
  enabled:false,hours:{start:'18:00',end:'23:20'}
});
function harness({saveError=null,readbackMismatch=false,readOnly=false,delayed=false}={}){
 const target=new Element(),store={1:defaults(1),2:defaults(2)};
 const calls=[];let complete;
 const gate=delayed?new Promise(resolve=>{complete=resolve;}):null;
 const api=async(url,opt={})=>{
  calls.push({url,method:opt.method||'GET'});
  if(url==='/api/operations/channels'){
   const data=structuredClone([store[1],store[2]]);
   if(readbackMismatch&&calls.filter(x=>x.url===url).length>1)data[0].personality='Valor desatualizado';
   return {items:data,readOnly};
  }
  if(url.startsWith('/api/operations/channels/')&&opt.method==='PUT'){
   if(gate)await gate;
   if(saveError)throw new Error(saveError);
   const slot=Number(url.slice(-1));
   store[slot]={...store[slot],...JSON.parse(opt.body)};
   return {ok:true,channel:structuredClone(store[slot])};
  }
  throw Error('Chamada não esperada '+url);
 };
 const context=vm.createContext({api,$:id=>id==='gemini-channel-settings'?target:undefined,
   x:(tag,cls='',text='')=>new Element(tag,cls,text)});
 const exports=vm.runInContext(source+';({loadChannelConfigs,channelSettingsMatch})',context);
 return {target,store,calls,...exports,complete:()=>complete?.()};
}
function formAt(h,slot){
 const form=h.target.children[slot-1];
 assert.ok(form,'Form WhatsApp 0'+slot);
 const button=form.querySelectorAll('button')[0];
 const feedback=form.children.find(x=>x.className.startsWith('channel-save-feedback'));
 assert.equal(feedback.attrs.role,'status');
 assert.equal(feedback.attrs['aria-live'],'polite');
 return {form,button,feedback,indicator:()=>feedback.children[0].textContent};
}
const submit=form=>form.onsubmit({preventDefault(){}});

test('Os 2 formulários têm confirmação acessível abaixo do botão Salvar',async()=>{
 const h=harness();await h.loadChannelConfigs();
 const one=formAt(h,1),two=formAt(h,2);
 assert.match(one.button.textContent,/Salvar WhatsApp 01/);
 assert.match(two.button.textContent,/Salvar WhatsApp 02/);
 assert.match(one.indicator(),/carregadas do servidor/);
 assert.match(two.indicator(),/carregadas do servidor/);
 assert.match(css,/\.channel-save-feedback\.saved/);
 assert.match(css,/\.channel-save-feedback\.error/);
 assert.match(css,/\.toast:not\(\[hidden\]\)/);
});

test('Salvando → Salvo somente depois de PUT e releitura GET dos mesmos valores',async()=>{
 const h=harness({delayed:true});await h.loadChannelConfigs();
 const one=formAt(h,1),two=formAt(h,2);
 one.form.elements.namedItem('personality').value='Gentil, profissional';
 one.form.elements.namedItem('start').value='17:15';
 one.form.elements.namedItem('requestedEnabled').checked=true;
 one.form.emit('input');
 assert.match(one.indicator(),/não salvas/);
 const p=submit(one.form);
 assert.equal(one.button.textContent,'Salvando...');
 assert.equal(one.button.disabled,true);
 assert.match(one.indicator(),/Salvando/);
 assert.match(two.indicator(),/carregadas/);
 h.complete();await p;
 assert.match(one.button.textContent,/✓ Salvo/);
 assert.equal(one.form.dataset.saveState,'saved');
 assert.match(one.indicator(),/salvas e conferidas no servidor/);
 assert.equal(h.store[1].personality,'Gentil, profissional');
 assert.equal(h.store[1].hours.start,'17:15');
 assert.equal(h.store[1].requestedEnabled,true);
 assert.equal(h.store[2].personality,'Atendimento claro e cordial');
 assert.deepEqual(h.calls.map(x=>x.method),['GET','PUT','GET']);
 one.form.elements.namedItem('personality').value='Nova alteração';
 one.form.emit('input');
 assert.equal(one.form.dataset.saveState,'unsaved');
 assert.match(one.button.textContent,/Salvar WhatsApp 01/);
 assert.equal(two.form.dataset.saveState,undefined);
});

test('Erro de gravação mostra falha junto ao botão e não indica Salvo',async()=>{
 const h=harness({saveError:'Falha de conexão com o servidor'});await h.loadChannelConfigs();
 const one=formAt(h,1);
 one.form.elements.namedItem('instructions').value='Atendimento humano';
 await submit(one.form);
 assert.equal(one.form.dataset.saveState,'error');
 assert.match(one.indicator(),/NÃO confirmadas/);
 assert.match(one.indicator(),/Falha de conexão/);
 assert.match(one.button.textContent,/Tentar salvar/);
 assert.equal(one.button.disabled,false);
 assert.notEqual(h.store[1].instructions,'Atendimento humano');
});

test('GET diferente do PUT não mostra falso sucesso',async()=>{
 const h=harness({readbackMismatch:true});await h.loadChannelConfigs();
 const one=formAt(h,1);
 await submit(one.form);
 assert.equal(one.form.dataset.saveState,'error');
 assert.match(one.indicator(),/recebeu a alteração, mas não foi possível confirmar/);
 assert.doesNotMatch(one.button.textContent,/✓ Salvo/);
});

test('Prévia somente leitura mantém a gravação bloqueada e informa a razão',async()=>{
 const h=harness({readOnly:true});await h.loadChannelConfigs();
 const one=formAt(h,1);
 assert.equal(one.button.disabled,true);
 assert.match(one.indicator(),/somente leitura/);
 await submit(one.form);
 assert.equal(h.calls.filter(x=>x.method==='PUT').length,0);
});
