// Testes do radar: o que vem da IA (e da web) é limpo antes de ir para a tela.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validarRadar, extrairJSON } from '../radar.mjs';

test('extrai o JSON do bloco de código', () => {
  const r = extrairJSON('Aqui está:\n```json\n{"resumo":"ok","itens":[]}\n```');
  assert.equal(r.resumo, 'ok');
  assert.throws(() => extrairJSON('sem json nenhum'), /JSON/);
});

test('valida categorias, esforço, tamanhos e links', () => {
  const r = validarRadar({
    resumo: 'x'.repeat(1000),
    top3: [{ titulo: 'A', primeiro_passo: 'b' }, { titulo: '' }, {}, {}, {}],
    itens: [
      { categoria: 'mcp', titulo: 'Novo MCP', oque: 'faz algo', esforco: 'baixo', link: 'https://exemplo.com/a' },
      { categoria: 'hackear', titulo: 'X', oque: 'y', esforco: 'muito', link: 'javascript:alert(1)' },
      { titulo: 'sem descrição' },
      'lixo',
    ],
  });
  assert.equal(r.resumo.length, 700);
  assert.equal(r.top3.length, 1);
  assert.equal(r.itens.length, 2);
  assert.equal(r.itens[0].link, 'https://exemplo.com/a');
  assert.equal(r.itens[1].categoria, 'ferramenta');
  assert.equal(r.itens[1].esforco, 'medio');
  assert.equal(r.itens[1].link, '', 'link que não é https precisa ser descartado');
});

test('entrada vazia não quebra', () => {
  assert.deepEqual(validarRadar(null), { resumo: '', top3: [], itens: [] });
});
