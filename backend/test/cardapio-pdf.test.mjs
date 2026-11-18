import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pdfDirectory,pdfStatus,getActivePdf,uploadPdf,activatePdf,MAX_PDF_SIZE} from '../src/cardapio-pdf.mjs';

const fixture=Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n'.padEnd(130,' '));
function sandbox(fn){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'guto-cardapio-test-'));try{return fn(path.join(dir,'state.json'));}finally{fs.rmSync(dir,{recursive:true,force:true});}}

test('pasta criada e troca manual mantém versão antiga',()=>sandbox(file=>{
 assert.equal(pdfStatus(file).active,null);
 const first=uploadPdf(file,fixture,'original.pdf');
 assert.equal(first.versions.length,1);
 assert.equal(getActivePdf(file).name,'original.pdf');
 const second=uploadPdf(file,fixture,'atualizado.pdf');
 assert.equal(second.versions.length,2);
 assert.equal(getActivePdf(file).name,'atualizado.pdf');
 assert.equal(activatePdf(file,first.versions[0].id),true);
 assert.equal(getActivePdf(file).name,'original.pdf');
 assert.equal(fs.existsSync(pdfDirectory(file)),true);
}));
test('arquivo inválido é rejeitado sem alterar o PDF ativo',()=>sandbox(file=>{
 uploadPdf(file,fixture,'valido.pdf');
 assert.throws(()=>uploadPdf(file,Buffer.from('not pdf'),'falso.pdf'),/PDF/);
 assert.throws(()=>uploadPdf(file,Buffer.alloc(MAX_PDF_SIZE+1),'grande.pdf'),/20 MB/);
 assert.equal(activatePdf(file,'../inexistente'),false);
 assert.equal(getActivePdf(file).name,'valido.pdf');
}));
