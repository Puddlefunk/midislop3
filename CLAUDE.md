# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the game

### midislop3/site (active TypeScript rebuild)

```bash
cd midislop3/site
npm install
npm run dev
```

Opens at `http://localhost:5173`. Entry point is `src/main.ts`. Svelte components live in `src/components/`. Built with Vite — no manual refresh needed.

**Source lives in `midislop3/site/src/`.** Do not edit anything outside this folder.

### midigame (stable vanilla JS reference)

Open `midigame/index.html` directly in a browser that supports Web MIDI API (Chrome/Edge). No npm, no bundler, no server required. `index.html` loads `scripts.js` (a legacy prototype) — the current active code is the split-file version using `app.js`, `audio.js`, `config.js`, `synth-ui.js`, and `style.css`.

For MIDI input you need a physical controller or virtual MIDI device. QWERTY keyboard (Z/X to shift octave) and on-screen piano also work.

## In-game console commands

Accessed via the text input at the bottom of the screen:
- `help` — full command list
- `resetall` — wipe localStorage and reload
- `idkfa` — +5000 pts cheat
- `idclip` — advance one level
- `iddqd` — max level + unlock shop

Game state persists to `localStorage` under a `SAVE_KEY` constant.

## Architecture — midislop3/site (active)

The active codebase is a TypeScript/Vite/Svelte 5 rebuild of `midigame/`. Same game concept, cleaner architecture.

**Key source files:**

| File | Responsibility |
|------|---------------|
| `src/main.ts` | Bootstrap — wires all systems, save/load, QWERTY input |
| `src/App.svelte` | HUD, challenge display, dev console, game controls |
| `src/components/ClockPanel.svelte` | Transport bar (play, BPM, key/scale, EXT, CC learn) |
| `src/components/MenuPanel.svelte` | Settings panel |
| `src/game/GameState.ts` | Observable state object; use `state.set(key, val)` to trigger subscribers |
| `src/game/GameEngine.ts` | Chord detection, scoring, level progression |
| `src/audio/AudioGraph.ts` | Web Audio nodes, patching, polyphonic voices |
| `src/audio/Sequencers.ts` | Transport, step sequencer firing |
| `src/core/ModuleRegistry.ts` | Single source of truth for modules/patches; fires events |
| `src/ui/UIRenderer.ts` | Spawns and manages synth panel DOM |
| `src/ui/PatchSystem.ts` | Cable drag + canvas drawing |
| `src/input/NoteRouter.ts` | Routes MIDI/QWERTY → NoteEvents; also routes CC messages |
| `src/input/MidiLearnSystem.ts` | Maps MIDI CC numbers to synth knob params |
| `src/config/modules.ts` | Module definitions; always use `getModuleDef(type)` |
| `src/types.ts` | All shared types including SaveFile |

**Svelte reactivity rule:** `GameState` is a plain class. Templates must mirror fields into local `$state` vars and subscribe via `gs.on('field', v => { localVar = v; })` in `onMount`. Reading `gs.field` directly in a template only captures the initial value.

**MIDI Learn flow:** CC button on transport → active mode → click a synth knob → twiddle encoder → mapping stored in `MidiLearnSystem._map`. Saved as `synth.midiCCMap` in localStorage.

**Data flow:**
```
MIDI/QWERTY noteOn → NoteRouter → AudioGraph.playNote + GameEngine.checkSuccess
CC message        → NoteRouter → MidiLearnSystem.handleCC → registry.setParam
registry events   → AudioGraph (node wiring) + UIRenderer (panel DOM) + PatchSystem (jack registration)
GameState.set()   → subscribers (main.ts listeners, Svelte onMount handlers)
```

---

## Architecture — midigame (vanilla JS reference)

The game is `M1D1SL0P2` — a chord training game where players earn score by playing chord challenges on a MIDI keyboard, then spend score on synthesiser modules that become part of the instrument they play.

**Five source files, 19 numbered sections:**

| File | Sections | Responsibility |
|------|----------|---------------|
| `config.js` | S1–S5 | Note helpers, `GAME_CONFIG` (levels/scoring/prices), `MODULE_TYPE_DEFS`, `SHOP_DEFS`, `CHORD_POOL` |
| `audio.js` | S6–S7 | `ModuleRegistry` (data model), `AudioGraph` (Web Audio nodes) |
| `synth-ui.js` | S8–S10 | `UIRenderer` (DOM panels), `PatchSystem` (cable drag), `ShopSystem` |
| `app.js` | S11–S19 | Visualiser (canvas/particles/flower), game engine, input handlers, bootstrap |
| `index.html` | — | Layout only; no static synth panels (panels are spawned dynamically) |

**Data flow:**
```
MIDI/QWERTY noteOn → onNoteOn → audioGraph.playNote + runDetection
runDetection → Chord.detect → gameEngine.checkSuccess
checkSuccess → addScore → levelUp → registry.addModule(type) → shop unlocked
registry events → AudioGraph (node wiring) + UIRenderer (panel DOM) + PatchSystem (jack registration)
```

**ModuleRegistry** is the single source of truth. It fires `module-added`, `module-removed`, `param-changed`, `patch-changed` events. AudioGraph and UIRenderer are subscribers — they never own state, they react to the registry. Ownership is read from `registry.modules`, not from the DOM.

**AudioGraph** creates Web Audio nodes per module instance, keyed by registry ID. On `patch-changed` it disconnects old connections and applies new ones. Polyphonic voices are managed inside `AudioGraph`.

**PatchSystem** maintains a persistent `jackRegistry` Map (not rebuilt per frame). Cable drawing reads from `registry.patches` + `jackRegistry`. Clicking jacks calls `registry.addPatch` / `registry.removePatch`.

**Module IDs** are `${type}-${index}` (e.g. `osc-sine-0`, `osc-sine-1`). Multiple instances of the same type are fully independent in all three systems.

**Signal types:** Ports are either `audio` or `cv` (modulation). The type is inferred from port name — `cv`, `*-cv`, `cv-*`, and `cvo-*` are CV; everything else is audio. Incompatible types are rejected on connect.

## Key design constraints

- `GAME_CONFIG` in `src/config/game.ts` (TS) / `config.js` (JS) is the single source of truth for all tunable game values. No magic numbers in game logic.
- `getModuleDef(type)` in `src/config/modules.ts` is the only correct way to look up module definitions — it merges `CATEGORY_PORT_DEFAULTS` with per-module overrides.
- The `spec docs/` folder contains three authoritative design specs: `self-spec.txt` (full architecture + 6-stage migration plan), `patch-spec.txt` (signal graph model), `balance-spec.txt` (difficulty system). Read these before making structural changes.
- The canvas uses two layers: `#c` (main, psychedelic visuals + keyboard) and `#pc` (patch canvas, drawn on top so cables/jacks/keyboard appear above panels).
- The `floweroflife/` and `alt patterns/` folders contain reference images for the flower-of-life visualiser background.
