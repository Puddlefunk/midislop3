import type { ModuleDef } from '../../types';

export const spec: ModuleDef = {
  type: 'audio-out',
  label: 'OUT',
  category: 'utility',
  hue: 0,
  inputPorts: [
    { name: 'audio', signal: 'audio', label: 'IN' },
  ],
  outputPorts: [],
  defaultParams: {},
  paramDefs: {},
};
