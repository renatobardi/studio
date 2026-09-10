# Handoff: Studio — app de trabalho com agentes (Kubo Design System)

## Visão geral

Studio é um app de colaboração humano + agentes: Inbox unificada, canais, fóruns, DMs, Pulse,
Projects, Agents, Workflows, Skills, Compute, board de tasks, Settings, perfil, busca global,
workspaces (multi-relay) e um fluxo de entrada em duas etapas — **conta (Firebase Auth)** seguido de
**identidade Nostr (onboarding de 8 passos)**.

## Sobre os arquivos deste pacote

Os arquivos em `design/` são **referências de design escritas em HTML** — protótipos que mostram
aparência e comportamento pretendidos, **não código de produção para copiar**. A tarefa é
**recriar essas telas no ambiente do codebase alvo** (React/Next, Vue, SwiftUI, etc.) usando os
padrões e bibliotecas já estabelecidos lá. Se ainda não existir ambiente, escolha o framework
adequado e implemente as telas nele.

`Studio.dc.html` é um único componente com template + classe de lógica. O template usa uma sintaxe
própria (`<sc-if>`, `<sc-for>`, `{{ path }}`) que **não deve ser portada literalmente** — traduza
para o condicional/`map` do framework alvo. Toda a estilização está inline, com tokens CSS
(`var(--foreground)`, `var(--radius-4xl)`, …) definidos em `tokens/`.

## Fidelidade

**Alta fidelidade (hifi).** Cores, tipografia, espaçamento, raios, estados de hover/press e copy
são finais. Recrie pixel-perfect usando os componentes equivalentes do design system do codebase.

## Design system

Kubo Design System (derivado de shadcn "stone", OKLCH). Tokens completos em `tokens/`:

- **Cor**: neutros stone quentes; primary near-black `oklch(0.216 0.006 56)` (dark inverte para
  `oklch(0.92 …)`); cor só para significado, nunca cromo. Destrutivo sempre *tintado*
  (`background: destructive/10`, texto `destructive`), nunca vermelho sólido.
- **Tipografia**: Inter em tudo. No Studio a escala foi reduzida um passo em relação ao Kubo padrão:
  corpo **11px**, campos e rótulos de formulário **12px**, chrome/meta **10px**, título de página
  **18px/600**, título de seção **13–14px**, título de tela de onboarding **20px/400**.
- **Raios**: base 8px; botões, inputs, selects e badges = pill (`--radius-4xl`, 20.8px);
  cards `--radius-2xl` (14.4px); painéis internos 12px; avatares redondos.
- **Cards**: fundo `var(--card)`, **sem borda e sem sombra** — definidos por ring:
  `box-shadow: 0 0 0 1px color-mix(in oklab, var(--foreground) 10%, transparent)`.
- **Controles**: altura 28px (`sm`) e 24px (`xs`), padding `0 10px` / `0 9px`, fonte 11px.
  Hover = 80% de opacidade do fundo; **press = `translateY(1px)`**; foco = ring 3px a 50%;
  disabled = 50% de opacidade.
- **Separadores**: `1px solid color-mix(in oklab, var(--border) 45–50%, transparent)`.
- **Ícones**: Lucide monocromático, 14–16px, stroke 2. **Nunca emoji como identidade** (a única
  exceção viva é o avatar escolhido pelo usuário no onboarding).
- **Movimento**: `transition: all 150ms`. Sem bounce, sem easing longo.
- **Fundos**: cores chapadas. Sem gradiente, sem textura, sem blur.

## Fluxo de entrada (a parte nova)

Duas etapas **em sequência**, nesta ordem — é o ponto mais importante deste handoff:

### 1. Conta — Firebase Authentication (`view: "auth"`)

Tela centrada sobre `color-mix(in oklab, var(--muted) 40%, transparent)`; coluna de 352px;
marca sakura 32px, h1 18px/600, subtítulo 11px; card de 20px de padding com o ring padrão.

Passos (`authStep`):

| passo | conteúdo | CTA | link secundário |
| --- | --- | --- | --- |
| `signin` | email, senha, "Forgot password?" | Sign in | "Don't have an account? Create one" |
| `signup` | nome, email, senha (mín. 8, dica "Use 8 characters or more…") | Create account | "Already have an account? Sign in" |
| `verify` | painel com o email + "Resend the link" | I verified — continue | "Use a different email" |
| `reset` | email | Send reset link | "Back to sign in" |
| `sent` | confirmação com check verde | Back to sign in | — |

`signin` e `signup` mostram divisor "or" + botão outline **Continue with Google**, que abre um
popup simulado (overlay `color-mix(in oklab, var(--foreground) 22%, transparent)`, card 320px):
"Choose an account / to continue to studio.app", duas contas + "Use another account" + nota
"Studio will get your name and email address. It never sees your Google password."
Na implementação real isso é `signInWithPopup(auth, new GoogleAuthProvider())` — o popup é do
Google, então o design serve só de referência de tom e do que acontece antes/depois.

**Erros** aparecem em faixa tintada (`destructive/10`) com a mensagem em 11px e o código do Firebase
logo abaixo em mono 10px:

- `auth/invalid-credential` — "That email and password don't match an account."
- `auth/user-not-found` — "No account uses that email yet. Create one instead."
- `auth/email-already-in-use` — "An account already uses that email. Sign in instead."
- `auth/network-request-failed` — "Studio couldn't reach Firebase. Check your connection and try again."

Validações locais (email inválido, senha < 8) mostram só a mensagem, **sem código**.
No protótipo o tweak `authState` (`ready` | `wrong-password` | `no-account` | `email-in-use` |
`offline`) força cada caso; no app real isso vem do `error.code` do SDK.

Sucesso de qualquer caminho → grava `authAccount = { email, provider: "password" | "google" }` e
navega direto para `view: "onboarding", onboardingStep: "invite"`.

### 2. Identidade Nostr (`view: "onboarding"`)

8 passos: `invite → profile → avatar → backup → backup-options → download → setup → config`.
Cabeçalho com sakura 30px à esquerda, dots de progresso ao centro (ativo 28px×6px em
`var(--foreground)`, inativos 6px a 30%) e, à direita, **o chip da conta autenticada** (avatar
19px com a inicial sobre `var(--primary)` + email em 10px) — o único elo visível entre Firebase e
Nostr. Conteúdo centrado, `max-width` por passo (500–900px), CTA pill de 320px + link "Skip for now",
botão "Back" no rodapé a partir do 2º passo.

Regras de conteúdo relevantes: a chave privada (`nsec1…`) nasce borrada (`filter: blur(4px)`,
`user-select: none`) com botões de revelar e copiar; o passo de backup exige criar o arquivo
`.age` com senha e **verificar** antes de liberar o "Next".

## Demais áreas

`design/STUDIO.md` documenta, em detalhe e em português, as convenções vivas do app: densidade,
popovers (`toggleCardMenu`), painéis laterais mutuamente exclusivos, medição de largura por
`getBoundingClientRect` no resize (o `ResizeObserver` não entrega callbacks no host do protótipo),
controles de tema/densidade/escala, escopo por workspace, o modelo de **tasks com dois eixos**
(status do board × estado de execução) e as telas de Skills e Compute. Leia antes de implementar
qualquer área além do login.

## Estado (o que precisa existir)

Chaves do fluxo novo: `view`, `authStep`, `authName`, `authEmail`, `authPassword`, `authError`,
`authErrorCode`, `authGoogleOpen`, `authResent`, `authAccount`. O onboarding usa
`onboardingStep`, `onboardingName`, `onboardingEmoji`, `onboardingKeyRevealed`,
`onboardingBackup` (`idle | created | verified`), `onboardingAge`, `onboardingTerms`,
`onboardingPolicyError`. No app real, `authAccount` vem do `onAuthStateChanged` e a navegação
inicial deve ser: sem usuário → `auth`; usuário sem chave Nostr → `onboarding`; ambos → `inbox`.

## Dados

Todo o conteúdo do protótipo é fixture inline (canais, mensagens, agentes, tasks, runtimes).
Substitua por dados reais; a estrutura das listas dá o shape esperado de cada entidade.

## Assets

Sem imagens. Marca **sakura** (SVG de linha) e ícones **Lucide** vêm do bundle do design system.
Não use o logo colorido do Google — o protótipo usa botão outline só com texto.

## Arquivos

- `design/Studio.dc.html` — todas as telas, estado e lógica.
- `design/STUDIO.md` — convenções e decisões de arquitetura (leitura obrigatória).
- `design/support.js` — runtime do protótipo; **não portar**, existe só para abrir o HTML.
- `tokens/colors.css`, `tokens/typography.css`, `tokens/radius.css` — tokens do Kubo.

Para ver o protótipo rodando: abra `design/Studio.dc.html` num servidor estático a partir da raiz
do projeto original (ele referencia `_ds/…` por caminho relativo).
