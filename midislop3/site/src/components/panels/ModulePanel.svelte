<script lang="ts">
  import { onMount, tick, type Snippet } from 'svelte';
  import { getPanelContext } from '../../ui/context';
  import { getModuleDef } from '../../config/modules';
  import { findClearSpot } from '../../ui/panelLayout';

  const { patchSystem, registry } = getPanelContext();

  let { modId, type, initialPosition, selected = false, children, jacksL, jacksR }: {
    modId: string;
    type: string;
    initialPosition: { left: number; top: number } | null;
    selected?: boolean;
    children?: Snippet;
    jacksL?: Snippet;
    jacksR?: Snippet;
  } = $props();

  const def = getModuleDef(type);
  const hue = def?.hue ?? 200;

  let panelEl: HTMLDivElement;
  let x = $state(0);
  let y = $state(0);
  let zIndex = $state(5);

  let panelTopZ = 5;

  onMount(async () => {
    if (initialPosition) {
      x = initialPosition.left;
      y = initialPosition.top;
    } else {
      const w = panelEl.offsetWidth  || 148;
      const h = panelEl.offsetHeight || 180;
      const W = window.innerWidth;
      const cat = def?.category;
      const isNoteRouter = type === 'chord' || type === 'note-merge';
      const zone = isNoteRouter                                 ? { min: 0,        max: W * 0.25 }
                 : cat === 'osc'                                ? { min: W * 0.25, max: W * 0.50 }
                 : (cat === 'processor' || cat === 'utility')   ? { min: W * 0.50, max: W * 0.75 }
                 : (cat === 'sequencer' || cat === 'drum')      ? { min: W * 0.20, max: W * 0.80 }
                 : type === 'audio-out'                         ? { min: W * 0.75, max: W }
                 : null;
      const pos = findClearSpot(w, h, zone);
      x = pos.left;
      y = pos.top;
    }
    // Wait for x/y to be applied to DOM before reading jack positions.
    // Jack.svelte onMount fires before this (children mount first), so jacks
    // register at position 0,0. updateJackPositions re-reads after layout.
    await tick();
    patchSystem.updateJackPositions(modId);
    requestAnimationFrame(() => panelEl.classList.add('unlocked'));

    // Beat pulse
    const onBeatPulse = () => {
      if (!panelEl.classList.contains('unlocked')) return;
      panelEl.classList.remove('beat-pulse');
      requestAnimationFrame(() => panelEl.classList.add('beat-pulse'));
    };
    // Chord hit pulse
    const onPanelsPulse = (e: Event) => {
      const h = (e as CustomEvent<number>).detail;
      panelEl.style.setProperty('--ph', String(h));
      panelEl.classList.remove('chord-hit');
      requestAnimationFrame(() => panelEl.classList.add('chord-hit'));
    };
    // Note glow
    const onNoteOn = (e: Event) => {
      const { modId: mid, midi } = (e as CustomEvent<{ modId: string; midi: number }>).detail;
      if (mid !== modId) return;
      const noteH = ((midi % 12) * 30);
      panelEl.style.setProperty('--nh', String(noteH));
      panelEl.querySelectorAll('.port-jack.plugged').forEach(j => j.classList.add('note-active'));
    };
    const onNoteOff = (e: Event) => {
      const { modId: mid } = (e as CustomEvent<{ modId: string }>).detail;
      if (mid !== modId) return;
      panelEl.querySelectorAll('.port-jack.note-active').forEach(j => j.classList.remove('note-active'));
    };

    window.addEventListener('beat-pulse', onBeatPulse);
    window.addEventListener('panels-pulse', onPanelsPulse);
    window.addEventListener('note-module-on', onNoteOn);
    window.addEventListener('note-module-off', onNoteOff);

    // Module click → snap cable
    panelEl.addEventListener('pointerdown', (e) => {
      patchSystem.handleModuleClick(modId, e as PointerEvent);
    });

    return () => {
      window.removeEventListener('beat-pulse', onBeatPulse);
      window.removeEventListener('panels-pulse', onPanelsPulse);
      window.removeEventListener('note-module-on', onNoteOn);
      window.removeEventListener('note-module-off', onNoteOff);
    };
  });

  function onTitleMouseDown(e: MouseEvent) {
    if (e.button !== 0) return;

    if (e.shiftKey) {
      panelEl.dispatchEvent(new CustomEvent('selectiontoggle', { detail: { id: modId }, bubbles: true }));
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    // Bring to front
    panelEl.style.zIndex = String(++panelTopZ);

    const startMouseX = e.clientX;
    const startMouseY = e.clientY;
    const startLeft   = x;
    const startTop    = y;
    panelEl.classList.add('is-dragging');

    function onMove(e: MouseEvent) {
      const dx = e.clientX - startMouseX;
      const dy = e.clientY - startMouseY;
      x = startLeft + dx;
      y = startTop  + dy;
      patchSystem.updateJackPositions(modId);

      // Sell-drop highlight
      const shopEl = document.getElementById('shop-panel');
      if (shopEl) {
        const r = shopEl.getBoundingClientRect();
        const over = e.clientX >= r.left && e.clientX <= r.right
                  && e.clientY >= r.top  && e.clientY <= r.bottom;
        shopEl.classList.toggle('sell-drop-target', over);
      }
    }

    function onUp(e: MouseEvent) {
      panelEl.classList.remove('is-dragging');
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);

      const shopEl = document.getElementById('shop-panel');
      shopEl?.classList.remove('sell-drop-target');

      const shopRect = shopEl?.getBoundingClientRect();
      const onShop = !!shopRect
        && e.clientX >= shopRect.left && e.clientX <= shopRect.right
        && e.clientY >= shopRect.top  && e.clientY <= shopRect.bottom;

      if (onShop) {
        window.dispatchEvent(new CustomEvent('module-sell', { detail: { id: modId } }));
      } else {
        panelEl.dispatchEvent(new CustomEvent('positionchange', {
          detail: { id: modId, left: x, top: y },
          bubbles: true,
        }));
      }
    }

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    e.preventDefault();
    e.stopPropagation();
  }

  function onMouseEnter() {
    panelEl.dispatchEvent(new CustomEvent('chainhover', { detail: { id: modId, active: true }, bubbles: true }));
  }
  function onMouseLeave() {
    panelEl.dispatchEvent(new CustomEvent('chainhover', { detail: { id: modId, active: false }, bubbles: true }));
  }
</script>

<div
  bind:this={panelEl}
  class="panel-box"
  id="panel-{modId}"
  style="--ph:{hue}; left:{x}px; top:{y}px; z-index:{zIndex}"
  class:is-selected={selected}
  onmouseenter={onMouseEnter}
  onmouseleave={onMouseLeave}
>
  <div class="jacks-l">
    {#if jacksL}{@render jacksL()}{/if}
  </div>
  <div class="panel-body">
    <span
      class="panel-title"
      role="presentation"
      onmousedown={onTitleMouseDown}
    >{def?.label ?? type}</span>
    {#if children}{@render children()}{/if}
  </div>
  <div class="jacks-r">
    {#if jacksR}{@render jacksR()}{/if}
  </div>
</div>
