import type { LevelDef } from '../types';

export interface GameConfig {
  levels: LevelDef[];
  scoring: {
    basePoints: number;
    timeBonusMax: number;
    streakBonusPerHit: number;
    wrongChordPenalty: number;
    timeoutPenalty: number;
    extensionBonus: number;
    pentatonicBonus: number;
  };
  timing: {
    timerPresets: number[];
    defaultTimer: number;
  };
  competitive: {
    lockoutMs: number;
    roundsPerLevel: number;
  };
  modulePrices: Record<string, number>;
  shopUnlockLevel: number;
}

export const GAME_CONFIG: GameConfig = {
  levels: [
    { n:1,  label:'LEVEL 1',   maxDiff:1, hintMs:2200, scoreThreshold:0,     paramUnlock:null      },
    { n:2,  label:'LEVEL 2',   maxDiff:1, hintMs:1800, scoreThreshold:400,   paramUnlock:null      },
    { n:3,  label:'LEVEL 3',   maxDiff:2, hintMs:1600, scoreThreshold:900,   paramUnlock:'filter'  },
    { n:4,  label:'LEVEL 4',   maxDiff:2, hintMs:1400, scoreThreshold:1600,  paramUnlock:'env'     },
    { n:5,  label:'LEVEL 5',   maxDiff:3, hintMs:1000, scoreThreshold:2600,  paramUnlock:'delay'   },
    { n:6,  label:'LEVEL 6',   maxDiff:3, hintMs:800,  scoreThreshold:3800,  paramUnlock:'mixer'   },
    { n:7,  label:'LEVEL 7',   maxDiff:4, hintMs:600,  scoreThreshold:5400,  paramUnlock:'fx'      },
    { n:8,  label:'LEVEL 8',   maxDiff:6, hintMs:280,  scoreThreshold:7400,  paramUnlock:null      },
    { n:9,  label:'LEVEL 9',   maxDiff:6, hintMs:180,  scoreThreshold:9800,  paramUnlock:'lfo'     },
    { n:10, label:'LEVEL 10',  maxDiff:7, hintMs:80,   scoreThreshold:12000, paramUnlock:null      },
    { n:11, label:'LEVEL MAX', maxDiff:7, hintMs:35,   scoreThreshold:16000, paramUnlock:null      },
  ],

  scoring: {
    basePoints: 100,
    timeBonusMax: 100,
    streakBonusPerHit: 15,
    wrongChordPenalty: 10,
    timeoutPenalty: 30,
    extensionBonus: 20,
    pentatonicBonus: 10,
  },

  timing: {
    timerPresets: [3, 5, 10, 0],
    defaultTimer: 5,
  },

  competitive: {
    lockoutMs: 1500,
    roundsPerLevel: 8,
  },

  modulePrices: {
    'osc-sine': 400, 'osc-saw': 600, 'osc-tri': 480, 'osc-sq': 600,
    'osc-sub': 800, 'osc-noise': 1000, 'osc': 1200,
    'filter': 600, 'vcf-x2': 600, 'env': 1000, 'fx': 1600, 'delay': 1400, 'lfo': 2000,
    'chord': 600, 'note-merge': 400,
    'mixer': 1800,
    'noteSeq': 2400, 'drumSeq': 1800,
    'drum-hat': 1200, 'drum-kick': 1400, 'drum-snare': 1300,
    'sidechain': 2000,
    'midi-in': 0, 'midi-all': 0,
  },

  // Derived: first level where shop unlocks (level 2 in current balance)
  shopUnlockLevel: 2,
};

// Chord pool difficulty weights — tune here, not in game logic
export const CHORD_DIFF_WEIGHTS: Record<number, number> = {
  1: 1.0,
  2: 1.0,
  3: 1.0,
  4: 1.0,
};

// FX feature flags (persisted to save)
export const DEFAULT_FX: Record<string, boolean> = {
  particles:      true,
  bolts:          true,
  keyGuides:      true,
  screenRipples:  true,
  jackLighting:   true,
};
