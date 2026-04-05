import type { ModuleDef } from '../../types';
import { sliderToFreq } from '../../config/helpers';

export const spec: ModuleDef = {
  type: 'filter-x2',
  label: 'FILTER X2',
  category: 'processor',
  hue: 198,
  runtimeType: 'vcf-x2',
  panelKind: 'filter',
  shop: {
    name: 'FILTER X2',
    desc: 'Folder-based filter module that reuses the built-in VCF runtime.',
    price: 700,
  },
  inputPorts: [
    { name: 'audio', signal: 'audio', label: 'IN' },
  ],
  outputPorts: [
    { name: 'audio', signal: 'audio', label: 'OUT', multi: true },
  ],
  defaultParams: {
    cutoff: 0.58,
    res: 0.25,
    filterType: 0,
  },
  paramDefs: {
    cutoff: {
      min: 0,
      max: 1,
      label: 'CUT',
      format: (v: number) => {
        const hz = sliderToFreq(v);
        return hz >= 1000 ? `${(hz / 1000).toFixed(1)}k` : `${hz}Hz`;
      },
    },
    res: {
      min: 0,
      max: 1,
      label: 'RES',
      format: (v: number) => `${Math.round(v * 100)}%`,
    },
    filterType: {
      min: 0,
      max: 1,
      label: 'TYPE',
      format: (v: number) => (v < 0.33 ? 'LP' : v < 0.67 ? 'HP' : 'BP'),
    },
  },
};
