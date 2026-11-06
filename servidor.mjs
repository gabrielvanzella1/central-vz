// Servidor da central: entrega as páginas de public/ e a API usada pelo painel.
// Escuta só em 127.0.0.1: a chave do Claude e os dados ficam nesta máquina.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import dns from 'node:dns/promises';
import { listarRadar, lerRadar, gerarRadar, agendarRadar, radarRodando, perfis } from './radar.mjs';
import Anthropic from '@anthropic-ai/sdk';
import { conversar, historico, novaConversa, todosProjetos, executarAcao, listaEstudos, tarefas, memorias, dicas, dicaProjeto, acatarDica, registrar, atividades } from './ia.mjs';
import { entrar, quemE, sair, trocarSenha, marcarVisto, definirVersao, encerrarSessoes, configurarEmergencia, removerEmergencia, statusEmergencia, recuperar, cookieSessao, cookieApagar } from './auth.mjs';

const PORTA = Number(process.env.PORTA || 8790);
const ESTUDOS = path.join('conteudo', 'estudos');
const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png', '.md': 'text/markdown; charset=utf-8' };
const ocupado = new Set(); // um pedido por vez em cada conversa
const vozPremium = () => Boolean(process.env.ELEVENLABS_API_KEY && process.env.ELEVENLABS_VOZ);
// Rosto da VZ: a primeira imagem public/vz/avatar.(webp|png|jpg) que existir
// Aparências: Nova (versão normal) e Sabrina (versão personalizada, a principal do Gabriel). Arquivos em public/vz/avatar-nova.* e avatar-sabrina.*
const achar = (base) => ['webp', 'png', 'jpg'].map((ext) => `vz/${base}.${ext}`).find((f) => fs.existsSync(path.join('public', f))) || null;
const avatares = () => ({ normal: achar('avatar-nova') || achar('avatar'), personalizada: achar('avatar-sabrina') });

const json = (res, dados, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(dados)); };
const corpo = (req) => new Promise((ok, falha) => {
  let b = '';
  req.on('data', (c) => { b += c; if (b.length > 1e6) req.destroy(); });
  req.on('end', () => { try { ok(b ? JSON.parse(b) : {}); } catch (e) { falha(e); } });
});
const canalValido = (c) => ['geral', 'estudos'].includes(c);
const slugValido = (s) => /^[a-z0-9-]+$/.test(s || '');


// ---- segurança: senha de emergência ----
const SEG = path.join('dados', 'seguranca.jsonl'); // registro privado, fora do git; nunca aparece no histórico da equipe
function registrarSeguranca(usuario, tipo, req, extra = {}) {
  fs.mkdirSync('dados', { recursive: true });
  fs.appendFileSync(SEG, JSON.stringify({ data: new Date().toISOString(), usuario, tipo, ip: req.socket.remoteAddress, ...extra }) + '\n');
}
const enderecoPrivado = (ip) => /^(0\.|10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(ip) || ip === '::1' || /^(fc|fd|fe80|::ffff:)/i.test(ip);
// Aviso para a pessoa de confiança (ex.: tópico do ntfy.sh). Só endereços públicos, sem seguir redirecionamentos.
async function enviarAviso(url, texto) {
  const enderecos = await dns.lookup(new URL(url).hostname, { all: true });
  if (!enderecos.length || enderecos.some((e) => enderecoPrivado(e.address))) throw new Error('o endereço de aviso não é público');
  const r = await fetch(url, { method: 'POST', body: texto, headers: { 'Content-Type': 'text/plain; charset=utf-8', Title: 'Alerta VZ' }, signal: AbortSignal.timeout(6000), redirect: 'error' });
  if (!r.ok) throw new Error(`aviso recusado (${r.status})`);
}
async function alertaEmergencia(r, req) {
  const { avisoUrl, acoes } = r.coacao;
  if (acoes.encerrarSessoes) encerrarSessoes(r.usuario, r.token);
  registrarSeguranca(r.usuario, 'emergencia', req);
  if (acoes.avisar && avisoUrl) {
    const quando = new Date().toLocaleString('pt-BR');
    await enviarAviso(avisoUrl, `Alerta de emergência na Central da VZ: acesso com a senha de emergência (${r.usuario}) em ${quando}.`)
      .catch((e) => registrarSeguranca(r.usuario, 'aviso_falhou', req, { motivo: String(e.message).slice(0, 120) }));
  }
}
// Quem entrou com a senha de emergência vê um painel vazio que parece normal: sem dados, conversas, notas nem ações.
function respostaDeCoacao(req, res, rota, eu) {
  if (rota === '/api/sair') { sair(eu.token); res.setHeader('Set-Cookie', cookieApagar); return json(res, { ok: true }); }
  if (req.method === 'GET') {
    if (rota === '/api/eu') return json(res, { usuario: eu.usuario, nome: eu.nome, papel: eu.papel, trocarSenha: false, vistos: eu.vistos, versao: eu.versao });
    if (rota === '/api/dicas') return json(res, {});
    if (rota.startsWith('/api/estudos/')) return json(res, { erro: 'não encontrado' }, 404);
    if (['/api/tarefas', '/api/projetos', '/api/memoria', '/api/historico', '/api/estudos', '/api/conversa'].includes(rota)) return json(res, []);
    return json(res, { erro: 'Indisponível no momento.' }, 503);
  }
  if (rota === '/api/versao' || rota === '/api/visto') return json(res, { ok: true });
  return json(res, { erro: 'Indisponível no momento. Tente de novo mais tarde.' }, 503); // inclui trocar senha, conversar e qualquer ação
}

async function api(req, res, url) {
  const rota = url.pathname;
  if (req.method === 'GET' && rota === '/api/estado') return json(res, { temChave: Boolean(process.env.ANTHROPIC_API_KEY), nomeIA: process.env.NOME_IA || 'VZ', vozPremium: vozPremium(), avatares: avatares() });

  // ---- acessos ----
  if (req.method === 'POST' && rota === '/api/login') {
    const { usuario, senha } = await corpo(req);
    if (typeof usuario !== 'string' || typeof senha !== 'string') return json(res, { erro: 'Preencha usuário e senha.' }, 400);
    const r = entrar(usuario.trim().toLowerCase(), senha);
    if (r.erro) { registrar({ usuario: usuario.trim().toLowerCase() }, "login_falhou", "Tentativa de login recusada"); return json(res, { erro: r.erro }, 401); }
    registrar({ usuario: r.usuario }, 'login', 'Entrou na central'); // na emergência também aparece como um login comum
    res.setHeader('Set-Cookie', cookieSessao(r.token));
    if (r.coacao) alertaEmergencia(r, req).catch(() => {});
    return json(res, { ok: true });
  }
  const eu = quemE(req);
  if (!eu) return json(res, { erro: 'Faça login.' }, 401);
  if (eu.modo === 'coacao') return respostaDeCoacao(req, res, rota, eu);
  // Depois de um alerta, a conta só destrava com o código de recuperação
  if (eu.modo === 'recuperacao' && !['/api/eu', '/api/sair', '/api/recuperar'].includes(rota)) return json(res, { erro: 'Confirme o código de recuperação para continuar.', recuperacao: true }, 403);
  if (req.method === 'GET' && rota === '/api/eu') return json(res, { usuario: eu.usuario, nome: eu.nome, papel: eu.papel, trocarSenha: eu.trocarSenha, vistos: eu.vistos, versao: eu.versao, modo: eu.modo === 'recuperacao' ? 'recuperacao' : undefined });
  if (req.method === 'POST' && rota === '/api/versao') {
    const { versao } = await corpo(req);
    if (!definirVersao(eu.usuario, versao)) return json(res, { erro: 'versão inválida' }, 400);
    registrar(eu, 'versao_vz', `Escolheu a VZ ${versao}`);
    return json(res, { ok: true });
  }
  if (req.method === 'POST' && rota === '/api/visto') {
    const { chave } = await corpo(req);
    if (!/^[a-z0-9-]{1,40}$/.test(chave || '')) return json(res, { erro: 'chave inválida' }, 400);
    marcarVisto(eu.usuario, chave);
    return json(res, { ok: true });
  }
  if (req.method === 'POST' && rota === '/api/sair') { registrar(eu, 'logout', 'Saiu da central'); sair(eu.token); res.setHeader('Set-Cookie', cookieApagar); return json(res, { ok: true }); }
  if (req.method === 'POST' && rota === '/api/senha') {
    const { atual, nova } = await corpo(req);
    const r = trocarSenha(eu.usuario, atual, nova);
    if (!r.erro) registrar(eu, 'senha_trocada', 'Trocou a própria senha');
    return r.erro ? json(res, r, 400) : json(res, r);
  }
  if (req.method === 'POST' && rota === '/api/recuperar') {
    if (eu.modo !== 'recuperacao') return json(res, { erro: 'Não há alerta ativo.' }, 400);
    const { codigo } = await corpo(req);
    const r = recuperar(eu.usuario, codigo);
    registrarSeguranca(eu.usuario, r.ok ? 'recuperacao_ok' : 'recuperacao_falhou', req);
    return r.erro ? json(res, r, 400) : json(res, r);
  }
  if (eu.trocarSenha) return json(res, { erro: 'Troque a senha provisória antes de continuar.' }, 403);
  if (req.method === 'GET' && rota === '/api/emergencia') return json(res, statusEmergencia(eu.usuario));
  if (req.method === 'POST' && rota === '/api/emergencia') {
    const { atual, emergencia, avisoUrl, encerrarSessoes: enc } = await corpo(req);
    const r = configurarEmergencia(eu.usuario, atual, emergencia, { avisoUrl, encerrarSessoes: enc !== false });
    registrarSeguranca(eu.usuario, r.ok ? 'emergencia_configurada' : 'emergencia_recusada', req); // só no registro privado, não no histórico da equipe
    return r.erro ? json(res, r, 400) : json(res, r);
  }
  if (req.method === 'POST' && rota === '/api/emergencia/remover') {
    const { atual } = await corpo(req);
    const r = removerEmergencia(eu.usuario, atual);
    registrarSeguranca(eu.usuario, r.ok ? 'emergencia_removida' : 'emergencia_recusada', req);
    return r.erro ? json(res, r, 400) : json(res, r);
  }

  if (req.method === 'GET' && rota === '/api/projetos') return json(res, todosProjetos());
  if (req.method === 'POST' && rota === '/api/projetos/situacao') {
    const { nome, situacao } = await corpo(req);
    try { await executarAcao('definir_situacao_projeto', { nome, situacao }, eu); return json(res, { ok: true }); } catch (erro) { return json(res, { erro: erro.message }, 400); }
  }
  // Qualquer ação do sistema pela tela: a mesma lista que a IA usa (ia.mjs → ACOES)
  if (req.method === 'POST' && rota === '/api/acao') {
    const { nome, entrada } = await corpo(req);
    if (typeof nome !== 'string') return json(res, { erro: 'pedido inválido' }, 400);
    try { return json(res, { mensagem: await executarAcao(nome, entrada || {}, eu) }); } catch (erro) { return json(res, { erro: erro.message }, 400); }
  }
  if (req.method === 'GET' && rota === '/api/tarefas') return json(res, tarefas());
  if (req.method === 'GET' && rota === '/api/dicas') return json(res, dicas());
  // Voz premium: o texto vai para a ElevenLabs e o áudio (mp3) volta para o navegador tocar.
  // A chave fica só no servidor; sem ela, o navegador usa a própria voz.
  if (req.method === 'POST' && rota === '/api/voz') {
    if (!vozPremium()) return json(res, { erro: 'Voz premium não configurada.' }, 501);
    const { texto } = await corpo(req);
    if (typeof texto !== 'string' || !texto.trim() || texto.length > 1500) return json(res, { erro: 'texto inválido' }, 400);
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(process.env.ELEVENLABS_VOZ)}?output_format=mp3_44100_128`, {
      method: 'POST',
      headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
      body: JSON.stringify({
        text: texto,
        model_id: process.env.ELEVENLABS_MODELO || 'eleven_flash_v2_5', // flash: resposta rápida, boa para conversa
        language_code: 'pt',
        // estabilidade mais baixa e um pouco de "style" = fala mais expressiva, com personalidade
        voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0.35, speed: Number(process.env.ELEVENLABS_VELOCIDADE || 1) },
      }),
    });
    if (!r.ok) { console.error('ElevenLabs', r.status, (await r.text()).slice(0, 300)); return json(res, { erro: `A voz premium falhou (${r.status}).` }, 502); }
    res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store' });
    return res.end(Buffer.from(await r.arrayBuffer()));
  }
  if (req.method === 'GET' && rota === '/api/historico') return json(res, atividades({ busca: url.searchParams.get('busca') || '', limite: 300, visivelPara: eu.usuario }));
  if (req.method === 'POST' && rota === '/api/dicas') {
    const { nome, trocar } = await corpo(req);
    if (typeof nome !== 'string') return json(res, { erro: 'pedido inválido' }, 400);
    if (!process.env.ANTHROPIC_API_KEY) return json(res, { erro: 'Falta a chave do Claude no .env.' }, 503);
    try { return json(res, await dicaProjeto(nome, Boolean(trocar), eu)); }
    catch (erro) { console.error(erro); return json(res, { erro: erro instanceof Anthropic.APIError ? `Erro da API do Claude (${erro.status}).` : erro.message }, 500); }
  }
  if (req.method === 'POST' && rota === '/api/dicas/acatar') {
    const { nome } = await corpo(req);
    try { return json(res, { mensagem: acatarDica(nome, eu) }); } catch (erro) { return json(res, { erro: erro.message }, 400); }
  }
  if (req.method === 'GET' && rota === '/api/memoria') return json(res, memorias());
  if (req.method === 'GET' && rota === '/api/estudos') return json(res, listaEstudos());
  if (req.method === 'GET' && rota === '/api/radar') {
    const datas = listarRadar();
    const data = url.searchParams.get('data') || datas[0];
    return json(res, { datas, radar: data ? lerRadar(data) : null, gerando: radarRodando(), perfis: perfis() });
  }
  if (req.method === 'POST' && rota === '/api/radar/gerar') {
    if (eu.papel !== 'dono') return json(res, { erro: 'Só o dono atualiza o radar.' }, 403);
    if (!process.env.ANTHROPIC_API_KEY) return json(res, { erro: 'Falta a chave do Claude.' }, 400);
    gerarRadar().then(() => registrar(eu, 'radar', 'Atualizou o radar de novidades')).catch((e) => console.error('Radar falhou:', e.message));
    return json(res, { ok: true, gerando: true }, 202);
  }
  if (req.method === 'GET' && rota.startsWith('/api/estudos/')) {
    const slug = rota.split('/').pop();
    const arq = path.join(ESTUDOS, `${slug}.md`);
    if (!slugValido(slug) || !fs.existsSync(arq)) return json(res, { erro: 'não encontrado' }, 404);
    res.writeHead(200, { 'Content-Type': TIPOS['.md'] });
    return res.end(fs.readFileSync(arq));
  }
  if (req.method === 'GET' && rota === '/api/conversa') {
    const canal = url.searchParams.get('canal');
    if (!canalValido(canal)) return json(res, { erro: 'canal inválido' }, 400);
    // Só o texto, para mostrar na tela (o histórico completo fica no servidor)
    const msgs = historico(eu.usuario, canal).flatMap((m) => {
      const t = typeof m.content === 'string' ? m.content : m.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
      return t ? [{ papel: m.role, texto: t }] : [];
    });
    return json(res, msgs);
  }
  if (req.method === 'POST' && rota === '/api/conversa/nova') {
    const { canal } = await corpo(req);
    if (!canalValido(canal)) return json(res, { erro: 'canal inválido' }, 400);
    novaConversa(eu.usuario, canal);
    return json(res, { ok: true });
  }
  if (req.method === 'POST' && rota === '/api/conversa') {
    const { canal, mensagem, estudo } = await corpo(req);
    if (!canalValido(canal) || typeof mensagem !== 'string' || !mensagem.trim()) return json(res, { erro: 'pedido inválido' }, 400);
    if (estudo && !slugValido(estudo)) return json(res, { erro: 'estudo inválido' }, 400);
    if (!process.env.ANTHROPIC_API_KEY) return json(res, { erro: 'Falta a chave do Claude: crie o arquivo .env com ANTHROPIC_API_KEY=... e reinicie.' }, 503);
    const chave = `${eu.usuario}-${canal}`;
    if (ocupado.has(chave)) return json(res, { erro: 'Ainda estou respondendo a mensagem anterior.' }, 409);

    // Resposta em pedaços (Server-Sent Events): o navegador fala cada frase assim que ela chega
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    const avisar = (ev) => res.write(`data: ${JSON.stringify(ev)}\n\n`);
    const material = estudo ? fs.readFileSync(path.join(ESTUDOS, `${estudo}.md`), 'utf8') : null;
    ocupado.add(chave);
    // Se a pessoa interrompe (o navegador fecha a conexão), a IA não começa outra rodada
    let cancelado = false;
    res.on('close', () => { cancelado = true; });
    res.on('error', () => {});
    try {
      await conversar({ pessoa: eu, canal, mensagem: mensagem.trim(), estudo: material, avisar, cancelado: () => cancelado });
    } catch (erro) {
      const msg = erro instanceof Anthropic.AuthenticationError ? 'A chave do Claude não foi aceita. Confira o .env.'
        : erro instanceof Anthropic.RateLimitError ? 'Limite de uso atingido. Tente de novo em instantes.'
        : erro instanceof Anthropic.APIError ? `Erro da API do Claude (${erro.status}).`
        : 'Erro inesperado no servidor.';
      console.error(erro);
      avisar({ tipo: 'erro', mensagem: msg });
    } finally {
      ocupado.delete(chave);
      avisar({ tipo: 'fim' });
      res.end();
    }
    return;
  }
  json(res, { erro: 'rota não encontrada' }, 404);
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    // Arquivos estáticos, sem deixar sair da pasta public/
    const alvo = path.resolve('public', '.' + (url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)));
    if (!alvo.startsWith(path.resolve('public') + path.sep) || !fs.existsSync(alvo) || fs.statSync(alvo).isDirectory()) {
      res.writeHead(404); return res.end('Não encontrado');
    }
    // no-cache: o navegador confere se há versão nova a cada abertura (atualizações aparecem na hora)
    res.writeHead(200, { 'Content-Type': TIPOS[path.extname(alvo)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(alvo).pipe(res);
  } catch (erro) {
    console.error(erro);
    if (!res.headersSent) json(res, { erro: 'pedido inválido' }, 400);
  }
}).listen(PORTA, '127.0.0.1', () => {
  console.log(`Central da VZ em http://localhost:${PORTA}`);
  if (process.env.RADAR !== 'desligado') agendarRadar();
  if (!process.env.ANTHROPIC_API_KEY) console.log('Sem ANTHROPIC_API_KEY: o painel abre, mas a IA só responde depois de criar o .env.');
});
