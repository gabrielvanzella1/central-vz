// Testes dos acessos (senha, bloqueio, versão, "já vi"). Rodam numa pasta temporária.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const raiz = process.cwd();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'central-auth-'));
let auth;

before(async () => {
  process.chdir(tmp);
  auth = await import(pathToFileURL(path.join(raiz, 'auth.mjs')).href);
});
after(() => { process.chdir(raiz); fs.rmSync(tmp, { recursive: true, force: true }); });

test('usuário novo recebe senha provisória e precisa trocá-la', () => {
  const senha = auth.criarUsuario({ usuario: 'ana', nome: 'Ana', papel: 'dev', email: 'ana@exemplo.com' });
  assert.ok(senha && senha.length >= 8);
  assert.equal(auth.criarUsuario({ usuario: 'ana', nome: 'Ana', papel: 'dev' }), null, 'duplicado deveria ser recusado');
  assert.equal(auth.lerUsuarios()[0].trocarSenha, true);
  assert.ok(!JSON.stringify(auth.lerUsuarios()).includes(senha), 'a senha apareceu em texto no arquivo');
});

test('login por usuário ou por e-mail; senha errada é recusada', () => {
  const senha = 'trocada12345';
  const prov = auth.criarUsuario({ usuario: 'beto', nome: 'Beto', papel: 'dev', email: 'Beto@Exemplo.com' });
  assert.ok(auth.trocarSenha('beto', prov, senha).ok);
  assert.ok(auth.entrar('beto', senha).token);
  assert.ok(auth.entrar('Beto@Exemplo.com', senha).token);
  assert.ok(auth.entrar('beto', 'errada').erro);
});

test('trocar senha exige 8 caracteres, senha atual correta e senha diferente', () => {
  const prov = auth.criarUsuario({ usuario: 'carla', nome: 'Carla', papel: 'dev' });
  assert.match(auth.trocarSenha('carla', prov, '123').erro, /8 caracteres/);
  assert.match(auth.trocarSenha('carla', 'outra-senha', 'nova-senha-1').erro, /atual/);
  assert.match(auth.trocarSenha('carla', prov, prov).erro, /diferente/);
});

test('5 erros seguidos bloqueiam o login por alguns minutos', () => {
  auth.criarUsuario({ usuario: 'davi', nome: 'Davi', papel: 'dev' });
  for (let i = 0; i < 5; i++) auth.entrar('davi', 'errada');
  assert.match(auth.entrar('davi', 'errada').erro, /tentativas/);
});

test('versão da VZ só aceita normal ou personalizada', () => {
  auth.criarUsuario({ usuario: 'eva', nome: 'Eva', papel: 'dev' });
  assert.equal(auth.definirVersao('eva', 'personalizada'), true);
  assert.equal(auth.definirVersao('eva', 'luna'), false);
  assert.equal(auth.definirVersao('ninguem', 'normal'), false);
  assert.equal(auth.lerUsuarios().find((u) => u.usuario === 'eva').versao, 'personalizada');
});

test('"já vi" não repete a mesma chave', () => {
  auth.criarUsuario({ usuario: 'fabio', nome: 'Fábio', papel: 'dev' });
  auth.marcarVisto('fabio', 'tour'); auth.marcarVisto('fabio', 'tour');
  assert.deepEqual(auth.lerUsuarios().find((u) => u.usuario === 'fabio').vistos, ['tour']);
});

test('senha de emergência: entra em modo coação, tranca a conta e só destrava com o código', () => {
  auth.criarUsuario({ usuario: 'chefe', nome: 'Chefe', papel: 'dono', email: 'chefe@exemplo.com' });
  const prov = auth.lerUsuarios().find((u) => u.usuario === 'chefe');
  prov.trocarSenha = false;
  // define a senha normal conhecida
  const lista = auth.lerUsuarios(); lista.find((u) => u.usuario === 'chefe').hash = auth.gerarHash('senhanormal1');
  fs.writeFileSync(path.join('dados', 'usuarios.json'), JSON.stringify(lista));
  assert.match(auth.configurarEmergencia('chefe', 'errada', 'socorro123').erro, /incorreta/);
  assert.match(auth.configurarEmergencia('chefe', 'senhanormal1', 'senhanormal1').erro, /diferente/);
  assert.match(auth.configurarEmergencia('chefe', 'senhanormal1', 'socorro123', { avisoUrl: 'http://127.0.0.1/x' }).erro, /https/);
  const { codigo } = auth.configurarEmergencia('chefe', 'senhanormal1', 'socorro123', { avisoUrl: 'https://ntfy.sh/teste-vz' });
  assert.match(codigo, /^[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/);
  assert.ok(!JSON.stringify(auth.lerUsuarios()).includes('socorro123'));
  const req = (t) => ({ headers: { cookie: `vz_sessao=${t}` } });
  const c = auth.entrar('chefe@exemplo.com', 'socorro123');
  assert.equal(auth.quemE(req(c.token)).modo, 'coacao');
  const n = auth.entrar('chefe', 'senhanormal1');
  assert.equal(auth.quemE(req(n.token)).modo, 'recuperacao', 'depois do alerta a senha normal não abre tudo');
  assert.match(auth.recuperar('chefe', 'AAAA-AAAA-AAAA-AAAA').erro, /incorreto/);
  const r = auth.recuperar('chefe', codigo.toLowerCase());
  assert.ok(r.ok && r.codigoNovo !== codigo);
  assert.equal(auth.quemE(req(n.token)).modo, undefined);
  assert.equal(auth.quemE(req(c.token)), null, 'a sessão de coação cai');
});
