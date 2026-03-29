import type { ModuleRegistry } from '../core/ModuleRegistry';
import type { GameState } from './GameState';
import type { NoteRouter } from '../input/NoteRouter';
import type { Challenge } from '../types';
import { GAME_CONFIG } from '../config/game';
import { CHORD_POOL, buildKeyPool, chordExtensionPCs, pentatonicPCs } from '../config/chords';
import { NOTE_NAMES, normPc, rootHue } from '../config/helpers';

// ─────────────────────────────────────────────────────────────
// GameEngine — chord detection, scoring, level progression.
// Ported from midigame/app.js sections S11–S15.
//
// State ownership:
//   GameState holds: score, levelIdx, streakCount (=streak multiplier),
//     gameMode, gamePhase, currentChallenge, challengeDeck.
//   GameEngine holds: phase timers, streak-hit counter, bonus windows,
//     idle timeout counter, key pool.
//
// Events emitted:
//   'game-started'      { rootKey, scaleType, h }
//   'game-stopped'      {}
//   'auto-stopped'      { reason: 'level-up' | 'idle' }
//   'challenge-start'   { display, notes, h }
//   'phase-play'        { timerSecs }
//   'timer-frac'        { frac }         — fires each frame during play phase
//   'challenge-success' { display, h, points }
//   'challenge-fail'    { reason, display }
//   'score-changed'     { score, delta }
//   'level-up'          { levelIdx, label, streakTriggered }
//   'streak-level'      { level }        — streak level earned (1–4)
// ─────────────────────────────────────────────────────────────

type GameEventHandler = (data: unknown) => void;

function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export class GameEngine {
  private registry: ModuleRegistry;
  private state:    GameState;
  private router:   NoteRouter;

  private _activeNotes    = new Map<number, { startTime: number }>();
  private _listeners      = new Map<string, Set<GameEventHandler>>();

  private _gameKeyPool:   Challenge[] | null = null;
  private _phaseStart     = 0;
  private _playPhaseStart = 0;
  private _phrasePeakNotes = 0;

  // Streak internals. _streakHits is 0–3 progress within current level.
  // _streakLevels is the multiplier (0–4); state.streakCount mirrors it for the HUD.
  private _streakHits   = 0;
  private _streakLevels = 0;

  private _wrongPenaltyGiven = false;
  private _bonusExtPCs   = new Set<number>();
  private _bonusPentPCs  = new Set<number>();
  private _bonusExtGiven  = false;
  private _bonusPentGiven = false;
  private _idleTimeouts  = 0;

  constructor(registry: ModuleRegistry, state: GameState, router: NoteRouter) {
    this.registry = registry;
    this.state    = state;
    this.router   = router;
    this.router.onNoteOn(e  => this._onNoteOn(e.midi));
    this.router.onNoteOff(e => this._onNoteOff(e.midi));
  }

  // ── Note tracking ─────────────────────────────────────────────

  private _onNoteOn(midi: number): void {
    this._activeNotes.set(midi, { startTime: performance.now() });
    this._phrasePeakNotes = Math.max(this._phrasePeakNotes, this._activeNotes.size);
    if (this.state.gamePhase === 'play') this.checkSuccess();
    // Bonus window: extra points for extension/pentatonic notes held after success
    if (this.state.gamePhase === 'success') this._checkBonusNote(midi);
  }

  private _onNoteOff(midi: number): void {
    this._activeNotes.delete(midi);
  }

  // ── Game control ──────────────────────────────────────────────

  startGame(root: string, scale: string): void {
    this._gameKeyPool     = buildKeyPool(root, scale) ?? CHORD_POOL;
    this.state.set('rootKey',   root);
    this.state.set('scaleType', scale);
    this.state.set('gameMode', 'play');
    this.state.challengeDeck = [];
    this._streakHits      = 0;
    this._streakLevels    = 0;
    this._idleTimeouts    = 0;
    this.state.set('streakCount', 0);
    this._emit('game-started', { rootKey: root, scaleType: scale, h: rootHue(root) });
    setTimeout(() => {
      if (this.state.gameMode === 'play') this.startNextChallenge();
    }, 1200);
  }

  stopGame(): void {
    this.state.set('gameMode', 'practice');
    this.state.set('currentChallenge', null);
    this._emit('game-stopped', {});
  }

  startNextChallenge(): void {
    if (this.state.gameMode !== 'play') return;
    if (this.state.challengeDeck.length === 0) this._buildDeck();

    // Avoid same chord twice in a row
    const deck = this.state.challengeDeck;
    const prev = this.state.currentChallenge;
    if (prev && deck.length > 1 && deck[0].display === prev.display) {
      const j = 1 + Math.floor(Math.random() * (deck.length - 1));
      [deck[0], deck[j]] = [deck[j], deck[0]];
    }

    const chord          = deck.shift()!;
    this.state.currentChallenge = chord;
    this._phrasePeakNotes  = 0;
    this._wrongPenaltyGiven = false;
    this._bonusExtGiven     = false;
    this._bonusPentGiven    = false;

    this.state.set('gamePhase', 'hint');
    this._phaseStart = performance.now();

    const h = rootHue(chord.display);
    this._emit('challenge-start', { display: chord.display, notes: chord.notes, h });
  }

  private _buildDeck(): void {
    const maxDiff = GAME_CONFIG.levels[this.state.levelIdx].maxDiff;
    const src     = (this._gameKeyPool ?? CHORD_POOL).filter(c => c.diff <= maxDiff);
    const groups: Challenge[] = [];
    for (let d = 1; d <= maxDiff; d++) {
      const g = src.filter(c => c.diff === d);
      groups.push(...shuffle([...g]));
    }
    this.state.challengeDeck = groups.length ? groups : shuffle([...src]);
    if (!this.state.challengeDeck.length) this.state.challengeDeck = shuffle([...CHORD_POOL]);
  }

  // ── Per-frame update (call from animation loop) ───────────────

  update(): void {
    if (this.state.gameMode !== 'play') return;
    const elapsed = performance.now() - this._phaseStart;
    const level   = GAME_CONFIG.levels[this.state.levelIdx];

    if (this.state.gamePhase === 'hint') {
      const hintMs = level.hintMs;
      if (elapsed >= hintMs) {
        this.state.set('gamePhase', 'play');
        this._playPhaseStart = performance.now();
        this._phaseStart     = this._playPhaseStart;
        this._emit('phase-play', { timerSecs: this.state.challengeTimerSecs });
      } else {
        const t = elapsed / hintMs;
        const a = t < 0.25 ? t / 0.25 : t < 0.65 ? 1 : 1 - (t - 0.65) / 0.35;
        this._emit('hint-alpha', { alpha: Math.max(0, a) });
      }
    }

    if (this.state.gamePhase === 'play' && this.state.challengeTimerSecs > 0) {
      const frac = Math.max(0, 1 - (performance.now() - this._playPhaseStart) / (this.state.challengeTimerSecs * 1000));
      this._emit('timer-frac', { frac });
      if (frac <= 0) this.triggerFail('timeout');
    }
  }

  // ── Chord detection ───────────────────────────────────────────

  checkSuccess(): void {
    if (this.state.gamePhase !== 'play' || !this.state.currentChallenge) return;

    const required = this.state.currentChallenge.notes.map(n => NOTE_NAMES.indexOf(normPc(n)));
    const played   = new Set([...this._activeNotes.keys()].map(m => m % 12));

    if (required.every(pc => played.has(pc))) {
      this.triggerSuccess();
      return;
    }

    // Wrong chord penalty (once per challenge)
    if (!this._wrongPenaltyGiven && played.size >= required.length) {
      this._wrongPenaltyGiven = true;
      const pen = GAME_CONFIG.scoring.wrongChordPenalty;
      this.state.set('score', Math.max(0, this.state.score - pen));
      this._emit('score-changed', { score: this.state.score, delta: -pen });
    }
  }

  triggerSuccess(): void {
    if (this.state.gamePhase === 'success') return;
    this.state.set('gamePhase', 'success');

    const challenge = this.state.currentChallenge!;
    const h = rootHue(challenge.display);

    // Set up bonus window
    this._bonusExtPCs  = new Set(chordExtensionPCs(challenge.notes));
    this._bonusPentPCs = new Set(pentatonicPCs(challenge.notes[0]));
    for (const midi of this._activeNotes.keys()) this._checkBonusNote(midi);

    const pts = this._addScore();
    this._emit('challenge-success', { display: challenge.display, h, points: pts });
    setTimeout(() => {
      if (this.state.gameMode === 'play') this.startNextChallenge();
    }, 2000);
  }

  triggerFail(reason: 'wrong' | 'timeout'): void {
    if (this.state.gamePhase !== 'play') return;
    this.state.set('gamePhase', 'fail');

    this._streakHits = 0;
    if (this._streakLevels > 0) {
      this._streakLevels--;
      this.state.set('streakCount', this._streakLevels);
    }

    if (reason === 'timeout') {
      const pen = GAME_CONFIG.scoring.timeoutPenalty;
      this.state.set('score', Math.max(0, this.state.score - pen));
      this._emit('score-changed', { score: this.state.score, delta: -pen });

      if (this._phrasePeakNotes === 0) {
        this._idleTimeouts++;
        if (this._idleTimeouts >= 10) {
          this._emit('challenge-fail', { reason, display: this.state.currentChallenge?.display ?? '' });
          setTimeout(() => {
            this.stopGame();
            this._emit('auto-stopped', { reason: 'idle' });
          }, 600);
          return;
        }
      } else {
        this._idleTimeouts = 0;
      }
    }

    this._emit('challenge-fail', { reason, display: this.state.currentChallenge?.display ?? '' });
    setTimeout(() => {
      if (this.state.gameMode === 'play' && this.state.gamePhase === 'fail') this.startNextChallenge();
    }, 1500);
  }

  // ── Scoring ───────────────────────────────────────────────────

  private _addScore(): number {
    const cfg = GAME_CONFIG.scoring;
    let pts = cfg.basePoints;

    // Time bonus
    if (this.state.challengeTimerSecs > 0) {
      const frac = Math.max(0, 1 - (performance.now() - this._playPhaseStart) / (this.state.challengeTimerSecs * 1000));
      pts += Math.round(cfg.timeBonusMax * frac);
    }

    // Streak progression
    this._streakHits++;
    if (this._streakHits >= 4) {
      this._streakHits = 0;
      this._streakLevels++;
      this._emit('streak-level', { level: this._streakLevels });
      if (this._streakLevels >= 5) {
        this._streakLevels = 0;
        this.state.set('streakCount', 0);
        this._doLevelUp(true);
      } else {
        this.state.set('streakCount', this._streakLevels);
      }
    }

    pts += this._streakLevels * cfg.streakBonusPerHit;
    if (this.state.gameMode === 'ear') pts = Math.round(pts * 1.5);

    this.state.set('score', this.state.score + pts);
    this._emit('score-changed', { score: this.state.score, delta: pts });
    return pts;
  }

  private _checkBonusNote(midi: number): void {
    const pc  = midi % 12;
    const cfg = GAME_CONFIG.scoring;
    let gained = 0;
    if (!this._bonusExtGiven && this._bonusExtPCs.has(pc)) {
      this._bonusExtGiven = true;
      gained += cfg.extensionBonus;
    }
    if (!this._bonusPentGiven && this._bonusPentPCs.has(pc)) {
      this._bonusPentGiven = true;
      gained += cfg.pentatonicBonus;
    }
    if (gained > 0) {
      this.state.set('score', this.state.score + gained);
      this._emit('score-changed', { score: this.state.score, delta: gained });
    }
  }

  private _doLevelUp(streakTriggered = false): void {
    const levels = GAME_CONFIG.levels;
    if (this.state.levelIdx >= levels.length - 1) return;
    this.state.set('levelIdx', this.state.levelIdx + 1);
    const lv = levels[this.state.levelIdx];
    if (lv.paramUnlock && this.registry.countModules(lv.paramUnlock) === 0) {
      this.registry.addModule(lv.paramUnlock);
    }
    this._emit('level-up', { levelIdx: this.state.levelIdx, label: lv.label, streakTriggered });
    if (streakTriggered) {
      setTimeout(() => {
        if (this.state.gameMode === 'play') {
          this.stopGame();
          this._emit('auto-stopped', { reason: 'level-up' });
        }
      }, 2500);
    }
  }

  // ── Events ────────────────────────────────────────────────────

  on(event: string,  handler: GameEventHandler): void {
    if (!this._listeners.has(event)) this._listeners.set(event, new Set());
    this._listeners.get(event)!.add(handler);
  }
  off(event: string, handler: GameEventHandler): void { this._listeners.get(event)?.delete(handler); }

  private _emit(event: string, data: unknown): void {
    this._listeners.get(event)?.forEach(h => h(data));
  }
}
