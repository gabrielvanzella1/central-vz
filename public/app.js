// Painel da Central da VZ: navegação, home, tour, conversa por voz e áreas.
import { ehEco } from './eco.js';
const tela = document.getElementById('tela');
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const api = async (rota) => {
  const r = await fetch(rota);
  if (r.status === 401) { telaLogin(); throw new Error('sem login'); }
  if (r.status === 403) {
    const d = await r.clone().json().catch(() => ({}));
    if (d.recuperacao) { telaRecuperar(); throw new Error('recuperacao'); }
  }
  return r.json();
};
const postar = async (rota, dados) => {
  const r = await fetch(rota, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(dados || {}) });
  return { ok: r.ok, status: r.status, dados: await r.json().catch(() => ({})) };
};
const guardar = (k, v) => { try { localStorage.setItem(k, v); } catch { /* sem armazenamento */ } };
const lerGuardado = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
let estado = { nomeIA: 'VZ', temChave: false };
let chatAtivo = null; // para parar voz e microfone ao trocar de tela

// ---------------- acessos ----------------
let eu = null; // { usuario, nome, papel, trocarSenha }
const chipUsuario = document.getElementById('usuario');
const mostrarUsuario = () => { chipUsuario.hidden = !eu; chipUsuario.textContent = eu ? `${eu.nome} ▾` : ''; };
chipUsuario.addEventListener('click', () => {
  document.querySelector('.menu-conta')?.remove();
  const m = document.createElement('div');
  m.className = 'menu-conta';
  m.innerHTML = '<button type="button" data-a="senha">Trocar senha</button><button type="button" data-a="emergencia">Senha de emergência</button><button type="button" data-a="tour">Rever o tour</button><button type="button" data-a="sair">Sair</button>';
  chipUsuario.after(m);
  m.addEventListener('click', async (e) => {
    const a = e.target.dataset.a; m.remove();
    if (a === 'senha') telaSenha(false);
    if (a === 'emergencia') telaEmergencia();
    if (a === 'tour') { location.hash = '#/'; setTimeout(iniciarTour, 100); }
    if (a === 'sair') { await postar('/api/sair'); eu = null; mostrarUsuario(); telaLogin(); }
  });
  setTimeout(() => addEventListener('click', () => m.remove(), { once: true }), 0);
});

// Ensino de uso: só no primeiro acesso de cada pessoa (guardado na conta, vale em qualquer máquina)
const jaViu = (chave) => (eu?.vistos || []).includes(chave);
function marcarVisto(chave) {
  if (jaViu(chave)) return;
  eu.vistos = [...(eu.vistos || []), chave];
  postar('/api/visto', { chave });
}
// Mostra a explicação na primeira visita à tela e já marca como vista (o texto é fixo, do próprio código)
function ajudaUmaVez(chave, html) {
  if (jaViu(chave)) return '';
  marcarVisto(chave);
  return `<p class="dica">${html}</p>`;
}

function telaLogin() {
  chatAtivo?.parar(); encerrarConversa();
  eu = null; mostrarUsuario();
  document.body.classList.add('sem-sessao');
  tela.innerHTML = `
    <form class="cartao-acesso">
      <img src="logo-vz-claro.webp" alt="VZ Soluções em Tecnologia" width="902" height="421" />
      <h1>Central da VZ</h1>
      <label>E-mail ou usuário<input name="usuario" type="text" inputmode="email" autocomplete="username" required autofocus /></label>
      <label>Senha<input name="senha" type="password" autocomplete="current-password" required /></label>
      <p class="erro-form" role="alert"></p>
      <button class="btn" type="submit">Entrar</button>
    </form>`;
  const f = tela.querySelector('form');
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const r = await postar('/api/login', { usuario: f.usuario.value, senha: f.senha.value });
    if (!r.ok) { f.querySelector('.erro-form').textContent = r.dados.erro || 'Não foi possível entrar.'; return; }
    await iniciarSessao();
  });
}

function telaSenha(obrigatoria) {
  if (chatAtivo !== chatGeral) chatAtivo?.parar();
  soltarConversa(false);
  tela.innerHTML = `
    <form class="cartao-acesso">
      <h1>${obrigatoria ? 'Crie a sua senha' : 'Trocar senha'}</h1>
      <p>${obrigatoria ? 'Este é o seu primeiro acesso: troque a senha provisória por uma só sua.' : 'Use pelo menos 8 caracteres.'}</p>
      <label>Senha atual${obrigatoria ? ' (a provisória)' : ''}<input name="atual" type="password" autocomplete="current-password" required /></label>
      <label>Senha nova<input name="nova" type="password" autocomplete="new-password" minlength="8" required /></label>
      <label>Repita a senha nova<input name="repete" type="password" autocomplete="new-password" minlength="8" required /></label>
      <p class="erro-form" role="alert"></p>
      <button class="btn" type="submit">Salvar senha</button>
      ${obrigatoria ? '' : '<a href="#/" class="cancelar">Cancelar</a>'}
    </form>`;
  const f = tela.querySelector('form');
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const erro = f.querySelector('.erro-form');
    if (f.nova.value !== f.repete.value) { erro.textContent = 'As duas senhas novas não são iguais.'; return; }
    const r = await postar('/api/senha', { atual: f.atual.value, nova: f.nova.value });
    if (!r.ok) { erro.textContent = r.dados.erro || 'Não foi possível trocar.'; return; }
    eu.trocarSenha = false;
    alert('Senha trocada.');
    location.hash = '#/'; rotear();
  });
}

// ---------------- senha de emergência ----------------
// Duas senhas no mesmo e-mail: a normal abre tudo; a de emergência (só sob ameaça) abre um painel vazio, tranca a conta e avisa alguém.
function mostrarCodigo(codigo, titulo, aoContinuar) {
  chatAtivo?.parar();
  tela.innerHTML = `
    <div class="cartao-acesso largo">
      <h1>${esc(titulo)}</h1>
      <p>Este é o seu <b>código de recuperação</b>. Ele aparece <b>só agora</b>. Escreva num papel e guarde fora do computador (carteira, cofre). Sem ele, depois de um alerta a central não destrava.</p>
      <div class="codigo-recuperacao" translate="no">${esc(codigo)}</div>
      <label class="linha"><input type="checkbox" class="guardei" /> Anotei o código em um lugar seguro, fora do computador</label>
      <button class="btn continuar" type="button" disabled>Continuar</button>
    </div>`;
  const ok = tela.querySelector('.guardei');
  const bt = tela.querySelector('.continuar');
  ok.addEventListener('change', () => { bt.disabled = !ok.checked; });
  bt.addEventListener('click', aoContinuar);
}

function telaRecuperar() {
  chatAtivo?.parar(); encerrarConversa();
  tela.innerHTML = `
    <form class="cartao-acesso">
      <h1>Confirme que está tudo bem</h1>
      <p>Um alerta de emergência foi ativado nesta conta. Digite o seu <b>código de recuperação</b> para voltar ao normal.</p>
      <label>Código de recuperação<input name="codigo" autocomplete="off" autocapitalize="characters" required /></label>
      <p class="erro-form" role="alert"></p>
      <button class="btn" type="submit">Destravar</button>
      <button class="btn btn-claro sair" type="button">Sair</button>
    </form>`;
  const f = tela.querySelector('form');
  f.querySelector('.sair').addEventListener('click', async () => { await postar('/api/sair'); eu = null; mostrarUsuario(); telaLogin(); });
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const r = await postar('/api/recuperar', { codigo: f.codigo.value });
    if (!r.ok) { f.querySelector('.erro-form').textContent = r.dados.erro || 'Não foi possível destravar.'; return; }
    mostrarCodigo(r.dados.codigoNovo, 'Novo código de recuperação', () => { iniciarSessao(); });
  });
}

async function telaEmergencia() {
  soltarConversa(false);
  const st = await api('/api/emergencia');
  const quando = st.desde ? new Date(st.desde).toLocaleDateString('pt-BR') : '';
  tela.innerHTML = `
    <form class="cartao-acesso largo">
      <h1>Senha de emergência</h1>
      <p>É uma <b>segunda senha</b> para o mesmo e-mail, para usar <b>só se alguém te obrigar a abrir a central</b>. Quem entra com ela vê um painel vazio, que parece normal. Em silêncio, a central tranca a sua conta, encerra as outras sessões e, se você configurar, avisa uma pessoa de confiança. Nada é apagado.</p>
      <p><b>Nunca use essa senha no dia a dia</b>, não deixe o navegador salvá-la e nunca a diga para a VZ no chat. Para destrancar depois, você vai precisar de um <b>código de recuperação</b>, que aparece uma única vez.</p>
      ${st.configurada ? `<p class="ok-dica">✓ Já configurada em ${esc(quando)}${st.aviso ? ` · avisa para ${esc(st.aviso)}` : ' · sem aviso externo'}. Preencha abaixo para trocar.</p>` : ''}
      <label>Sua senha normal (para confirmar)<input name="atual" type="password" autocomplete="current-password" required /></label>
      <label>Senha de emergência<input name="emerg" type="password" autocomplete="off" minlength="8" required /></label>
      <label>Repita a senha de emergência<input name="repete" type="password" autocomplete="off" minlength="8" required /></label>
      <label>Endereço para avisar alguém (opcional)<input name="url" type="url" autocomplete="off" placeholder="https://ntfy.sh/um-nome-longo-e-secreto" /></label>
      <small>Pode ser um tópico do ntfy.sh: a pessoa de confiança instala o app ntfy no celular e assina o tópico. Só enviamos “alerta de emergência”, sem nenhum dado.</small>
      <label class="linha"><input type="checkbox" name="encerrar" checked /> Encerrar as outras sessões desta conta no alerta</label>
      <p class="erro-form" role="alert"></p>
      <button class="btn" type="submit">${st.configurada ? 'Trocar senha de emergência' : 'Ativar senha de emergência'}</button>
      ${st.configurada ? '<button class="btn btn-claro remover" type="button">Remover</button>' : ''}
      <a href="#/" class="cancelar">Voltar</a>
    </form>`;
  const f = tela.querySelector('form');
  const erro = f.querySelector('.erro-form');
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (f.emerg.value !== f.repete.value) { erro.textContent = 'As duas senhas de emergência não são iguais.'; return; }
    const r = await postar('/api/emergencia', { atual: f.atual.value, emergencia: f.emerg.value, avisoUrl: f.url.value.trim(), encerrarSessoes: f.encerrar.checked });
    if (!r.ok) { erro.textContent = r.dados.erro || 'Não foi possível ativar.'; return; }
    mostrarCodigo(r.dados.codigo, 'Guarde o código de recuperação', () => { location.hash = '#/'; rotear(); });
  });
  f.querySelector('.remover')?.addEventListener('click', async () => {
    if (!f.atual.value) { erro.textContent = 'Digite a sua senha normal para remover.'; return; }
    const r = await postar('/api/emergencia/remover', { atual: f.atual.value });
    if (!r.ok) { erro.textContent = r.dados.erro || 'Não foi possível remover.'; return; }
    location.hash = '#/'; rotear();
  });
}

async function iniciarSessao() {
  const r = await fetch('/api/eu');
  if (!r.ok) { telaLogin(); return; }
  eu = await r.json();
  estado.nomeIA = nomeDaVersao();
  document.body.classList.remove('sem-sessao');
  mostrarUsuario();
  if (eu.modo === 'recuperacao') telaRecuperar(); else if (eu.trocarSenha) telaSenha(true); else rotear();
}

// ---------------- menu do celular ----------------
const menuBtn = document.querySelector('.menu-btn');
const menu = document.getElementById('menu');
const abrirMenu = (sim) => { menu.classList.toggle('aberto', sim); menuBtn.setAttribute('aria-expanded', sim); };
menuBtn.addEventListener('click', () => abrirMenu(!menu.classList.contains('aberto')));
menu.addEventListener('click', (e) => e.target.closest('a') && abrirMenu(false));

// ---------------- voz ----------------
const Reconhecimento = window.SpeechRecognition || window.webkitSpeechRecognition;
const ajustes = {
  get voz() { return lerGuardado('vz-voz') || ''; },
  get velocidade() { return Number(lerGuardado('vz-velocidade') || 1.05); },
  get interromper() { return lerGuardado('vz-interromper') !== 'nao'; },
};
const vozesPt = () => speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith('pt'));
// Sem escolha da pessoa, usa a voz feminina mais natural disponível: Thalita (leve e expressiva) ou Francisca, do Edge
const melhorVoz = () => {
  const vs = vozesPt().filter((v) => v.lang.toLowerCase() === 'pt-br').concat(vozesPt());
  const natural = (v) => /natural|online/i.test(v.name);
  return vs.find((v) => v.name === ajustes.voz)
    || vs.find((v) => /thalita/i.test(v.name) && natural(v))
    || vs.find((v) => /francisca/i.test(v.name) && natural(v))
    || vs.find((v) => natural(v) && !/antonio|daniel|ricardo|duarte/i.test(v.name))
    || vs.find((v) => /maria|google/i.test(v.name))
    || vs[0];
};

// Rosto da VZ: se existir a imagem (public/vz/avatar.*), ela substitui a bola azul.
// Com a voz premium, o brilho em volta do rosto acompanha o volume da fala.
// Normal = bola azul. Personalizada = o personagem do Gabriel (public/vz/avatar.*).
const avatarAtual = () => estado.avatares?.[eu?.versao || 'normal'] || null;
// Controle Nova | Sabrina em cima da foto (normal = Nova, personalizada = Sabrina). Também dá para pedir à VZ.
const trocaAvatarHTML = () => `<div class="troca-avatar" role="group" aria-label="Aparência da VZ">
  <button type="button" data-v="normal">Nova</button><button type="button" data-v="personalizada">Sabrina</button></div>`;
let aoMudarVersao = () => {};
// É a mesma IA: o nome que você usa escolhe a aparência. "VZ" = Nova (profissional); "Sabrina" = a personalizada.
// Só vale no começo da frase ("Sabrina, abre o quadro"), para não trocar quando o nome aparece no meio do assunto.
function versaoPeloNome(texto) {
  const t = texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[,.!?]/g, ' ').trim();
  const m = /^(?:(?:oi|ola|ei|opa|hey|e ai|bom dia|boa tarde|boa noite)\s+)?(sabrina|v ?z|ve ?ze|vi ?zi|be ?ze)(?:\s|$)/.exec(t);
  if (!m) return null;
  return m[1] === 'sabrina' ? 'personalizada' : 'normal';
}
async function trocarVersao(v) {
  if (!eu || !v || v === eu.versao) return;
  const r = await postar('/api/versao', { versao: v });
  if (r.ok) { eu.versao = v; atualizarAvatares(); }
}
// O nome muda com a versão: Nova = VZ (profissional), personalizada = Sabrina
const nomeDaVersao = () => (eu?.versao === 'personalizada' ? 'Sabrina' : estado.nomeBase);
function atualizarAvatares() {
  estado.nomeIA = nomeDaVersao();
  document.querySelectorAll('[data-nome-ia]').forEach((e) => { e.textContent = estado.nomeIA; });
  document.querySelectorAll('.orbe').forEach((o) => prepararOrbe(o));
  document.querySelectorAll('.troca-avatar button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.v === eu.versao));
  aoMudarVersao();
}
function ligarTrocaAvatar() {
  atualizarAvatares();
  document.querySelectorAll('.troca-avatar button').forEach((b) => b.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (b.dataset.v === eu.versao) return;
    const r = await postar('/api/versao', { versao: b.dataset.v });
    if (r.ok) { eu.versao = b.dataset.v; atualizarAvatares(); }
  }));
}
function prepararOrbe(orbe) {
  if (!orbe) return;
  const a = avatarAtual();
  orbe.classList.toggle('com-avatar', Boolean(a));
  if (a) orbe.style.setProperty('--avatar', `url("${a}")`);
}
let analisador = null;
function medirVolume(audio) {
  try {
    analisador ??= (() => { const ctx = new AudioContext(); const a = ctx.createAnalyser(); a.fftSize = 256; a.connect(ctx.destination); return { ctx, a }; })();
    analisador.ctx.createMediaElementSource(audio).connect(analisador.a);
    const dados = new Uint8Array(analisador.a.frequencyBinCount);
    const passo = () => {
      if (audio.paused || audio.ended) { document.documentElement.style.setProperty('--nivel', 0); return; }
      analisador.a.getByteFrequencyData(dados);
      const media = dados.reduce((s, v) => s + v, 0) / dados.length / 255;
      document.documentElement.style.setProperty('--nivel', Math.min(1, media * 2.5).toFixed(2));
      requestAnimationFrame(passo);
    };
    requestAnimationFrame(passo);
  } catch { /* sem medição, o brilho usa a animação padrão */ }
}

// Voz premium (ElevenLabs, pelo servidor): cada frase vira um áudio, tocado em ordem.
// "geracao" muda quando a fala é interrompida, para descartar o que ainda estava na fila.
let filaAudio = Promise.resolve();
let geracaoFala = 0;
let audioAtual = null;
function calar() {
  geracaoFala++;
  speechSynthesis.cancel();
  if (audioAtual) { audioAtual.pause(); audioAtual = null; }
}
// 'vz-voz' guarda "premium" ou o nome de uma voz do navegador; vazio = automático (premium se houver)
const usarPremium = () => estado.vozPremium && eu?.versao === 'personalizada' && ['', 'premium'].includes(ajustes.voz);
function tocarAudio(blob) {
  return new Promise((pronto) => {
    const url = URL.createObjectURL(blob);
    audioAtual = new Audio(url);
    audioAtual.playbackRate = 1;
    medirVolume(audioAtual);
    const fim = () => { URL.revokeObjectURL(url); audioAtual = null; pronto(); };
    audioAtual.onended = audioAtual.onerror = audioAtual.onpause = fim;
    audioAtual.play().catch(fim);
  });
}
function falarNoNavegador(texto) {
  return new Promise((pronto) => {
    const u = new SpeechSynthesisUtterance(texto);
    u.lang = 'pt-BR';
    u.rate = ajustes.velocidade;
    const v = melhorVoz();
    if (v) u.voice = v;
    u.onend = u.onerror = pronto;
    speechSynthesis.speak(u);
  });
}
const limparParaFala = (t) => t.replace(/[*_#`>|]/g, '').replace(/\s-\s/g, ', ').replace(/https?:\/\/\S+/g, 'o link');
const ROTULOS = {
  listar_projetos: 'consultou os projetos', definir_situacao_projeto: 'mudou a situação de um projeto', sugerir_proximo_passo: 'pensou no próximo passo', acatar_sugestao: 'acatou a sugestão',
  listar_tarefas: 'olhou as tarefas', passar_tarefa: 'passou uma tarefa', pegar_tarefa: 'pegou uma tarefa', concluir_tarefa: 'concluiu uma tarefa', aprovar_tarefa: 'aprovou uma tarefa', devolver_tarefa: 'devolveu uma tarefa', criar_tarefa: 'criou um cartão', editar_tarefa: 'atualizou um cartão', apagar_tarefa: 'apagou um cartão',
  salvar_memoria: 'guardou na memória', esquecer_memoria: 'esqueceu uma memória', consultar_historico: 'consultou o histórico',
  mudar_aparencia: 'mudou de aparência', registrar_pratica: 'anotou a sua prática', ver_pratica: 'olhou a sua prática', salvar_nota_pessoal: 'guardou uma nota pessoal (só você vê)', ver_notas_pessoais: 'olhou as suas notas pessoais', esquecer_nota_pessoal: 'esqueceu uma nota pessoal',
  listar_estudos: 'olhou os estudos', criar_estudo: 'criou um material de estudo', criar_lembrete: 'criou um lembrete', ver_lembretes: 'olhou os lembretes', concluir_lembrete: 'resolveu um lembrete', ver_avisos: 'olhou os avisos', sugerir_melhoria_central: 'anotou uma melhoria para a central', abrir_tela: 'abriu uma tela', ver_radar: 'olhou o radar de novidades',
};

// ---- Chamar pelo nome: diga "VZ" e ela atende ----
// Um reconhecedor contínuo procura o nome no que você fala. Para nunca brigar pelo microfone,
// ele pausa enquanto a conversa por voz está ativa e volta quando ela termina.
const escutaNomeLigada = () => lerGuardado('vz-atender-nome') === 'sim';
const semAcento = (t) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
// O reconhecimento escreve "VZ" de vários jeitos: "vz", "vê zê", "vezê", "v z", "bê zê"…
const NOME_FALADO = /\b(v ?z|ve ?ze|vi ?zi|be ?ze|sabrina)\b[,.!?]?\s*/;
let escutaNome = null, escutaPausada = true;
function bip() {
  try {
    const ctx = new AudioContext(); const o = ctx.createOscillator(); const g = ctx.createGain();
    o.frequency.value = 880; g.gain.setValueAtTime(0.15, ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
    o.connect(g).connect(ctx.destination); o.start(); o.stop(ctx.currentTime + 0.25);
  } catch { /* sem áudio */ }
}
function retomarEscutaNome() {
  if (!Reconhecimento || !escutaNomeLigada() || !eu || chatGeral?.emVoz()) return;
  escutaPausada = false;
  if (!escutaNome) {
    escutaNome = new Reconhecimento();
    escutaNome.lang = 'pt-BR'; escutaNome.continuous = true; escutaNome.interimResults = false;
    escutaNome.onresult = (e) => {
      const frase = e.results[e.results.length - 1][0].transcript;
      const m = NOME_FALADO.exec(semAcento(frase));
      if (!m) return;
      // O que veio depois do nome é o pedido ("VZ, o que é prioridade hoje?")
      const pedido = frase.slice(m.index + m[0].length).trim();
      bip();
      trocarVersao(versaoPeloNome(frase));
      pararEscutaNome();
      if (chatGeral) { abrirDoca(); chatGeral.comecar(pedido); return; } // atende onde você estiver
      guardar('vz-chamado', pedido); guardar('vz-chamado-em', String(Date.now()));
      location.hash = '#/conversa';
    };
    escutaNome.onerror = (e) => { if (e.error === 'not-allowed') { guardar('vz-atender-nome', 'nao'); escutaPausada = true; } };
    escutaNome.onend = () => { if (!escutaPausada) setTimeout(() => { try { escutaNome.start(); } catch { /* já ativa */ } }, 300); };
  }
  try { escutaNome.start(); } catch { /* já ativa */ }
}
function pararEscutaNome() {
  escutaPausada = true;
  try { escutaNome?.abort(); } catch { /* parada */ }
}

// Um chat (texto + voz) ligado a um canal da IA. Usado na conversa e nos estudos.
function criarChat({ raiz, canal, estudo = null, orbe = null, rotuloEstado = null }) {
  const lista = raiz.querySelector('.mensagens');
  const campo = raiz.querySelector('textarea');
  const botaoMic = raiz.querySelector('.mic');
  const botaoParar = raiz.querySelector('.parar');
  let ocupado = false, pendente = null, falando = 0, cortarFala = false, modoVoz = false, ouvindoAgora = false;
  let bufferFala = '', reconhecedor = null;
  let ctrl = null, faladoRecente = '', fimFala = 0; // faladoRecente e fimFala alimentam o filtro de eco

  const mudarEstado = (e, texto) => {
    if (orbe) orbe.className = `orbe ${avatarAtual() ? 'com-avatar' : ''} ${e}`;
    if (botaoParar) botaoParar.hidden = !(e === 'falando' || e === 'pensando');
    if (botaoMic) botaoMic.classList.toggle('ativo', modoVoz);
    if (rotuloEstado) rotuloEstado.textContent = texto;
  };
  const rolar = () => { lista.scrollTop = lista.scrollHeight; };
  const bolha = (papel, texto = '') => {
    lista.querySelector('.vazio')?.remove();
    const d = document.createElement('div');
    d.className = `msg ${papel}`;
    d.textContent = texto;
    lista.append(d); rolar();
    return d;
  };

  // ---- falar ----
  function falar(frase) {
    const t = limparParaFala(frase).trim();
    if (!t || cortarFala) return;
    const g = geracaoFala;
    falando++;
    faladoRecente = `${faladoRecente} ${t}`.slice(-800);
    // O áudio premium começa a ser gerado já; a fila só garante que as frases toquem em ordem
    const audio = usarPremium()
      ? fetch('/api/voz', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ texto: t }) })
        .then((r) => (r.ok ? r.blob() : null)).catch(() => null)
      : null;
    filaAudio = filaAudio.then(async () => {
      if (g !== geracaoFala) return; // foi interrompida
      const blob = audio && await audio;
      if (g !== geracaoFala) return;
      if (blob) await tocarAudio(blob); else await falarNoNavegador(t); // sem premium (ou se falhar): voz do navegador
    }).finally(() => { falando = Math.max(0, falando - 1); fimFala = Date.now(); quandoTerminarDeFalar(); });
    mudarEstado('falando', 'Falando… (fale para interromper)');
    if (modoVoz && ajustes.interromper) ouvir(); // ouvindo junto, para poder interromper
  }
  // Fala cada frase assim que ela termina, sem esperar a resposta inteira
  function alimentarFala(pedaco, final = false) {
    bufferFala += pedaco;
    const partes = bufferFala.split(/(?<=[.!?…:])\s+|\n+/);
    bufferFala = final ? '' : partes.pop();
    partes.forEach(falar);
    if (final && partes.length === 0 && bufferFala) falar(bufferFala);
  }
  function quandoTerminarDeFalar() {
    if (falando > 0 || ocupado) return;
    if (modoVoz) { mudarEstado('ouvindo', 'Ouvindo…'); ouvir(); }
    else mudarEstado('', estado.temChave ? 'Toque para conversar' : 'Falta a chave do Claude');
  }

  // ---- ouvir ----
  function ouvir() {
    if (!Reconhecimento || ouvindoAgora) return;
    reconhecedor ??= criarReconhecedor();
    try { reconhecedor.start(); ouvindoAgora = true; } catch { /* já estava ouvindo */ }
  }
  function criarReconhecedor() {
    const r = new Reconhecimento();
    r.lang = 'pt-BR'; r.interimResults = true; r.continuous = false;
    let finalTexto = '';
    r.onresult = (e) => {
      let parcial = '';
      for (const res of e.results) { if (res.isFinal) finalTexto = res[0].transcript; else parcial += res[0].transcript; }
      const ouvido = (parcial || finalTexto).trim();
      // Você falou enquanto a VZ falava: ela para e passa a te escutar (sem confundir com o eco da própria voz)
      if (falando > 0 && ajustes.interromper && ouvido.length > 3 && !ehEco(ouvido, faladoRecente)) interromper();
      if (parcial && !ocupado) mudarEstado('ouvindo', `“${parcial}”`);
    };
    r.onerror = (e) => { if (e.error === 'not-allowed') { modoVoz = false; mudarEstado('', 'Libere o microfone no navegador'); } };
    r.onend = () => {
      ouvindoAgora = false;
      const t = finalTexto.trim(); finalTexto = '';
      // O que o microfone pegou foi só a própria VZ falando (caixa de som): não é uma mensagem sua
      const eco = t && ehEco(t, faladoRecente) && (falando > 0 || Date.now() - fimFala < 2500);
      if (t && !eco) { if (ocupado) pendente = t; else enviar(t); return; }
      if (modoVoz) setTimeout(ouvir, 250); // continua ouvindo, inclusive enquanto ela fala, para poder ser interrompida
    };
    return r;
  }
  function alternarVoz() {
    if (!Reconhecimento) { alert('Este navegador não reconhece voz. Use o Chrome ou o Edge.'); return; }
    modoVoz = !modoVoz;
    if (modoVoz) { pararEscutaNome(); cortarFala = false; mudarEstado('ouvindo', 'Ouvindo…'); ouvir(); }
    else { reconhecedor?.abort(); calar(); falando = 0; mudarEstado('', 'Toque para conversar'); retomarEscutaNome(); }
  }
  // Interromper: ela para de falar, para de receber o resto da resposta e passa a te escutar
  function interromper() {
    if (falando === 0 && !ocupado) return;
    cortarFala = true; calar(); falando = 0; bufferFala = '';
    if (ocupado) ctrl?.abort();
    if (modoVoz) { mudarEstado('ouvindo', 'Ouvindo…'); ouvir(); }
    else mudarEstado('', estado.temChave ? 'Toque para conversar' : 'Falta a chave do Claude');
  }
  // Chamado quando alguém disse "VZ": entra no modo voz e, se já veio um pedido junto, manda direto
  function comecar(pedido) {
    if (!modoVoz) { pararEscutaNome(); modoVoz = true; cortarFala = false; }
    if (pedido) enviar(pedido); else { mudarEstado('ouvindo', 'Ouvindo…'); ouvir(); }
  }

  // ---- enviar e receber (Server-Sent Events) ----
  async function enviar(texto) {
    if (!texto.trim()) return;
    if (ocupado) { pendente = texto; return; }
    ocupado = true; cortarFala = false; bufferFala = ''; faladoRecente = '';
    await trocarVersao(versaoPeloNome(texto)); // "Sabrina, ..." ou "VZ, ...": a aparência acompanha o nome
    bolha('user', texto);
    mudarEstado('pensando', 'Pensando…');
    let resposta = null;
    let abrirDepois = null;
    ctrl = new AbortController();
    try {
      let r;
      for (let tentativa = 0; tentativa < 8; tentativa++) { // 409: o servidor ainda está terminando a resposta que foi interrompida
        r = await fetch('/api/conversa', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ canal, mensagem: texto, estudo }), signal: ctrl.signal });
        if (r.status !== 409) break;
        await new Promise((ok) => setTimeout(ok, 600));
      }
      if (!r.ok) throw new Error((await r.json()).erro || 'Erro no servidor');
      const leitor = r.body.pipeThrough(new TextDecoderStream()).getReader();
      let sobra = '';
      for (;;) {
        const { value, done } = await leitor.read();
        if (done) break;
        sobra += value;
        const eventos = sobra.split('\n\n'); sobra = eventos.pop();
        for (const ev of eventos) {
          if (!ev.startsWith('data: ')) continue;
          const d = JSON.parse(ev.slice(6));
          if (d.tipo === 'texto') {
            resposta ??= bolha('assistant');
            resposta.textContent += d.texto; rolar();
            if (modoVoz || falando || falarSempre()) alimentarFala(d.texto);
          } else if (d.tipo === 'ferramenta') {
            const chip = document.createElement('div');
            chip.className = 'ferramenta';
            chip.textContent = `${estado.nomeIA} ${ROTULOS[d.nome] || `usou ${d.nome}`}`;
            lista.append(chip); rolar();
            resposta = null; // o texto depois da ferramenta vai numa bolha nova
          } else if (d.tipo === 'erro') {
            bolha('erro', d.mensagem);
          } else if (d.tipo === 'versao') {
            eu.versao = d.versao; atualizarAvatares(); // você pediu para trocar de aparência
          } else if (d.tipo === 'abrir') {
            abrirDepois = d.tela; // abre quando a resposta terminar, para não cortar a fala
          }
        }
      }
    } catch (erro) {
      if (erro.name !== 'AbortError') bolha('erro', erro.message); // AbortError = você interrompeu
    } finally {
      ocupado = false;
      if (modoVoz || falarSempre()) alimentarFala('', true);
      if (abrirDepois && location.hash !== abrirDepois) location.hash = abrirDepois; // a conversa vai junto
      if (pendente) { const p = pendente; pendente = null; enviar(p); } else quandoTerminarDeFalar();
    }
  }
  const falarSempre = () => raiz.dataset.falar === 'sim';

  campo?.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); const t = campo.value; campo.value = ''; enviar(t); } });
  raiz.querySelector('.btn-enviar')?.addEventListener('click', () => { const t = campo.value; campo.value = ''; enviar(t); });
  botaoMic?.addEventListener('click', alternarVoz);
  orbe?.addEventListener('click', () => (falando > 0 || ocupado ? interromper() : alternarVoz())); // tocar no rosto enquanto ela fala = interromper
  botaoParar?.addEventListener('click', interromper);
  campo?.addEventListener('input', () => interromper()); // começar a digitar também interrompe

  // Histórico salvo
  api(`/api/conversa?canal=${canal}`).then((msgs) => {
    if (!msgs.length) return;
    lista.innerHTML = '';
    msgs.forEach((m) => bolha(m.papel, m.texto));
  });
  mudarEstado('', estado.temChave ? 'Toque para conversar' : 'Falta a chave do Claude');
  return { alternarVoz, comecar, interromper, emVoz: () => modoVoz, parar: () => { modoVoz = false; reconhecedor?.abort(); calar(); retomarEscutaNome(); } };
}

const htmlChat = (titulo, vazio) => `
  <div class="chat">
    <div class="chat-topo"><h2>${titulo}</h2><button type="button" class="btn btn-claro nova">Nova conversa</button></div>
    <div class="mensagens" aria-live="polite"><p class="vazio">${vazio}</p></div>
    <div class="enviar">
      <textarea rows="1" placeholder="Escreva ou toque no microfone…" aria-label="Mensagem"></textarea>
      <button type="button" class="mic" aria-label="Conversar por voz">🎙</button>
      <button type="button" class="btn btn-claro parar" hidden>Interromper</button>
      <button type="button" class="btn btn-enviar">Enviar</button>
    </div>
  </div>`;
function ligarNovaConversa(raiz, canal) {
  raiz.querySelector('.nova').addEventListener('click', async () => {
    await fetch('/api/conversa/nova', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ canal }) });
    raiz.querySelector('.mensagens').innerHTML = '<p class="vazio">Conversa nova. A memória continua.</p>';
  });
}

// ---------------- telas ----------------
const COLUNAS = ['ideias', 'a fazer', 'fazendo', 'aprovar', 'feito'];
const ETAPA = { ideias: ['💡', 'Ideia'], 'a fazer': ['📌', 'Para fazer'], fazendo: ['🔨', 'Fazendo'], aprovar: ['👀', 'Esperando aprovação'], feito: ['✅', 'Pronto'] };
const etapa = (c) => `${ETAPA[c]?.[0] || ''} ${ETAPA[c]?.[1] || c}`;
const saudacao = () => { const h = new Date().getHours(); return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite'; };

async function home() {
  const [todos, tarefas, memoria, estudos] = await Promise.all([api('/api/projetos'), api('/api/tarefas'), api('/api/memoria'), api('/api/estudos')]);
  const projetos = todos.filter((p) => p.situacao === 'central');
  const aEscolher = todos.filter((p) => p.situacao === 'a escolher').length;
  const semGit = projetos.filter((p) => !p.git).length;
  const pendentes = projetos.filter((p) => p.alterados || p.naoEnviados).length;
  const maquinas = [...new Set(projetos.map((p) => p.maquina))];
  const porColuna = Object.fromEntries(COLUNAS.map((c) => [c, tarefas.filter((t) => t.coluna === c).length]));
  const feito = tarefas.length ? Math.round((porColuna.feito / tarefas.length) * 100) : 0;
  tela.innerHTML = `
    <section class="saudacao">
      <div><h1>${saudacao()}, ${esc(eu.nome)}.</h1><p>Tudo da VZ num lugar só. Escolha por onde começar.</p></div>
      <div class="pilulas">
        <span class="pilula ${estado.temChave ? 'ok' : 'alerta'}"><b>${estado.temChave ? 'on' : '!'}</b>${estado.temChave ? `${esc(estado.nomeIA)} conectada` : 'Falta a chave do Claude'}</span>
        <span class="pilula ${pendentes ? 'alerta' : 'ok'}"><b>${pendentes}</b>com coisa não enviada</span>
        <span class="pilula ${semGit ? 'alerta' : 'ok'}"><b>${semGit}</b>sem git</span>
      </div>
    </section>
    <section class="hoje" aria-label="Hoje"></section>
    <a class="dica-comando" href="#/estudos/comandos-do-claude">${dicaComandoHTML()}</a>
    <section class="areas">
      <a class="area a-radar" href="#/radar"><span class="radar-ico" aria-hidden="true">📡</span><div><h2>Radar de novidades</h2><p class="radar-resumo">O que saiu de novo em IA, todo dia às 7h.</p></div><span class="tag radar-tag">abrir</span></a>
      <div class="area a-conversa" data-tour="conversa">
        <h2>Conversar com <span data-nome-ia>${esc(estado.nomeIA)}</span></h2>
        <p>Fale de verdade: ela responde em voz, cria tarefas, consulta projetos e guarda o que importa.</p>
        <div class="avatar-wrap"><button type="button" class="orbe" aria-label="Começar a conversar por voz"></button>${trocaAvatarHTML()}</div>
        <p class="estado-voz">Toque na imagem para falar</p>
      </div>
      <a class="area a-quadro" href="#/quadro" data-tour="quadro">
        <h2>Todas as tarefas</h2><p>Cada tarefa com quem está e em que pé, das ideias ao pronto.</p>
        <div class="mini-quadro">${COLUNAS.map((c) => `<div><b>${porColuna[c]}</b><small>${c}</small></div>`).join('')}</div>
        <div class="barra" title="${feito}% feito"><span style="width:${feito}%"></span></div>
      </a>
      <a class="area a-projetos" href="#/projetos" data-tour="projetos">
        <h2>Projetos</h2><p>${projetos.length ? `${projetos.length} na central, em ${maquinas.length} ${maquinas.length === 1 ? 'máquina' : 'máquinas'}.` : 'Escolha quais projetos entram na central.'}</p>
        <div class="rodape-area"><span class="tag">${semGit} sem git</span><span class="tag">${pendentes} pendentes</span>${aEscolher ? `<span class="tag">${aEscolher} a escolher</span>` : ''}</div>
      </a>
      <a class="area a-estudos" href="#/estudos" data-tour="estudos">
        <h2>Estudos</h2><p>Materiais da equipe, com um professor de IA para tirar dúvidas.</p>
        <div class="rodape-area"><span class="tag">${estudos.length} materiais</span></div>
      </a>
      <a class="area a-memoria" href="#/memoria" data-tour="memoria">
        <h2>Memória</h2><p>O que ${esc(estado.nomeIA)} já sabe sobre a VZ.</p>
        <div class="rodape-area"><span class="tag">${memoria.length} lembranças</span></div>
      </a>
      <div class="area a-whats em-breve"><h2>WhatsApp</h2><p>Avisos e aprovações no seu celular.</p></div>
      <div class="area a-deploy em-breve"><h2>Deploys</h2><p>Publicar os projetos, na hora ou agendado.</p></div>
      <a class="area a-equipe" href="#/historico" data-tour="historico">
        <h2>Histórico</h2><p>Tudo o que foi feito e conversado, por quem e quando. A IA aprende com isto.</p>
      </a>
    </section>`;
  ligarTrocaAvatar();
  desenharHoje(tela.querySelector('.hoje'), tarefas);
  api('/api/radar').then((d) => {
    const r = d.radar;
    if (!r) return;
    tela.querySelector('.radar-resumo').textContent = r.resumo || `${r.itens.length} novidades`;
    tela.querySelector('.radar-tag').textContent = `${r.itens.length} novidades · ${new Date(`${r.data}T12:00`).toLocaleDateString('pt-BR')}`;
  }).catch(() => {});
  tela.querySelector('.a-conversa .orbe').addEventListener('click', () => { soltarConversa(false); abrirDoca(); chatGeral?.alternarVoz(); });
  if (!jaViu('tour')) iniciarTour();
}

// A conversa geral é montada uma vez e acompanha você: na tela Conversa ocupa a página; nas outras fica na doca flutuante, sem parar a voz.
let noConversa = null, chatGeral = null, vozesGeral = null;
function doca() {
  let d = document.querySelector('.doca-vz');
  if (d) return d;
  d = document.createElement('aside');
  d.className = 'doca-vz min';
  d.setAttribute('aria-label', 'Conversa');
  d.innerHTML = '<button type="button" class="doca-abrir" aria-expanded="false" aria-label="Abrir ou fechar a conversa">▴</button>';
  d.querySelector('.doca-abrir').addEventListener('click', () => (d.classList.contains('min') ? abrirDoca() : fecharDoca()));
  document.body.append(d);
  return d;
}
function abrirDoca() { const d = document.querySelector('.doca-vz'); if (!d) return; d.classList.remove('min'); d.querySelector('.doca-abrir').setAttribute('aria-expanded', 'true'); d.querySelector('.doca-abrir').textContent = '▾'; }
function fecharDoca() { const d = document.querySelector('.doca-vz'); if (!d) return; d.classList.add('min'); d.querySelector('.doca-abrir').setAttribute('aria-expanded', 'false'); d.querySelector('.doca-abrir').textContent = '▴'; }
function soltarConversa(naTela) {
  if (!eu || eu.trocarSenha || eu.modo) return;
  const d = doca();
  if (!noConversa) montarConversa(d);
  if (naTela) { tela.innerHTML = ''; tela.append(noConversa); d.hidden = true; } else { d.append(noConversa); d.hidden = false; }
}
function encerrarConversa() {
  chatGeral?.parar(); document.querySelector('.doca-vz')?.remove();
  chatGeral = null; noConversa = null; vozesGeral = null;
}
function conversa() {
  soltarConversa(true);
  if (lerGuardado('vz-ouvir-ja') === 'sim') { guardar('vz-ouvir-ja', ''); if (!chatGeral.emVoz()) chatGeral.alternarVoz(); }
  const pedido = lerGuardado('vz-chamado');
  if (pedido !== null && pedido !== undefined && lerGuardado('vz-chamado-em') > Date.now() - 15000) { guardar('vz-chamado-em', ''); chatGeral.comecar(pedido); }
}
function montarConversa(destino) {
  const c = document.createElement('div');
  c.className = 'conversa';
  destino.append(c); // precisa estar na página para ligar a troca de aparência
  c.innerHTML = `
      <aside class="painel-voz">
        <div class="avatar-wrap"><button type="button" class="orbe" aria-label="Ligar ou desligar a conversa por voz"></button>${trocaAvatarHTML()}</div>
        <p class="estado-voz"></p>
        <div class="ajustes">
          <label>Voz<select class="sel-voz"></select></label>
          <label>Velocidade<input type="range" class="sel-vel" min="0.8" max="1.4" step="0.05" /></label>
          <label class="linha"><input type="checkbox" class="sel-int" /> Interromper quando eu falar (use fone)</label>
          <label class="linha"><input type="checkbox" class="sel-nome" /> Atender quando eu disser “Sabrina” ou “VZ”</label>
          <p class="aviso-nome">Com isso ligado, o microfone fica ouvindo enquanto a central estiver aberta, e o navegador envia o áudio ao Google ou à Microsoft para reconhecer.</p>
          <p class="dica-voz" hidden>Para uma voz bem mais natural, abra a central no Microsoft Edge (vozes “Natural”).</p>
        </div>
      </aside>
      ${htmlChat(`Conversa com <span data-nome-ia>${esc(estado.nomeIA)}</span>`, 'Toque na imagem e fale. Ex.: “anota uma ideia para o site da VZ” ou “me leva para o quadro”')}`;
  const raiz = c.querySelector('.chat');
  raiz.dataset.falar = 'nao';
  const selVoz = c.querySelector('.sel-voz');
  const dicaVoz = c.querySelector('.dica-voz');
  const preencherVozes = () => {
    const vs = vozesPt();
    const atual = usarPremium() ? 'premium' : (melhorVoz()?.name || '');
    selVoz.innerHTML = (estado.vozPremium && eu.versao === 'personalizada' ? `<option value="premium" ${atual === 'premium' ? 'selected' : ''}>Voz premium (ElevenLabs)</option>` : '')
      + (vs.length ? vs.map((v) => `<option value="${esc(v.name)}" ${v.name === atual ? 'selected' : ''}>${esc(v.name)}</option>`).join('') : '<option value="">Voz padrão</option>');
    dicaVoz.hidden = estado.vozPremium || vs.some((v) => /natural|online/i.test(v.name));
  };
  preencherVozes(); speechSynthesis.onvoiceschanged = preencherVozes;
  selVoz.addEventListener('change', () => { guardar('vz-voz', selVoz.value); calar(); });
  const vel = c.querySelector('.sel-vel'); vel.value = ajustes.velocidade; vel.addEventListener('input', () => guardar('vz-velocidade', vel.value));
  const selNome = c.querySelector('.sel-nome');
  selNome.checked = escutaNomeLigada();
  selNome.addEventListener('change', () => { guardar('vz-atender-nome', selNome.checked ? 'sim' : 'nao'); if (!selNome.checked) pararEscutaNome(); });
  const int = c.querySelector('.sel-int'); int.checked = ajustes.interromper; int.addEventListener('change', () => guardar('vz-interromper', int.checked ? 'sim' : 'nao'));
  vozesGeral = preencherVozes; // a lista de vozes depende da versão (voz premium só na Sabrina)
  c.querySelectorAll('.troca-avatar button').forEach((b) => b.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (b.dataset.v === eu.versao) return;
    const r = await postar('/api/versao', { versao: b.dataset.v });
    if (r.ok) { eu.versao = b.dataset.v; atualizarAvatares(); }
  }));
  atualizarAvatares();
  noConversa = c;
  chatGeral = criarChat({ raiz: c, canal: 'geral', orbe: c.querySelector('.painel-voz .orbe'), rotuloEstado: c.querySelector('.painel-voz .estado-voz') });
  ligarNovaConversa(raiz, 'geral');
}

async function quadro() {
  const tarefas = await api('/api/tarefas');
  tela.innerHTML = `
    <div class="titulo-acao"><h1>Todas as tarefas</h1><button type="button" class="btn nova-tarefa">+ Nova tarefa</button></div>
    ${ajudaUmaVez('ajuda-quadro', `Cada coluna é uma etapa. Toque numa tarefa para ver com quem está e tudo o que aconteceu com ela. Ou peça: “${esc(estado.nomeIA)}, passa a tarefa 5 pro Derik”.`)}
    <div class="quadro">${COLUNAS.map((c) => {
      const cs = tarefas.filter((t) => t.coluna === c);
      return `<section class="coluna"><h2>${etapa(c)}<span>${cs.length}</span></h2>${cs.map(cartaoTarefa).join('')}</section>`;
    }).join('')}</div>`;
  await carregarPessoas();
  tela.querySelectorAll('[data-tarefa]').forEach((b) => b.addEventListener('click', () => abrirTarefa(Number(b.dataset.tarefa), tarefas)));
  tela.querySelector('.nova-tarefa').addEventListener('click', () => novaTarefa());
}

// Dica de comando do dia: um comando por dia, para ir decorando (a cola completa fica nos Estudos)
const COMANDOS_DIA = [
  ['/novidades', 'o que saiu de novo em IA, em tabela', '/novidades vídeo'],
  ['/analisar-reel', 'assiste a um reel e diz o que é verdade', '/analisar-reel <link do reel>'],
  ['/grill-me', 'o Claude te sabatina até o plano ficar redondo', '/grill-me proposta da influenciadora'],
  ['/handoff', 'resume a conversa para continuar no outro PC', '/handoff amanhã: agente da noite'],
  ['/find-skills', 'procura uma skill pronta para a tarefa', '/find-skills edição de vídeo'],
  ['/design-taste-frontend', 'deixa o visual profissional, sem cara de IA', '/design-taste-frontend tela do ScanTE'],
  ['/redesign-existing-projects', 'repagina um sistema que já existe', '/redesign-existing-projects painel do ContabIA'],
  ['/code-review', 'revisa o código antes de subir', '/code-review'],
  ['/security-review', 'procura falhas de segurança', '/security-review'],
  ['/schedule', 'agenda um agente na nuvem', '/schedule todo dia às 2h…'],
  ['/loop', 'repete uma tarefa de tempos em tempos', '/loop 30m confere se o site está no ar'],
  ['/compact', 'resume a conversa para ela durar mais', '/compact'],
  ['/model', 'troca de modelo (Opus, Sonnet…)', '/model'],
  ['/graphify', 'mapa de como o projeto se liga', '/graphify'],
];
function dicaComandoHTML() {
  const dia = Math.floor((Date.now() - new Date().getTimezoneOffset() * 60_000) / 86_400_000);
  const [cmd, oque, ex] = COMANDOS_DIA[dia % COMANDOS_DIA.length];
  return `<span class="dc-ico" aria-hidden="true">⌨️</span><span><b>Comando do dia: <code>${esc(cmd)}</code></b> ${esc(oque)}. Ex.: <code>${esc(ex)}</code></span><span class="dc-mais">ver todos →</span>`;
}

// ---------------- tarefas com dono (tela Hoje) ----------------
let pessoas = [];
async function carregarPessoas() { if (!pessoas.length) pessoas = await api('/api/pessoas').catch(() => []); return pessoas; }
const nomeCurto = (u) => (u === 'agente' ? 'Agente (IA)' : u === eu?.usuario ? 'Você' : pessoas.find((p) => p.usuario === u)?.nome?.split(' ')[0] || u || 'Ninguém');
const quemTem = (t) => (t.responsavel ? nomeCurto(t.responsavel) : t.liberada ? 'Liberada para a equipe' : 'Sem dono');
const cartaoTarefa = (t) => `
  <button type="button" class="cartao tarefa p-${esc(t.prioridade)}" data-tarefa="${t.id}">
    <b>${esc(t.titulo)}</b>
    <small>${esc(t.projeto)} · #${t.id}</small>
    <span class="chips"><span class="chip dono">${t.responsavel === 'agente' ? '🤖' : '👤'} ${esc(quemTem(t))}</span>${t.prioridade === 'alta' ? '<span class="chip alta">alta</span>' : ''}${t.prazo ? `<span class="chip">até ${esc(t.prazo.split('-').reverse().slice(0, 2).join('/'))}</span>` : ''}</span>
  </button>`;

async function desenharHoje(alvo, tarefas) {
  await carregarPessoas();
  const abertas = tarefas.filter((t) => t.coluna !== 'feito');
  const dono = eu.papel === 'dono';
  const bloco = (titulo, lista, vazio) => `<div class="bloco-hoje"><h2>${titulo} <span>${lista.length}</span></h2>${lista.length ? lista.slice(0, 6).map(cartaoTarefa).join('') + (lista.length > 6 ? `<a href="#/quadro" class="mais">ver as outras ${lista.length - 6}</a>` : '') : `<p class="vazio">${vazio}</p>`}</div>`;
  let blocos;
  if (dono) {
    const equipe = abertas.filter((t) => t.responsavel && t.responsavel !== eu.usuario && t.coluna !== 'aprovar');
    const porPessoa = {};
    equipe.forEach((t) => { (porPessoa[t.responsavel] ||= []).push(t); });
    const liberadas = abertas.filter((t) => t.liberada && !t.responsavel);
    blocos = bloco('👀 Esperando você aprovar', abertas.filter((t) => t.coluna === 'aprovar'), 'Nada para aprovar.')
      + bloco('🙋 Com você', abertas.filter((t) => t.responsavel === eu.usuario && t.coluna !== 'ideias' && t.coluna !== 'aprovar'), 'Nada com você agora.')
      + `<div class="bloco-hoje"><h2>👥 Com a equipe <span>${equipe.length}</span></h2>${Object.entries(porPessoa).map(([u, ts]) => `<h3>${esc(nomeCurto(u))} <span>${ts.length}</span></h3>${ts.slice(0, 3).map(cartaoTarefa).join('')}`).join('') || '<p class="vazio">Ninguém da equipe com tarefa.</p>'}${liberadas.length ? `<p class="liberadas">🎁 ${liberadas.length} liberada(s) esperando alguém pegar</p>` : ''}</div>`;
  } else {
    blocos = bloco('🙋 Com você', abertas.filter((t) => t.responsavel === eu.usuario && t.coluna !== 'aprovar'), 'Nada com você agora.')
      + bloco('🎁 Liberadas para pegar', abertas.filter((t) => t.liberada && !t.responsavel), 'Nenhuma liberada agora.')
      + bloco('⏳ Esperando o Gabriel aprovar', abertas.filter((t) => t.coluna === 'aprovar' && (t.feitaPor === eu.usuario || t.responsavel === eu.usuario)), 'Nada esperando aprovação.');
  }
  alvo.innerHTML = `<div class="hoje-topo"><h2>Hoje</h2><span class="incentivo"></span><button type="button" class="btn nova-tarefa">+ Nova tarefa</button></div><div class="blocos-hoje">${blocos}</div>`;
  alvo.querySelectorAll('[data-tarefa]').forEach((b) => b.addEventListener('click', () => abrirTarefa(Number(b.dataset.tarefa), tarefas)));
  alvo.querySelector('.nova-tarefa').addEventListener('click', () => novaTarefa());
}

function janela(html) {
  document.querySelector('dialog.janela')?.remove();
  const d = document.createElement('dialog');
  d.className = 'janela';
  d.innerHTML = `<button type="button" class="fechar" aria-label="Fechar">✕</button>${html}`;
  document.body.append(d);
  d.querySelector('.fechar').addEventListener('click', () => d.close());
  d.addEventListener('close', () => d.remove());
  d.showModal();
  return d;
}
async function acaoTarefa(nome, entrada) {
  const r = await postar('/api/acao', { nome, entrada });
  if (!r.ok) { alert(r.dados.erro || 'Não foi possível.'); return false; }
  document.querySelector('dialog.janela')?.close();
  rotear();
  return true;
}
const opcoesPessoas = (atual) => `<option value="ninguem">Ninguém ainda</option>${pessoas.map((p) => `<option value="${esc(p.usuario)}" ${p.usuario === atual ? 'selected' : ''}>${esc(p.usuario === eu.usuario ? `Eu (${p.nome})` : p.nome)}</option>`).join('')}<option value="agente" ${atual === 'agente' ? 'selected' : ''}>🤖 Agente da noite (IA)</option>`;

function abrirTarefa(id, tarefas) {
  const t = tarefas.find((x) => x.id === id);
  if (!t) return;
  const dono = eu.papel === 'dono';
  const minha = t.responsavel === eu.usuario || (!t.responsavel && t.por === eu.usuario);
  const botoes = [];
  if (dono && t.coluna === 'aprovar') botoes.push('<button type="button" class="btn" data-a="aprovar">✅ Aprovar</button>', '<button type="button" class="btn btn-claro" data-a="devolver">↩️ Devolver com ajuste</button>');
  if (!dono && t.liberada && !t.responsavel) botoes.push('<button type="button" class="btn" data-a="pegar">🙋 Pegar para mim</button>');
  if ((dono || minha) && t.coluna === 'a fazer') botoes.push('<button type="button" class="btn btn-claro" data-a="comecar">🔨 Comecei</button>');
  if ((dono || minha) && ['a fazer', 'fazendo'].includes(t.coluna)) botoes.push(`<button type="button" class="btn" data-a="concluir">${dono ? '✅ Concluí' : '📤 Terminei (enviar para aprovar)'}</button>`);
  const d = janela(`
    <p class="etapa-tarefa">${etapa(t.coluna)}</p>
    <h2>${esc(t.titulo)}</h2>
    <p class="meta">${esc(t.projeto)} · #${t.id} · criada por ${esc(nomeCurto(t.por))}${t.prioridade === 'alta' ? ' · <b>prioridade alta</b>' : ''}${t.prazo ? ` · prazo ${esc(t.prazo.split('-').reverse().join('/'))}` : ''}</p>
    <p class="com-quem">${t.responsavel === 'agente' ? '🤖' : '👤'} Está com: <b>${esc(quemTem(t))}</b></p>
    ${t.detalhe ? `<p class="detalhe">${esc(t.detalhe)}</p>` : ''}
    ${dono ? `<div class="passar"><label>Passar para <select class="sel-para">${opcoesPessoas(t.responsavel)}</select></label><button type="button" class="btn btn-claro" data-a="passar">Passar</button><label class="linha"><input type="checkbox" class="sel-liberada" ${t.liberada ? 'checked' : ''} /> Liberada para a equipe pegar</label></div>` : ''}
    <div class="botoes-tarefa">${botoes.join('')}</div>
    <h3>O que aconteceu</h3>
    <ol class="linha-tempo">${(t.linha || []).slice().reverse().map((l) => `<li><b>${esc(nomeCurto(l.por))}</b> ${esc(l.texto)}<small>${new Date(l.em).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</small></li>`).join('') || `<li>Criada em ${new Date(t.criado).toLocaleDateString('pt-BR')}${t.por ? ` por ${esc(nomeCurto(t.por))}` : ''}.</li>`}</ol>`);
  d.querySelectorAll('[data-a]').forEach((b) => b.addEventListener('click', async () => {
    const a = b.dataset.a;
    if (a === 'aprovar') acaoTarefa('aprovar_tarefa', { id: t.id });
    if (a === 'pegar') acaoTarefa('pegar_tarefa', { id: t.id });
    if (a === 'comecar') acaoTarefa('editar_tarefa', { id: t.id, coluna: 'fazendo' });
    if (a === 'passar') acaoTarefa('passar_tarefa', { id: t.id, para: d.querySelector('.sel-para').value });
    if (a === 'devolver') { const motivo = prompt('O que falta ajustar?'); if (motivo) acaoTarefa('devolver_tarefa', { id: t.id, motivo }); }
    if (a === 'concluir') { const nota = prompt('O que foi feito? (opcional)') ?? ''; acaoTarefa('concluir_tarefa', { id: t.id, nota }); }
  }));
  d.querySelector('.sel-liberada')?.addEventListener('change', (e) => acaoTarefa('passar_tarefa', { id: t.id, liberar: e.target.checked }));
}

async function novaTarefa() {
  await carregarPessoas();
  const projs = await api('/api/projetos').catch(() => []);
  const nomes = ['geral', 'central-vz', ...projs.filter((p) => p.situacao === 'central').map((p) => p.nome)].filter((v, i, a) => a.indexOf(v) === i);
  const dono = eu.papel === 'dono';
  const d = janela(`
    <h2>Nova tarefa</h2>
    <form class="form-tarefa">
      <label>O que precisa ser feito?<input name="titulo" required maxlength="140" placeholder="Ex.: tela de login do ScanTE" /></label>
      <label>Projeto<select name="projeto">${nomes.map((n) => `<option>${esc(n)}</option>`).join('')}</select></label>
      ${dono ? `<label>Com quem fica?<select name="para">${opcoesPessoas(eu.usuario)}</select></label><label class="linha"><input type="checkbox" name="liberada" /> Liberar para a equipe pegar</label>` : ''}
      <label>Etapa<select name="coluna"><option value="a fazer">📌 Para fazer</option><option value="ideias">💡 Só uma ideia</option><option value="fazendo">🔨 Já estou fazendo</option></select></label>
      <label class="linha"><input type="checkbox" name="alta" /> Prioridade alta</label>
      <label>Prazo (opcional)<input type="date" name="prazo" /></label>
      <label>Detalhes (opcional)<textarea name="detalhe" rows="3"></textarea></label>
      <button class="btn" type="submit">Criar tarefa</button>
    </form>`);
  d.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const entrada = { titulo: f.titulo.value, projeto: f.projeto.value, coluna: f.coluna.value, prioridade: f.alta.checked ? 'alta' : 'normal', detalhe: f.detalhe.value };
    if (f.prazo.value) entrada.prazo = f.prazo.value;
    if (dono) { entrada.para = f.para.value; entrada.liberada = f.liberada.checked; }
    acaoTarefa('criar_tarefa', entrada);
  });
}

const ABAS = { central: 'Na central', 'a escolher': 'A escolher', excluir: 'Para excluir' };
async function projetos() {
  const [todos, cacheDicas] = await Promise.all([api('/api/projetos'), api('/api/dicas')]);
  const dono = eu.papel === 'dono';
  let aba = todos.some((p) => p.situacao === 'central') ? 'central' : 'a escolher';
  tela.innerHTML = `
    <h1>Projetos</h1>
    <div class="abas" role="tablist"></div>
    <p class="dica texto-aba"></p>
    <div class="filtros">
      <input type="search" placeholder="Buscar projeto…" aria-label="Buscar projeto" />
      <button type="button" data-f="todos" aria-pressed="true">Todos</button>
      <button type="button" data-f="semgit" aria-pressed="false">Sem git</button>
      <button type="button" data-f="pendente" aria-pressed="false">Com coisa não enviada</button>
    </div>
    <div class="projetos"></div>
    ${ajudaUmaVez('ajuda-projetos', 'Dica: passe o mouse num projeto da central para ver o próximo passo. Para trazer os projetos de outro computador, rode <code>npm run inventario</code> nele e envie para o git.')}`;
  const TEXTOS = {
    central: 'Os projetos que você escolheu. Só eles aparecem na home, recebem dicas e são vistos pela IA.',
    'a escolher': 'Projetos encontrados nas máquinas que ainda não foram escolhidos. Inclua na central ou marque para excluir.',
    excluir: 'Lista para validar antes de apagar. Nada é apagado do computador por aqui.',
  };
  let filtro = 'todos';
  const busca = tela.querySelector('input');
  const botoesSituacao = (p) => {
    if (!dono) return '';
    const b = (sit, rotulo, classe = 'btn-claro') => `<button type="button" class="btn ${classe} btn-sit" data-nome="${esc(p.nome)}" data-sit="${sit}">${rotulo}</button>`;
    if (p.situacao === 'central') return b('a escolher', 'Tirar da central');
    if (p.situacao === 'excluir') return b('a escolher', 'Voltar para a escolher');
    return b('central', 'Incluir na central', '') + b('excluir', 'Marcar para excluir');
  };
  const desenhar = () => {
    tela.querySelector('.abas').innerHTML = Object.entries(ABAS).map(([k, r]) =>
      `<button type="button" role="tab" data-aba="${k}" aria-selected="${k === aba}">${r} <span>${todos.filter((p) => p.situacao === k).length}</span></button>`).join('');
    tela.querySelector('.texto-aba').textContent = TEXTOS[aba];
    const b = busca.value.toLowerCase();
    const lista = todos.filter((p) => p.situacao === aba && (!b || `${p.nome} ${p.descricao}`.toLowerCase().includes(b))
      && (filtro === 'todos' || (filtro === 'semgit' && !p.git) || (filtro === 'pendente' && (p.alterados || p.naoEnviados))));
    tela.querySelector('.projetos').innerHTML = lista.map((p) => `
      <article class="projeto"><h3>${esc(p.nome)}</h3><p>${esc(p.descricao) || 'Sem descrição.'}</p>
        <div class="selos">
          <span class="selo">${esc(p.maquina)}</span>
          ${p.git ? `<span class="selo bom">${esc(p.remoto || 'git sem remoto')}</span>` : '<span class="selo ruim">sem git</span>'}
          ${p.alterados ? `<span class="selo ruim">${p.alterados} alterados</span>` : ''}
          ${p.naoEnviados ? `<span class="selo ruim">${p.naoEnviados} não enviados</span>` : ''}
          ${p.ultimoCommit ? `<span class="selo">último: ${esc(p.ultimoCommit)}</span>` : ''}
        </div>
        <div class="acoes-projeto">
          ${p.situacao === 'central' ? `<button type="button" class="btn btn-claro btn-dica" data-nome="${esc(p.nome)}">Próximo passo</button>` : ''}
          ${botoesSituacao(p)}
        </div>
        <div class="dica-projeto" hidden></div></article>`).join('') || '<p>Nada aqui.</p>';
  };
  tela.querySelector('.abas').addEventListener('click', (e) => {
    const bt = e.target.closest('[data-aba]');
    if (bt) { aba = bt.dataset.aba; desenhar(); }
  });
  tela.querySelector('.projetos').addEventListener('click', async (e) => {
    const bt = e.target.closest('.btn-sit');
    if (!bt) return;
    bt.disabled = true;
    const r = await postar('/api/projetos/situacao', { nome: bt.dataset.nome, situacao: bt.dataset.sit });
    if (!r.ok) { alert(r.dados.erro || 'Não foi possível mudar.'); bt.disabled = false; return; }
    todos.filter((p) => p.nome === bt.dataset.nome).forEach((p) => { p.situacao = bt.dataset.sit; });
    desenhar();
  });
  // Dica de "como continuar": aparece ao parar o mouse no projeto (ou no botão, no celular)
  async function mostrarDica(card, trocar = false) {
    if (!card.querySelector('.btn-dica')) return; // só projetos da central têm dica
    const nome = card.querySelector('.btn-dica').dataset.nome;
    const caixa = card.querySelector('.dica-projeto');
    caixa.hidden = false;
    let d = !trocar && cacheDicas[nome];
    if (!d) {
      caixa.innerHTML = `<p class="carregando">${esc(estado.nomeIA)} está pensando no próximo passo…</p>`;
      const r = await postar('/api/dicas', { nome, trocar });
      if (!r.ok) { caixa.innerHTML = `<p class="erro-form">${esc(r.dados.erro || 'Não foi possível gerar a dica.')}</p>`; return; }
      d = cacheDicas[nome] = r.dados;
    }
    caixa.innerHTML = `<b>Próximo passo</b><p>${esc(d.passo)}</p><small>${esc(d.porque)}</small>
      <div class="acoes-dica"><button type="button" class="btn acatar">Acatar</button><button type="button" class="btn btn-claro trocar">Trocar plano</button></div>`;
    caixa.querySelector('.acatar').addEventListener('click', async () => {
      const r = await postar('/api/dicas/acatar', { nome });
      caixa.innerHTML = r.ok ? `<p class="ok-dica">✓ ${esc(r.dados.mensagem)} Veja no <a href="#/quadro">quadro</a>.</p>` : `<p class="erro-form">${esc(r.dados.erro)}</p>`;
    });
    caixa.querySelector('.trocar').addEventListener('click', () => mostrarDica(card, true));
  }
  const lista = tela.querySelector('.projetos');
  lista.addEventListener('click', (e) => { const b = e.target.closest('.btn-dica'); if (b) mostrarDica(b.closest('.projeto')); });
  if (matchMedia('(hover: hover)').matches) {
    let espera;
    lista.addEventListener('mouseover', (e) => {
      const card = e.target.closest('.projeto');
      if (!card || !card.querySelector('.dica-projeto').hidden) return;
      clearTimeout(espera);
      espera = setTimeout(() => card.matches(':hover') && mostrarDica(card), 700);
    });
  }
  busca.addEventListener('input', desenhar);
  tela.querySelectorAll('.filtros button').forEach((bt) => bt.addEventListener('click', () => {
    filtro = bt.dataset.f;
    tela.querySelectorAll('.filtros button').forEach((x) => x.setAttribute('aria-pressed', x === bt));
    desenhar();
  }));
  desenhar();
}

async function estudos(slug) {
  if (!slug) {
    const lista = await api('/api/estudos');
    tela.innerHTML = `<h1>Central de Estudos</h1><p>Leia, pergunte ao professor de IA e compartilhe com a equipe.</p>
      <div class="estudos-lista">${lista.map((e) => `<a class="estudo-card" href="#/estudos/${esc(e.slug)}"><h2>${esc(e.titulo)}</h2><p>${esc(e.resumo)}</p></a>`).join('')}</div>`;
    return;
  }
  const r = await fetch(`/api/estudos/${encodeURIComponent(slug)}`);
  if (!r.ok) { tela.innerHTML = '<p>Material não encontrado.</p>'; return; }
  const md = await r.text();
  tela.innerHTML = `
    <div class="estudo">
      <article class="artigo">
        <div class="acoes-artigo"><a href="#/estudos" class="btn btn-claro">← Materiais</a><button type="button" class="btn btn-claro compartilhar">Compartilhar</button></div>
        <div class="conteudo"></div>
      </article>
      <div class="lado">${htmlChat('Tire suas dúvidas', 'Pergunte sobre este material, por texto ou por voz.')}</div>
    </div>`;
  // Material nosso, do repositório: o marked transforma o markdown em HTML
  tela.querySelector('.conteudo').innerHTML = window.marked ? marked.parse(md) : `<pre>${esc(md)}</pre>`;
  tela.querySelector('.compartilhar').addEventListener('click', async () => {
    const titulo = md.match(/^# (.+)$/m)?.[1] || 'Material da VZ';
    if (navigator.share) { try { await navigator.share({ title: titulo, text: md }); return; } catch { /* cancelado */ } }
    await navigator.clipboard.writeText(md);
    alert('Texto do material copiado. Cole onde quiser compartilhar.');
  });
  const raiz = tela.querySelector('.lado');
  chatAtivo = criarChat({ raiz, canal: 'estudos', estudo: slug });
  ligarNovaConversa(raiz, 'estudos');
}

const TIPOS_HIST = { projeto_situacao: 'mudou a situação do projeto', mensagem: 'falou', resposta: 'respondeu', cartao_criado: 'criou cartão', cartao_movido: 'moveu cartão', memoria: 'guardou na memória', dica: 'gerou dica', dica_trocada: 'trocou o plano', dica_acatada: 'acatou a dica', login: 'entrou', logout: 'saiu', login_falhou: 'login recusado', senha_trocada: 'trocou a senha' };
async function historicoTela() {
  tela.innerHTML = `<h1>Histórico</h1><p>As ações da equipe, do mais recente ao mais antigo. As conversas com a VZ são privadas: só você vê as suas.</p>
    <div class="filtros"><input type="search" placeholder="Buscar no histórico…" aria-label="Buscar no histórico" /></div>
    <ol class="linha-tempo"></ol>`;
  const busca = tela.querySelector('input');
  const desenhar = async () => {
    const lista = await api(`/api/historico?busca=${encodeURIComponent(busca.value)}`);
    tela.querySelector('.linha-tempo').innerHTML = lista.map((e) => `
      <li class="ev-${esc(e.tipo)}"><time>${esc(new Date(e.data).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }))}</time>
        <b>${esc(e.usuario)}</b> <span class="tipo">${esc(TIPOS_HIST[e.tipo] || e.tipo)}</span>
        <p>${esc(e.descricao.length > 300 ? e.descricao.slice(0, 300) + '…' : e.descricao)}</p></li>`).join('') || '<li>Nada ainda.</li>';
  };
  let espera; busca.addEventListener('input', () => { clearTimeout(espera); espera = setTimeout(desenhar, 300); });
  desenhar();
}

async function memoria() {
  const lista = await api('/api/memoria');
  tela.innerHTML = `<h1>Memória</h1><p>O que ${esc(estado.nomeIA)} guardou. Para ensinar algo, diga na conversa: “guarda que…”.</p>
    <ul class="memorias">${lista.map((m) => `<li><small>${esc(m.data)}</small>${esc(m.texto)}</li>`).reverse().join('') || '<li>Nada ainda.</li>'}</ul>`;
}

// ---------------- tour de boas-vindas (por usuário) ----------------
const PASSOS = [
  { alvo: '[data-tour=conversa]', titulo: 'Converse por voz', texto: 'Toque na imagem ou diga “Sabrina” (ou “VZ”), e fale normalmente. Ela responde falando, e você pode interromper. Peça para anotar ideias, criar tarefas ou contar como estão os projetos.' },
  { alvo: '[data-tour=quadro]', titulo: 'O quadro da equipe', texto: 'Cada cartão é uma tarefa: ideias, a fazer, fazendo e feito. Os pensamentos que você fala viram cartões aqui.' },
  { alvo: '[data-tour=projetos]', titulo: 'Todos os projetos', texto: 'Os projetos de cada computador, com alerta do que está sem git ou não foi enviado. Nada mais fica esquecido numa máquina.' },
  { alvo: '[data-tour=estudos]', titulo: 'Central de Estudos', texto: 'Materiais para a equipe evoluir, cada um com um professor de IA para tirar dúvidas e um botão para compartilhar.' },
  { alvo: '[data-tour=memoria]', titulo: 'Memória', texto: 'O que a IA aprendeu sobre a VZ fica aqui. Ela usa isso em toda conversa.' },
  { alvo: '[data-tour=historico]', titulo: 'Histórico', texto: 'Cada conversa, cartão, dica e decisão fica registrada aqui. É assim que a central fica mais inteligente com o tempo.' },
  { alvo: '#usuario', titulo: 'Sua conta', texto: 'No seu nome você troca a senha, revê este tour ou sai da conta.' },
];
function iniciarTour() {
  document.querySelector('.tour-fundo')?.remove();
  const fundo = document.createElement('div');
  fundo.className = 'tour-fundo';
  fundo.innerHTML = '<div class="tour-foco"></div><div class="tour-caixa" role="dialog" aria-modal="true" aria-labelledby="tour-titulo"></div>';
  document.body.append(fundo);
  const foco = fundo.querySelector('.tour-foco');
  const caixa = fundo.querySelector('.tour-caixa');
  const fechar = () => { marcarVisto('tour'); fundo.remove(); };

  const boasVindas = () => {
    foco.style.cssText = 'top:50%;left:50%;width:0;height:0';
    caixa.style.cssText = 'top:50%;left:50%;transform:translate(-50%,-50%)';
    caixa.innerHTML = `<p class="passos">Bem-vindo, ${esc(eu.nome)}</p><h3 id="tour-titulo">Esta é a Central da VZ</h3>
      <p>Em um minuto você vê onde fica cada coisa. Dá para rever este tour quando quiser, no seu nome, lá em cima.</p>
      <div class="botoes"><button type="button" class="btn btn-claro pular">Pular</button><button type="button" class="btn mostrar">Mostrar</button></div>`;
    caixa.querySelector('.pular').addEventListener('click', fechar);
    caixa.querySelector('.mostrar').addEventListener('click', () => passo(0));
    caixa.querySelector('.mostrar').focus();
  };
  const passo = (i) => {
    const p = PASSOS[i];
    const alvo = document.querySelector(p.alvo);
    if (!alvo) { fechar(); return; }
    alvo.scrollIntoView({ block: 'center' });
    const r = alvo.getBoundingClientRect();
    foco.style.cssText = `top:${r.top - 8}px;left:${r.left - 8}px;width:${r.width + 16}px;height:${r.height + 16}px`;
    const embaixo = r.bottom + 260 < innerHeight;
    caixa.style.cssText = `top:${embaixo ? r.bottom + 16 : Math.max(16, r.top - 250)}px;left:${Math.min(Math.max(16, r.left), innerWidth - 400)}px`;
    caixa.innerHTML = `<p class="passos">Passo ${i + 1} de ${PASSOS.length}</p><h3 id="tour-titulo">${p.titulo}</h3><p>${p.texto}</p>
      <div class="botoes"><button type="button" class="btn btn-claro pular">Pular tour</button><button type="button" class="btn proximo">${i === PASSOS.length - 1 ? 'Começar a usar' : 'Próximo'}</button></div>`;
    caixa.querySelector('.pular').addEventListener('click', fechar);
    caixa.querySelector('.proximo').addEventListener('click', () => (i === PASSOS.length - 1 ? fechar() : passo(i + 1)));
    caixa.querySelector('.proximo').focus();
  };
  boasVindas();
}

// ---------------- radar de novidades ----------------
const CAT_RADAR = { claude: ['✳️', 'Claude'], mcp: ['🧩', 'MCPs'], skill: ['⚡', 'Skills'], modelo: ['🧠', 'Modelos abertos'], ferramenta: ['🛠️', 'Ferramentas'], perfil: ['👤', 'Perfis'] };
async function radarTela(dataPedida) {
  const d = await api(`/api/radar${dataPedida ? `?data=${encodeURIComponent(dataPedida)}` : ''}`);
  const r = d.radar;
  const dataBR = (s) => new Date(`${s}T12:00`).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' });
  const cartao = (i) => `
    <article class="radar-item" data-cat="${esc(i.categoria)}">
      <header><span class="radar-cat">${CAT_RADAR[i.categoria]?.[0] || '•'} ${esc(CAT_RADAR[i.categoria]?.[1] || i.categoria)}</span><span class="esforco e-${esc(i.esforco)}">esforço ${esc(i.esforco === 'medio' ? 'médio' : i.esforco)}</span></header>
      <h3>${esc(i.titulo)}</h3>
      <p>${esc(i.oque)}</p>
      ${i.visual ? `<p class="radar-visual"><b>Como fica:</b> ${esc(i.visual)}</p>` : ''}
      ${i.para_vz ? `<p class="radar-vz"><b>Para a VZ:</b> ${esc(i.para_vz)}</p>` : ''}
      <footer>${i.licenca ? `<span class="tag">${esc(i.licenca)}</span>` : ''}${i.data ? `<span class="tag">${esc(i.data)}</span>` : ''}${i.link ? `<a href="${esc(i.link)}" target="_blank" rel="noopener noreferrer">abrir fonte ↗</a>` : ''}</footer>
    </article>`;
  const cats = r ? Object.keys(CAT_RADAR).filter((c) => r.itens.some((i) => i.categoria === c)) : [];
  tela.innerHTML = `
    <section class="radar-topo">
      <div><h1>📡 Radar de novidades</h1><p>${r ? esc(r.resumo) : 'O radar pesquisa todo dia, a partir das 7h, o que saiu de novo em IA para a VZ.'}</p></div>
      <div class="radar-acoes">
        ${d.datas.length ? `<select class="radar-data" aria-label="Escolher o dia">${d.datas.map((x) => `<option value="${x}" ${r && x === r.data ? 'selected' : ''}>${dataBR(x)}</option>`).join('')}</select>` : ''}
        ${eu.papel === 'dono' ? `<button type="button" class="btn radar-gerar" ${d.gerando ? 'disabled' : ''}>${d.gerando ? 'Pesquisando…' : 'Atualizar agora'}</button>` : ''}
      </div>
    </section>
    ${r ? `
    <section class="radar-top3">${r.top3.map((t, k) => `<div class="top"><span class="num">${k + 1}</span><div><h3>${esc(t.titulo)}</h3><p><b>Primeiro passo:</b> ${esc(t.primeiro_passo)}</p></div></div>`).join('')}</section>
    <nav class="radar-filtros" aria-label="Filtrar por categoria"><button type="button" class="ativo" data-f="">Tudo (${r.itens.length})</button>${cats.map((c) => `<button type="button" data-f="${c}">${CAT_RADAR[c][0]} ${CAT_RADAR[c][1]} (${r.itens.filter((i) => i.categoria === c).length})</button>`).join('')}</nav>
    <section class="radar-grade">${r.itens.map(cartao).join('')}</section>
    <p class="radar-rodape">Gerado em ${new Date(r.gerado_em).toLocaleString('pt-BR')} · ${d.perfis.length ? `Perfis acompanhados: ${d.perfis.map(esc).join(', ')}` : 'Nenhum perfil acompanhado ainda (mande a lista de @ para a VZ).'}</p>`
    : `<div class="vazio-grande">${d.gerando ? '🔎 Pesquisando as novidades… leva uns 2 a 4 minutos.' : 'Ainda não há radar. Toque em “Atualizar agora” ou espere as 7h.'}</div>`}`;
  tela.querySelector('.radar-data')?.addEventListener('change', (e) => { location.hash = `#/radar/${e.target.value}`; });
  tela.querySelectorAll('.radar-filtros button').forEach((b) => b.addEventListener('click', () => {
    tela.querySelectorAll('.radar-filtros button').forEach((x) => x.classList.toggle('ativo', x === b));
    tela.querySelectorAll('.radar-item').forEach((it) => { it.hidden = Boolean(b.dataset.f) && it.dataset.cat !== b.dataset.f; });
  }));
  const espera = async () => {
    const x = await api('/api/radar');
    if (!location.hash.startsWith('#/radar')) return;
    if (x.gerando) setTimeout(espera, 10_000); else radarTela();
  };
  tela.querySelector('.radar-gerar')?.addEventListener('click', async () => {
    const res = await postar('/api/radar/gerar');
    if (!res.ok) { alert(res.dados.erro || 'Não foi possível atualizar.'); return; }
    radarTela(); setTimeout(espera, 10_000);
  });
  if (d.gerando) setTimeout(espera, 10_000);
}

// ---------------- avisos (bolinhas estilo Instagram) ----------------
const AREA_DO_AVISO = { tarefas: ['#/quadro', '.a-quadro'], prazos: ['#/quadro', '.a-quadro'], lembretes: ['#/', '.hoje-topo'], radar: ['#/radar', '.a-radar'], estudos: ['#/estudos', '.a-estudos'], equipe: ['#/historico', '.a-equipe'] };
const ICONE_AVISO = { tarefas: '📌', prazos: '⏰', lembretes: '🔔', radar: '📡', estudos: '📚', equipe: '👥' };
let avisos = { itens: [], contagem: {}, total: 0 };
async function atualizarAvisos() {
  if (!eu || eu.trocarSenha || eu.modo) return;
  avisos = await api('/api/avisos').catch(() => avisos);
  const sino = document.querySelector('.sino');
  sino.hidden = false;
  const bolha = sino.querySelector('.bolha');
  bolha.hidden = !avisos.total;
  bolha.textContent = avisos.total > 9 ? '9+' : avisos.total;
  sino.setAttribute('aria-label', avisos.total ? `${avisos.total} avisos novos` : 'Sem avisos novos');
  const inc = document.querySelector('.incentivo');
  if (inc) inc.innerHTML = `<span title="Dias seguidos usando a Central">🔥 ${avisos.sequencia || 1} ${avisos.sequencia === 1 ? 'dia' : 'dias seguidos'}</span><span title="Tarefas que você terminou ou aprovou hoje">✅ ${avisos.resolvidasHoje || 0} resolvida${avisos.resolvidasHoje === 1 ? '' : 's'} hoje</span>${avisos.total ? `<span class="pendente">🔴 ${avisos.total} para ver</span>` : '<span>✨ tudo em dia</span>'}`;
  try { if (avisos.total) navigator.setAppBadge?.(avisos.total); else navigator.clearAppBadge?.(); } catch { /* sem badge */ }
  notificarNovos(avisos.itens.filter((i) => i.importante));
  const porSeletor = {};
  for (const [area, [, sel]] of Object.entries(AREA_DO_AVISO)) porSeletor[sel] = (porSeletor[sel] || 0) + (avisos.contagem[area] || 0);
  for (const [sel, n] of Object.entries(porSeletor)) {
    const el = tela.querySelector(sel);
    if (!el) continue;
    el.querySelector('.bolinha')?.remove();
    if (n) el.insertAdjacentHTML('beforeend', `<span class="bolinha" aria-label="${n} novos">${n > 9 ? '9+' : n}</span>`);
  }
}
// Notificação do sistema (canto da tela) para avisos importantes novos, uma vez cada
const jaNotificados = new Set((() => { try { return JSON.parse(sessionStorage.getItem('vz-notificados') || '[]'); } catch { return []; } })());
function notificarNovos(lista) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  for (const i of lista) {
    const chave = `${i.area}:${i.id ?? ''}:${i.em}`;
    if (jaNotificados.has(chave)) continue;
    jaNotificados.add(chave);
    try { new Notification('Central da VZ', { body: i.texto, icon: 'icone-192.png', tag: chave }); } catch { /* sem notificação */ }
  }
  try { sessionStorage.setItem('vz-notificados', JSON.stringify([...jaNotificados].slice(-200))); } catch { /* sem armazenamento */ }
}
async function marcarVistoArea(area) {
  if (!avisos.contagem[area]) return;
  await postar('/api/avisos/visto', { area });
  atualizarAvisos();
}
function abrirAvisos() {
  const quando = (em) => new Date(em).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const d = janela(`
    <h2>🔔 Avisos</h2>
    <p class="meta">O que aconteceu desde a última vez que você olhou. Prazos e lembretes ficam aqui até serem resolvidos.</p>
    ${'Notification' in window && Notification.permission === 'default' ? '<button type="button" class="btn ativar-notif">💻 Avisar também no canto da tela</button>' : ''}
    ${avisos.total ? `<ul class="lista-avisos">${avisos.itens.map((i) => `
      <li class="${i.importante ? 'importante' : ''}"><a href="${['tarefas', 'prazos'].includes(i.area) ? '#/quadro' : i.area === 'estudos' && i.slug ? `#/estudos/${esc(i.slug)}` : AREA_DO_AVISO[i.area][0]}" data-area="${i.area}">
        <span class="ico">${ICONE_AVISO[i.area]}</span><span>${esc(i.texto)}<small>${i.area === 'lembretes' ? 'lembrete' : quando(i.em)}</small></span></a>${i.area === 'lembretes' ? `<button type="button" class="btn btn-claro resolver" data-lembrete="${i.id}">Feito</button>` : ''}</li>`).join('')}</ul>
      <button type="button" class="btn btn-claro tudo-visto">Marcar tudo como visto</button>` : '<p class="vazio-grande">Tudo em dia. Nada novo por aqui. ✨</p>'}`);
  d.querySelectorAll('[data-area]').forEach((a) => a.addEventListener('click', () => { marcarVistoArea(a.dataset.area); d.close(); }));
  d.querySelectorAll('[data-lembrete]').forEach((b) => b.addEventListener('click', async () => { await postar('/api/acao', { nome: 'concluir_lembrete', entrada: { id: Number(b.dataset.lembrete) } }); d.close(); atualizarAvisos(); }));
  d.querySelector('.ativar-notif')?.addEventListener('click', async () => { await Notification.requestPermission(); d.close(); atualizarAvisos(); });
  d.querySelector('.tudo-visto')?.addEventListener('click', async () => { await postar('/api/avisos/visto', { area: 'tudo' }); d.close(); atualizarAvisos(); });
}
document.querySelector('.sino').addEventListener('click', abrirAvisos);
setInterval(() => { if (!document.hidden) atualizarAvisos(); }, 60_000);

// ---------------- roteamento ----------------
async function rotear() {
  if (!eu) return;
  if (eu.modo === 'recuperacao') { telaRecuperar(); return; }
  if (eu.trocarSenha) { telaSenha(true); return; }
  if (chatAtivo !== chatGeral) chatAtivo?.parar();
  chatAtivo = null; aoMudarVersao = () => vozesGeral?.();
  retomarEscutaNome();
  document.querySelector('.tour-fundo')?.remove();
  const [area, sub] = location.hash.replace(/^#\/?/, '').split('/');
  if (area !== 'conversa') soltarConversa(false); // a conversa vai para a doca e continua
  document.querySelector('.voltar').hidden = !area;
  const telas = { '': home, conversa, quadro, projetos, estudos: () => estudos(sub), memoria, historico: historicoTela, radar: () => radarTela(sub) };
  await (telas[area] || home)();
  const vista = { quadro: 'tarefas', radar: 'radar', estudos: 'estudos', historico: 'equipe' }[area];
  await atualizarAvisos();
  if (vista) marcarVistoArea(vista);
  tela.focus({ preventScroll: true });
  scrollTo(0, 0);
}
addEventListener('hashchange', rotear);
addEventListener('keydown', (e) => { if (e.key === 'Escape') (chatAtivo || chatGeral)?.interromper?.(); });
estado = await (await fetch('/api/estado')).json();
estado.nomeBase = estado.nomeIA; // "VZ": o nome da versão normal
iniciarSessao();
