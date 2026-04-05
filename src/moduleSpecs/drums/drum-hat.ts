import type { ModuleDef } from '../../types';
import { sliderToDrumDecay } from '../../config/helpers';

export const spec: ModuleDef = {
  type: 'drum-hat',
  label: 'HAT',
  category: 'drum',
  hue: 55,
  shop: {
    name: 'HI-HAT',
    desc: 'Noise burst percussion.',
  },
  defaultParams: {
    decay: 0.2,
    tone: 0.6,
  },
  paramDefs: {
    decay: { min: 0, max: 1, label: 'DECAY', format: v => `${sliderToDrumDecay(v).toFixed(2)}s` },
    tone: { min: 0, max: 1, label: 'TONE', format: v => `${Math.round(v * 100)}%` },
  },
};
