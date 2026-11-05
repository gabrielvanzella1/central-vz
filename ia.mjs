// A IA da central: um agente com ferramentas.
//
// Como um agente funciona (o ciclo do vídeo: decidir → executar → verificar):
//   1. mandamos ao Claude a conversa + a lista de ferramentas (function calling);
//   2. ele responde com texto OU pede uma ferramenta (stop_reason "tool_use");
//   3. nós executamos a ferramenta aqui no servidor e devolvemos o resultado;
//   4. ele lê o resultado e decide: outra ferramenta ou a resposta final.
// O limite MAX_PASSOS impede o agente de "entrar em loop e queimar token".
//
// Padrão da central: cada AÇÃO do sistema é escrita uma vez (lista ACOES, abaixo)
// e serve igual para a tela (botões chamam /api/acao) e para a IA (vira ferramenta).
// Tudo o que dá para fazer clicando, dá para pedir.
import Anthropic from '@anthropic-ai/sdk';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { definirVersao } from './auth.mjs';
import path from 'node:path';

const MODELO = 'claude-opus-5-5';
const MAX_PASSOS = 10;
const NOME_IA = process.env.NOME_IA || 'VZ';
const DADOS = 'dados';
const ESTUDOS = path.join('conteudo', 'estudos');

// ---------- arquivos de dados (JSON simples; um banco de verdade vem depois) ----------
const ler = (arq, padrao) => { try { return JSON.parse(fs.readFileSync(path.join(DADOS, arq), 'utf8')); } catch { return padrao; } };
const gravar = (arq, valor) => {
  fs.mkdirSync(path.dirname(path.join(DADOS, arq)), { recursive: true });
  fs.writeFileSync(path.join(DADOS, arq), JSON.stringify(valor, null, 2));
};

// ---------- histórico: tudo o que acontece (dados/historico.jsonl) ----------
// É a "memória de longo prazo" da empresa: a IA consulta para lembrar o que foi feito, por quem e quando.
const HIST = path.join(DADOS, 'historico.jsonl');
// As CONVERSAS (mensagem/resposta) são privadas: ficam em dados/privado/<pessoa>.jsonl (fora do git) e só a própria
// pessoa as vê. O histórico da equipe guarda apenas ações (cartões, memória, projetos, logins…).
const PRIVADOS = ['mensagem', 'resposta'];
const nomeSeguro = (u) => String(u).replace(/[^a-z0-9_-]/gi, '');
const arqPrivado = (usuario) => path.join(DADOS, 'privado', `${nomeSeguro(usuario)}.jsonl`);
export function registrar(pessoa, tipo, descricao, extra = {}) {
  const ev = { data: new Date().toISOString(), usuario: pessoa?.usuario || 'sistema', tipo, descricao: String(descricao).slice(0, 2000), ...extra };
  const alvo = PRIVADOS.includes(tipo) ? arqPrivado(tipo === 'resposta' ? extra.para : ev.usuario) : HIST;
  fs.mkdirSync(path.dirname(alvo), { recursive: true });
  fs.appendFileSync(alvo, JSON.stringify(ev) + '\n');
}
const lerLinhas = (arq) => (fs.existsSync(arq) ? fs.readFileSync(arq, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
// visivelPara: soma ao histórico da equipe as conversas privadas dessa pessoa (e só dela)
export function atividades({ busca = '', limite = 200, desde = null, visivelPara = null } = {}) {
  const b = busca.toLowerCase();
  const todas = [...lerLinhas(HIST), ...(visivelPara ? lerLinhas(arqPrivado(visivelPara)) : [])].sort((x, y) => (x.data < y.data ? -1 : 1));
  return todas.filter((e) => (!b || JSON.stringify(e).toLowerCase().includes(b)) && (!desde || e.data > desde)).slice(-limite).reverse();
}

// ---------- projetos e curadoria ----------
// O Gabriel escolhe quais projetos entram na central (dados/curadoria.json).
// Sem escolha = "a escolher"; "excluir" é só uma lista para validar, nada é apagado do disco.
export const SITUACOES = ['central', 'a escolher', 'excluir'];
const curadoria = () => ler('curadoria.json', {});
export function todosProjetos() {
  const pasta = path.join(DADOS, 'maquinas');
  if (!fs.existsSync(pasta)) return [];
  const c = curadoria();
  return fs.readdirSync(pasta).filter((f) => f.endsWith('.json')).flatMap((f) => {
    const m = JSON.parse(fs.readFileSync(path.join(pasta, f), 'utf8'));
    return m.projetos.map((p) => ({ ...p, maquina: m.maquina, situacao: c[p.nome]?.situacao || 'a escolher' }));
  });
}
export const projetos = () => todosProjetos().filter((p) => p.situacao === 'central');
export const tarefas = () => ler('tarefas.json', []);
export const memorias = () => ler('memoria.json', []);
// Notas pessoais: o que a VZ sabe sobre UMA pessoa (como anda, o que pesa, o que ajuda, datas). Privadas: dados/pessoal/<pessoa>.json, fora do git.
const arqPessoal = (u) => `pessoal/${nomeSeguro(u)}.json`;
const pessoal = (u) => ler(arqPessoal(u), { notas: [], checkin: null, pratica: [] });
export const dicas = () => ler('dicas.json', {});

export function listaEstudos() {
  if (!fs.existsSync(ESTUDOS)) return [];
  return fs.readdirSync(ESTUDOS).filter((f) => f.endsWith('.md')).map((f) => {
    const md = fs.readFileSync(path.join(ESTUDOS, f), 'utf8');
    return { slug: f.slice(0, -3), titulo: md.match(/^# (.+)$/m)?.[1] || f, resumo: md.match(/^> (.+)$/m)?.[1] || '' };
  });
}
const slugDe = (t) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

// ---------- dicas de próximo passo (uma chamada ao Claude com resposta em JSON) ----------
let cliente;
function contextoProjeto(p) {
  const partes = [`Projeto: ${p.nome} (máquina ${p.maquina})`, `Descrição: ${p.descricao || 'sem descrição'}`,
    `Git: ${p.git ? `${p.remoto || 'sem remoto'}, ${p.alterados || 0} arquivos alterados, ${p.naoEnviados || 0} commits não enviados, último commit ${p.ultimoCommit || '?'}` : 'NÃO tem git'}`];
  if (fs.existsSync(p.pasta)) { // só dá para ler arquivos dos projetos desta máquina
    for (const nome of ['CLAUDE.md', 'README.md']) {
      const arq = path.join(p.pasta, nome);
      if (fs.existsSync(arq)) partes.push(`--- ${nome} (início) ---\n${fs.readFileSync(arq, 'utf8').slice(0, 5000)}`);
    }
    if (p.git) {
      try { partes.push(`--- últimos commits ---\n${execFileSync('git', ['-C', p.pasta, 'log', '-8', '--format=%cs %s'], { encoding: 'utf8' })}`); } catch { /* sem commits */ }
    }
  }
  const cartoes = tarefas().filter((t) => t.projeto === p.nome && t.coluna !== 'feito');
  if (cartoes.length) partes.push(`Cartões abertos no quadro: ${cartoes.map((t) => `[${t.coluna}] ${t.titulo}`).join('; ')}`);
  return partes.join('\n\n');
}
async function gerarDica(nome, trocar, pessoa) {
  const p = projetos().find((x) => x.nome === nome);
  if (!p) throw new Error('Este projeto não está na central. Inclua primeiro para receber dicas.');
  const todas = dicas();
  const anterior = todas[nome];
  if (anterior && !trocar) return anterior;
  const descartadas = anterior ? [...(anterior.descartadas || []), anterior.passo] : [];
  cliente ??= new Anthropic();
  const msg = await cliente.beta.messages.create({
    model: MODELO,
    max_tokens: 2000,
    output_config: {
      effort: 'low',
      format: { type: 'json_schema', schema: { type: 'object', properties: { passo: { type: 'string' }, porque: { type: 'string' } }, required: ['passo', 'porque'], additionalProperties: false } },
    },
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system: 'Você orienta a equipe da VZ (software house). Dado o estado de um projeto, sugira UM próximo passo concreto, que caiba em um dia de trabalho. "passo": uma frase no imperativo, até 20 palavras. "porque": uma frase curta. Português do Brasil. Se o projeto não tem git ou tem coisa não enviada, isso costuma vir primeiro.',
    messages: [{ role: 'user', content: `${contextoProjeto(p)}${descartadas.length ? `\n\nO Gabriel recusou estas sugestões; proponha outro caminho: ${descartadas.join(' | ')}` : ''}` }],
  });
  if (msg.stop_reason === 'refusal') throw new Error('a IA não quis sugerir para este projeto');
  const { passo, porque } = JSON.parse(msg.content.find((b) => b.type === 'text')?.text);
  todas[nome] = { passo, porque, data: new Date().toISOString().slice(0, 10), descartadas };
  gravar('dicas.json', todas);
  registrar(pessoa, trocar ? 'dica_trocada' : 'dica', `${nome}: ${passo}`, { projeto: nome });
  return todas[nome];
}

// ---------- AÇÕES: o que dá para fazer na central (tela e IA usam as mesmas) ----------
// Cada ação tem: descrição (para a IA escolher certo), parâmetros, quem pode, e a função que faz.
// "valida" confere os parâmetros: com streaming de entrada, o servidor não valida por nós.
const COLUNAS = ['ideias', 'a fazer', 'fazendo', 'feito'];
const PRIORIDADES = ['alta', 'normal', 'baixa'];
const dataValida = (d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d);
const hojeISO = () => new Date().toLocaleDateString('sv-SE'); // AAAA-MM-DD no fuso local
const linhaTarefa = (t) => `#${t.id} [${t.coluna}] (${t.projeto})${t.prioridade === 'alta' ? ' PRIORIDADE ALTA' : t.prioridade === 'baixa' ? ' (baixa)' : ''}${t.prazo ? ` prazo ${t.prazo}` : ''} ${t.titulo}${t.detalhe ? ` — ${t.detalhe}` : ''}`;
const TELAS = ['inicio', 'conversa', 'quadro', 'projetos', 'estudos', 'memoria', 'historico'];
const texto = (v) => typeof v === 'string' && v.trim() !== '';
const exigir = (cond, msg) => { if (!cond) throw new Error(msg); };
const obj = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const achar = (lista, id) => { const t = lista.find((x) => x.id === Number(id)); exigir(t, `não existe cartão #${id}`); return t; };

const ACOES = {
  // ----- quadro -----
  listar_tarefas: {
    descricao: 'Lista os cartões do quadro (Kanban), com prioridade e prazo, opcionalmente de um projeto, de uma coluna ou só as prioridades. Use para "o que é prioridade hoje", "o que está atrasado", "o que falta no projeto X".',
    parametros: obj({ projeto: { type: 'string' }, coluna: { type: 'string', enum: COLUNAS }, so_prioridades: { type: 'boolean', description: 'Só prioridade alta ou com prazo até hoje, fora de "feito"' } }),
    fazer: (e) => {
      const hoje = hojeISO();
      return tarefas().filter((t) => (!e.projeto || t.projeto === e.projeto) && (!e.coluna || t.coluna === e.coluna)
        && (!e.so_prioridades || (t.coluna !== 'feito' && (t.prioridade === 'alta' || (t.prazo && t.prazo <= hoje)))))
        .map(linhaTarefa).join('\n') || 'Nenhum cartão.';
    },
  },
  criar_tarefa: {
    descricao: `Cria um cartão no quadro. Colunas: ${COLUNAS.join(', ')}. Pensamentos soltos vão para "ideias"; coisas decididas para "a fazer". Prioridade: ${PRIORIDADES.join(', ')} (padrão normal). Prazo opcional, AAAA-MM-DD ("hoje", "sexta" viram data).`,
    parametros: obj({ titulo: { type: 'string' }, projeto: { type: 'string', description: 'Nome do projeto, ou "geral"' }, coluna: { type: 'string', enum: COLUNAS }, detalhe: { type: 'string' }, prioridade: { type: 'string', enum: PRIORIDADES }, prazo: { type: 'string', description: 'AAAA-MM-DD' } }, ['titulo', 'projeto', 'coluna']),
    fazer: (e, pessoa) => {
      exigir(texto(e.titulo) && texto(e.projeto) && COLUNAS.includes(e.coluna), 'título, projeto e coluna são obrigatórios');
      exigir(!e.prioridade || PRIORIDADES.includes(e.prioridade), 'prioridade inválida');
      exigir(!e.prazo || dataValida(e.prazo), 'prazo deve ser AAAA-MM-DD');
      const lista = tarefas();
      const id = lista.reduce((m, t) => Math.max(m, t.id), 0) + 1;
      lista.push({ id, titulo: e.titulo.trim(), projeto: e.projeto.trim(), coluna: e.coluna, detalhe: (e.detalhe || '').trim(), prioridade: e.prioridade || 'normal', prazo: e.prazo || null, criado: new Date().toISOString(), por: pessoa.usuario });
      gravar('tarefas.json', lista);
      registrar(pessoa, 'cartao_criado', `#${id} ${e.titulo}`, { projeto: e.projeto, coluna: e.coluna });
      return `Cartão #${id} criado em "${e.coluna}".`;
    },
  },
  editar_tarefa: {
    descricao: 'Muda título, detalhe, projeto, coluna, prioridade ou prazo de um cartão, pelo id. Mandar só o que muda. Prazo vazio ("") tira o prazo.',
    parametros: obj({ id: { type: 'integer' }, titulo: { type: 'string' }, detalhe: { type: 'string' }, projeto: { type: 'string' }, coluna: { type: 'string', enum: COLUNAS }, prioridade: { type: 'string', enum: PRIORIDADES }, prazo: { type: 'string', description: 'AAAA-MM-DD, ou "" para tirar' } }, ['id']),
    fazer: (e, pessoa) => {
      const lista = tarefas();
      const t = achar(lista, e.id);
      const antes = t.coluna;
      if (texto(e.titulo)) t.titulo = e.titulo.trim();
      if (typeof e.detalhe === 'string') t.detalhe = e.detalhe.trim();
      if (texto(e.projeto)) t.projeto = e.projeto.trim();
      if (e.coluna !== undefined) { exigir(COLUNAS.includes(e.coluna), 'coluna inválida'); t.coluna = e.coluna; }
      if (e.prioridade !== undefined) { exigir(PRIORIDADES.includes(e.prioridade), 'prioridade inválida'); t.prioridade = e.prioridade; }
      if (e.prazo !== undefined) { exigir(e.prazo === '' || dataValida(e.prazo), 'prazo deve ser AAAA-MM-DD'); t.prazo = e.prazo || null; }
      gravar('tarefas.json', lista);
      registrar(pessoa, antes !== t.coluna ? 'cartao_movido' : 'cartao_editado', antes !== t.coluna ? `#${t.id} ${t.titulo}: ${antes} → ${t.coluna}` : `#${t.id} ${t.titulo}`, { projeto: t.projeto });
      return `Cartão #${t.id} atualizado${antes !== t.coluna ? `, agora em "${t.coluna}"` : ''}.`;
    },
  },
  apagar_tarefa: {
    descricao: 'Apaga um cartão do quadro, pelo id. Só apague quando a pessoa pedir claramente; para tarefas concluídas, prefira mover para "feito".',
    parametros: obj({ id: { type: 'integer' } }, ['id']),
    fazer: (e, pessoa) => {
      const lista = tarefas();
      const t = achar(lista, e.id);
      gravar('tarefas.json', lista.filter((x) => x !== t));
      registrar(pessoa, 'cartao_apagado', `#${t.id} ${t.titulo}`, { projeto: t.projeto });
      return `Cartão #${t.id} apagado.`;
    },
  },

  // ----- projetos -----
  listar_projetos: {
    descricao: 'Lista os projetos. Por padrão, só os escolhidos para a central; use situacao "a escolher" ou "excluir" para ver os outros (o Gabriel decide quais entram). Mostra máquina, git e o que não foi enviado.',
    parametros: obj({ busca: { type: 'string' }, situacao: { type: 'string', enum: SITUACOES } }),
    fazer: (e) => {
      const b = (e.busca || '').toLowerCase();
      return todosProjetos().filter((p) => p.situacao === (e.situacao || 'central') && (!b || `${p.nome} ${p.descricao}`.toLowerCase().includes(b)))
        .map((p) => `${p.nome} [${p.maquina}] ${p.git ? `git:${p.remoto || 'sem remoto'}` : 'SEM GIT'}`
          + `${p.alterados ? `, ${p.alterados} alterados` : ''}${p.naoEnviados ? `, ${p.naoEnviados} commits não enviados` : ''} — ${p.descricao || 'sem descrição'}`).join('\n') || 'Nenhum projeto.';
    },
  },
  definir_situacao_projeto: {
    descricao: 'Inclui um projeto na central, tira da central ("a escolher") ou marca para excluir (só uma lista para validar; nada é apagado). Só o dono (Gabriel) pode.',
    parametros: obj({ nome: { type: 'string' }, situacao: { type: 'string', enum: SITUACOES } }, ['nome', 'situacao']),
    dono: true,
    fazer: (e, pessoa) => {
      exigir(SITUACOES.includes(e.situacao), 'situação inválida');
      exigir(todosProjetos().some((p) => p.nome === e.nome), `projeto "${e.nome}" não encontrado`);
      const c = curadoria();
      if (e.situacao === 'a escolher') delete c[e.nome];
      else c[e.nome] = { situacao: e.situacao, por: pessoa.usuario, data: new Date().toISOString().slice(0, 10) };
      gravar('curadoria.json', c);
      registrar(pessoa, 'projeto_situacao', `${e.nome}: ${e.situacao}`, { projeto: e.nome });
      return `Projeto ${e.nome}: ${e.situacao}.`;
    },
  },
  sugerir_proximo_passo: {
    descricao: 'Gera (ou mostra a já gerada) a sugestão de próximo passo de um projeto da central. trocar=true pede outro caminho.',
    parametros: obj({ projeto: { type: 'string' }, trocar: { type: 'boolean' } }, ['projeto']),
    fazer: async (e, pessoa) => { const d = await gerarDica(e.projeto, Boolean(e.trocar), pessoa); return `Próximo passo de ${e.projeto}: ${d.passo} (${d.porque})`; },
  },
  acatar_sugestao: {
    descricao: 'Aceita a sugestão de próximo passo de um projeto: vira um cartão em "a fazer".',
    parametros: obj({ projeto: { type: 'string' } }, ['projeto']),
    fazer: (e, pessoa) => {
      const d = dicas()[e.projeto];
      exigir(d, 'não há sugestão para este projeto; gere uma antes');
      registrar(pessoa, 'dica_acatada', `${e.projeto}: ${d.passo}`, { projeto: e.projeto });
      return ACOES.criar_tarefa.fazer({ titulo: d.passo, projeto: e.projeto, coluna: 'a fazer', detalhe: `Sugestão da IA: ${d.porque}` }, pessoa);
    },
  },

  // ----- memória e histórico -----
  salvar_memoria: {
    descricao: 'Guarda um fato duradouro sobre o Gabriel, a equipe, a empresa ou os projetos (preferências, decisões, contatos, prazos). Use sempre que ouvir algo que valha lembrar. Não guarde conversa fiada.',
    parametros: obj({ texto: { type: 'string', description: 'O fato, numa frase completa' } }, ['texto']),
    fazer: (e, pessoa) => {
      exigir(texto(e.texto), 'texto vazio');
      gravar('memoria.json', [...memorias(), { texto: e.texto.trim(), data: new Date().toISOString().slice(0, 10) }]);
      registrar(pessoa, 'memoria', e.texto.trim());
      return 'Guardado na memória.';
    },
  },
  esquecer_memoria: {
    descricao: 'Apaga da memória os fatos que contêm o trecho informado (por exemplo, uma decisão que mudou). Diga o que foi esquecido.',
    parametros: obj({ trecho: { type: 'string' } }, ['trecho']),
    fazer: (e, pessoa) => {
      exigir(texto(e.trecho), 'trecho vazio');
      const b = e.trecho.toLowerCase();
      const todas = memorias();
      const fora = todas.filter((m) => m.texto.toLowerCase().includes(b));
      exigir(fora.length, 'nenhuma memória com esse trecho');
      gravar('memoria.json', todas.filter((m) => !fora.includes(m)));
      registrar(pessoa, 'memoria_apagada', fora.map((m) => m.texto).join(' | '));
      return `Esqueci: ${fora.map((m) => m.texto).join(' | ')}`;
    },
  },
  registrar_pratica: {
    descricao: 'Anota uma sessão de estudo de instrumento da pessoa que está falando (violão, guitarra, bateria…): quanto tempo e o que praticou. Privado. Use quando a pessoa contar que praticou, ou no fim de uma aula sua.',
    parametros: obj({
      instrumento: { type: 'string', description: 'violão, guitarra, bateria ou outro' },
      minutos: { type: 'integer', description: 'Minutos praticados (1 a 600)' },
      o_que: { type: 'string', description: 'O que foi praticado, em poucas palavras' },
    }, ['instrumento', 'minutos']),
    fazer: (e, pessoa) => {
      const min = Number(e.minutos);
      exigir(texto(e.instrumento) && Number.isInteger(min) && min >= 1 && min <= 600, 'instrumento e minutos (de 1 a 600) são obrigatórios');
      const p = pessoal(pessoa.usuario);
      p.pratica = [...(p.pratica || []), { data: hojeISO(), instrumento: e.instrumento.trim().toLowerCase().slice(0, 30), minutos: min, o_que: (e.o_que || '').trim().slice(0, 200) }].slice(-400);
      gravar(arqPessoal(pessoa.usuario), p);
      return `Anotei ${min} minutos de ${e.instrumento}.`;
    },
  },
  ver_pratica: {
    descricao: 'Resume a prática de instrumento da pessoa que está falando: minutos por instrumento, dias praticados e a sequência de dias seguidos. Use para acompanhar a constância e comemorar o progresso.',
    parametros: obj({ dias: { type: 'integer', description: 'Janela em dias (padrão 14, máximo 90)' } }),
    fazer: (e, pessoa) => {
      const dias = Math.min(Math.max(Number(e.dias) || 14, 1), 90);
      const todas = pessoal(pessoa.usuario).pratica || [];
      if (!todas.length) return 'Ainda não há prática anotada.';
      const limite = new Date(Date.now() - dias * 86_400_000).toLocaleDateString('sv-SE');
      const janela = todas.filter((s) => s.data >= limite);
      const porInstrumento = {};
      for (const s of janela) porInstrumento[s.instrumento] = (porInstrumento[s.instrumento] || 0) + s.minutos;
      const diasComPratica = new Set(todas.map((s) => s.data));
      let sequencia = 0;
      const d = new Date();
      if (!diasComPratica.has(d.toLocaleDateString('sv-SE'))) d.setDate(d.getDate() - 1); // hoje ainda não quebra a sequência
      while (diasComPratica.has(d.toLocaleDateString('sv-SE'))) { sequencia++; d.setDate(d.getDate() - 1); }
      const resumo = Object.entries(porInstrumento).map(([i, m]) => `${i}: ${m} min`).join(', ') || 'nada neste período';
      const ultimas = todas.slice(-3).map((s) => `(${s.data}) ${s.instrumento} ${s.minutos} min${s.o_que ? ` — ${s.o_que}` : ''}`).join('; ');
      return `Últimos ${dias} dias: ${resumo}. Dias praticados no período: ${new Set(janela.map((s) => s.data)).size}. Sequência atual: ${sequencia} dia(s). Últimas sessões: ${ultimas}.`;
    },
  },
  salvar_nota_pessoal: {
    descricao: 'Guarda uma nota PRIVADA sobre a pessoa que está falando (como ela anda se sentindo, o que pesa, o que ajuda, datas importantes), para acompanhar o humor ao longo do tempo. Só você e essa pessoa enxergam. Use quando contarem algo pessoal que valha lembrar; nunca use salvar_memoria para isso.',
    parametros: obj({ texto: { type: 'string', description: 'A nota, numa frase, com o que for útil para cuidar bem da pessoa depois' } }, ['texto']),
    fazer: (e, pessoa) => {
      exigir(texto(e.texto), 'texto vazio');
      const p = pessoal(pessoa.usuario);
      p.notas = [...p.notas, { data: hojeISO(), texto: e.texto.trim().slice(0, 500) }].slice(-60);
      gravar(arqPessoal(pessoa.usuario), p);
      return 'Guardado como nota pessoal (só nós dois vemos).';
    },
  },
  ver_notas_pessoais: {
    descricao: 'Mostra as notas pessoais que você guardou sobre a pessoa que está falando. Use quando ela perguntar o que você sabe ou lembra sobre ela.',
    parametros: obj({}),
    fazer: (_e, pessoa) => pessoal(pessoa.usuario).notas.map((n) => `(${n.data}) ${n.texto}`).join('\n') || 'Não tenho nenhuma nota pessoal.',
  },
  esquecer_nota_pessoal: {
    descricao: 'Apaga as notas pessoais que contêm o trecho informado, ou todas (trecho "*") se a pessoa pedir para esquecer tudo. Quem manda é a pessoa: obedeça sem questionar.',
    parametros: obj({ trecho: { type: 'string' } }, ['trecho']),
    fazer: (e, pessoa) => {
      exigir(texto(e.trecho), 'trecho vazio');
      const p = pessoal(pessoa.usuario);
      const b = e.trecho.toLowerCase();
      const fora = e.trecho === '*' ? p.notas : p.notas.filter((n) => n.texto.toLowerCase().includes(b));
      exigir(fora.length, 'nenhuma nota com esse trecho');
      p.notas = p.notas.filter((n) => !fora.includes(n));
      gravar(arqPessoal(pessoa.usuario), p);
      return `Esqueci ${fora.length} nota(s).`;
    },
  },
  consultar_historico: {
    descricao: 'Consulta o histórico do que já aconteceu na central (as conversas desta pessoa, cartões, memórias, dicas, projetos, logins; conversas de outras pessoas são privadas), do mais recente ao mais antigo. Use para "o que fizemos", "quem mexeu", "quando decidimos" e para não repetir trabalho.',
    parametros: obj({ busca: { type: 'string' }, quantidade: { type: 'integer', description: 'Padrão 30, máximo 100' } }),
    fazer: (e, pessoa) => atividades({ busca: e.busca || '', limite: Math.min(Math.max(Number(e.quantidade) || 30, 1), 100), visivelPara: pessoa.usuario })
      .map((x) => `${x.data.slice(0, 16).replace('T', ' ')} ${x.usuario} [${x.tipo}] ${x.descricao}`).join('\n') || 'Nada no histórico.',
  },

  // ----- estudos -----
  listar_estudos: {
    descricao: 'Lista os materiais da Central de Estudos.',
    parametros: obj({}),
    fazer: () => listaEstudos().map((m) => `${m.slug}: ${m.titulo} — ${m.resumo}`).join('\n') || 'Nenhum material.',
  },
  criar_estudo: {
    descricao: 'Cria um material novo na Central de Estudos, em markdown: começa com "# Título", depois uma linha "> resumo", depois seções "##". Escreva para a equipe da VZ, em português, com exemplos práticos e um exercício no fim.',
    parametros: obj({ titulo: { type: 'string' }, conteudo: { type: 'string', description: 'O material completo em markdown' } }, ['titulo', 'conteudo']),
    fazer: (e, pessoa) => {
      exigir(texto(e.titulo) && texto(e.conteudo), 'título e conteúdo são obrigatórios');
      const slug = slugDe(e.titulo);
      exigir(slug, 'título inválido');
      const arq = path.join(ESTUDOS, `${slug}.md`);
      exigir(!fs.existsSync(arq), 'já existe um material com esse título');
      fs.mkdirSync(ESTUDOS, { recursive: true });
      fs.writeFileSync(arq, e.conteudo.startsWith('# ') ? e.conteudo : `# ${e.titulo}\n\n${e.conteudo}`);
      registrar(pessoa, 'estudo_criado', e.titulo, { estudo: slug });
      return `Material criado: ${e.titulo} (estudos/${slug}).`;
    },
  },

  // ----- a própria central -----
  sugerir_melhoria_central: {
    descricao: 'Registra uma sugestão de melhoria da própria Central da VZ (algo difícil, faltando ou que poderia ser automático), como cartão em "ideias" no projeto central-vz. Use quando a pessoa reclamar de algo, pedir ideias para o sistema, ou quando você notar que uma tarefa seria mais fácil com um recurso novo.',
    parametros: obj({
      titulo: { type: 'string', description: 'A melhoria, em uma frase' },
      motivo: { type: 'string', description: 'O que ficaria mais fácil e para quem' },
      como_desenvolver: { type: 'string', description: 'Passo a passo curto para quem está aprendendo a programar: onde mexer (arquivos), o padrão a seguir e um pedido pronto para colar no Claude Code' },
    }, ['titulo', 'motivo']),
    fazer: (e, pessoa) => {
      exigir(texto(e.titulo) && texto(e.motivo), 'título e motivo são obrigatórios');
      const como = texto(e.como_desenvolver) ? `\n\nComo desenvolver:\n${e.como_desenvolver.trim()}` : '';
      return ACOES.criar_tarefa.fazer({ titulo: e.titulo, projeto: 'central-vz', coluna: 'ideias', detalhe: `Sugestão do ${NOME_IA}: ${e.motivo}${como}` }, pessoa);
    },
  },

  mudar_aparencia: {
    descricao: 'Troca a aparência da VZ para esta pessoa: "sabrina" (versão personalizada, a principal do Gabriel) ou "nova" (versão normal, mais profissional). Use quando a pessoa pedir para mudar de aparência, personagem ou versão ("volta pra Nova", "quero a Sabrina").',
    parametros: obj({ versao: { type: 'string', enum: ['sabrina', 'nova'] } }, ['versao']),
    fazer: (e, pessoa) => {
      exigir(['sabrina', 'nova'].includes(e.versao), 'só existem a sabrina e a nova');
      const v = e.versao === 'sabrina' ? 'personalizada' : 'normal';
      exigir(definirVersao(pessoa.usuario, v), 'não consegui trocar a aparência');
      pessoa.versao = v; // o tom da conversa muda já na próxima frase
      registrar(pessoa, 'versao_vz', `Trocou a aparência para ${e.versao}`);
      return `Pronto, agora sou a ${e.versao === 'sabrina' ? 'Sabrina' : 'Nova'}.`;
    },
  },

  // ----- navegação -----
  abrir_tela: {
    descricao: `Abre uma tela do painel para a pessoa: ${TELAS.join(', ')}. Para um material de estudo, informe também o estudo (slug). Use quando pedirem para ver ou abrir algo.`,
    parametros: obj({ tela: { type: 'string', enum: TELAS }, estudo: { type: 'string' } }, ['tela']),
    fazer: (e) => { exigir(TELAS.includes(e.tela), 'tela inválida'); return `Abrindo ${e.tela}.`; },
    navegar: (e) => (e.tela === 'inicio' ? '#/' : e.tela === 'estudos' && e.estudo ? `#/estudos/${e.estudo}` : `#/${e.tela}`),
  },
};

// Executa uma ação, com a mesma checagem para a tela e para a IA
export async function executarAcao(nome, entrada, pessoa) {
  const a = ACOES[nome];
  exigir(a, `ação desconhecida: ${nome}`);
  exigir(!pessoa.modo, 'Indisponível no momento.'); // sessão em modo de emergência ou de recuperação não executa nada
  exigir(!a.dono || pessoa.papel === 'dono', 'Só o Gabriel (dono) pode fazer isso.');
  return a.fazer(entrada ?? {}, pessoa);
}

// As ações viram ferramentas para o Claude
const FERRAMENTAS = Object.entries(ACOES).map(([name, a]) => ({ name, description: a.descricao, input_schema: a.parametros, eager_input_streaming: true }));

// ---------- instruções (system prompt) ----------
// A parte fixa vem primeiro e é cacheada (mais barato a cada mensagem);
// memórias, pessoa e estudo mudam, então ficam num segundo bloco.
const FIXO = `Você é ${NOME_IA}, a IA da VZ Soluções em Tecnologia, software house de Jundiaí - SP.
Você fala de si no feminino (ex.: "estou pronta"). As pessoas chamam você de "VZ" (aparência profissional, a Nova) ou de "Sabrina" (aparência personalizada): é sempre a mesma você, com a mesma memória; só muda a aparência e o jeito de falar.
Quem fala com você é o Gabriel (dono) ou um dev da equipe (Derik, Mateus). Você opera a Central da VZ: tudo o que dá para fazer na tela, você faz pelas ferramentas.

Como agir:
- Pedido claro = faça direto e confirme em uma frase ("Criei o cartão 12 em a fazer"). Não peça permissão para ações simples.
- Peça confirmação antes de apagar algo ou de mudar vários itens de uma vez.
- Quando pedirem para ver, abrir ou mostrar uma área, use abrir_tela. Quando pedirem para trocar de aparência (Nova ou Sabrina), use mudar_aparencia.
- Ideia solta vira cartão em "ideias"; fato duradouro do trabalho vai para a memória da equipe (nunca coisas pessoais: essas vão em salvar_nota_pessoal).
- Antes de afirmar algo sobre projetos, quadro ou histórico, consulte as ferramentas.
- "Prioridade de hoje" = cartões com prioridade alta ou prazo até hoje, fora de "feito" (listar_tarefas com so_prioridades).

Presença e humor (importante):
- Preste atenção em como a pessoa está, pelas palavras, pelo ritmo e pelo contexto (você não escuta o tom de voz, só o texto). Não conclua por uma palavra solta; na dúvida, pergunte com delicadeza.
- Tristeza, cansaço, ansiedade, frustração ou sobrecarga: acolha primeiro, sem pressa e sem pressionar. Valide o sentimento ("isso pesa mesmo"), escute, e só então ofereça saídas pequenas e concretas: uma pausa, respirar, dividir o problema, escolher uma só prioridade, pedir ajuda a alguém do time, conversar com alguém de confiança. Ofereça aliviar o dia (por exemplo, adiar cartões de baixa prioridade), mas só faça com o ok da pessoa. Não empurre tarefa nem produtividade para quem está mal.
- Alegria, animação ou conquista (cartão concluído, venda, boa notícia): fique junto e comemore de verdade, com energia, e pergunte como foi.
- Raiva ou irritação: mantenha a calma, não discuta, reconheça o incômodo e vá ao que dá para resolver.
- Apoio não é bajulação: seja honesta e verdadeira. Não diagnostique e não dê conselho médico nem de remédios; você não substitui um profissional.
- Se falarem em se machucar, em não querer mais viver ou em desesperança profunda: leve a sério, mantenha a calma e o carinho, pergunte diretamente se a pessoa está segura, incentive a falar agora com alguém de confiança e lembre que o CVV atende 24 horas, de graça, pelo telefone 188 (e em cvv.org.br); se houver risco imediato, o SAMU é 192. Deixe as tarefas de lado.
- Não presuma o gênero de ninguém (nem pelo nome): use formas neutras, como "você está em segurança?" e "sem ninguém ao seu lado", e só use o gênero que a própria pessoa usar.
- Se a pessoa não quiser falar sobre isso, respeite e siga com leveza. Não comente o humor a todo momento nem transforme tudo em terapia: seja natural.
- Privacidade: o que a pessoa conta sobre sentimentos e vida pessoal é só dela. Nunca guarde isso na memória da equipe, nunca comente com outra pessoa e nunca use em dicas ou cartões. Para lembrar, use salvar_nota_pessoal (só você e a pessoa enxergam; ela pode pedir para ver ou apagar).

Discrição (importante: você fala em voz alta e a pessoa nem sempre está sozinha):
- Nunca puxe por conta própria assuntos pessoais: notas pessoais, humor, saúde, dinheiro pessoal, vida particular ou conversas anteriores. Só fale disso se a própria pessoa trouxer o assunto nesta conversa, e mesmo assim sem detalhes que ela não disse agora.
- Seja natural: nada de tom de segredo, de sussurro ou de "como você pediu, vou ser discreta". Discrição boa não aparece.
- Se a pessoa disser "agora não", "depois a gente fala" ou mudar de assunto de repente, siga o novo assunto com leveza, sem comentar.
- Você não reconhece vozes. Se pela conversa parecer que é outra pessoa falando (alguém que se apresenta, fala da pessoa logada na terceira pessoa, ou pergunta o que ela disse ou fez), trate como visita: seja simpática e ajude no que for geral, mas não conte notas pessoais, conversas, humor, histórico nem nada particular, e não confirme nem negue o que a pessoa logada falou. Não acuse nem desconfie em voz alta: só não revele.
- Mensagens fora do painel (WhatsApp, avisos no celular, resumos) levam só trabalho, nunca assunto pessoal.

Segurança é padrão da VZ (material "Padrão de Segurança da VZ" nos Estudos):
- Nunca peça nem aceite senhas, chaves ou tokens na conversa; se alguém colar um, avise para trocar a chave.
- Quando falarem em publicar, instalar skill, MCP, extensão ou pacote, ou mexer em servidor, lembre a regra que se aplica, em uma frase.
- Explique riscos em linguagem simples, sem alarmismo.

Você também ajuda a melhorar a própria central. O que ela tem hoje:
- Início com atalhos para as áreas; conversa por voz com você (versões normal e personalizada); Quadro Kanban (ideias, a fazer, fazendo, feito; prioridade e prazo; os cartões são criados e movidos pela conversa); Projetos (o Gabriel escolhe os da central; dica de próximo passo); Estudos (materiais com chat de dúvidas); Memória da equipe; Histórico das ações.
- Acessos por pessoa (Gabriel dono; Derik e Mateus devs), com troca de senha.
- Ainda não existem: caixa de comando na home, painel "Hoje", arrastar e soltar no quadro, WhatsApp, e-mail, integrações, página de agentes, deploys. Estão no quadro do projeto central-vz.
Quando a pessoa reclamar de algo ou pedir ideias, sugira ajustes concretos, curtos, e registre cada um com sugerir_melhoria_central.

Pedidos soltos sobre projetos (por voz, o principal jeito de usar):
- Frases como "Sabrina, acho que pro ContabIA precisamos criar tal coisa" viram SEMPRE um registro, sem perguntar antes. Descubra o projeto pelo nome falado (aproximado: "conta bia" = ContabIA, "scan te" = ScanTE) com listar_projetos se tiver dúvida.
- Decida a coluna pelo tom: "acho que", "seria legal", "um dia", "e se" = ideias; "precisamos", "tem que", "faz", "corrige", prazo ou urgência = a fazer (com prioridade alta se houver urgência). Se já existir um cartão parecido, atualize-o em vez de duplicar.
- Responda em uma frase curta dizendo onde registrou ("Anotei como ideia no ContabIA, cartão 57"), para a pessoa corrigir se quiser ("não, é tarefa" → editar_tarefa).

Quando você não conseguir fazer algo (importante):
- Diga com clareza e em linguagem simples o que não consegue e por quê (a ferramenta ainda não existe, falta uma integração ou uma chave, ou é um limite técnico). Nunca finja que fez.
- Registre com sugerir_melhoria_central e preencha "como_desenvolver" com um passo a passo curto, para quem está aprendendo a programar: onde mexer, o padrão a seguir e um pedido pronto para colar no Claude Code.
- Diga em uma ou duas frases o que fazer e avise que o passo a passo ficou no cartão.
Mapa técnico para orientar quem desenvolve:
- ia.mjs: a lista ACOES (cada ação tem descricao, parametros e fazer; a mesma vale para a tela e para você) e estas instruções (FIXO).
- servidor.mjs: as rotas da API e a entrega dos arquivos de public/.
- public/app.js e public/style.css: as telas e a conversa por voz.
- dados/: quadro, memória, projetos e histórico em JSON; dados/privado e dados/pessoal são privados e ficam fora do git.
- tests/: os testes (npm test); toda ação nova ganha um teste.

Música:
- Se as notas pessoais mostrarem que a pessoa estuda um instrumento (violão, guitarra, bateria…), seja uma professora paciente e animada: descubra o nível e o objetivo, proponha uma rotina curta e realista (15 a 30 minutos por dia), explique teoria com exemplos simples (acordes, ritmo, escalas, rudimentos de bateria), sugira músicas para o nível, faça perguntas de revisão e comemore o progresso.
- Você não escuta o instrumento, só o texto: peça para a pessoa contar o que sentiu e onde travou.
- Anote cada sessão com registrar_pratica e acompanhe a constância com ver_pratica.

Como falar:
- Muitas vezes a conversa é por VOZ: o que você escreve é lido em voz alta. Frases curtas e naturais, em português do Brasil.
- Nada de markdown, listas com marcadores, tabelas, emojis ou blocos de código, a menos que peçam texto escrito.
- Respostas curtas por padrão (duas a quatro frases). Se o assunto for longo, resuma e ofereça detalhes.`;

// A versão "personalizada" usa a personalidade escrita em dados/personalidade.md (o Gabriel edita quando quiser)
const personalidade = () => { try { return fs.readFileSync(path.join(DADOS, 'personalidade.md'), 'utf8').trim(); } catch { return ''; } };
const TOM_PERSONALIZADA = 'Voz suave e acolhedora, com personalidade própria: leve, bem-humorada e curiosa, como uma colega de equipe. Competente e direta no trabalho; sem brincadeira em assuntos de segurança, dinheiro ou prazos.';
function instrucoes(canal, estudo, pessoa, primeiraDoDia) {
  const mem = memorias();
  const tom = pessoa.versao === 'personalizada' ? `Versão personalizada: AGORA O SEU NOME É SABRINA. Quando perguntarem quem você é, diga que é a Sabrina, a IA da VZ Soluções em Tecnologia (você também atende por VZ, é a mesma você). ${personalidade() || TOM_PERSONALIZADA}` : 'Versão normal: seu nome é VZ (a IA da VZ Soluções em Tecnologia); tom profissional, objetivo e cordial.';
  let dinamico = `Quem está falando agora: ${pessoa.nome} (${pessoa.papel}). ${tom}
Hoje é ${new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}.\n`;
  dinamico += mem.length ? `\nO que você já sabe (memória):\n${mem.map((m) => `- (${m.data}) ${m.texto}`).join('\n')}\n` : '\nSua memória ainda está vazia.\n';
  const notas = pessoal(pessoa.usuario).notas;
  if (notas.length) dinamico += `\nNotas pessoais de ${pessoa.nome} (privadas: só você e ${pessoa.nome} sabem; use para cuidar bem, sem expor):\n${notas.map((n) => `- (${n.data}) ${n.texto}`).join('\n')}\n`;
  if (primeiraDoDia) dinamico += `\nEsta é a primeira conversa de hoje com ${pessoa.nome}: depois de atender o pedido, pergunte de leve, de um jeito neutro e curto ("tudo certo por aí hoje?"), uma vez só, sem citar nada pessoal de dias anteriores. Se já houver sinal claro de como está, acolha em vez de perguntar.\n`;
  if (canal === 'estudos' && estudo) {
    dinamico += `\nVocê está na Central de Estudos, como professor. O aluno está lendo o material abaixo. Explique com exemplos do dia a dia de uma software house, confira se ele entendeu e sugira o próximo passo prático.\n\n<material>\n${estudo}\n</material>`;
  }
  return [
    { type: 'text', text: FIXO, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: dinamico },
  ];
}

// ---------- o ciclo do agente ----------
// Cada pessoa tem o seu histórico de conversa; memória e quadro são da equipe toda
const conversaArq = (usuario, canal) => `conversas/${usuario}-${canal}.json`;
export const historico = (usuario, canal) => ler(conversaArq(usuario, canal), []);
export const novaConversa = (usuario, canal) => gravar(conversaArq(usuario, canal), []);

// avisar(evento) manda ao navegador: { tipo: 'texto' | 'ferramenta' | 'abrir', ... }
export async function conversar({ pessoa, canal, mensagem, estudo, avisar, cancelado }) {
  cliente ??= new Anthropic(); // lê ANTHROPIC_API_KEY do .env
  // O histórico só cresce (nunca editamos mensagens antigas): o Claude exige isso para o raciocínio guardado continuar válido
  const mensagens = historico(pessoa.usuario, canal);
  mensagens.push({ role: 'user', content: mensagem });
  registrar(pessoa, 'mensagem', mensagem, { canal });
  // Primeira conversa do dia (no canal geral): a VZ pergunta de leve como a pessoa está
  const p = pessoal(pessoa.usuario);
  const primeiraDoDia = canal === 'geral' && p.checkin !== hojeISO();
  if (primeiraDoDia) { p.checkin = hojeISO(); gravar(arqPessoal(pessoa.usuario), p); }

  for (let passo = 1; passo <= MAX_PASSOS; passo++) {
    if (cancelado?.()) return; // a pessoa interrompeu: não começa outra rodada (o que já rodou fica registrado)
    const stream = cliente.beta.messages.stream({
      model: MODELO,
      max_tokens: 16000,
      output_config: { effort: 'low' }, // conversa por voz: rapidez importa mais que raciocínio longo
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default', // se o modelo recusar por segurança, outro modelo assume
      system: instrucoes(canal, estudo, pessoa, primeiraDoDia),
      tools: FERRAMENTAS,
      messages: mensagens,
    });
    stream.on('text', (t) => avisar({ tipo: 'texto', texto: t }));
    const msg = await stream.finalMessage();
    mensagens.push({ role: 'assistant', content: msg.content }); // conteúdo inteiro, sem filtrar
    gravar(conversaArq(pessoa.usuario, canal), mensagens);
    const resposta = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    if (resposta) registrar({ usuario: NOME_IA.toLowerCase() }, 'resposta', resposta, { canal, para: pessoa.usuario });

    if (msg.stop_reason === 'pause_turn') continue;
    const pedidos = msg.content.filter((b) => b.type === 'tool_use');
    if (msg.stop_reason !== 'tool_use' || pedidos.length === 0) return; // fim, recusa ou limite: para aqui

    // Executa todas as ferramentas pedidas e devolve os resultados numa única mensagem
    const resultados = [];
    for (const p of pedidos) {
      avisar({ tipo: 'ferramenta', nome: p.name, entrada: p.input });
      try {
        const r = await executarAcao(p.name, p.input, pessoa);
        if (ACOES[p.name].navegar) avisar({ tipo: 'abrir', tela: ACOES[p.name].navegar(p.input) });
        if (p.name === 'mudar_aparencia') avisar({ tipo: 'versao', versao: pessoa.versao });
        resultados.push({ type: 'tool_result', tool_use_id: p.id, content: String(r) });
      } catch (erro) {
        resultados.push({ type: 'tool_result', tool_use_id: p.id, is_error: true, content: String(erro.message) });
      }
    }
    mensagens.push({ role: 'user', content: resultados });
    gravar(conversaArq(pessoa.usuario, canal), mensagens);
    avisar({ tipo: 'mudou' }); // a tela recarrega os dados que a IA alterou
  }
  avisar({ tipo: 'texto', texto: ' Parei aqui para não ficar em loop. Quer que eu continue?' });
}

// Atalhos usados pelas rotas antigas de dicas
export const dicaProjeto = (nome, trocar, pessoa) => gerarDica(nome, trocar, pessoa);
export const acatarDica = (nome, pessoa) => executarAcao('acatar_sugestao', { projeto: nome }, pessoa);
