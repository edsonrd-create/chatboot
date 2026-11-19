import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

const code = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');

test('painel preserva ultimo diagnostico PDV ao redesenhar o status', () => {
  assert.match(code, /ss\.pdvOrderStatusText\|\|'PDV: verificando autenticação de pedidos…'/);
  assert.match(code, /ss\.pdvOrderStatusText='PDV: '\+\(titles\[result\.mode\]/);
  assert.match(code, /ss\.pdvOrderStatusText='PDV: '\+\(reasons\[result\.reason\]/);
  assert.match(code, /if\(label\)label\.textContent=ss\.pdvOrderStatusText/);
});
