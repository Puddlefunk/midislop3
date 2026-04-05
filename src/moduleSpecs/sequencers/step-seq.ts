import type { ModuleDef } from '../../types';
import { sliderToGate } from '../../config/helpers';

export const spec: ModuleDef = {
  type: 'step-seq',
  label: 'STEP SEQ',
  category: 'sequencer',
  hue: 164,
  runtimeType: 'noteSeq',
  panelKind: 'noteSeq',
  shop: {
    name: 'STEP SEQ',
    desc: 'Folder-based note sequencer that reuses the built-in step grid runtime.',
    price: 520,
  },
  inputPorts: [],
  outputPorts: [
    { name: 'note-out', signal: 'note', label: 'NOTE OUT', multi: true },
  ],
  defaultParams: {
    bars: 1,
    rate: '16',
    gate: 0.55,
    fold: 0,
  },
  paramDefs: {
    bars: {
      min: 1,
      max: 4,
      label: 'BARS',
      format: (v: number) => String(Math.max(1, Math.round(v))),
    },
    rate: {
      min: 0,
      max: 1,
      label: 'RATE',
      format: (v: number) => ['4', '8', 'd8', 't8', '16', '32'][Math.round(v * 5)] ?? '16',
    },
    gate: {
      min: 0,
      max: 1,
      label: 'GATE',
      format: (v: number) => `${Math.round(sliderToGate(v) * 100)}%`,
    },
    fold: {
      min: 0,
      max: 1,
      label: 'FOLD',
      format: (v: number) => (v > 0.5 ? 'ON' : 'OFF'),
    },
  },
};
