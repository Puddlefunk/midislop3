import { Chord, Scale } from 'tonal';
import type { Challenge } from '../types';
import { NOTE_NAMES, normPc } from './helpers';

// ─────────────────────────────────────────────────────────────
// Scale-relative chord quality tables.
// Ported from midigame/app.js.
// ─────────────────────────────────────────────────────────────

const SCALE_CHORD_QUALITIES: Record<string, string[]> = {
  major:      ['major','minor','minor','major','major','minor','dim'],
  minor:      ['minor','dim','major','minor','minor','major','major'],
  dorian:     ['minor','minor','major','major','minor','dim','major'],
  lydian:     ['major','major','minor','dim','major','minor','minor'],
  mixolydian: ['major','minor','dim','major','minor','minor','major'],
};

const SCALE_CHORD_7TH_QUALITIES: Record<string, string[]> = {
  major:      ['maj7','m7','m7','maj7','7','m7','m7b5'],
  minor:      ['m7','m7b5','maj7','m7','m7','maj7','7'],
  dorian:     ['m7','m7','maj7','7','m7','m7b5','maj7'],
  lydian:     ['maj7','7','m7','m7b5','maj7','m7','m7'],
  mixolydian: ['7','m7','m7b5','maj7','m7','m7','maj7'],
};

const Q7_SYM:  Record<string, string> = { 'maj7':'M7',   'm7':'m7', '7':'7', 'm7b5':'m7b5' };
const Q9_SYM:  Record<string, string> = { 'maj7':'M9',   'm7':'m9', '7':'9', 'm7b5':'m9b5' };
const Q7_DISP: Record<string, string> = { 'maj7':'maj7', 'm7':'m7', '7':'7', 'm7b5':'m7b5' };
const Q9_DISP: Record<string, string> = { 'maj7':'maj9', 'm7':'m9', '7':'9', 'm7b5':'m9b5' };

// ─────────────────────────────────────────────────────────────
// buildKeyPool — generates a diatonic chord pool for a root+scale.
// Returns null if scale doesn't yield 7 notes.
// ─────────────────────────────────────────────────────────────

export function buildKeyPool(root: string, scaleName: string): Challenge[] | null {
  const qualities = SCALE_CHORD_QUALITIES[scaleName] ?? SCALE_CHORD_QUALITIES.major;
  const scale = Scale.get(`${root} ${scaleName}`);
  const notes = scale.notes?.length >= 7 ? scale.notes : Scale.get(`${root} major`).notes;
  if (!notes || notes.length < 7) return null;

  const pool: Challenge[] = [];

  // Triads — diff 1
  notes.slice(0, 7).forEach((note, i) => {
    const q = qualities[i];
    let sym: string, display: string;
    if (q === 'major')      { sym = note;          display = `${note} major`; }
    else if (q === 'minor') { sym = `${note}m`;    display = `${note} minor`; }
    else                    { sym = `${note}dim`;  display = `${note} dim`;   }
    const chord = Chord.get(sym);
    if (!chord.notes || chord.notes.length < 3) return;
    pool.push({ display, notes: chord.notes, diff: 1 });
  });

  // 7ths — diff 2
  const q7s = SCALE_CHORD_7TH_QUALITIES[scaleName] ?? SCALE_CHORD_7TH_QUALITIES.major;
  notes.slice(0, 7).forEach((note, i) => {
    const q   = q7s[i];
    const sym = Q7_SYM[q] ? `${note}${Q7_SYM[q]}` : null;
    if (!sym) return;
    const chord = Chord.get(sym);
    if (!chord.notes || chord.notes.length < 4) return;
    pool.push({ display: `${note}${Q7_DISP[q]}`, notes: chord.notes, diff: 2 });
  });

  // 9ths — diff 3
  notes.slice(0, 7).forEach((note, i) => {
    const q   = q7s[i];
    const sym = Q9_SYM[q] ? `${note}${Q9_SYM[q]}` : null;
    if (!sym) return;
    const chord = Chord.get(sym);
    if (!chord.notes || chord.notes.length < 4) return;
    pool.push({ display: `${note}${Q9_DISP[q]}`, notes: chord.notes, diff: 3 });
  });

  // Suspensions — diff 4
  notes.slice(0, 7).forEach(note => {
    for (const type of ['sus2', 'sus4'] as const) {
      const chord = Chord.get(`${note}${type}`);
      if (!chord.notes || chord.notes.length < 3) return;
      pool.push({ display: `${note}${type}`, notes: chord.notes, diff: 4 });
    }
  });

  return pool.length >= 3 ? pool : null;
}

// ─────────────────────────────────────────────────────────────
// CHORD_POOL — fallback when no key is selected.
// ─────────────────────────────────────────────────────────────

export const CHORD_POOL: Challenge[] = (() => {
  const roots = ['C','G','D','A','E','F','Bb','Eb'];
  return [
    ...roots.map(r => ({ display: `${r} major`, notes: Chord.get(r).notes,           diff: 1 })),
    ...roots.map(r => ({ display: `${r} minor`, notes: Chord.get(`${r}m`).notes,     diff: 2 })),
    ...roots.map(r => ({ display: `${r}7`,      notes: Chord.get(`${r}7`).notes,     diff: 3 })),
    ...roots.map(r => ({ display: `${r}maj7`,   notes: Chord.get(`${r}M7`).notes,    diff: 4 })),
    ...roots.map(r => ({ display: `${r}m7`,     notes: Chord.get(`${r}m7`).notes,    diff: 4 })),
    ...roots.map(r => ({ display: `${r}dim`,    notes: Chord.get(`${r}dim`).notes,   diff: 5 })),
    ...roots.map(r => ({ display: `${r}aug`,    notes: Chord.get(`${r}aug`).notes,   diff: 6 })),
    ...roots.map(r => ({ display: `${r}sus2`,   notes: Chord.get(`${r}sus2`).notes,  diff: 6 })),
    ...roots.map(r => ({ display: `${r}sus4`,   notes: Chord.get(`${r}sus4`).notes,  diff: 6 })),
    ...roots.map(r => ({ display: `${r}dim7`,   notes: Chord.get(`${r}dim7`).notes,  diff: 7 })),
    ...roots.map(r => ({ display: `${r}m7b5`,   notes: Chord.get(`${r}m7b5`).notes,  diff: 7 })),
  ].filter(c => c.notes.length >= 3);
})();

// ─────────────────────────────────────────────────────────────
// Extension / pentatonic helpers (bonus note detection).
// ─────────────────────────────────────────────────────────────

export function chordExtensionPCs(notes: string[]): number[] {
  const pcs    = notes.map(n => NOTE_NAMES.indexOf(normPc(n)));
  const rootPC = pcs[0];
  if (rootPC < 0) return [];
  const ivl = (pc: number) => ((pc - rootPC + 12) % 12);
  const has  = (i: number) => pcs.some(pc => ivl(pc) === i);
  const result: number[] = [];
  const add = (...ss: number[]) => ss.forEach(s => result.push((rootPC + s + 120) % 12));
  if      (has(4) && has(7) && !has(10) && !has(11)) add(11, 10, 2, 9);
  else if (has(4) && has(7) && has(10))               add(2, 5, 9);
  else if (has(4) && has(7) && has(11))               add(2, 5, 9);
  else if (has(3) && has(7) && !has(10))              add(10, 2, 9);
  else if (has(3) && has(7))                          add(2, 5);
  else if (has(2) && has(7))                          add(4, 10, 11);
  else if (has(5) && has(7))                          add(3, 4, 10);
  return result;
}

export function pentatonicPCs(rootNote: string): number[] {
  const rootPC = NOTE_NAMES.indexOf(normPc(rootNote));
  if (rootPC < 0) return [];
  return [0, 2, 4, 7, 9].map(i => (rootPC + i) % 12);
}
