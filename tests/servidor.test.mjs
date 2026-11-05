// Testes do servidor: sobe numa porta de teste e confere as proteções básicas. Não faz login (não mexe em dados/).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';

let proc, base;

const portaLivre = () => new Promise((ok) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => ok(port)); }); });

before(async () => {
  const porta = await portaLivre();
  base = `http://127.0.0.1:${porta}`;
  proc = spawn(process.execPath, ['servidor.mjs'], { env: { ...process.env, PORTA: String(porta), ANTHROPIC_API_KEY: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((ok, falha) => {
    const t = setTimeout(() => falha(new Error('o servidor não subiu')), 8000);
    proc.stdout.on('data', (d) => { if (String(d).includes('Central da VZ em')) { clearTimeout(t); ok(); } });
    proc.on('exit', () => falha(new Error('o servidor encerrou')));
  });
});
after(() => proc?.kill());

test('a API de dados exige login', async () => {
  for (const rota of ['/api/tarefas', '/api/projetos', '/api/historico', '/api/memoria', '/api/eu']) {
    assert.equal((await fetch(base + rota)).status, 401, rota);
  }
});

test('o estado público não vaza segredos', async () => {
  const r = await fetch(base + '/api/estado');
  assert.equal(r.status, 200);
  const txt = await r.text();
  assert.ok(!/sk-ant|api[_-]?key"\s*:\s*"[^"]/i.test(txt));
});

test('não deixa sair da pasta public/', async () => {
  for (const caminho of ['/../servidor.mjs', '/%2e%2e/servidor.mjs', '/..%2f..%2f.env', '/dados/usuarios.json']) {
    const r = await fetch(base + caminho);
    assert.equal(r.status, 404, caminho);
  }
});

test('login com corpo inválido é recusado sem derrubar o servidor', async () => {
  const r = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"usuario": 1}' });
  assert.equal(r.status, 400);
  assert.equal((await fetch(base + '/api/estado')).status, 200);
});
