import type { ModuleDef } from '../../types';

export const spec: ModuleDef = {
  type: 'note-merge-x2',
  label: 'MERGE X2',
  category: 'utility',
  hue: 42,
  runtimeType: 'note-merge',
  shop: {
    name: 'MERGE X2',
    desc: 'Folder-based note merge node that reuses the built-in note-router path.',
    price: 180,
  },
  inputPorts: [
    { name: 'note-in-1', signal: 'note', label: 'IN1' },
    { name: 'note-in-2', signal: 'note', label: 'IN2' },
    { name: 'note-in-3', signal: 'note', label: 'IN3' },
  ],
  outputPorts: [
    { name: 'note-out', signal: 'note', label: 'OUT', multi: true },
  ],
  defaultParams: {},
  paramDefs: {},
  panelKind: 'generic',
};
