import type { ModuleDef } from '../types';

/*
  FX module starter template

  Use this when you want a new audio effect file that can be dropped into
  src/moduleSpecs/<folder>/ and discovered by the loader.

  Folder-to-shop convention:
  - the parent folder name becomes the shop tab if shop.tab is omitted
  - e.g. src/moduleSpecs/audioEffects/filter-x2.ts shows up under AUDIO EFFECTS
  - the module file can still override shop.tab if you want to place it elsewhere

  Required conventions:
  - type: unique module id string
  - category: usually 'processor'
  - shop: folder/page metadata for the shop UI
  - ports: explicit audio/send port definitions
  - defaultParams + paramDefs: the knob schema
  - panelKind: 'filter' | 'mixer' | 'generic' (optional)
  - runtimeType: existing driver alias if the module reuses a built-in engine
*/

export const FX_TEMPLATE: ModuleDef = {
  type: 'your-fx-type',
  label: 'YOUR FX',
  category: 'processor',
  hue: 210,
  shop: {
    tab: 'audioEffects',
    name: 'YOUR FX',
    desc: 'Replace this description with the module behavior.',
    price: 0,
  },
  inputPorts: [{ name: 'audio', signal: 'audio', label: 'IN' }],
  outputPorts: [{ name: 'audio', signal: 'audio', label: 'OUT', multi: true }],
  defaultParams: {},
  paramDefs: {},
  panelKind: 'generic',
};
