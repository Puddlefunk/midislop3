<script lang="ts">
  import { onMount } from 'svelte';
  import type { ModuleRegistry } from '../core/ModuleRegistry';
  import type { GameState }      from '../game/GameState';
  import type { NoteRouter }     from '../input/NoteRouter';
  import type { AudioGraph }     from '../audio/AudioGraph';
  import { SHOP_DEFS, getModuleDef } from '../config/modules';
  import { GAME_CONFIG } from '../config/game';

  const BASE_TABS = [
    { id: 'generators', label: 'GEN'   },
    { id: 'voices',     label: 'VOICE' },
    { id: 'note',       label: 'NOTE'  },
    { id: 'drums',      label: 'DRUM'  },
    { id: 'fx',         label: 'FX'    },
  ] as const;
  type BaseTabId = typeof BASE_TABS[number]['id'];

  let {
    open = $bindable(false),
    gameState,
    score,
    registry,
    router,
    audioGraph,
    onSave,
  }: {
    open:       boolean;
    gameState:  GameState;
    score:      number;
    registry:   ModuleRegistry;
    router:     NoteRouter;
    audioGraph: AudioGraph;
    onSave?:    () => void;
  } = $props();

  let activeTab:       string  = $state('generators');
  let balFlash:        boolean = $state(false);
  let registryVersion: number = $state(0);
  let midiVersion:     number = $state(0);

  // Drag state
  let panelEl:  HTMLElement;
  let dragOx = 0, dragOy = 0;
  let dragging = false;
  let posLeft  = $state<number | null>(null);
  let posTop   = $state<number | null>(null);

  let posStyle = $derived(
    posLeft !== null ? `left:${posLeft}px; right:auto; top:${posTop}px;` : ''
  );

  function prettyTabLabel(tab: string): string {
    return tab
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/[-_]/g, ' ')
      .toUpperCase();
  }

  let tabs = $derived.by(() => {
    void registryVersion;
    const customTabs = [...new Set(
      SHOP_DEFS.map(d => d.tab).filter(tab => !BASE_TABS.some(t => t.id === tab))
    )].sort((a, b) => a.localeCompare(b)).map(tab => ({ id: tab, label: prettyTabLabel(tab) }));
    return [...BASE_TABS, ...customTabs];
  });

  $effect(() => {
    if (!tabs.some(t => t.id === activeTab)) {
      activeTab = tabs[0]?.id ?? 'generators';
    }
  });

  onMount(() => {
    registry.on('module-added',   () => { registryVersion++; });
    registry.on('module-removed', () => { registryVersion++; });
    window.addEventListener('midi-status', () => { midiVersion++; });
    window.addEventListener('module-sell', onSell);
    return () => {
      window.removeEventListener('module-sell', onSell);
    };
  });

  // ── Derived items list ────────────────────────────────────────

  let tabItems = $derived.by(() => {
    void registryVersion;
    return SHOP_DEFS
      .filter(d => d.tab === activeTab)
      .map(d => {
        const modDef = getModuleDef(d.type);
        const price  = d.price ?? GAME_CONFIG.modulePrices[d.type] ?? modDef?.shop?.price ?? 0;
        const qty    = registry.countModules(d.type);
        return {
          def:    d,
          modDef,
          price,
          qty,
          afford: score >= price,
          hue:    modDef?.hue ?? 200,
        };
      });
  });

  let midiRows = $derived.by(() => {
    void midiVersion;
    void registryVersion;
    const allMod = registry.getModulesByType('midi-all')[0] ?? null;
    const devRows = [...router.devices.entries()].map(([devId, dev]) => {
      const mod = [...registry.modules.values()].find(
        m => m.type === 'midi-in' && m.params['deviceId'] === devId
      ) ?? null;
      return { devId, name: dev.name, mod };
    });
    return { allMod, devRows };
  });

  // ── Actions ──────────────────────────────────────────────────

  function buy(type: string) {
    const def = SHOP_DEFS.find(d => d.type === type);
    const price = def?.price ?? GAME_CONFIG.modulePrices[type] ?? getModuleDef(type)?.shop?.price ?? 0;
    if (score < price) return;
    gameState.set('score', gameState.score - price);
    registry.addModule(type);
    audioGraph.ensure();
    onSave?.();
  }

  function onSell(e: Event) {
    const id = (e as CustomEvent<{ id: string }>).detail.id;
    const mod = registry.modules.get(id);
    if (!mod) return;
    const def = getModuleDef(mod.type);
    const price = def?.shop?.price ?? GAME_CONFIG.modulePrices[mod.type] ?? 0;
    if (price === 0) return;
    gameState.set('score', gameState.score + Math.floor(price / 2));
    registry.removeModule(id);
    onSave?.();
    balFlash = true;
    setTimeout(() => { balFlash = false; }, 500);
  }

  function toggleMidiAll() {
    const { allMod } = midiRows;
    if (allMod) { registry.removeModule(allMod.id); }
    else        { registry.addModule('midi-all'); audioGraph.ensure(); }
    onSave?.();
  }

  function toggleMidiDev(devId: string, devName: string, mod: { id: string } | null) {
    if (mod) { registry.removeModule(mod.id); }
    else     { registry.addModule('midi-in', { deviceId: devId, deviceName: devName }); audioGraph.ensure(); }
    onSave?.();
  }

  // ── Drag ─────────────────────────────────────────────────────

  function onHeaderMousedown(e: MouseEvent) {
    if (e.button !== 0) return;
    const r = panelEl.getBoundingClientRect();
    dragOx = e.clientX - r.left;
    dragOy = e.clientY - r.top;
    dragging = true;
    e.preventDefault();
  }

  function onWindowMousemove(e: MouseEvent) {
    if (!dragging) return;
    posLeft = e.clientX - dragOx;
    posTop  = e.clientY - dragOy;
  }

  function onWindowMouseup() {
    dragging = false;
  }
</script>

<svelte:window onmousemove={onWindowMousemove} onmouseup={onWindowMouseup} />

{#if open}
<div id="shop-panel" bind:this={panelEl} style={posStyle}>

  <div class="sp-header" onmousedown={onHeaderMousedown} role="toolbar">
    <span class="sp-title">SHOP</span>
    <span class="sp-balance" class:sell-flash={balFlash}>{score.toLocaleString()} pts</span>
    <button class="sp-close" onclick={() => open = false}>✕</button>
  </div>

  <div class="sp-tabs">
    {#each tabs as tab}
      <button
        class="sp-tab"
        class:active={activeTab === tab.id}
        onclick={() => activeTab = tab.id}
      >{tab.label}</button>
    {/each}
  </div>

  <div class="sp-items">

    {#if activeTab === 'generators'}

      <div class="sp-section-label">SEQUENCERS</div>
      {#each tabItems as item}
        <div class="sp-item" class:affordable={item.afford}>
          <div class="sp-item-name" style="color:hsla({item.hue},68%,68%,0.9)">
            {item.def.name}{#if item.qty > 0}<span class="sp-item-qty">×{item.qty}</span>{/if}
          </div>
          <div class="sp-item-desc">{item.def.desc}</div>
          <div class="sp-item-footer">
            <span class="sp-item-price">{item.price === 0 ? 'FREE' : item.price.toLocaleString() + ' pts'}</span>
            <button
              class="sp-buy-btn"
              disabled={!item.afford}
              onclick={() => buy(item.def.type)}
            >BUY</button>
          </div>
        </div>
      {/each}

      <div class="sp-section-label">MIDI INPUTS</div>

      <!-- midi-all row -->
      {@const allMod = midiRows.allMod}
      <div class="sp-item affordable">
        <div class="sp-item-name" style="color:hsla(42,68%,68%,0.9)">♬ ALL MIDI + QWERTY</div>
        <div class="sp-item-desc">Routes all MIDI and keyboard input</div>
        <div class="sp-item-footer">
          <button
            class="sp-buy-btn"
            class:gen-deployed={!!allMod}
            onclick={toggleMidiAll}
          >{allMod ? 'DEPLOYED' : 'ADD'}</button>
        </div>
      </div>

      <!-- per-device rows -->
      {#if midiRows.devRows.length === 0}
        <div class="sp-gen-empty">No MIDI devices connected</div>
      {:else}
        {#each midiRows.devRows as row}
          <div class="sp-item affordable">
            <div class="sp-item-name" style="color:hsla(42,68%,68%,0.9)">♩ {row.name}</div>
            <div class="sp-item-desc">Per-device MIDI generator</div>
            <div class="sp-item-footer">
              <button
                class="sp-buy-btn"
                class:gen-deployed={!!row.mod}
                onclick={() => toggleMidiDev(row.devId, row.name, row.mod)}
              >{row.mod ? 'DEPLOYED' : 'ADD'}</button>
            </div>
          </div>
        {/each}
      {/if}

    {:else}

      {#each tabItems as item}
        <div class="sp-item" class:affordable={item.afford}>
          <div class="sp-item-name" style="color:hsla({item.hue},68%,68%,0.9)">
            {item.def.name}{#if item.qty > 0}<span class="sp-item-qty">×{item.qty}</span>{/if}
          </div>
          <div class="sp-item-desc">{item.def.desc}</div>
          <div class="sp-item-footer">
            <span class="sp-item-price">{item.price === 0 ? 'FREE' : item.price.toLocaleString() + ' pts'}</span>
            <button
              class="sp-buy-btn"
              disabled={!item.afford}
              onclick={() => buy(item.def.type)}
            >{item.price === 0 && item.qty === 0 ? 'CLAIM' : 'BUY'}</button>
          </div>
        </div>
      {/each}

    {/if}

  </div>
</div>
{/if}

<style>
  /* ── Panel ───────────────────────────────────────────────────── */
  #shop-panel {
    position: fixed;
    top: 56px; right: 12px;
    width: 16em;
    z-index: 300;
    border: 1px solid rgba(255,255,255,.18);
    border-radius: 0.7em;
    background:
      linear-gradient(180deg, rgba(255,255,255,.07) 0%, rgba(255,255,255,.02) 30%, rgba(0,0,0,0) 60%),
      rgba(12,11,18,.96);
    backdrop-filter: blur(22px) brightness(.72);
    box-shadow: 0 8px 32px rgba(0,0,0,.6), inset 0 1px 0 rgba(255,255,255,.09);
    font-family: 'Courier New', monospace;
    font-size: var(--fs-ui);
    color: rgba(255,255,255,.75);
    user-select: none;
    display: flex;
    flex-direction: column;
    max-height: calc(100vh - 80px);
  }

  /* ── Header ──────────────────────────────────────────────────── */
  .sp-header {
    display: flex; align-items: center; gap: 0.6em;
    padding: 0.9em 1em 0.8em;
    border-bottom: 1px solid rgba(255,255,255,.07);
    cursor: grab;
  }
  .sp-header:active { cursor: grabbing; }
  .sp-title {
    flex: 1; font-size: 0.8em; letter-spacing: 0.35em;
    color: rgba(255,255,255,.8); font-weight: 700;
  }
  .sp-balance { font-size: 0.75em; color: rgba(255,255,255,.4); }
  .sp-balance.sell-flash { color: hsl(120,65%,65%) !important; transition: color 0.05s; }
  .sp-close {
    background: none; border: none; padding: 0 0 0 0.4em;
    color: rgba(255,255,255,.28); cursor: pointer; font-size: 1em; line-height: 1;
  }
  .sp-close:hover { color: rgba(255,255,255,.7); }

  /* ── Tabs ────────────────────────────────────────────────────── */
  .sp-tabs {
    display: flex; gap: 0.15em;
    padding: 0.5em 0.6em;
    border-bottom: 1px solid rgba(255,255,255,.06);
    flex-wrap: wrap;
  }
  .sp-tab {
    flex: 1 1 calc(50% - 0.15em);
    background: rgba(255,255,255,.05);
    border: 1px solid rgba(255,255,255,.1);
    color: rgba(255,255,255,.45);
    padding: 0.28em 0.35em; border-radius: 0.25em;
    cursor: pointer; font-family: inherit;
    font-size: 0.68em; font-weight: 600; letter-spacing: 0.05em;
    min-width: 0;
    white-space: normal;
    line-height: 1.1;
  }
  .sp-tab:hover { background: rgba(255,255,255,.09); }
  .sp-tab.active {
    background: rgba(255,255,255,.14);
    color: rgba(255,255,255,.9);
    border-color: rgba(255,255,255,.22);
  }

  /* ── Items list ──────────────────────────────────────────────── */
  .sp-items {
    overflow-y: auto;
    padding: 0.5em 0.6em;
    display: flex; flex-direction: column; gap: 0.3em;
  }
  .sp-items::-webkit-scrollbar { width: 3px; }
  .sp-items::-webkit-scrollbar-track { background: transparent; }
  .sp-items::-webkit-scrollbar-thumb { background: rgba(255,255,255,.15); border-radius: 2px; }

  .sp-section-label {
    font-size: 0.72em; letter-spacing: 0.12em;
    color: rgba(255,255,255,.25);
    padding: 0.5em 0.2em 0.15em; margin-top: 0.15em;
  }
  .sp-gen-empty { font-size: 0.78em; color: rgba(255,255,255,.25); padding: 0.35em 0.2em; }

  /* ── Item card ───────────────────────────────────────────────── */
  .sp-item {
    background: rgba(255,255,255,.03);
    border: 1px solid rgba(255,255,255,.07);
    border-radius: 0.3em; padding: 0.5em 0.65em;
    opacity: 0.55; transition: opacity .1s, border-color .1s;
  }
  .sp-item.affordable { opacity: 1; }
  .sp-item.affordable:hover { border-color: rgba(255,255,255,.16); }

  .sp-item-name {
    font-size: 0.9em; font-weight: 700; letter-spacing: 0.06em;
    margin-bottom: 0.2em;
  }
  .sp-item-qty {
    font-size: 0.8em; color: rgba(255,255,255,.35);
    margin-left: 0.4em; font-weight: 400;
  }
  .sp-item-desc {
    font-size: 0.75em; color: rgba(255,255,255,.35);
    line-height: 1.4; margin-bottom: 0.45em;
  }
  .sp-item-footer {
    display: flex; align-items: center; justify-content: space-between;
  }
  .sp-item-price { font-size: 0.8em; color: rgba(255,255,255,.4); }

  /* ── Buy button ──────────────────────────────────────────────── */
  .sp-buy-btn {
    background: rgba(255,255,255,.08);
    border: 1px solid rgba(255,255,255,.18);
    color: rgba(255,255,255,.8);
    padding: 0.25em 0.85em; border-radius: 0.2em;
    cursor: pointer; font-family: inherit;
    font-size: 0.8em; font-weight: 600; letter-spacing: 0.06em;
  }
  .sp-buy-btn:hover:not(:disabled) { background: rgba(255,255,255,.16); }
  .sp-buy-btn:disabled { opacity: 0.3; cursor: default; }
  .sp-buy-btn.gen-deployed {
    color: rgba(100,255,140,.7);
    border-color: rgba(100,255,140,.3);
    background: rgba(100,255,140,.06);
  }
</style>
