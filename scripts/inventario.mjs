// Levanta os projetos desta máquina e grava em dados/maquinas/<nome-do-pc>.json.
// Cada computador (trabalho, casa, Derik, Mateus) roda isto; a central junta os arquivos.
// Uso: npm run inventario            (pasta padrão: C:\xampp\htdocs)
//      npm run inventario -- D:\projetos
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const raiz = process.argv[2] || process.env.PASTA_PROJETOS || 'C:\\xampp\\htdocs';
const saida = path.join('dados', 'maquinas', `${os.hostname()}.json`);

const git = (pasta, ...args) => {
  try { return execFileSync('git', ['-C', pasta, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { return null; }
};

// Primeira linha útil do README ou do CLAUDE.md, para a IA saber do que se trata
function descricao(pasta) {
  for (const nome of ['README.md', 'CLAUDE.md']) {
    const arq = path.join(pasta, nome);
    if (!fs.existsSync(arq)) continue;
    const linhas = fs.readFileSync(arq, 'utf8').split('\n').map((l) => l.trim());
    const titulo = linhas.find((l) => l.startsWith('# '))?.slice(2);
    const texto = linhas.find((l) => l && !l.startsWith('#') && !l.startsWith('<') && !l.startsWith('!['));
    return [titulo, texto].filter(Boolean).join(': ').replace(/<[^>]+>|\*\*|__|`/g, '').slice(0, 300);
  }
  return '';
}

const projetos = fs.readdirSync(raiz, { withFileTypes: true })
  .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
  .map((d) => {
    const pasta = path.join(raiz, d.name);
    const temGit = fs.existsSync(path.join(pasta, '.git'));
    const remoto = temGit ? git(pasta, 'remote', 'get-url', 'origin') : null;
    const alterados = temGit ? (git(pasta, 'status', '--porcelain') || '').split('\n').filter(Boolean).length : null;
    const naoEnviados = temGit ? Number(git(pasta, 'rev-list', '--count', '@{u}..HEAD') ?? NaN) : null;
    return {
      nome: d.name,
      pasta,
      descricao: descricao(pasta),
      git: temGit,
      remoto: remoto?.replace(/^https:\/\/([^@]+@)?github\.com\//, '').replace(/\.git$/, '') || null,
      alterados,
      naoEnviados: Number.isNaN(naoEnviados) ? null : naoEnviados,
      ultimoCommit: temGit ? git(pasta, 'log', '-1', '--format=%cs') : null,
    };
  });

fs.mkdirSync(path.dirname(saida), { recursive: true });
fs.writeFileSync(saida, JSON.stringify({ maquina: os.hostname(), atualizado: new Date().toISOString(), raiz, projetos }, null, 2));
const semGit = projetos.filter((p) => !p.git).length;
const pendentes = projetos.filter((p) => p.alterados || p.naoEnviados).length;
console.log(`${projetos.length} projetos em ${raiz} → ${saida} (${semGit} sem git, ${pendentes} com coisa não enviada)`);
