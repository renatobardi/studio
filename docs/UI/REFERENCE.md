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
   a conversa com os mesmos ~134px do protótipo. **Decidido pelo dono (13/09/2026): manter fiel
   ao HTML.** Uma navegação móvel própria só entra quando o design entregar uma tela para ela.
2. **Tela inicial após onboarding.** HTML vai para `inbox` (fora do MVP); o app abre Channels.
3. **Etapas sem referência** (restore, gate de senha da conta, criar Workspace): seguem a
   composição da etapa mais próxima (título 20px/400, `max-width` do passo, CTA 320px).

## Aceite visual (issue #73)

Duas frentes, uma determinística e uma autenticada:

- **Flow 10 — `web/e2e/visual.spec.ts`** compara os mesmos ids desta matriz renderizados por
  `web/preview.html` (componentes reais sobre fixtures assinadas, relay e API falsos, relógio UTC,
  Inter conferida) com baselines em `web/e2e/visual.spec.ts-snapshots/`. Roda com
  `cd web && bun run test:visual` (sobe/reaproveita o Vite). Sem `STUDIO_PREVIEW_URL` o flow se
  pula — o CD roda contra o build de produção, onde `preview.html` não existe. O Vite do flow sobe
  com `VITE_FIREBASE_*` placeholder (`playwright.config.ts`): o preview não fala com Firebase, e
  sem chave `getAuth` lança na carga.
- **No CI (issue #155)** o job `visual` do `ci.yml` roda o flow 10 em todo PR contra os baselines
  `-linux`, via `web/tools/visual-linux.sh` — o mesmo script local, dentro de
  `mcr.microsoft.com/playwright:v1.63.0-noble` (linux/amd64). Diff acima da tolerância deixa o job
  vermelho e sobe `actual`/`expected`/`diff` no artefato `visual-diffs`.
- **Flow 11 — `web/e2e/visual-live.spec.ts`** entra no studio-test com a conta de teste e
  captura canal, thread, membros, DMs e Settings em 1440×900 e 390×844, light e dark, para
  `web/test-results/visual-live/` (+ `manifest.json` com SHA, URL e browser). O CD liga
  `STUDIO_VISUAL_CAPTURE=1` e sobe as PNGs no artefato `playwright-screenshots`. Dados reais do
  Workspace de teste variam entre runs — por isso é captura para conferência manual, não baseline.

Tolerância: `maxDiffPixelRatio 0.002`, `threshold 0.2` — o antialiasing de texto oscila em
sub-pixel mesmo numa mesma máquina; um componente que mudou de posição, tamanho ou cor passa
disso com folga. Nada é mascarado: as fixtures são fixas. Os baselines levam sufixo de plataforma
(`-darwin`, `-linux`): texto rasteriza diferente por SO, então um baseline gerado no macOS nunca
é comparado no Linux.

**Política de baseline:** gerar com `bun run test:visual -- --update-snapshots`, conferir cada PNG
contra `docs/UI/reference/` e só então commitar. Toda tela alterada leva os dois baselines: o
`-darwin` pelo comando acima e o `-linux` (o que o CI compara) por Docker, com a mesma imagem do CI:

```sh
cd web
bun run test:visual:linux                                      # compara, como o CI
bun run test:visual:linux --update-snapshots -g "<nome>"       # redesenha só essa tela
```

O container instala as próprias dependências num volume Docker (`studio-web-linux-node-modules`)
— nunca em `web/node_modules`, que tem binários nativos do macOS. No Apple Silicon roda emulado
(amd64, ~2 min a matriz inteira); é o preço de rasterizar igual ao runner. A imagem acompanha
`@playwright/test` do `bun.lock`: subir um, subir o outro e redesenhar os `-linux`. Os `-linux`
de #155 foram gerados assim e conferidos par a par contra os `-darwin` (mesma composição, só a
rasterização do texto muda); as divergências de ambos contra `docs/UI/reference/` são as
rastreadas em #142–#153. Os baselines de #65 foram gerados no macOS
(`-darwin`) e entram no PR para conferência do dono no review — a aceitação é dele, não do
run. `--update-snapshots` para "deixar o CI verde" não é aceite.

## Teclado virtual (issue #72) — checklist para aparelho real

Sem aparelho na sessão de implementação, a verificação é do dono. Em um iPhone (Safari) e um
Android (Chrome), no studio-test, anotar na issue #72 o modelo/browser e o resultado de:

1. Abrir um canal, tocar no compositor: o teclado sobe e o campo continua visível acima dele
   (não fica coberto); o histórico ainda rola por trás.
2. Digitar três linhas (Shift+Enter não existe no teclado móvel — a quebra vem do botão de
   "enter" do teclado; enviar é pelo botão de seta). Confirmar que o campo cresce até 160px e
   depois rola internamente.
3. Fechar o teclado: o compositor volta ao rodapé sem deixar espaço vazio.
4. Repetir em Direct messages e num Thread aberto (que ocupa a largura toda abaixo de 600px).
5. Girar para paisagem com o teclado aberto: nada sobreposto, nenhum overflow horizontal.
6. Settings › Appearance em "Larger": o compositor e o teclado ainda cabem.

Nomes longos, mensagens sem espaço e extremos de densidade/escala em auth, onboarding e
Settings estão nas fixtures do preview e no flow 10 (`*-spacious-larger`, `*-compact-smaller`,
canal `incident-review-…`, membro "Maximiliana …").

## Sonar

`docs/UI/design/**` está excluído da análise — nos argumentos do scanner em `ci.yml` e, para a
análise automática, em `.sonarcloud.properties` (ver `docs/delivery-gates.md`). O bundle
vendorado não conta mais como ruído no gate.
