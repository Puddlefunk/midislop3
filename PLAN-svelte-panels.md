# Plan: Svelte Panel Refactor + seq-cv/seq-drum Rename

## Goal

Replace UIRenderer.ts imperative DOM building with a data-driven Svelte component tree.
Simultaneously rename `seq-cv` → `noteSeq` and `seq-drum` → `drumSeq` throughout the codebase.
Replace canvas knobs with HTML/CSS knobs (easier to tune visually later).

**Result:** No UIRenderer class. App.svelte owns the module list. Panels are real Svelte components.
PatchSystem stays as-is. ModuleRegistry and AudioGraph stay as-is.

---

## Architecture decisions (already agreed)

- **Orchestration:** App.svelte subscribes to registry `module-added`/`module-removed`, maintains `$state` module list, renders `{#each}`
- **Granularity:** Generic `ModulePanel.svelte` shell + specialist panel components for complex modules; `Jack.svelte` is the reusable port primitive
- **Knobs:** `Knob.svelte` keeps the existing canvas drawing (drawKnob/drawBipolarKnob/drawFader) — a single marked swap point in the component is all that would need changing to move to CSS/SVG later
- **Context:** `registry` and `patchSystem` injected via typed `setContext`/`getContext` helpers in `src/ui/context.ts`

---

## Files created

| File | Purpose |
|------|---------|
| `src/ui/context.ts` | Typed context keys + `setPanelContext` / `getPanelContext` helpers |
| `src/components/panels/ModulePanel.svelte` | Outer shell: drag, z-index, jack strips, chain hover, note glow, unlock animation |
| `src/components/panels/Jack.svelte` | Single jack: registers with patchSystem in `onMount`, handles pointer events, plugged/note-active state |
| `src/components/panels/Knob.svelte` | HTML/CSS rotary knob: emits `change` events, double-click resets to default, MIDI learn hook |
| `src/components/panels/GenericPanel.svelte` | Fallback: title + all paramDefs as Knob rows |
| `src/components/panels/OscPanel.svelte` | Oscillator: wave preview, octave buttons, waveform selector, voice section |
| `src/components/panels/FilterPanel.svelte` | VCF: LP/HP/BP toggle + cutoff/res knobs |
| `src/components/panels/ChordPanel.svelte` | Chord: 3 voice rows (offset+vel knobs, note lights), SPLIT toggle |
| `src/components/panels/MixerPanel.svelte` | Mixer: 4 fader channels + send knobs + master fader |
| `src/components/panels/NoteSeqPanel.svelte` | Note sequencer (was seq-cv): pitch grid, rate/gate/bars/fold controls |
| `src/components/panels/DrumSeqPanel.svelte` | Drum sequencer (was seq-drum): 4-row velocity grid, rate/bars controls |

---

## Files modified

| File | Change |
|------|--------|
| `src/App.svelte` | Add registry subscription, `$state modules[]`, `{#each}` → `<ModulePanel>`, rubber-band selection overlay, `setPanelContext` call |
| `src/main.ts` | Remove `UIRenderer` instantiation; pass `patchSystem` into Svelte props so App.svelte can inject context; update `setRootKey`/`setScaleType`/`setSeqPlayhead`/`beatPulse`/`pulsePanels` call sites |
| `src/config/modules.ts` | Rename `seq-cv` → `noteSeq`, `seq-drum` → `drumSeq` in all definition keys, labels, and SHOP_DEFS |
| `src/config/game.ts` | Update module type keys for renamed sequencers |
| `src/audio/AudioGraph.ts` | Update `seq-cv`/`seq-drum` type string references |
| `src/audio/Sequencers.ts` | Update `seq-cv`/`seq-drum` type string references |
| `src/core/ModuleRegistry.ts` | Any `seq-cv`/`seq-drum` references |
| `src/types.ts` | Add `PanelContext` interface if needed |

---

## Files deleted

| File | Why |
|------|-----|
| `src/ui/UIRenderer.ts` | Replaced entirely by Svelte components |

---

## What migrates where

### Global interaction handlers (currently in UIRenderer._initGlobalHandlers)

| Concern | New home |
|---------|---------|
| Knob drag (mousedown/mousemove/mouseup) | `Knob.svelte` — owns its own pointer events |
| Panel drag (mousedown on title) | `ModulePanel.svelte` — dispatches `positionChange` to parent |
| Panel position save | App.svelte accumulates positions from `positionChange` events |
| Rubber-band multi-select | App.svelte — overlay div on `#panels-container`, BFS logic extracted to helper |
| Sell-on-drop (drag to shop) | App.svelte or ModulePanel.svelte dispatches `module-sell` custom event |
| Chain hover BFS | `ModulePanel.svelte` on `mouseenter`/`mouseleave` — reads registry, dispatches `chain-hover` set to App.svelte |

### UIRenderer public API → new homes

| Method | New home |
|--------|---------|
| `setRootKey(key)` | Context or window event; NoteSeqPanel subscribes to GameState |
| `setScaleType(scale)` | Same as above |
| `setSeqPlayhead(id, step)` | Window custom event `seq-playhead`; NoteSeqPanel/DrumSeqPanel listen in `onMount` |
| `beatPulse()` | Window custom event `beat-pulse`; ModulePanel listens, toggles CSS class |
| `pulsePanels(hue)` | Window custom event `panels-pulse`; ModulePanel listens |
| `setJackLighting(enabled)` | Stays as `document.body.classList.toggle` — call from wherever it's already wired (MenuPanel) |
| `positions` (save/load) | App.svelte exposes getter; main.ts reads from it on save |

### Canvas drawing helpers in UIRenderer.ts

`drawKnob`, `drawBipolarKnob`, `drawFader`, `drawWavePreview` — these are canvas helpers.
- `drawKnob`/`drawBipolarKnob`/`drawFader` → **deleted**, replaced by CSS in Knob.svelte
- `drawWavePreview` → keep as a standalone export, used inside OscPanel.svelte's wave preview canvas

### findClearSpot

Keep as a standalone function, import into App.svelte or a `panelLayout.ts` helper. Used when positioning a new panel that has no saved position.

---

## Build order

Execute these steps in order. App should build and run at the end of each step.

### Step 1 — Rename seq-cv/seq-drum
Rename all string occurrences of `'seq-cv'` → `'noteSeq'` and `'seq-drum'` → `'drumSeq'` across:
- `src/config/modules.ts`
- `src/config/game.ts`
- `src/audio/AudioGraph.ts`
- `src/audio/Sequencers.ts`
- `src/core/ModuleRegistry.ts`
- `src/ui/UIRenderer.ts` (temporary — still exists at this step)
- `src/main.ts`
- Any save migration paths

Also rename CSS classes and method names in UIRenderer that reference the old names.
Add a save migration in main.ts: on load, rewrite any saved module types `seq-cv` → `noteSeq` and `seq-drum` → `drumSeq`.

**Verify:** Dev server starts, existing panels still work with new type strings.

---

### Step 2 — Context infrastructure
Create `src/ui/context.ts`:
```ts
import { getContext, setContext } from 'svelte';
import type { ModuleRegistry } from '../core/ModuleRegistry';
import type { PatchSystem } from './PatchSystem';

interface PanelContext {
  registry: ModuleRegistry;
  patchSystem: PatchSystem;
}

const KEY = Symbol('panel-context');
export const setPanelContext = (ctx: PanelContext) => setContext(KEY, ctx);
export const getPanelContext = (): PanelContext => {
  const ctx = getContext<PanelContext>(KEY);
  if (!ctx) throw new Error('getPanelContext called outside panel tree');
  return ctx;
};
```

Modify `App.svelte` props to accept `patchSystem` (in addition to existing props), and call `setPanelContext` in the component script.

Modify `main.ts` to pass `patchSystem` to App.svelte as a prop (it's created before mount).

**Verify:** App builds. Existing UIRenderer panels still work (no visual change yet).

---

### Step 3 — Jack.svelte
Create `src/components/panels/Jack.svelte`:

Props: `modId: string`, `port: string`, `isOut: boolean`, `signal: 'audio'|'note'|'send'`

Behavior:
- `onMount`: read own DOM element, call `patchSystem.registerJack(modId, port, isOut, el)`
- `onDestroy`: nothing needed (patchSystem deregisters on `module-removed`)
- `pointerdown` → `patchSystem.handleJackPointerDown(...)`
- `contextmenu` → `e.preventDefault()`
- Reactive plugged state: subscribe to registry `patch-changed`, query `patchSystem.jackRegistry` for own plug state

CSS: replaces the `.port-jack` canvas-drawn circle with an HTML circle element styled by signal type.

**No integration yet** — just the component exists.

---

### Step 4 — Knob.svelte
Create `src/components/panels/Knob.svelte`:

Props: `moduleId: string`, `param: string`, `value: number`, `min: number`, `max: number`, `label: string`, `format: (v: number) => string`, `bipolar?: boolean`, `hue: number`

Behavior:
- Emits `change` CustomEvent with new value on drag
- `mousedown` starts drag: tracks `startY` and `startVal`; `mousemove` on window updates value; `mouseup` clears drag
- `dblclick` resets to default (reads from `getModuleDef` via context, or receives `defaultVal` prop)
- MIDI learn: if `window.__midiLearnActive`, dispatch `midi-learn-select` event instead of starting drag
- Visual: `<canvas>` element calling the existing `drawKnob` / `drawBipolarKnob` / `drawFader` helpers
  (imported from a standalone `src/ui/knobDraw.ts` extracted from UIRenderer.ts)
  ```svelte
  <!-- SWAP POINT: replace the canvas block below to change knob rendering style -->
  <canvas bind:this={canvasEl} width={size} height={size}></canvas>
  <!-- end SWAP POINT -->
  ```
  Reactive: `$effect(() => { drawKnob(canvasEl, v01, hue, focused); })` re-draws whenever value/focus changes

Value display: `<span class="val">` showing `format(value)`

**No integration yet.**

---

### Step 5 — ModulePanel.svelte (shell only)
Create `src/components/panels/ModulePanel.svelte`:

Props: `modId: string`, `type: string`, `initialPosition: {left: number, top: number} | null`

Behavior:
- Reads `def = getModuleDef(type)` for hue, label
- Sets CSS `--ph` var from `def.hue`
- Positions itself absolutely at `initialPosition` or calls `findClearSpot`
- `onMount`: adds `.unlocked` class via rAF (fade-in animation)
- Title bar `mousedown`: starts panel drag, dispatches `positionChange` on mouseup
- Shift-click on title: dispatches `selectionToggle`
- `mouseenter`/`mouseleave`: dispatches `chainHover` events
- Window `beat-pulse` event: toggles `.beat-pulse` CSS class
- Window `panels-pulse` event: triggers `.chord-hit` CSS class
- Window `note-module-on`/`note-module-off`: applies note glow CSS vars
- Slot for panel body content
- Slot for left jacks strip
- Slot for right jacks strip

**No integration yet.**

---

### Step 6 — Specialist panel components

Create all specialist panels. Each receives `modId`, `type`, `params` as props and uses `getPanelContext()` for registry access.

**GenericPanel.svelte**: iterates `def.paramDefs`, renders `<Knob>` for each. Handles `change` event → `registry.setParam`.

**FilterPanel.svelte**: LP/HP/BP button group + cutoff/res `<Knob>`.

**ChordPanel.svelte**: 3 voice rows (offset bipolar knob, vel knob, note light span). SPLIT toggle button. Subscribes to `chord-voice-on` window event for note lights.

**OscPanel.svelte**: wave preview canvas (using `drawWavePreview`), level knob, octave buttons, waveform selector (for `osc` multi type only), special param knob, voice panel section with portamento/vib/detune/vel-sens knobs.

**MixerPanel.svelte**: 4 fader channels + 2 send knobs each + master fader. Uses CSS vertical faders (no canvas).

**NoteSeqPanel.svelte** (was `_buildSeqCvPanel`):
- `$state` grid cells derived from params
- Subscribes to registry `param-changed` for step updates
- Subscribes to GameState for `rootKey`/`scaleType` (via context or window event)
- Pointer drag interaction: same 2s expiry/cycle/erase logic, all in-component
- Window `seq-playhead` event for playhead column highlight

**DrumSeqPanel.svelte** (was `_buildSeqDrumPanel`):
- 4-row grid, same drag interaction model
- Window `seq-playhead` event for playhead highlight

---

### Step 7 — App.svelte integration

Add to App.svelte:
- `$state modules: ModuleInstance[] = []`
- `onMount`: subscribe to `registry.on('module-added', ...)` and `registry.on('module-removed', ...)`
- Render:
```svelte
{#each modules as mod (mod.id)}
  <ModulePanel modId={mod.id} type={mod.type} initialPosition={savedPositions[mod.id] ?? null}>
    <!-- route to specialist panel based on mod.type -->
    {#if mod.type === 'noteSeq'}
      <NoteSeqPanel ... />
    {:else if mod.type === 'drumSeq'}
      ...
    {/if}
  </ModulePanel>
{/each}
```
- Rubber-band selection overlay: `mousedown` on `#panels-container` background (not hitting `.panel-box`) creates selection rect div, `mousemove` resizes it, `mouseup` checks intersections and sets selected IDs
- Listen for `selectionToggle` events from ModulePanel to manage `$state selectedIds: Set<string>`
- Listen for `positionChange` events from ModulePanel to update `positions` record (for save)
- Expose `positions` getter for main.ts save path

At this point **both UIRenderer and Svelte panels exist simultaneously**. UIRenderer still fires from registry events and creates duplicate panels.

---

### Step 8 — Cut over: disable UIRenderer, verify Svelte panels

Temporarily guard UIRenderer in main.ts:
```ts
// uiRenderer = new UIRenderer(registry, patchSystem);  // disabled
```

Verify all modules render correctly, jacks register, cables draw, knobs work, drag works.

Fix any issues found.

---

### Step 9 — Delete UIRenderer

Delete `src/ui/UIRenderer.ts`.

Extract standalone helpers from UIRenderer.ts into their own files:
- `src/ui/knobDraw.ts` — exports `drawKnob`, `drawBipolarKnob`, `drawFader`, `drawWavePreview`
- `src/ui/panelLayout.ts` — exports `findClearSpot`

Update all imports.

---

### Step 10 — Update main.ts call sites

Replace UIRenderer method calls in main.ts with the new event/context pattern:

| Old | New |
|-----|-----|
| `uiRenderer.setRootKey(k)` | `window.dispatchEvent(new CustomEvent('root-key-change', {detail: k}))` |
| `uiRenderer.setScaleType(s)` | `window.dispatchEvent(new CustomEvent('scale-type-change', {detail: s}))` |
| `uiRenderer.setSeqPlayhead(id, step, row)` | `window.dispatchEvent(new CustomEvent('seq-playhead', {detail: {id, step, row}}))` |
| `uiRenderer.beatPulse()` | `window.dispatchEvent(new CustomEvent('beat-pulse'))` |
| `uiRenderer.pulsePanels(hue)` | `window.dispatchEvent(new CustomEvent('panels-pulse', {detail: hue}))` |
| `uiRenderer.setJackLighting(v)` | `document.body.classList.toggle('no-jack-lighting', !v)` (already was this) |
| `uiRenderer.positions` (save) | App.svelte exposes `getPositions()` or main.ts reads from a shared positions store |

---

### Step 11 — Move styles out of UIRenderer injection

UIRenderer._injectStyles() currently injects ~300 lines of CSS via a `<style>` tag.
Move these to:
- Panel-specific styles → scoped `<style>` blocks in each Svelte component
- Global styles (`.selection-rect`, `.panel-box` base) → `src/styles/panels.css` or App.svelte's `<style :global>`

---

## Key constraints to preserve

- `patchSystem.registerJack()` must be called **after** the jack DOM element is in the document (use `onMount`)
- `patchSystem.updateJackPositions(modId)` must be called **every** mousemove during panel drag (not just on drop)
- `PatchSystem.handleJackPointerDown` and `handleModuleClick` signatures unchanged — Jack.svelte and ModulePanel.svelte call them directly
- `positions` record must be readable by main.ts for localStorage save
- Panel `#panel-${id}` id convention — PatchSystem's `updateJackPositions` queries by `[data-module]`/`[data-port]` data attributes, not by panel ID, so this is safe to change
- The `data-module` and `data-port` attributes on jack elements **must be preserved** — PatchSystem.updateJackPositions uses them to re-query DOM positions after drag

## Save migration (step 1)

On save file load in main.ts, before restoring modules:
```ts
if (save?.synth?.modules) {
  for (const mod of save.synth.modules) {
    if (mod.type === 'seq-cv')   mod.type = 'noteSeq';
    if (mod.type === 'seq-drum') mod.type = 'drumSeq';
  }
}
```
