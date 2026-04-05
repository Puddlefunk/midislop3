<script lang="ts">
  import { onMount } from 'svelte';
  import { getPanelContext } from '../../ui/context';
  import { getModuleDef } from '../../config/modules';
  import { drawWavePreview } from '../../ui/knobDraw';
  import Knob from './Knob.svelte';
  import type { ParamValue } from '../../types';

  const { registry } = getPanelContext();

  let { modId, type, params }: {
    modId:  string;
    type:   string;
    params: Record<string, ParamValue>;
  } = $props();

  const def = $derived(getModuleDef(type)!);
  const hue = $derived(def.hue);

  const WF_MAP: Record<string, string> = {
    'osc-sine': 'fold', 'osc-saw': 'drive', 'osc-tri': 'slope',
    'osc-sq': 'width', 'osc-sub': 'subTune', 'osc-noise': 'level',
  };
  const LABEL_MAP: Record<string, string> = {
    'osc-sine': 'FOLD', 'osc-saw': 'DRIVE', 'osc-tri': 'SLOPE',
    'osc-sq': 'WIDTH', 'osc-sub': 'TUNE', 'osc-noise': 'COLOR',
  };

  const specialParam = WF_MAP[type] ?? '';
  const specialLabel = LABEL_MAP[type] ?? '';
  const isNoise = type === 'osc-noise';
  const isMulti = type === 'osc';

  const WF_BTNS = [
    { wf: 'sine', lbl: 'SIN' },
    { wf: 'sawtooth', lbl: 'SAW' },
    { wf: 'triangle', lbl: 'TRI' },
    { wf: 'square',   lbl: 'SQ'  },
  ] as const;

  let octave   = $state((params['octave'] as number) ?? 0);
  let waveform = $state((params['waveform'] as string) ?? 'sine');
  let voiceOpen = $state(false);

  // Derive waveform type for wave preview
  function getPreviewWf(): string {
    if (isMulti) return waveform;
    const wfType = type.replace('osc-', '');
    const WF_NORM: Record<string, string> = { saw: 'sawtooth', tri: 'triangle', sq: 'square' };
    return WF_NORM[wfType] ?? wfType;
  }

  let waveCanvas: HTMLCanvasElement;
  let waveW = $state(90);
  let waveH = $state(28);

  onMount(() => {
    const em = parseFloat(getComputedStyle(waveCanvas).fontSize);
    waveW = Math.round(em * 9);
    waveH = Math.round(em * 2.8);

    // Draw immediately after sizing so waveform appears before interaction
    setTimeout(() => {
      const paramVal = specialParam ? ((params[specialParam] as number) ?? 0) : 0;
      drawWavePreview(waveCanvas, getPreviewWf(), paramVal);
    }, 0);
  });

  $effect(() => {
    if (!waveCanvas) return;
    void waveW;
    const paramVal = specialParam ? ((params[specialParam] as number) ?? 0) : 0;
    drawWavePreview(waveCanvas, getPreviewWf(), paramVal);
  });

  function setOctave(val: number) {
    octave = val;
    registry.setParam(modId, 'octave', val);
  }

  function setWaveform(wf: string) {
    waveform = wf;
    registry.setParam(modId, 'waveform', wf);
  }

  const OSC_VOICE_PARAMS = ['semi', 'portamento', 'vib-rate', 'vib-depth', 'detune', 'vel-sens'] as const;
</script>

<canvas
  bind:this={waveCanvas}
  class="wave-preview"
  width={waveW}
  height={waveH}
></canvas>

<div class="synth-hgroup">
  <Knob
    moduleId={modId}
    param="level"
    value={(params['level'] as number) ?? 0.8}
    min={0}
    max={1}
    label="LEVEL"
    format={v => Math.round(v * 100) + '%'}
    {hue}
    defaultValue={(def.defaultParams['level'] as number) ?? 0.8}
  />
  {#if specialParam && specialParam !== 'level' && def.paramDefs[specialParam]}
    <Knob
      moduleId={modId}
      param={specialParam}
      value={(params[specialParam] as number) ?? 0}
      min={def.paramDefs[specialParam].min}
      max={def.paramDefs[specialParam].max}
      label={specialLabel}
      format={def.paramDefs[specialParam].format}
      {hue}
      defaultValue={(def.defaultParams[specialParam] as number) ?? 0}
    />
  {/if}
</div>

{#if !isNoise}
  <div class="oct-switch">
    <button
      class="oct-btn"
      class:oct-active={octave === -1}
      onclick={() => setOctave(-1)}
    >-1</button>
    <button
      class="oct-btn"
      class:oct-active={octave === 0}
      onclick={() => setOctave(0)}
    >0</button>
    <button
      class="oct-btn"
      class:oct-active={octave === 1}
      onclick={() => setOctave(1)}
    >+1</button>
  </div>
{/if}

{#if isMulti}
  <div class="wf-select">
    {#each WF_BTNS as btn}
      <button
        class="wf-btn"
        class:wf-active={waveform === btn.wf}
        onclick={() => setWaveform(btn.wf)}
      >{btn.lbl}</button>
    {/each}
  </div>
{/if}

{#if !isNoise}
  <button
    class="voice-toggle-btn"
    onclick={() => voiceOpen = !voiceOpen}
  >VOICE</button>
  {#if voiceOpen}
    <div class="voice-panel voice-panel-open">
      <div class="voice-grid">
        {#each OSC_VOICE_PARAMS as vParam}
          {#if def.paramDefs[vParam]}
            <Knob
              moduleId={modId}
              param={vParam}
              value={(params[vParam] as number) ?? 0}
              min={def.paramDefs[vParam].min}
              max={def.paramDefs[vParam].max}
              label={def.paramDefs[vParam].label}
              format={def.paramDefs[vParam].format}
              bipolar={vParam === 'semi'}
              {hue}
              defaultValue={(def.defaultParams[vParam] as number) ?? 0}
            />
          {/if}
        {/each}
      </div>
    </div>
  {/if}
{/if}
