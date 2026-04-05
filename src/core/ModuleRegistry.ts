import type { ModuleInstance, Patch, SignalType, RegistryEvents, ParamValue, RegistryCommand } from '../types';
import { getModuleDef } from '../config/modules';

type EventHandler<T> = (detail: T) => void;

// ─────────────────────────────────────────────────────────────
// ModuleRegistry — single source of truth for all synth state.
//
// All mutations flow through applyCommand(). The public API
// methods (addModule, removeModule, etc.) generate a command and
// delegate to applyCommand — they are convenience wrappers only.
//
// onCommand fires after each successful local command. Attach a
// network transport here to broadcast commands to peers:
//   registry.onCommand = cmd => socket.send(JSON.stringify(cmd));
//
// Peers receive and apply commands without re-broadcasting:
//   registry.applyCommand(JSON.parse(msg), { remote: true });
// ─────────────────────────────────────────────────────────────

export class ModuleRegistry {
  readonly modules = new Map<string, ModuleInstance>();
  patches: Patch[] = [];

  /** Called after every locally-originated command. Wire to network transport here. */
  onCommand?: (cmd: RegistryCommand) => void;

  private _listeners = new Map<string, Set<EventHandler<unknown>>>();

  // ── Command dispatch ─────────────────────────────────────────

  /**
   * Apply a registry command.
   * @param cmd  The command to apply.
   * @param opts Pass { remote: true } for commands received from peers to suppress re-broadcast.
   * @returns    The new module ID for ADD_MODULE; true/false for others.
   */
  applyCommand(cmd: RegistryCommand, opts?: { remote?: boolean }): string | boolean {
    const local = !opts?.remote;

    switch (cmd.type) {
      case 'ADD_MODULE': {
        const def    = getModuleDef(cmd.moduleType);
        const params = { ...(def?.defaultParams ?? {}), ...cmd.params };
        const mod: ModuleInstance = { id: cmd.id, type: cmd.moduleType, params };
        this.modules.set(cmd.id, mod);
        this._emit('module-added', mod);
        if (local) this.onCommand?.(cmd);
        return cmd.id;
      }

      case 'REMOVE_MODULE': {
        const mod = this.modules.get(cmd.id);
        if (!mod) return false;
        // Remove associated patches internally — these are implied by REMOVE_MODULE,
        // not broadcast as separate commands, so peers handle them as part of this command.
        this._removePatches(p => p.fromId === cmd.id || p.toId === cmd.id);
        this.modules.delete(cmd.id);
        this._emit('module-removed', { id: cmd.id, type: mod.type });
        if (local) this.onCommand?.(cmd);
        return true;
      }

      case 'SET_PARAM': {
        const mod = this.modules.get(cmd.id);
        if (!mod) return false;
        mod.params[cmd.param] = cmd.value;
        this._emit('param-changed', { id: cmd.id, param: cmd.param, value: cmd.value });
        if (local) this.onCommand?.(cmd);
        return true;
      }

      case 'ADD_PATCH': {
        const fromType = this._portSignalType(cmd.fromPort);
        const toType   = this._portSignalType(cmd.toPort);
        // note ports are strictly typed; send/return ports are audio-compatible
        const audioFamily = (t: SignalType) => t === 'audio' || t === 'send';
        if (!(fromType === toType || (audioFamily(fromType) && audioFamily(toType)))) return false;
        // cable is orange if either end is a send/return port
        const patchType: SignalType = (fromType === 'send' || toType === 'send') ? 'send' : fromType;
        // Evict any existing connection to the same input port (one source per input)
        this.patches = this.patches.filter(p => !(p.toId === cmd.toId && p.toPort === cmd.toPort));
        // Remove exact duplicate
        this.patches = this.patches.filter(
          p => !(p.fromId === cmd.fromId && p.fromPort === cmd.fromPort && p.toId === cmd.toId && p.toPort === cmd.toPort)
        );
        this.patches.push({ fromId: cmd.fromId, fromPort: cmd.fromPort, toId: cmd.toId, toPort: cmd.toPort, signalType: patchType });
        this._emit('patch-changed', { patches: this.patches });
        if (local) this.onCommand?.(cmd);
        return true;
      }

      case 'REMOVE_PATCH': {
        const before = this.patches.length;
        this.patches = this.patches.filter(
          p => !(p.fromId === cmd.fromId && p.fromPort === cmd.fromPort && p.toId === cmd.toId && p.toPort === cmd.toPort)
        );
        if (this.patches.length !== before) {
          this._emit('patch-changed', { patches: this.patches });
          if (local) this.onCommand?.(cmd);
          return true;
        }
        return false;
      }
    }
  }

  // ── Public API — wrappers around applyCommand ─────────────────

  addModule(moduleType: string, params: Record<string, ParamValue> = {}): string {
    const id = `${moduleType}-${crypto.randomUUID().slice(0, 8)}`;
    this.applyCommand({ type: 'ADD_MODULE', id, moduleType, params });
    return id;
  }

  removeModule(id: string): void {
    this.applyCommand({ type: 'REMOVE_MODULE', id });
  }

  setParam(id: string, param: string, value: ParamValue): void {
    this.applyCommand({ type: 'SET_PARAM', id, param, value });
  }

  addPatch(fromId: string, fromPort: string, toId: string, toPort: string): boolean {
    return this.applyCommand({ type: 'ADD_PATCH', fromId, fromPort, toId, toPort }) as boolean;
  }

  removePatch(fromId: string, fromPort: string, toId: string, toPort: string): void {
    this.applyCommand({ type: 'REMOVE_PATCH', fromId, fromPort, toId, toPort });
  }

  /** Remove all patches originating from a module's output ports, optionally filtered to one port. */
  removePatchesFrom(fromId: string, fromPort?: string): void {
    const toRemove = this.patches.filter(p => p.fromId === fromId && (fromPort === undefined || p.fromPort === fromPort));
    for (const p of toRemove) {
      this.applyCommand({ type: 'REMOVE_PATCH', fromId: p.fromId, fromPort: p.fromPort, toId: p.toId, toPort: p.toPort });
    }
  }

  /** Remove every patch atomically — fires patch-changed once. */
  clearAllPatches(): void {
    if (this.patches.length === 0) return;
    this.patches = [];
    this._emit('patch-changed', { patches: [] });
  }

  /** Remove all patches arriving at a module's input ports (optionally filtered to one port). */
  removePatchesTo(toId: string, toPort?: string): void {
    const toRemove = this.patches.filter(p => p.toId === toId && (toPort === undefined || p.toPort === toPort));
    for (const p of toRemove) {
      this.applyCommand({ type: 'REMOVE_PATCH', fromId: p.fromId, fromPort: p.fromPort, toId: p.toId, toPort: p.toPort });
    }
  }

  // ── Patch queries ─────────────────────────────────────────────

  patchesFrom(id: string):                   Patch[] { return this.patches.filter(p => p.fromId === id); }
  patchesTo(id: string):                     Patch[] { return this.patches.filter(p => p.toId === id); }
  patchesFromPort(id: string, port: string): Patch[] { return this.patches.filter(p => p.fromId === id && p.fromPort === port); }

  // ── Module queries ────────────────────────────────────────────

  countModules(type: string): number {
    let n = 0;
    for (const mod of this.modules.values()) if (mod.type === type) n++;
    return n;
  }

  getModulesByType(type: string): ModuleInstance[] {
    return [...this.modules.values()].filter(m => m.type === type);
  }

  getModulesByCategory(category: string): ModuleInstance[] {
    return [...this.modules.values()].filter(m => getModuleDef(m.type)?.category === category);
  }

  getOscModules(): ModuleInstance[] {
    return this.getModulesByCategory('osc');
  }

  // ── Signal type inference ─────────────────────────────────────

  _portSignalType(port: string): SignalType {
    if (port.startsWith('note-out') || port.startsWith('note-in')) return 'note';
    if (port.startsWith('send-') || port.startsWith('return-')) return 'send';
    return 'audio';
  }

  // ── Event emitter ─────────────────────────────────────────────

  on<K extends keyof RegistryEvents>(event: K, handler: EventHandler<RegistryEvents[K]>): void {
    if (!this._listeners.has(event)) this._listeners.set(event, new Set());
    this._listeners.get(event)!.add(handler as EventHandler<unknown>);
  }

  off<K extends keyof RegistryEvents>(event: K, handler: EventHandler<RegistryEvents[K]>): void {
    this._listeners.get(event)?.delete(handler as EventHandler<unknown>);
  }

  private _emit<K extends keyof RegistryEvents>(event: K, detail: RegistryEvents[K]): void {
    this._listeners.get(event)?.forEach(h => h(detail));
  }

  // ── Internal helpers ──────────────────────────────────────────

  /** Remove patches matching a predicate and fire patch-changed if anything was removed.
   *  Used internally by REMOVE_MODULE — does not broadcast via onCommand. */
  private _removePatches(pred: (p: Patch) => boolean): void {
    const before = this.patches.length;
    this.patches = this.patches.filter(p => !pred(p));
    if (this.patches.length !== before) this._emit('patch-changed', { patches: this.patches });
  }

  // ── Serialisation ─────────────────────────────────────────────

  toJSON(): { modules: ModuleInstance[]; patches: Patch[] } {
    return {
      modules: [...this.modules.values()].map(m => ({ ...m, params: { ...m.params } })),
      patches: [...this.patches],
    };
  }

  /**
   * Bulk-load a snapshot. Clears current state and replays module-added / patch-changed
   * events so AudioGraph and UIRenderer rebuild from the saved data.
   * onCommand is NOT fired — this is a local restore, not a broadcast.
   */
  fromJSON(data: { modules: ModuleInstance[]; patches: Patch[] }): void {
    this.modules.clear();
    this.patches = [];
    for (const mod of data.modules) {
      const instance = { ...mod, params: { ...mod.params } };
      this.modules.set(mod.id, instance);
      this._emit('module-added', instance);
    }
    this.patches = [...data.patches];
    this._emit('patch-changed', { patches: this.patches });
  }
}
