# Referência visual reproduzível (issue #66)

Como abrir o protótipo sem depender de outro projeto, o que ainda falta nele, e a matriz de
telas MVP usada pelas frentes #67–#73. HTML prevalece sobre o README para composição e medidas
por tela (`design/STUDIO.md`); as divergências entre os dois estão listadas no fim.

## Dependências do `design/Studio.dc.html`

| Referência no HTML | Estado | Origem / licença |
| --- | --- | --- |
| `_ds/kubo-design-system-6efae607-…/{_ds_bundle.js, styles.css, tokens/*.css, fonts/fonts.css, readme.md}` | **vendorado** em `design/_ds/` | Kubo Design System do próprio autor (mesmo id de bundle que o HTML pede; `readme.md` do bundle registra a extração a partir de `renatobardi/valmis`). `_ds_bundle.js` sha256 `9901dc67…03e6fe`. |
| `_ds/…/fonts/InterVariable.woff2` | **vendorado** (também em `web/public/fonts/`) | Inter, Rasmus Andersson — SIL Open Font License 1.1. sha256 `3100e775…4c62`. |
| `fonts.css` → `@import` Google Fonts (Noto Sans JP) | **remoto, não usado** | Nenhuma tela do Studio usa `--font-jp`; a captura bloqueia o pedido para ser offline e determinística. |
| `./support.js` | presente | Runtime do protótipo (não portar). |
| `./image-slot.js` | **ausente — falha remanescente** | Só é usado pelo picker de GIF (`<image-slot>`, futuro). O 404 não afeta nenhuma tela MVP. Não reconstruído. |
| `assets/favicon.svg` | **ausente — falha remanescente** | Só o ícone da aba. Não reconstruído. |
| `tokens/*.css` do bundle | idênticos a `docs/UI/tokens/` e `web/src/styles/tokens/` | verificado por `diff`. |

Resultado: o HTML abre de um servidor estático a partir de `docs/UI/design/` com Inter carregada
(`document.fonts.check('12px "Inter Variable"')` → `true`) e `KoboDesignSystem_6efae6.__errors` vazio.

## Captura determinística

`cd web && node tools/capture-reference.mjs` serve `design/` em memória, força cada estado via o
próprio runtime (o protótipo não tem rotas) e grava `reference/<viewport>/<estado>[-dark].png`
mais `reference/matrix.json` (o patch de estado exato de cada tela).

- Viewports: **desktop 1440×900**, **mobile 390×844**, `deviceScaleFactor: 1`, `reducedMotion`.
- Fontes: aguarda `document.fonts.ready` e falha se Inter Variable não carregou.
- Dados: fixtures inline do protótipo (canal `eng-platform`, DM `Ana Petrova`, conta
  `renato@studio.app`). Nenhum dado real.
- Aparência no protótipo por padrão: `theme: light`, **`density: compact`**, `fontScale: default`.
  As capturas usam esses valores.

## Matriz de telas MVP

| Estado | Desktop | Mobile | Dark | Existe no app? |
| --- | --- | --- | --- | --- |
| auth-signin, auth-signin-error, auth-signup, auth-verify, auth-reset, auth-sent | ✓ | signin, signup | signin | sim (`AuthScreen`) |
| onboarding-invite | ✓ | ✓ | | sim — app tem também **restore** (sem referência no HTML) |
| onboarding-profile | ✓ | ✓ | | sim |
| onboarding-avatar | ✓ | | | sim |
| onboarding-backup (+ `-revealed`) | ✓ | ✓ | ✓ | sim |
| onboarding-backup-options | ✓ | | | app: aqui entram passphrase + `AccountPasswordGate` (sem referência) |
| onboarding-download (+ `-created`, `-verified`) | ✓ | ✓ | | sim (verificar/baixar backup) |
| onboarding-setup | ✓ | | | app: conectar ao Workspace / criar Workspace (cards de harness são futuro) |
| onboarding-config | ✓ | | | app: "You're in …" + Finish (selects de harness são futuro) |
| channel, channel-thread, channel-members | ✓ | ✓ | channel, thread | sim |
| dm | ✓ | ✓ | ✓ | sim |
| profile | ✓ | ✓ | | sim (`ProfileEditor` — edição própria; perfil de membro em `MemberProfile`) |
| settings-appearance, settings-profile | ✓ | appearance | appearance | sim |

Fora do MVP e **não** capturados: Inbox, Pulse, Projects, Agents, Workflows, Skills, Compute,
busca global, Starred, Forums, huddle, canvas, quick bots, troca de Workspace, seções de
Settings além de Appearance/Profile, popup Google simulado.

## Divergências README ↔ HTML (adotado: HTML)

| Item | README | HTML | Adotado |
| --- | --- | --- | --- |
| Tamanho-base do corpo | 11px | `html, body { font-size: 12px }`; corpo das mensagens 11px; sidebar/campos 12px; meta 10–11px | HTML por tela |
| Controles de auth/onboarding | 28px (regra geral) | inputs **32px** (`padding 0 12px`, `--radius-4xl`), CTA 28px (`btnSm`) | HTML |
| Fundo dos inputs | — | auth/download: `color-mix(var(--input) 30%)`; invite: `var(--background)` | HTML por tela |
| Densidade padrão | não diz | `compact` | HTML |
| Marca | "sakura 32px" | `Sakura size=32 sw=7` (auth), `30` (onboarding), `12 sw=7` (rodapé da sidebar) | HTML |

## Decisões pendentes (registrar antes de implementar)

1. **Sidebar em 390×844.** O HTML mantém a sidebar de 256px fixa em qualquer largura
   (`reference/mobile/channel.png`: a conversa fica com ~130px). Não há referência de navegação
   móvel; #72 implementa só o que o HTML define (thread substitui a timeline e membros vira
   overlay quando o canal tem < 600px, `web/src/lib/paneLayout.ts`) e **não inventa** drawer/tabs.
   Reproduzido no app em `preview.html?screen=channel-thread` a 390×844: sem overflow horizontal,
   a conversa com os mesmos ~134px do protótipo. **Precisa de decisão do dono** — opções:
   (a) manter fiel ao HTML; (b) sidebar recolhível/drawer abaixo de um breakpoint (não existe no
   protótipo, seria invenção); (c) pedir uma tela móvel ao design.
2. **Tela inicial após onboarding.** HTML vai para `inbox` (fora do MVP); o app abre Channels.
3. **Etapas sem referência** (restore, gate de senha da conta, criar Workspace): seguem a
   composição da etapa mais próxima (título 20px/400, `max-width` do passo, CTA 320px).

## Sonar

`docs/UI/design/**` ainda não está excluído da análise (ver `docs/delivery-gates.md`); o bundle
vendorado aumenta esse ruído. Exclusão fica para o ticket que já a menciona.
