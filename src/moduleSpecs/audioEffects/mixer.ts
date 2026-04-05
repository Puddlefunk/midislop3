import type { ModuleDef } from '../../types';

const audioIn = (name = 'audio', label = 'IN') => ({ name, signal: 'audio' as const, label });
const audioOut = (name = 'audio', label = 'OUT') => ({ name, signal: 'audio' as const, label, multi: true });
const sendIn = (name: string, label: string) => ({ name, signal: 'send' as const, label });
const sendOut = (name: string, label: string) => ({ name, signal: 'send' as const, label, multi: true });

export const spec: ModuleDef = {
  type: 'mixer',
  label: 'MIX',
  category: 'utility',
  hue: 210,
  shop: {
    name: 'MIXER',
    desc: '4-channel mixer with 2 send/return buses.',
  },
  inputPorts: [
    audioIn('in-0', 'IN1'),
    audioIn('in-1', 'IN2'),
    audioIn('in-2', 'IN3'),
    audioIn('in-3', 'IN4'),
    sendIn('return-0', 'RTN-A'),
    sendIn('return-1', 'RTN-B'),
  ],
  outputPorts: [
    audioOut('audio-0', 'OUT1'),
    audioOut('audio-1', 'OUT2'),
    sendOut('send-0', 'SND-A'),
    sendOut('send-1', 'SND-B'),
  ],
  defaultParams: {
    level: 1.0,
    'level-in-0': 1.0,
    'level-in-1': 1.0,
    'level-in-2': 1.0,
    'level-in-3': 1.0,
    's0-in-0': 0.0,
    's0-in-1': 0.0,
    's0-in-2': 0.0,
    's0-in-3': 0.0,
    's1-in-0': 0.0,
    's1-in-1': 0.0,
    's1-in-2': 0.0,
    's1-in-3': 0.0,
  },
  paramDefs: {
    level: { min: 0, max: 1, label: 'MSTR', format: v => `${Math.round(v * 100)}%` },
  },
};
