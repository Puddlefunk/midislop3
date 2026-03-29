<script lang="ts">
  import { onMount } from 'svelte';
  import type { GameState } from '../game/GameState';

  let { state: gs }: { state: GameState } = $props();

  const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
  const SCALES = [
    { value: 'major',      label: 'MAJ' },
    { value: 'minor',      label: 'MIN' },
    { value: 'dorian',     label: 'DOR' },
    { value: 'mixolydian', label: 'MIX' },
    { value: 'phrygian',   label: 'PHR' },
    { value: 'lydian',     label: 'LYD' },
  ];

  let dragging       = $state(false);
  let dragStartY     = $state(0);
  let dragStartBpm   = $state(120);
  let bpmDisplay     = $state(gs.internalBpm);
  let rootKey        = $state(gs.rootKey);
  let scaleType      = $state(gs.scaleType);
  let transportPlaying  = $state(false);
  let midiLearnActive   = $state(false);
  let midiLearnPending  = $state(false);

  onMount(() => {
    gs.on('internalBpm', (v) => { bpmDisplay = v as number; });
    gs.on('rootKey',     (v) => { rootKey    = v as string; });
    gs.on('scaleType',   (v) => { scaleType  = v as string; });
    window.addEventListener('transport-state', (e: Event) => {
      transportPlaying = (e as CustomEvent<boolean>).detail;
    });
    window.addEventListener('midi-learn-state', (e: Event) => {
      const d = (e as CustomEvent<{ active: boolean; pending: boolean }>).detail;
      midiLearnActive  = d.active;
      midiLearnPending = d.pending;
    });

    // Re-read state that may have been loaded before onMount ran
    bpmDisplay = gs.internalBpm;
    rootKey    = gs.rootKey;
    scaleType  = gs.scaleType;
  });

  function onBpmPointerDown(e: PointerEvent) {
    dragging     = true;
    dragStartY   = e.clientY;
    dragStartBpm = gs.internalBpm;
    (e.target as Element).setPointerCapture(e.pointerId);
  }

  function onBpmPointerMove(e: PointerEvent) {
    if (!dragging) return;
    const newBpm = Math.max(20, Math.min(300, dragStartBpm + Math.round((dragStartY - e.clientY) / 2)));
    bpmDisplay = newBpm;
    gs.set('internalBpm', newBpm);
  }

  function onBpmPointerUp() { dragging = false; }

  function togglePlay() {
    window.dispatchEvent(new CustomEvent('transport-toggle'));
    transportPlaying = !transportPlaying; // optimistic
  }

  function toggleExtClock() {
    gs.useMidiClock = !gs.useMidiClock;
  }

  function toggleMidiLearn() {
    window.dispatchEvent(new CustomEvent('midi-learn-toggle'));
  }

  function cycleRoot(dir: 1 | -1) {
    const i = (NOTE_NAMES.indexOf(rootKey) + dir + NOTE_NAMES.length) % NOTE_NAMES.length;
    gs.set('rootKey', NOTE_NAMES[i]);
  }

  function cycleScale(dir: 1 | -1) {
    const i = (SCALES.findIndex(s => s.value === scaleType) + dir + SCALES.length) % SCALES.length;
    gs.set('scaleType', SCALES[i].value);
  }

  function onRootClick(e: MouseEvent) {
    e.preventDefault();
    cycleRoot(e.button === 2 ? -1 : 1);
  }

  function onScaleClick(e: MouseEvent) {
    e.preventDefault();
    cycleScale(e.button === 2 ? -1 : 1);
  }
</script>

<div id="clock-panel">
  <button id="clock-play-btn" class:playing={transportPlaying} title="Play/Stop transport" onclick={togglePlay}>
    {transportPlaying ? '■' : '▶'}
  </button>

  <div
    id="clock-bpm-wrap"
    title="Drag up/down to change BPM"
    role="slider"
    aria-label="BPM"
    aria-valuenow={bpmDisplay}
    tabindex="0"
    onpointerdown={onBpmPointerDown}
    onpointermove={onBpmPointerMove}
    onpointerup={onBpmPointerUp}
  >
    <span id="clock-bpm-val">{bpmDisplay}</span><span class="clock-bpm-unit"> bpm</span>
  </div>

  <div class="clock-divider"></div>

  <div class="key-selector">
    <button class="key-btn" title="Root key — left-click next, right-click prev"
      onclick={onRootClick} oncontextmenu={onRootClick}
    >{rootKey}</button>
    <button class="key-btn" title="Scale — left-click next, right-click prev"
      onclick={onScaleClick} oncontextmenu={onScaleClick}
    >{SCALES.find(s => s.value === scaleType)?.label ?? 'MAJ'}</button>
  </div>

  <div class="clock-divider"></div>

  <div class="clock-ext-wrap" title="External MIDI Clock">
    <button
      id="opt-midiclock"
      class="clock-ext-btn"
      class:active={gs.useMidiClock}
      onclick={toggleExtClock}
    >EXT</button>
    {#if gs.useMidiClock}
      <span id="bpm-display" class="clock-ext-bpm ext-active"></span>
    {/if}
  </div>

  <div class="clock-divider"></div>

  <button
    id="opt-midilearn"
    class="clock-learn-btn"
    class:active={midiLearnActive}
    class:pending={midiLearnPending}
    title={midiLearnActive ? (midiLearnPending ? 'Waiting for CC — twiddle a knob' : 'Click a synth knob to map') : 'MIDI Learn — map CC knobs to synth params'}
    onclick={toggleMidiLearn}
  >CC</button>

  <div class="clock-divider"></div>

  <span class="mp-dot mp-solo" title="Multiplayer status"></span>
</div>

<style>
  #clock-panel {
    position: fixed;
    top: 0; left: 0;
    display: flex; align-items: center; gap: 0.7em;
    padding: 0.5em 1.2em;
    background: rgba(12,12,18,0.92);
    border-bottom: 1px solid rgba(255,255,255,0.08);
    backdrop-filter: blur(8px);
    z-index: 100;
    font-family: 'Courier New', monospace;
    font-size: var(--fs-ui);
    color: rgba(255,255,255,0.7);
    user-select: none;
  }

  #clock-play-btn {
    background: none; border: 1px solid rgba(255,255,255,0.2);
    color: rgba(255,255,255,0.8); padding: 0.25em 0.7em;
    border-radius: 0.25em; cursor: pointer; font-size: 0.9em;
  }
  #clock-play-btn:hover { background: rgba(255,255,255,0.08); }
  #clock-play-btn.playing { background: rgba(100,220,160,0.15); border-color: rgba(100,220,160,0.45); color: rgba(120,240,180,1); }

  #clock-bpm-wrap {
    cursor: ns-resize; padding: 0.2em 0.5em;
    border-radius: 0.25em;
  }
  #clock-bpm-wrap:hover { background: rgba(255,255,255,0.06); }
  #clock-bpm-val { font-size: 1.2em; font-weight: 600; color: rgba(255,255,255,0.9); }
  .clock-bpm-unit { font-size: 0.8em; color: rgba(255,255,255,0.4); }

  .clock-divider {
    width: 1px; height: 1.4em;
    background: rgba(255,255,255,0.1);
    margin: 0 0.2em;
  }

  .key-selector { display: flex; gap: 0.4em; }
  .key-btn {
    font-family: 'Courier New', monospace;
    font-size: 0.9em;
    background: rgba(255,255,255,0.05);
    color: rgba(255,255,255,0.8);
    border: 1px solid rgba(255,255,255,0.12);
    border-radius: 0.2em;
    padding: 0.2em 0.5em;
    cursor: pointer;
    min-width: 2.5em;
  }
  .key-btn:hover { background: rgba(255,255,255,0.12); }

  .clock-ext-btn {
    background: none;
    border: 1px solid rgba(255,175,40,0.35);
    color: rgba(255,175,40,0.7);
    font-family: 'Courier New', monospace;
    font-size: 0.8em; padding: 0.2em 0.5em; border-radius: 0.2em; cursor: pointer;
  }
  .clock-ext-btn.active {
    background: rgba(255,175,40,0.15);
    color: rgba(255,175,40,1);
    border-color: rgba(255,175,40,0.7);
  }

  .clock-learn-btn {
    background: none;
    border: 1px solid rgba(255,100,220,0.35);
    color: rgba(255,100,220,0.7);
    font-family: 'Courier New', monospace;
    font-size: 0.8em; padding: 0.2em 0.5em; border-radius: 0.2em; cursor: pointer;
  }
  .clock-learn-btn.active {
    background: rgba(255,100,220,0.15);
    color: rgba(255,100,220,1);
    border-color: rgba(255,100,220,0.7);
  }
  .clock-learn-btn.pending {
    background: rgba(255,180,0,0.15);
    color: rgba(255,200,0,1);
    border-color: rgba(255,180,0,0.8);
    animation: learn-pulse 0.6s ease-in-out infinite alternate;
  }
  @keyframes learn-pulse {
    from { box-shadow: 0 0 3px rgba(255,180,0,0.4); }
    to   { box-shadow: 0 0 8px rgba(255,180,0,0.9); }
  }

  .mp-dot {
    width: 0.6em; height: 0.6em; border-radius: 50%;
    background: rgba(255,255,255,0.15);
    display: inline-block;
  }
  .mp-dot.mp-solo { background: rgba(80,200,120,0.7); }

</style>
