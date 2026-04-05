<script lang="ts">
  import { onMount } from 'svelte';
  import { getPanelContext } from '../../ui/context';

  const { patchSystem, registry } = getPanelContext();

  let { modId, port, isOut, signal }: {
    modId: string;
    port: string;
    isOut: boolean;
    signal: 'audio' | 'note' | 'send';
  } = $props();

  let el: HTMLDivElement;
  let plugged = $state(false);

  onMount(() => {
    patchSystem.registerJack(modId, port, isOut, el);
    // Update plugged state
    const update = () => {
      plugged = isOut
        ? registry.patchesFrom(modId).some(p => p.fromPort === port)
        : registry.patchesTo(modId).some(p => p.toPort === port);
    };
    update();
    registry.on('patch-changed', update);
    return () => registry.off('patch-changed', update);
  });

  function onPointerDown(e: PointerEvent) {
    patchSystem.handleJackPointerDown(modId, port, isOut, e);
  }
</script>

<div
  bind:this={el}
  class="port-jack {isOut ? 'port-out' : 'port-in'} port-{signal}"
  class:plugged
  data-module={modId}
  data-port={port}
  title={port}
  onpointerdown={onPointerDown}
  oncontextmenu={e => e.preventDefault()}
></div>
