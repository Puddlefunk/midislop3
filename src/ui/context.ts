import { getContext, setContext } from 'svelte';
import type { ModuleRegistry } from '../core/ModuleRegistry';
import type { PatchSystem } from './PatchSystem';

interface PanelContext {
  registry: ModuleRegistry;
  patchSystem: PatchSystem;
}

const KEY = Symbol('panel-context');
export const setPanelContext = (ctx: PanelContext) => setContext(KEY, ctx);
export const getPanelContext = (): PanelContext => {
  const ctx = getContext<PanelContext>(KEY);
  if (!ctx) throw new Error('getPanelContext called outside panel tree');
  return ctx;
};
