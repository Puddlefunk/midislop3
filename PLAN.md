# Refactor Plan: Kill CV, Add Chord Device + Note Mixer

## Goal

Remove the fake CV signal/routing layer. Replace it with honest architecture:
- Voice parameters (glide, vibrato, transpose, velocity sensitivity) move onto OSC modules directly
- New `chord` module: note-domain chord splitter/combiner
- New `note-merge` module: fan-in for note streams
- `audio` and `note` are the only signal types remaining

---

## What's Being Removed

### CV modules (all deleted)
| Module | Replacement |
|--------|-------------|
| `glide` | `portamento` param on each OSC |
| `pitch` | `semi` + `octave` params on each OSC (already have `octave`) |
| `vibrato` | `vibrato-rate` + `vibrato-depth` params on each OSC |
| `unison` | `detune` param on each OSC (spread as cents) |
| `chord` (old) | New chord device (see below) |
| `velocity` | `vel-sens` param on each OSC |

### CV signal type + infrastructure
- `SignalType`: remove `'cv'`, `'gate'`, `'trigger'` (unused anyway)
- `ModuleCategory`: remove `'cv'`
- `OSC_CV_INPUTS` port defaults: remove `cv-pitch` and `cv-level` jacks from all OSCs
- `CATEGORY_PORT_DEFAULTS.osc` input: just `[noteIn()]`
- `ModuleRegistry._portSignalType`: remove CV inference (port name heuristic)
- `JackPosition.isCV`: remove field
- `PatchSystem`: remove `isCV`, `drawCvCable`, all `signalType === 'cv'` branches
- `UIRenderer`: remove `.port-cv` CSS, `cv-jack-pulse` animation, CV ptype logic
- `ShopSystem`: remove `'cv'` tab — move chord device + note merge to new `'note'` tab

### AudioGraph CV machinery
- `_cvSemiOffset()` — deleted entirely
- CV patch walk in `playNote()` (lines 573–583) — replaced with direct OSC param reads
- Glide detection from note chain (lines 587–590) — replaced with OSC param read
- `seqGlideFreqs` map — keep (still tracks per-seq glide state, just reads from osc param now)

---

## What's Being Added

### OSC param additions (all OSC types)
All new params default to 0 / off so existing patches are unaffected.

| Param | Range | Default | Notes |
|-------|-------|---------|-------|
| `semi` | -12 – +12 | 0 | Semitone transpose (existing `octave` param stays) |
| `portamento` | 0 – 1 | 0 | Glide time (0 = off). Format: `(v * 2).toFixed(2) + 's'` |
| `vib-rate` | 0 – 1 | 0 | Vibrato LFO rate |
| `vib-depth` | 0 – 1 | 0 | Vibrato depth (0 = off) |
| `detune` | 0 – 1 | 0 | Unison detune spread in cents |
| `vel-sens` | 0 – 1 | 0 | Velocity → gain scaling (0 = ignore velocity) |

Applied in `playNote()` by reading `mod.params` directly. No patch walk needed.

### New module: `chord` (replaces old chord CV module)

```
IN:  note-in

KNOBS:
  offset-1   -12 – +12 semi  (voice 2 pitch offset)
  vel-1       0 – 1           (voice 2 velocity scale)
  offset-2   -12 – +12 semi  (voice 3 pitch offset)
  vel-2       0 – 1           (voice 3 velocity scale)
  mode        split/combined  (toggle, not a knob)

OUT: note-out-1  (voice 1 = root, always passes through)
     note-out-2  (voice 2 = root + offset-1 @ vel-1)
     note-out-3  (voice 3 = root + offset-2 @ vel-2)
```

**Split mode**: each output fires only its own note.
**Combined mode**: all three outputs each fire all three notes (full chord on every patched OSC).

Offset = 0 still fires (useful for unison). UIRenderer dims the offset knob when at 0 as a hint.

AudioGraph handles `chord` as a note-transformer in `_getOwnedOscIds` BFS — it walks through it
(like it currently walks through `glide`), but fires 1–3 NoteEvents per incoming event depending
on how many non-null outputs are patched.

NoteEvent note-off must fire matching offsets for all voices that were triggered on note-on.
Track active chord notes per voice key: `Map<string, number[]>` — voice key → [midi, midi+off1, midi+off2].

### New module: `note-merge`

```
IN:  note-in-1
     note-in-2
     note-in-3  (optional third source)

OUT: note-out
```

No params. Collects NoteEvents arriving on any input and re-fires on the single output.
AudioGraph BFS walks through it normally (it's transparent to ownership).

Implementation: `note-merge` is just a pass-through in `_getOwnedOscIds`. Any event routed
to it from any upstream source propagates downstream.

---

## File-by-file changes

### `src/types.ts`
- `SignalType`: `'audio' | 'note'` (remove `'cv'`, `'gate'`, `'trigger'`)
- `ModuleCategory`: remove `'cv'`
- `JackPosition`: remove `isCV` field
- `ModuleDef`: remove `fixedNoteInputPort`, `noteOutputPort` (check if used — likely dead)

### `src/config/modules.ts`
- Remove `cvIn`, `cvOut` port helpers
- Remove `OSC_CV_INPUTS`, replace `CATEGORY_PORT_DEFAULTS.osc.inputPorts` with `[noteIn()]`
- Add new params + paramDefs to all OSC type defs (semi, portamento, vib-rate, vib-depth, detune, vel-sens)
- Delete: `glide`, `pitch`, `vibrato`, `unison`, `chord` (old), `velocity` defs
- Add: new `chord` def, `note-merge` def
- `SHOP_DEFS`: remove `tab: 'cv'` entries, add new entries under `tab: 'note'`

### `src/config/game.ts`
- Remove prices for deleted modules
- Add prices for `chord` and `note-merge`

### `src/core/ModuleRegistry.ts`
- `_portSignalType`: simplify to `note` for note ports, `audio` for everything else — remove CV heuristic

### `src/audio/AudioGraph.ts`
- `playNote()`: replace CV patch walk with direct `mod.params` reads for semi, portamento, vib-rate/depth, detune, vel-sens
- Delete `_cvSemiOffset()`
- `_getOwnedOscIds()`: add `chord` and `note-merge` to the BFS walk-through list (alongside existing glide passthrough)
- Add chord NoteEvent fan-out logic: when a note arrives at a `chord` module, fire 1–3 note events downstream
- Add note-off tracking for chord module (so all voiced notes stop correctly)
- `vibratoNodes`: existing per-module LFO nodes stay, but now connected based on OSC `vib-depth > 0` param instead of CV patch

### `src/ui/PatchSystem.ts`
- Remove `isCV` from `JackPosition` usage
- Remove `drawCvCable` function
- All `signalType === 'cv'` branches → remove (becomes dead code)
- `registerJack` line 61: fix `isNote` to also catch `note-out-N` / `note-in-N` port names:
  ```ts
  // LEGACY BUG: currently misses note-out-0, note-out-1 etc (seq-drum ports)
  const isNote = port === 'note-out' || port === 'note-in'
  // FIX:
  const isNote = port.startsWith('note-out') || port.startsWith('note-in')
  ```
- `_drawCompatibleHighlights`: remove CV colour branch

### `src/ui/UIRenderer.ts`
- Remove `_dynJack()` method (already deprecated/dead — line 699)
- Remove `.port-cv` CSS rule
- Remove `cv-jack-pulse` keyframe animation
- Remove CV ptype branch in `_renderModulePorts` (lines 686, 690) — note/audio only
- `UIRenderer._buildSeqCvPanel`: rename `seq-cv` module handling if module type is renamed (or keep as-is)
- Add knob dimming logic for chord module: when `offset-1` or `offset-2` === 0, add `dim` CSS class to that knob

### `src/ui/ShopSystem.ts`
- Remove `'cv'` tab from `TABS`
- Add `'note'` tab: `{ id: 'note', label: 'NOTE' }`

### Save migration (`src/main.ts` or a migration helper)
Old saves may contain:
- CV modules (`glide`, `pitch`, `vibrato`, `unison`, `chord`, `velocity`)
- CV patches (`signalType: 'cv'`)
- OSC modules with `cv-pitch` / `cv-level` jacks patched

Migration on load: strip any module whose type is in the removed list, strip any patch with `signalType === 'cv'` or involving deleted port names. Log a warning. Don't crash.

---

## Legacy jack code noted during audit

| Location | Issue |
|----------|-------|
| `PatchSystem.ts:61` | `isNote` only matches exact `'note-out'`/`'note-in'` — misses `note-out-0` through `note-out-3` used by `seq-drum`. Cables on drum rows have wrong `isNote=false` today. |
| `UIRenderer.ts:699` | `_dynJack()` is dead code, marked deprecated. Safe to delete. |
| `modules.ts:12,14,16` | `audioOut`, `noteOut`, `cvOut` all set `multi: true`. After this refactor `cvOut` is deleted. `multi` on outputs is still correct (fan-out). |
| `PatchSystem.ts:184,264` | `jSig` ternary still falls through to `'audio'` — after CV removal this is correct but the CV arm can be deleted. |
| `ModuleRegistry:174` | Port-name CV heuristic (`cv-`, `-cv`, `cvo-`) — entire function simplifies to two cases. |

---

## Build order

1. `types.ts` — trim SignalType, ModuleCategory, JackPosition
2. `config/modules.ts` — add OSC params, new modules, remove CV modules
3. `config/game.ts` — prices
4. `core/ModuleRegistry.ts` — simplify `_portSignalType`
5. `audio/AudioGraph.ts` — replace CV walk, add chord fan-out, fix vibrato wiring
6. `ui/PatchSystem.ts` — remove CV, fix isNote bug
7. `ui/UIRenderer.ts` — remove CV CSS/dead code, add chord knob dimming
8. `ui/ShopSystem.ts` — swap CV tab for note tab
9. `main.ts` — save migration on load
