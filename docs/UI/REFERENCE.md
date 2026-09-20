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
| profile | ✓ | ✓ | | sim (`ProfileScreen` — a própria, com a edição em "Edit profile" (#150); perfil de membro em `MemberProfile`) |
| settings-appearance, settings-profile | ✓ | appearance | appearance | sim |
| new-message | — | — | | sim (`NewMessageDialog`) — **sem referência capturada**, ver Decisões 11 |

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
4. **Onboarding › invite sem "Relay URL" (#152).** O HTML pede Relay URL e diz "or the community
   URL if the relay is open"; a API só admite ingresso por Invite (`_require_*`, #47) — não há
   Workspace aberto para apontar. Omitidos o campo e essa frase; o corpo vira "Paste the invite
   link a Workspace admin sent you, or just its code.". Pelo mesmo motivo a dica perde o
   "or nostr:" (não existe link de Invite `nostr:`) e o placeholder mostra o formato real do link
   (`/?invite=…`, `lib/invites.ts`). "I don't have an invite" abre, logo abaixo, as saídas sem
   Invite que já existiam (criar Workspace, restaurar do Key Backup). Terms of Service e Privacy
   Policy apontam para `web/public/legal.html`, **placeholder** até o dono fornecer os textos; o
   aceite não é gravado no servidor. Workspaces abertos: #159.
5. **Rodapé da sidebar e Sign out (#148).** O bloco de conta abre só Profile, Settings e Sign out
   ("Run onboarding again" e "Sign in screen" do HTML são atalhos do protótipo). Profile abre
   a tela `profile` (`ProfileScreen`, #150). O ponto de presença
   é a conexão com o relay (verde só em `open`); `connecting`/`reconnecting`/`closed` viram o
   banner de `relayReasons.ts`. O diálogo "Sign out and wipe all data?" mantém checkbox e frase
   "wipe all my data", mas **omite a linha da chave privada com Reveal**: o `Signer` nunca entrega
   a chave crua à UI e sob NIP-07 ela vive na extensão. Descrição sem "agent settings" (fora do
   MVP) e "return Studio to sign-in" no lugar de "first-run setup". Chave no diálogo: #160.
6. **Direct messages na sidebar (#142).** A seção lista cada conversa (ícone `user`, `bot` para
   Member com papel `agent`), da mais recente para a mais antiga; abrir uma mostra só a
   `ConversationView`, em largura total. Unread é como no HTML: a linha fica em negrito com a
   **contagem** de Messages não lidas à direita (10px, `--muted-foreground`), com marca de leitura
   por conversa guardada no browser; uma conversa sem marca conta a partir de quando o browser
   começou a guardá-las, para um restore não abrir com todo o histórico não lido. As linhas de
   Channel ficam só em negrito, sem número: o unread de Channel (#42) guarda apenas o instante da
   última atividade, não quantas Messages chegaram — contá-las exige outra assinatura. Contagem
   por Channel: #165. O "+" (visível ao passar o mouse; sempre em telas sem hover) abre o
   diálogo "New message" com o `MemberPicker` de #47: um clique no Member abre a conversa, sem o
   campo "To" nem "Start conversation". Omitidos o menu "…" da seção (Invite someone, Mark all as
   read) e o recolher do título, que os Channels também não têm.
7. **Channel members (#145).** Título "Channel members", fechar, campo "Add people and agents" e
   grupos PEOPLE/AGENTS (AGENTS só com Members de papel `agent` no roster) como no HTML. **Exceção:
   presença.** O Studio não tem evento de presença no MVP, então cada linha mostra só o papel, sem
   "· online"/"· away" nem o ponto no avatar — presença: #161. O papel segue
   `_require_channel_manager`: Owner (dono do Workspace), Admin (admin do Workspace ou do Channel,
   kind 39001), Member; `lib/memberDirectory.ts`. O campo só aparece para quem pode gerenciar o
   Channel e adiciona pela mesma rota do Admin › Channels, escolhendo entre os Workspace Members
   por nome (#47), nunca por pubkey. Omitidos o ícone de configurações (não há tela de ajustes de
   Channel no MVP) e "Archived members" (não há Member arquivado no domínio).

8. **Settings › Profile e a tela `profile` (#150).** Settings › Profile só lê (PROFILE INFO e
   IDENTITY), como no HTML; a edição de nome, bio e avatar vive na tela `profile`, onde
   "Edit profile" troca a mesma coluna pelo formulário — o protótipo manda o "Edit profile" para
   Settings, que lá também só lê, então não há no HTML lugar nenhum que edite depois do
   onboarding. Public key aparece como `npub…` (`shortNpub`), nunca em hex. "Private key backup"
   diz Verified quando a Account guarda um Key Backup (`GET /api/account/key-backup`), que só
   chega ao servidor depois de verificado (#36); "Manage" reabre os mesmos cartões do onboarding
   (`KeyBackupSteps.tsx`) para criar e verificar um novo. Sob NIP-07 a linha diz que a extensão
   guarda a chave e não há o que gerenciar. **Exceção: verificado mas não guardado (#200).** O protótipo só
   tem os estados verify e verified. Quando o arquivo abre mas o upload para a Account falha, o
   "Manage" não chega ao verified: título "Your backup file works", o card mantém "✓ Verified" com
   "Not saved to your Account yet." e um "Try again" no lugar do campo, o erro diz que o arquivo
   está certo e não foi guardado, e o rodapé fica em "Cancel" — "Done" só depois de guardado.
   **O mesmo vale no onboarding (#224)**, que roda a mesma regra e desenha os mesmos dois
   cartões: um upload que falha mantém o passo "download" com o cartão `unsaved` e o "Try again",
   em vez de seguir para o passo seguinte dizendo que está verificado. SIGN OUT traz o aviso do HTML e o "Delete my data"
   tintado, que abre o mesmo `SignOutDialog` do menu da conta (#148); "Send feedback" abre
   https://github.com/renatobardi/studio/issues/new em outra aba. **Exceção: NIP-05.** O Studio
   não emite handle NIP-05 no MVP, então a linha some de Settings e da tela `profile`, e o nome
   de baixo do avatar é o `npub` curto — emitir `nome@studio.oute.pro`: #162. Também de
   fora, por não existirem no MVP: "Avatar type" (Emoji/Image/Animated — o avatar é o emoji que o
   onboarding escolhe), Message/Huddle/Wave, as abas Info/Channels/Memories, "Joined" (a API de
   Members não guarda data de entrada), a seção More (Activity log, Agent instructions) e o campo
   "Avatar URL" do app antigo, que o HTML nunca teve.

9. **Settings › Appearance: Thread view e Link previews (#151).** "Thread view Focus/Split" entra
   como no HTML e é persistido com os demais (`web/src/lib/appearance.ts`, padrão **Split** — o
   comportamento que o app já tinha): Split abre a thread no painel lateral, Focus deixa a thread
   substituir a timeline (`web/src/lib/paneLayout.ts`). Abaixo de 600px o canal já é de uma coluna
   e a thread substitui a timeline de qualquer jeito — a preferência não briga com o breakpoint.
   "Send feedback" passa a fechar **todas** as seções de Settings, como no HTML, e não só Profile.
   **Exceção: Link previews (Compact/Rich).** Gerar preview exige buscar metadados de URLs de
   terceiros, o que vaza o IP do leitor a partir de um app fim-a-fim e pede um proxy nosso; até
   existir essa feature o controle fica **oculto**, não falso. Preview de link com proxy: #164.

10. **Copy das conversas (#153).** Placeholder do composer com o destino, como no HTML:
    `Message #<canal>` no Channel e `Message <nome>` na DM (`web/src/lib/conversationCopy.ts`);
    a dica fica só com "Enter to send · Shift+Enter for new line" e o aviso da DM passa a ser
    "Direct messages are end-to-end encrypted on this relay.". O "Photos up to N MB" não existe
    no HTML: sai da dica e o limite só aparece como erro ao anexar um arquivo grande
    (`validateAttachment`/`validateDmAttachment`), que já nomeia os 10 MB do Channel e os 5 MB da
    DM. **Exceção: identificador no header da DM.** O HTML mostra um e-mail/NIP-05
    (`ana@relay.studio`); sem NIP-05 no MVP (mesma razão de #150), o header mostra o `npub` curto
    (`shortNpub`), nunca hex — emitir handle NIP-05: **#162**.

11. **`new-message` fica só no preview, por enquanto.** O diálogo existe no protótipo
    (`dialog: "new-message"` em `docs/UI/design/Studio.dc.html`) e no app (`NewMessageDialog`,
    #142), e `preview.html?screen=new-message` já o monta — mas `web/tools/capture-reference.mjs`
    não tem estado para ele, então não há `docs/UI/reference/<viewport>/new-message.png`. Sem
    referência não há como **aceitar** um baseline: a regra do aceite visual é conferir o PNG do
    flow 10 contra o do protótipo, e `capture-reference.mjs` regrava a referência inteira, o que
    não cabe num PR de limpeza. Enquanto isso o `new-message` é uma tela de preview sem baseline —
    capturá-lo no protótipo e só então incluí-lo no flow 10 é trabalho do aceite visual (#154/#156).

12. **Aviso de versão nova (#203).** O protótipo não tem tela para isso. Quando um service worker
    novo assume uma página que um anterior carregou (ou há um esperando), o app mostra, sobre
    qualquer tela — onboarding incluído —, uma linha discreta no tom de popover, fixa no topo ao
    centro (longe do composer, que vive embaixo) e abaixo dos diálogos: "A new version of Studio is
    available.", um botão "Reload" e um "×" que a dispensa até a próxima carga. **Nunca recarrega
    sozinho**, nem sem rascunho: recarregar é sempre o clique da pessoa, então um rascunho no
    composer nunca se perde sem ela pedir — e não volta o reload no meio da sessão que quebrou o
    smoke do CD (`web/vite.config.ts`). A regra de quando avisar vive em `web/src/lib/appUpdate.ts`;
    a PWA instalada pergunta por versão nova ao voltar a ficar visível ou ao ganhar foco
    (`registration.update()`), não só na carga. Sem estado no `capture-reference.mjs`,
    fica fora do flow 10, como o `new-message` (Decisão 11).
13. **Conversa que abre abaixo do histórico completo (#231).** O protótipo não tem tela para isso.
    Uma conversa parada há mais de um dia fica abaixo de onde o histórico de Direct messages está
    completo (`completeFrom`, #185): antes ela abria como um painel vazio com um botão, ao lado de
    uma linha da sidebar que dizia haver conversa ali. Agora a abertura busca sozinha, com um
    limite de páginas por abertura (`DM_OPENING_PAGES`, `web/src/lib/dmPagination.ts`), e enquanto
    busca o painel mostra uma linha de meta centrada no lugar da lista vazia — "Looking for older
    messages…" — e, se a abertura gastar o limite sem alcançar a conversa, "Nothing from this
    conversation yet. Load older messages to keep looking."; qual das duas vive em
    `dmEmptyNotice` (`web/src/lib/conversationCopy.ts`). O botão "Load older messages" segue no
    topo, desabilitado enquanto a busca corre. Sem estado no `capture-reference.mjs`,
    fica fora do flow 10, como o `new-message` (Decisão 11) e o aviso de versão (Decisão 12).

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
disso com folga. Nada é mascarado além de segredos: as fixtures são fixas. **Tela com segredo
entra mascarada (#190):** o elemento que mostra a chave privada (`.nsec-reveal`, a nsec gerada em
runtime no onboarding) sai como bloco sólido, pintado por `web/e2e/mask-secrets.css` (`stylePath`
do `toHaveScreenshot`) — revelada ou borrada por CSS, nunca legível num PNG do repo, e nunca
estabilizada fixando uma chave. Não é o `mask` do Playwright: ele calcula a caixa ignorando o
`zoom` da escala de fonte e, em "larger", pintou ao lado da chave. Um segredo novo na UI entra
nesse CSS antes de ganhar baseline. Os baselines levam sufixo de plataforma
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

### Baseline × referência (issue #156)

O flow 10 compara o app com o app; `web/tools/compare-reference.mjs` mede quanto cada baseline
se afasta de `docs/UI/reference/<viewport>/<id>.png`. Para cada id de `matrix.json` com baseline
(desktop, `-dark` e mobile), gera um PNG de diff e a razão de pixels diferentes:

```sh
cd web
bun run compare:reference                        # baselines desta plataforma (-darwin no macOS)
bun run compare:reference -- --platform linux    # os -linux, como o CI
```

Saída em `web/test-results/reference-compare/`: `report.md` (tabela por tela, ids sem baseline no
fim) e `<viewport>-<id>.png` — referência esmaecida, pixels diferentes em vermelho, regiões
ignoradas em azul. Um pixel difere quando um canal RGB anda mais que `threshold` (0–1). Tamanhos
diferentes entram no relatório, sem métrica. Sem dependência nova: o PNG é lido pelo pngjs que o
`playwright-core` já exporta (`playwright-core/lib/utilsBundle`).

Regiões fora do MVP e o veredito do dono ficam em `docs/UI/reference/regions.json`, versionado:

```json
{
  "threshold": 0.1,
  "screens": {
    "channel": {
      "faithful": false,
      "tolerance": null,
      "ignore": {
        "desktop": [{ "x": 0, "y": 0, "width": 256, "height": 294, "label": "sidebar: search and Inbox/…/Compute" }],
        "mobile": []
      }
    }
  }
}
```

- `ignore` — retângulos em px da captura (1×), por viewport; a captura `-dark` usa os do id claro.
  Declarados olhando a referência: busca e nav (Inbox…Compute), Starred e Forums da sidebar,
  huddle/canvas/busca no cabeçalho, card de huddle, banner de quick bots, barra de agentes e
  "Start huddle", seção Agents dos membros, seções de Settings além de Appearance/Profile, cards de
  harness em onboarding-setup. Tela ausente do JSON: nada ignorado, só relatório.
- `faithful` / `tolerance` — **só relatório por enquanto**: todas as telas saem `false`/`null`.
  Quando o dono decide que uma tela é fiel, marca `faithful: true` e a `tolerance` (razão 0–1;
  `null` = zero); aí a tela acima da tolerância, ou com tamanho diferente, faz o script sair 1.

No CI o job `visual` roda a comparação dos `-linux` **antes** do flow 10 (que roda como root no
container e limpa `web/test-results`) e publica `report.md` + diffs no artefato `reference-compare`
em todo run (`if: always()`). O flow 10 roda mesmo se a comparação falhar.

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
