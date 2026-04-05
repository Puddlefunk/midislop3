import type { ModuleDef } from '../../types';
import { sliderToFreq } from '../../config/helpers';

export const spec: ModuleDef = {
  type: 'vcf-x2',
  label: 'VCF-X2',
  category: 'processor',
  hue: 200,
  shop: {
    name: 'VCF-X2',
    desc: 'Dual cascaded filter.',
  },
  defaultParams: {
    cutoff: 0.6,
    res: 0.2,
    filterType: 0,
  },
  paramDefs: {
    cutoff: { min: 0, max: 1, label: 'CUT', format: v => sliderToFreq(v) >= 1000 ? `${(sliderToFreq(v) / 1000).toFixed(1)}k` : `${sliderToFreq(v)}Hz` },
    res: { min: 0, max: 1, label: 'RES', format: v => `${Math.round(v * 100)}%` },
    filterType: { min: 0, max: 1, label: 'TYPE', format: v => (v < 0.33 ? 'LP' : v < 0.67 ? 'HP' : 'BP') },
  },
};
