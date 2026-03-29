# M1D1SL0P2 — Retrospective & Rebuild Plan

*Written March 2026. Current build: ~6500 lines across 5 files, no build step, vanilla JS.*

---

## 1. What we built and how it's structured

### The good architecture decisions

**ModuleRegistry as single source of truth.** The event-driven model (`module-added`, `param-changed`, `patch-changed`) with AudioGraph and UIRenderer as pure subscribers is the right call. It's what made multiplayer sync straightforward — the registry snapshot is the entire synth state. Keep this pattern.

**Signal type system.** Audio / CV / Note as distinct port types with jack shapes and cable colours. Diamond jacks for note, round for CV/audio. The type rejection at patch time prevents nonsense connections. Good foundation for a more expressive type system (e.g. gate, trigger, clock as subtypes of note/cv).

**Module IDs as `${type}-${index}`.** Simple, predictable, debuggable. Works for serialisation, multiplayer sync, and CSS.

**config.js as the single source of tunable values.** `GAME_CONFIG` containing all level thresholds, timing, prices, and scoring means none of those numbers are buried in logic files. This discipline held through the whole build.

**Multiplayer host authority.** Alice owns the registry; bidirectional sync in co-op; `_mpRemote` flag prevents echo loops. The mode-switching protocol (competitive → co-op confirm dialog) is genuinely well thought out.

**PatchSystem with persistent jackRegistry.** Not rebuilt per frame — jacks registered once on module creation, looked up on draw. The earlier prototype rebuilt this every frame which caused the DOM-as-data-model bugs.

---

### What went wrong / accumulated debt

#### app.js is doing five jobs

At 3185 lines, app.js contains: global game state (~20 loose `let` globals), GameEngine class, persistence (save/load), canvas + visual helpers (FOL, bolts, particles, flower pulse, burn effect), all input handlers (MIDI, QWERTY, touch, mouse, resize), console command dispatch, and bootstrap. These are five distinct systems that happen to share a file.

The visual system in particular is deeply entangled — `getHarmonicHops`, `drawFlowerPulse`, `folStreakAlpha` etc. all read game state globals directly rather than receiving it via events. This is why the visual layer can't be tested or modified independently.

#### notePos() in config.js references canvas

```js
// config.js line 25
const cx = canvas.width/2, cy = canvas.height/2;
```

`canvas` is a global declared in app.js. This is a cross-file dependency hidden inside what should be a pure utility function. It means config.js can't be loaded without app.js having already run. In the rebuild this should be `notePos(midi, cx, cy, r)` — pass the geometry in, don't reach for it.

#### Game state is loose globals

`score`, `levelIdx`, `streakCount`, `gameMode`, `currentChallenge`, `challengeDeck`, `gameKeyPool` etc. are all `let` declarations at module scope in app.js. There's no GameState object — mutation happens anywhere in the file. This makes it impossible to subscribe to state changes (the visual system has to poll), difficult to snapshot cleanly for multiplayer, and impossible to type safely.

#### Panel state lives in two places

Module panel collapsed/expanded state is toggled via CSS class on the DOM element. The registry knows nothing about it. This means save/restore of UI state is a separate serialisation pass (the `panelPositions` blob in localStorage). In the rebuild, collapsed state should be a registry param like everything else.

#### The lookahead scheduler is in AudioGraph

`Transport`, seq step firing (`_fireSeqCvStep`, `_fireSeqDrumStep`), and the rAF playhead polling are all inside AudioGraph. The rAF sync (`audioGraph.seqPlayheads` polled in `animate()`) is a workaround for the fact that audio time and frame time aren't synchronised. A proper approach is a clock worker that posts accurate timestamps.

#### No versioned save format

`localStorage` save is a flat JSON blob. No version field means any structural change silently breaks old saves. Users lose their synths on updates with no warning.

---

## 2. Retrospective: better library/language choices

### TypeScript

The biggest single improvement for long-term maintainability. The module system has a well-defined shape that TypeScript would catch immediately:

```ts
interface ModuleDef {
  label: string;
  category: 'osc' | 'processor' | 'cv' | 'drum' | 'sequencer' | 'utility';
  defaultParams: Record<string, number | string>;
  inputPorts: Port[];
  outputPorts: Port[];
}

type SignalType = 'audio' | 'cv' | 'note' | 'gate' | 'trigger';
```

The multiplayer message protocol, registry events, and param schemas would all be typed. `_portSignalType()` string-matching would be replaced by typed port definitions.

### Vite (build step)

Even a minimal Vite setup gives: ES module imports (no load-order dependency), TypeScript, tree-shaking, and a dev server with HMR. The "no build step" constraint was a productivity choice in early development that's now costing more than it saves. The five-file split is already a de facto module system — Vite just formalises it.

### Svelte for UI panels

The synth-ui.js panel DOM manipulation (1636 lines of `document.createElement`, attribute setting, event wiring) is the most painful code to read and extend. Each new module type requires 50-100 lines of manual DOM construction.

Svelte is the right fit here: reactive, compiles to vanilla JS (no virtual DOM overhead), genuinely small bundle. A `<ModulePanel>` component that takes a registry module as a prop and renders knobs, jacks, and controls reactively would halve the code and eliminate an entire class of bugs (stale DOM state). The reactive statement `$: collapsed = module.params.collapsed` replaces manual class toggling.

### PixiJS + GLSL for the visual layer

The canvas 2D renderer handles: FOL background tiling, lightning bolts (3-pass glow), particles, keyboard, patch cables, UI overlays. At high particle counts or on mobile this is measurably slow.

**The FOL background in particular is a perfect GLSL shader** — the interference pattern of overlapping circles is trivially parallelisable on the GPU. A fragment shader can render an infinite FOL with plasma animation, hue rotation, and beat-sync brightness in a single fullscreen quad at essentially zero CPU cost. The current implementation redraws it on the CPU every frame.

PixiJS gives WebGL rendering with a familiar 2D API. The bolt paths, particles, and ripples all map naturally to PixiJS Graphics and ParticleContainer. The FOL background becomes a GLSL filter applied to a fullscreen sprite.

### Tone.js for audio scheduling

The current transport (lookahead scheduler + rAF playhead) does the job but is hand-rolled. Tone.js provides a battle-tested transport with: BPM sync, PPQ-accurate scheduling, pattern/sequence abstractions, and a large library of synthesis primitives.

The argument against: Tone.js wraps Web Audio in ways that can make custom routing awkward, and the modular patch architecture is more custom than Tone.js anticipates. A middle path — keep the registry/AudioGraph model but use Tone.js Transport for clock authority and its effect nodes where they're better than raw Web Audio — is probably the right call. The `Tone.Filter`, `Tone.Reverb`, and `Tone.Delay` implementations are significantly better-sounding than the raw BiquadFilter equivalents.

### Web Worker for transport clock

Browser `setInterval` in the main thread is subject to throttling (particularly on mobile, background tabs). The current lookahead scheduler mitigates this but doesn't eliminate it. Moving the clock tick to a dedicated AudioWorklet or SharedArrayBuffer-backed Worker gives sample-accurate timing without jank from main thread work.

### WebRTC alternatives

The free public PeerJS relay (`0.peerjs.com`) is best-effort and occasionally down. For the massively multiplayer canvas the architecture needs rethinking entirely — PeerJS peer-to-peer doesn't scale to a dozen simultaneous editors. Options:

- **Livekit** — open source, self-hostable, designed for real-time collaboration
- **Partykit** — purpose-built for multiplayer web apps, Cloudflare Workers backed, very low latency
- **Y.js + WebRTC** — CRDT-based sync for the shared module canvas, handles conflicts automatically. Would replace the current host-authority model with eventual consistency.

Y.js in particular is worth serious consideration for the shared canvas. The current registry sync protocol (host authority, `_mpRemote` flag, echo prevention) is already doing manually what a CRDT handles automatically — and Y.js has a WebRTC provider that works without a server for small groups.

---

## 3. MVP pending — current build

These are the remaining features needed before this codebase is shareable as an MVP. The rebuild happens after this list is done.

### Sound / synth
- [ ] Filter character — expose the existing `_makeDriveCurve` (tanh saturation) as a Drive knob on the filter panel. Currently implemented in AudioGraph but not surfaced.
- [ ] 2-knob EQ module — low shelf + high shelf, new module type `eq`
- [ ] Peak limiter module — `DynamicsCompressorNode` in limiter config (ratio 20:1, fast attack), new module type `limiter`
- [ ] Drum voice reconstruction from circuit PDFs (kick, snare, hat, FM drum). The current voices are functional but basic. The `drum/` folder has: kick manual, snare manual, hihat manual, FM drum manual, output mixer, EDU compressor, BBD delay.
- [ ] `circuit.js` — WebAudio reconstructions of the above circuits as standalone voice classes, imported into audio.js

### Game mechanics
- [ ] Scale quantize CV module — input: note/CV, output: pitch snapped to current `gameKeyPool` scale. New module type `quant`. Needs a reference to game state scale (could be passed as a param on key change, same as `setRootKey`)
- [ ] Note suggestion formalization — make `getHarmonicHops` visible on the keyboard/nodemap as highlighted playable notes, not just bolt steering. Bonus points for hitting suggested notes.

### Input / MIDI routing
- [ ] MIDI generator modules — `midi-kbd` and `midi-lpx` as registry modules with `note-out` ports. Each represents a physical MIDI device. `onNoteOn` routes to the correct generator based on WebMIDI device ID.
- [ ] Drum trigger note selector — `triggerNote` param on drum-kick/snare/hat (MIDI note number dropdown). Drum only fires when incoming note matches. Enables LPX → multiple drums (each on different notes) + keyboard → lead.

### Visuals
- [ ] Wicki-Hayden nodemap — hex grid alternative to the piano keyboard. Always interactive (touch, mouse, QWERTY mapped to hex positions). Bolts fire on node positions. Layout selectable in Options.
- [ ] Source-aware visuals — bolts for played notes (current). Seq-cv: slow travelling pulse, soft thread between nodes, fades over a bar. Drum triggers: percussive radial flash, no bolt — kick = deep center pulse, hat = high-frequency sparks on outer ring, snare = mid-ring crack.
- [ ] Additional nodemap layouts — Tonnetz (voice leading triangles), scale-locked radial (diatonic only), spiral of fifths.

### Multiplayer
- [ ] Page refresh persistence — store peer ID in localStorage, reconnect on reload (~30s polling window)
- [ ] Lobby difficulty selector — Alice picks level before sharing link
- [ ] New co-op game — reset score+level to 0 synced, keep synth
- [ ] Sabotage shop — competitive mode only, spend score to disrupt partner

### Infrastructure
- [ ] Save format versioning — add `version: 1` field to localStorage blob, migration path for future structural changes
- [ ] `.gitignore` for `spec docs/` (or keep docs outside midigame/ as now)

---

## 4. Rebuild — features and design targets

### Architecture principles

**One class per concern, events between them.**

```
NoteSource (MIDI | Touch | QWERTY | Seq | Drum)
    ↓ noteOn/noteOff events
NoteRouter (maps device → generator module, handles trigger note matching)
    ↓
GameEngine (chord detection, scoring — subscribes to NoteRouter)
VisualEngine (subscribes to NoteRouter + GameEngine + Transport)
AudioGraph (subscribes to NoteRouter + ModuleRegistry)
UIRenderer (subscribes to ModuleRegistry)
```

Nothing reads globals. Everything receives what it needs as constructor arguments or event payloads.

**TypeScript throughout.** Typed module defs, typed port signatures, typed registry events, typed multiplayer messages, typed game state.

**Vite build.** One `index.html`, ES module imports, TypeScript compilation, hot reload in dev.

**Svelte for UI panels.** `<ModulePanel module={mod} registry={registry} />` — reactive, no manual DOM. Each module type gets a Svelte component. The patch canvas stays as raw canvas (WebGL).

**GLSL/PixiJS for visuals.** FOL background as fullscreen fragment shader. Bolts, particles, ripples as PixiJS Graphics. Hex nodemap as PixiJS rendered grid. All GPU, no CPU canvas 2D for visuals.

**Y.js for multiplayer state.** Replace host authority + manual sync protocol with a Y.js shared document. `registry.modules` and `registry.patches` become Y.js Maps. Conflict resolution is automatic. Scales to 12+ simultaneous editors for the canvas mode.

**Versioned save format.** JSON with `{ version, createdAt, game: {...}, synth: {...} }`. Migrations run on load. Exportable as `.m1d1` patch files.

### Feature targets for rebuild

**Isomorphic nodemap as primary visual + input surface**
- Wicki-Hayden, Tonnetz, scale-locked, spiral-of-fifths layouts
- Always interactive — touch, mouse, QWERTY all active simultaneously with MIDI
- Bolt/suggestion system aware of layout coordinate system (suggests physical positions, not abstract note names)
- PERFORM mode: hide synth panels, nodemap fills screen for touch play

**Source-aware visual layer (three registers)**
- Played notes: full bolt/lightning (current system, extended)
- Seq-cv: slow pulse threads, bar-length fade, beat-grid aligned
- Drum: percussive radial flashes, type-specific (kick/snare/hat each distinct)

**GLSL visual effects**
- FOL background: interference pattern shader, beat-sync brightness, hue rotation on level-up
- Bolt glow: additive blend in shader rather than 3-pass canvas
- Plasma/domain warp on level-up transitions

**Modular synth — sound quality**
- All drum voices reconstructed from circuit diagrams (FM kick, analog snare, metallic hat)
- BBD delay as a separate characterful delay module (clock noise, input compression, frequency limiting)
- Filter: drive + mode (Moog ladder / SVF / Comb selectable), self-oscillation at high Q
- 2-band EQ, peak limiter, compressor (from EDU_COMP diagram)
- Wavetable oscillator with user-loadable tables (drag a WAV in)

**Massively multiplayer canvas**
- Shared infinite canvas of modules (Y.js backed)
- Chord tennis arena at center; canvas editable around it during spectating
- ASCII avatar with A* pathfinding, navigates to screen center as you pan
- Community module system: link a repo, module loads at runtime from a standard interface
- Audience spectator mode: read-only canvas view + watch active match

**CSS-forward aesthetic**
- Panels: glassmorphism, CSS custom properties for hue theming (chord-keyed panel accents)
- Cables: SVG with CSS animation (pulse along cable when signal flows)
- Knobs: CSS-only where possible (conic-gradient dials)
- CodePen-sourced inspiration for transitions, hover states, level-up reveals

**Mobile / touch first**
- Nodemap as primary touch surface
- Panels slide up from bottom sheet on mobile
- Pinch to zoom the patch canvas
- Haptic feedback on note hits (Vibration API)

**Keyboard layout system**
- `KeyboardLayout` interface: `getNodePositions()`, `midiFromPointer(x,y)`, `drawBackground(ctx)`
- Layouts: Piano (current), Wicki-Hayden, Tonnetz, Scale-locked, Spiral-of-fifths
- Layout picker in Options, persisted to save

**Improved game loop**
- GameState as a typed observable object (not loose globals)
- Note suggestion system: displayed as highlighted nodes on nodemap, bonus points for hitting them
- Additional game modes: melody mode (play a sequence, not just chords), rhythm mode (hit notes on beat), free jam with visual feedback only
- Difficulty curve tuning based on actual play data (the `balance-spec` ideas)

---

## 5. Technology summary

| Concern | Current | Rebuild |
|---------|---------|---------|
| Language | Vanilla JS | TypeScript |
| Build | None | Vite |
| UI panels | Manual DOM (synth-ui.js) | Svelte components |
| Visual layer | Canvas 2D (app.js) | PixiJS + GLSL shaders |
| Audio | Raw Web Audio API | Web Audio + Tone.js transport/effects |
| Scheduling | Main thread setInterval | AudioWorklet / SharedArrayBuffer clock |
| Multiplayer | PeerJS + manual sync | Y.js CRDT + Partykit/Livekit relay |
| State | Loose globals | Typed GameState + ModuleRegistry |
| Save format | Unversioned JSON blob | Versioned JSON, exportable `.m1d1` |
| Routing | Global MIDI → noteOn | NoteRouter + per-device generator modules |
