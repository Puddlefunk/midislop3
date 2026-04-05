import type { ModuleDef } from '../../types';

const noteIn = (name: string, label: string) => ({ name, signal: 'note' as const, label });
const noteOut = (name = 'note-out', label = 'NOTE OUT') => ({ name, signal: 'note' as const, label, multi: true });

export const spec: ModuleDef = {
  type: 'note-merge',
  label: 'MERGE',
  category: 'utility',
  hue: 42,
  shop: {
    name: 'MERGE',
    desc: 'Fan-in up to 3 note streams into one output.',
  },
  inputPorts: [
    noteIn('note-in-1', 'IN1'),
    noteIn('note-in-2', 'IN2'),
    noteIn('note-in-3', 'IN3'),
  ],
  outputPorts: [noteOut()],
  defaultParams: {},
  paramDefs: {},
};
