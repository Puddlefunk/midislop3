<script lang="ts">
  import { getPanelContext } from '../../ui/context';
  import { getModuleDef } from '../../config/modules';
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

  const CHANNELS = [0, 1, 2, 3] as const;
</script>

<div class="mix-strips">
  {#each CHANNELS as i}
    <div class="fader-cell">
      <Knob
        moduleId={modId}
        param="level-in-{i}"
        value={(params[`level-in-${i}`] as number) ?? 1}
        min={0}
        max={1}
        label="CH{i+1}"
        format={v => Math.round(v * 100) + '%'}
        isFader={true}
        {hue}
        defaultValue={1}
      />
      <div class="mix-send-col">
        <Knob
          moduleId={modId}
          param="s0-in-{i}"
          value={(params[`s0-in-${i}`] as number) ?? 0}
          min={0}
          max={1}
          label="SA"
          format={v => Math.round(v * 100) + '%'}
          {hue}
          defaultValue={0}
        />
        <Knob
          moduleId={modId}
          param="s1-in-{i}"
          value={(params[`s1-in-${i}`] as number) ?? 0}
          min={0}
          max={1}
          label="SB"
          format={v => Math.round(v * 100) + '%'}
          {hue}
          defaultValue={0}
        />
      </div>
    </div>
  {/each}
  <div class="mix-master-cell">
    <span class="mix-master-lbl">MSTR</span>
    <Knob
      moduleId={modId}
      param="level"
      value={(params['level'] as number) ?? 1}
      min={0}
      max={1}
      label="MST"
      format={v => Math.round(v * 100) + '%'}
      isFader={true}
      {hue}
      defaultValue={1}
    />
  </div>
</div>
