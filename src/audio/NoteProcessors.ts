import type { AudioGraph } from './AudioGraph';
import { getRuntimeType } from '../config/modules';
import { rateFiresAt } from './Sequencers';

// ─────────────────────────────────────────────────────────────
// NoteProcessorDriver
// Interface for note-domain transform modules (arps, merges,
// muxes, repeaters, etc.).  AudioGraph dispatches to these;
// each driver owns its own state and transport subscription.
//
// To add a new note-processor: implement the four hooks below,
// add a single entry to NOTE_PROCESSOR_DRIVERS, and declare
// the module type in modules.ts / moduleSpecs/. AudioGraph
// needs no further changes.
// ─────────────────────────────────────────────────────────────

export interface NoteProcessorDriver {
  init(ag: AudioGraph, id: string): void;
  remove(ag: AudioGraph, id: string): void;
  onNoteOn(ag: AudioGraph, id: string, midi: number, velocity: number, seqId: string | null): void;
  onNoteOff(ag: AudioGraph, id: string, midi: number, seqId: string | null): void;
}

// ── Note Arp ──────────────────────────────────────────────────
// State is module-scoped (keyed by module instance id) so
// multiple arp instances are fully independent.

const _heldNotes  = new Map<string, Array<{ midi: number; velocity: number }>>();
const _activeMidi = new Map<string, number | null>();
const _offTimers  = new Map<string, { midi: number; timerId: ReturnType<typeof setTimeout> }>();

function _buildArpSequence(
  id: string,
  pattern: string,
  held: Array<{ midi: number; velocity: number }>,
  octaves: number,
  steps: number,
): Array<{ midi: number; velocity: number }> {
  const ordered = (() => {
    if (pattern === 'play') return [...held];
    const asc = [...held].sort((a, b) => a.midi - b.midi);
    if (pattern === 'down') return [...asc].reverse();
    return asc;
  })();

  if (!ordered.length) return [];

  const octaveCount = Math.max(1, Math.min(4, Math.round(octaves)));
  let pool: Array<{ midi: number; velocity: number }> = [];
  for (let o = 0; o < octaveCount; o++) {
    for (const note of ordered) {
      pool.push({ midi: note.midi + (12 * o), velocity: note.velocity });
    }
  }

  if (pattern === 'updown' && pool.length > 1) {
    pool = pool.concat(pool.slice(1, -1).reverse());
  } else if (pattern === 'random') {
    const out: Array<{ midi: number; velocity: number }> = [];
    const seedBase = [...id].reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
    for (let i = 0; i < Math.max(1, steps); i++) {
      const idx = Math.abs((seedBase + (i * 1103515245)) >>> 0) % pool.length;
      out.push(pool[idx]!);
    }
    return out;
  }

  const targetSteps = Math.max(1, Math.round(steps));
  if (pool.length >= targetSteps) return pool.slice(0, targetSteps);
  const out: Array<{ midi: number; velocity: number }> = [];
  for (let i = 0; i < targetSteps; i++) {
    out.push(pool[i % pool.length]!);
  }
  return out;
}

function _fireArpStep(ag: AudioGraph, arpId: string, globalStep: number, audioTime: number): void {
  if (!ag.ctx || !ag.transport) return;
  const mod = ag.registry.modules.get(arpId);
  if (!mod) return;
  if (getRuntimeType(mod.type) !== 'noteArp') return;

  const held       = _heldNotes.get(arpId) ?? [];
  const activeMidi = _activeMidi.get(arpId);
  if (!held.length) {
    if (activeMidi !== undefined && activeMidi !== null) ag.stopNote(activeMidi, null, arpId);
    _activeMidi.delete(arpId);
    return;
  }

  const rateIdx  = Math.max(0, Math.min(5, Math.round(((mod.params.rate    as number) ?? 0)   * 5)));
  const rate     = ['4', '8', 'd8', 't8', '16', '32'][rateIdx] ?? '16';
  const gate     = Math.max(0, Math.min(1, (mod.params.gate    as number) ?? 0.5));
  const swing    = Math.max(0, Math.min(1, (mod.params.swing   as number) ?? 0));
  const patIdx   = Math.max(0, Math.min(4, Math.round(((mod.params.pattern as number) ?? 0)   * 4)));
  const pattern  = ['up', 'down', 'updown', 'play', 'random'][patIdx] ?? 'up';
  const octaves  = Math.max(1, Math.min(4, 1 + Math.round(((mod.params.octaves as number) ?? 0) * 3)));
  const steps    = Math.max(1, Math.min(16, 1 + Math.round(((mod.params.steps   as number) ?? 0) * 15)));

  const stepDur = ag.transport.stepDuration;
  const fires   = rateFiresAt(globalStep, rate, steps, audioTime, stepDur);
  if (!fires.length) return;

  const oscs = ag.getOwnedOscIds(arpId);
  const seq  = _buildArpSequence(arpId, pattern, held, octaves, steps);
  if (!seq.length) return;

  for (const { localStep, time, cellDur } of fires) {
    const note     = seq[localStep % seq.length]!;
    const fireTime = time + (localStep % 2 === 1 ? (cellDur * swing * 0.5) : 0);
    const prevMidi = _activeMidi.get(arpId);
    if (prevMidi !== undefined && prevMidi !== null && prevMidi !== note.midi) {
      ag.stopNote(prevMidi, fireTime, arpId);
    }
    ag.playNote(note.midi, note.velocity, fireTime, arpId, oscs);
    _activeMidi.set(arpId, note.midi);

    const noteOff     = fireTime + (cellDur * gate);
    const delay       = Math.max(0, (noteOff - ag.ctx.currentTime) * 1000);
    const capturedMidi = note.midi;
    const capturedOff  = noteOff;
    const timerId = setTimeout(() => {
      if (!ag.ctx) return;
      ag.stopNote(capturedMidi, capturedOff, arpId);
      if (_activeMidi.get(arpId) === capturedMidi) _activeMidi.delete(arpId);
    }, delay);
    const prevTimer = _offTimers.get(arpId);
    if (prevTimer) clearTimeout(prevTimer.timerId);
    _offTimers.set(arpId, { midi: capturedMidi, timerId });
  }
}

const noteArpDriver: NoteProcessorDriver = {
  init(ag, id) {
    if (!ag.transport || ag.transport._subscribers.has(id)) return;
    ag.transport.subscribe(id, (step, time) => _fireArpStep(ag, id, step, time));
  },

  remove(ag, id) {
    ag.transport?.unsubscribe(id);
    const active = _activeMidi.get(id);
    if (active !== undefined && active !== null) ag.stopNote(active, null, id);
    const t = _offTimers.get(id);
    if (t) { clearTimeout(t.timerId); _offTimers.delete(id); }
    _heldNotes.delete(id);
    _activeMidi.delete(id);
  },

  onNoteOn(_ag, id, midi, velocity, _seqId) {
    const held = [...(_heldNotes.get(id) ?? [])];
    const i = held.findIndex(n => n.midi === midi);
    if (i >= 0) held[i] = { midi, velocity };
    else held.push({ midi, velocity });
    _heldNotes.set(id, held);
  },

  onNoteOff(ag, id, midi, _seqId) {
    const held = [...(_heldNotes.get(id) ?? [])].filter(n => n.midi !== midi);
    if (held.length) { _heldNotes.set(id, held); return; }
    _heldNotes.delete(id);
    const active = _activeMidi.get(id);
    if (active !== undefined && active !== null) ag.stopNote(active, null, id);
    _activeMidi.delete(id);
    const t = _offTimers.get(id);
    if (t) { clearTimeout(t.timerId); _offTimers.delete(id); }
  },
};

// ── Chord ─────────────────────────────────────────────────────
// Active notes keyed by `${chordId}:${seqId ?? 'midi'}:${midi}`
// so two generators can independently play through the same
// chord module without colliding.

const _chordActiveNotes = new Map<string, Array<{ midi: number; seqV: string }>>();

const chordDriver: NoteProcessorDriver = {
  init(_ag, _id) { /* no transport subscription needed */ },

  remove(_ag, id) {
    for (const key of [..._chordActiveNotes.keys()]) {
      if (key.startsWith(`${id}:`)) _chordActiveNotes.delete(key);
    }
  },

  onNoteOn(ag, id, midi, velocity, seqId) {
    const mod = ag.registry.modules.get(id);
    if (!mod) return;

    const offset0 = (mod.params['offset-0'] as number) ?? 0;
    const vel0    = (mod.params['vel-0']    as number) ?? 1;
    const offset1 = (mod.params['offset-1'] as number) ?? 0;
    const vel1    = (mod.params['vel-1']    as number) ?? 1;
    const offset2 = (mod.params['offset-2'] as number) ?? 0;
    const vel2    = (mod.params['vel-2']    as number) ?? 1;
    const combined = ((mod.params.mode as string) ?? 'combined') === 'combined';

    const out1Patched = ag.registry.patchesFromPort(id, 'note-out-1').length > 0;
    const out2Patched = ag.registry.patchesFromPort(id, 'note-out-2').length > 0;
    const out3Patched = ag.registry.patchesFromPort(id, 'note-out-3').length > 0;

    const midi0 = Math.max(0, Math.min(127, midi + Math.round(offset0)));
    const midi1 = Math.max(0, Math.min(127, midi + Math.round(offset1)));
    const midi2 = Math.max(0, Math.min(127, midi + Math.round(offset2)));
    const vel0s = Math.round(velocity * Math.max(0, Math.min(1, vel0)));
    const vel1s = Math.round(velocity * Math.max(0, Math.min(1, vel1)));
    const vel2s = Math.round(velocity * Math.max(0, Math.min(1, vel2)));

    window.dispatchEvent(new CustomEvent('chord-voice-on', { detail: { modId: id, voice: 0, midi: midi0 } }));
    window.dispatchEvent(new CustomEvent('chord-voice-on', { detail: { modId: id, voice: 1, midi: midi1 } }));
    window.dispatchEvent(new CustomEvent('chord-voice-on', { detail: { modId: id, voice: 2, midi: midi2 } }));

    const seqV1 = `${id}:v1`;
    const seqV2 = `${id}:v2`;
    const seqV3 = `${id}:v3`;
    const oscs1 = ag.getOwnedOscIds(id, 'note-out-1');
    const oscs2 = ag.getOwnedOscIds(id, 'note-out-2');
    const oscs3 = ag.getOwnedOscIds(id, 'note-out-3');

    const voiceEntries: Array<{ midi: number; seqV: string }> = [];

    if (combined) {
      const voices: Array<{ oscs: string[]; base: string }> = [];
      if (out1Patched && oscs1.length > 0) voices.push({ oscs: oscs1, base: seqV1 });
      if (out2Patched && oscs2.length > 0) voices.push({ oscs: oscs2, base: seqV2 });
      if (out3Patched && oscs3.length > 0) voices.push({ oscs: oscs3, base: seqV3 });
      for (const { oscs, base } of voices) {
        const k0 = `${base}:r`; const k1 = `${base}:v2`; const k2 = `${base}:v3`;
        ag.playNote(midi0, vel0s, null, k0, oscs); voiceEntries.push({ midi: midi0, seqV: k0 });
        ag.playNote(midi1, vel1s, null, k1, oscs); voiceEntries.push({ midi: midi1, seqV: k1 });
        ag.playNote(midi2, vel2s, null, k2, oscs); voiceEntries.push({ midi: midi2, seqV: k2 });
      }
    } else {
      if (out1Patched && oscs1.length > 0) { ag.playNote(midi0, vel0s, null, seqV1, oscs1); voiceEntries.push({ midi: midi0, seqV: seqV1 }); }
      if (out2Patched && oscs2.length > 0) { ag.playNote(midi1, vel1s, null, seqV2, oscs2); voiceEntries.push({ midi: midi1, seqV: seqV2 }); }
      if (out3Patched && oscs3.length > 0) { ag.playNote(midi2, vel2s, null, seqV3, oscs3); voiceEntries.push({ midi: midi2, seqV: seqV3 }); }
    }

    const chordKey = `${id}:${seqId ?? 'midi'}:${midi}`;
    _chordActiveNotes.set(chordKey, voiceEntries);
  },

  onNoteOff(ag, id, midi, seqId) {
    const chordKey = `${id}:${seqId ?? 'midi'}:${midi}`;
    const voices = _chordActiveNotes.get(chordKey);
    if (voices) {
      for (const v of voices) ag.stopNote(v.midi, null, v.seqV);
      _chordActiveNotes.delete(chordKey);
    }
  },
};

// ─────────────────────────────────────────────────────────────
// Registry
// ─────────────────────────────────────────────────────────────

export const NOTE_PROCESSOR_DRIVERS: Record<string, NoteProcessorDriver> = {
  noteArp: noteArpDriver,
  chord:   chordDriver,
};
