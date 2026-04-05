import type { ModuleDef } from '../../types';

const noteIn = (name = 'note-in', label = 'NOTE IN') => ({ name, signal: 'note' as const, label });
const noteOut = (name = 'note-out', label = 'NOTE OUT') => ({ name, signal: 'note' as const, label, multi: true });

export const spec: ModuleDef = {
  type: 'chord',
  label: 'CHORD',
  category: 'utility',
  hue: 42,
  shop: {
    name: 'CHORD',
    desc: 'Note-domain chord splitter. One note in, three voices out.',
  },
  inputPorts: [noteIn()],
  outputPorts: [
    noteOut('note-out-1', 'V1'),
    noteOut('note-out-2', 'V2'),
    noteOut('note-out-3', 'V3'),
  ],
  defaultParams: {
    'offset-0': 0,
    'vel-0': 1,
    'offset-1': 0,
    'vel-1': 1,
    'offset-2': 0,
    'vel-2': 1,
    mode: 'combined',
  },
  paramDefs: {
    'offset-0': { min: -12, max: 12, label: 'OFF', format: v => `${v >= 0 ? '+' : ''}${Math.round(v)}st` },
    'vel-0': { min: 0, max: 1, label: 'VEL', format: v => `${Math.round(v * 100)}%` },
    'offset-1': { min: -12, max: 12, label: 'OFF', format: v => `${v >= 0 ? '+' : ''}${Math.round(v)}st` },
    'vel-1': { min: 0, max: 1, label: 'VEL', format: v => `${Math.round(v * 100)}%` },
    'offset-2': { min: -12, max: 12, label: 'OFF', format: v => `${v >= 0 ? '+' : ''}${Math.round(v)}st` },
    'vel-2': { min: 0, max: 1, label: 'VEL', format: v => `${Math.round(v * 100)}%` },
  },
};
