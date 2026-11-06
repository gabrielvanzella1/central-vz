// Testes das ações da VZ (quadro, projetos, memória, privacidade). Rodam numa pasta temporária: nunca tocam em dados/ de verdade.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const raiz = process.cwd();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'central-teste-'));
let ia, auth;
const dono = { usuario: 'tdono', nome: 'Dono', papel: 'dono', versao: 'normal' };
const dev = { usuario: 'tdev', nome: 'Dev', papel: 'dev', versao: 'normal' };

before(async () => {
  process.chdir(tmp); // dados/ vira a pasta temporária
  ia = await import(pathToFileURL(path.join(raiz, 'ia.mjs')).href);
  auth = await import(pathToFileURL(path.join(raiz, 'auth.mjs')).href);
});
after(() => { process.chdir(raiz); fs.rmSync(tmp, { recursive: true, force: true }); });

test('criar_tarefa cria o cartão com padrões', async () => {
  const msg = await ia.executarAcao('criar_tarefa', { titulo: 'Testar', projeto: 'geral', coluna: 'ideias' }, dono);
  assert.match(msg, /criada/);
  const [t] = ia.tarefas();
  assert.equal(t.titulo, 'Testar');
  assert.equal(t.prioridade, 'normal');
  assert.equal(t.prazo, null);
});

test('criar_tarefa recusa coluna e prazo inválidos', async () => {
  await assert.rejects(ia.executarAcao('criar_tarefa', { titulo: 'x', projeto: 'geral', coluna: 'inexistente' }, dono), /obrigat/);
  await assert.rejects(ia.executarAcao('criar_tarefa', { titulo: 'x', projeto: 'geral', coluna: 'ideias', prazo: 'amanha' }, dono), /AAAA-MM-DD/);
  await assert.rejects(ia.executarAcao('criar_tarefa', { titulo: 'x', projeto: 'geral', coluna: 'ideias', prioridade: 'urgentissima' }, dono), /prioridade/);
});

test('editar_tarefa move de coluna e registra no histórico da equipe', async () => {
  const id = ia.tarefas()[0].id;
  await ia.executarAcao('editar_tarefa', { id, coluna: 'fazendo', prioridade: 'alta', prazo: '2030-01-31' }, dono);
  const t = ia.tarefas().find((x) => x.id === id);
  assert.equal(t.coluna, 'fazendo');
  assert.equal(t.prioridade, 'alta');
  assert.equal(t.prazo, '2030-01-31');
  assert.ok(ia.atividades({}).some((e) => e.tipo === 'cartao_movido'));
});

test('apagar_tarefa remove só o cartão pedido', async () => {
  await ia.executarAcao('criar_tarefa', { titulo: 'Outro', projeto: 'geral', coluna: 'a fazer' }, dono);
  const antes = ia.tarefas().length;
  const id = ia.tarefas().at(-1).id;
  await ia.executarAcao('apagar_tarefa', { id }, dono);
  assert.equal(ia.tarefas().length, antes - 1);
  await assert.rejects(ia.executarAcao('apagar_tarefa', { id: 999 }, dono), /não existe/);
});

test('só o dono escolhe os projetos da central', async () => {
  await assert.rejects(ia.executarAcao('definir_situacao_projeto', { nome: 'x', situacao: 'central' }, dev), /dono/);
});

test('ação desconhecida é recusada', async () => {
  await assert.rejects(ia.executarAcao('apagar_tudo', {}, dono), /desconhecida/);
});

test('conversas são privadas: não vão para o histórico da equipe', () => {
  ia.registrar(dono, 'mensagem', 'texto bem pessoal', { canal: 'geral' });
  ia.registrar({ usuario: 'vz' }, 'resposta', 'resposta pessoal', { canal: 'geral', para: dono.usuario });
  const equipe = JSON.stringify(ia.atividades({}));
  assert.ok(!equipe.includes('texto bem pessoal') && !equipe.includes('resposta pessoal'), 'conversa vazou para a equipe');
  const dele = JSON.stringify(ia.atividades({ visivelPara: dono.usuario }));
  assert.ok(dele.includes('texto bem pessoal') && dele.includes('resposta pessoal'));
  const deOutro = JSON.stringify(ia.atividades({ visivelPara: dev.usuario }));
  assert.ok(!deOutro.includes('texto bem pessoal'), 'outra pessoa viu a conversa');
});

test('notas pessoais: guardar, ver e esquecer, sem passar pela memória da equipe', async () => {
  await ia.executarAcao('salvar_nota_pessoal', { texto: 'anda cansado esta semana' }, dono);
  assert.match(await ia.executarAcao('ver_notas_pessoais', {}, dono), /cansado/);
  assert.equal(ia.memorias().length, 0, 'nota pessoal foi parar na memória da equipe');
  assert.match(await ia.executarAcao('ver_notas_pessoais', {}, dev), /Não tenho/);
  await ia.executarAcao('esquecer_nota_pessoal', { trecho: '*' }, dono);
  assert.match(await ia.executarAcao('ver_notas_pessoais', {}, dono), /Não tenho/);
});

test('mudar_aparencia troca a versão da pessoa', async () => {
  auth.criarUsuario({ usuario: dono.usuario, nome: 'Dono', papel: 'dono' });
  await ia.executarAcao('mudar_aparencia', { versao: 'sabrina' }, dono);
  assert.equal(dono.versao, 'personalizada');
  await ia.executarAcao('mudar_aparencia', { versao: 'nova' }, dono);
  assert.equal(dono.versao, 'normal');
  await assert.rejects(ia.executarAcao('mudar_aparencia', { versao: 'luna' }, dono), /sabrina/);
});

test('registrar_pratica e ver_pratica acompanham a prática (privada)', async () => {
  await assert.rejects(ia.executarAcao('registrar_pratica', { instrumento: 'violão', minutos: 0 }, dono), /obrigat/);
  await assert.rejects(ia.executarAcao('registrar_pratica', { instrumento: 'violão', minutos: 9999 }, dono), /obrigat/);
  assert.match(await ia.executarAcao('registrar_pratica', { instrumento: 'Violão', minutos: 20, o_que: 'acordes' }, dono), /20 minutos/);
  await ia.executarAcao('registrar_pratica', { instrumento: 'bateria', minutos: 15 }, dono);
  const r = await ia.executarAcao('ver_pratica', {}, dono);
  assert.match(r, /violão: 20 min/);
  assert.match(r, /bateria: 15 min/);
  assert.match(r, /Sequência atual: 1 dia/);
  assert.match(await ia.executarAcao('ver_pratica', {}, dev), /Ainda não há/);
});

test('sugerir_melhoria_central guarda o passo a passo no cartão', async () => {
  await ia.executarAcao('sugerir_melhoria_central', { titulo: 'Receber áudio do celular', motivo: 'falar de qualquer lugar', como_desenvolver: '1. Abra ia.mjs' }, dono);
  const t = ia.tarefas().at(-1);
  assert.equal(t.projeto, 'central-vz');
  assert.equal(t.coluna, 'ideias');
  assert.match(t.detalhe, /Como desenvolver:\n1\. Abra ia\.mjs/);
});

test('tarefa com dono: passar, liberar, pegar, terminar, aprovar e devolver', async () => {
  auth.criarUsuario({ usuario: dev.usuario, nome: 'Dev', papel: 'dev' });
  await ia.executarAcao('criar_tarefa', { titulo: 'Tela de login', projeto: 'scante', coluna: 'a fazer', para: 'ninguem' }, dono);
  const id = ia.tarefas().at(-1).id;
  // dev não pega o que não foi liberado, nem passa tarefa para os outros
  await assert.rejects(ia.executarAcao('pegar_tarefa', { id }, dev), /liberada/);
  await assert.rejects(ia.executarAcao('passar_tarefa', { id, para: dev.usuario }, dev), /dono/);
  await ia.executarAcao('passar_tarefa', { id, liberar: true }, dono);
  assert.match(await ia.executarAcao('pegar_tarefa', { id }, dev), /com você/);
  let t = ia.tarefas().find((x) => x.id === id);
  assert.equal(t.responsavel, dev.usuario);
  assert.equal(t.coluna, 'fazendo');
  // dev não marca como pronto: termina e vai para o dono aprovar
  await assert.rejects(ia.executarAcao('editar_tarefa', { id, coluna: 'feito' }, dev), /aprovar/);
  assert.match(await ia.executarAcao('concluir_tarefa', { id, nota: 'feito com testes' }, dev), /aprovar/);
  assert.equal(ia.tarefas().find((x) => x.id === id).coluna, 'aprovar');
  await assert.rejects(ia.executarAcao('aprovar_tarefa', { id }, dev), /dono/);
  await ia.executarAcao('devolver_tarefa', { id, motivo: 'falta o botão sair' }, dono);
  t = ia.tarefas().find((x) => x.id === id);
  assert.equal(t.coluna, 'fazendo');
  assert.equal(t.responsavel, dev.usuario);
  await ia.executarAcao('concluir_tarefa', { id }, dev);
  await ia.executarAcao('aprovar_tarefa', { id }, dono);
  t = ia.tarefas().find((x) => x.id === id);
  assert.equal(t.coluna, 'feito');
  const linha = t.linha.map((l) => l.texto).join(' | ');
  assert.match(linha, /liberou.*pegou.*terminou: feito com testes.*devolveu: falta o botão sair.*aprovou/);
});

test('dev só mexe nas tarefas que estão com ele', async () => {
  await ia.executarAcao('criar_tarefa', { titulo: 'Do Gabriel', projeto: 'geral', coluna: 'a fazer' }, dono);
  const id = ia.tarefas().at(-1).id;
  await assert.rejects(ia.executarAcao('editar_tarefa', { id, titulo: 'mudei' }, dev), /não está com você/);
  await assert.rejects(ia.executarAcao('concluir_tarefa', { id }, dev), /não está com você/);
  await ia.executarAcao('passar_tarefa', { id, para: 'agente' }, dono);
  assert.match(await ia.executarAcao('listar_tarefas', { com: 'agente' }, dono), /Do Gabriel/);
});
