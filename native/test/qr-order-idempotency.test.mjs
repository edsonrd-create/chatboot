import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {newSession,addPizza,confirmCustomerName,setFulfillment,setPayment,requestConfirmation,confirmRequest} from '../src/core.mjs';
import {catalogFromPdvMenu} from '../src/pdv-catalog.mjs';
const server=fs.readFileSync(new URL('../src/server.mjs',import.meta.url),'utf8');
const base=JSON.parse(fs.readFileSync(new URL('../config/business.json',import.meta.url),'utf8'));
const business=catalogFromPdvMenu({ok:true,items:[{id:17,kind:'pizza',name:'Calabresa',sizes:[{label:'Grande',priceCents:5999,maxFlavors:2}]}]},base);
function confirmation(id){
 const s=newSession();
 s.customerPhone='5541999990000';
 s.confirmationMessageId=id;
 assert.equal(addPizza(s,business,{size:'grande',flavors:['calabresa']}).ok,true);
 assert.equal(confirmCustomerName(s,{name:'Ana Silva'}).ok,true);
 assert.equal(setFulfillment(s,{method:'PICKUP'}).ok,true);
 assert.equal(setPayment(s,{method:'PIX'}).ok,true);
 const r=requestConfirmation(s,business);assert.equal(r.ok,true);
 s.quotePresented=true;
 const out=confirmRequest(s,business,{explicitConfirmation:true});
 assert.equal(out.ok,true);
 return out.requestId;
}
test('a mesma mensagem confirmada mantém o ID após reconstruir a sessão',()=>{
 const id=crypto.createHash('sha256').update('1:wa-msg-123:5541999990000').digest('hex').slice(0,32);
 assert.equal(confirmation(id),id);
 assert.equal(confirmation(id),id);
 assert.notEqual(confirmation(crypto.createHash('sha256').update('1:wa-msg-124:5541999990000').digest('hex').slice(0,32)),id);
});
test('QR prepara resposta e persiste sessão antes de enviar ao cliente',()=>{
 const prepared=server.indexOf('job.preparedReply=reply');
 const send=server.indexOf('const out=await qr.send(m.slot,m.jid,payload)',prepared);
 assert.ok(prepared>0&&send>prepared);
 assert.match(server,/typeof savedReply==='string'/);
 assert.match(server,/t.session=structuredClone\(session\)/);
});
