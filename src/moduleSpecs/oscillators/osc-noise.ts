import type { ModuleDef } from '../../types';

export const spec: ModuleDef = {
  type: 'osc-noise',
  label: 'NOISE',
  category: 'osc',
  hue: 0,
  shop: {
    name: 'NOISE',
    desc: 'White/coloured noise. Patch audio cable to route into signal chain.',
  },
  inputPorts: [],
  outputPorts: [
    { name: 'audio', signal: 'audio', label: 'OUT', multi: true },
  ],
  defaultParams: {
    level: 0.8,
    color: 1.0,
  },
  paramDefs: {
    level: { min: 0, max: 1, label: 'LEVEL', format: v => `${Math.round(v * 100)}%` },
    color: {
      min: 0,
      max: 1,
      label: 'COLOR',
      format: v => {
        const hz = 300 + v * 19700;
        return hz >= 1000 ? `${(hz / 1000).toFixed(1)}k` : `${hz}Hz`;
      },
    },
  },
};
