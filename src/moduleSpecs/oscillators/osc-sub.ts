import type { ModuleDef } from '../../types';
import { sliderToLfoRate } from '../../config/helpers';

const OSC_EXTRA_PARAMS = {
  semi: 0,
  portamento: 0,
  'vib-rate': 0,
  'vib-depth': 0,
  detune: 0,
  'vel-sens': 0,
};

const OSC_EXTRA_PARAM_DEFS = {
  semi: { min: -12, max: 12, label: 'SEMI', format: (v: number) => `${v >= 0 ? '+' : ''}${Math.round(v)}st` },
  portamento: { min: 0, max: 1, label: 'GLIDE', format: (v: number) => `${(v * 2).toFixed(2)}s` },
  'vib-rate': { min: 0, max: 1, label: 'V.RT', format: (v: number) => `${sliderToLfoRate(v).toFixed(1)}Hz` },
  'vib-depth': { min: 0, max: 1, label: 'V.DP', format: (v: number) => `${Math.round(v * 100)}%` },
  detune: { min: 0, max: 1, label: 'DTUNE', format: (v: number) => `${Math.round(v * 25)}ct` },
  'vel-sens': { min: 0, max: 1, label: 'VELS', format: (v: number) => `${Math.round(v * 100)}%` },
};

export const spec: ModuleDef = {
  type: 'osc-sub',
  label: 'SUB',
  category: 'osc',
  hue: 270,
  shop: {
    name: 'SUB OSC',
    desc: 'Square wave an octave below.',
  },
  defaultParams: { level: 0.8, octave: -1, subTune: 0, ...OSC_EXTRA_PARAMS },
  paramDefs: {
    level: { min: 0, max: 1, label: 'LEVEL', format: v => `${Math.round(v * 100)}%` },
    subTune: { min: -1, max: 1, label: 'TUNE', format: v => `${v >= 0 ? '+' : ''}${Math.round(v * 100)}ct` },
    ...OSC_EXTRA_PARAM_DEFS,
  },
};
