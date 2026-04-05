<script lang="ts">
  import { onMount } from 'svelte';
  import { getPanelContext } from '../../ui/context';
  import { getModuleDef } from '../../config/modules';
  import { noteHue } from '../../config/helpers';
  import Knob from './Knob.svelte';
  import Jack from './Jack.svelte';
  import type { ParamValue } from '../../types';

  const { registry } = getPanelContext();

  let { modId, type, params }: {
    modId:  string;
    type:   string;
    params: Record<string, ParamValue>;
  } = $props();

  const def = $derived(getModuleDef(type)!);
  const hue = $derived(def.hue);

  const VOICES = [
    { offset: 'offset-0', vel: 'vel-0', port: 'note-out-1', voice: 0 },
    { offset: 'offset-1', vel: 'vel-1', port: 'note-out-2', voice: 1 },
    { offset: 'offset-2', vel: 'vel-2', port: 'note-out-3', voice: 2 },
  ] as const;

  let mode = $state((params['mode'] as string) ?? 'combined');

  // Per-voice note light state
  let voiceLightHues = $state<Record<number, number>>({});
  let voiceActive    = $state<Record<number, boolean>>({});

  function toggleSplit() {
    const newMode = mode === 'split' ? 'combined' : 'split';
    mode = newMode;
    registry.setParam(modId, 'mode', newMode);
  }

  onMount(() => {
    const onVoiceOn = (e: Event) => {
      const { modId: mid, voice, midi } = (e as CustomEvent<{ modId: string; voice: number; midi: number }>).detail;
      if (mid !== modId) return;
      voiceLightHues = { ...voiceLightHues, [voice]: noteHue(midi) };
      voiceActive = { ...voiceActive, [voice]: true };
      setTimeout(() => {
        voiceActive = { ...voiceActive, [voice]: false };
      }, 500);
    };
    window.addEventListener('chord-voice-on', onVoiceOn);
    return () => window.removeEventListener('chord-voice-on', onVoiceOn);
  });

  function isOffset0(v: { offset: string }) {
    return (params[v.offset] as number) === 0;
  }
</script>

<div class="chord-panel-inner">
  <div class="chord-header-row">
    <button
      class="chord-split-btn"
      class:active={mode === 'split'}
      onclick={toggleSplit}
    >SPLIT</button>
  </div>
  <div class="chord-main">
    <div class="chord-strip-l">
      <Jack {modId} port="note-in" isOut={false} signal="note" />
    </div>
    <div class="chord-content">
      {#each VOICES as v}
        <div class="chord-row">
          <div class="synth-control" class:dim={(params[v.offset] as number) === 0}>
            <Knob
              moduleId={modId}
              param={v.offset}
              value={(params[v.offset] as number) ?? 0}
              min={def.paramDefs[v.offset].min}
              max={def.paramDefs[v.offset].max}
              label="OFF"
              format={def.paramDefs[v.offset].format}
              bipolar={true}
              {hue}
              defaultValue={(def.defaultParams[v.offset] as number) ?? 0}
            />
          </div>
          <Knob
            moduleId={modId}
            param={v.vel}
            value={(params[v.vel] as number) ?? 1}
            min={def.paramDefs[v.vel].min}
            max={def.paramDefs[v.vel].max}
            label="VEL"
            format={def.paramDefs[v.vel].format}
            {hue}
            defaultValue={(def.defaultParams[v.vel] as number) ?? 1}
          />
          <span
            class="chord-note-light"
            class:chord-voice-active={voiceActive[v.voice]}
            style="--lh:{voiceLightHues[v.voice] ?? 42}"
          ></span>
        </div>
      {/each}
    </div>
    <div class="chord-strip-r">
      {#each VOICES as v}
        <Jack {modId} port={v.port} isOut={true} signal="note" />
      {/each}
    </div>
  </div>
</div>
