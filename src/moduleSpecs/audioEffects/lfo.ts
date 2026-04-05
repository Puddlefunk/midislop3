import type { ModuleDef } from '../../types';
import { sliderToLfoRate } from '../../config/helpers';

export const spec: ModuleDef = {
  type: 'lfo',
  label: 'LFO',
  category: 'processor',
  hue: 160,
  shop: {
    name: 'LFO',
    desc: 'Tremolo insert. Patch audio through for amplitude modulation.',
  },
  defaultParams: {
    rate: 0.1,
    depth: 0.5,
  },
  paramDefs: {
    rate: { min: 0, max: 1, label: 'RATE', format: v => `${sliderToLfoRate(v).toFixed(1)}Hz` },
    depth: { min: 0, max: 1, label: 'DEPTH', format: v => `${Math.round(v * 100)}%` },
  },
};
