import type { ModuleDef } from '../types';

/*
  Note utility starter template

  Use this for note-domain helpers that transform, fan out, fan in, repeat,
  or re-order note events without doing audio DSP.

  Good fits:
  - chord builders
  - note mergers
  - note multiplexers / splitters
  - arpeggiators
  - note repeats / stutters / ratchets

  Why this gets its own template:
  - the module needs routing and timing conventions, but not full audio nodes
  - many of these modules can reuse the built-in note-router path
  - the file should describe note-flow behavior clearly for a smaller model

  Suggested conventions:
  - category: 'utility'
  - runtimeType: reuse 'chord' or 'note-merge' when possible; add a new runtime only if needed
  - panelKind: 'generic' unless you need a dedicated editor
  - ports should be note-domain ports, not audio ports
  - params often include mode, rate, gate, spread, and pattern controls

  Notes for authors:
  - "mux" style modules fan one note into many note outputs.
  - "merge" style modules fan many note inputs into one note output.
  - "arp" style modules usually need transport/timing params and a per-step pattern.
  - "repeat" style modules usually need repeat count, subdivision, gate, and swing.
  - if the node is only a new face for an existing built-in helper, use runtimeType.
  - if the node introduces new note behavior, keep the template self-contained and add a
    matching runtime later.
  - for a real arp module, set runtimeType to 'noteArp'.
  - if you want an Ableton/Bitwig-style arp, use numeric knobs that format into note rates,
    pattern names, octave span, and phrase length.
*/

export const NOTE_UTILITY_TEMPLATE: ModuleDef = {
  type: 'your-note-utility-type',
  label: 'YOUR NOTE UTILITY',
  category: 'utility',
  hue: 42,
  shop: {
    tab: 'noteTools',
    name: 'YOUR NOTE UTILITY',
    desc: 'Replace this with the note-tool behavior.',
    price: 0,
  },
  inputPorts: [],
  outputPorts: [],
  defaultParams: {},
  paramDefs: {},
  panelKind: 'generic',
};

export const NOTE_MUX_TEMPLATE: ModuleDef = {
  type: 'your-note-mux-type',
  label: 'YOUR NOTE MUX',
  category: 'utility',
  hue: 42,
  shop: {
    tab: 'noteTools',
    name: 'YOUR NOTE MUX',
    desc: 'Fan one note stream out to several note outputs.',
    price: 0,
  },
  inputPorts: [
    { name: 'note-in', signal: 'note', label: 'IN' },
  ],
  outputPorts: [
    { name: 'note-out-1', signal: 'note', label: 'OUT1', multi: true },
    { name: 'note-out-2', signal: 'note', label: 'OUT2', multi: true },
    { name: 'note-out-3', signal: 'note', label: 'OUT3', multi: true },
  ],
  defaultParams: {
    mode: 'split',
  },
  paramDefs: {
    mode: { min: 0, max: 1, label: 'MODE', format: v => (v < 0.5 ? 'SPLIT' : 'MIX') },
  },
  panelKind: 'generic',
};

export const NOTE_ARP_TEMPLATE: ModuleDef = {
  type: 'your-note-arp-type',
  label: 'YOUR ARP',
  category: 'utility',
  hue: 42,
  shop: {
    tab: 'noteTools',
    name: 'YOUR ARP',
    desc: 'Turn one held note into a transport-locked arpeggio pattern.',
    price: 0,
  },
  inputPorts: [
    { name: 'note-in', signal: 'note', label: 'IN' },
  ],
  outputPorts: [
    { name: 'note-out', signal: 'note', label: 'OUT', multi: true },
  ],
  defaultParams: {
    rate: 0.6,
    gate: 0.5,
    swing: 0,
    pattern: 0,
    octaves: 0,
    steps: 0.4666666667,
  },
  paramDefs: {
    rate: { min: 0, max: 1, label: 'RATE', format: v => ['4', '8', 'd8', 't8', '16', '32'][Math.min(5, Math.round(v * 5))] ?? '16' },
    gate: { min: 0, max: 1, label: 'GATE', format: v => `${Math.round(v * 100)}%` },
    swing: { min: 0, max: 1, label: 'SWING', format: v => `${Math.round(v * 100)}%` },
    pattern: { min: 0, max: 1, label: 'MODE', format: v => ['UP', 'DOWN', 'UP-DN', 'PLAY', 'RND'][Math.min(4, Math.round(v * 4))] ?? 'UP' },
    octaves: { min: 0, max: 1, label: 'OCT', format: v => `${1 + Math.min(3, Math.round(v * 3))}X` },
    steps: { min: 0, max: 1, label: 'STEPS', format: v => `${1 + Math.min(15, Math.round(v * 15))}` },
  },
  panelKind: 'generic',
};

export const NOTE_REPEAT_TEMPLATE: ModuleDef = {
  type: 'your-note-repeat-type',
  label: 'YOUR REPEAT',
  category: 'utility',
  hue: 42,
  shop: {
    tab: 'noteTools',
    name: 'YOUR REPEAT',
    desc: 'Repeat or stutter incoming notes on a clocked subdivision.',
    price: 0,
  },
  inputPorts: [
    { name: 'note-in', signal: 'note', label: 'IN' },
  ],
  outputPorts: [
    { name: 'note-out', signal: 'note', label: 'OUT', multi: true },
  ],
  defaultParams: {
    repeats: 2,
    rate: '16',
    gate: 0.5,
    swing: 0,
  },
  paramDefs: {
    repeats: { min: 1, max: 16, label: 'RPT', format: v => `${Math.round(v)}` },
    rate: { min: 0, max: 1, label: 'RATE', format: v => ['1', '2', '4', '8', '16', '32'][Math.min(5, Math.round(v * 5))] ?? '16' },
    gate: { min: 0, max: 1, label: 'GATE', format: v => `${Math.round(v * 100)}%` },
    swing: { min: 0, max: 1, label: 'SWING', format: v => `${Math.round(v * 100)}%` },
  },
  panelKind: 'generic',
};
