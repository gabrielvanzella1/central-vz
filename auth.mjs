// Acessos da central: usuários, senhas (com hash scrypt, nunca em texto), sessões e a senha de emergência.
//
// Senha de emergência (coação): uma segunda senha para usar só se a pessoa for obrigada a abrir a central.
// Quem entra com ela recebe uma sessão em modo "coacao": o servidor mostra um painel vazio, tranca a conta
// (alerta), pode encerrar as outras sessões e avisar alguém. Para destrancar é preciso o código de recuperação,
// que a pessoa guarda fora do computador. Nada é apagado: só deixa de ser mostrado.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const ARQ = path.join('dados', 'usuarios.json'); // fora do git: tem os hashes das senhas
const SESSAO_DIAS = 30;
const SESSAO_COACAO_MS = 2 * 3_600_000; // quem entra sob ameaça só fica 2 horas
// Sessões gravadas em arquivo (fora do git) para sobreviver a reinícios do servidor
const ARQ_SESSOES = path.join('dados', 'sessoes.json');
const sessoes = new Map((() => { try { return Object.entries(JSON.parse(fs.readFileSync(ARQ_SESSOES, 'utf8'))); } catch { return []; } })());
const salvarSessoes = () => { fs.mkdirSync('dados', { recursive: true }); fs.writeFileSync(ARQ_SESSOES, JSON.stringify(Object.fromEntries(sessoes))); };
const tentativas = new Map(); // login -> { erros, bloqueadoAte }

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
const HASH_FALSO = gerarHash(crypto.randomBytes(8).toString('hex')); // para gastar o mesmo tempo quando não há senha a conferir
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
// Confere SEMPRE as duas senhas (normal e de emergência), com o mesmo trabalho: quem olha de fora não descobre
// se existe senha de emergência, e a resposta de erro é a mesma.
export function entrar(login, senha) {
  const t = tentativas.get(login) || { erros: 0, bloqueadoAte: 0 };
  if (Date.now() < t.bloqueadoAte) return { erro: 'Muitas tentativas. Espere alguns minutos.' };
  const lista = lerUsuarios();
  const u = lista.find((x) => x.usuario === login || x.email === login);
  const normal = confere(senha, u?.hash || HASH_FALSO) && Boolean(u);
  const emergencia = confere(senha, u?.hashEmergencia || HASH_FALSO) && Boolean(u?.hashEmergencia);
  if (!normal && !emergencia) {
    t.erros++;
    if (t.erros >= 5) { t.erros = 0; t.bloqueadoAte = Date.now() + 5 * 60_000; }
    tentativas.set(login, t);
    return { erro: 'E-mail, usuário ou senha incorretos.' };
  }
  tentativas.delete(login);
  const token = crypto.randomBytes(32).toString('hex');
  for (const [k, v] of sessoes) if (v.expira < Date.now()) sessoes.delete(k); // limpa as vencidas

  if (emergencia) {
    u.alerta = { desde: new Date().toISOString() }; // a conta fica trancada até o código de recuperação
    gravarUsuarios(lista);
    sessoes.set(token, { usuario: u.usuario, expira: Date.now() + SESSAO_COACAO_MS, modo: 'coacao' });
    salvarSessoes();
    return { token, usuario: u.usuario, coacao: { avisoUrl: u.emergencia?.avisoUrl || null, acoes: u.emergencia?.acoes || {} } };
  }
  const sessao = { usuario: u.usuario, expira: Date.now() + SESSAO_DIAS * 86_400_000 };
  if (u.alerta) sessao.modo = 'recuperacao'; // houve um alerta: só destrava com o código
  sessoes.set(token, sessao);
  salvarSessoes();
  return { token, usuario: u.usuario };
}

export function quemE(req) {
  const token = /(?:^|;\s*)vz_sessao=([a-f0-9]{64})/.exec(req.headers.cookie || '')?.[1];
  const s = token && sessoes.get(token);
  if (!s || s.expira < Date.now()) return null;
  const u = lerUsuarios().find((x) => x.usuario === s.usuario);
  return u ? { usuario: u.usuario, nome: u.nome, papel: u.papel, trocarSenha: u.trocarSenha, vistos: u.vistos || [], versao: u.versao || 'normal', vistoEm: u.vistoEm || {}, modo: s.modo, token } : null;
}
// Ajudas que a pessoa já viu (tour, explicações das telas): aparecem só no primeiro acesso, em qualquer máquina
export function marcarVisto(usuario, chave) {
  const lista = lerUsuarios();
  const u = lista.find((x) => x.usuario === usuario);
  if (!u || (u.vistos || []).includes(chave)) return;
  u.vistos = [...(u.vistos || []), chave];
  gravarUsuarios(lista);
}
// Avisos (bolinhas): quando a pessoa viu cada área pela última vez
export const AREAS_AVISO = ['tarefas', 'radar', 'estudos', 'equipe'];
export function marcarVistoEm(usuario, area) {
  const lista = lerUsuarios();
  const u = lista.find((x) => x.usuario === usuario);
  if (!u) return false;
  const agora = new Date().toISOString();
  u.vistoEm = { ...(u.vistoEm || {}) };
  for (const a of area === 'tudo' ? AREAS_AVISO : [area]) if (AREAS_AVISO.includes(a)) u.vistoEm[a] = agora;
  gravarUsuarios(lista);
  return true;
}
// Sequência de dias usando a Central (incentivo, estilo Duolingo): grava o dia de hoje e devolve quantos dias seguidos
export function registrarDiaDeUso(usuario) {
  const lista = lerUsuarios();
  const u = lista.find((x) => x.usuario === usuario);
  if (!u) return 0;
  const dia = (d) => d.toLocaleDateString('sv-SE');
  const hoje = dia(new Date());
  if (!(u.diasDeUso || []).includes(hoje)) { u.diasDeUso = [...(u.diasDeUso || []), hoje].slice(-120); gravarUsuarios(lista); }
  const dias = new Set(u.diasDeUso);
  let n = 0;
  for (const d = new Date(); dias.has(dia(d)); d.setDate(d.getDate() - 1)) n++;
  return n;
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
// Encerra todas as sessões de uma pessoa, menos (opcionalmente) a que está em uso
export function encerrarSessoes(usuario, exceto = null) {
  for (const [k, v] of sessoes) if (v.usuario === usuario && k !== exceto) sessoes.delete(k);
  salvarSessoes();
}

export function trocarSenha(usuario, atual, nova) {
  if (typeof nova !== 'string' || nova.length < 8) return { erro: 'A senha nova precisa de pelo menos 8 caracteres.' };
  const lista = lerUsuarios();
  const u = lista.find((x) => x.usuario === usuario);
  if (!u || !confere(atual || '', u.hash)) return { erro: 'A senha atual está incorreta.' };
  if (atual === nova) return { erro: 'A senha nova precisa ser diferente da atual.' };
  if (u.hashEmergencia && confere(nova, u.hashEmergencia)) return { erro: 'A senha nova não pode ser igual à senha de emergência.' };
  u.hash = gerarHash(nova);
  u.trocarSenha = false;
  gravarUsuarios(lista);
  return { ok: true };
}

// ---------- senha de emergência ----------
const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sem 0, O, 1, I: fácil de ler no papel
const novoCodigo = () => Array.from({ length: 4 }, () => Array.from({ length: 4 }, () => ALFABETO[crypto.randomInt(ALFABETO.length)]).join('')).join('-');
const normalizarCodigo = (c) => String(c).toUpperCase().replace(/[^A-Z0-9]/g, '');

// O endereço de aviso (ex.: um tópico do ntfy.sh) só pode ser https e público, para a central não ser usada para chamar a rede interna
export function urlAvisoValida(texto) {
  try {
    const u = new URL(String(texto).trim());
    if (u.protocol !== 'https:' || u.username || u.password) return null;
    const h = u.hostname.toLowerCase();
    if (!h.includes('.') || h === 'localhost' || h.endsWith('.local') || h.endsWith('.localhost') || h.endsWith('.internal')) return null;
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h.includes(':') || h.startsWith('[')) return null; // IP direto não
    return u.toString().slice(0, 300);
  } catch { return null; }
}

export function configurarEmergencia(usuario, atual, emergencia, opcoes = {}) {
  const lista = lerUsuarios();
  const u = lista.find((x) => x.usuario === usuario);
  if (!u || typeof atual !== 'string' || !confere(atual, u.hash)) return { erro: 'A senha atual está incorreta.' };
  if (u.alerta) return { erro: 'Há um alerta de emergência ativo. Confirme o código de recuperação antes de mudar isto.' };
  if (typeof emergencia !== 'string' || emergencia.length < 8) return { erro: 'A senha de emergência precisa de pelo menos 8 caracteres.' };
  if (emergencia.toLowerCase() === atual.toLowerCase()) return { erro: 'A senha de emergência precisa ser diferente da senha normal.' };
  const url = opcoes.avisoUrl ? urlAvisoValida(opcoes.avisoUrl) : null;
  if (opcoes.avisoUrl && !url) return { erro: 'O endereço de aviso precisa ser https e público, por exemplo https://ntfy.sh/um-nome-longo-e-secreto.' };
  const codigo = novoCodigo();
  u.hashEmergencia = gerarHash(emergencia);
  u.hashRecuperacao = gerarHash(normalizarCodigo(codigo));
  u.emergencia = {
    avisoUrl: url,
    // bloquear integrações não é opcional: no modo de emergência nenhuma conta conectada é usada
    acoes: { avisar: Boolean(url), encerrarSessoes: opcoes.encerrarSessoes !== false, bloquearIntegracoes: true },
    desde: new Date().toISOString(),
  };
  gravarUsuarios(lista);
  return { ok: true, codigo }; // o código só aparece agora
}

export function removerEmergencia(usuario, atual) {
  const lista = lerUsuarios();
  const u = lista.find((x) => x.usuario === usuario);
  if (!u || typeof atual !== 'string' || !confere(atual, u.hash)) return { erro: 'A senha atual está incorreta.' };
  if (u.alerta) return { erro: 'Há um alerta de emergência ativo. Confirme o código de recuperação antes.' };
  delete u.hashEmergencia; delete u.hashRecuperacao; delete u.emergencia;
  gravarUsuarios(lista);
  return { ok: true };
}

export function statusEmergencia(usuario) {
  const u = lerUsuarios().find((x) => x.usuario === usuario);
  if (!u?.hashEmergencia) return { configurada: false };
  let aviso = null;
  try { aviso = u.emergencia?.avisoUrl ? new URL(u.emergencia.avisoUrl).hostname : null; } catch { /* sem aviso */ }
  return { configurada: true, aviso, acoes: u.emergencia?.acoes || {}, desde: u.emergencia?.desde || null };
}

// Destrava a conta depois de um alerta. O código vale uma vez: ao usar, nasce outro.
export function recuperar(usuario, codigo) {
  const chave = `rec:${usuario}`;
  const t = tentativas.get(chave) || { erros: 0, bloqueadoAte: 0 };
  if (Date.now() < t.bloqueadoAte) return { erro: 'Muitas tentativas. Espere alguns minutos.' };
  const lista = lerUsuarios();
  const u = lista.find((x) => x.usuario === usuario);
  if (!u || !u.alerta) return { erro: 'Não há alerta ativo.' };
  if (!u.hashRecuperacao || !confere(normalizarCodigo(codigo), u.hashRecuperacao)) {
    t.erros++;
    if (t.erros >= 5) { t.erros = 0; t.bloqueadoAte = Date.now() + 15 * 60_000; }
    tentativas.set(chave, t);
    return { erro: 'Código incorreto.' };
  }
  tentativas.delete(chave);
  const novo = novoCodigo();
  u.alerta = null;
  u.hashRecuperacao = gerarHash(normalizarCodigo(novo));
  gravarUsuarios(lista);
  for (const [k, v] of sessoes) {
    if (v.usuario !== usuario) continue;
    if (v.modo === 'coacao') sessoes.delete(k); // a sessão de quem estava sob ameaça cai
    else if (v.modo === 'recuperacao') delete v.modo;
  }
  salvarSessoes();
  return { ok: true, codigoNovo: novo };
}

export const cookieSessao = (token) => `vz_sessao=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSAO_DIAS * 86400}`;
export const cookieApagar = 'vz_sessao=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0';
