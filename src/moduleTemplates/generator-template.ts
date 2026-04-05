import type { ModuleDef } from '../types';

/*
  Generator module starter template

  Use this for input/source modules that emit note events into the graph.

  Built-in special cases:
  - 'midi-all' is the global source that receives every MIDI note and QWERTY/onscreen input
  - 'midi-in' is a per-device source keyed by params.deviceId; it should usually stay built in
  - custom generator files are best for new note creators, not for MIDI plumbing

  Recommended conventions:
  - runtimeType can alias to 'midi-all' or 'midi-in' when reusing the built-in router behavior
  - output ports should usually be note outputs
  - shop.tab should point at the folder name used under src/moduleSpecs/
*/

export const GENERATOR_TEMPLATE: ModuleDef = {
  type: 'your-generator-type',
  label: 'YOUR GEN',
  category: 'generator',
  hue: 42,
  shop: {
    tab: 'generators',
    name: 'YOUR GEN',
    desc: 'Replace this with the generator behavior.',
    price: 0,
  },
  inputPorts: [],
  outputPorts: [{ name: 'note-out', signal: 'note', label: 'NOTE OUT', multi: true }],
  defaultParams: {},
  paramDefs: {},
  panelKind: 'generic',
};
