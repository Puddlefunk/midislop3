import type { ModuleDef } from '../../types';
import { sliderToDrumDecay, sliderToKickFreq } from '../../config/helpers';

export const spec: ModuleDef = {
  type: 'drum-kick',
  label: 'KICK',
  category: 'drum',
  hue: 0,
  shop: {
    name: '808 KICK',
    desc: 'Classic sine sweep kick.',
  },
  defaultParams: {
    freq: 0.3,
    punch: 0.7,
    decay: 0.5,
  },
  paramDefs: {
    freq: { min: 0, max: 1, label: 'FREQ', format: v => `${sliderToKickFreq(v).toFixed(0)}Hz` },
    punch: { min: 0, max: 1, label: 'PUNCH', format: v => `${Math.round(v * 100)}%` },
    decay: { min: 0, max: 1, label: 'DECAY', format: v => `${sliderToDrumDecay(v).toFixed(2)}s` },
  },
};
