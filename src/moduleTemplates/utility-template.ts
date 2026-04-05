import type { ModuleDef } from '../types';

/*
  Utility/router module starter template

  Use this for general graph helpers that are not primarily note-domain.
  If the module touches musical note flow, prefer the note utility template.

  Conventions:
  - category is usually 'utility'
  - runtimeType can reuse an existing built-in helper when the node is just a wrapper
  - panelKind is usually 'generic' unless the module has a dedicated UI
  - input/output port names should describe routing intent, not audio synthesis
*/

export const UTILITY_TEMPLATE: ModuleDef = {
  type: 'your-utility-type',
  label: 'YOUR UTILITY',
  category: 'utility',
  hue: 42,
  shop: {
    tab: 'utility',
    name: 'YOUR UTILITY',
    desc: 'Replace this with the utility/router behavior.',
    price: 0,
  },
  inputPorts: [],
  outputPorts: [],
  defaultParams: {},
  paramDefs: {},
  panelKind: 'generic',
};
