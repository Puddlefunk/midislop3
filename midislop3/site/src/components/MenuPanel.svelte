<script lang="ts">
  import type { GameState } from '../game/GameState';
  import type { GameEngine } from '../game/GameEngine';

  let {
    open = $bindable(false),
    gameState,
    gameEngine,
    panelsVisible,
    onPanelToggle,
  }: {
    open: boolean;
    gameState: GameState;
    gameEngine: GameEngine;
    panelsVisible: boolean;
    onPanelToggle: () => void;
  } = $props();

  let activeTab = $state<'game' | 'options'>('game');

  // Keyboard state
  let kbMode   = $state<'piano' | 'hex' | 'off'>('off');
  let kbOctave = $state(4);

  // Local mirrors of mutable game options
  let audibleChallenges = $state(gameState.audibleChallenges);
  let fxKeyGuides       = $state(gameState.fx['keyGuides']    ?? true);
  let fxJackLighting    = $state(gameState.fx['jackLighting'] ?? true);
  let folScale          = $state(gameState.folScale);

  // UI scale
  const UI_SCALE_KEY = 'uiScale';
  let uiScale = $state(parseFloat(localStorage.getItem(UI_SCALE_KEY) ?? '1'));
  $effect(() => {
    document.documentElement.style.setProperty('--ui-scale', String(uiScale));
  });

  function onUiScaleInput(e: Event) {
    uiScale = parseFloat((e.target as HTMLInputElement).value);
    localStorage.setItem(UI_SCALE_KEY, String(uiScale));
  }

  // Confirm dialog
  let confirmOpen = $state(false);

  function close() { open = false; }

  // ── Keyboard toggles ─────────────────────────────────────────

  function togglePiano() {
    if (kbMode === 'piano') {
      window.dispatchEvent(new CustomEvent('toggle-keyboard'));
      kbMode = 'off';
    } else {
      window.dispatchEvent(new CustomEvent('keyboard-mode', { detail: 'piano' }));
      if (kbMode === 'off') window.dispatchEvent(new CustomEvent('toggle-keyboard'));
      kbMode = 'piano';
    }
  }

  function toggleHex() {
    if (kbMode === 'hex') {
      window.dispatchEvent(new CustomEvent('toggle-keyboard'));
      kbMode = 'off';
    } else {
      window.dispatchEvent(new CustomEvent('keyboard-mode', { detail: 'hex' }));
      if (kbMode === 'off') window.dispatchEvent(new CustomEvent('toggle-keyboard'));
      kbMode = 'hex';
    }
  }

  function shiftOctave(dir: number) {
    kbOctave = Math.max(0, Math.min(8, kbOctave + dir));
    window.dispatchEvent(new CustomEvent('keyboard-octave', { detail: kbOctave }));
  }

  // ── Options ──────────────────────────────────────────────────

  function toggleAudible() {
    audibleChallenges = !audibleChallenges;
    gameState.audibleChallenges = audibleChallenges;
    save();
  }

  function toggleKeyGuides() {
    fxKeyGuides = !fxKeyGuides;
    gameState.fx = { ...gameState.fx, keyGuides: fxKeyGuides };
    save();
  }

  function toggleJackLighting() {
    fxJackLighting = !fxJackLighting;
    gameState.set('fx', { ...gameState.fx, jackLighting: fxJackLighting });
    save();
  }

  function onScaleInput(e: Event) {
    folScale = parseFloat((e.target as HTMLInputElement).value);
    gameState.folScale = folScale;
    save();
  }

  function save() { (window as unknown as Record<string, unknown>)['saveState']?.(); }

  // ── New game ─────────────────────────────────────────────────

  function newGame()       { confirmOpen = true; }
  function confirmNewGame(){ localStorage.clear(); location.reload(); }
  function cancelNewGame() { confirmOpen = false; }

  // ── Close on outside click ───────────────────────────────────

  function handleDocClick(e: MouseEvent) {
    if (!open) return;
    const t = e.target as Element;
    if (t.closest('#menu-panel') || t.closest('#menu-btn')) return;
    close();
  }
</script>

<svelte:window onclick={handleDocClick} />

{#if open}
<div id="menu-panel">
  <div class="mp-header">
    <span class="mp-title">MENU</span>
    <button class="mp-close" onclick={close}>✕</button>
  </div>

  <div class="mp-tabs">
    <button class="mp-tab" class:active={activeTab === 'game'}    onclick={() => activeTab = 'game'}>GAME</button>
    <button class="mp-tab" class:active={activeTab === 'options'} onclick={() => activeTab = 'options'}>OPTIONS</button>
  </div>

  <!-- GAME TAB -->
  {#if activeTab === 'game'}
  <div class="mp-pane">
    <div class="mp-section">
      <div class="mp-section-label">SOLO</div>
      <button class="mp-opt active">
        <span class="mp-opt-name">PLAY</span>
        <span class="mp-opt-desc">chord challenges</span>
      </button>
      <button class="mp-opt" class:mp-opt-locked={gameState.levelIdx < 9}>
        <span class="mp-opt-name">EAR</span>
        <span class="mp-opt-desc">listen and identify</span>
        {#if gameState.levelIdx < 9}<span class="mp-opt-tag">unlocks lv 10</span>{/if}
      </button>
    </div>

    <div class="mp-section">
      <div class="mp-section-label">MULTIPLAYER</div>
      <button class="mp-opt mp-opt-soon">
        <span class="mp-opt-name">CO-OP</span>
        <span class="mp-opt-desc">shared synth, shared challenges</span>
        <span class="mp-opt-tag">coming soon</span>
      </button>
      <button class="mp-opt mp-opt-soon">
        <span class="mp-opt-name">VERSUS</span>
        <span class="mp-opt-desc">first to solve — head to head</span>
        <span class="mp-opt-tag">coming soon</span>
      </button>
    </div>

    <div class="mp-section mp-section-last">
      <button class="mp-new-game-btn" onclick={newGame}>NEW GAME</button>
    </div>
  </div>

  <!-- OPTIONS TAB -->
  {:else}
  <div class="mp-pane">
    <div class="mp-section">
      <div class="mp-section-label">KEYBOARD</div>
      <div class="mp-toggle-row">
        <span class="mp-toggle-label">PIANO</span>
        <button class="mp-toggle" class:on={kbMode === 'piano'} onclick={togglePiano} aria-label="Toggle piano keyboard"></button>
      </div>
      <div class="mp-toggle-row">
        <span class="mp-toggle-label">HEX GRID</span>
        <button class="mp-toggle" class:on={kbMode === 'hex'} onclick={toggleHex} aria-label="Toggle hex keyboard"></button>
      </div>
      {#if kbMode !== 'off'}
      <div class="mp-toggle-row">
        <span class="mp-toggle-label">OCTAVE</span>
        <div class="mp-oct-ctrl">
          <button class="mp-oct-btn" onclick={() => shiftOctave(-1)}>−</button>
          <span class="mp-oct-val">C{kbOctave}</span>
          <button class="mp-oct-btn" onclick={() => shiftOctave(1)}>+</button>
        </div>
      </div>
      {/if}
    </div>

    <div class="mp-section">
      <div class="mp-section-label">DISPLAY</div>
      <div class="mp-toggle-row">
        <span class="mp-toggle-label">MODULES</span>
        <button class="mp-toggle" class:on={panelsVisible} onclick={onPanelToggle} aria-label="Toggle module panels"></button>
      </div>
      <div class="mp-toggle-row">
        <span class="mp-toggle-label">AUDIBLE CHALLENGES</span>
        <button class="mp-toggle" class:on={audibleChallenges} onclick={toggleAudible} aria-label="Toggle audible challenges"></button>
      </div>
    </div>

    <div class="mp-section">
      <div class="mp-section-label">EFFECTS</div>
      <div class="mp-toggle-row">
        <span class="mp-toggle-label">KEY GUIDE</span>
        <button class="mp-toggle" class:on={fxKeyGuides} onclick={toggleKeyGuides} aria-label="Toggle key guide"></button>
      </div>
      <div class="mp-toggle-row">
        <span class="mp-toggle-label">JACK LIGHTING</span>
        <button class="mp-toggle" class:on={fxJackLighting} onclick={toggleJackLighting} aria-label="Toggle jack lighting"></button>
      </div>
    </div>

    <div class="mp-section">
      <div class="mp-section-label">NODE SCALE</div>
      <div class="mp-scale-row">
        <input type="range" min="0.3" max="2" step="0.05" value={folScale} oninput={onScaleInput} />
        <span class="mp-scale-val">{folScale.toFixed(2)}</span>
      </div>
    </div>

    <div class="mp-section mp-section-last">
      <div class="mp-section-label">UI SCALE</div>
      <div class="mp-scale-row">
        <input type="range" min="0.7" max="1.5" step="0.05" value={uiScale} oninput={onUiScaleInput} />
        <span class="mp-scale-val">{Math.round(uiScale * 100)}%</span>
      </div>
    </div>
  </div>
  {/if}
</div>
{/if}

<!-- Confirm dialog -->
{#if confirmOpen}
<div id="confirm-overlay" role="dialog" aria-modal="true">
  <div id="confirm-box">
    <div id="confirm-msg">start a new game?</div>
    <div id="confirm-sub">score and progress will be reset</div>
    <div id="confirm-btns">
      <button class="confirm-yes" onclick={confirmNewGame}>START</button>
      <button class="confirm-no"  onclick={cancelNewGame}>CANCEL</button>
    </div>
  </div>
</div>
{/if}

<style>
  /* ── Panel container ─────────────────────────────────────────── */
  #menu-panel {
    position: fixed;
    bottom: 4.5em; left: 50%; transform: translateX(-50%);
    width: min(24em, 92vw);
    z-index: 200;
    border: 1px solid rgba(255,255,255,.18);
    border-radius: 0.7em;
    background:
      linear-gradient(180deg, rgba(255,255,255,.07) 0%, rgba(255,255,255,.02) 30%, rgba(0,0,0,0) 60%),
      rgba(12,12,16,.92);
    backdrop-filter: blur(22px) brightness(.72);
    box-shadow: 0 6px 36px rgba(0,0,0,.55), inset 0 1px 0 rgba(255,255,255,.09);
    font-family: 'Courier New', monospace;
    font-size: var(--fs-ui);
  }

  /* ── Header ──────────────────────────────────────────────────── */
  .mp-header {
    display: flex; align-items: center; padding: 1.2em 1.1em 1em;
    border-bottom: 1px solid rgba(255,255,255,.07);
  }
  .mp-title {
    flex: 1; font-size: 0.8em; letter-spacing: 0.35em;
    color: rgba(255,255,255,.32); text-transform: uppercase;
  }
  .mp-close {
    background: none; border: none; padding: 0 0 0 0.5em;
    color: rgba(255,255,255,.28); cursor: pointer; font-size: 1.1em; line-height: 1;
  }
  .mp-close:hover { color: rgba(255,255,255,.7); }

  /* ── Tabs ────────────────────────────────────────────────────── */
  .mp-tabs { display: flex; border-bottom: 1px solid rgba(255,255,255,.07); }
  .mp-tab {
    flex: 1; background: none; border: none;
    border-bottom: 2px solid transparent;
    color: rgba(255,255,255,.28);
    font-family: 'Courier New', monospace; font-size: 0.8em; letter-spacing: 0.27em;
    padding: 0.8em 0 0.65em; cursor: pointer;
    transition: color .15s, border-color .15s;
  }
  .mp-tab:hover { color: rgba(255,255,255,.55); }
  .mp-tab.active { color: rgba(255,255,255,.75); border-bottom-color: rgba(255,255,255,.3); }

  /* ── Sections ────────────────────────────────────────────────── */
  .mp-section {
    padding: 0.9em 1.1em 0.55em;
    border-bottom: 1px solid rgba(255,255,255,.05);
  }
  .mp-section-last { border-bottom: none; padding-bottom: 1.1em; }
  .mp-section-label {
    font-size: 0.75em; letter-spacing: 0.27em;
    color: rgba(255,255,255,.22); text-transform: uppercase; margin-bottom: 0.55em;
  }

  /* ── Mode option buttons ─────────────────────────────────────── */
  .mp-opt {
    width: 100%; display: flex; align-items: center;
    background: none; border: 1px solid transparent; border-radius: 0.35em;
    padding: 0.65em 0.7em; margin-bottom: 0.25em; cursor: pointer; text-align: left;
    transition: background .12s, border-color .12s;
  }
  .mp-opt:last-child { margin-bottom: 0; }
  .mp-opt:hover:not(.mp-opt-locked):not(.mp-opt-soon) {
    background: rgba(255,255,255,.06); border-color: rgba(255,255,255,.1);
  }
  .mp-opt.active      { background: rgba(255,255,255,.08); border-color: rgba(255,255,255,.2); }
  .mp-opt-name        { font-size: 0.9em; letter-spacing: 0.18em; color: rgba(255,255,255,.7); min-width: 7em; }
  .mp-opt.active .mp-opt-name { color: rgba(255,255,255,.95); }
  .mp-opt-desc        { font-size: 0.85em; color: rgba(255,255,255,.28); flex: 1; }
  .mp-opt-tag         { font-size: 0.8em; color: rgba(255,255,255,.2); letter-spacing: 0.09em; margin-left: 0.55em; }
  .mp-opt-locked      { opacity: .3; pointer-events: none; }
  .mp-opt-soon        { opacity: .35; cursor: default; }

  /* ── Toggle rows ─────────────────────────────────────────────── */
  .mp-toggle-row {
    display: flex; align-items: center; justify-content: space-between;
    margin-bottom: 0.7em;
  }
  .mp-toggle-row:last-child { margin-bottom: 0; }
  .mp-toggle-label { font-size: 0.8em; letter-spacing: 0.18em; color: rgba(255,255,255,.45); }
  .mp-toggle {
    width: 2.5em; height: 1.27em; border-radius: 0.64em;
    border: 1px solid rgba(255,255,255,.2);
    background: rgba(255,255,255,.08); cursor: pointer; position: relative;
    transition: background .18s, border-color .18s; flex-shrink: 0;
  }
  .mp-toggle::after {
    content: ''; position: absolute; top: 0.18em; left: 0.18em;
    width: 0.73em; height: 0.73em; border-radius: 50%;
    background: rgba(255,255,255,.35);
    transition: transform .18s, background .18s;
  }
  .mp-toggle.on { background: rgba(120,255,160,.18); border-color: rgba(120,255,160,.4); }
  .mp-toggle.on::after { transform: translateX(1.27em); background: rgba(120,255,160,.9); }

  /* ── Octave control ──────────────────────────────────────────── */
  .mp-oct-ctrl { display: flex; align-items: center; gap: 0.35em; }
  .mp-oct-btn {
    background: none; border: 1px solid rgba(255,255,255,.15);
    color: rgba(255,255,255,.55); padding: 0.1em 0.6em;
    border-radius: 0.2em; cursor: pointer; font-family: inherit; font-size: 1.1em;
  }
  .mp-oct-btn:hover { background: rgba(255,255,255,.07); }
  .mp-oct-val { font-size: 0.8em; color: rgba(255,255,255,.5); min-width: 2em; text-align: center; }

  /* ── Node scale slider ───────────────────────────────────────── */
  .mp-scale-row { display: flex; align-items: center; gap: 0.7em; }
  .mp-scale-row input[type=range] { flex: 1; accent-color: rgba(120,255,160,.8); }
  .mp-scale-val { font-size: 0.8em; color: rgba(255,255,255,.45); min-width: 2.5em; text-align: right; }

  /* ── New game button ─────────────────────────────────────────── */
  .mp-new-game-btn {
    width: 100%;
    background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.1);
    color: rgba(255,255,255,.35); font-family: 'Courier New', monospace;
    font-size: 0.9em; padding: 0.65em 0; cursor: pointer; letter-spacing: 0.27em;
    transition: background .15s, color .15s, border-color .15s; border-radius: 0.25em;
  }
  .mp-new-game-btn:hover {
    background: rgba(255,80,80,.1); border-color: rgba(255,80,80,.3); color: rgba(255,160,160,.8);
  }

  /* ── Confirm dialog ──────────────────────────────────────────── */
  #confirm-overlay {
    position: fixed; inset: 0; z-index: 500;
    background: rgba(0,0,0,.65);
    display: flex; align-items: center; justify-content: center;
  }
  #confirm-box {
    background: rgba(12,12,16,.97); border: 1px solid rgba(255,255,255,.18);
    border-radius: 0.7em; padding: 2.5em 2.9em; text-align: center;
    font-family: 'Courier New', monospace; font-size: var(--fs-ui);
    box-shadow: 0 8px 48px rgba(0,0,0,.7); max-width: min(26em, 92vw);
  }
  #confirm-msg {
    font-size: 1.2em; letter-spacing: 0.18em; color: rgba(255,255,255,.85); margin-bottom: 0.7em;
  }
  #confirm-sub {
    font-size: 0.9em; color: rgba(255,255,255,.3); letter-spacing: 0.09em; margin-bottom: 2em;
  }
  #confirm-btns { display: flex; gap: 0.9em; justify-content: center; }
  .confirm-yes, .confirm-no {
    background: rgba(255,255,255,.07); border: 1px solid rgba(255,255,255,.18);
    color: rgba(255,255,255,.6); font-family: 'Courier New', monospace;
    font-size: 0.9em; padding: 0.65em 2em; cursor: pointer; letter-spacing: 0.18em;
    transition: background .15s, color .15s, border-color .15s;
  }
  .confirm-yes:hover {
    background: rgba(255,80,80,.15); border-color: rgba(255,80,80,.4); color: rgba(255,160,160,.9);
  }
  .confirm-no:hover { background: rgba(255,255,255,.12); color: #fff; }
</style>
