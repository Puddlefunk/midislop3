import App from './App.svelte';
import { mount } from 'svelte';
import './styles/panels.css';
import { ModuleRegistry } from './core/ModuleRegistry';
import { GameState }      from './game/GameState';
import { GameEngine }     from './game/GameEngine';
import { NoteRouter }     from './input/NoteRouter';
import { AudioGraph }     from './audio/AudioGraph';
import { VisualEngine }   from './visuals/VisualEngine';
import { PatchSystem }    from './ui/PatchSystem';
import { OnscreenKeyboard }  from './input/OnscreenKeyboard';
import { MidiLearnSystem }  from './input/MidiLearnSystem';

// ─────────────────────────────────────────────────────────────
// Bootstrap — wire the systems together and mount the Svelte app.
// ─────────────────────────────────────────────────────────────

const SAVE_KEY = 'M1D1SL0P3_SAVE';

// ── Instantiate core systems ──────────────────────────────────
const registry   = new ModuleRegistry();
const state      = new GameState();
const router     = new NoteRouter(registry);
const audioGraph = new AudioGraph(registry, router);
const gameEngine = new GameEngine(registry, state, router);
const midiLearn  = new MidiLearnSystem(registry);
router.onCC((cc, value) => midiLearn.handleCC(cc, value));

// ── Pre-create PatchSystem so it can be passed as a Svelte prop ──
// PatchSystem only needs registry at construction time; mount(canvas) is called after DOM is ready
const patchSystemEarly = new PatchSystem(registry);

// ── Mount Svelte UI ───────────────────────────────────────────
const app = mount(App, {
  target: document.getElementById('app')!,
  props: { gameState: state, registry, gameEngine, patchSystem: patchSystemEarly, router, audioGraph },
});

// ── Mount visual and patch canvases after DOM is ready ────────
const mainCanvas  = document.getElementById('c')  as HTMLCanvasElement | null;
const patchCanvas = document.getElementById('pc') as HTMLCanvasElement | null;

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  if (mainCanvas)  { mainCanvas.width  = w; mainCanvas.height  = h; }
  if (patchCanvas) { patchCanvas.width = w; patchCanvas.height = h; }
  visualEngine?.resize(w, h);
  onscreenKeyboard?.resize(w, h);
}

let visualEngine:     VisualEngine     | null = null;
const patchSystem = patchSystemEarly;
let onscreenKeyboard: OnscreenKeyboard | null = null;

if (mainCanvas && patchCanvas) {
  visualEngine = new VisualEngine({
    canvas: mainCanvas,
    patchCanvas,
    width:  window.innerWidth,
    height: window.innerHeight,
  });
  patchSystem.mount(patchCanvas);
  // Jack lighting is now handled via body class directly
  document.body.classList.toggle('no-jack-lighting', !(state.fx['jackLighting'] ?? true));
  state.on('fx', (v) => {
    document.body.classList.toggle('no-jack-lighting', !((v as Record<string,boolean>)['jackLighting'] ?? true));
  });
  onscreenKeyboard = new OnscreenKeyboard(router, () => audioGraph.ensure());
  window.addEventListener('toggle-keyboard', () => {
    if (!onscreenKeyboard) return;
    onscreenKeyboard.visible ? onscreenKeyboard.hide() : onscreenKeyboard.show();
  });
  window.addEventListener('keyboard-mode', (e) => {
    onscreenKeyboard?.setMode((e as CustomEvent<string>).detail as 'circle' | 'hex');
  });
  window.addEventListener('keyboard-octave', (e) => {
    onscreenKeyboard?.setOctave((e as CustomEvent<number>).detail);
  });

  // Load saved panel positions if present — passed to Svelte App
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw) {
      const save = JSON.parse(raw);
      if (save?.synth?.panelPositions) {
        (app as any).setSavedPositions?.(save.synth.panelPositions);
      }
    }
  } catch (_) {}
  resize();
  window.addEventListener('resize', resize);

  // Wire note visuals
  router.onNoteOn(e  => visualEngine?.onNoteOn(e.midi, e.velocity));
  router.onNoteOff(e => visualEngine?.onNoteOff(e.midi));

  // Wire game events → visual effects
  gameEngine.on('challenge-success', (d) => {
    const { h } = d as { h: number; display: string };
    visualEngine?.triggerPhosphorFlash(h);
  });
  gameEngine.on('streak-level', (d) => {
    const { level } = d as { level: number };
    visualEngine?.triggerStreakFlash(level);
    visualEngine?.triggerBurn((d as { h?: number }).h ?? 270);
  });
  gameEngine.on('level-up', () => {
    visualEngine?.setLevel(state.levelIdx);
  });
  state.on('internalBpm', (v) => visualEngine?.setBpm(v as number));

  visualEngine.setFrameCallback(() => {
    patchSystem!.draw();
    gameEngine.update();
    // Seq playhead sync — dispatch window event for Svelte panel components
    if (audioGraph.ctx && audioGraph.seqPlayheads.size > 0) {
      const now = audioGraph.ctx.currentTime;
      for (const [seqId, ph] of audioGraph.seqPlayheads) {
        if (now >= ph.audioTime) {
          window.dispatchEvent(new CustomEvent('seq-playhead', { detail: { id: seqId, step: ph.step, row: ph.row } }));
        }
      }
    }
  });
  visualEngine.start();
}

// ── Transport control (dispatched by ClockPanel) ──────────────
window.addEventListener('transport-toggle', () => {
  audioGraph.ensure();
  const t = audioGraph.transport;
  if (!t) return;
  if (t.playing) {
    t.stop();
    window.dispatchEvent(new CustomEvent('transport-state', { detail: false }));
  } else {
    t.bpm = state.internalBpm;
    t.start();
    window.dispatchEvent(new CustomEvent('transport-state', { detail: true }));
  }
});

// Sync BPM slider changes to transport in real time
state.on('internalBpm', (v) => {
  if (audioGraph.transport) audioGraph.transport.bpm = v as number;
});

// Sync rootKey changes to transport and sequencer grid colours
state.on('rootKey', (v) => {
  if (audioGraph.transport) audioGraph.transport.setRootKey(v as string);
  window.dispatchEvent(new CustomEvent('root-key-change', { detail: v as string }));
});

// Sync scaleType changes to sequencer grid fold filter
state.on('scaleType', (v) => {
  window.dispatchEvent(new CustomEvent('scale-type-change', { detail: v as string }));
});

// ── CV migration — strip legacy CV modules and patches from old saves ──────
const REMOVED_MODULE_TYPES = new Set(['glide', 'pitch', 'vibrato', 'unison', 'velocity']);
const LEGACY_CV_PORTS = new Set(['cv-pitch', 'cv-level', 'cvo-0', 'cv-0', 'cv-1', 'cv-2', 'cv-3']);

function migrateRemoveCv(synth: { modules: Array<{ id: string; type: string; params: Record<string, unknown> }>; patches: Array<{ signalType: string; fromPort: string; toPort: string }> }): void {
  const removedIds = new Set<string>();
  const origModCount = synth.modules.length;
  synth.modules = synth.modules.filter(m => {
    if (REMOVED_MODULE_TYPES.has(m.type)) { removedIds.add(m.id); return false; }
    return true;
  });
  synth.patches = synth.patches.filter(p => {
    const patch = p as Partial<{ fromId: string; toId: string }>;
    if (patch.fromId && removedIds.has(patch.fromId)) return false;
    if (patch.toId && removedIds.has(patch.toId)) return false;
    if (p.signalType === 'cv') return false;
    if (LEGACY_CV_PORTS.has(p.fromPort) || LEGACY_CV_PORTS.has(p.toPort)) return false;
    return true;
  });
  const removed = origModCount - synth.modules.length;
  if (removed > 0) console.warn(`[migrate] Removed ${removed} legacy CV module(s) and related patches from save.`);
}

// ── Load saved state ──────────────────────────────────────────
function loadState(): boolean {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return false;
    const save = JSON.parse(raw);
    if (save.version !== 1) {
      console.warn('Save version mismatch — skipping load');
      return false;
    }
    state.fromJSON(save.game ?? {});
    const synth = save.synth ?? { modules: [], patches: [] };
    migrateRemoveCv(synth);
    // Migrate seq type renames
    if (synth?.modules) {
      for (const mod of synth.modules) {
        if (mod.type === 'seq-cv')   mod.type = 'noteSeq';
        if (mod.type === 'seq-drum') mod.type = 'drumSeq';
      }
    }
    registry.fromJSON(synth);
    midiLearn.fromJSON(save.synth?.midiCCMap ?? {});
    return true;
  } catch (e) {
    console.warn('Failed to load save:', e);
    return false;
  }
}

function saveState(): void {
  try {
    const save = {
      version: 1,
      createdAt: new Date().toISOString(),
      game:  state.toJSON(),
      synth: { ...registry.toJSON(), panelPositions: (app as any).getPositions?.() ?? {}, midiCCMap: midiLearn.toJSON() },
    };
    localStorage.setItem(SAVE_KEY, JSON.stringify(save));
  } catch (e) {
    console.warn('Failed to save state:', e);
  }
}

// Auto-save on patch/param changes and game events
registry.on('patch-changed',  () => saveState());
registry.on('param-changed',  () => saveState());
registry.on('module-added',   () => saveState());
registry.on('module-removed', () => saveState());
state.on('score',             () => saveState());
state.on('levelIdx',          () => saveState());
state.on('rootKey',           () => saveState());
state.on('scaleType',         () => saveState());
state.on('timerPresetIdx',    () => saveState());
state.on('controlsBarPos',    () => saveState());
state.on('audibleChallenges', () => saveState());
state.on('showKeyboard',      () => saveState());
state.on('showModules',       () => saveState());
state.on('internalBpm',       () => saveState());
state.on('useMidiClock',      () => saveState());
state.on('fx',                () => saveState());

// ── Bootstrap: load or create default synth ───────────────────
const restored = loadState();
if (!restored || registry.modules.size === 0) {
  // Default: midi-all → osc-sine → audio-out
  const allId = registry.addModule('midi-all');
  const oscId = registry.addModule('osc-sine');
  const outId = registry.addModule('audio-out');
  registry.addPatch(allId, 'note-out', oscId, 'note-in');
  registry.addPatch(oscId, 'audio',    outId, 'audio');
}

// ── MIDI init ─────────────────────────────────────────────────
router.initMIDI().then(() => {
  const count = router.devices.size;
  const msg = count > 0
    ? `${count} MIDI device${count > 1 ? 's' : ''} connected`
    : 'no MIDI devices — QWERTY active';
  window.dispatchEvent(new CustomEvent('midi-status', { detail: msg }));
}).catch(() => {
  window.dispatchEvent(new CustomEvent('midi-status', { detail: 'MIDI unavailable' }));
});

// ── QWERTY input ──────────────────────────────────────────────
const QWERTY_MAP: Record<string, number> = {
  a:60, w:61, s:62, e:63, d:64, f:65, t:66, g:67, y:68, h:69, u:70, j:71,
  k:72, o:73, l:74, p:75, ';':76,
};
let kbOctave = 0;
const kbHeld = new Map<string, number>();

window.addEventListener('keydown', e => {
  if (e.repeat || (e.target as Element).tagName === 'INPUT') return;
  if (e.key === 'z') { kbOctave = Math.max(-3, kbOctave - 1); return; }
  if (e.key === 'x') { kbOctave = Math.min(3,  kbOctave + 1); return; }
  const base = QWERTY_MAP[e.key.toLowerCase()];
  if (base !== undefined && !kbHeld.has(e.key)) {
    const midi = Math.max(0, Math.min(127, base + kbOctave * 12));
    kbHeld.set(e.key, midi);
    audioGraph.ensure();
    router.noteOn(midi, 80, null);
  }
});
window.addEventListener('keyup', e => {
  if (kbHeld.has(e.key)) {
    router.noteOff(kbHeld.get(e.key)!, null);
    kbHeld.delete(e.key);
  }
});

// Expose for dev console
Object.assign(window, { registry, state, router, audioGraph, gameEngine, saveState, loadState });

export {};
