import type { AudioGraph } from './AudioGraph';

// ─────────────────────────────────────────────────────────────
// Module-level periodic wave state — drivers own their own state.
// AudioGraph never holds triWave/sqWave directly.
// ─────────────────────────────────────────────────────────────

let _triWave: PeriodicWave | null = null;
let _sqWave:  PeriodicWave | null = null;

export function getTriWave(): PeriodicWave | null { return _triWave; }
export function getSqWave():  PeriodicWave | null { return _sqWave; }

// ─────────────────────────────────────────────────────────────
// Wave builders
// ─────────────────────────────────────────────────────────────

function _buildTriWave(ctx: AudioContext, slope: number): void {
  const a = Math.max(0.02, Math.min(0.98, slope)), N = 64;
  const real = new Float32Array(N + 1);
  const imag = new Float32Array(N + 1);
  for (let n = 1; n <= N; n++)
    imag[n] = (2 * Math.sin(n * Math.PI * a)) / (n * n * Math.PI * Math.PI * a * (1 - a));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  _triWave = (ctx.createPeriodicWave as any)(real, imag);
}

function _buildSqWave(ctx: AudioContext, duty: number): void {
  const d = Math.max(0.02, Math.min(0.98, duty)), N = 64;
  const real = new Float32Array(N + 1);
  const imag = new Float32Array(N + 1);
  for (let n = 1; n <= N; n++) imag[n] = (2 / (n * Math.PI)) * Math.sin(n * Math.PI * d);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  _sqWave = (ctx.createPeriodicWave as any)(real, imag);
}

export function makeFoldCurve(fold: number): Float32Array<ArrayBuffer> {
  const N = 256, curve = new Float32Array(N) as Float32Array<ArrayBuffer>;
  for (let i = 0; i < N; i++) {
    const x = (i * 2 / (N - 1)) - 1;
    let y = x * (1 + fold * 3.5);
    while (Math.abs(y) > 1) y = Math.sign(y) * 2 - y;
    curve[i] = y;
  }
  return curve;
}

export function makeDriveCurve(drive: number): Float32Array<ArrayBuffer> {
  const N = 256, g = 1 + drive * 5, curve = new Float32Array(N) as Float32Array<ArrayBuffer>;
  for (let i = 0; i < N; i++) {
    const x = (i * 2 / (N - 1)) - 1;
    curve[i] = Math.tanh(x * g) / Math.tanh(g);
  }
  return curve;
}

// ─────────────────────────────────────────────────────────────
// OSC_PARAM_HANDLERS
// Maps runtimeType → param-change handler.
// AudioGraph dispatches osc param changes through this map.
// To add a new osc type: implement a handler, add one entry.
// ─────────────────────────────────────────────────────────────

type OscHandler = (ag: AudioGraph, id: string, param: string, value: unknown) => void;

export const OSC_PARAM_HANDLERS: Partial<Record<string, OscHandler>> = {
  osc: (ag, id, param, value) => {
    if (param !== 'waveform') return;
    const wf = value as string;
    for (const voice of ag.voices.values()) {
      const vnode = voice.oscNodes.get(id);
      if (!vnode) continue;
      if      (wf === 'sine')     vnode.osc.type = 'sine';
      else if (wf === 'sawtooth') vnode.osc.type = 'sawtooth';
      else if (wf === 'triangle') { const tw = _triWave; if (tw) vnode.osc.setPeriodicWave(tw); else vnode.osc.type = 'triangle'; }
      else if (wf === 'square')   { const sw = _sqWave;  if (sw) vnode.osc.setPeriodicWave(sw); else vnode.osc.type = 'square'; }
    }
  },

  'osc-tri': (ag, id, param, value) => {
    if (param !== 'slope' || !ag.ctx) return;
    _buildTriWave(ag.ctx, value as number);
    if (_triWave) for (const voice of ag.voices.values()) voice.oscNodes.get(id)?.osc.setPeriodicWave(_triWave);
  },

  'osc-sq': (ag, id, param, value) => {
    if (param !== 'width' || !ag.ctx) return;
    _buildSqWave(ag.ctx, value as number);
    if (_sqWave) for (const voice of ag.voices.values()) voice.oscNodes.get(id)?.osc.setPeriodicWave(_sqWave);
  },

  'osc-sine': (ag, id, param, value) => {
    if (param !== 'fold') return;
    const curve = makeFoldCurve(value as number);
    for (const voice of ag.voices.values()) {
      const vnode = voice.oscNodes.get(id);
      if (vnode?.shaper) vnode.shaper.curve = curve;
    }
  },

  'osc-saw': (ag, id, param, value) => {
    if (param !== 'drive') return;
    const curve = makeDriveCurve(value as number);
    for (const voice of ag.voices.values()) {
      const vnode = voice.oscNodes.get(id);
      if (vnode?.shaper) vnode.shaper.curve = curve;
    }
  },
};

/** Run all saved params for a module through its handler — used at init to build periodic waves. */
export function applyOscInitParams(ag: AudioGraph, id: string, runtimeType: string, params: Record<string, unknown>): void {
  const handler = OSC_PARAM_HANDLERS[runtimeType];
  if (!handler) return;
  for (const [param, value] of Object.entries(params)) handler(ag, id, param, value);
}
