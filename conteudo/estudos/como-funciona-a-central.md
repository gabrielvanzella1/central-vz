# Como a Central da VZ funciona por dentro

> O caminho de uma frase sua: do microfone até a IA, as ferramentas, a memória e a voz de volta.

## O caminho de uma mensagem

1. **Você fala.** O navegador (Chrome ou Edge) transforma a voz em texto com o reconhecimento de fala que já vem nele.
2. **O painel envia o texto** para o servidor da central (`servidor.mjs`), que roda só no seu computador.
3. **O servidor chama o Claude** (`ia.mjs`) com:
   - as instruções de quem a IA é e como deve falar;
   - a memória (fatos que ela guardou);
   - o histórico da conversa;
   - a lista de ferramentas.
4. **O Claude responde aos pedaços** (streaming). Cada pedaço chega ao navegador na hora.
5. **O navegador fala** cada frase assim que ela termina, sem esperar a resposta inteira. Por isso a conversa parece natural.
6. Se a IA precisar de uma **ferramenta** (criar cartão, ver projetos, guardar memória), o servidor executa e devolve o resultado, e ela continua.
7. Quando ela termina de falar, o microfone **volta a ouvir**. Se você começar a falar enquanto ela fala, ela para.

## Onde fica cada coisa

| Arquivo | O que faz |
|---|---|
| `servidor.mjs` | Entrega o painel e a API; só aceita conexões desta máquina |
| `ia.mjs` | O agente: instruções, ferramentas e o ciclo decidir → executar → verificar |
| `public/` | O painel: home, conversa, estudos, projetos e quadro |
| `dados/maquinas/*.json` | Os projetos de cada computador (gerado por `npm run inventario`) |
| `dados/memoria.json` | O que a IA lembra |
| `dados/tarefas.json` | Os cartões do quadro |
| `conteudo/estudos/*.md` | Os materiais desta Central de Estudos |

## Memória: como a IA "lembra"

O modelo não guarda nada entre conversas. A memória é um truque de engenharia:

1. A IA tem uma ferramenta, `salvar_memoria`, e é instruída a usá-la quando ouvir algo importante.
2. Os fatos ficam em `dados/memoria.json`.
3. Em **toda** mensagem, o servidor coloca esses fatos nas instruções.

Ou seja: lembrar = **anotar com uma ferramenta** e **reler a cada conversa**.

## Por que a conversa é barata

As instruções fixas vão marcadas para **cache**: a Anthropic guarda essa parte e cobra cerca de 10% dela nas mensagens seguintes. O que muda (data, memória, material de estudo) vai num bloco separado, depois.

## Próximos passos da central

- Quadro Kanban visual, com arrastar e soltar;
- Contas separadas para o Gabriel, o Derik e o Mateus;
- Avisos e aprovações pelo WhatsApp;
- Sincronização automática entre os computadores;
- Voz personalizada.

## Exercício

Adicione uma ferramenta nova ao `ia.mjs`: `contar_tarefas`, que diz quantos cartões há em cada coluna. Você vai precisar:

1. de um item novo na lista `FERRAMENTAS`, com nome, descrição e parâmetros;
2. de um `case` novo em `executar()`.

Depois, pergunte à IA "quantas tarefas temos em cada coluna?" e veja ela escolher a sua ferramenta.
