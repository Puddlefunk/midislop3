import type { ModuleDef } from '../../types';
import { formatMs, sliderToDelayTime } from '../../config/helpers';

export const spec: ModuleDef = {
  type: 'delay',
  label: 'DELAY',
  category: 'processor',
  hue: 200,
  shop: {
    name: 'DELAY',
    desc: 'Tape-style echo with feedback.',
  },
  defaultParams: {
    time: 0.3,
    feedback: 0.4,
    mix: 0.4,
  },
  paramDefs: {
    time: { min: 0, max: 1, label: 'TIME', format: v => formatMs(sliderToDelayTime(v)) },
    feedback: { min: 0, max: 1, label: 'FEED', format: v => `${Math.round(v * 100)}%` },
    mix: { min: 0, max: 1, label: 'MIX', format: v => `${Math.round(v * 100)}%` },
  },
};
