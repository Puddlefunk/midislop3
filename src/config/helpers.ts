// Slider-to-value conversion helpers (pure functions, no DOM refs)
// All take a normalised 0–1 input.

export const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'] as const;
export type NoteName = typeof NOTE_NAMES[number];

export const ENHARMONIC: Record<string, string> = {
  Bb:'A#', Db:'C#', Eb:'D#', Gb:'F#', Ab:'G#',
};

// Semitone offsets from root for each scale type
export const SCALE_INTERVALS: Record<string, number[]> = {
  major:      [0, 2, 4, 5, 7, 9, 11],
  minor:      [0, 2, 3, 5, 7, 8, 10],
  dorian:     [0, 2, 3, 5, 7, 9, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  phrygian:   [0, 1, 3, 5, 7, 8, 10],
  lydian:     [0, 2, 4, 6, 7, 9, 11],
};

export function midiToName(m: number): string {
  return NOTE_NAMES[m % 12] + (Math.floor(m / 12) - 1);
}

export function midiToPitchClass(m: number): NoteName {
  return NOTE_NAMES[m % 12];
}

export function fifthsPos(m: number): number {
  return (m % 12 * 7) % 12;
}

export function noteHue(m: number): number {
  return fifthsPos(m) * 30;
}

export function normPc(pc: string): NoteName {
  return (ENHARMONIC[pc] ?? pc) as NoteName;
}

export function pcToMidi(pc: string): number {
  return NOTE_NAMES.indexOf(pc as NoteName) + 60;
}

export function midiToFreq(m: number): number {
  return 440 * Math.pow(2, (m - 69) / 12);
}

export function rootHue(label: string): number {
  const root = label.match(/^[A-G][#b]?/)?.[0] ?? '';
  const pc = NOTE_NAMES.includes(root as NoteName) ? root : (ENHARMONIC[root] ?? '');
  const idx = NOTE_NAMES.indexOf(pc as NoteName);
  return idx >= 0 ? (idx * 7 % 12) * 30 : 0;
}

export function formatFreq(hz: number): string {
  return hz >= 1000 ? (hz / 1000).toFixed(1) + 'k' : hz + 'Hz';
}

export function formatMs(s: number): string {
  return Math.round(s * 1000) + 'ms';
}

export function sliderToFreq(v: number): number    { return Math.round(200 * Math.pow(100, v)); }
export function sliderToAttack(v: number): number  { return 0.001 + v * 0.4; }
export function sliderToDecay(v: number): number   { return 0.01 + v * 0.5; }
export function sliderToRelease(v: number): number { return 0.05 + v * 2.0; }
export function sliderToLfoRate(v: number): number { return 0.1 + v * 9.9; }
export function sliderToDelayTime(v: number): number { return Math.pow(10, -2 + v * 2); }
export function sliderToBpm(v: number): number     { return Math.round(40 * Math.pow(7.5, v)); }
export function sliderToGate(v: number): number    { return 0.01 + v * 1.98; }
export function sliderToDrumDecay(v: number): number { return 0.01 * Math.pow(200, v); }
export function sliderToKickFreq(v: number): number  { return 30 + v * 70; }
