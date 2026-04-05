import type { GameMode, GamePhase, Challenge } from '../types';
import { GAME_CONFIG, DEFAULT_FX } from '../config/game';

// ─────────────────────────────────────────────────────────────
// GameState — typed observable object replacing the loose globals
// in app.js. Systems subscribe via on() rather than reading globals.
// ─────────────────────────────────────────────────────────────

type StateHandler<T> = (value: T, prev: T) => void;

export class GameState {
  // Game progress
  score        = 0;
  levelIdx     = 0;
  streakCount  = 0;
  bestStreak   = 0;

  // Mode
  gameMode:  GameMode  = 'play';
  gamePhase: GamePhase = 'awaiting-key';

  // Current challenge
  currentChallenge: Challenge | null = null;
  challengeDeck: Challenge[] = [];

  // Key/scale
  rootKey   = 'C';
  scaleType = 'major';

  // Timer
  timerPresetIdx   = 1; // index into GAME_CONFIG.timing.timerPresets (default 5s)
  challengeTimerMs = 0;

  // Options
  controlsBarPos: 'below' | 'above' | 'top' = 'below';
  audibleChallenges = true;
  showKeyboard      = true;
  showModules       = true;
  folScale          = 1.0;
  internalBpm       = 120;
  useMidiClock      = false;
  fx: Record<string, boolean> = { ...DEFAULT_FX };

  // Shop unlock
  get shopUnlocked(): boolean {
    return this.levelIdx >= GAME_CONFIG.shopUnlockLevel - 1;
  }

  get currentLevel() {
    return GAME_CONFIG.levels[Math.min(this.levelIdx, GAME_CONFIG.levels.length - 1)];
  }

  get challengeTimerSecs(): number {
    return GAME_CONFIG.timing.timerPresets[this.timerPresetIdx] ?? 5;
  }

  // ── Observable change events ─────────────────────────────────

  private _listeners = new Map<string, Set<StateHandler<unknown>>>();

  on<K extends keyof this>(key: K, handler: StateHandler<this[K]>): void {
    if (!this._listeners.has(key as string)) this._listeners.set(key as string, new Set());
    this._listeners.get(key as string)!.add(handler as StateHandler<unknown>);
  }

  set<K extends keyof this>(key: K, value: this[K]): void {
    const prev = this[key];
    if (prev === value) return;
    (this as Record<string, unknown>)[key as string] = value;
    this._listeners.get(key as string)?.forEach(h => h(value, prev));
  }

  // ── Persistence ──────────────────────────────────────────────

  toJSON(): object {
    return {
      score: this.score, levelIdx: this.levelIdx,
      streakCount: this.streakCount, bestStreak: this.bestStreak,
      gameMode: this.gameMode,
      rootKey: this.rootKey, scaleType: this.scaleType,
      timerPresetIdx: this.timerPresetIdx,
      controlsBarPos: this.controlsBarPos,
      audibleChallenges: this.audibleChallenges,
      showKeyboard: this.showKeyboard,
      showModules: this.showModules,
      folScale: this.folScale,
      internalBpm: this.internalBpm,
      useMidiClock: this.useMidiClock,
      fx: { ...this.fx },
    };
  }

  fromJSON(data: Partial<ReturnType<GameState['toJSON']> & Record<string, unknown>>): void {
    if (typeof data !== 'object' || !data) return;
    const d = data as Record<string, unknown>;
    if (typeof d.score          === 'number')  this.set('score',          d.score);
    if (typeof d.levelIdx       === 'number')  this.set('levelIdx',       d.levelIdx);
    if (typeof d.streakCount    === 'number')  this.set('streakCount',    d.streakCount);
    if (typeof d.bestStreak     === 'number')  this.set('bestStreak',     d.bestStreak);
    if (typeof d.gameMode       === 'string')  this.set('gameMode',       d.gameMode as GameMode);
    if (typeof d.rootKey        === 'string')  this.set('rootKey',        d.rootKey);
    if (typeof d.scaleType      === 'string')  this.set('scaleType',      d.scaleType);
    if (typeof d.timerPresetIdx === 'number')  this.set('timerPresetIdx', d.timerPresetIdx);
    if (typeof d.controlsBarPos === 'string')  this.set('controlsBarPos', d.controlsBarPos as GameState['controlsBarPos']);
    if (typeof d.audibleChallenges === 'boolean') this.set('audibleChallenges', d.audibleChallenges);
    if (typeof d.showKeyboard   === 'boolean') this.set('showKeyboard',   d.showKeyboard);
    if (typeof d.showModules    === 'boolean') this.set('showModules',    d.showModules);
    if (typeof d.folScale       === 'number')  {
      // Migrate old saves that stored pre-normalised scale values
      this.set('folScale', d.folScale > 2 ? d.folScale / 1.6 : d.folScale);
    }
    if (typeof d.internalBpm    === 'number')  this.set('internalBpm',    d.internalBpm);
    if (typeof d.useMidiClock   === 'boolean') this.set('useMidiClock',   d.useMidiClock);
    if (typeof d.fx === 'object' && d.fx)      this.set('fx',             { ...DEFAULT_FX, ...(d.fx as Record<string, boolean>) });
  }
}
