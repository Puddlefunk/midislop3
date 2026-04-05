<script lang="ts">
  import { onMount } from 'svelte';
  import { getPanelContext } from '../../ui/context';
  import { getModuleDef } from '../../config/modules';
  import { noteHue, NOTE_NAMES, SCALE_INTERVALS } from '../../config/helpers';
  import Knob from './Knob.svelte';
  import type { ParamValue } from '../../types';
  import type { NoteName } from '../../config/helpers';

  const { registry } = getPanelContext();

  let { modId, type, params }: {
    modId:  string;
    type:   string;
    params: Record<string, ParamValue>;
  } = $props();

  const def = $derived(getModuleDef(type)!);
  const hue = $derived(def.hue);

  const RATES = ['4', '8', 'd8', 't8', '16', '32'] as const;

  let bars      = $state((params['bars']  as number) ?? 1);
  let rate      = $state((params['rate']  as string) ?? '16');
  let fold      = $state(!!(params['fold'] as number));
  let collapsed = $state(false);
  let playhead  = $state(-1);

  let rootKey   = $state('C');
  let scaleType = $state('major');

  // Grid cells: array of { row, col, vel, hue, isTonic }
  interface Cell { row: number; col: number; vel: number; cellHue: number; isTonic: boolean; }
  let cells = $state<Cell[]>([]);

  function buildGrid() {
    const total   = 16 * bars;
    const rootPC  = NOTE_NAMES.indexOf(rootKey as NoteName);
    const scaleSet = new Set<number>(SCALE_INTERVALS[scaleType] ?? SCALE_INTERVALS['major']);
    const mod = registry.modules.get(modId);
    const p   = mod?.params ?? params;
    const result: Cell[] = [];
    for (let row = 24; row >= 0; row--) {
      const semitoneFromRoot = ((row - 12) % 12 + 12) % 12;
      if (fold && !scaleSet.has(semitoneFromRoot)) continue;
      const pc      = ((rootPC + row - 12) % 12 + 12) % 12;
      const ch      = noteHue(pc);
      const isTonic = row === 0 || row === 12 || row === 24;
      for (let col = 0; col < total; col++) {
        const activeRow = (p[`step-${col}-note`] as number) ?? 12;
        const vel       = (p[`step-${col}-vel`]  as number) ?? 0;
        result.push({
          row, col,
          vel: activeRow === row && vel > 0 ? vel : 0,
          cellHue: ch,
          isTonic,
        });
      }
    }
    cells = result;
  }

  onMount(() => {
    buildGrid();

    // Subscribe to param changes for step updates
    const onParamChange = (e: { id: string; param: string; value: ParamValue }) => {
      if (e.id !== modId) return;
      const mod = registry.modules.get(modId);
      if (!mod) return;
      if (e.param === 'bars') {
        bars = e.value as number;
        buildGrid();
      } else if (e.param === 'rate') {
        rate = e.value as string;
      } else if (e.param === 'fold') {
        fold = !!(e.value as number);
        buildGrid();
      } else if (e.param.startsWith('step-')) {
        buildGrid();
      }
    };
    registry.on('param-changed', onParamChange);

    // Root key / scale changes
    const onRootKey = (e: Event) => {
      rootKey = (e as CustomEvent<string>).detail;
      buildGrid();
    };
    const onScale = (e: Event) => {
      scaleType = (e as CustomEvent<string>).detail;
      buildGrid();
    };
    // Playhead
    const onPlayhead = (e: Event) => {
      const { id, step } = (e as CustomEvent<{ id: string; step: number; row: number }>).detail;
      if (id === modId) playhead = step;
    };
    window.addEventListener('root-key-change', onRootKey);
    window.addEventListener('scale-type-change', onScale);
    window.addEventListener('seq-playhead', onPlayhead);

    return () => {
      registry.off('param-changed', onParamChange);
      window.removeEventListener('root-key-change', onRootKey);
      window.removeEventListener('scale-type-change', onScale);
      window.removeEventListener('seq-playhead', onPlayhead);
    };
  });

  // Drag painting state (per-grid instance, not reactive)
  let dragRow: number | null = null;
  let dragVel = 1;
  let lastPointerDownMs = 0;
  const stepLastPainted = new Map<number, number>(); // col → timestamp

  function onGridPointerDown(e: PointerEvent) {
    const cell = (e.target as HTMLElement).closest<HTMLElement>('.seq-cell');
    if (!cell) return;
    const col      = Number(cell.dataset['step']), row = Number(cell.dataset['row']);
    const now      = Date.now();
    const isDouble = now - lastPointerDownMs < 300;
    lastPointerDownMs = now;
    const mod = registry.modules.get(modId);
    const curVel  = (mod?.params[`step-${col}-vel`]  as number) ?? 0;
    const curNote = (mod?.params[`step-${col}-note`] as number) ?? 12;

    if (isDouble) {
      dragRow = row; dragVel = 2;
      registry.setParam(modId, `step-${col}-note`, row);
      registry.setParam(modId, `step-${col}-vel`,  2);
      stepLastPainted.set(col, now);
    } else if (curNote !== row || curVel === 0) {
      dragRow = row; dragVel = 1;
      registry.setParam(modId, `step-${col}-note`, row);
      registry.setParam(modId, `step-${col}-vel`,  1);
      stepLastPainted.set(col, now);
    } else {
      const stale = now - (stepLastPainted.get(col) ?? 0) > 2000;
      if (stale) {
        dragRow = row; dragVel = 0;
        registry.setParam(modId, `step-${col}-vel`, 0);
      } else {
        const next = curVel + 1;
        if (next > 3) {
          dragRow = row; dragVel = 0;
          registry.setParam(modId, `step-${col}-vel`, 0);
        } else {
          dragRow = null;
          registry.setParam(modId, `step-${col}-vel`, next);
          stepLastPainted.set(col, now);
        }
      }
    }
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault();
  }

  function onGridPointerMove(e: PointerEvent) {
    if (dragRow === null) return;
    const el   = document.elementFromPoint(e.clientX, e.clientY);
    const cell = el?.closest<HTMLElement>('.seq-cell');
    if (!cell) return;
    const col = Number(cell.dataset['step']);
    const row = Number(cell.dataset['row']);
    const mod = registry.modules.get(modId);
    if (dragVel === 0) {
      const curVel = (mod?.params[`step-${col}-vel`] as number) ?? 0;
      if (curVel > 0) registry.setParam(modId, `step-${col}-vel`, 0);
    } else {
      const curVel  = (mod?.params[`step-${col}-vel`]  as number) ?? 0;
      const curNote = (mod?.params[`step-${col}-note`] as number) ?? 12;
      if (curNote !== row || curVel !== dragVel) {
        registry.setParam(modId, `step-${col}-note`, row);
        registry.setParam(modId, `step-${col}-vel`,  dragVel);
        stepLastPainted.set(col, Date.now());
      }
    }
  }

  function onGridPointerUp() { dragRow = null; }

  function cycleBars() {
    const newBars = (bars % 4) + 1;
    registry.setParam(modId, 'bars', newBars);
  }

  function toggleFold() {
    registry.setParam(modId, 'fold', fold ? 0 : 1);
  }

  // Number of columns = 16 * bars (for grid-template-columns)
  $derived: {};
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
  <div class="seq-gate-ctrl">
    <Knob
      moduleId={modId}
      param="gate"
      value={(params['gate'] as number) ?? 0.5}
      min={0}
      max={1}
      label="GATE"
      format={def.paramDefs['gate'].format}
      {hue}
      defaultValue={(def.defaultParams['gate'] as number) ?? 0.5}
    />
  </div>
</div>

{#if !collapsed}
  <div class="seq-grid-wrap">
    <div
      class="seq-grid note-seq-grid"
      style="--seq-cols:{totalCols()}"
      onpointerdown={onGridPointerDown}
      onpointermove={onGridPointerMove}
      onpointerup={onGridPointerUp}
      onpointercancel={onGridPointerUp}
    >
      {#each cells as cell (cell.row * 10000 + cell.col)}
        <div
          class="seq-cell"
          class:tonic-row={cell.isTonic}
          class:playhead={cell.col === playhead}
          class:vel-1={cell.vel === 1}
          class:vel-2={cell.vel === 2}
          class:vel-3={cell.vel === 3}
          style="--ch:{cell.cellHue}"
          data-step={cell.col}
          data-row={cell.row}
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
  <button class="seq-fold-btn" class:active={fold} onclick={toggleFold}>FOLD</button>
</div>

