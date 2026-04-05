import type { ModuleDef } from '../../types';

const RATE_LABELS = ['4', '8', 'd8', 't8', '16', '32'] as const;
const PATTERN_LABELS = ['UP', 'DOWN', 'UP-DN', 'PLAY', 'RND'] as const;

export const spec: ModuleDef = {
  type: 'note-arp',
  label: 'NOTE ARP',
  category: 'utility',
  hue: 42,
  runtimeType: 'noteArp',
  panelKind: 'generic',
  shop: {
    name: 'NOTE ARP',
    desc: 'Transport-locked arpeggiator with up, down, up-down, play-order, and random modes.',
    price: 620,
  },
  inputPorts: [
    { name: 'note-in', signal: 'note', label: 'IN' },
  ],
  outputPorts: [
    { name: 'note-out', signal: 'note', label: 'OUT', multi: true },
  ],
  defaultParams: {
    rate: 0.6,
    gate: 0.55,
    swing: 0.0,
    pattern: 0.0,
    octaves: 0.0,
    steps: 0.4666666667,
  },
  paramDefs: {
    rate: {
      min: 0,
      max: 1,
      label: 'RATE',
      format: (v: number) => RATE_LABELS[Math.max(0, Math.min(RATE_LABELS.length - 1, Math.round(v * 5)))] ?? '16',
    },
    gate: {
      min: 0,
      max: 1,
      label: 'GATE',
      format: (v: number) => `${Math.round(v * 100)}%`,
    },
    swing: {
      min: 0,
      max: 1,
      label: 'SWING',
      format: (v: number) => `${Math.round(v * 100)}%`,
    },
    pattern: {
      min: 0,
      max: 1,
      label: 'MODE',
      format: (v: number) => PATTERN_LABELS[Math.max(0, Math.min(PATTERN_LABELS.length - 1, Math.round(v * 4)))] ?? 'UP',
    },
    octaves: {
      min: 0,
      max: 1,
      label: 'OCT',
      format: (v: number) => `${1 + Math.max(0, Math.min(3, Math.round(v * 3)))}X`,
    },
    steps: {
      min: 0,
      max: 1,
      label: 'STEPS',
      format: (v: number) => `${1 + Math.max(0, Math.min(15, Math.round(v * 15)))}`,
    },
  },
};
