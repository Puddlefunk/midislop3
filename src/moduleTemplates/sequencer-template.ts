import type { ModuleDef } from '../types';

/*
  Sequencer module starter template

  This is the minimum surface area a model needs to create a new step
  sequencer or note sequencer module without dragging the whole app context.

  Folder-to-shop convention:
  - src/moduleSpecs/sequencers/*.ts shows up under the SEQUENCERS tab
  - use runtimeType to reuse noteSeq/drumSeq behavior when your file is just a wrapper
  - for a truly new sequencer engine, leave runtimeType off and add a new driver later

  Recommended conventions:
  - bar/step layout is described in params and panelKind
  - note outputs should use signal: 'note'
  - audio integration comes from the shared Transport + Sequencers runtime
*/

export const SEQUENCER_TEMPLATE: ModuleDef = {
  type: 'your-sequencer-type',
  label: 'YOUR SEQ',
  category: 'sequencer',
  hue: 160,
  shop: {
    tab: 'sequencers',
    name: 'YOUR SEQ',
    desc: 'Replace this with a sequencer description.',
    price: 0,
  },
  inputPorts: [],
  outputPorts: [{ name: 'note-out', signal: 'note', label: 'NOTE OUT', multi: true }],
  defaultParams: {},
  paramDefs: {},
  panelKind: 'noteSeq',
};
