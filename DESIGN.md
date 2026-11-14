---
name: Zeltter
description: Crypto inheritance vault on NEAR, drawn as a clock rather than a dashboard.
colors:
  ground: "#f3ece6"
  paper: "#fefaf2"
  ink: "#1f1f1f"
  muted: "#575757"
  field: "#b8312a"
  on-field: "#fbeee6"
  on-field-muted: "#f9e2d9"
  ok: "#2f6b3a"
  warn: "#8a5300"
  line: "rgba(31, 31, 31, 0.12)"
  line-strong: "rgba(31, 31, 31, 0.24)"
  on-field-line: "rgba(251, 238, 230, 0.28)"
typography:
  display:
    fontFamily: "\"Stack Sans Headline\", system-ui, sans-serif"
    fontSize: "clamp(2.75rem, 5.4vw, 4.5rem)"
    fontWeight: 600
    lineHeight: 0.98
    letterSpacing: "-0.035em"
  clock:
    fontFamily: "\"Stack Sans Headline\", system-ui, sans-serif"
    fontSize: "clamp(3.25rem, 8vw, 6rem)"
    fontWeight: 600
    lineHeight: 0.95
    letterSpacing: "-0.03em"
    fontFeature: "\"tnum\" 1"
  headline:
    fontFamily: "\"Stack Sans Headline\", system-ui, sans-serif"
    fontSize: "40px"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.025em"
  title:
    fontFamily: "\"Stack Sans Headline\", system-ui, sans-serif"
    fontSize: "22px"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.01em"
  lead:
    fontFamily: "\"Stack Sans Text\", system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 400
    lineHeight: 1.625
  body:
    fontFamily: "\"Stack Sans Text\", system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "\"Stack Sans Text\", system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 500
    lineHeight: 1.43
  hint:
    fontFamily: "\"Stack Sans Text\", system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.375
rounded:
  field: "10px"
  row: "12px"
  card: "16px"
  pill: "9999px"
spacing:
  gutter-mobile: "20px"
  gutter-tablet: "40px"
  gutter-desktop: "64px"
  section: "32px"
  band-mobile: "40px"
  band-desktop: "64px"
  control-sm: "36px"
  control: "44px"
  control-lg: "48px"
components:
  button-ink:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    typography: "{typography.body}"
    rounded: "{rounded.pill}"
    padding: "0 20px"
    height: "{spacing.control}"
  button-ink-hover:
    backgroundColor: "#000000"
    textColor: "{colors.paper}"
  button-line:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "0 20px"
    height: "{spacing.control}"
  button-line-hover:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
  button-paper:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "0 28px"
    height: "{spacing.control-lg}"
  button-paper-hover:
    backgroundColor: "#ffffff"
    textColor: "{colors.ink}"
  button-on-field:
    backgroundColor: "transparent"
    textColor: "{colors.on-field}"
    rounded: "{rounded.pill}"
    padding: "0 24px"
    height: "{spacing.control-lg}"
  button-sm:
    rounded: "{rounded.pill}"
    padding: "0 16px"
    height: "{spacing.control-sm}"
  input:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.field}"
    padding: "0 12px"
    height: "{spacing.control}"
  link-card:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
    padding: "16px 20px"
  toast:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
    padding: "16px 20px"
  vault-row-selected:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.row}"
    padding: "12px"
  network-pill:
    backgroundColor: "transparent"
    textColor: "{colors.muted}"
    rounded: "{rounded.pill}"
    padding: "0 12px"
    height: "32px"
---

# Design System: Zeltter

## Overview

**Creative North Star: "The Vault Is a Clock"**

Every screen is a split: a quiet cream work column where the owner, guardian or heir reads and edits, and a committed deep-red field that holds the vault's timeline. The field is not decoration; it is the one thing every role needs to read first (how long, what phase, what can happen next), set as a very large tabular countdown above a heartbeat line that beats while the owner checks in, goes flat once they stop, and carries a live point for now.

The world is warm, quiet and print-like. Cream ground, near-black ink, a single grey for secondary voice, hairline rules instead of boxes, pill buttons, plain paper fields. Density is calm: one column of sections separated by rules, generous gutters, one primary action per field. It explicitly refuses the crypto-dashboard default of card grids, balance hero metrics and dark neon; no gradients and no glow.

Motion is restrained to one authored gesture: the heartbeat. The line draws itself in, the now-point pulses, and nothing else on the page performs.

**Key Characteristics:**
- Split layout: cream work column left, full-height red field right (field stacks above the work on mobile for owner and watcher views).
- Split-colour hero headline: ink, then the same sentence continuing in grey.
- Huge tabular countdown as the field's anchor, never a balance.
- Hairline rules (ink at 12%) carry all structure; paper surfaces are rare and flat.
- Ink pill on cream, paper pill on red: one action per surface.

## Colors

A two-ground palette: warm cream for work, one saturated brick red for the clock, with near-black ink and a single grey doing all the typographic work.

### Primary
- **Brick Field Red** (field): the full-height field that holds the vault clock on every screen; also the only colour for errors, invalid field borders, destructive links, a share total that is off, released status, the caret and text selection.

### Neutral
- **Warm Cream Ground** (ground): page background, sticky top bar, busy overlay (at 90%), browser theme colour.
- **Paper** (paper): the slightly lighter raised surface: inputs, the on-chain link card, the toast, the selected vault row, notices, the primary button on the red field, and button text on ink.
- **Near-Black Ink** (ink): all primary text, the primary pill on cream, focus outlines, active tab underline.
- **Quiet Grey** (muted): secondary text, hints, the continuation of the split headline, inactive tabs, definition-list terms.
- **Cream on Red** (on-field) and **Blush on Red** (on-field-muted): primary and secondary text inside the field; the current phase label is on-field, the others on-field-muted.
- **Hairline** (line), **Strong Hairline** (line-strong), **Field Hairline** (on-field-line): section rules and list dividers; outline buttons, field strokes and the network pill; dividers and outline buttons inside the red field.

### Tertiary (status only)
- **Moss** (ok): owner-is-checking-in status, the network dot, a share total that adds to 100%.
- **Amber Ochre** (warn): missed check-in and silent-past-fallback status in the vault list.

### Named Rules
**The One Field Rule.** Red appears as one committed field per screen, holding the vault clock. Outside the field, red is only ever a signal (error, invalid, destructive, released); it is never a fill, badge or accent in the work column.

**The One Grey Rule.** Hierarchy in text comes from ink versus one grey (muted) and from weight, not from a ladder of greys or tinted text.

## Typography

**Display Font:** Stack Sans Headline (with system-ui, sans-serif), weight 600
**Body Font:** Stack Sans Text (with system-ui, sans-serif), weights 400, 500, 600
**Icons:** Material Symbols Outlined, 18px, weight 400, unfilled

**Character:** A tight, confident grotesk headline face set with negative tracking against a plain, friendly text face of the same family; the pairing reads like a well-set public notice.

### Hierarchy
- **Display** (600, clamp 2.75rem to 4.5rem, 0.98): the landing headline only, max 16ch, set in two colours.
- **Clock** (600, clamp 3.25rem to 6rem, 0.95, tabular): the countdown at the top of the red field; also "Silent" and "Released" states.
- **Headline** (600, 40px, 1.25): the page title of each app view.
- **Title** (600, 22px, 1.25): section titles in the work column, the wordmark, the busy-overlay message.
- **Lead** (400, 17px, 1.625): the landing sentence (max 46ch) and the plain-language summary in the setup field (max 40ch).
- **Body** (400, 15px, 1.5): everything else; buttons at 15px 500, large buttons at 16px.
- **Label** (500, 14px): field labels and small text actions.
- **Hint** (400, 13px): field hints, phase labels under the heartbeat line, network pill.

### Named Rules
**The Split Headline Rule.** The persuasive hero headline is one sentence in two colours: the claim in ink, its consequence in muted grey. App page headlines stay single-colour ink.

**The Tabular Rule.** Every countdown, amount, percentage, address, account id and date is set in tabular numerals so values never jitter as the clock ticks.

## Layout

The page is a 64px sticky top bar (wordmark left; tabs centred from md up; network pill and account or connect pill right) over a split. From lg up the split is two columns at 1.15fr : 1fr, the work column on the left with content capped at 640px, the red field on the right, full viewport height minus the bar, its content sticky and vertically centred. Below lg the split stacks into one column; owner and watcher views put the field first so the clock is the first thing read, while landing and setup keep the work first.

Gutters step 20px, 40px (sm), 64px (lg) in the work column and 20px, 40px, 56px in the field; vertical bands are 40px, rising to 64px at lg. Work-column content is a stack of sections, each 32px top and bottom with a hairline rule above (none on the first). Prose is capped between 36ch and 52ch. On mobile the tabs move to their own 44px row under the bar.

### Named Rules
**The Clock-First Rule.** Every app screen has a field, and every field holds the vault clock (real, preview or labelled example). No screen ships without the timeline.

## Elevation & Depth

Flat by default. Depth comes from the two grounds (cream against red) and from paper sitting slightly lighter than cream. Only paper elements that float or invite a click carry a soft, ambient ink shadow; nothing is outlined and shadowed at once, and there is no glow.

### Shadow Vocabulary
- **Link card rest** (`box-shadow: 0 1px 2px rgba(31,31,31,0.06), 0 8px 24px -12px rgba(31,31,31,0.18)`): the on-chain contract link on the landing.
- **Link card hover** (`box-shadow: 0 1px 2px rgba(31,31,31,0.08), 0 12px 28px -12px rgba(31,31,31,0.28)`).
- **Toast** (`box-shadow: 0 2px 4px rgba(31,31,31,0.06), 0 16px 40px -16px rgba(31,31,31,0.35)`): the bottom-right notification.
- **Field focus ring** (`box-shadow: 0 0 0 3px rgba(31,31,31,0.1)`): inputs on focus, with the stroke going to ink.

### Named Rules
**The Hairline Rule.** Structure is drawn with rules, not containers. Sections, list rows and address rows are separated by hairlines; no cards in cards.

## Shapes

Round where the hand acts, square where the page is structured. Every button, the network pill and the status dot are full pills; fields have gently rounded 10px corners; the selected vault row and inline notices round to 12px; floating paper (link card, toast) to 16px. The two grounds, sections and the red field are hard-edged and full-bleed. The heartbeat line uses round joins and caps, a 2px stroke, faint phase dividers and a dotted future track.

## Components

### Buttons
Soft, confident pills; one primary per surface.
- **Shape:** full pill, 44px tall (36px small, 48px large in fields and the hero).
- **Ink (primary on cream):** ink fill, paper text, 15px medium; hover goes to pure black.
- **Paper (primary on red):** paper fill, ink text, 48px tall with 28px sides; hover goes to white. The owner's check-in carries a heart icon.
- **Line (secondary on cream):** transparent with a strong hairline stroke; hover fills paper and the stroke goes to ink. Also used as the square 44px icon button for removing rows.
- **On-field (secondary on red):** transparent with the field hairline stroke and cream text; hover strengthens the stroke and adds an 8% cream wash.
- **Press / Disabled:** press scales to 0.98 over 160ms with an expo-out ease; disabled sits at 50% opacity.
- **Focus:** 2px ink outline at 2px offset; cream outline on the red field.
- **Text actions:** "Edit" and "Delete this vault" are underlined 14px medium text, the delete in field red.

### Cards / Containers
- **Link card:** paper, 16px corners, 16px by 20px padding, max 440px, title plus a grey tabular contract id, an outward-arrow icon that nudges up-right on hover, soft ambient shadow.
- **Notice:** paper, 12px corners, 16px padding, 14px text, with a small line button.
- No other cards: lists and settings live on the ground between hairlines.

### Inputs / Fields
- **Style:** paper fill, strong hairline stroke, 10px corners, 44px tall, 12px sides, 15px ink text; addresses and numbers tabular.
- **Hover / Focus:** stroke darkens on hover; on focus the stroke goes to ink with a 3px ink-at-10% ring, no outline.
- **Error:** stroke turns field red (aria-invalid).
- **Select:** same field with a custom ink chevron.
- **Label / Hint:** 14px medium ink label above, 13px grey hint below.

### Navigation
- **Top bar:** cream, sticky, hairline below, 64px. Wordmark in the headline face, 22px.
- **Tabs:** 15px text with a 2px underline sitting on the bar's rule; active is ink and medium, inactive grey turning ink on hover. On mobile they sit in a second 44px row, left-aligned.
- **Network pill:** 32px outlined pill with a moss dot and 13px grey label.
- **Account:** small line pill with a truncated tabular account id and a logout icon.

### Vault Clock (signature)
The red field's content, top to bottom: the clock numeral with a one-line caption beneath (on-field-muted, max 36ch); the heartbeat line (400 by 72 viewBox, four equal phases: Heartbeat, Guardians approve, Waiting period, Released) with the current phase label in on-field semibold and the others muted, each with its tabular length; the action row (at most one paper pill plus an optional on-field outline pill, or a sentence saying there is nothing to do); and a footer under a field hairline naming the vault, its status and the last check-in. While loading it shows the line without a live point and dashes in place of numbers.

### Vault List
Rows between hairlines; each row is a full-width button with owner, live countdown, the viewer's role(s) and the phase name coloured by status (moss, ochre or red). The selected row fills paper with 12px corners; others wash paper at 60% on hover.

### Toast and Busy Overlay
The toast is a 380px paper card bottom-right (full width on mobile) that rises 16px and fades in over 300ms; error titles are field red. The busy overlay covers the page in cream at 90% with the ink spinner and a 22px headline-face message.

## Do's and Don'ts

### Do:
- **Do** give every app screen the split, with the vault clock in the red field.
- **Do** set every number, address and account id in tabular numerals.
- **Do** keep one primary pill per surface: ink on cream, paper on red.
- **Do** separate sections and rows with 12% ink hairlines and 32px section padding.
- **Do** keep the heartbeat (line draw and now-point pulse) as the only ambient motion, and drop it under reduced motion.
- **Do** label any synthetic clock as an example.

### Don't:
- **Don't** use red in the work column except as an error, invalid, destructive or released signal.
- **Don't** put cards in cards or lay out content as card grids.
- **Don't** make a balance or portfolio total the hero number; the big numeral is time.
- **Don't** use gradients, glows or dark neon surfaces.
- **Don't** add more greys or tinted text tiers beyond ink and muted.
