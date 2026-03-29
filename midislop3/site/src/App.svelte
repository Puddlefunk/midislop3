<script lang="ts">
  import { onMount } from 'svelte';
  import ClockPanel from './components/ClockPanel.svelte';
  import MenuPanel  from './components/MenuPanel.svelte';
  import type { GameState }    from './game/GameState';
  import type { GameEngine }   from './game/GameEngine';
  import type { ModuleRegistry } from './core/ModuleRegistry';
  import type { PatchSystem } from './ui/PatchSystem';
  import { setPanelContext } from './ui/context';
  import { GAME_CONFIG } from './config/game';

  let { gameState, registry, gameEngine, patchSystem }: {
    gameState:   GameState;
    registry:    ModuleRegistry;
    gameEngine:  GameEngine;
    patchSystem: PatchSystem | null;
  } = $props();

  // Set panel context synchronously during component init
  // patchSystem is created before mount in main.ts so it is always non-null here
  if (patchSystem) {
    setPanelContext({ registry, patchSystem });
  }

  let midiStatus    = $state('connecting to MIDI...');
  let consoleInput  = $state('');
  let consoleMsg    = $state('');
  let panelsVisible = $state(true);
  let menuOpen      = $state(false);

  // Mirror gameState fields into reactive $state so the HUD updates
  let score        = $state(gameState.score);
  let levelLabel   = $state(gameState.currentLevel.label);
  let streakCount  = $state(gameState.streakCount);
  let shopUnlocked = $state(gameState.shopUnlocked);

  // Challenge display
  let isPlaying      = $state(false);
  let challengeName  = $state('');
  let challengeHue   = $state(270);
  let promptText     = $state('');
  let timerFrac      = $state(1);
  let showTimer      = $state(false);
  let challengeAlpha = $state(1);

  onMount(() => {
    window.addEventListener('midi-status', (e: Event) => {
      midiStatus = (e as CustomEvent<string>).detail;
    });

    // Sync score after shop purchases
    window.addEventListener('shop-purchase', (e: Event) => {
      score        = (e as CustomEvent<{ score: number }>).detail.score;
      shopUnlocked = gameState.shopUnlocked;
    });

    // Keep HUD in sync with game state changes
    gameState.on('score',       (v) => { score        = v as number; });
    gameState.on('levelIdx',    (_) => { levelLabel   = gameState.currentLevel.label; shopUnlocked = gameState.shopUnlocked; });
    gameState.on('streakCount', (v) => { streakCount  = v as number; });

    // Game engine events
    gameEngine.on('game-started',      (d) => {
      const { rootKey, scaleType, h } = d as { rootKey: string; scaleType: string; h: number };
      isPlaying      = true;
      challengeName  = `${rootKey} ${scaleType}`.toUpperCase();
      challengeHue   = h;
      promptText     = 'key set — good luck';
      showTimer      = false;
    });
    gameEngine.on('game-stopped',      () => {
      isPlaying     = false;
      challengeName = '';
      promptText    = '';
      showTimer     = false;
    });
    gameEngine.on('auto-stopped',      (d) => {
      const { reason } = d as { reason: string };
      isPlaying   = false;
      challengeName = '';
      promptText    = '';
      showTimer     = false;
      if (reason === 'level-up') consoleMsg = '▲ level up — visit the shop';
      if (reason === 'idle')     consoleMsg = 'auto-paused — away?';
      setTimeout(() => { consoleMsg = ''; }, 8000);
    });
    gameEngine.on('challenge-start',   (d) => {
      const { display, h } = d as { display: string; h: number };
      challengeName  = display;
      challengeHue   = h;
      promptText     = 'watch the ring';
      showTimer      = false;
      timerFrac      = 1;
      challengeAlpha = 0;
    });
    gameEngine.on('hint-alpha',        (d) => {
      challengeAlpha = (d as { alpha: number }).alpha;
    });
    gameEngine.on('phase-play',        (d) => {
      const { timerSecs } = d as { timerSecs: number };
      promptText     = '';
      showTimer      = timerSecs > 0;
      challengeAlpha = 1;
    });
    gameEngine.on('timer-frac',        (d) => {
      timerFrac = (d as { frac: number }).frac;
    });
    gameEngine.on('challenge-success', (d) => {
      const { display, h } = d as { display: string; h: number };
      promptText     = '✓';
      challengeHue   = h;
      challengeName  = display;
      showTimer      = false;
      challengeAlpha = 1;
    });
    gameEngine.on('challenge-fail',    (d) => {
      const { reason, display } = d as { reason: string; display: string };
      promptText     = reason === 'timeout' ? '✗ time' : '✗';
      challengeName  = display;
      showTimer      = false;
      challengeAlpha = 1;
    });
    gameEngine.on('level-up',          (d) => {
      const { label } = d as { label: string };
      levelLabel   = label;
      shopUnlocked = gameState.shopUnlocked;
      // Flash level label (brief override, then revert to ongoing state)
      consoleMsg = `▲ ${label}`;
      setTimeout(() => { consoleMsg = ''; }, 3000);
    });

    // Re-read state that may have been loaded before onMount ran
    score        = gameState.score;
    levelLabel   = gameState.currentLevel.label;
    shopUnlocked = gameState.shopUnlocked;
    streakCount  = gameState.streakCount;
  });

  function togglePlay() {
    if (gameState.gameMode === 'play') {
      gameEngine.stopGame();
    } else {
      gameEngine.startGame(gameState.rootKey, gameState.scaleType);
    }
  }

  function togglePanels() {
    panelsVisible = !panelsVisible;
    const container = document.getElementById('panels-container');
    const pc = document.getElementById('pc');
    if (container) container.style.display = panelsVisible ? '' : 'none';
    if (pc) pc.style.display = panelsVisible ? '' : 'none';
  }

  function _save() { (window as any).saveState?.(); }

  function runConsoleCommand(raw: string) {
    // Strip leading '-' prefix (midigame compat) and split args
    const trimmed = raw.trim().replace(/^-/, '');
    const parts   = trimmed.toLowerCase().split(/\s+/);
    const cmd     = parts[0];
    if (!cmd) return;

    switch (cmd) {
      case 'idkfa':
        gameState.score += 5000;
        score = gameState.score;
        consoleMsg = '+5000 pts';
        _save();
        break;
      case '000':
        gameState.score += 99999;
        gameState.levelIdx = GAME_CONFIG.levels.length - 1;
        score        = gameState.score;
        levelLabel   = gameState.currentLevel.label;
        shopUnlocked = gameState.shopUnlocked;
        consoleMsg   = '👑 admin — max pts + shop';
        _save();
        break;
      case 'iddqd':
        gameState.levelIdx = GAME_CONFIG.levels.length - 1;
        levelLabel   = gameState.currentLevel.label;
        shopUnlocked = gameState.shopUnlocked;
        consoleMsg   = 'GOD MODE — max level, shop unlocked';
        _save();
        break;
      case 'idclip':
        gameState.levelIdx = Math.min(gameState.levelIdx + 1, GAME_CONFIG.levels.length - 1);
        levelLabel   = gameState.currentLevel.label;
        shopUnlocked = gameState.shopUnlocked;
        consoleMsg   = `level → ${gameState.currentLevel.label}`;
        _save();
        break;
      case 'level': {
        const n = parseInt(parts[1]);
        if (isNaN(n) || n < 1 || n > GAME_CONFIG.levels.length) {
          consoleMsg = `usage: level 1–${GAME_CONFIG.levels.length}`; break;
        }
        gameState.levelIdx = n - 1;
        levelLabel   = gameState.currentLevel.label;
        shopUnlocked = gameState.shopUnlocked;
        consoleMsg   = gameState.currentLevel.label;
        _save();
        break;
      }
      case 'resetall':
        localStorage.clear();
        location.reload();
        return;
      case 'resetlevel':
        gameState.levelIdx = 0;
        levelLabel   = gameState.currentLevel.label;
        shopUnlocked = gameState.shopUnlocked;
        consoleMsg   = 'level reset';
        _save();
        break;
      case 'resetscore':
        gameState.score = 0;
        gameState.streakCount = 0;
        score       = 0;
        streakCount = 0;
        consoleMsg  = 'score reset';
        _save();
        break;
      case 'resetmods': {
        const toRemove = [...(window as any).registry?.modules?.keys() ?? []].filter((id: string) => id !== 'audio-out-0');
        toRemove.forEach((id: string) => (window as any).registry?.removeModule(id));
        consoleMsg = 'modules reset';
        break;
      }
      case 'resetcables': {
        const reg = (window as any).registry;
        const count: number = reg?.patches?.length ?? 0;
        reg?.clearAllPatches();
        consoleMsg = count > 0 ? `cleared ${count} cable${count !== 1 ? 's' : ''}` : 'no cables to clear';
        _save();
        break;
      }
      case 'cheats':
        consoleMsg = 'idkfa +5k | 000 admin | iddqd god | idclip +lvl | level N';
        break;
      case 'help':
        consoleMsg = 'cheats | resetall | resetlevel | resetscore | resetmods | resetcables | level N';
        break;
      default:
        consoleMsg = `unknown: ${cmd}`;
    }
    setTimeout(() => { consoleMsg = ''; }, 3000);
  }

  function onConsoleKey(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      runConsoleCommand(consoleInput);
      consoleInput = '';
    } else if (e.key === 'Escape') {
      consoleInput = '';
    }
  }
</script>

<div id="ui-root">
  <!-- Visual canvases are mounted by VisualEngine; PatchSystem mounts patch canvas -->
  <canvas id="c"></canvas>
  <canvas id="pc"></canvas>

  <!-- Status bar -->
  <div id="status">{midiStatus}</div>

  <!-- Module panels (spawned dynamically by UIRenderer into this container) -->
  <div id="panels-container"></div>

  <!-- Transport bar -->
  <ClockPanel state={gameState} />

  <!-- Menu panel + confirm dialog -->
  <MenuPanel
    bind:open={menuOpen}
    {gameState}
    {gameEngine}
    {panelsVisible}
    onPanelToggle={togglePanels}
  />

  <!-- HUD -->
  <div id="hud">
    <div id="score-val">{score}</div>
    <div id="level-val">{levelLabel}</div>
    <div id="streak-val">{streakCount > 1 ? `×${streakCount}` : ''}</div>
  </div>

  <!-- Challenge display -->
  {#if isPlaying || challengeName}
  <div id="challenge" style="opacity:{challengeAlpha}">
    <div class="prompt">{promptText}</div>
    <div class="chord-name" style="color: hsl({challengeHue},85%,72%); text-shadow: 0 0 28px hsl({challengeHue},85%,62%)">{challengeName}</div>
    {#if showTimer}
    <div id="timer-bar"><div id="timer-fill" style="width:{timerFrac*100}%; background: hsl({Math.round(timerFrac*120)},75%,55%)"></div></div>
    {/if}
  </div>
  {/if}

  <!-- Game controls -->
  <div id="game-controls">
    <button id="mode-btn" class:active={isPlaying} onclick={togglePlay}>{isPlaying ? 'PAUSE' : 'PLAY'}</button>
    <button id="synth-btn" class:active={panelsVisible} onclick={togglePanels}>SYNTH</button>
    <button id="menu-btn" class:active={menuOpen} onclick={() => menuOpen = !menuOpen}>MENU</button>
    <button id="shop-btn" class:locked={!shopUnlocked} title="Unlocks at Level 2"
      onclick={() => { if (shopUnlocked) window.dispatchEvent(new CustomEvent('toggle-shop')); }}>SHOP</button>
  </div>

  <!-- Dev console -->
  <div id="dev-console">
    {#if consoleMsg}<span id="console-msg">{consoleMsg}</span>{/if}
    <input
      id="console-input"
      type="text"
      placeholder="console"
      bind:value={consoleInput}
      onkeydown={onConsoleKey}
      autocomplete="off"
      spellcheck="false"
    />
  </div>
</div>

<style>
  :global(*, *::before, *::after) { box-sizing: border-box; margin: 0; padding: 0; }
  :global(body) {
    background: #080810;
    color: rgba(255,255,255,0.85);
    font-family: 'Courier New', monospace;
    overflow: hidden;
    width: 100vw; height: 100vh;
  }

  #ui-root { position: relative; width: 100vw; height: 100vh; }

  :global(#c), :global(#pc) {
    position: absolute;
    top: 0; left: 0;
    width: 100%; height: 100%;
  }
  :global(#pc) {
    pointer-events: none;
    z-index: 10;
  }

  #status {
    position: fixed; top: 42px; left: 50%; transform: translateX(-50%);
    font-size: 10px; color: rgba(255,255,255,0.3);
    z-index: 200; pointer-events: none;
  }

  #panels-container {
    position: fixed; top: 0; left: 0;
    width: 100%; height: 100%;
    pointer-events: none;
    z-index: 20;
  }
  :global(#panels-container > *) { pointer-events: all; }

  #hud {
    position: fixed; top: 44px; right: 18px;
    text-align: right; z-index: 50;
    pointer-events: none;
  }
  #score-val { font-size: 22px; font-weight: 700; color: rgba(255,255,255,0.9); }
  #level-val  { font-size: 10px; color: rgba(255,255,255,0.4); margin-top: 2px; }
  #streak-val { font-size: 12px; color: rgba(255,185,55,0.8); margin-top: 2px; }

  #challenge {
    position: fixed; top: 44px; left: 50%; transform: translateX(-50%);
    text-align: center; z-index: 50; pointer-events: none;
    display: flex; flex-direction: column; align-items: center; gap: 4px;
  }
  .prompt    { font-size: 9px; color: rgba(255,255,255,0.3); letter-spacing: 2px; min-height: 14px; }
  .chord-name { font-size: 20px; font-weight: 700; min-height: 28px; transition: color 0.3s; }
  #timer-bar {
    width: 120px; height: 3px;
    background: rgba(255,255,255,0.1);
    border-radius: 2px; overflow: hidden;
  }
  #timer-fill { height: 100%; transition: width 0.1s linear; }

  #game-controls {
    position: fixed; bottom: 12px; left: 50%; transform: translateX(-50%);
    display: flex; gap: 8px; z-index: 100;
  }
  #game-controls button {
    font-family: 'Courier New', monospace;
    font-size: 10px; font-weight: 600;
    padding: 5px 12px;
    background: rgba(255,255,255,0.06);
    border: 1px solid rgba(255,255,255,0.15);
    color: rgba(255,255,255,0.75);
    border-radius: 3px; cursor: pointer;
    letter-spacing: 1px;
  }
  #game-controls button:hover { background: rgba(255,255,255,0.12); }
  #game-controls button.active { background: rgba(100,200,255,0.12); border-color: rgba(100,200,255,0.3); color: rgba(140,220,255,0.9); }
  :global(#shop-btn.locked) { opacity: 0.35; cursor: default; }

  #dev-console {
    position: fixed; bottom: 10px; left: 12px;
    display: flex; align-items: center; gap: 8px;
    z-index: 100;
  }
  #console-input {
    font-family: 'Courier New', monospace;
    font-size: 9px;
    background: rgba(255,255,255,0.04);
    border: 1px solid rgba(255,255,255,0.10);
    color: rgba(255,255,255,0.5);
    padding: 3px 8px;
    border-radius: 2px;
    width: 100px;
    outline: none;
  }
  #console-input:focus {
    border-color: rgba(255,255,255,0.22);
    color: rgba(255,255,255,0.8);
    background: rgba(255,255,255,0.07);
  }
  #console-input::placeholder { color: rgba(255,255,255,0.18); }
  #console-msg {
    font-size: 9px; color: rgba(100,255,140,0.75);
    letter-spacing: 0.05em;
  }
</style>
