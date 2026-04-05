# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the game

### Active codebase (TypeScript rebuild)

```bash
npm install
npm run dev
```

Opens at `http://localhost:5173`. Entry point is `src/main.ts`. Svelte components live in `src/components/`. Built with Vite — no manual refresh needed.

**Source lives in `src/`.** Do not edit anything outside this folder (except config files at repo root: `package.json`, `vite.config.ts`, `tsconfig.json`, `svelte.config.js`).

**GitHub Pages** is served from `docs/`. To deploy: `npm run build` then copy `dist/` → `docs/`, commit, push.

### midigame (stable vanilla JS reference — not in this repo)

The original vanilla JS prototype lives locally at `../midigame/`. Read-only reference. Open `index.html` directly in Chrome/Edge.

## In-game console commands

Accessed via the text input at the bottom of the screen:
- `help` — full command list
- `resetall` — wipe localStorage and reload
- `idkfa` — +5000 pts cheat
- `idclip` — advance one level
- `iddqd` — max level + unlock shop

Game state persists to `localStorage` under a `SAVE_KEY` constant.

## Architecture

The codebase is a TypeScript/Vite/Svelte 5 rebuild of the original `midigame/` prototype. Same game concept, cleaner architecture.

**Key source files:**

| File | Responsibility |
|------|---------------|
| `src/main.ts` | Bootstrap — wires all systems, save/load, QWERTY input |
| `src/App.svelte` | HUD, challenge display, dev console, game controls |
| `src/components/ClockPanel.svelte` | Transport bar (play, BPM, key/scale, EXT, CC learn) |
| `src/components/MenuPanel.svelte` | Settings panel |
| `src/components/ShopPanel.svelte` | Shop UI (Svelte component) |
| `src/game/GameState.ts` | Observable state object; use `state.set(key, val)` to trigger subscribers |
| `src/game/GameEngine.ts` | Chord detection, scoring, level progression |
| `src/audio/AudioGraph.ts` | Core Web Audio wiring, polyphonic voices, driver dispatch |
| `src/audio/FxModules.ts` | FX_DRIVERS registry (mixer, lfo, delay, filter, adsr-x2, etc.) |
| `src/audio/OscModules.ts` | OSC_PARAM_HANDLERS registry; tri/sq wave state |
| `src/audio/DrumVoices.ts` | DRUM_DRIVERS registry |
| `src/audio/Sequencers.ts` | Transport, step sequencer firing, SEQ_DRIVERS registry |
| `src/core/ModuleRegistry.ts` | Single source of truth for modules/patches; fires events |
| `src/ui/UIRenderer.ts` | Spawns and manages synth panel DOM |
| `src/ui/PatchSystem.ts` | Cable drag + canvas drawing |
| `src/input/NoteRouter.ts` | Routes MIDI/QWERTY → NoteEvents; also routes CC messages |
| `src/input/MidiLearnSystem.ts` | Maps MIDI CC numbers to synth knob params |
| `src/config/modules.ts` | Module definitions; always use `getModuleDef(type)` |
| `src/types.ts` | All shared types including SaveFile |

**Svelte reactivity rule:** `GameState` is a plain class. Templates must mirror fields into local `$state` vars and subscribe via `gs.on('field', v => { localVar = v; })` in `onMount`. Reading `gs.field` directly in a template only captures the initial value.

**MIDI Learn flow:** CC button on transport → active mode → click a synth knob → twiddle encoder → mapping stored in `MidiLearnSystem._map`. Saved as `synth.midiCCMap` in localStorage.

**AudioGraph driver architecture:** AudioGraph holds only core infrastructure (`voices`, `masterGain`, `dryBus`, `seqPlayheads`, `drumNoiseBuffers`). All module node state lives in module-scoped Maps inside the driver files. To add a new module type: implement a driver, add one entry to the relevant registry (FX_DRIVERS / SEQ_DRIVERS / DRUM_DRIVERS) — AudioGraph needs no changes.

**Data flow:**
```
MIDI/QWERTY noteOn → NoteRouter → AudioGraph.playNote + GameEngine.checkSuccess
CC message        → NoteRouter → MidiLearnSystem.handleCC → registry.setParam
registry events   → AudioGraph (node wiring) + UIRenderer (panel DOM) + PatchSystem (jack registration)
GameState.set()   → subscribers (main.ts listeners, Svelte onMount handlers)
```

## Key design constraints

- `GAME_CONFIG` in `src/config/game.ts` is the single source of truth for all tunable game values. No magic numbers in game logic.
- `getModuleDef(type)` in `src/config/modules.ts` is the only correct way to look up module definitions — it merges `CATEGORY_PORT_DEFAULTS` with per-module overrides.
- The canvas uses two layers: `#c` (main, psychedelic visuals + keyboard) and `#pc` (patch canvas, drawn on top so cables/jacks/keyboard appear above panels).
