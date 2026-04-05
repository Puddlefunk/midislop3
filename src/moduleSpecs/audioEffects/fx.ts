import type { ModuleDef } from '../../types';

export const spec: ModuleDef = {
  type: 'fx',
  label: 'REVERB',
  category: 'processor',
  hue: 260,
  shop: {
    name: 'REVERB',
    desc: 'Convolution reverb. Audio in -> wet/dry mix -> audio out.',
  },
  defaultParams: {
    wet: 0.4,
    size: 0.5,
    damp: 0.8,
    pre: 0.0,
  },
  paramDefs: {
    wet: { min: 0, max: 1, label: 'WET', format: v => `${Math.round(v * 100)}%` },
    size: { min: 0, max: 1, label: 'SIZE', format: v => `${Math.round(v * 100)}%` },
    damp: { min: 0, max: 1, label: 'DAMP', format: v => { const hz = 1000 + v * 19000; return hz >= 1000 ? `${(hz / 1000).toFixed(1)}k` : `${hz}Hz`; } },
    pre: { min: 0, max: 1, label: 'PRE', format: v => `${Math.round(v * 100)}ms` },
  },
};
