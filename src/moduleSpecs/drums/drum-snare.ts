import type { ModuleDef } from '../../types';
import { sliderToDrumDecay } from '../../config/helpers';

export const spec: ModuleDef = {
  type: 'drum-snare',
  label: 'SNARE',
  category: 'drum',
  hue: 30,
  shop: {
    name: 'SNARE',
    desc: 'Noise + tone snare.',
  },
  defaultParams: {
    snap: 0.5,
    decay: 0.4,
  },
  paramDefs: {
    snap: { min: 0, max: 1, label: 'SNAP', format: v => `${Math.round(v * 100)}%` },
    decay: { min: 0, max: 1, label: 'DECAY', format: v => `${sliderToDrumDecay(v).toFixed(2)}s` },
  },
};
