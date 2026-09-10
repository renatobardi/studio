# Studio

Studio é um app de trabalho em equipe com agentes: Inbox, canais, fóruns, DMs, Pulse, Projects, Agents e Workflows, no Kubo Design System.

O projeto agora é autônomo — não há mais fonte externa a sincronizar. `Studio.dc.html` é a única verdade.

## Convenções

- **Densidade**: corpo de texto 11px, chrome e rótulos 11/10px, títulos de página 18px, de seção 14px, controles 28px (`sm`) e 24px (`xs`).
- **Ícones**: glifos Lucide monocromáticos. O set do design system cobre a maioria; o que falta entra como SVG inline. Nunca emoji como identidade.
- **Popovers**: sempre por `toggleCardMenu(key, event, altura)`, que decide abrir acima/abaixo e faz clamp ao viewport.
- **Composers**: o `ChatInput` do design system fixa 14px inline; a regra `[data-composer] textarea` no helmet corrige para 11px com `!important`.
- **Painéis laterais**: um por vez no rail direito (`showPane`) — membros, canvas e thread são mutuamente exclusivos.
- **Larguras de painel**: medidas por `measurePane()` no attach e no resize da janela; o ResizeObserver não entrega callbacks neste host.
- **Huddle**: drawer que ocupa espaço de layout (irmão de `<main>`), nunca overlay fixo.
- **Tema, densidade e escala**: `theme` (light/dark) aplica a classe `.dark` do design system; `fontScale` (smaller/default/larger) aplica `zoom` 0.92/1/1.12 no shell; `density` vira `data-density` no shell e as regras do helmet miram **hooks explícitos**, nunca substrings de `style` — o runtime recompila `style` num objeto React e reserializa, então casar por substring não é contrato. Hooks: `data-row` (linha densa, baseline 3-6px), `data-row-lg` (linha de inbox, baseline 12px), `data-list` (gap de lista), `data-pane-pad` (respiro de painel). Ao criar uma linha nova, marque-a com o hook adequado ou ela não responde à densidade. Controlados em Settings › Appearance; o tema também no rodapé da sidebar.
- **Validação**: antes de mostrar, rodar `renderVals()` fora da página para pegar erro de sintaxe e chave faltando.

## Autenticação e onboarding

Duas etapas em sequência, nesta ordem:

1. **Conta (Firebase Auth)** — `view: "auth"`, passos `signin` · `signup` · `verify` · `reset` · `sent`. E-mail e senha ou **Continue with Google** (popup de escolha de conta simulado dentro da tela). Erros aparecem como faixa vermelha *tintada* com o código do Firebase em mono (`auth/invalid-credential`, `auth/email-already-in-use`, `auth/network-request-failed`, `auth/user-not-found`); o tweak `authState` força cada um. Validações locais (e-mail inválido, senha < 8) não mostram código.
2. **Identidade Nostr** — o onboarding de 8 passos que já existia. Ao concluir o login, o app vai direto para `onboardingStep: "invite"` e grava `authAccount` (`{ email, provider }`), que aparece como chip no cabeçalho do onboarding — é o único elo visível entre as duas etapas.

Entradas: menu da conta › **Sign in screen** (reseta `authAccount`) e menu da conta › **Run onboarding again**.

## Workspaces

Cada workspace é um relay próprio. **Escopado por workspace**: Inbox, canais, fóruns, DMs, Pulse, Projects, Agents e Workflows. **Global**: identidade, perfil e Settings.

- Seletor no rodapé da sidebar — o nome do workspace abre a lista; o seu nome segue abrindo o menu de conta.
- Troca leva ao Inbox do workspace escolhido e limpa seleção/painéis (nada de estado vazado entre relays).
- Criação em 3 passos (nome → endereço → o que semear), pelo seletor ou por Settings › Workspaces.
- Administração em **Settings › Workspaces**: lista com papel e badge "Current", trocar, configurar (nome, endereço, quem entra, papel padrão) e sair.
- O escopo é aplicado por listas de nomes em `WORKSPACES` (`channels`, `forums`, `dms`, `projects`, `agents`, `workflows`). Ao criar dados novos, some o nome à lista do workspace ou eles não aparecem.

## Tasks e board

Vocabulário: **task** (nunca "issue"), id `STU-284`. Duas escalas independentes:

- **Status** — Backlog · Todo · In progress · In review · Done. Intenção humana, muda por arrasto/menu.
- **Execução** — Working / Blocked / Done, com tempo e nº de tool calls. Fato da máquina, nunca vira coluna.

Assignee é um campo só: pessoas **e** agentes no mesmo picker.

- **Board** = terceira visualização da aba Tasks (lista / grid / board), com tasks do workspace inteiro.
- **Group by** status, assignee, prioridade ou projeto — as colunas se refazem.
- **Card fields** ligam/desligam ID, prioridade, labels, estimate e projeto (controle de densidade).
- **Criação rápida**: título + pills de propriedade; Enter cria e mantém aberto, com contador. Esc fecha.
- **Detalhe da task**: propriedades editáveis por pill + faixa de execução com "Open session" (leva ao transcript do agente) + timeline unificada, com eventos ("Sprig changed status from Todo to In progress") e comentários interleaved.

## Skills e Compute

**Skills** (nav própria): procedimento versionado — passos, arquivos (SKILL.md, config, templates), autor e versão — que qualquer agente anexado executa. Lista à esquerda, detalhe com passos numerados, arquivos, "Used by" (com estado vazio quando ninguém tem) e Run now. Diálogos: criar, importar (bundle ou catálogo), anexar a agente, executar.

**Compute** (nav própria): máquinas, não harnesses. Cards de runtime com online/offline, tipo (local daemon / cloud), harnesses registrados e nº de agentes; painel com janela 7d/30d/90d, uso de tokens (input/output/cache), heatmap de atividade 5×7 e custo diário em barras. "Scan for runtimes" reusa o catálogo de harnesses.

## Telas

| Área | Estado |
| --- | --- |
| Inbox | lista com filtros, detalhe, thread, feed de "Needs action" |
| Canal | timeline, thread, membros, canvas, quick bots, huddle |
| Fórum | lista de posts e detalhe de post com respostas |
| DM | três conversas (pessoa, agente, offline) |
| Pulse | 6 abas, notas, atividade de agente |
| Projects | overview (6 seções), detalhe (7 abas), home do projeto, chat com agente, 20+ diálogos |
| Agents | grid e lista, painel de instância (sessão/logs/config), teams, 20+ diálogos |
| Workflows | lista, detalhe com trace de execução, editor visual |
| Onboarding | 8 passos + 4 telas de exceção de inicialização |
| Profile | modo pessoa e modo agente |
| Settings | 13 seções (Personal, Communities, App) |
| Busca global | dialog com escopos e navegação por teclado |
| Pickers | emoji (com custom) e GIF |

## Props de estado

`projectState`, `repositoryState`, `workItemsLoadError`, `pulseState`, `startupState` — expostos como tweaks para inspecionar estados de erro e carregamento sem mexer no código.
