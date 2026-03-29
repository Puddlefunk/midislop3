<script lang="ts">
  import { onMount } from 'svelte';
  import { getPanelContext } from '../../ui/context';
  import { drawKnob, drawBipolarKnob, drawFader } from '../../ui/knobDraw';

  const { registry } = getPanelContext();

  let { moduleId, param, value, min, max, label, format, bipolar = false, isFader = false, hue, defaultValue }: {
    moduleId: string;
    param: string;
    value: number;
    min: number;
    max: number;
    label: string;
    format: (v: number) => string;
    bipolar?: boolean;
    isFader?: boolean;
    hue: number;
    defaultValue?: number;
  } = $props();

  let canvasEl: HTMLCanvasElement;
  let focused = $state(false);
  let size        = $state(34);
  let faderWidth  = $state(22);
  let faderHeight = $state(84);

  function v01() {
    return max > min ? (value - min) / (max - min) : 0;
  }

  onMount(() => {
    const em = parseFloat(getComputedStyle(canvasEl).fontSize);
    size        = Math.round(em * 3.4);
    faderWidth  = Math.round(em * 2.2);
    faderHeight = Math.round(em * 8.4);
  });

  $effect(() => {
    if (!canvasEl) return;
    void size; // track canvas size changes as a dependency
    // SWAP POINT: replace the draw call below to change knob rendering style
    if (isFader) drawFader(canvasEl, v01(), hue, focused);
    else if (bipolar) drawBipolarKnob(canvasEl, v01(), hue, focused);
    else drawKnob(canvasEl, v01(), hue, focused);
    // end SWAP POINT
  });

  let dragStartY = 0;
  let dragStartVal = 0;
  let dragging = false;

  function onMouseDown(e: MouseEvent) {
    if ((window as any).__midiLearnActive) {
      window.dispatchEvent(new CustomEvent('midi-learn-select', { detail: { moduleId, param } }));
      e.preventDefault();
      return;
    }
    dragging = true;
    focused = true;
    dragStartY = e.clientY;
    dragStartVal = value;
    e.preventDefault();

    function onMove(e: MouseEvent) {
      if (!dragging) return;
      const range = max - min;
      const delta = (dragStartY - e.clientY) / 180 * range;
      const newVal = Math.max(min, Math.min(max, dragStartVal + delta));
      registry.setParam(moduleId, param, newVal);
    }
    function onUp() {
      dragging = false;
      focused = false;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  function onDblClick(e: MouseEvent) {
    if (defaultValue !== undefined) {
      registry.setParam(moduleId, param, defaultValue);
      e.preventDefault();
    }
  }
</script>

<div class="synth-control">
  <label>{label}</label>
  <!-- SWAP POINT: replace the canvas block below to change knob rendering style -->
  <canvas
    bind:this={canvasEl}
    class="knob-canvas {isFader ? 'fader-canvas' : ''}"
    width={isFader ? faderWidth : size}
    height={isFader ? faderHeight : size}
    data-module={moduleId}
    data-param={param}
    onmousedown={onMouseDown}
    ondblclick={onDblClick}
  ></canvas>
  <!-- end SWAP POINT -->
  <span class="val">{format(value)}</span>
</div>
