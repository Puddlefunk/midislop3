import type { ModuleDef } from '../../types';
import { formatMs, sliderToAttack, sliderToRelease } from '../../config/helpers';

export const spec: ModuleDef = {
  type: 'sidechain',
  label: 'DUCK',
  category: 'processor',
  hue: 240,
  shop: {
    name: 'SIDECHAIN',
    desc: 'Ducking FX. Patch KEY (return-0) to duck the signal through IN.',
  },
  inputPorts: [
    { name: 'return-0', signal: 'audio', label: 'KEY' },
    { name: 'audio', signal: 'audio', label: 'IN' },
  ],
  outputPorts: [
    { name: 'audio', signal: 'audio', label: 'OUT', multi: true },
  ],
  defaultParams: {
    amount: 0.8,
    attack: 0.3,
    release: 0.5,
    wet: 1.0,
  },
  paramDefs: {
    amount: { min: 0, max: 1, label: 'AMT', format: v => `${Math.round(v * 100)}%` },
    attack: { min: 0, max: 1, label: 'ATK', format: v => formatMs(sliderToAttack(v)) },
    release: { min: 0, max: 1, label: 'REL', format: v => formatMs(sliderToRelease(v)) },
    wet: { min: 0, max: 1, label: 'WET', format: v => `${Math.round(v * 100)}%` },
  },
};
