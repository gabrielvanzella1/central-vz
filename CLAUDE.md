# Central da VZ

Painel interno da VZ Soluções em Tecnologia (Gabriel Vanzella, devs Derik e Mateus). Começou em 2026-11-04 como "versão básica" pedida pelo Gabriel: conversa por voz com a IA, quadro Kanban, projetos de todas as máquinas, Central de Estudos, memória, histórico, acessos com senha. **Não tem link no site da VZ.**

## Como roda

- Node 24, sem etapa de build: `servidor.mjs` (HTTP puro, só em 127.0.0.1, porta 8790) + `public/` (HTML, CSS e JS de módulo).
- IA: `ia.mjs`, SDK oficial `@anthropic-ai/sdk`, modelo `claude-opus-5-5`, esforço `low` (conversa por voz precisa de rapidez), fallback de recusa ligado (`server-side-fallback-2026-07-01` + `fallbacks: 'default'`). Ciclo de ferramentas manual e comentado (o Gabriel quer aprender por ele), com `MAX_PASSOS = 8`. Histórico de conversa só cresce (nunca editar mensagens antigas: preserved thinking).
- Voz: Web Speech API do navegador (reconhecimento pt-BR e `speechSynthesis`), sem custo. Fala frase a frase durante o streaming; interrompe quando a pessoa fala.
- Acessos: `auth.mjs`, login por **usuário ou e-mail** (o Gabriel entra com contato@vztecnologia.com.br), senhas com scrypt, sessão em cookie HttpOnly (gravada em `dados/sessoes.json`), bloqueio após 5 erros, troca obrigatória da senha provisória. `npm run usuarios` cria os acessos.
- Dados em JSON em `dados/` (ver README: o que vai e o que não vai para o git). `historico.jsonl` registra tudo (mensagens, respostas, cartões, memórias, dicas, logins) e a IA consulta pela ferramenta `consultar_historico`: o Gabriel quer que o histórico deixe a empresa "cada vez mais inteligente".
- Projetos: `npm run inventario` em cada máquina grava `dados/maquinas/<hostname>.json`; a central junta todos. **Curadoria** (`dados/curadoria.json`): só o dono (Gabriel) escolhe; situações "central" (o que a IA enxerga, conta na home e recebe dicas), "a escolher" (padrão de todo projeto novo) e "excluir" (lista para validar; nada é apagado do disco).

## Decisões do Gabriel

- Home no computador **sem menu**: todas as áreas à vista, separadas; menu só no celular. Visual do site da VZ (branco + azul brilhante, Space Grotesk/Inter).
- Tour de boas-vindas no primeiro acesso de cada pessoa.
- Todos têm as mesmas funções, cada um com a sua conta.
- A IA da central se chama **VZ** (desde 04/11; antes "Ayran", que agora é só o modelo local). Fala de si no **feminino** (o Gabriel diz "ela"). Atende quando a pessoa diz "VZ" (opção na tela de conversa; escuta contínua do navegador, desligada por padrão). O Gabriel vai criar um personagem com rosto para ela.
- **IA local (Ayran) em pausa (04/11, Gabriel):** a central usa só a API do Claude. Mais tarde o Gabriel quer replicar o que o Claude faz de fato e ir abastecendo aos poucos o projeto da IA local que já roda (pasta yrian em htdocs, Qwen3 4B no Ollama). A trilha `conteudo/estudos/trilha-ayran.md` e os cartões do projeto `ayran` ficam guardados, sem prioridade. **Antes de usar respostas do Claude para treinar outro modelo, ler os termos atuais da Anthropic:** fontes secundárias dizem que os Termos Comerciais proíbem treinar modelos concorrentes e que a Política de Uso restringe treinar qualquer modelo com as saídas sem autorização, com um artigo de ajuda de 2026 admitindo usos que não concorrem (classificação, resumo, extração). Conversas e notas pessoais nunca entram em treino.
- Dicas nos projetos ao passar o mouse, com **Acatar** (vira cartão) e **Trocar plano**.
- Integrações (WhatsApp, redes sociais, e-mail) são **opcionais por pessoa**; recurso que depende de uma integração diz claramente que precisa dela.
- Rosto da VZ: imagem em `public/vz/avatar.(webp|png|jpg)` substitui a bola azul (hoje um recorte provisório da "Nova"). Voz: feminina, suave, com personalidade; automática no navegador (Thalita/Francisca do Edge) ou premium pela ElevenLabs. Cuidado ao testar: o navegador do Chrome DevTools usado pelo Claude pode estar logado como o Gabriel de verdade, e a limpeza de testes **nunca** deve restaurar cópias de `dados/`, só remover o que o teste criou.
- **Duas versões da VZ, cada pessoa escolhe (seletor na tela de conversa):** *normal* (bola azul, voz do navegador, tom profissional) e *personalizada* (personagem em `public/vz/avatar.*`, voz premium da ElevenLabs se configurada, personalidade em `dados/personalidade.md`, que o Gabriel edita). A escolha fica na conta (`versao` em `dados/usuarios.json`). O Gabriel está na personalizada.
- **A VZ sempre pode ser interrompida:** falar por cima (ela para e escuta; `public/eco.js` filtra o eco da própria voz quando não há fone), tocar no rosto, botão Interromper, tecla Esc ou digitar. O navegador fecha a conexão e o servidor não começa outra rodada (`cancelado` em `ia.mjs`); a mensagem seguinte espera o servidor terminar (409 com nova tentativa).
- **A VZ acompanha o humor (pedido do Gabriel, 04/11):** acolhe quem está triste, cansado ou sobrecarregado (primeiro escuta, depois oferece saídas pequenas e só mexe no quadro com o ok), comemora com quem está feliz, não diagnostica, e em sinal de risco leva a sério (pergunta se está em segurança, CVV 188, SAMU 192). Não presume gênero. Primeira conversa do dia: pergunta de leve como a pessoa está. Regras em `FIXO` (`ia.mjs`, seção "Presença e humor").
- **Privacidade das conversas:** o texto das conversas (mensagem/resposta) **não vai** para o histórico da equipe nem para o git: fica em `dados/privado/<pessoa>.jsonl`, e só a própria pessoa o vê (tela Histórico e `consultar_historico`). O histórico da equipe guarda só ações. Notas pessoais (humor, o que pesa/ajuda) ficam em `dados/pessoal/<pessoa>.json`, também fora do git, e a pessoa pode pedir para ver (`ver_notas_pessoais`) ou apagar (`esquecer_nota_pessoal`). Nada de sentimentos na memória da equipe. Antes disso (até 04/11), as conversas antigas do Gabriel estavam em `historico.jsonl` e já foram migradas; elas continuam nos commits antigos do git local.
- **Nomes e aparências (04/11):** é a **mesma IA** (mesma memória). O nome que a pessoa usa escolhe a aparência: **"VZ"** = versão normal (imagem Nova, profissional, voz do navegador) e **"Sabrina"** = versão personalizada (imagem em `public/vz/avatar-sabrina.*`, voz premium e personalidade de `dados/personalidade.md`). Vale no começo da frase, falada ou digitada (`versaoPeloNome` em `app.js`), pelo botão **Nova | Sabrina** em cima da foto, ou pedindo à IA (`mudar_aparencia`). O Gabriel usa a Sabrina como principal; Derik e Mateus começam na normal e cada um escolhe. As imagens são recortes provisórios da imagem que o Gabriel mandou (ainda com a etiqueta "AI Assistant"); o personagem definitivo substitui os arquivos. **Rosto 3D com boca articulando: pedido do Gabriel, ainda não feito** (precisa de um modelo `.vrm`; ver o quadro).
- **Celular (Android) do Gabriel, pedidos de 04/11:** (1) mandar áudio do celular para a Sabrina para pedir coisas e abastecê-la; o que ela não conseguir fazer, ela instrui como desenvolver (cartão com `como_desenvolver`); o Claude não ouve áudio, então áudio do WhatsApp precisa de transcrição local. (2) Rastreio contínuo do próprio celular (OwnTracks), com privacidade: trilha só local e privada, só nomes de lugares vão para a IA. (3) Botão de emergência de celular roubado, que funcione de qualquer PC: depende de serviços oficiais (Encontre meu dispositivo, Celular Seguro), não da central estar no ar. (4) Aprende violão, guitarra e bateria: a VZ ensina e acompanha a prática (nota pessoal + `registrar_pratica`/`ver_pratica`).
- Tudo que for abastecido no VS Code (conhecimento, skills, agentes, MCPs) deve valer em **todos os PCs e todos os projetos**. Feito em 05/11 com o repositório privado **gabrielvanzella1/claude-biblioteca** (ver "Sincronia entre os PCs").
- Banco/Open Finance fica por último.

## Decisões e entregas de 04 e 05/11 (para os dois PCs ficarem em sincronia)

- **Senha de emergência (coação):** segunda senha no mesmo e-mail. Quem entra com ela vê um painel vazio, a conta tranca, as outras sessões caem e um aviso vai para um tópico do ntfy (se configurado). Destrava só com o código de recuperação (aparece uma vez). Menu do nome > "Senha de emergência". Registro privado em `dados/seguranca.jsonl` (fora do git).
- **Discrição:** a VZ não puxa assunto pessoal sozinha, age com naturalidade, trata outra voz como visita (não revela nada particular) e mensagens fora do painel levam só trabalho. Regras no `FIXO`. Detalhes pessoais do Gabriel ficam só na nota pessoal dele (fora do git).
- **Pedidos falados viram registro:** "Sabrina, acho que pro ContabIA precisamos…" vira cartão sem perguntar; o tom decide ideia ou "a fazer".
- **Projetos em foco (curadoria):** ContabIA, ScanTE (`projetoscante`; confirmar se `coletores` e `appemuladortelnet` entram) e videoia. A pasta local `videoia` aponta para o repositório de outra pessoa (kevinten-ai/mcp-video-gen); o do Gabriel é `gabrielvanzella1/videoia`.
- **Conversa acompanha todas as telas** (doca flutuante); falar na home fica na home; a VZ leva para a tela pedida (`abrir_tela`) sem parar a conversa.
- **Radar de novidades (05/11):** `radar.mjs`. Todo dia a partir das 7h (com o PC ligado) a IA pesquisa na web Claude, MCPs, skills, modelos abertos, ferramentas e perfis, e grava `dados/radar/AAAA-MM-DD.json`. Tela "Radar" (faixa azul na home), botão "Atualizar agora" (só o dono) e ação `ver_radar` ("Sabrina, o que tem de novo?"). Custo estimado: menos de US$ 1 por dia. `RADAR=desligado` no `.env` desliga. Perfis acompanhados em `dados/radar/perfis.json` (o Gabriel vai mandar a lista de @).
- **Tarefas com dono (05/11, troca o jeito Kanban):** cada tarefa diz **com quem está** (Gabriel, Derik, Mateus, "agente" ou ninguém), a etapa em português (💡 Ideia, 📌 Para fazer, 🔨 Fazendo, 👀 Esperando aprovação, ✅ Pronto) e a **linha do tempo** (`linha` em cada tarefa). Regras, decididas pelo Gabriel: **tudo que um dev termina vai para ele aprovar** (`concluir_tarefa` → coluna `aprovar` → `aprovar_tarefa` ou `devolver_tarefa` com motivo); **os devs só pegam o que ele liberar** (`passar_tarefa` com `liberar`, depois `pegar_tarefa`); dev só mexe nas tarefas que estão com ele. Home com a tela **Hoje**: "Esperando você aprovar", "Com você", "Com a equipe" (para os devs: "Com você", "Liberadas para pegar", "Esperando o Gabriel aprovar"). Botão "+ Nova tarefa" e janela da tarefa com passar, liberar, aprovar, devolver e linha do tempo. O antigo quadro virou "Todas as tarefas". Reorganização inicial em 05/11: as abertas ficaram com o Gabriel, #1 e #2 prontas, #4 e #5 liberadas, e 5 tarefas novas do que está andando (Daniele, NOAR, edição de vídeo, Instagram, espelho 3D).
- **Projeto da influenciadora de IA (Daniele Veiga, doTERRA):** a VZ quer fazer o projeto que outra agência orçou (8 vídeos por mês). Proposta sem valor em `C:/xampp/htdocs/propostas-vz/daniele-veiga` (fora do git, só no PC de casa). Plano: GPU alugada na NOAR (Ultra GPU mensal R$ 1.160, GPU só na sessão agendada; Bare Metal R$ 2.000 a 3.200 se precisar de 24h) com modelos abertos de licença comercial (Wan 2.2 5B, Qwen-Image/FLUX.1-schnell + LoRA do rosto, MuseTalk, Chatterbox) e ferramentas pagas de reserva (Kling, HeyGen, ElevenLabs). Treinar sem dados: o rosto (LoRA) usa imagens geradas por nós; nunca treinar com saídas do Claude, ChatGPT ou Higgsfield. Testar 1 vídeo completo antes de fechar preço.
- **Máquina de edição de vídeo:** Claude Code + FFmpeg + Whisper + HyperFrames (plugin da HeyGen, Apache 2.0) no projeto videoia. Os efeitos de troca de roupa e cenário vêm de um modelo de vídeo (pago por uso ou Wan VACE na GPU), não do Claude.
- **Vendas ("virada de chave"):** a API oficial do Instagram (conta profissional + app da Meta) mostra quem comentou, mandou DM ou respondeu story, e permite DM automática por palavra-chave: vira lead na Central. Ela não mostra quem curtiu, salvou ou viu. A regra geral está no CLAUDE.md global (biblioteca).
- **Espelho de vendas 3D** (imobiliária): demo a fazer com Three.js, prédio gerado por código e unidades clicáveis.

## Sincronia entre os PCs

- **Código e quadro da Central:** este repositório (gabrielvanzella1/central-vz, privado). `git pull` ao chegar, `git push` ao sair.
- **Preferências e skills do Claude** (vale em todos os projetos): repositório privado **gabrielvanzella1/claude-biblioteca**, que fica dentro de `~/.claude` (lista branca: só `CLAUDE.md`, `README.md` e `skills/`). Skills: `/novidades`, `/analisar-reel`, `/grill-me`, `/handoff`, `/find-skills`, `/design-taste-frontend`, `/redesign-existing-projects`, `/web-design-guidelines`, `/graphify`, `/playwright-cli`. Regras globais: português simples, o Gabriel é visual (tabelas e exemplo visual), radar de novidades, "virada de chave" para vender, revisar qualquer skill/plugin/MCP antes de instalar.
- **Não vai pelo git (fica em cada PC):** `.env` (chave do Claude), `dados/usuarios.json`, `dados/sessoes.json`, `dados/privado`, `dados/pessoal`, `dados/conversas`, `dados/seguranca.jsonl`. No PC do trabalho a central começa sem logins e sem conversas.

## Começar no PC do trabalho (passo a passo)

1. **Biblioteca do Claude** (PowerShell, uma vez):
   ```powershell
   cd $HOME\.claude
   if (Test-Path CLAUDE.md) { Rename-Item CLAUDE.md CLAUDE.antigo.md }
   git init -b main
   git remote add origin https://github.com/gabrielvanzella1/claude-biblioteca.git
   git pull origin main
   git branch --set-upstream-to=origin/main main
   ```
   Depois compare o `CLAUDE.antigo.md` com o novo e junte o que fizer falta. A skill `/analisar-reel` precisa de Python com `av`, `pillow` e `faster-whisper` (`pip install av pillow faster-whisper`).
2. **Central:** `git clone https://github.com/gabrielvanzella1/central-vz.git` (ou `git pull` se já existir), `npm ci`, copiar `.env.example` para `.env` e colocar a chave do Claude, `npm run usuarios` para criar o acesso, `npm test`, `npm start` e abrir http://localhost:8790.
3. **Inventário daquele PC:** `npm run inventario`, depois `git add dados/maquinas && git commit -m "inventário do PC do trabalho" && git push`. Assim a central de casa enxerga os projetos do trabalho.
4. **Rede do trabalho:** o firewall (Fortinet) já bloqueou a Hostinger e o site da VZ. Se o claude.ai ou o GitHub não abrirem, fazer pelo celular no 4G.

## Onde paramos (05/11 à noite) e próximos passos

1. **Liberar o central-vz para o Claude no GitHub** (o Gabriel faz): janela anônima, entrar no GitHub como **gabrielvanzella1**, abrir https://github.com/settings/installations, Claude > Configure > Repository access, marcar **central-vz** (manter o siteVZ) e salvar. Conferir em claude.ai/code > Repositório que o central-vz aparece.
2. **Criar a rotina do agente da noite** (o Claude cria com /schedule depois do passo 1): nome "Agente da noite – Central da VZ"; todo dia 2h de Brasília = cron `0 5 * * *` (UTC); repositório https://github.com/gabrielvanzella1/central-vz; modelo claude-sonnet-5-5; ambiente Default; **sem conectores** (`clear_mcp_connections: true`: o Windsor da conta mexe em anúncios). Instrução: ler este CLAUDE.md e seguir a seção "Agente da noite". Painel: https://claude.ai/code/routines
3. **NOAR:** mandar as 12 perguntas e pedir o contrato B2B do Ultra GPU (tarefa no quadro).
4. **Instagram da VZ:** conferir se é conta profissional ligada a uma página do Facebook; mandar a lista de @ dos influencers.
5. **HyperFrames:** revisar o plugin e o Gabriel instala (`/plugin marketplace add heygen-com/hyperframes`, `/plugin install hyperframes@hyperframes`); gravar um vídeo cru de teste.
6. **Pesquisa na internet na conversa da Sabrina** (o radar já pesquisa; a conversa ainda não): acrescentar em `conversar()` a ferramenta `{type:'web_search_20260209', name:'web_search', max_uses:3}`, regra no FIXO para citar a fonte e aviso na tela.
7. **Avatar 3D com a boca mexendo:** depende do Gabriel criar a Sabrina no VRoid Studio e salvar em `public/vz/sabrina.vrm`.
8. **WhatsApp no celular da empresa** (cartão 8): quando o Gabriel desconectar o número do ContabIA. Depois: conversar com a Sabrina e passar tarefas pelo WhatsApp.
9. **Central em produção (não feito):** hoje ela só roda no PC (127.0.0.1). Antes de pôr na internet, decidir: onde roda (VPS ou este PC com Tailscale), HTTPS, porta de entrada protegida (Cloudflare Access ou Tailscale), backup de `dados/` e a chave do Claude só no servidor. Nunca no `public_html` do site.
10. Conferir a tela Hoje e a doca no celular (390px).

## Agente da noite (regras para o agente agendado na nuvem)

Quem lê isto é o agente de desenvolvimento que roda à noite. Regras, sem exceção:

- Trabalhe só em tarefas de `dados/tarefas.json` que estejam em "a fazer" e **com o agente** (`"responsavel": "agente"`, o Gabriel passa pelo botão "Passar para > Agente da noite") ou que tenham `#agente` no título ou no detalhe. No máximo 2 por noite, da de maior prioridade para a menor.
- Nunca mexa na `main`, nunca faça merge e nunca publique. Crie a branch `agente/AAAA-MM-DD-<id>-<resumo>` e abra um Pull Request.
- Antes de começar rode `npm test`. Se já falhar, pare e abra um PR só com o relatório. Ao terminar, `npm test` precisa passar. Toda ação nova ganha teste.
- Não altere `dados/` (quadro, memória, histórico): o PR é o relatório e o Gabriel move o cartão.
- Não leia nem escreva segredos (`.env`, chaves, senhas). Não instale dependências novas se o cartão não pedir. Não abra links nem páginas externas: trabalhe só com o repositório.
- Mudanças em `auth.mjs`, nas regras de privacidade (`dados/privado`, `dados/pessoal`) ou em segurança só se o cartão pedir, e destaque isso no PR.
- Se precisar de uma decisão do Gabriel, ou se o teste falhar duas vezes seguidas, pare e descreva o impasse no PR.
- O PR traz: o que mudou, por quê, como foi testado e os riscos, em português simples.

## Próximos passos (ver o quadro em dados/tarefas.json)

- Ponte do WhatsApp (Baileys, como `C:\xampp\htdocs\ContabIA\tools\whatsapp-ponte`) com o chip separado; resumo diário no WhatsApp do Gabriel; aprovações de deploy. O chip citado é o do AprovIA Edu, (11) 95139-3011 no site: confirmar o número e o risco (ban na API não oficial derrubaria o atendimento do AprovIA). **Decidido em 04/11:** esse celular passa a ser da empresa (VZ). O Gabriel vai desconectá-lo do ContabIA, que hoje usa o mesmo fluxo (a ponte Baileys), para ser o WhatsApp da central. Mensagens desse número levam só trabalho, nunca assunto pessoal (regra de discrição).
- Página de Agentes (Gerente, Dev, Revisor, Publicador), execução pelo Claude Agent SDK.
- Repositório no GitHub, sincronização entre as máquinas, inventário no PC do trabalho.
- Quadro com arrastar e soltar; e-mails; voz personalizada.
