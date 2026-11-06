// Radar da VZ: todo dia a IA pesquisa na web o que saiu de novo (Claude, MCPs, skills, modelos abertos,
// ferramentas de IA e perfis acompanhados) e guarda em dados/radar/AAAA-MM-DD.json para a tela Radar.
import Anthropic from '@anthropic-ai/sdk';
import fs from 'node:fs';
import path from 'node:path';

const PASTA = path.join('dados', 'radar');
const MODELO = 'claude-opus-5-5';
export const CATEGORIAS = ['claude', 'mcp', 'skill', 'modelo', 'ferramenta', 'perfil'];
const ESFORCOS = ['baixo', 'medio', 'alto'];
const hoje = () => new Date().toLocaleDateString('sv-SE');
const DATA = /^\d{4}-\d{2}-\d{2}$/;

export function listarRadar() {
  try { return fs.readdirSync(PASTA).filter((f) => DATA.test(f.slice(0, 10)) && f.endsWith('.json')).map((f) => f.slice(0, 10)).sort().reverse(); } catch { return []; }
}
export function lerRadar(data) {
  if (!DATA.test(data || '')) return null;
  try { return JSON.parse(fs.readFileSync(path.join(PASTA, `${data}.json`), 'utf8')); } catch { return null; }
}
// Perfis acompanhados (Instagram etc.): lista simples de @, editada pelo Gabriel
export const perfis = () => { try { return JSON.parse(fs.readFileSync(path.join(PASTA, 'perfis.json'), 'utf8')); } catch { return []; } };

// O que vem da IA veio da web: confere tipos, corta tamanhos e só aceita links https
export function validarRadar(bruto) {
  const txt = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
  const link = (v) => { try { const u = new URL(v); return u.protocol === 'https:' ? u.toString() : ''; } catch { return ''; } };
  return {
    resumo: txt(bruto?.resumo, 700),
    top3: (Array.isArray(bruto?.top3) ? bruto.top3 : [])
      .map((t) => ({ titulo: txt(t?.titulo, 120), primeiro_passo: txt(t?.primeiro_passo, 240) }))
      .filter((t) => t.titulo).slice(0, 3),
    itens: (Array.isArray(bruto?.itens) ? bruto.itens : []).map((i) => ({
      categoria: CATEGORIAS.includes(i?.categoria) ? i.categoria : 'ferramenta',
      titulo: txt(i?.titulo, 120),
      oque: txt(i?.oque, 300),
      visual: txt(i?.visual, 300),
      para_vz: txt(i?.para_vz, 300),
      esforco: ESFORCOS.includes(i?.esforco) ? i.esforco : 'medio',
      licenca: txt(i?.licenca, 80),
      data: txt(i?.data, 20),
      link: link(i?.link),
    })).filter((i) => i.titulo && i.oque).slice(0, 40),
  };
}

export function extrairJSON(texto) {
  const m = texto.match(/```json\s*([\s\S]*?)```/) || texto.match(/(\{[\s\S]*\})/);
  if (!m) throw new Error('o radar não veio em JSON');
  return JSON.parse(m[1]);
}

const pedido = (data, lista) => `Hoje é ${data}. Você é o radar de novidades da VZ Soluções em Tecnologia, software house de Jundiaí - SP.
Projetos da VZ: ContabIA (IA para contabilidade), ScanTE (coletores de dados), videoia (editor de vídeo com IA), uma influenciadora digital criada com IA para clientes, a Central da VZ (painel interno com IA por voz) e sites/sistemas sob medida. Usamos Claude Code no dia a dia e vamos alugar uma RTX 4090 para rodar modelos abertos.

Pesquise na web o que foi LANÇADO ou ganhou força nos ÚLTIMOS 7 DIAS (até ${data}) em:
1. claude: novidades do Claude, Claude Code e da API da Anthropic.
2. mcp: servidores MCP novos ou em alta (registro oficial, GitHub, anúncios).
3. skill: skills e plugins de agentes em alta (skills.sh, plugins do Claude Code).
4. modelo: modelos abertos novos de texto, imagem, vídeo e voz (diga a licença e se roda numa RTX 4090 de 24 GB).
5. ferramenta: ferramentas diárias de IA úteis para produtividade, vídeo, design e programação (diga o preço se houver).
${lista.length ? `6. perfil: o que estes perfis publicaram de relevante (só se encontrar fonte pública): ${lista.join(', ')}.` : ''}

Regras: só coisa nova de verdade e útil para a VZ; descarte boato e propaganda de curso; prefira fonte oficial; não invente links (use o link da fonte que você leu). Escreva em português do Brasil, simples.
O campo "visual" é um exemplo visual concreto: como fica na tela, um antes/depois ou o que a pessoa vê.

Responda SOMENTE com um bloco \`\`\`json neste formato:
{"resumo": "2 frases sobre a semana",
 "top3": [{"titulo": "...", "primeiro_passo": "o que fazer hoje para testar"}],
 "itens": [{"categoria": "claude|mcp|skill|modelo|ferramenta|perfil", "titulo": "...", "oque": "1 frase simples", "visual": "...", "para_vz": "qual projeto e como", "esforco": "baixo|medio|alto", "licenca": "se for modelo ou ferramenta", "data": "AAAA-MM-DD", "link": "https://..."}]}
Entre 12 e 25 itens, cobrindo todas as categorias.`;

let rodando = null;
let ultimaFalha = 0;
export const radarRodando = () => Boolean(rodando);

export function gerarRadar({ cliente, data = hoje() } = {}) {
  if (rodando) return rodando;
  rodando = (async () => {
    cliente ??= new Anthropic();
    const mensagens = [{ role: 'user', content: pedido(data, perfis()) }];
    let msg;
    for (let i = 0; i < 6; i++) { // pause_turn: a busca na web pode pausar; reenviamos para continuar
      msg = await cliente.beta.messages.stream({
        model: MODELO,
        max_tokens: 32000,
        output_config: { effort: 'medium' },
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 15 }],
        messages: mensagens,
      }).finalMessage();
      mensagens.push({ role: 'assistant', content: msg.content });
      if (msg.stop_reason !== 'pause_turn') break;
    }
    if (msg.stop_reason === 'refusal') throw new Error('o modelo recusou o pedido do radar');
    const texto = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    const radar = { data, gerado_em: new Date().toISOString(), ...validarRadar(extrairJSON(texto)) };
    if (!radar.itens.length) throw new Error('o radar veio vazio');
    fs.mkdirSync(PASTA, { recursive: true });
    const arq = path.join(PASTA, `${data}.json`);
    fs.writeFileSync(`${arq}.tmp`, JSON.stringify(radar, null, 2));
    fs.renameSync(`${arq}.tmp`, arq);
    return radar;
  })().catch((e) => { ultimaFalha = Date.now(); throw e; }).finally(() => { rodando = null; });
  return rodando;
}

// Todo dia a partir das 7h, se o PC estiver ligado: gera o radar do dia uma vez.
// Depois de uma falha, espera 3 horas antes de tentar de novo (para não gastar à toa).
export function agendarRadar({ log = console } = {}) {
  const tentar = () => {
    if (!process.env.ANTHROPIC_API_KEY || rodando || new Date().getHours() < 7 || lerRadar(hoje())) return;
    if (Date.now() - ultimaFalha < 3 * 3_600_000) return;
    log.log('Radar: pesquisando as novidades de hoje…');
    gerarRadar().then((r) => log.log(`Radar pronto: ${r.itens.length} novidades.`)).catch((e) => log.error('Radar falhou:', e.message));
  };
  setTimeout(tentar, 60_000).unref?.();
  setInterval(tentar, 30 * 60_000).unref?.();
}
