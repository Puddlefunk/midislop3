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

  const def = getModuleDef(type);
  const hue = def?.hue ?? 200;
</script>

<div class="synth-hgroup">
  {#if def}
    {#each Object.entries(def.paramDefs) as [paramKey, pdef]}
      <Knob
        moduleId={modId}
        param={paramKey}
        value={(params[paramKey] as number) ?? 0}
        min={pdef.min}
        max={pdef.max}
        label={pdef.label}
        format={pdef.format}
        {hue}
        defaultValue={(def.defaultParams[paramKey] as number) ?? 0}
      />
    {/each}
  {/if}
</div>
