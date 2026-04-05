import type { ModuleDef } from '../../types';
import { formatMs, sliderToAttack, sliderToDecay, sliderToRelease } from '../../config/helpers';

export const spec: ModuleDef = {
  type: 'adsr-x2',
  label: 'ADSR-X2',
  category: 'processor',
  hue: 300,
  shop: {
    name: 'ADSR-X2',
    desc: 'Patchable ADSR VCA. Patch TRIG from a note source, audio in/out.',
  },
  inputPorts: [
    { name: 'audio', signal: 'audio', label: 'IN' },
    { name: 'note-in', signal: 'note', label: 'TRIG' },
  ],
  outputPorts: [
    { name: 'audio', signal: 'audio', label: 'OUT', multi: true },
  ],
  defaultParams: {
    attack: 0.02,
    decay: 0.22,
    sustain: 0.55,
    release: 0.2,
  },
  paramDefs: {
    attack: { min: 0, max: 1, label: 'ATK', format: v => formatMs(sliderToAttack(v)) },
    decay: { min: 0, max: 1, label: 'DEC', format: v => formatMs(sliderToDecay(v)) },
    sustain: { min: 0, max: 1, label: 'SUS', format: v => `${Math.round(v * 100)}%` },
    release: { min: 0, max: 1, label: 'REL', format: v => formatMs(sliderToRelease(v)) },
  },
};
