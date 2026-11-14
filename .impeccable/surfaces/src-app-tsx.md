---
version: 1
slug: "src-app-tsx"
primary_target: "src/App.tsx"
related_targets: []
---

# Surface: Zeltter app (src/App.tsx)

Scope: the whole single-page app: landing (not connected), Set up, My vault, Inheriting. Mode: Operate (landing first viewport leans Persuade but stays inside the app shell).
Audience: crypto holders setting up inheritance once and pinging occasionally; guardians and heirs acting on someone else's vault.
Constraints: user pinned the Framer "Foyer" template's direction (warm cream, near-black ink, split layout, split-colour H1, one action, quiet). No template photo. CRA + Tailwind 3. All existing functions stay.

## Direction contract

THESIS: A vault is a clock, not a dashboard. Each screen splits into a quiet cream work column and a committed red field holding the vault's timeline, the one thing every role needs to read first. Refuses the crypto-dashboard default of card grids, balance hero metrics and dark neon.

OWN-WORLD: Cream ground #f3ece6, paper surface #fefaf2, ink #1f1f1f, secondary #575757, signature field deep red #b8312a with cream ink on it. Stack Sans Headline for display, Stack Sans Text for UI and body, tabular numerals for countdowns and amounts. Hairline rules (ink at 12%), pill primary buttons in ink, plain fields, no cards-in-cards, no gradients, no glow.

STORY: Visitor understands "if I go quiet, my crypto goes only to the people I chose, and I can always stop it in time", sets up guardians, heirs and timers, then pings. Guardians and heirs see one available action.

FIRST VIEWPORT: Top bar: wordmark left, network pill and account/connect right, tabs centred when connected. Below, a split: left 55% cream column with the split-colour H1 (ink then grey), one sentence, one primary pill (Connect wallet / Set up a vault), a link card to the live contract; right 45% full-height red field with the vault timeline (synthetic example, labelled) and a large tabular countdown.

FORM: pinned brief (Foyer split layout), signature move: the vault timeline drawn as a heartbeat track (heartbeat, approval/fallback, waiting, released) with a live now-marker; it reappears as the real clock in My vault, the live preview in Set up, and the selected vault in Inheriting. seed: none (no roll: the user pinned the Foyer direction, so concept-seed was not run). Tabs get their own row under the bar on mobile; centred in the bar from md up.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
