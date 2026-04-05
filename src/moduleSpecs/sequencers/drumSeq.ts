import type { ModuleDef } from '../../types';

export const spec: ModuleDef = {
  type: 'drumSeq',
  label: 'DRUMS',
  category: 'sequencer',
  hue: 0,
  shop: {
    name: 'DRUM SEQ',
    desc: '4-bar drum sequencer. Wire rows to drum voices.',
  },
  inputPorts: [],
  outputPorts: [
    { name: 'note-out-0', signal: 'note', label: 'ROW1', multi: true },
    { name: 'note-out-1', signal: 'note', label: 'ROW2', multi: true },
    { name: 'note-out-2', signal: 'note', label: 'ROW3', multi: true },
    { name: 'note-out-3', signal: 'note', label: 'ROW4', multi: true },
  ],
  defaultParams: {
    steps: 16,
    bars: 1,
  },
  paramDefs: {},
};
