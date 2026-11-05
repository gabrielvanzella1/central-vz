// Testes do filtro de eco da voz (distingue a própria fala da VZ de você interrompendo).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ehEco } from '../public/eco.js';

const fala = 'Hoje a única prioridade é o cartão 36, zz teste tela. Ele está em a fazer no projeto geral, tem prioridade alta e o prazo vence hoje.';

test('trechos do que ela disse são eco', () => {
  assert.equal(ehEco('prioridade é o cartão 36', fala), true);
  assert.equal(ehEco('ele está em a fazer no projeto geral', fala), true);
  assert.equal(ehEco('hoje a única prioridade é o cartão', fala), true);
  assert.equal(ehEco('', fala), true);
});

test('o que é você falando não é eco', () => {
  assert.equal(ehEco('espera um segundo', fala), false);
  assert.equal(ehEco('não, abre o quadro', fala), false);
  assert.equal(ehEco('cria uma tarefa nova no projeto geral', fala), false);
  assert.equal(ehEco('pare', fala), false);
});

test('sem fala em andamento, tudo é você', () => {
  assert.equal(ehEco('qualquer coisa', ''), false);
});
