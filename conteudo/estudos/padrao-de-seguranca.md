# Padrão de Segurança da VZ

> As regras que todo mundo da VZ segue, sem exceção: o alvo dos ataques hoje é o computador de quem programa, porque é nele que ficam as chaves dos servidores.

## Por que isso importa

Os grandes ataques recentes a empresas de tecnologia seguem quase sempre o mesmo roteiro: o invasor não ataca o servidor de frente. Ele entra pelo **computador de um desenvolvedor**, por um programa infectado, uma extensão maliciosa, um pacote falso ou uma senha vazada. Lá dentro ele encontra o que precisa: **chaves SSH, arquivos `.env`, tokens do GitHub, chaves de API**. Com isso, entra nos servidores como se fosse a própria equipe.

Para a VZ, isso significaria acesso ao site, ao AprovIA, ao ScanTE, ao ContabIA e aos dados dos clientes. Por isso a segurança é **padrão da empresa**, não uma opção.

## As 10 regras

### 1. Segredo nunca vai para o git

Chaves, senhas e tokens ficam só no `.env` de cada máquina (que está no `.gitignore`) ou num gerenciador de senhas. Antes de cada commit, confira o que está indo (`git status`, `git diff --staged`). Vazou? **Troque a chave na hora**: apagar o commit não adianta.

### 2. Chave SSH sempre com senha

Toda chave SSH que acessa servidor tem frase-senha (`ssh-keygen -p -f ~/.ssh/nome_da_chave` coloca uma). Uma chave por pessoa e por máquina: se um notebook for perdido, revogamos só aquela.

### 3. Verificação em duas etapas em tudo

GitHub, Google, Hostinger, Cloudflare, Anthropic, Meta, banco. De preferência com app autenticador ou chave de acesso (passkey), não SMS.

### 4. Cada pessoa com o seu acesso

Nada de senha compartilhada. Cada dev tem o seu usuário no GitHub, na Hostinger (quando possível) e na central, e a sua própria chave de API com limite de gasto. Quem sai da equipe perde todos os acessos no mesmo dia.

### 5. Computador protegido

- Disco criptografado (BitLocker no Windows).
- Windows e programas sempre atualizados.
- Antivírus ligado (o Microsoft Defender basta).
- Tela bloqueia sozinha; nunca deixe o PC destravado.
- Nada de programa pirata ou "crackeado": é a porta de entrada número um.

### 6. Cuidado com o que você instala

- **Extensões do VS Code e do navegador:** só as conhecidas e necessárias.
- **Pacotes (npm, composer, pip):** confira o nome (golpistas criam pacotes com nomes quase iguais) e prefira os populares. Rode `npm audit` de vez em quando.
- **Skills, MCPs e "sistemas prontos" de rede social** ("comenta SKILL que eu te mando"): uma skill ou MCP **roda comandos no seu computador**. Só instale depois de ler o conteúdo, ou peça para o Claude revisar antes. Nunca de fonte desconhecida.

### 7. A IA também segue regras

- O Claude Code pede permissão antes de ações arriscadas: **leia antes de aprovar**, especialmente comandos que apagam, publicam ou enviam dados.
- Nunca cole senha ou chave no chat de nenhuma IA.
- Antes de subir código para produção, rode a revisão de segurança (`/security-review` no Claude Code).

### 8. Servidor só recebe pelo git

Publicação sempre a partir do que está no GitHub, nunca editando arquivo direto no servidor. Assim sabemos exatamente o que está no ar, e um arquivo alterado por invasor aparece na comparação.

### 9. Mínimo de portas abertas

Banco de dados nunca acessível pela internet. Painéis internos (como esta central) só no computador local ou atrás de login e de VPN. Acesso SSH só com chave, nunca com senha.

### 10. Backup e plano de reação

Backup automático dos bancos e dos sites, com teste de restauração. Se algo parecer estranho (login que você não fez, cobrança diferente, arquivo mudado no servidor): **avise o Gabriel na hora, troque as senhas e as chaves envolvidas e não apague nada** até entender o que aconteceu.

## Checklist do computador (faça uma vez e revise todo mês)

1. BitLocker ligado.
2. Windows Update em dia.
3. Defender ativo.
4. Todas as chaves SSH com senha.
5. Verificação em duas etapas no GitHub, Google e Hostinger.
6. Nenhum `.env` nos repositórios (`git ls-files | grep .env`).
7. Extensões do VS Code e do navegador revisadas.
8. Gerenciador de senhas em uso.

## Situação da VZ hoje (04/11/2026)

- Nenhum projeto enviou `.env` para o git. Ótimo.
- **No PC do Gabriel, 3 chaves SSH de servidor estão sem senha** (`active_hostinger`, `hostinger_contabia`, `scante_deploy`). Prioridade: colocar senha nelas.
- O `.htaccess` com a regra de IP do painel da Hostinger sumiu do site da VZ. Conferir se foi intencional.

## Exercício

Rode o checklist acima no seu computador e conte no chat ao lado o que encontrou. A IA explica como corrigir cada item.
