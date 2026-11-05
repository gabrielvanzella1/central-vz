// Acessos da central: usuários, senhas (com hash scrypt, nunca em texto) e sessões.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const ARQ = path.join('dados', 'usuarios.json'); // fora do git: tem os hashes das senhas
const SESSAO_DIAS = 30;
// Sessões gravadas em arquivo (fora do git) para sobreviver a reinícios do servidor
const ARQ_SESSOES = path.join('dados', 'sessoes.json');
const sessoes = new Map((() => { try { return Object.entries(JSON.parse(fs.readFileSync(ARQ_SESSOES, 'utf8'))); } catch { return []; } })());
const salvarSessoes = () => { fs.mkdirSync('dados', { recursive: true }); fs.writeFileSync(ARQ_SESSOES, JSON.stringify(Object.fromEntries(sessoes))); };
const tentativas = new Map(); // usuario -> { erros, bloqueadoAte }

export const lerUsuarios = () => { try { return JSON.parse(fs.readFileSync(ARQ, 'utf8')); } catch { return []; } };
const gravarUsuarios = (lista) => { fs.mkdirSync('dados', { recursive: true }); fs.writeFileSync(ARQ, JSON.stringify(lista, null, 2)); };

export function gerarHash(senha) {
  const sal = crypto.randomBytes(16).toString('hex');
  return `${sal}:${crypto.scryptSync(senha, sal, 64).toString('hex')}`;
}
function confere(senha, guardado) {
  const [sal, hash] = guardado.split(':');
  const calc = crypto.scryptSync(senha, sal, 64);
  return crypto.timingSafeEqual(calc, Buffer.from(hash, 'hex'));
}
export const senhaProvisoria = () => crypto.randomBytes(6).toString('base64url'); // 8 caracteres

export function criarUsuario({ usuario, nome, papel, email = null }) {
  const lista = lerUsuarios();
  if (lista.some((u) => u.usuario === usuario || (email && u.email === email))) return null;
  const senha = senhaProvisoria();
  lista.push({ usuario, nome, papel, email, hash: gerarHash(senha), trocarSenha: true });
  gravarUsuarios(lista);
  return senha;
}

// Login pelo usuário OU pelo e-mail cadastrado.
// Bloqueio simples: 5 erros seguidos bloqueiam aquele login por 5 minutos.
export function entrar(login, senha) {
  const t = tentativas.get(login) || { erros: 0, bloqueadoAte: 0 };
  if (Date.now() < t.bloqueadoAte) return { erro: 'Muitas tentativas. Espere alguns minutos.' };
  const u = lerUsuarios().find((x) => x.usuario === login || x.email === login);
  if (!u || !confere(senha, u.hash)) {
    t.erros++;
    if (t.erros >= 5) { t.erros = 0; t.bloqueadoAte = Date.now() + 5 * 60_000; }
    tentativas.set(login, t);
    return { erro: 'E-mail, usuário ou senha incorretos.' };
  }
  tentativas.delete(login);
  const token = crypto.randomBytes(32).toString('hex');
  for (const [t, v] of sessoes) if (v.expira < Date.now()) sessoes.delete(t); // limpa as vencidas
  sessoes.set(token, { usuario: u.usuario, expira: Date.now() + SESSAO_DIAS * 86_400_000 });
  salvarSessoes();
  return { token, usuario: u.usuario };
}

export function quemE(req) {
  const token = /(?:^|;\s*)vz_sessao=([a-f0-9]{64})/.exec(req.headers.cookie || '')?.[1];
  const s = token && sessoes.get(token);
  if (!s || s.expira < Date.now()) return null;
  const u = lerUsuarios().find((x) => x.usuario === s.usuario);
  return u ? { usuario: u.usuario, nome: u.nome, papel: u.papel, trocarSenha: u.trocarSenha, vistos: u.vistos || [], versao: u.versao || 'normal', token } : null;
}
// Ajudas que a pessoa já viu (tour, explicações das telas): aparecem só no primeiro acesso, em qualquer máquina
export function marcarVisto(usuario, chave) {
  const lista = lerUsuarios();
  const u = lista.find((x) => x.usuario === usuario);
  if (!u || (u.vistos || []).includes(chave)) return;
  u.vistos = [...(u.vistos || []), chave];
  gravarUsuarios(lista);
}
// Versão da VZ que a pessoa escolheu: "normal" (padrão) ou "personalizada" (personagem, voz e personalidade próprias)
export const VERSOES = ['normal', 'personalizada'];
export function definirVersao(usuario, versao) {
  if (!VERSOES.includes(versao)) return false;
  const lista = lerUsuarios();
  const u = lista.find((x) => x.usuario === usuario);
  if (!u) return false;
  u.versao = versao;
  gravarUsuarios(lista);
  return true;
}
export const sair = (token) => { sessoes.delete(token); salvarSessoes(); };

export function trocarSenha(usuario, atual, nova) {
  if (typeof nova !== 'string' || nova.length < 8) return { erro: 'A senha nova precisa de pelo menos 8 caracteres.' };
  const lista = lerUsuarios();
  const u = lista.find((x) => x.usuario === usuario);
  if (!u || !confere(atual || '', u.hash)) return { erro: 'A senha atual está incorreta.' };
  if (atual === nova) return { erro: 'A senha nova precisa ser diferente da atual.' };
  u.hash = gerarHash(nova);
  u.trocarSenha = false;
  gravarUsuarios(lista);
  return { ok: true };
}

export const cookieSessao = (token) => `vz_sessao=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSAO_DIAS * 86400}`;
export const cookieApagar = 'vz_sessao=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0';
