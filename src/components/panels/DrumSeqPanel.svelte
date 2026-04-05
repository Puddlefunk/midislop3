<script lang="ts">
  import { onMount } from 'svelte';
  import { getPanelContext } from '../../ui/context';
  import { getModuleDef } from '../../config/modules';
  import type { ParamValue } from '../../types';

  const { registry } = getPanelContext();

  let { modId, type, params }: {
    modId:  string;
    type:   string;
    params: Record<string, ParamValue>;
  } = $props();

  const def = $derived(getModuleDef(type)!);
  const hue = $derived(def.hue);

  const RATES = ['4', '8', 'd8', 't8', '16', '32'] as const;
  const ROWS  = [0, 1, 2, 3] as const;

  let bars      = $state((params['bars']  as number) ?? 1);
  let rate      = $state((params['rate']  as string) ?? '16');
  let collapsed = $state(false);
  let playhead  = $state(-1);

  // Grid: 4 rows × N cols
  interface DrumCell { row: number; col: number; vel: number; }
  let cells = $state<DrumCell[]>([]);

  function buildGrid() {
    const total = 16 * bars;
    const mod   = registry.modules.get(modId);
    const p     = mod?.params ?? params;
    const result: DrumCell[] = [];
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < total; col++) {
        const v = (p[`step-${row}-${col}`] as number) ?? 0;
        result.push({ row, col, vel: v });
      }
    }
    cells = result;
  }

  onMount(() => {
    buildGrid();

    const onParamChange = (e: { id: string; param: string; value: ParamValue }) => {
      if (e.id !== modId) return;
      if (e.param === 'bars') {
        bars = e.value as number;
        buildGrid();
      } else if (e.param === 'rate') {
        rate = e.value as string;
      } else if (e.param.startsWith('step-')) {
        buildGrid();
      }
    };
    registry.on('param-changed', onParamChange);

    const onPlayhead = (e: Event) => {
      const { id, step } = (e as CustomEvent<{ id: string; step: number; row: number }>).detail;
      if (id === modId) playhead = step;
    };
    window.addEventListener('seq-playhead', onPlayhead);

    return () => {
      registry.off('param-changed', onParamChange);
      window.removeEventListener('seq-playhead', onPlayhead);
    };
  });

  // Drag painting state
  let dragActive = false;
  let dragVel    = 1;
  let lastPointerDownMs = 0;
  const stepLastPainted = new Map<number, number>(); // row*1000+col → timestamp

  function onGridPointerDown(e: PointerEvent) {
    const cell = (e.target as HTMLElement).closest<HTMLElement>('.drum-cell');
    if (!cell) return;
    const row = Number(cell.dataset['row']), col = Number(cell.dataset['step']);
    const now      = Date.now();
    const isDouble = now - lastPointerDownMs < 300;
    lastPointerDownMs = now;
    const mod    = registry.modules.get(modId);
    const curVel = (mod?.params[`step-${row}-${col}`] as number) ?? 0;
    const key    = row * 1000 + col;

    if (isDouble) {
      dragActive = true; dragVel = 2;
      registry.setParam(modId, `step-${row}-${col}`, 2);
      stepLastPainted.set(key, now);
    } else if (curVel === 0) {
      dragActive = true; dragVel = 1;
      registry.setParam(modId, `step-${row}-${col}`, 1);
      stepLastPainted.set(key, now);
    } else {
      const stale = now - (stepLastPainted.get(key) ?? 0) > 2000;
      if (stale) {
        dragActive = true; dragVel = 0;
        registry.setParam(modId, `step-${row}-${col}`, 0);
      } else {
        const next = curVel + 1;
        if (next > 3) {
          dragActive = true; dragVel = 0;
          registry.setParam(modId, `step-${row}-${col}`, 0);
        } else {
          dragActive = false;
          registry.setParam(modId, `step-${row}-${col}`, next);
          stepLastPainted.set(key, now);
        }
      }
    }
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault();
  }

  function onGridPointerMove(e: PointerEvent) {
    if (!dragActive) return;
    const el   = document.elementFromPoint(e.clientX, e.clientY);
    const cell = el?.closest<HTMLElement>('.drum-cell');
    if (!cell) return;
    const row    = Number(cell.dataset['row']), col = Number(cell.dataset['step']);
    const mod    = registry.modules.get(modId);
    const curVel = (mod?.params[`step-${row}-${col}`] as number) ?? 0;
    const key    = row * 1000 + col;
    if (dragVel === 0) {
      if (curVel > 0) registry.setParam(modId, `step-${row}-${col}`, 0);
    } else {
      if (curVel === 0) {
        registry.setParam(modId, `step-${row}-${col}`, dragVel);
        stepLastPainted.set(key, Date.now());
      }
    }
  }

  function onGridPointerUp() { dragActive = false; }

  function cycleBars() {
    const newBars = (bars % 4) + 1;
    registry.setParam(modId, 'bars', newBars);
  }

  function totalCols() { return 16 * bars; }
</script>

<div class="seq-toolbar">
  <div class="seq-rate-grid">
    {#each RATES as r}
      <button
        class="seq-rate-btn"
        class:active={rate === r}
        onclick={() => registry.setParam(modId, 'rate', r)}
      >{r}</button>
    {/each}
  </div>
</div>

{#if !collapsed}
  <div class="seq-grid-wrap">
    <div
      class="seq-grid drum-seq-grid"
      style="--drum-cols:{totalCols()}"
      onpointerdown={onGridPointerDown}
      onpointermove={onGridPointerMove}
      onpointerup={onGridPointerUp}
      onpointercancel={onGridPointerUp}
    >
      {#each cells as cell (cell.row * 10000 + cell.col)}
        <div
          class="drum-cell"
          class:playhead={cell.col === playhead}
          class:vel-1={cell.vel === 1}
          class:vel-2={cell.vel === 2}
          class:vel-3={cell.vel === 3}
          data-row={cell.row}
          data-step={cell.col}
        ></div>
      {/each}
    </div>
  </div>
{/if}

<div class="seq-footer">
  <button class="seq-collapse-btn" onclick={() => collapsed = !collapsed}>
    {collapsed ? '▸' : '▾'}
  </button>
  <button class="seq-bars-btn" onclick={cycleBars}>BARS:{bars}</button>
</div>

