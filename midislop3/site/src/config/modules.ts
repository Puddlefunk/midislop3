import type { ModuleDef, ModuleCategory, Port } from '../types';
import {
  sliderToFreq, sliderToAttack, sliderToDecay, sliderToRelease,
  sliderToLfoRate, sliderToDelayTime, sliderToDrumDecay, sliderToKickFreq, sliderToGate, formatMs,
} from './helpers';

// ─────────────────────────────────────────────────────────────
// Port helpers — build typed port descriptors
// ─────────────────────────────────────────────────────────────

const audioIn  = (name = 'audio', label = 'IN')  => ({ name, signal: 'audio' as const, label });
const audioOut = (name = 'audio', label = 'OUT') => ({ name, signal: 'audio' as const, label, multi: true });
const noteIn   = (name = 'note-in',  label = 'NOTE IN')  => ({ name, signal: 'note' as const, label });
const noteOut  = (name = 'note-out', label = 'NOTE OUT') => ({ name, signal: 'note' as const, label, multi: true });

// ─────────────────────────────────────────────────────────────
// Category-level port defaults
// Modules that omit inputPorts / outputPorts inherit these.
// ─────────────────────────────────────────────────────────────

const CATEGORY_PORT_DEFAULTS: Partial<Record<ModuleCategory, { inputPorts: Port[]; outputPorts: Port[] }>> = {
  osc:       { inputPorts: [noteIn()], outputPorts: [audioOut()] },
  drum:      { inputPorts: [noteIn()], outputPorts: [audioOut()] },
  processor: { inputPorts: [audioIn()], outputPorts: [audioOut()] },
};

export function getModuleDef(type: string): ModuleDef | undefined {
  const base = MODULE_TYPE_DEFS[type];
  if (!base) return undefined;
  const catDef = CATEGORY_PORT_DEFAULTS[base.category];
  if (!catDef) return base;
  return {
    ...base,
    inputPorts:  base.inputPorts  ?? catDef.inputPorts,
    outputPorts: base.outputPorts ?? catDef.outputPorts,
  };
}

// ─────────────────────────────────────────────────────────────
// Shared OSC extra params (added to all playable OSC types)
// ─────────────────────────────────────────────────────────────

const OSC_EXTRA_PARAMS = {
  semi:       0,
  portamento: 0,
  'vib-rate': 0,
  'vib-depth': 0,
  detune:     0,
  'vel-sens': 0,
};

const OSC_EXTRA_PARAM_DEFS = {
  semi:       { min: -12, max: 12, label: 'SEMI', format: (v: number) => (v >= 0 ? '+' : '') + Math.round(v) + 'st' },
  portamento: { min: 0,   max: 1,  label: 'GLIDE', format: (v: number) => (v * 2).toFixed(2) + 's' },
  'vib-rate': { min: 0,   max: 1,  label: 'V.RT',  format: (v: number) => sliderToLfoRate(v).toFixed(1) + 'Hz' },
  'vib-depth':{ min: 0,   max: 1,  label: 'V.DP',  format: (v: number) => Math.round(v * 100) + '%' },
  detune:     { min: 0,   max: 1,  label: 'DTUNE', format: (v: number) => Math.round(v * 25) + 'ct' },
  'vel-sens': { min: 0,   max: 1,  label: 'VELS',  format: (v: number) => Math.round(v * 100) + '%' },
};

// ─────────────────────────────────────────────────────────────
// Module type definitions
// ─────────────────────────────────────────────────────────────

export const MODULE_TYPE_DEFS: Record<string, ModuleDef> = {

  // ── Oscillators ──────────────────────────────────────────────
  'osc-sine': {
    label: 'SINE', category: 'osc', hue: 58,
    defaultParams: { level: 0.8, octave: 0, fold: 0, ...OSC_EXTRA_PARAMS },
    paramDefs: {
      level: { min: 0, max: 1, label: 'LEVEL', format: v => Math.round(v * 100) + '%' },
      fold:  { min: 0, max: 1, label: 'FOLD',  format: v => Math.round(v * 100) + '%' },
      ...OSC_EXTRA_PARAM_DEFS,
    },
  },
  'osc-saw': {
    label: 'SAW', category: 'osc', hue: 22,
    defaultParams: { level: 0.8, octave: 0, drive: 0, ...OSC_EXTRA_PARAMS },
    paramDefs: {
      level: { min: 0, max: 1, label: 'LEVEL', format: v => Math.round(v * 100) + '%' },
      drive: { min: 0, max: 1, label: 'DRIVE', format: v => Math.round(v * 100) + '%' },
      ...OSC_EXTRA_PARAM_DEFS,
    },
  },
  'osc-tri': {
    label: 'TRI', category: 'osc', hue: 142,
    defaultParams: { level: 0.8, octave: 0, slope: 0.5, ...OSC_EXTRA_PARAMS },
    paramDefs: {
      level: { min: 0, max: 1, label: 'LEVEL', format: v => Math.round(v * 100) + '%' },
      slope: { min: 0, max: 1, label: 'SLOPE', format: v => Math.round(v * 100) + '%' },
      ...OSC_EXTRA_PARAM_DEFS,
    },
  },
  'osc-sq': {
    label: 'SQ', category: 'osc', hue: 200,
    defaultParams: { level: 0.8, octave: 0, width: 0.5, ...OSC_EXTRA_PARAMS },
    paramDefs: {
      level: { min: 0, max: 1, label: 'LEVEL', format: v => Math.round(v * 100) + '%' },
      width: { min: 0, max: 1, label: 'WIDTH', format: v => Math.round(v * 100) + '%' },
      ...OSC_EXTRA_PARAM_DEFS,
    },
  },
  'osc-sub': {
    label: 'SUB', category: 'osc', hue: 270,
    defaultParams: { level: 0.8, octave: -1, subTune: 0, ...OSC_EXTRA_PARAMS },
    paramDefs: {
      level:   { min: 0, max: 1,   label: 'LEVEL', format: v => Math.round(v * 100) + '%' },
      subTune: { min: -1, max: 1,  label: 'TUNE',  format: v => (v >= 0 ? '+' : '') + Math.round(v * 100) + 'ct' },
      ...OSC_EXTRA_PARAM_DEFS,
    },
  },
  'osc-noise': {
    label: 'NOISE', category: 'osc', hue: 0,
    inputPorts:  [],
    outputPorts: [audioOut()],
    defaultParams: { level: 0.8, color: 1.0 },
    paramDefs: {
      level: { min: 0, max: 1, label: 'LEVEL', format: v => Math.round(v * 100) + '%' },
      color: { min: 0, max: 1, label: 'COLOR', format: v => { const hz = 300 + v * 19700; return hz >= 1000 ? (hz/1000).toFixed(1)+'k' : hz.toFixed(0)+'Hz'; } },
    },
  },
  'osc': {
    label: 'OSC', category: 'osc', hue: 200,
    defaultParams: { level: 0.8, octave: 0, waveform: 'sine', fold: 0, drive: 0, slope: 0.5, width: 0.5, ...OSC_EXTRA_PARAMS },
    paramDefs: {
      level: { min: 0, max: 1, label: 'LEVEL', format: v => Math.round(v * 100) + '%' },
      ...OSC_EXTRA_PARAM_DEFS,
    },
  },

  // ── Processors ───────────────────────────────────────────────
  'vcf-x2': {
    label: 'VCF-X2', category: 'processor', hue: 200,
    defaultParams: { cutoff: 0.6, res: 0.2, filterType: 0 },
    paramDefs: {
      cutoff:     { min: 0, max: 1, label: 'CUT',  format: v => sliderToFreq(v) >= 1000 ? (sliderToFreq(v)/1000).toFixed(1)+'k' : sliderToFreq(v)+'Hz' },
      res:        { min: 0, max: 1, label: 'RES',  format: v => Math.round(v * 100) + '%' },
      filterType: { min: 0, max: 1, label: 'TYPE', format: v => v < 0.33 ? 'LP' : v < 0.67 ? 'HP' : 'BP' },
    },
  },
  'adsr-x2': {
    label: 'ADSR-X2', category: 'processor', hue: 300,
    inputPorts:  [audioIn(), noteIn('note-in', 'TRIG')],
    outputPorts: [audioOut()],
    defaultParams: { attack: 0.02, decay: 0.22, sustain: 0.55, release: 0.2 },
    paramDefs: {
      attack:  { min: 0, max: 1, label: 'ATK', format: v => formatMs(sliderToAttack(v)) },
      decay:   { min: 0, max: 1, label: 'DEC', format: v => formatMs(sliderToDecay(v)) },
      sustain: { min: 0, max: 1, label: 'SUS', format: v => Math.round(v * 100) + '%' },
      release: { min: 0, max: 1, label: 'REL', format: v => formatMs(sliderToRelease(v)) },
    },
  },
  'fx': {
    label: 'REVERB', category: 'processor', hue: 260,
    defaultParams: { wet: 0.4, size: 0.5, damp: 0.8, pre: 0.0 },
    paramDefs: {
      wet:  { min: 0, max: 1, label: 'WET',  format: v => Math.round(v * 100) + '%' },
      size: { min: 0, max: 1, label: 'SIZE', format: v => Math.round(v * 100) + '%' },
      damp: { min: 0, max: 1, label: 'DAMP', format: v => { const hz = 1000 + v * 19000; return hz >= 1000 ? (hz / 1000).toFixed(1) + 'k' : hz + 'Hz'; } },
      pre:  { min: 0, max: 1, label: 'PRE',  format: v => Math.round(v * 100) + 'ms' },
    },
  },
  'delay': {
    label: 'DELAY', category: 'processor', hue: 200,
    defaultParams: { time: 0.3, feedback: 0.4, mix: 0.4 },
    paramDefs: {
      time:     { min: 0, max: 1, label: 'TIME', format: v => formatMs(sliderToDelayTime(v)) },
      feedback: { min: 0, max: 1, label: 'FEED', format: v => Math.round(v * 100) + '%' },
      mix:      { min: 0, max: 1, label: 'MIX',  format: v => Math.round(v * 100) + '%' },
    },
  },
  'lfo': {
    label: 'LFO', category: 'processor', hue: 160,
    defaultParams: { rate: 0.1, depth: 0.5 },
    paramDefs: {
      rate:  { min: 0, max: 1, label: 'RATE',  format: v => sliderToLfoRate(v).toFixed(1) + 'Hz' },
      depth: { min: 0, max: 1, label: 'DEPTH', format: v => Math.round(v * 100) + '%' },
    },
  },
  'sidechain': {
    label: 'DUCK', category: 'processor', hue: 240,
    inputPorts:  [audioIn('return-0', 'KEY'), audioIn('audio', 'IN')],
    defaultParams: { amount: 0.8, attack: 0.3, release: 0.5, wet: 1.0 },
    paramDefs: {
      amount:  { min: 0, max: 1, label: 'AMT', format: v => Math.round(v * 100) + '%' },
      attack:  { min: 0, max: 1, label: 'ATK', format: v => formatMs(sliderToAttack(v)) },
      release: { min: 0, max: 1, label: 'REL', format: v => formatMs(sliderToRelease(v)) },
      wet:     { min: 0, max: 1, label: 'WET', format: v => Math.round(v * 100) + '%' },
    },
  },

  // ── Note routing ─────────────────────────────────────────────
  'chord': {
    label: 'CHORD', category: 'utility', hue: 42,
    inputPorts:  [noteIn()],
    outputPorts: [
      noteOut('note-out-1', 'V1'),
      noteOut('note-out-2', 'V2'),
      noteOut('note-out-3', 'V3'),
    ],
    defaultParams: { 'offset-0': 0, 'vel-0': 1, 'offset-1': 0, 'vel-1': 1, 'offset-2': 0, 'vel-2': 1, mode: 'combined' },
    paramDefs: {
      'offset-0': { min: -12, max: 12, label: 'OFF', format: v => (v >= 0 ? '+' : '') + Math.round(v) + 'st' },
      'vel-0':    { min: 0,   max: 1,  label: 'VEL', format: v => Math.round(v * 100) + '%' },
      'offset-1': { min: -12, max: 12, label: 'OFF', format: v => (v >= 0 ? '+' : '') + Math.round(v) + 'st' },
      'vel-1':    { min: 0,   max: 1,  label: 'VEL', format: v => Math.round(v * 100) + '%' },
      'offset-2': { min: -12, max: 12, label: 'OFF', format: v => (v >= 0 ? '+' : '') + Math.round(v) + 'st' },
      'vel-2':    { min: 0,   max: 1,  label: 'VEL', format: v => Math.round(v * 100) + '%' },
    },
  },
  'note-merge': {
    label: 'MERGE', category: 'utility', hue: 42,
    inputPorts:  [
      noteIn('note-in-1', 'IN1'),
      noteIn('note-in-2', 'IN2'),
      noteIn('note-in-3', 'IN3'),
    ],
    outputPorts: [noteOut()],
    defaultParams: {},
    paramDefs: {},
  },

  // ── Utility ──────────────────────────────────────────────────
  'mixer': {
    label: 'MIX', category: 'utility', hue: 210,
    inputPorts:  [audioIn('in-0', 'IN1'), audioIn('in-1', 'IN2'), audioIn('in-2', 'IN3'), audioIn('in-3', 'IN4'), audioIn('return-0', 'RTN-A'), audioIn('return-1', 'RTN-B')],
    outputPorts: [audioOut('audio-0', 'OUT1'), audioOut('audio-1', 'OUT2'), audioOut('send-0', 'SND-A'), audioOut('send-1', 'SND-B')],
    defaultParams: {
      level: 1.0,
      'level-in-0': 1.0, 'level-in-1': 1.0, 'level-in-2': 1.0, 'level-in-3': 1.0,
      's0-in-0': 0.0, 's0-in-1': 0.0, 's0-in-2': 0.0, 's0-in-3': 0.0,
      's1-in-0': 0.0, 's1-in-1': 0.0, 's1-in-2': 0.0, 's1-in-3': 0.0,
    },
    paramDefs: {
      level: { min: 0, max: 1, label: 'MSTR', format: (v: number) => Math.round(v * 100) + '%' },
    },
  },
  'audio-out': {
    label: 'OUT', category: 'utility', hue: 0,
    inputPorts:  [audioIn()],
    outputPorts: [],
    defaultParams: {},
    paramDefs: {},
  },

  // ── Generators (MIDI/QWERTY inputs) ──────────────────────────
  'midi-all': {
    label: 'ALL MIDI\n+ QWERTY', category: 'generator', hue: 42,
    inputPorts:  [],
    outputPorts: [noteOut()],
    defaultParams: {},
    paramDefs: {},
  },
  'midi-in': {
    label: 'MIDI IN', category: 'generator', hue: 42,
    inputPorts:  [],
    outputPorts: [noteOut()],
    defaultParams: { deviceId: '', deviceName: '' },
    paramDefs: {},
  },

  // ── Sequencers ───────────────────────────────────────────────
  'noteSeq': {
    label: 'SEQ', category: 'sequencer', hue: 160,
    inputPorts:  [],
    outputPorts: [noteOut()],
    defaultParams: { bars: 1, rate: '16', gate: 0.5, fold: 0 },
    paramDefs: {
      gate: { min: 0, max: 1, label: 'GATE', format: v => Math.round(sliderToGate(v) * 100) + '%' },
    },
  },
  'drumSeq': {
    label: 'DRUMS', category: 'sequencer', hue: 0,
    inputPorts:  [],
    outputPorts: [
      noteOut('note-out-0', 'ROW1'), noteOut('note-out-1', 'ROW2'),
      noteOut('note-out-2', 'ROW3'), noteOut('note-out-3', 'ROW4'),
    ],
    defaultParams: { steps: 16, bars: 1 },
    paramDefs: {},
  },

  // ── Drum voices ───────────────────────────────────────────────
  'drum-kick': {
    label: 'KICK', category: 'drum', hue: 0,
    defaultParams: { freq: 0.3, punch: 0.7, decay: 0.5 },
    paramDefs: {
      freq:  { min: 0, max: 1, label: 'FREQ',  format: v => sliderToKickFreq(v).toFixed(0) + 'Hz' },
      punch: { min: 0, max: 1, label: 'PUNCH', format: v => Math.round(v * 100) + '%' },
      decay: { min: 0, max: 1, label: 'DECAY', format: v => sliderToDrumDecay(v).toFixed(2) + 's' },
    },
  },
  'drum-snare': {
    label: 'SNARE', category: 'drum', hue: 30,
    defaultParams: { snap: 0.5, decay: 0.4 },
    paramDefs: {
      snap:  { min: 0, max: 1, label: 'SNAP',  format: v => Math.round(v * 100) + '%' },
      decay: { min: 0, max: 1, label: 'DECAY', format: v => sliderToDrumDecay(v).toFixed(2) + 's' },
    },
  },
  'drum-hat': {
    label: 'HAT', category: 'drum', hue: 55,
    defaultParams: { decay: 0.2, tone: 0.6 },
    paramDefs: {
      decay: { min: 0, max: 1, label: 'DECAY', format: v => sliderToDrumDecay(v).toFixed(2) + 's' },
      tone:  { min: 0, max: 1, label: 'TONE',  format: v => Math.round(v * 100) + '%' },
    },
  },
};

// Shop catalogue (type + description, ordered by tab)
export const SHOP_DEFS: Array<{ type: string; name: string; desc: string; tab: string }> = [
  // GEN tab
  { type: 'noteSeq',     name: 'STEP SEQ',    desc: '16-step pitch sequencer. Wire to any oscillator via note cable.',      tab: 'generators' },
  { type: 'drumSeq',     name: 'DRUM SEQ',    desc: '4-bar drum sequencer. Wire rows to drum voices.',                     tab: 'generators' },
  // NOTE tab
  { type: 'chord',       name: 'CHORD',       desc: 'Note-domain chord splitter. One note in, three voices out.',           tab: 'note' },
  { type: 'note-merge',  name: 'MERGE',       desc: 'Fan-in up to 3 note streams into one output.',                        tab: 'note' },
  // VOICE tab
  { type: 'osc-sine',    name: 'SINE OSC',    desc: 'Pure and clean. Great for pads and bass.',                            tab: 'voices' },
  { type: 'osc-saw',     name: 'SAW OSC',     desc: 'Bright and buzzy. Classic subtractive starting point.',               tab: 'voices' },
  { type: 'osc-tri',     name: 'TRI OSC',     desc: 'Warm and hollow.',                                                    tab: 'voices' },
  { type: 'osc-sq',      name: 'SQ OSC',      desc: 'Nasal with odd harmonics.',                                           tab: 'voices' },
  { type: 'osc-sub',     name: 'SUB OSC',     desc: 'Square wave an octave below.',                                        tab: 'voices' },
  { type: 'osc-noise',   name: 'NOISE',       desc: 'White/coloured noise. Patch audio cable to route into signal chain.',  tab: 'voices' },
  { type: 'osc',         name: 'MULTIOSC',    desc: 'Generic oscillator — select waveform freely.',                         tab: 'voices' },
  { type: 'adsr-x2',     name: 'ADSR-X2',     desc: 'Patchable ADSR VCA. Patch TRIG from a note source, audio in/out.',    tab: 'voices' },
  { type: 'vcf-x2',      name: 'VCF-X2',      desc: 'Dual cascaded filter.',                                                tab: 'fx' },
  // DRUMS tab
  { type: 'drum-kick',   name: '808 KICK',    desc: 'Classic sine sweep kick.',                                            tab: 'drums' },
  { type: 'drum-snare',  name: 'SNARE',       desc: 'Noise + tone snare.',                                                 tab: 'drums' },
  { type: 'drum-hat',    name: 'HI-HAT',      desc: 'Noise burst percussion.',                                             tab: 'drums' },
  // FX tab
  { type: 'fx',          name: 'REVERB',      desc: 'Convolution reverb. Audio in → wet/dry mix → audio out.',          tab: 'fx' },
  { type: 'delay',       name: 'DELAY',       desc: 'Tape-style echo with feedback.',                                      tab: 'fx' },
  { type: 'lfo',         name: 'LFO',         desc: 'Tremolo insert. Patch audio through for amplitude modulation.',       tab: 'fx' },
  { type: 'mixer',       name: 'MIXER',       desc: '4-channel mixer with 2 send/return buses.',                           tab: 'fx' },
  { type: 'sidechain',   name: 'SIDECHAIN',   desc: 'Ducking FX. Patch KEY (return-0) to duck the signal through IN.',    tab: 'fx' },
];
