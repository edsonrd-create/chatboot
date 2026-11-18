import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {cardapioChoice} from '../src/cardapio-whatsapp.mjs';
import {pdfStatus,uploadPdf,activatePdf,getActivePdf} from '../src/cardapio-pdf.mjs';

test('primeiro oferece cardápio digital; escolha WhatsApp gera envio do PDF',()=>{
 const session={};
 const first=cardapioChoice(session,'me manda o cardápio',{catalogSynced:true,pdfAvailable:true});
 assert.match(first.reply,/www.gutoexpress.com.br/);
 assert.equal(session.pendingCardapioPdf,undefined);
 const second=cardapioChoice(session,'prefiro pedir por aqui mesmo',{catalogSynced:true,pdfAvailable:true});
 assert.match(second.reply,/PDF/);
 assert.equal(session.pendingCardapioPdf,true);
});
test('pedido direto de PDF não inventa anexo quando arquivo não existe',()=>{
 const session={};
 assert.match(cardapioChoice(session,'me manda o PDF',{pdfAvailable:false}).reply,/sendo atualizado/);
 assert.equal(session.pendingCardapioPdf,undefined);
});
test('versões PDF são restauráveis sem perda do arquivo anterior',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'guto-native-pdf-'));
 try{
  const file=path.join(dir,'state.json');
  const pdf=Buffer.from(('%PDF-1.4\n1 0 obj <</Type /Catalog>> endobj\ntrailer <</Root 1 0 R>>\n%%EOF\n').padEnd(128,' '));
  const a=uploadPdf(file,pdf,'cardapio-antigo.pdf');
  const b=uploadPdf(file,pdf,'cardapio-novo.pdf');
  assert.equal(b.versions.length,2);
  assert.equal(getActivePdf(file).name,'cardapio-novo.pdf');
  assert.equal(activatePdf(file,a.active.id),true);
  assert.equal(pdfStatus(file).active.name,'cardapio-antigo.pdf');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
