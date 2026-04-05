import type { ModuleDef } from '../../types';

export const spec: ModuleDef = {
  type: 'midi-in',
  label: 'MIDI IN',
  category: 'generator',
  hue: 42,
  outputPorts: [
    { name: 'note-out', signal: 'note', label: 'NOTE OUT', multi: true },
  ],
  defaultParams: {
    deviceId: '',
    deviceName: '',
  },
  paramDefs: {},
};
