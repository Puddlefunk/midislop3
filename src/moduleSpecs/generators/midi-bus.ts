import type { ModuleDef } from '../../types';

export const spec: ModuleDef = {
  type: 'midi-bus',
  label: 'MIDI BUS',
  category: 'generator',
  hue: 42,
  runtimeType: 'midi-all',
  shop: {
    name: 'MIDI BUS',
    desc: 'Folder-based input source that reuses the built-in all-MIDI router path.',
    price: 0,
  },
  inputPorts: [],
  outputPorts: [{ name: 'note-out', signal: 'note', label: 'NOTE OUT', multi: true }],
  defaultParams: {},
  paramDefs: {},
  panelKind: 'generic',
};
