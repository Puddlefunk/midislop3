import type { ModuleRegistry } from '../core/ModuleRegistry';
import type { NoteRouter }     from '../input/NoteRouter';
import type { NoteEvent, ModuleInstance } from '../types';
import type { VoiceNode, Voice } from './audioTypes';
import type { FxDriver } from './FxModules';
import { getModuleDef, getRuntimeType } from '../config/modules';
import {
  midiToFreq,
  sliderToFreq, sliderToAttack, sliderToDecay, sliderToRelease,
} from '../config/helpers';
import { getContext as toneGetContext } from 'tone';
import { Transport, SEQ_DRIVERS } from './Sequencers';
import { FX_DRIVERS, openNoiseGates, closeNoiseGates } from './FxModules';
import { OSC_PARAM_HANDLERS, applyOscInitParams, getTriWave, getSqWave, makeFoldCurve, makeDriveCurve } from './OscModules';
import { NOTE_PROCESSOR_DRIVERS } from './NoteProcessors';
import { DRUM_DRIVERS } from './DrumVoices';

// ─────────────────────────────────────────────────────────────
// AudioGraph
// ─────────────────────────────────────────────────────────────

export class AudioGraph {
  ctx:           AudioContext | null = null;
  readonly registry: ModuleRegistry;
  readonly router:   NoteRouter;

  transport: Transport | null = null;

  // Polyphonic voices: 'midi:60' or 'noteSeq-0:60' → Voice
  voices             = new Map<string, Voice>();
  glideFromFreq:     number | null = null;
  seqGlideFreqs      = new Map<string, number>();
    seqPlayheads       = new Map<string, { step: number; row: number; audioTime: number }>();
    _seqCvNoteOffTimers = new Map<string, { midi: number; timerId: ReturnType<typeof setTimeout> }>();
    drumNoiseBuffers   = new Map<string, AudioBuffer>();
    _kickClickBuf:     AudioBuffer | null = null;

  // Global nodes
  masterGain:   GainNode      | null = null;
  dryBus:       GainNode      | null = null;

  constructor(registry: ModuleRegistry, router: NoteRouter) {
    this.registry = registry;
    this.router   = router;
    this._subscribeRegistry();
    this._subscribeRouter();
  }

  // ── Lifecycle ────────────────────────────────────────────────

  ensure(): AudioContext {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') toneGetContext().resume();
      return this.ctx;
    }

    // Use Tone.js's AudioContext so transport and raw nodes share the same context and clock
    const toneCtx = toneGetContext();
    this.ctx = toneCtx.rawContext as AudioContext;
    toneCtx.resume();
    const ctx = this.ctx;

    // Master output
    this.masterGain = ctx.createGain(); this.masterGain.gain.value = 0.65;
    this.masterGain.connect(ctx.destination);

    this.dryBus = ctx.createGain(); this.dryBus.gain.value = 1;
    this.dryBus.connect(this.masterGain);

    // Init already-registered modules
    for (const [id, mod] of this.registry.modules) {
      const runtimeType = getRuntimeType(mod.type);
      FX_DRIVERS[runtimeType]?.init(this, id, mod.params);
      applyOscInitParams(this, id, runtimeType, mod.params);
    }

    // Transport
    if (!this.transport) this.transport = new Transport(this);

    for (const [id, mod] of this.registry.modules) {
      const runtimeType = getRuntimeType(mod.type);
      SEQ_DRIVERS[runtimeType]?.init(this, id);
      NOTE_PROCESSOR_DRIVERS[runtimeType]?.init(this, id);
    }

    return this.ctx;
  }

  // ── Event subscriptions ──────────────────────────────────────

  private _subscribeRegistry(): void {
    this.registry.on('module-added',   mod => this._onModuleAdded(mod));
    this.registry.on('module-removed', e   => this._onModuleRemoved(e.id, e.type));
    this.registry.on('patch-changed',  ()  => this._onPatchChanged());
    this.registry.on('param-changed',  e   => this._onParamChanged(e.id, e.param, e.value));
  }

  private _subscribeRouter(): void {
    this.router.onNoteOn(e  => this._onNoteOn(e));
    this.router.onNoteOff(e => this._onNoteOff(e));
  }

  private _onNoteOn(event: NoteEvent): void {
    this.ensure();
    const seqId = event.generatorId;
    const t = this.ctx!.currentTime;
    if (seqId) this._fireMidiNoteToDrums(seqId, event.midi, event.velocity, t);
    this._walkNotePathFx(seqId, (driver, mod) => driver.onNoteOn?.(this, mod.id, event.midi, event.velocity, t));
    const procMod = this._findNoteProcessorInPath(seqId);
    if (procMod) {
      NOTE_PROCESSOR_DRIVERS[getRuntimeType(procMod.type)]?.onNoteOn(this, procMod.id, event.midi, event.velocity, seqId);
      return;
    }
    this.playNote(event.midi, event.velocity, null, seqId);
  }

  private _onNoteOff(event: NoteEvent): void {
    if (!this.ctx) return;
    const seqId = event.generatorId;
    const t = this.ctx.currentTime;
    this._walkNotePathFx(seqId, (driver, mod) => driver.onNoteOff?.(this, mod.id, event.midi, t));
    const procMod = this._findNoteProcessorInPath(seqId);
    if (procMod) {
      NOTE_PROCESSOR_DRIVERS[getRuntimeType(procMod.type)]?.onNoteOff(this, procMod.id, event.midi, seqId);
      return;
    }
    this.stopNote(event.midi, null, seqId);
  }

  private _findNoteProcessorInPath(seqId: string | null): ModuleInstance | null {
    if (seqId === null) return null;
    const visited = new Set<string>();
    const queue = [seqId];
    while (queue.length) {
      const fromId = queue.shift()!;
      if (visited.has(fromId)) continue;
      visited.add(fromId);
      for (const p of this.registry.patchesFrom(fromId)) {
        if (p.signalType !== 'note') continue;
        const toMod = this.registry.modules.get(p.toId);
        if (!toMod) continue;
        if (NOTE_PROCESSOR_DRIVERS[getRuntimeType(toMod.type)]) return toMod;
        const def = getModuleDef(toMod.type);
        if (def?.category !== 'osc') queue.push(p.toId);
      }
    }
    return null;
  }

  private _walkNotePathFx(seqId: string | null, cb: (driver: FxDriver, mod: ModuleInstance) => void): void {
    if (!seqId) return;
    const visited = new Set<string>();
    const queue = [seqId];
    while (queue.length) {
      const fromId = queue.shift()!;
      if (visited.has(fromId)) continue;
      visited.add(fromId);
      for (const p of this.registry.patchesFrom(fromId)) {
        if (p.signalType !== 'note') continue;
        const toMod = this.registry.modules.get(p.toId);
        if (!toMod) continue;
        const rt = getRuntimeType(toMod.type);
        const driver = FX_DRIVERS[rt];
        if (driver) { cb(driver, toMod); }
        else { queue.push(p.toId); }
      }
    }
  }

  // ── Module lifecycle ─────────────────────────────────────────

  private _onModuleAdded(mod: ModuleInstance): void {
    if (!this.ctx) return;
    const { id, type, params } = mod;
    const runtimeType = getRuntimeType(type);
    FX_DRIVERS[runtimeType]?.init(this, id, params);
    SEQ_DRIVERS[runtimeType]?.init(this, id);
    NOTE_PROCESSOR_DRIVERS[runtimeType]?.init(this, id);
  }

  private _onModuleRemoved(id: string, type: string): void {
    const runtimeType = getRuntimeType(type);
    FX_DRIVERS[runtimeType]?.remove(this, id);
    SEQ_DRIVERS[runtimeType]?.remove(this, id);
    NOTE_PROCESSOR_DRIVERS[runtimeType]?.remove(this, id);
  }

  private _onPatchChanged(): void {
    if (!this.ctx) return;
    for (const driver of Object.values(FX_DRIVERS)) driver?.syncOutput?.(this);
    this._syncAllVoices();
  }

  private _onParamChanged(id: string, param: string, value: unknown): void {
    if (!this.ctx) return;
    const mod = this.registry.modules.get(id);
    if (!mod) return;

    const runtimeType = getRuntimeType(mod.type);

    if (FX_DRIVERS[runtimeType]) {
      FX_DRIVERS[runtimeType]!.updateParam(this, id, param, value);
    } else {
      OSC_PARAM_HANDLERS[runtimeType]?.(this, id, param, value);
    }

    if (getModuleDef(mod.type)?.category === 'osc' && param === 'level') {
      this._syncVoiceGainsForModule(id);
    }
  }

  // ── Sync methods ─────────────────────────────────────────────

  private _syncAllVoices(): void {
    for (const voice of this.voices.values()) this._rewireVoice(voice);
  }

  private _rewireVoice(voice: Voice): void {
    // Only update envGain → destination connections; osc → envGain is permanent from note-on.
    for (const [oscId, envGain] of voice.envGains) {
      try { envGain.disconnect(); } catch (_) {}
      if (!voice.ownedOscIds.includes(oscId)) continue;
      const dest = this._getOscOutputDest(oscId);
      if (dest) envGain.connect(dest);
    }
    // Refresh per-osc gain levels in case patch cables changed
    for (const [modId, vnode] of voice.oscNodes) {
      if (!voice.ownedOscIds.includes(modId)) { vnode.gain.gain.value = 0; continue; }
      const patch = this.registry.patchesFrom(modId).find(p => p.fromPort === 'audio');
      vnode.gain.gain.value = patch ? this._oscEffectiveGain(modId) : 0;
    }
  }

  // ── Destination routing ──────────────────────────────────────

  _getDestNode(toId: string, toPort: string): AudioNode | null {
    const mod = this.registry.modules.get(toId);
    if (!mod) return null;
    const runtimeType = getRuntimeType(mod.type);
    return FX_DRIVERS[runtimeType]?.getInputNode?.(this, toId, toPort) ?? null;
  }

  // ── Per-osc output destination ───────────────────────────────

  private _getOscOutputDest(oscId: string): AudioNode | null {
    const patch = this.registry.patchesFrom(oscId).find(p => p.fromPort === 'audio');
    if (!patch) return null;
    return this._getDestNode(patch.toId, patch.toPort);
  }

  // ── Owned OSC resolution ─────────────────────────────────────

  getOwnedOscIds(seqId: string | null, fromPort?: string): string[] {
    // BFS along note-signal patches from seqId.
    // chord and note-merge modules are transparent — BFS walks through them.
    // When fromPort is specified, only follow patches from that specific port of seqId.
    if (seqId === null) return [];
    const owned: string[] = [];
    const visited = new Set<string>();
    const queue: Array<{ id: string; port?: string }> = [{ id: seqId, port: fromPort }];
    while (queue.length) {
      const { id: fromId, port: limitPort } = queue.shift()!;
      if (!limitPort && visited.has(fromId)) continue;
      visited.add(fromId);
      const patches = limitPort
        ? this.registry.patchesFromPort(fromId, limitPort)
        : this.registry.patchesFrom(fromId);
      for (const p of patches) {
        if (p.signalType !== 'note') continue;
        const toMod = this.registry.modules.get(p.toId);
        if (!toMod) continue;
        const def = getModuleDef(toMod.type);
        if (!def) continue;
        if (def.category === 'osc' && !FX_DRIVERS[getRuntimeType(toMod.type)]) {
          owned.push(p.toId);
        } else {
          // Walk through note-routing utility modules (chord, note-merge) and drums
          queue.push({ id: p.toId });
        }
      }
    }
    return owned;
  }

  // ── Gain helpers ─────────────────────────────────────────────

  private _oscEffectiveGain(modId: string): number {
    const mod = this.registry.modules.get(modId);
    if (!mod) return 0;
    const level = (mod.params.level as number) ?? 0.8;
    const patch = this.registry.patchesFrom(modId).find(p => p.fromPort === 'audio');
    if (!patch) return 0;
    const destMod = this.registry.modules.get(patch.toId);
    if (destMod && getRuntimeType(destMod.type) === 'mixer') {
      const chLevel = (destMod.params[`level-${patch.toPort}`] as number) ?? 1; // level-in-N
      return level * chLevel;
    }
    return level;
  }

  private _syncVoiceGainsForModule(modId: string): void {
    if (!this.ctx) return;
    for (const voice of this.voices.values()) {
      const vnode = voice.oscNodes.get(modId);
      if (vnode) {
        const gain = this._oscEffectiveGain(modId);
        vnode.gain.gain.setTargetAtTime(gain, this.ctx.currentTime, 0.01);
      }
    }
  }

  // ── Note playback ────────────────────────────────────────────

  playNote(midi: number, velocity: number, when: number | null = null, seqId: string | null = null, ownedOscIdsOverride?: string[]): void {
    this.ensure();
    const ctx = this.ctx!;
    const t   = when ?? ctx.currentTime;
    const vk  = seqId ? `${seqId}:${midi}` : `midi:${midi}`;
    this.stopNote(midi, t, seqId);

    const freq     = midiToFreq(midi);
    const prevFreq = seqId === null ? this.glideFromFreq : (this.seqGlideFreqs.get(seqId) ?? null);
    if (seqId === null) this.glideFromFreq = freq;
    else this.seqGlideFreqs.set(seqId, freq);

    const vol = (velocity / 127) * 0.28;

    // Default built-in envelope (used when osc doesn't directly feed an adsr-x2)
    const atk = sliderToAttack(0.02);
    const dec = sliderToDecay(0.22);
    const sus = 0.55;
    const sustainLevel = vol * sus;

    // Compute voice rel as max of default + any note-envelope releases in note path
    let rel = sliderToRelease(0.2);
    this._walkNotePathFx(seqId, (driver, mod) => {
      if (driver.getRelease) rel = Math.max(rel, driver.getRelease(this, mod.id));
    });

    const ownedOscIds = ownedOscIdsOverride ?? this.getOwnedOscIds(seqId);
    const flatEnvIds  = new Set<string>();

    const oscNodes = new Map<string, VoiceNode>();
    const envGains = new Map<string, GainNode>();

    for (const [id, mod] of this.registry.modules) {
      const def = getModuleDef(mod.type);
      if (!def || def.category !== 'osc') continue;
      if (FX_DRIVERS[getRuntimeType(mod.type)]) continue; // driver-managed sources (noise, etc.)
      if (!ownedOscIds.includes(id)) continue;

      const patch       = this.registry.patchesFrom(id).find(p => p.fromPort === 'audio');
      const directDest  = patch ? this.registry.modules.get(patch.toId) : null;
      const usesNoteEnv = directDest ? !!FX_DRIVERS[getRuntimeType(directDest.type)]?.onNoteOn : false;

      // Read voice params directly from OSC module
      const semiOffset  = (mod.params.semi       as number) ?? 0;
      const detuneAccum = ((mod.params.detune     as number) ?? 0) * 25;
      const glide       = ((mod.params.portamento as number) ?? 0) * 2;
      const vibDepth    = (mod.params['vib-depth'] as number) ?? 0;
      const vibRate     = (mod.params['vib-rate']  as number) ?? 0;
      const velSens     = (mod.params['vel-sens']  as number) ?? 0;
      const gainScale   = velSens === 0 ? 1.0 : (1.0 - velSens + velSens * (velocity / 127));

      const octMul     = Math.pow(2, (mod.params.octave as number) ?? 0);
      const targetFreq = freq * octMul * (semiOffset !== 0 ? Math.pow(2, semiOffset / 12) : 1);
      const wf         = (mod.params.waveform as string | undefined) ?? this._inferWaveform(mod.type);

      const osc = ctx.createOscillator();
      if      (wf === 'sine')     osc.type = 'sine';
      else if (wf === 'sawtooth') osc.type = 'sawtooth';
      else if (wf === 'triangle') { const tw = getTriWave(); if (tw) osc.setPeriodicWave(tw); else osc.type = 'triangle'; }
      else if (wf === 'square')   { const sw = getSqWave(); if (sw) osc.setPeriodicWave(sw); else osc.type = 'square'; }
      else if (wf === 'sub')      { osc.type = 'square'; osc.detune.value = ((mod.params.subTune as number) ?? 0) * 100; }
      else osc.type = 'sine';

      if (glide > 0 && prevFreq !== null) {
        osc.frequency.setValueAtTime(targetFreq * (prevFreq / freq), t);
        osc.frequency.linearRampToValueAtTime(targetFreq, t + glide);
      } else {
        osc.frequency.value = targetFreq;
      }
      osc.detune.value += detuneAccum;
      // Connect per-osc vibrato LFO if vib-depth > 0
      if (vibDepth > 0) {
        // Create a dedicated per-voice LFO for this osc's vibrato
        const vibLfo  = ctx.createOscillator(); vibLfo.type = 'sine';
        vibLfo.frequency.value = 0.1 + vibRate * 9.9; // 0.1 – 10 Hz
        const vibGain = ctx.createGain();
        vibGain.gain.value = vibDepth * 50; // up to ±50 cents
        vibLfo.connect(vibGain); vibGain.connect(osc.detune);
        vibLfo.start(t);
        // LFO stops after a generous window (release + buffer); actual voice cleanup handled separately
        vibLfo.stop(t + rel + 1.5);
      }

      const gainNode = ctx.createGain();
      gainNode.gain.value = patch ? this._oscEffectiveGain(id) * gainScale : 0;

      const foldAmt   = wf === 'sine'     ? ((mod.params.fold  as number) ?? 0) : 0;
      const driveAmt  = wf === 'sawtooth' ? ((mod.params.drive as number) ?? 0) : 0;
      const waveParam = (mod.params.waveParam as number) ?? 0;

      let vnode: VoiceNode;
      if (foldAmt > 0.01 || (wf === 'sine' && mod.type === 'osc' && waveParam > 0.01)) {
        const folder = ctx.createWaveShaper(); folder.curve = makeFoldCurve(foldAmt || waveParam);
        osc.connect(folder); folder.connect(gainNode);
        vnode = { osc, gain: gainNode, shaper: folder };
      } else if (driveAmt > 0.01 || (wf === 'sawtooth' && mod.type === 'osc' && waveParam > 0.01)) {
        const driver = ctx.createWaveShaper(); driver.curve = makeDriveCurve(driveAmt || waveParam);
        osc.connect(driver); driver.connect(gainNode);
        vnode = { osc, gain: gainNode, shaper: driver };
      } else {
        osc.connect(gainNode);
        vnode = { osc, gain: gainNode };
      }

      // Each osc gets its own envelope gain routed to its own cable destination.
      // If routing directly to adsr-x2, use flat gain (adsr-x2 handles shaping).
      const oscEnvGain = ctx.createGain();
      if (usesNoteEnv) {
        oscEnvGain.gain.setValueAtTime(vol * gainScale, t);
        flatEnvIds.add(id);
      } else {
        oscEnvGain.gain.setValueAtTime(0, t);
        oscEnvGain.gain.linearRampToValueAtTime(vol, t + atk);
        oscEnvGain.gain.linearRampToValueAtTime(sustainLevel, t + atk + dec);
      }
      const oscDest = this._getOscOutputDest(id);
      if (oscDest) oscEnvGain.connect(oscDest);
      gainNode.connect(oscEnvGain);
      envGains.set(id, oscEnvGain);

      osc.start(t);
      oscNodes.set(id, vnode);
    }

    openNoiseGates(t);

    const litModIds = this._getSignalPathModIds(ownedOscIds, seqId);
    this.voices.set(vk, { oscNodes, envGains, rel, sustainLevel, ownedOscIds, flatEnvIds, noteCtx: { midi, velocity }, litModIds });
    for (const modId of litModIds) {
      window.dispatchEvent(new CustomEvent('note-module-on', { detail: { modId, midi, velocity } }));
    }
  }

  stopNote(midi: number, when: number | null = null, seqId: string | null = null): void {
    const vk = seqId ? `${seqId}:${midi}` : `midi:${midi}`;
    const v  = this.voices.get(vk);
    if (!v || !this.ctx) return;
    const t          = when ?? this.ctx.currentTime;
    const isScheduled = when !== null && when > this.ctx.currentTime + 0.001;

    // Only apply release ramp to envGains not handled by adsr-x2
    for (const [oscId, g] of v.envGains) {
      if (v.flatEnvIds.has(oscId)) continue;
      g.gain.cancelScheduledValues(t);
      g.gain.setValueAtTime(isScheduled ? (v.sustainLevel ?? 0) : g.gain.value, t);
      g.gain.linearRampToValueAtTime(0, t + v.rel);
    }
    const delay = (v.rel + 0.15 + Math.max(0, t - this.ctx.currentTime)) * 1000;
    setTimeout(() => {
      for (const vn of v.oscNodes.values()) { try { vn.osc.stop(); vn.shaper?.disconnect(); } catch (_) {} }
      for (const eg of v.envGains.values()) { try { eg.disconnect(); } catch (_) {} }
    }, delay);

    if (v.litModIds) {
      for (const modId of v.litModIds) {
        window.dispatchEvent(new CustomEvent('note-module-off', { detail: { modId, midi } }));
      }
    }
    this.voices.delete(vk);
    if (this.voices.size === 0)
      closeNoiseGates(t);
  }

  // ── Waveform inference ───────────────────────────────────────

  private _inferWaveform(type: string): string {
    if (type.includes('sine'))   return 'sine';
    if (type.includes('saw'))    return 'sawtooth';
    if (type.includes('tri'))    return 'triangle';
    if (type.includes('sq'))     return 'square';
    if (type.includes('sub'))    return 'sub';
    return 'sine';
  }

  // ── Drum voices ──────────────────────────────────────────────

  private _fireMidiNoteToDrums(sourceModuleId: string, note: number, vel: number, time: number): void {
    const patches = this.registry.patchesFrom(sourceModuleId)
      .filter(p => p.signalType === 'note');
    for (const patch of patches) {
      const drumMod = this.registry.modules.get(patch.toId);
      if (!drumMod) continue;
      const triggerNote = (drumMod.params?.triggerNote as number) ?? -1;
      if (triggerNote >= 0 && triggerNote !== note) continue;
      this._fireDrumVoice(patch.toId, drumMod.type, vel, time);
    }
  }

  _fireDrumVoice(voiceId: string, type: string, vel: number, time: number): void {
    if (!this.ctx) return;
    DRUM_DRIVERS[type]?.(this, voiceId, vel, time);
  }

  /** BFS over note + audio patches from generator + owned oscs. Returns all module IDs in the signal path. */
  private _getSignalPathModIds(ownedOscIds: string[], seqId: string | null): string[] {
    const visited = new Set<string>();
    const queue: string[] = [];
    if (seqId !== null) {
      queue.push(seqId);
    } else {
      for (const m of this.registry.modules.values()) {
        if (getModuleDef(m.type)?.category === 'generator') queue.push(m.id);
      }
    }
    for (const id of ownedOscIds) queue.push(id);
    while (queue.length) {
      const fromId = queue.shift()!;
      if (visited.has(fromId)) continue;
      visited.add(fromId);
      for (const p of this.registry.patchesFrom(fromId)) {
        if (p.signalType !== 'note' && p.signalType !== 'audio') continue;
        if (!visited.has(p.toId)) queue.push(p.toId);
      }
    }
    return [...visited];
  }

  /** Play a one-shot sine tone — used for game feedback sounds */
  playTone(midi: number, vol: number, when: number, duration: number): void {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator(); osc.type = 'sine';
    osc.frequency.value = midiToFreq(midi);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(vol, when + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, when + duration);
    osc.connect(g); g.connect(this.dryBus!);
    osc.start(when); osc.stop(when + duration + 0.05);
  }
}
