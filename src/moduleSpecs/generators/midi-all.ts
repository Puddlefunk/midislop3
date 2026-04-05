import type { ModuleDef } from '../../types';

export const spec: ModuleDef = {
  type: 'midi-all',
  label: 'ALL MIDI\n+ QWERTY',
  category: 'generator',
  hue: 42,
  outputPorts: [
    { name: 'note-out', signal: 'note', label: 'NOTE OUT', multi: true },
  ],
  defaultParams: {},
  paramDefs: {},
};
