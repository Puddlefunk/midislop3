import type { ModuleDef } from '../../types';
import { sliderToGate } from '../../config/helpers';

export const spec: ModuleDef = {
  type: 'noteSeq',
  label: 'SEQ',
  category: 'sequencer',
  hue: 160,
  shop: {
    name: 'STEP SEQ',
    desc: '16-step pitch sequencer. Wire to any oscillator via note cable.',
  },
  inputPorts: [],
  outputPorts: [
    { name: 'note-out', signal: 'note', label: 'NOTE OUT', multi: true },
  ],
  defaultParams: {
    bars: 1,
    rate: '16',
    gate: 0.5,
    fold: 0,
  },
  paramDefs: {
    gate: { min: 0, max: 1, label: 'GATE', format: v => `${Math.round(sliderToGate(v) * 100)}%` },
  },
};
