// ─────────────────────────────────────────────────────────────
// Core signal and port types
// ─────────────────────────────────────────────────────────────

export type SignalType = 'audio' | 'note' | 'send';

export type ModuleCategory =
  | 'osc'
  | 'processor'
  | 'drum'
  | 'sequencer'
  | 'utility'
  | 'generator';

export interface Port {
  name: string;
  signal: SignalType;
  label: string;
  /** true = this port can have multiple connections (fan-out output / dynamic input) */
  multi?: boolean;
}

// ─────────────────────────────────────────────────────────────
// Module definitions (static schema, lives in config/modules.ts)
// ─────────────────────────────────────────────────────────────

export type ParamValue = number | string | boolean;

export interface ParamDef {
  min: number;
  max: number;
  label: string;
  format: (v: number) => string;
}

export interface ModuleDef {
  /** Optional explicit module type for file-based specs. Built-ins still use the map key. */
  type?: string;
  label: string;
  category: ModuleCategory;
  hue: number;
  defaultParams: Record<string, ParamValue>;
  paramDefs: Record<string, ParamDef>;
  /** Optional shop metadata for file-based module specs. */
  shop?: {
    tab?: string;
    name: string;
    desc: string;
    price?: number;
  };
  /** Optional UI renderer hint for custom modules. */
  panelKind?: string;
  /** Optional runtime alias. If set, AudioGraph uses this type's driver. */
  runtimeType?: string;

  // Explicit port lists — single source of truth for jack rendering and patch validation.
  // If omitted, getModuleDef() fills them from CATEGORY_PORT_DEFAULTS.
  inputPorts?: Port[];
  outputPorts?: Port[];


  // Audio/note semantics
  waveform?: string;              // default waveform for osc types
}

// ─────────────────────────────────────────────────────────────
// Module instances (live data, lives in ModuleRegistry)
// ─────────────────────────────────────────────────────────────

export interface ModuleInstance {
  id: string;
  type: string;
  params: Record<string, ParamValue>;
}

// ─────────────────────────────────────────────────────────────
// Patch graph
// ─────────────────────────────────────────────────────────────

export interface Patch {
  fromId: string;
  fromPort: string;
  toId: string;
  toPort: string;
  signalType: SignalType;
}

// ─────────────────────────────────────────────────────────────
// Registry events
// ─────────────────────────────────────────────────────────────

export interface RegistryEvents {
  'module-added':   ModuleInstance;
  'module-removed': { id: string; type: string };
  'param-changed':  { id: string; param: string; value: ParamValue };
  'patch-changed':  { patches: Patch[] };
}

// ─────────────────────────────────────────────────────────────
// Registry commands — the event-sourced mutation model.
// All state changes flow through applyCommand; the public API
// methods (addModule, setParam, etc.) are thin wrappers that
// generate and dispatch these commands.
// ─────────────────────────────────────────────────────────────

export type RegistryCommand =
  | { type: 'ADD_MODULE';    id: string; moduleType: string; params: Record<string, ParamValue> }
  | { type: 'REMOVE_MODULE'; id: string }
  | { type: 'SET_PARAM';     id: string; param: string; value: ParamValue }
  | { type: 'ADD_PATCH';     fromId: string; fromPort: string; toId: string; toPort: string }
  | { type: 'REMOVE_PATCH';  fromId: string; fromPort: string; toId: string; toPort: string };

// ─────────────────────────────────────────────────────────────
// Note routing
// ─────────────────────────────────────────────────────────────

export interface NoteEvent {
  midi: number;
  velocity: number;
  /** null = QWERTY or on-screen piano */
  deviceId: string | null;
  /** The generator module that owns this note. null = unowned (legacy), 'midi-all-0' = MIDI/QWERTY */
  generatorId: string | null;
}

// ─────────────────────────────────────────────────────────────
// Game state
// ─────────────────────────────────────────────────────────────

export type GameMode = 'play' | 'practice' | 'ear' | 'coop' | 'competitive' | 'tennis';
export type GamePhase = 'awaiting-key' | 'hint' | 'play' | 'success' | 'fail';

export interface Challenge {
  display: string;
  notes: string[];
  diff: number;
}

export interface LevelDef {
  n: number;
  label: string;
  maxDiff: number;
  hintMs: number;
  scoreThreshold: number;
  paramUnlock: string | null;
}

// ─────────────────────────────────────────────────────────────
// Save format (versioned)
// ─────────────────────────────────────────────────────────────

export interface SaveFile {
  version: 1;
  createdAt: string;
  game: {
    score: number;
    levelIdx: number;
    streakCount: number;
    bestStreak: number;
    gameMode: GameMode;
    timerPresetIdx: number;
    rootKey: string;
    scaleType: string;
    folScale: number;
    controlsBarPos: 'below' | 'above' | 'top';
    audibleChallenges: boolean;
    showKeyboard: boolean;
    showModules: boolean;
    internalBpm: number;
    useMidiClock: boolean;
    fx: Record<string, boolean>;
    customBtns: string[];
  };
  synth: {
    modules: Array<{ id: string; type: string; params: Record<string, ParamValue> }>;
    patches: Patch[];
    panelPositions: Record<string, { left: number; top: number }>;
    midiCCMap: Record<string, string>;
  };
}

// ─────────────────────────────────────────────────────────────
// Jack position (used by PatchSystem canvas drawing)
// ─────────────────────────────────────────────────────────────

export interface JackPosition {
  id: string;
  modId: string;
  port: string;
  x: number;
  y: number;
  h: number;         // hue from module def
  isOut: boolean;
  isEmpty: boolean;
  isNote: boolean;
  isSend: boolean;
  plugged: boolean;
  alpha: number;
}

export interface PatchCursor {
  fromId: string;
  fromPort: string;
  signalType: SignalType;
  fromJack: { x: number; y: number; h: number };
  /** reverse=true: anchored at input, dragging free output end to a new source */
  reverse?: boolean;
  toId?: string;
  toPort?: string;
}
