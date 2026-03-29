import type { ModuleRegistry } from '../core/ModuleRegistry';
import type { NoteRouter }     from '../input/NoteRouter';
import type { NoteEvent, ModuleInstance } from '../types';
import type { VoiceNode, Voice, MixerNodes, DelayNodes, LfoNodes, FxNodes, SidechainNodes, VcfX2Nodes, NoiseNodes, AdsrX2Nodes } from './audioTypes';
import { getModuleDef } from '../config/modules';
import {
  midiToFreq,
  sliderToFreq, sliderToAttack, sliderToDecay, sliderToRelease,
  sliderToLfoRate,
  NOTE_NAMES, ENHARMONIC,
} from '../config/helpers';
import { getContext as toneGetContext } from 'tone';
import { Transport, initSeqCv, initSeqDrum, applyTransportParam } from './Sequencers';
import { FX_DRIVERS } from './FxModules';
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
  // Chord note-off tracking: chordKey → [{midi, seqV}]
  _chordActiveNotes  = new Map<string, Array<{ midi: number; seqV: string }>>();
  seqPlayheads       = new Map<string, { step: number; row: number; audioTime: number }>();
  _seqCvNoteOffTimers = new Map<string, { midi: number; timerId: ReturnType<typeof setTimeout> }>();
  drumNoiseBuffers   = new Map<string, AudioBuffer>();
  _kickClickBuf:     AudioBuffer | null = null;

  // Per-module node groups (keyed by module id)
  mixerNodes     = new Map<string, MixerNodes>();
  delayNodes     = new Map<string, DelayNodes>();
  lfoNodes       = new Map<string, LfoNodes>();
  fxNodes        = new Map<string, FxNodes>();
  sidechainNodes = new Map<string, SidechainNodes>();
  vcf2Nodes      = new Map<string, VcfX2Nodes>();
  noiseNodes     = new Map<string, NoiseNodes>();
  adsrX2Nodes    = new Map<string, AdsrX2Nodes>();

  // Global nodes
  masterGain:   GainNode      | null = null;
  dryBus:       GainNode      | null = null;

  // Custom periodic waves
  triWave: PeriodicWave | null = null;
  sqWave:  PeriodicWave | null = null;

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

    this._buildCustomWaves();
    this._applyAllParams();

    // Init already-registered modules
    for (const [id, mod] of this.registry.modules) {
      FX_DRIVERS[mod.type]?.init(this, id, mod.params);
      if (mod.type === 'osc-noise') this._initNoiseModule(id, mod.params);
    }

    // Transport
    if (!this.transport) {
      this.transport = new Transport(this);
      const transMod = this.registry.getModulesByType('transport')[0];
      if (transMod) applyTransportParam(this, 'bpm', transMod.params.bpm ?? 0.545);
    }

    for (const [id, mod] of this.registry.modules) {
      if (mod.type === 'noteSeq') initSeqCv(this, id);
      if (mod.type === 'drumSeq') initSeqDrum(this, id);
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
    this._triggerAdsrX2Attack(seqId, t, event.velocity);
    // Check if there is a chord module in the note path from this generator
    const chordMod = this._findChordModuleInPath(seqId);
    if (chordMod) {
      this._playChordNote(event.midi, event.velocity, seqId, chordMod);
    } else {
      this.playNote(event.midi, event.velocity, null, seqId);
    }
  }

  private _onNoteOff(event: NoteEvent): void {
    if (!this.ctx) return;
    const seqId = event.generatorId;
    this._triggerAdsrX2Release(seqId, this.ctx.currentTime);
    const chordKey = seqId ? `chord:${seqId}:${event.midi}` : `chord:midi:${event.midi}`;
    const chordVoices = this._chordActiveNotes.get(chordKey);
    if (chordVoices) {
      for (const v of chordVoices) this.stopNote(v.midi, null, v.seqV);
      this._chordActiveNotes.delete(chordKey);
    } else {
      this.stopNote(event.midi, null, seqId);
    }
  }

  private _findChordModuleInPath(seqId: string | null): ModuleInstance | null {
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
        if (toMod.type === 'chord') return toMod;
        const def = getModuleDef(toMod.type);
        if (def?.category !== 'osc') queue.push(p.toId);
      }
    }
    return null;
  }

  private _playChordNote(midi: number, velocity: number, seqId: string | null, chordMod: ModuleInstance): void {
    const offset0  = (chordMod.params['offset-0'] as number) ?? 0;
    const vel0     = (chordMod.params['vel-0']    as number) ?? 1;
    const offset1  = (chordMod.params['offset-1'] as number) ?? 0;
    const vel1     = (chordMod.params['vel-1']    as number) ?? 1;
    const offset2  = (chordMod.params['offset-2'] as number) ?? 0;
    const vel2     = (chordMod.params['vel-2']    as number) ?? 1;
    const mode     = (chordMod.params.mode        as string) ?? 'combined';
    const combined = mode === 'combined';

    // Check which outputs are actually patched
    const out1Patched = this.registry.patchesFromPort(chordMod.id, 'note-out-1').length > 0;
    const out2Patched = this.registry.patchesFromPort(chordMod.id, 'note-out-2').length > 0;
    const out3Patched = this.registry.patchesFromPort(chordMod.id, 'note-out-3').length > 0;

    const midi0 = Math.max(0, Math.min(127, midi + Math.round(offset0)));
    const midi1 = Math.max(0, Math.min(127, midi + Math.round(offset1)));
    const midi2 = Math.max(0, Math.min(127, midi + Math.round(offset2)));
    const vel0Scaled = Math.round(velocity * Math.max(0, Math.min(1, vel0)));
    const vel1Scaled = Math.round(velocity * Math.max(0, Math.min(1, vel1)));
    const vel2Scaled = Math.round(velocity * Math.max(0, Math.min(1, vel2)));

    // Signal note lights in the UI
    const cid = chordMod.id;
    window.dispatchEvent(new CustomEvent('chord-voice-on', { detail: { modId: cid, voice: 0, midi: midi0 } }));
    window.dispatchEvent(new CustomEvent('chord-voice-on', { detail: { modId: cid, voice: 1, midi: midi1 } }));
    window.dispatchEvent(new CustomEvent('chord-voice-on', { detail: { modId: cid, voice: 2, midi: midi2 } }));

    // Synthetic seqIds so each chord voice has its own voice-key namespace.
    // We pre-resolve owned OSC IDs via BFS from each specific chord output port.
    const seqV1 = `${cid}:v1`;
    const seqV2 = `${cid}:v2`;
    const seqV3 = `${cid}:v3`;
    const oscs1 = this._getOwnedOscIds(cid, 'note-out-1');
    const oscs2 = this._getOwnedOscIds(cid, 'note-out-2');
    const oscs3 = this._getOwnedOscIds(cid, 'note-out-3');

    const voiceEntries: Array<{ midi: number; seqV: string }> = [];

    if (combined) {
      // Combined mode: every patched output plays all three chord notes
      const voices: Array<{ oscs: string[]; base: string }> = [];
      if (out1Patched && oscs1.length > 0) voices.push({ oscs: oscs1, base: seqV1 });
      if (out2Patched && oscs2.length > 0) voices.push({ oscs: oscs2, base: seqV2 });
      if (out3Patched && oscs3.length > 0) voices.push({ oscs: oscs3, base: seqV3 });
      for (const { oscs, base } of voices) {
        const k0 = `${base}:r`;  const k1 = `${base}:v2`;  const k2 = `${base}:v3`;
        this.playNote(midi0, vel0Scaled, null, k0, oscs); voiceEntries.push({ midi: midi0, seqV: k0 });
        this.playNote(midi1, vel1Scaled, null, k1, oscs); voiceEntries.push({ midi: midi1, seqV: k1 });
        this.playNote(midi2, vel2Scaled, null, k2, oscs); voiceEntries.push({ midi: midi2, seqV: k2 });
      }
    } else {
      // Split mode: each output fires only its own note
      if (out1Patched && oscs1.length > 0) { this.playNote(midi0, vel0Scaled, null, seqV1, oscs1); voiceEntries.push({ midi: midi0, seqV: seqV1 }); }
      if (out2Patched && oscs2.length > 0) { this.playNote(midi1, vel1Scaled, null, seqV2, oscs2); voiceEntries.push({ midi: midi1, seqV: seqV2 }); }
      if (out3Patched && oscs3.length > 0) { this.playNote(midi2, vel2Scaled, null, seqV3, oscs3); voiceEntries.push({ midi: midi2, seqV: seqV3 }); }
    }

    // Track active notes for note-off matching
    const chordKey = seqId ? `chord:${seqId}:${midi}` : `chord:midi:${midi}`;
    this._chordActiveNotes.set(chordKey, voiceEntries);
  }

  // ── Module lifecycle ─────────────────────────────────────────

  private _onModuleAdded(mod: ModuleInstance): void {
    if (!this.ctx) return;
    const { id, type, params } = mod;
    FX_DRIVERS[type]?.init(this, id, params);
    if (type === 'osc-noise') this._initNoiseModule(id, params);
    if (type === 'noteSeq') initSeqCv(this, id);
    if (type === 'drumSeq') initSeqDrum(this, id);
  }

  private _onModuleRemoved(id: string, type: string): void {
    FX_DRIVERS[type]?.remove(this, id);
    if (type === 'osc-noise') this._removeNoiseModule(id);
    if (type === 'noteSeq' || type === 'drumSeq') {
      if (this.transport) this.transport.unsubscribe(id);
      this.seqPlayheads.delete(id);
      const t = this._seqCvNoteOffTimers.get(id);
      if (t) { clearTimeout(t.timerId); this._seqCvNoteOffTimers.delete(id); }
    }
  }

  private _onPatchChanged(): void {
    if (!this.ctx) return;
    this._syncNoiseRouting();
    for (const driver of Object.values(FX_DRIVERS)) driver?.syncOutput?.(this);
    this._syncAllVoices();
  }

  private _onParamChanged(id: string, param: string, value: unknown): void {
    if (!this.ctx) return;
    const mod = this.registry.modules.get(id);
    if (!mod) return;

    if (FX_DRIVERS[mod.type]) {
      FX_DRIVERS[mod.type]!.updateParam(this, id, param, value);
    } else if (mod.type === 'osc' && param === 'waveform') {
      const wf = value as string;
      for (const voice of this.voices.values()) {
        const vnode = voice.oscNodes.get(id);
        if (!vnode) continue;
        if      (wf === 'sine')     vnode.osc.type = 'sine';
        else if (wf === 'sawtooth') vnode.osc.type = 'sawtooth';
        else if (wf === 'triangle') { if (this.triWave) vnode.osc.setPeriodicWave(this.triWave); else vnode.osc.type = 'triangle'; }
        else if (wf === 'square')   { if (this.sqWave)  vnode.osc.setPeriodicWave(this.sqWave);  else vnode.osc.type = 'square'; }
      }
    } else if (mod.type === 'osc-tri' && param === 'slope') {
      this._buildTriWave(value as number);
      if (this.triWave) for (const voice of this.voices.values()) voice.oscNodes.get(id)?.osc.setPeriodicWave(this.triWave);
    } else if (mod.type === 'osc-sq' && param === 'width') {
      this._buildSqWave(value as number);
      if (this.sqWave) for (const voice of this.voices.values()) voice.oscNodes.get(id)?.osc.setPeriodicWave(this.sqWave);
    } else if (mod.type === 'osc-noise') {
      const nn = this.noiseNodes.get(id);
      if (nn) {
        if (param === 'level') {
          const patched = this.registry.patchesFrom(id).find(p => p.fromPort === 'audio');
          nn.gainNode.gain.value = patched ? (value as number) * 0.2 : 0;
        }
        if (param === 'color') nn.colorFilter.frequency.value = 300 + (value as number) * 19700;
      }
    }

    if (mod.type === 'transport') applyTransportParam(this, param, value);

    if (mod.type === 'osc-sine' && param === 'fold') {
      const curve = this._makeFoldCurve(value as number);
      for (const voice of this.voices.values()) {
        const vnode = voice.oscNodes.get(id);
        if (vnode?.shaper) vnode.shaper.curve = curve;
      }
    } else if (mod.type === 'osc-saw' && param === 'drive') {
      const curve = this._makeDriveCurve(value as number);
      for (const voice of this.voices.values()) {
        const vnode = voice.oscNodes.get(id);
        if (vnode?.shaper) vnode.shaper.curve = curve;
      }
    }

    if (getModuleDef(mod.type)?.category === 'osc' && param === 'level') {
      this._syncVoiceGainsForModule(id);
    }
  }

  // ── Custom periodic waves ────────────────────────────────────

  private _buildCustomWaves(): void {
    if (!this.ctx) return;
    const triMod = this.registry.getModulesByType('osc-tri')[0];
    const sqMod  = this.registry.getModulesByType('osc-sq')[0];
    this._buildTriWave(triMod?.params.slope as number ?? 0.5);
    this._buildSqWave(sqMod?.params.width  as number ?? 0.5);
  }

  private _buildTriWave(slope: number): void {
    if (!this.ctx) return;
    const a = Math.max(0.02, Math.min(0.98, slope)), N = 64;
    const real = new Float32Array(N + 1);
    const imag = new Float32Array(N + 1);
    for (let n = 1; n <= N; n++)
      imag[n] = (2 * Math.sin(n * Math.PI * a)) / (n * n * Math.PI * Math.PI * a * (1 - a));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.triWave = (this.ctx.createPeriodicWave as any)(real, imag);
  }

  private _buildSqWave(duty: number): void {
    if (!this.ctx) return;
    const d = Math.max(0.02, Math.min(0.98, duty)), N = 64;
    const real = new Float32Array(N + 1);
    const imag = new Float32Array(N + 1);
    for (let n = 1; n <= N; n++) imag[n] = (2 / (n * Math.PI)) * Math.sin(n * Math.PI * d);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.sqWave = (this.ctx.createPeriodicWave as any)(real, imag);
  }

  // ── Shaper curves ────────────────────────────────────────────

  private _makeFoldCurve(fold: number): Float32Array<ArrayBuffer> {
    const N = 256, curve = new Float32Array(N) as Float32Array<ArrayBuffer>;
    for (let i = 0; i < N; i++) {
      const x = (i * 2 / (N - 1)) - 1;
      let y = x * (1 + fold * 3.5);
      while (Math.abs(y) > 1) y = Math.sign(y) * 2 - y;
      curve[i] = y;
    }
    return curve;
  }

  private _makeDriveCurve(drive: number): Float32Array<ArrayBuffer> {
    const N = 256, g = 1 + drive * 5, curve = new Float32Array(N) as Float32Array<ArrayBuffer>;
    for (let i = 0; i < N; i++) {
      const x = (i * 2 / (N - 1)) - 1;
      curve[i] = Math.tanh(x * g) / Math.tanh(g);
    }
    return curve;
  }

  // ── Param application ────────────────────────────────────────

  private _applyAllParams(): void {
    for (const [id, mod] of this.registry.modules) {
      if (mod.type === 'fx') {
        const fn = this.fxNodes.get(id);
        if (fn) {
          fn.dryGain.gain.value = (mod.params.dry as number) ?? 1.0;
          fn.wetGain.gain.value = ((mod.params.wet as number) ?? (mod.params.reverb as number) ?? 0.4) * 0.55;
        }
      }
    }
  }

  // ── Sync methods ─────────────────────────────────────────────

  private _syncNoiseRouting(): void {
    for (const [id, nn] of this.noiseNodes) {
      try { nn.gateGain.disconnect(); } catch (_) {}
      const mod = this.registry.modules.get(id);
      const patch = mod ? this.registry.patchesFrom(id).find(p => p.fromPort === 'audio') : null;
      if (patch) {
        const dest = this._getDestNode(patch.toId, patch.toPort);
        nn.gainNode.gain.value = ((mod!.params.level as number) ?? 0.8) * 0.2;
        if (dest) nn.gateGain.connect(dest);
      } else {
        nn.gainNode.gain.value = 0;
      }
    }
  }

  private _initNoiseModule(id: string, params: Record<string, unknown>): void {
    if (!this.ctx || this.noiseNodes.has(id)) return;
    const ctx = this.ctx;
    const nBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const nd = nBuf.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    const bufSrc = ctx.createBufferSource(); bufSrc.buffer = nBuf; bufSrc.loop = true;
    const gainNode    = ctx.createGain();          gainNode.gain.value = 0;
    const colorFilter = ctx.createBiquadFilter();  colorFilter.type = 'lowpass';
    colorFilter.frequency.value = 300 + ((params.color as number) ?? 1) * 19700; colorFilter.Q.value = 0.5;
    const gateGain    = ctx.createGain();          gateGain.gain.value = 0;
    bufSrc.connect(gainNode);
    gainNode.connect(colorFilter);
    colorFilter.connect(gateGain);
    bufSrc.start();
    this.noiseNodes.set(id, { bufSrc, gainNode, colorFilter, gateGain });
  }

  private _removeNoiseModule(id: string): void {
    const nn = this.noiseNodes.get(id);
    if (nn) {
      try { nn.bufSrc.stop(); } catch (_) {}
      [nn.gainNode, nn.colorFilter, nn.gateGain].forEach(n => { try { n.disconnect(); } catch (_) {} });
      this.noiseNodes.delete(id);
    }
  }

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
    if (mod.type === 'audio-out') return this.dryBus;
    if (mod.type === 'adsr-x2') return this.adsrX2Nodes.get(toId)?.inputGain ?? null;
    if (mod.type === 'vcf-x2') {
      const vn = this.vcf2Nodes.get(toId);
      return vn?.inputGain ?? null;
    }
    if (mod.type === 'fx') {
      const fn = this.fxNodes.get(toId);
      return fn?.inputGain ?? null;
    }
    if (mod.type === 'delay') {
      const dn = this.delayNodes.get(toId);
      return dn?.inputGain ?? null;
    }
    if (mod.type === 'mixer') {
      const mn = this.mixerNodes.get(toId);
      if (!mn) return null;
      if (toPort.startsWith('return-')) {
        const i = parseInt(toPort.slice(7));
        return mn.returnGains[i] ?? null;
      }
      if (toPort.startsWith('in-')) {
        const i = parseInt(toPort.slice(3));
        return mn.inputSplitters[i] ?? null;
      }
      return null;
    }
    if (mod.type === 'lfo') return this.lfoNodes.get(toId)?.inputGain ?? null;
    if (mod.type === 'sidechain') {
      const sc = this.sidechainNodes.get(toId);
      if (!sc) return null;
      return toPort === 'return-0' ? sc.keyGain : sc.inputGain;
    }
    return null;
  }

  // ── Per-osc output destination ───────────────────────────────

  private _getOscOutputDest(oscId: string): AudioNode | null {
    const patch = this.registry.patchesFrom(oscId).find(p => p.fromPort === 'audio');
    if (!patch) return null;
    return this._getDestNode(patch.toId, patch.toPort);
  }

  // ── Owned OSC resolution ─────────────────────────────────────

  private _getOwnedOscIds(seqId: string | null, fromPort?: string): string[] {
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
        if (def.category === 'osc' && toMod.type !== 'osc-noise') {
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
    if (patch.toId.startsWith('mixer-')) {
      const mixerMod = this.registry.modules.get(patch.toId);
      const chLevel  = (mixerMod?.params[`level-${patch.toPort}`] as number) ?? 1; // level-in-N
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

    // Compute voice rel as max of default + any adsr-x2 releases in note path
    let rel = sliderToRelease(0.2);
    for (const am of this._getAdsrX2InNotePath(seqId)) {
      rel = Math.max(rel, sliderToRelease((am.params.release as number) ?? 0.2));
    }

    const ownedOscIds = ownedOscIdsOverride ?? this._getOwnedOscIds(seqId);
    const flatEnvIds  = new Set<string>();

    const oscNodes = new Map<string, VoiceNode>();
    const envGains = new Map<string, GainNode>();

    for (const [id, mod] of this.registry.modules) {
      const def = getModuleDef(mod.type);
      if (!def || def.category !== 'osc') continue;
      if (mod.type === 'osc-noise') continue;
      if (!ownedOscIds.includes(id)) continue;

      const patch       = this.registry.patchesFrom(id).find(p => p.fromPort === 'audio');
      const directDest  = patch ? this.registry.modules.get(patch.toId) : null;
      const usesAdsrX2  = directDest?.type === 'adsr-x2';

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
      else if (wf === 'triangle') { if (this.triWave) osc.setPeriodicWave(this.triWave); else osc.type = 'triangle'; }
      else if (wf === 'square')   { if (this.sqWave)  osc.setPeriodicWave(this.sqWave);  else osc.type = 'square'; }
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
        const folder = ctx.createWaveShaper(); folder.curve = this._makeFoldCurve(foldAmt || waveParam);
        osc.connect(folder); folder.connect(gainNode);
        vnode = { osc, gain: gainNode, shaper: folder };
      } else if (driveAmt > 0.01 || (wf === 'sawtooth' && mod.type === 'osc' && waveParam > 0.01)) {
        const driver = ctx.createWaveShaper(); driver.curve = this._makeDriveCurve(driveAmt || waveParam);
        osc.connect(driver); driver.connect(gainNode);
        vnode = { osc, gain: gainNode, shaper: driver };
      } else {
        osc.connect(gainNode);
        vnode = { osc, gain: gainNode };
      }

      // Each osc gets its own envelope gain routed to its own cable destination.
      // If routing directly to adsr-x2, use flat gain (adsr-x2 handles shaping).
      const oscEnvGain = ctx.createGain();
      if (usesAdsrX2) {
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

    for (const nn of this.noiseNodes.values()) nn.gateGain.gain.setTargetAtTime(1, t, 0.008);

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
      for (const nn of this.noiseNodes.values()) nn.gateGain.gain.setTargetAtTime(0, t, 0.06);
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

  // ── Utility ──────────────────────────────────────────────────

  // ── ADSR-X2 triggering ──────────────────────────────────────

  private _getAdsrX2InNotePath(seqId: string | null): import('../types').ModuleInstance[] {
    // Collect generator ids to start BFS from
    let startIds: string[];
    if (seqId !== null) {
      startIds = [seqId];
    } else {
      startIds = [...this.registry.modules.values()]
        .filter(m => m.type === 'midi-all' || m.type === 'midi-in')
        .map(m => m.id);
    }
    const result: import('../types').ModuleInstance[] = [];
    const visited = new Set<string>();
    const queue   = [...startIds];
    while (queue.length) {
      const fromId = queue.shift()!;
      if (visited.has(fromId)) continue;
      visited.add(fromId);
      for (const p of this.registry.patchesFrom(fromId)) {
        if (p.signalType !== 'note') continue;
        const toMod = this.registry.modules.get(p.toId);
        if (!toMod) continue;
        if (toMod.type === 'adsr-x2') result.push(toMod);
        else queue.push(p.toId);
      }
    }
    return result;
  }

  /** BFS over note + audio patches from generator + owned oscs. Returns all module IDs in the signal path. */
  private _getSignalPathModIds(ownedOscIds: string[], seqId: string | null): string[] {
    const visited = new Set<string>();
    const queue: string[] = [];
    if (seqId !== null) {
      queue.push(seqId);
    } else {
      for (const m of this.registry.modules.values()) {
        if (m.type === 'midi-all' || m.type === 'midi-in') queue.push(m.id);
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

  private _triggerAdsrX2Attack(seqId: string | null, t: number, velocity: number): void {
    if (!this.ctx) return;
    const vol = (velocity / 127) * 0.28;
    for (const mod of this._getAdsrX2InNotePath(seqId)) {
      const nodes = this.adsrX2Nodes.get(mod.id);
      if (!nodes) continue;
      nodes.activeVoices++;
      if (nodes.activeVoices === 1) {
        const atk = sliderToAttack((mod.params.attack  as number) ?? 0.02);
        const dec = sliderToDecay ((mod.params.decay   as number) ?? 0.22);
        const sus = (mod.params.sustain as number) ?? 0.55;
        nodes.envGain.gain.cancelScheduledValues(t);
        nodes.envGain.gain.setValueAtTime(0, t);
        nodes.envGain.gain.linearRampToValueAtTime(vol, t + atk);
        nodes.envGain.gain.linearRampToValueAtTime(vol * sus, t + atk + dec);
      }
    }
  }

  private _triggerAdsrX2Release(seqId: string | null, t: number): void {
    if (!this.ctx) return;
    for (const mod of this._getAdsrX2InNotePath(seqId)) {
      const nodes = this.adsrX2Nodes.get(mod.id);
      if (!nodes) continue;
      nodes.activeVoices = Math.max(0, nodes.activeVoices - 1);
      if (nodes.activeVoices === 0) {
        const rel = sliderToRelease((mod.params.release as number) ?? 0.2);
        nodes.envGain.gain.cancelScheduledValues(t);
        nodes.envGain.gain.setValueAtTime(nodes.envGain.gain.value, t);
        nodes.envGain.gain.linearRampToValueAtTime(0, t + rel);
      }
    }
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
