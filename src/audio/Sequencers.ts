import type { AudioGraph } from './AudioGraph';
import { getTransport } from 'tone';
import {
  sliderToBpm, sliderToGate,
  NOTE_NAMES, ENHARMONIC,
} from '../config/helpers';

// ─────────────────────────────────────────────────────────────
// Transport — Tone.js-backed scheduler for sequencer modules.
// Same subscribe() / unsubscribe() interface as the previous
// hand-rolled version; Tone.js handles the clock.
// ─────────────────────────────────────────────────────────────

export class Transport {
  ag:           AudioGraph;
  bpm           = 120;
  rateDivision  = 16;
  playing       = false;
  rootMidi      = 36;
  _globalStep   = 0;
  _subscribers  = new Map<string, (step: number, time: number) => void>();
  private _eventId: number | null = null;

  constructor(ag: AudioGraph) { this.ag = ag; }

  get stepDuration(): number { return (60 / this.bpm) * (4 / this.rateDivision); }

  setRootKey(noteNameOrPc: string): void {
    const pc  = NOTE_NAMES.includes(noteNameOrPc as typeof NOTE_NAMES[number])
      ? noteNameOrPc
      : (ENHARMONIC[noteNameOrPc] ?? noteNameOrPc);
    const idx = NOTE_NAMES.indexOf(pc as typeof NOTE_NAMES[number]);
    if (idx >= 0) this.rootMidi = 36 + idx;
  }

  start(): void {
    if (this.playing) return;
    this.playing     = true;
    this._globalStep = 0;
    const t = getTransport();
    t.bpm.value = this.bpm;
    this._eventId = t.scheduleRepeat((time) => {
      const step = this._globalStep;
      for (const cb of this._subscribers.values()) cb(step, time as number);
      this._globalStep++;
    }, `${this.rateDivision}n`) as unknown as number;
    t.start();
  }

  stop(): void {
    if (!this.playing) return;
    this.playing = false;
    const t = getTransport();
    if (this._eventId !== null) { t.clear(this._eventId); this._eventId = null; }
    t.stop();
    t.position = 0;
    this._globalStep = 0;
  }

  subscribe(id: string, cb: (step: number, time: number) => void): void { this._subscribers.set(id, cb); }
  unsubscribe(id: string): void                                          { this._subscribers.delete(id); }

  getBeatPosition(_audioTime: number): { bar: number; beat: number; phase: number } {
    if (!this.playing) return { bar: 0, beat: 0, phase: 0 };
    const pos = String(getTransport().position).split(':').map(Number);
    return { bar: pos[0] ?? 0, beat: pos[1] ?? 0, phase: (pos[2] ?? 0) / 4 };
  }
}

// ─────────────────────────────────────────────────────────────
// Rate/step helper — pure function, no AudioGraph dependency
// ─────────────────────────────────────────────────────────────

export function rateFiresAt(
  globalStep: number, rate: string, total: number, audioTime: number, stepDur: number
): Array<{ localStep: number; time: number; cellDur: number }> {
  switch (rate) {
    case '4':
      if (globalStep % 4 !== 0) return [];
      return [{ localStep: Math.floor(globalStep / 4) % total, time: audioTime, cellDur: stepDur * 4 }];
    case '8':
      if (globalStep % 2 !== 0) return [];
      return [{ localStep: Math.floor(globalStep / 2) % total, time: audioTime, cellDur: stepDur * 2 }];
    case 'd8':
      if (globalStep % 3 !== 0) return [];
      return [{ localStep: Math.floor(globalStep / 3) % total, time: audioTime, cellDur: stepDur * 3 }];
    case 't8': {
      if (globalStep % 4 === 3) return [];
      const t8Count = Math.floor(globalStep / 4) * 3 + (globalStep % 4);
      return [{ localStep: t8Count % total, time: audioTime, cellDur: stepDur * 4 / 3 }];
    }
    case '32': {
      const ls1 = (globalStep * 2) % total;
      const ls2 = (globalStep * 2 + 1) % total;
      return [
        { localStep: ls1, time: audioTime,               cellDur: stepDur / 2 },
        { localStep: ls2, time: audioTime + stepDur / 2, cellDur: stepDur / 2 },
      ];
    }
    default: // '16'
      return [{ localStep: globalStep % total, time: audioTime, cellDur: stepDur }];
  }
}

// ─────────────────────────────────────────────────────────────
// Sequencer: CV
// ─────────────────────────────────────────────────────────────

export function initSeqCv(ag: AudioGraph, id: string): void {
  if (!ag.transport || ag.transport._subscribers.has(id)) return;
  ag.transport.subscribe(id, (step, time) => fireSeqCvStep(ag, id, step, time));
}

export function fireSeqCvStep(ag: AudioGraph, seqId: string, globalStep: number, audioTime: number): void {
  if (!ag.ctx || !ag.transport) return;
  const mod = ag.registry.modules.get(seqId);
  if (!mod) return;
  const rate    = (mod.params.rate as string) ?? '16';
  const bars    = (mod.params.bars as number) ?? 1;
  const total   = 16 * bars;
  const stepDur = ag.transport.stepDuration;
  const fires   = rateFiresAt(globalStep, rate, total, audioTime, stepDur);
  if (!fires.length) return;

  for (const { localStep, time, cellDur } of fires) {
    const velState = (mod.params[`step-${localStep}-vel`] as number) ?? 0;
    ag.seqPlayheads.set(seqId, {
      step: localStep,
      row:  (mod.params[`step-${localStep}-note`] as number) ?? 12,
      audioTime: time,
    });
    if (velState === 0) { seqCvStopPrev(ag, seqId, time); continue; }

    const noteRow = (mod.params[`step-${localStep}-note`] as number) ?? 12;
    const midi    = ag.transport.rootMidi + (noteRow - 12);
    const vel     = velState === 1 ? 42 : velState === 2 ? 85 : 127;
    const gate    = sliderToGate((mod.params.gate as number) ?? 0.5);
    const noteOff = time + cellDur * gate;

    seqCvStopPrev(ag, seqId, time);

    ag.playNote(midi, vel, time, seqId);
    const delay       = Math.max(0, (noteOff - ag.ctx.currentTime) * 1000);
    const capturedOff = noteOff;
    const timerId     = setTimeout(() => { if (ag.ctx) ag.stopNote(midi, capturedOff, seqId); }, delay);
    ag._seqCvNoteOffTimers.set(seqId, { midi, timerId });
  }
}

export function seqCvStopPrev(ag: AudioGraph, seqId: string, atTime: number): void {
  const prev = ag._seqCvNoteOffTimers.get(seqId);
  if (prev) {
    clearTimeout(prev.timerId);
    ag.stopNote(prev.midi, atTime, seqId);
    ag._seqCvNoteOffTimers.delete(seqId);
  }
}

// ─────────────────────────────────────────────────────────────
// Sequencer: Drum
// ─────────────────────────────────────────────────────────────

export function initSeqDrum(ag: AudioGraph, id: string): void {
  if (!ag.transport || ag.transport._subscribers.has(id)) return;
  ag.transport.subscribe(id, (step, time) => fireSeqDrumStep(ag, id, step, time));
}

export function fireSeqDrumStep(ag: AudioGraph, seqId: string, globalStep: number, audioTime: number): void {
  if (!ag.ctx || !ag.transport) return;
  const mod = ag.registry.modules.get(seqId);
  if (!mod) return;
  const rate    = (mod.params.rate as string) ?? '16';
  const bars    = (mod.params.bars as number) ?? 1;
  const total   = 16 * bars;
  const stepDur = ag.transport.stepDuration;
  const fires   = rateFiresAt(globalStep, rate, total, audioTime, stepDur);
  if (!fires.length) return;

  for (const { localStep, time } of fires) {
    ag.seqPlayheads.set(seqId, { step: localStep, row: 0, audioTime: time });
    for (let row = 0; row < 4; row++) {
      const stepVel = (mod.params[`step-${row}-${localStep}`] as number) ?? 0;
      if (!stepVel) continue;
      const patch = ag.registry.patchesFromPort(seqId, `note-out-${row}`)[0];
      if (!patch) continue;
      const drumMod = ag.registry.modules.get(patch.toId);
      if (drumMod) {
        const vel = stepVel === 1 ? 42 : stepVel === 2 ? 85 : 127;
        ag._fireDrumVoice(patch.toId, drumMod.type, vel, time);
      }
    }
  }
}

// â”€â”€ Note arpeggiator â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€


// ─────────────────────────────────────────────────────────────
// SeqDriver — lifecycle hooks for sequencer module types.
// AudioGraph dispatches init/remove through SEQ_DRIVERS.
// Add a new sequencer: implement init/remove, add one entry.
// ─────────────────────────────────────────────────────────────

export interface SeqDriver {
  init(ag: AudioGraph, id: string): void;
  remove(ag: AudioGraph, id: string): void;
}

export const SEQ_DRIVERS: Partial<Record<string, SeqDriver>> = {
  noteSeq: {
    init:   (ag, id) => initSeqCv(ag, id),
    remove: (ag, id) => {
      ag.transport?.unsubscribe(id);
      ag.seqPlayheads.delete(id);
      const t = ag._seqCvNoteOffTimers.get(id);
      if (t) { clearTimeout(t.timerId); ag._seqCvNoteOffTimers.delete(id); }
    },
  },
  drumSeq: {
    init:   (ag, id) => initSeqDrum(ag, id),
    remove: (ag, id) => {
      ag.transport?.unsubscribe(id);
      ag.seqPlayheads.delete(id);
    },
  },
};

// ─────────────────────────────────────────────────────────────
// Transport param helpers (called from AudioGraph._onParamChanged)
// ─────────────────────────────────────────────────────────────

export function applyTransportParam(ag: AudioGraph, param: string, value: unknown): void {
  if (!ag.transport) return;
  if (param === 'bpm')  ag.transport.bpm = Math.round(sliderToBpm(value as number));
  if (param === 'rate') ag.transport.rateDivision = [4, 8, 16, 32][Math.round((value as number) * 3)] ?? 16;
}
