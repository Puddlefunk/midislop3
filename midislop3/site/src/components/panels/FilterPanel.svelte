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

  const def = getModuleDef(type)!;
  const hue = def.hue;

  let filterType = $state((params['filterType'] as number) ?? 0);

  function setFilter(val: number) {
    filterType = val;
    registry.setParam(modId, 'filterType', val);
  }
</script>

<div class="filter-type-row">
  <button
    class="filter-type-btn"
    class:active={filterType < 0.33}
    onclick={() => setFilter(0)}
  >LP</button>
  <button
    class="filter-type-btn"
    class:active={filterType >= 0.33 && filterType < 0.67}
    onclick={() => setFilter(0.5)}
  >HP</button>
  <button
    class="filter-type-btn"
    class:active={filterType >= 0.67}
    onclick={() => setFilter(1)}
  >BP</button>
</div>
<div class="synth-hgroup">
  <Knob
    moduleId={modId}
    param="cutoff"
    value={(params['cutoff'] as number) ?? 0.6}
    min={def.paramDefs['cutoff'].min}
    max={def.paramDefs['cutoff'].max}
    label={def.paramDefs['cutoff'].label}
    format={def.paramDefs['cutoff'].format}
    {hue}
    defaultValue={(def.defaultParams['cutoff'] as number)}
  />
  <Knob
    moduleId={modId}
    param="res"
    value={(params['res'] as number) ?? 0.2}
    min={def.paramDefs['res'].min}
    max={def.paramDefs['res'].max}
    label={def.paramDefs['res'].label}
    format={def.paramDefs['res'].format}
    {hue}
    defaultValue={(def.defaultParams['res'] as number)}
  />
</div>
