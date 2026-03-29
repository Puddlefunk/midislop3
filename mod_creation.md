# Module Creation Guide

This document describes exactly which files to edit and in what order to add a new device
in each category. File paths are relative to `midislop3/src/`.

---

## Category overview

| Category | Where DSP lives | AudioGraph.ts changes? |
|---|---|---|
| `drum` | `audio/DrumVoices.ts` | Never |
| `processor` (instanced FX) | `audio/FxModules.ts` | Only if new input port |
| `osc` | `audio/AudioGraph.ts` `playNote` | Only for custom waveforms |
| `cv` | `audio/AudioGraph.ts` `playNote` CV loop | Always |
| `sequencer` | `audio/Sequencers.ts` | Always (2 lines) |
| `generator` | `input/NoteRouter.ts` | Never |
| `utility` | `audio/AudioGraph.ts` `_getDestNode` | Always |

---

## 1. Drum voice (`category: 'drum'`)

**Files to edit: `audio/DrumVoices.ts`, `config/modules.ts`**

Drum voices are fire-and-forget: they create throwaway nodes on each trigger and need no
persistent state. They receive a `note-in` port and output to `audio-out`.

### Step 1 — `audio/DrumVoices.ts`

Implement a fire function:

```typescript
export function fireClap(ag: AudioGraph, voiceId: string, vel: number, time: number): void {
  const ctx = ag.ctx!;
  const mod = ag.registry.modules.get(voiceId);
  if (!mod) return;

  // Read params
  const decay = sliderToDrumDecay((mod.params.decay as number) ?? 0.3);
  const vol   = (vel / 127) * ((mod.params.level as number) ?? 0.7) * 0.5;
  const dest  = getDrumOutputDest(ag, voiceId);

  // Build nodes, schedule envelope, connect
  const src  = ctx.createBufferSource(); src.buffer = getDrumNoiseBuffer(ag, voiceId);
  const bpf  = ctx.createBiquadFilter(); bpf.type = 'bandpass'; bpf.frequency.value = 1200;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(vol, time);
  gain.gain.exponentialRampToValueAtTime(0.001, time + decay);
  src.connect(bpf); bpf.connect(gain);
  if (dest) gain.connect(dest);
  src.start(time); src.stop(time + decay + 0.05);
}
```

Then add an entry to `DRUM_DRIVERS` at the bottom of the file:

```typescript
export const DRUM_DRIVERS: Partial<Record<...>> = {
  'drum-hat':   fireHat,
  'drum-kick':  fireKick,
  'drum-snare': fireSnare,
  'drum-clap':  fireClap,   // ← add this line
};
```

### Step 2 — `config/modules.ts`

Add to `MODULE_TYPE_DEFS`:

```typescript
'drum-clap': {
  label: 'CLAP', category: 'drum', hue: 15,
  inputPorts:  [noteIn()],
  outputPorts: [audioOut()],
  defaultParams: { decay: 0.3, snap: 0.5 },
  paramDefs: {
    decay: { min: 0, max: 1, label: 'DECAY', format: v => sliderToDrumDecay(v).toFixed(2) + 's' },
    snap:  { min: 0, max: 1, label: 'SNAP',  format: v => Math.round(v * 100) + '%' },
  },
},
```

Add to `SHOP_DEFS`:

```typescript
{ type: 'drum-clap', name: 'CLAP', desc: 'Noise burst clap voice.', tab: 'drums' },
```

---

## 2. FX / processor module (`category: 'processor'`, instanced)

**Files to edit: `audio/FxModules.ts`, `config/modules.ts`**
**Possibly also: `audio/audioTypes.ts`, `audio/AudioGraph.ts` (`_getDestNode`)**

Instanced FX modules have persistent Web Audio node bundles (created on `module-added`,
destroyed on `module-removed`). All lifecycle dispatch goes through `FX_DRIVERS` —
`AudioGraph.ts` needs no changes unless the new module accepts audio input on a named port
other than `'audio'` (like sidechain's `'key'` port).

### Step 1 — `audio/audioTypes.ts` (if needed)

If the module's node bundle is complex enough to warrant a type, add an interface:

```typescript
export interface ChorusNodes {
  inputGain:  GainNode;
  delay1:     DelayNode;
  delay2:     DelayNode;
  lfo:        OscillatorNode;
  lfoDepth:   GainNode;
  wetGain:    GainNode;
  dryGain:    GainNode;
  outGain:    GainNode;
}
```

Add the corresponding `Map` field to `AudioGraph`:

```typescript
// audio/AudioGraph.ts — in the "Per-module node groups" block
chorusNodes = new Map<string, ChorusNodes>();
```

### Step 2 — `audio/FxModules.ts`

Implement the four driver hooks as plain functions. Each receives `ag: AudioGraph` as its
first argument:

```typescript
function initChorus(ag: AudioGraph, id: string, params: Record<string, unknown>): void {
  if (!ag.ctx || ag.chorusNodes.has(id)) return;
  // ... build nodes, store in ag.chorusNodes.set(id, { ... })
}

function syncChorusOutput(ag: AudioGraph): void {
  for (const [chorusId, cn] of ag.chorusNodes) {
    try { cn.outGain.disconnect(); } catch (_) {}
    const patch = ag.registry.patchesFrom(chorusId).find(p => p.fromPort === 'audio');
    if (patch) {
      const dest = ag._getDestNode(patch.toId, patch.toPort);
      if (dest) cn.outGain.connect(dest);
    }
  }
}

function removeChorus(ag: AudioGraph, id: string): void {
  const cn = ag.chorusNodes.get(id);
  if (cn) {
    [cn.inputGain, cn.delay1, cn.delay2, cn.lfo, cn.lfoDepth, cn.wetGain, cn.dryGain, cn.outGain]
      .forEach(n => { try { n.disconnect(); } catch (_) {} });
    try { cn.lfo.stop(); } catch (_) {}
    ag.chorusNodes.delete(id);
  }
}

function updateChorusParam(ag: AudioGraph, id: string, param: string, value: unknown): void {
  if (!ag.ctx) return;
  const cn = ag.chorusNodes.get(id);
  if (!cn) return;
  if (param === 'rate')  cn.lfo.frequency.value = sliderToLfoRate(value as number);
  if (param === 'depth') cn.lfoDepth.gain.setTargetAtTime(value as number * 0.005, ag.ctx.currentTime, 0.01);
  if (param === 'mix') {
    cn.wetGain.gain.setTargetAtTime(value as number, ag.ctx.currentTime, 0.01);
    cn.dryGain.gain.setTargetAtTime(1 - (value as number), ag.ctx.currentTime, 0.01);
  }
}
```

Add to `FX_DRIVERS`:

```typescript
export const FX_DRIVERS: Partial<Record<string, FxDriver>> = {
  // ... existing entries ...
  chorus: {
    init:        initChorus,
    syncOutput:  syncChorusOutput,
    remove:      removeChorus,
    updateParam: updateChorusParam,
  },
};
```

### Step 3 — `audio/AudioGraph.ts` `_getDestNode` (only if new input ports)

`_getDestNode` maps `(toId, toPort)` → the `AudioNode` that incoming cables should connect
to. If the new module's audio input is on the standard `'audio'` port and maps to a single
`inputGain`, add a case:

```typescript
// audio/AudioGraph.ts — in _getDestNode()
if (mod.type === 'chorus') {
  const cn = this.chorusNodes.get(toId);
  return cn?.inputGain ?? null;
}
```

If the port is always `'audio'` and the input node is always `inputGain`, this is the only
line needed. Skip this step entirely if the module is output-only (e.g. sends to reverb bus).

### Step 4 — `config/modules.ts`

```typescript
'chorus': {
  label: 'CHORUS', category: 'processor', hue: 170,
  inputPorts:  [audioIn()],
  outputPorts: [audioOut()],
  defaultParams: { rate: 0.2, depth: 0.5, mix: 0.5 },
  paramDefs: {
    rate:  { min: 0, max: 1, label: 'RATE',  format: v => sliderToLfoRate(v).toFixed(1) + 'Hz' },
    depth: { min: 0, max: 1, label: 'DEPTH', format: v => Math.round(v * 100) + '%' },
    mix:   { min: 0, max: 1, label: 'MIX',   format: v => Math.round(v * 100) + '%' },
  },
},
```

```typescript
{ type: 'chorus', name: 'CHORUS', desc: 'Stereo chorus / doubler.', tab: 'fx' },
```

---

## 3. Oscillator (`category: 'osc'`)

**Files to edit: `config/modules.ts`**
**Possibly also: `audio/AudioGraph.ts`**

Oscillators are handled generically in `playNote`. The waveform is set from
`mod.params.waveform` if present, otherwise inferred from the type name by `_inferWaveform`.
Inference rules: type contains `'sine'` → `'sine'`, `'saw'` → `'sawtooth'`, `'tri'` →
`'triangle'`, `'sq'` → `'square'`, `'sub'` → `'sub'`.

**Standard waveform (sine, sawtooth, triangle, square, sub):**

Add the entry to `MODULE_TYPE_DEFS` and `SHOP_DEFS` in `modules.ts`. No other changes needed
if the type name follows the inference rules above and uses standard Web Audio waveform types.

**Custom waveform (periodic wave via Fourier coefficients):**

Two additional edits in `AudioGraph.ts`:

1. Add a `_buildXxxWave(param: number)` method near `_buildTriWave` / `_buildSqWave`.
2. In `_onParamChanged`, add an `else if` branch for the new type:
   ```typescript
   } else if (mod.type === 'osc-xxx' && param === 'shape') {
     this._buildXxxWave(value as number);
   }
   ```
3. In `_buildCustomWaves()`, add initialisation on context start:
   ```typescript
   const xxxMod = this.registry.getModulesByType('osc-xxx')[0];
   this._buildXxxWave(xxxMod?.params.shape as number ?? 0.5);
   ```
4. In `playNote`, in the waveform assignment block, add:
   ```typescript
   else if (wf === 'xxx') { if (this.xxxWave) osc.setPeriodicWave(this.xxxWave); else osc.type = 'sine'; }
   ```

**Note on `level` param:** `playNote` automatically calls `_syncVoiceGainsForModule` when
any `osc`-category module's `level` param changes. No extra handling needed.

---

## 4. CV modulator (`category: 'cv'`)

**Files to edit: `config/modules.ts`, `audio/AudioGraph.ts`**

CV modules don't create persistent audio nodes. They're read at note-on time during
`playNote`, which iterates CV patches connected to each oscillator and accumulates modulation
values into `semiOffset`, `detuneAccum`, `glide`, `gainScale`, or `vibratoSources`.

### Step 1 — `audio/AudioGraph.ts` `playNote` CV loop

Find the `switch (src.type)` block inside the `for (const cvp of patchesTo(id))` loop
(around line 230) and add a case:

```typescript
case 'arpeggio': {
  // example: offset pitch by the current arp step
  const step = (src.params.step as number) ?? 0;
  semiOffset += [0, 4, 7][Math.floor(step * 3)] ?? 0;
  break;
}
```

Available accumulators:

| Accumulator | Effect |
|---|---|
| `semiOffset += N` | Transpose by N semitones |
| `detuneAccum += N` | Detune by N cents |
| `glide = N` | Portamento time in seconds |
| `gainScale *= f` | Scale voice amplitude (0–1) |
| `vibratoSources.push(id)` | Connect this module's `depthGain` to `osc.detune` |

If the CV module needs its own persistent audio nodes (e.g. it generates an LFO signal
rather than just computing a scalar), treat it as an FX module with `category: 'cv'` instead
and register it in `FX_DRIVERS`. The two approaches are not exclusive.

**`_cvSemiOffset` for pitch-computing CV:**

If the module contributes semitone offset that other CV modules can chain onto, add a case
to `_cvSemiOffset` as well:

```typescript
case 'arpeggio': {
  const step = (src.params.step as number) ?? 0;
  return [0, 4, 7][Math.floor(step * 3)] ?? 0;
}
```

### Step 2 — `config/modules.ts`

CV modules typically have no fixed `inputPorts` / `outputPorts` (they expose dynamic CV
outputs). Set `dynamicCvOutputs: true` and `dynamicCvInputs: true` as needed:

```typescript
'arpeggio': {
  label: 'ARP', category: 'cv', hue: 42,
  inputPorts:  [],
  outputPorts: [],
  dynamicCvOutputs: true,
  defaultParams: { step: 0 },
  paramDefs: {
    step: { min: 0, max: 1, label: 'STEP', format: v => String(Math.floor(v * 3) + 1) },
  },
},
```

---

## 5. Sequencer (`category: 'sequencer'`)

**Files to edit: `audio/Sequencers.ts`, `audio/AudioGraph.ts`, `config/modules.ts`**

Sequencers subscribe to the `Transport` clock and fire notes or drum triggers on each step.

### Step 1 — `audio/Sequencers.ts`

Add `initSeqXxx` and `fireSeqXxxStep` functions:

```typescript
export function initSeqXxx(ag: AudioGraph, id: string): void {
  if (!ag.transport || ag.transport._subscribers.has(id)) return;
  ag.transport.subscribe(id, (step, time) => fireSeqXxxStep(ag, id, step, time));
}

export function fireSeqXxxStep(ag: AudioGraph, seqId: string, globalStep: number, audioTime: number): void {
  if (!ag.ctx || !ag.transport) return;
  const mod = ag.registry.modules.get(seqId);
  if (!mod) return;
  // Read mod.params for step data, call ag.playNote() / ag.stopNote() / ag._fireDrumVoice()
  ag.seqPlayheads.set(seqId, { step: globalStep % 16, row: 0, audioTime });
}
```

Export both functions.

### Step 2 — `audio/AudioGraph.ts`

Add two lines to `_onModuleAdded` and two lines to `_onModuleRemoved`:

```typescript
// _onModuleAdded:
if (type === 'seq-xxx') initSeqXxx(this, id);

// _onModuleRemoved:
if (type === 'seq-cv' || type === 'seq-drum' || type === 'seq-xxx') {
  if (this.transport) this.transport.unsubscribe(id);
  this.seqPlayheads.delete(id);
  const t = this._seqCvNoteOffTimers.get(id);
  if (t) { clearTimeout(t.timerId); this._seqCvNoteOffTimers.delete(id); }
}
```

Also add one line to the `ensure()` init loop:

```typescript
if (mod.type === 'seq-xxx') initSeqXxx(this, id);
```

Add the import at the top of `AudioGraph.ts`:

```typescript
import { Transport, initSeqCv, initSeqDrum, initSeqXxx, applyTransportParam } from './Sequencers';
```

### Step 3 — `config/modules.ts`

```typescript
'seq-xxx': {
  label: 'XXX SEQ', category: 'sequencer', hue: 160,
  inputPorts:  [],
  outputPorts: [],
  dynamicNoteOutputs: true,
  defaultParams: { steps: 16 },
  paramDefs: {},
},
```

```typescript
{ type: 'seq-xxx', name: 'XXX SEQ', desc: 'Description.', tab: 'generators' },
```

---

## 6. Generator (`category: 'generator'`)

**Files to edit: `input/NoteRouter.ts`, `config/modules.ts`**
**Possibly also: `input/OnscreenKeyboard.ts`**

Generators are MIDI/input sources. They do not create Web Audio nodes; they emit
`NoteEvent` objects that `AudioGraph` receives via the router subscriptions. The `generatorId`
field on `NoteEvent` identifies which generator fired the note — this is how sequencers own
their oscillators via `_getOwnedOscIds`.

Adding a new generator type means teaching `NoteRouter` about a new input source. The exact
approach depends on the source (new MIDI port filter, OSC, game event, etc.). At minimum:

1. In `NoteRouter`, detect when a module of the new type is added/removed from the registry.
2. On trigger, call `this._emitNoteOn({ midi, velocity, generatorId: moduleId })`.
3. Declare the type in `modules.ts` with `dynamicNoteOutputs: true` so the patch system
   creates note-out ports for it.

```typescript
'osc-input': {
  label: 'OSC IN', category: 'generator', hue: 42,
  inputPorts:  [],
  outputPorts: [],
  dynamicNoteOutputs: true,
  defaultParams: { port: 9000 },
  paramDefs: {
    port: { min: 0, max: 1, label: 'PORT', format: v => String(Math.round(v * 9000) + 1000) },
  },
},
```

---

## 7. Utility (`category: 'utility'`)

**Files to edit: `audio/AudioGraph.ts`, `config/modules.ts`**

Utility modules either sum signals (`mixer`) or terminate them (`audio-out`). Both are
handled in `_getDestNode`. `mixer` is also a full FX module via `FX_DRIVERS`.

For a new utility module that acts as an audio sink (e.g. a `scope` or `recorder`):

1. Add a node bundle type to `audio/audioTypes.ts` if needed.
2. Add a nodes Map to `AudioGraph`.
3. Initialise the nodes in `ensure()` or via `FX_DRIVERS` if it needs lifecycle hooks.
4. Add a case to `_getDestNode` so cables can connect to it:

```typescript
if (mod.type === 'scope') {
  const sn = this.scopeNodes.get(toId);
  return sn?.inputGain ?? null;
}
```

5. Add to `modules.ts` as usual.

---

## Slider-to-value helpers

If new params need non-linear scaling (frequency, time, etc.), add a helper to
`config/helpers.ts` and import it in the relevant DSP file:

```typescript
// config/helpers.ts
export function sliderToChorusDepth(v: number): number { return v * 0.01; } // 0–10ms
```

Format functions in `paramDefs` should use the same helper to keep display and DSP in sync:

```typescript
depth: { min: 0, max: 1, label: 'DEPTH', format: v => (sliderToChorusDepth(v) * 1000).toFixed(1) + 'ms' },
```
