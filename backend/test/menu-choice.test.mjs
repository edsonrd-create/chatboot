import test from 'node:test';
import assert from 'node:assert/strict';
import {menuChoiceReply} from '../src/menu-choice.mjs';
import {newSession} from '../src/core.mjs';
import {intelligentReply} from '../src/ai.mjs';

test('ao pedir cardápio oferece primeiro site e aplicativo, sem anexar PDF',()=>{
 const s=newSession();
 const r=menuChoiceReply(s,'Pode me mandar o cardápio?',{pdfAvailable:true});
 assert.match(r.reply,/www.gutoexpress.com.br/);
 assert.match(r.reply,/play.google.com/);
 assert.match(r.reply,/WhatsApp/);
 assert.equal(r.sendPdf,undefined);
 assert.equal(s.menuChoice,'awaiting');
});
test('opção 2 envia PDF somente quando existe arquivo no servidor',()=>{
 const s=newSession();
 menuChoiceReply(s,'cardápio',{pdfAvailable:true});
 const r=menuChoiceReply(s,'2',{pdfAvailable:true});
 assert.equal(r.sendPdf,true);
 assert.equal(s.menuChoice,'whatsapp');
});
test('sem PDF mantém atendimento com link oficial e não promete anexo',()=>{
 const s=newSession();
 menuChoiceReply(s,'cardápio');
 const r=menuChoiceReply(s,'pelo whatsapp',{pdfAvailable:false});
 assert.equal(r.sendPdf,false);
 assert.match(r.reply,/gutoexpress.com.br\/cardapio/);
 assert.doesNotMatch(r.reply,/vou enviar.*PDF/i);
});
test('após opção 1 cliente ainda pode optar pelo WhatsApp',()=>{
 const s=newSession();
 menuChoiceReply(s,'cardápio');
 menuChoiceReply(s,'1');
 const r=menuChoiceReply(s,'2',{pdfAvailable:true});
 assert.equal(r.sendPdf,true);
});
test('pedido direto não é interceptado como pedido de cardápio',()=>{
 const s=newSession();
 assert.equal(menuChoiceReply(s,'quero uma pizza grande calabresa'),null);
});
test('motor real não chama o provedor ao apresentar a escolha de canais',async()=>{
 const s=newSession();
 const r=await intelligentReply('Me manda o cardápio',s,{}, {apiKey:'fake',pdfAvailable:true});
 assert.match(r,/opção|WhatsApp|\*2\*/i);
 assert.equal(s.pendingMenuPdf,undefined);
 const chosen=await intelligentReply('2',s,{}, {apiKey:'fake',pdfAvailable:true});
 assert.equal(s.pendingMenuPdf,true);
 assert.match(chosen,/PDF/);
});
