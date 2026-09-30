---
name: Remote Console
description: A focused dispatch sheet for waking one PC and opening its remote desktop.
colors:
  canvas: '#f3f1eb'
  paper: '#fffcf7'
  ink: '#242b27'
  muted-ink: '#526058'
  rule: '#d8ddd5'
  command-blue: '#284ca8'
  command-hover: '#1a397e'
  command-white: '#ffffff'
  focus-ochre: '#b9681e'
  idle-slate: '#68766e'
  waiting-ochre: '#a66c20'
  ready-green: '#277361'
  fault-red: '#b0443d'
  alert-paper: '#fff0eb'
  alert-line: '#eac9bf'
  alert-ink: '#903b33'
  disabled-paper: '#e6e9e3'
  disabled-ink: '#47554f'
typography:
  display:
    fontFamily: 'LINE Seed JP, ui-sans-serif, system-ui, sans-serif'
    fontSize: '58px'
    fontWeight: 700
    lineHeight: 1.23
    letterSpacing: '-0.035em'
  headline:
    fontFamily: 'LINE Seed JP, ui-sans-serif, system-ui, sans-serif'
    fontSize: '25px'
    fontWeight: 700
    lineHeight: 1.4
    letterSpacing: '-0.025em'
  command:
    fontFamily: 'LINE Seed JP, ui-sans-serif, system-ui, sans-serif'
    fontSize: '16px'
    fontWeight: 700
    lineHeight: 1.5
  body:
    fontFamily: 'LINE Seed JP, ui-sans-serif, system-ui, sans-serif'
    fontSize: '16px'
    fontWeight: 400
    lineHeight: 1.75
  support:
    fontFamily: 'LINE Seed JP, ui-sans-serif, system-ui, sans-serif'
    fontSize: '13px'
    fontWeight: 400
    lineHeight: 1.75
rounded:
  mark: '7px'
  command: '8px'
  sheet: '12px'
  signal: '50%'
spacing:
  compact: '14px'
  regular: '24px'
  mobile-inset: '28px'
  sheet-inset: '48px'
components:
  primary-command:
    backgroundColor: '{colors.command-blue}'
    textColor: '{colors.command-white}'
    typography: '{typography.command}'
    rounded: '{rounded.command}'
    padding: '15px 21px'
  primary-command-hover:
    backgroundColor: '{colors.command-hover}'
  primary-command-disabled:
    backgroundColor: '{colors.disabled-paper}'
    textColor: '{colors.disabled-ink}'
    rounded: '{rounded.command}'
  status-sheet:
    backgroundColor: '{colors.paper}'
    textColor: '{colors.ink}'
    rounded: '{rounded.sheet}'
  status-signal:
    backgroundColor: '{colors.idle-slate}'
    rounded: '{rounded.signal}'
    size: '9px'
  error-notice:
    backgroundColor: '{colors.alert-paper}'
    textColor: '{colors.alert-ink}'
    rounded: '{rounded.command}'
    padding: '15px 17px'
  button-refresh:
    backgroundColor: 'transparent'
    textColor: '{colors.muted-ink}'
    rounded: '{rounded.mark}'
    height: '44px'
  details-trigger:
    backgroundColor: 'transparent'
    textColor: '{colors.muted-ink}'
    height: '56px'
---

# Design System: Remote Console

## Overview

**Creative North Star: "The Dispatch Sheet"**

Remote Console is a quiet, single-purpose operation sheet. A person away from home reads the one machine's state, sends a wake request if needed, and enters the remote desktop when it responds. Warm paper and dark ink provide the stable field; one blue command carries the next available action. The sheet is not a simulated paper texture or a dashboard of separate cards. It is a clear sequence of state, action, and supporting evidence.

**Key Characteristics:**

- One continuous sheet with a small checking line, a large state, and a single command row.
- Restrained state colors on a written signal; never color alone.
- Warm neutral ground, white paper, quiet rules, and a blue action that is present only when usable.
- Connection mechanics and wake history behind a native disclosure below the task.

## Colors

The frontmatter is the source of truth for color values. Canvas and paper separate the page from its one operative sheet; ink and muted ink carry the reading hierarchy.

### Primary

- **Command Blue:** the executable wake, retry, or remote-desktop action. Its darker partner is hover only; white text stays legible on both.

### Secondary

- **State Slate, Ochre, Green, and Red:** the checking dot for offline/unknown, starting, ready, and error. Each appears beside an explicit Japanese status or checking message.
- **Focus Ochre:** a three-pixel keyboard outline on every interactive control.
- **Alert Paper, Line, and Ink:** a bounded communication or wake failure notice, separate from the primary command.

### Neutral

- **Canvas, Paper, Ink, Muted Ink, and Rule:** the five-part page, sheet, text, secondary text, and divider vocabulary.
- **Disabled Paper and Ink:** a waiting or cooldown control that remains readable but cannot be activated.

**The Action-Only Blue Rule.** The saturated blue is reserved for an available primary action, not metadata or decorative progress.

## Typography

**Display and UI family:** self-hosted LINE Seed JP in regular and bold, with system sans fallbacks. Japanese status text must stay easy to scan at a glance; timestamps use tabular numerals.

### Hierarchy

- **Display:** bold 58px on desktop for the current state. It steps to 42px under 620px, 38px under 390px, and 33px under 360px to keep the longest status on one line at 320px.
- **Headline:** bold 25px for the PC name, 23px on narrow screens.
- **Command:** bold 16px for the primary action, 15px on the narrowest screens.
- **Body:** regular 16px for the state explanation, 15px on mobile.
- **Support:** regular 13px for checking, notes, history, and controls.

**The State First Rule.** The state word is the largest text on the sheet; explanation follows it, without a preceding kicker.

## Layout

The header spans at most 1120px with an 88px desktop height. The main column spans at most 960px and opens with the PC name. One sheet follows: the checking line and timestamp at the top, the large state in the middle, and a two-column action/note row below one rule. Desktop insets are 48px. At 620px, the command and note stack, the inset becomes 28px, and the status remains above the action. At 390px, the outer gutter is 16px; at 360px, display type reduces again rather than wrapping the longest state awkwardly. Connection and wake details stay in a native disclosure below the sheet.

**The One Next Step Rule.** Never place wake and remote-desktop actions side by side. The available control changes with the server state.

## Elevation & Depth

The page is nearly flat. The paper sheet alone has a broad, low offset shadow (`0 25px 50px -42px #303b345c`); it has no border beneath that shadow. The available blue command gets a smaller offset shadow (`0 12px 22px -16px #1a397e99`), deepening on hover. Rules and tonal difference handle all other separation.

## Shapes

The main sheet has a modest 12px corner. Buttons and alerts use 8px; the brand outline and refresh control use 7px. The status signal is a 9px circle. No decorative meters, imitation paper grain, or nested cards.

## Components

### Primary command

A full-width, left-aligned button or link within its action column. Minimum height is 72px on desktop, 64px on mobile; the icon trails the action name. Hover darkens and lifts one pixel, press settles one pixel, keyboard focus uses Focus Ochre. Disabled waiting and cooldown states lose blue and shadow. Ready is a secure new-tab link to the server-provided HTTPS URL, never a wake button.

### Refresh control

The header control stays neutral with a 44px touch target. Hover adds a paper fill and fine rule; while fetching, it cannot be activated again. At narrow widths only the icon is visible, but the accessible label remains.

### Status sheet

The checking line and last-check time sit above the large state. The dot changes with the state, while the word and explanation carry the meaning. Status text makes one brief 220ms transition on change; only the starting dot breathes while the server checks for RDP. Reduced-motion users see static states.

### Error notice

An inline alert appears between the state and action row when the API or wake request fails. It names the failed operation, shows the server message and request ID when available, and replaces the primary action with a retry. The old ready link is not left actionable after a failed status check.

### Connection details

A native disclosure below the sheet exposes last wake time and Cloudflare Access. Its 56px summary row is touch-friendly; timestamps remain tabular. The primary task never depends on opening it.

## Do's and Don'ts

### Do:

- **Do** make the current state and one next action visible on the first mobile viewport.
- **Do** keep checking time and connection details secondary but available.
- **Do** preserve readable disabled states, keyboard focus, and reduced-motion behavior.

### Don't:

- **Don't** infer that a silent RDP port proves the PC is powered off; say it is offline or unresponsive.
- **Don't** use blue for inactive controls or show a ready link when the latest status request has failed.
- **Don't** turn the sheet into a grid of cards, a progress meter, or a decorative paper imitation.
