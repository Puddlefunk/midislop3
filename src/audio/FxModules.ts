import type { AudioGraph } from './AudioGraph';
import type { MixerNodes, DelayNodes, LfoNodes, FxNodes, SidechainNodes, VcfX2Nodes, NoiseNodes, AdsrX2Nodes } from './audioTypes';
import { sliderToLfoRate, sliderToDelayTime, sliderToFreq, sliderToAttack, sliderToDecay, sliderToRelease } from '../config/helpers';

// ─────────────────────────────────────────────────────────────
// Module-level node Maps — drivers own their own state.
// AudioGraph never accesses these directly.
// ─────────────────────────────────────────────────────────────

const _mixerNodes     = new Map<string, MixerNodes>();
const _lfoNodes       = new Map<string, LfoNodes>();
const _delayNodes     = new Map<string, DelayNodes>();
const _fxNodes        = new Map<string, FxNodes>();
const _sidechainNodes = new Map<string, SidechainNodes>();
const _vcf2Nodes      = new Map<string, VcfX2Nodes>();
const _noiseNodes     = new Map<string, NoiseNodes>();
const _adsrX2Nodes    = new Map<string, AdsrX2Nodes>();

// ─────────────────────────────────────────────────────────────
// FxDriver interface
// Each instanced FX module type implements these four hooks.
// To add a new FX module: implement init/syncOutput/remove/
// updateParam below, add a single entry to FX_DRIVERS, then
// declare the module type in modules.ts. AudioGraph needs no
// further changes.
// ─────────────────────────────────────────────────────────────

export interface FxDriver {
  init(ag: AudioGraph, id: string, params: Record<string, unknown>): void;
  syncOutput?(ag: AudioGraph): void;
  remove(ag: AudioGraph, id: string): void;
  updateParam(ag: AudioGraph, id: string, param: string, value: unknown): void;
  /** Return the AudioNode that accepts incoming audio on `toPort`, or null. */
  getInputNode?(ag: AudioGraph, id: string, toPort: string): AudioNode | null;
  /** Called when a note-on arrives on this module's note-in port. */
  onNoteOn?(ag: AudioGraph, id: string, midi: number, velocity: number, time: number): void;
  /** Called when a note-off arrives on this module's note-in port. */
  onNoteOff?(ag: AudioGraph, id: string, midi: number, time: number): void;
  /** Return the release time in seconds for voice-lifetime calculation. */
  getRelease?(ag: AudioGraph, id: string): number;
}

// ── Mixer ─────────────────────────────────────────────────────
// Signal flow:
//   in-N → inputSplitters[N] → channelGains[N] (level-in-N)  → preSumGain
//                            → s0ChannelGains[N] (s0-in-N)   → send0Bus → [send-0 patch]
//                            → s1ChannelGains[N] (s1-in-N)   → send1Bus → [send-1 patch]
//   return-0 → returnGains[0] → preSumGain
//   return-1 → returnGains[1] → preSumGain
//   preSumGain → outGain (level) → [audio-0, audio-1 patches]

function initMixer(ag: AudioGraph, id: string, params: Record<string, unknown>): void {
  if (!ag.ctx || _mixerNodes.has(id)) return;
  const ctx = ag.ctx;

  const preSumGain = ctx.createGain(); preSumGain.gain.value = 1;
  const outGain    = ctx.createGain(); outGain.gain.value = (params.level as number) ?? 1;
  preSumGain.connect(outGain);

  const send0Bus = ctx.createGain(); send0Bus.gain.value = 1;
  const send1Bus = ctx.createGain(); send1Bus.gain.value = 1;

  const inputSplitters: GainNode[] = [];
  const channelGains:   GainNode[] = [];
  const s0ChannelGains: GainNode[] = [];
  const s1ChannelGains: GainNode[] = [];

  for (let i = 0; i < 4; i++) {
    const splitter = ctx.createGain(); splitter.gain.value = 1;
    inputSplitters.push(splitter);

    const ch = ctx.createGain(); ch.gain.value = (params[`level-in-${i}`] as number) ?? 1;
    splitter.connect(ch); ch.connect(preSumGain);
    channelGains.push(ch);

    const s0 = ctx.createGain(); s0.gain.value = (params[`s0-in-${i}`] as number) ?? 0;
    splitter.connect(s0); s0.connect(send0Bus);
    s0ChannelGains.push(s0);

    const s1 = ctx.createGain(); s1.gain.value = (params[`s1-in-${i}`] as number) ?? 0;
    splitter.connect(s1); s1.connect(send1Bus);
    s1ChannelGains.push(s1);
  }

  const returnGains: GainNode[] = [];
  for (let i = 0; i < 2; i++) {
    const rg = ctx.createGain(); rg.gain.value = 1;
    rg.connect(preSumGain);
    returnGains.push(rg);
  }

  _mixerNodes.set(id, {
    inputSplitters, channelGains, s0ChannelGains, s1ChannelGains,
    send0Bus, send1Bus, returnGains, preSumGain, outGain,
  });
}

function syncMixerOutput(ag: AudioGraph): void {
  for (const [mixerId, mn] of _mixerNodes) {
    try { mn.outGain.disconnect(); }  catch (_) {}
    try { mn.send0Bus.disconnect(); } catch (_) {}
    try { mn.send1Bus.disconnect(); } catch (_) {}

    for (const port of ['audio-0', 'audio-1']) {
      const p = ag.registry.patchesFrom(mixerId).find(p => p.fromPort === port);
      if (p) { const dest = ag._getDestNode(p.toId, p.toPort); if (dest) mn.outGain.connect(dest); }
    }
    const s0p = ag.registry.patchesFrom(mixerId).find(p => p.fromPort === 'send-0');
    if (s0p) { const dest = ag._getDestNode(s0p.toId, s0p.toPort); if (dest) mn.send0Bus.connect(dest); }
    const s1p = ag.registry.patchesFrom(mixerId).find(p => p.fromPort === 'send-1');
    if (s1p) { const dest = ag._getDestNode(s1p.toId, s1p.toPort); if (dest) mn.send1Bus.connect(dest); }
  }
}

function removeMixer(ag: AudioGraph, id: string): void {
  const n = _mixerNodes.get(id);
  if (n) {
    [...n.inputSplitters, ...n.channelGains, ...n.s0ChannelGains, ...n.s1ChannelGains,
     ...n.returnGains, n.send0Bus, n.send1Bus, n.preSumGain, n.outGain]
      .forEach(g => { try { g.disconnect(); } catch (_) {} });
    _mixerNodes.delete(id);
  }
}

function updateMixerParam(ag: AudioGraph, id: string, param: string, value: unknown): void {
  if (!ag.ctx) return;
  const mn = _mixerNodes.get(id);
  if (!mn) return;
  const t = ag.ctx.currentTime;
  if (param === 'level') {
    mn.outGain.gain.setTargetAtTime(value as number, t, 0.01);
  } else if (param.startsWith('level-in-')) {
    const i = parseInt(param.slice(9));
    mn.channelGains[i]?.gain.setTargetAtTime(value as number, t, 0.01);
  } else if (param.startsWith('s0-in-')) {
    const i = parseInt(param.slice(6));
    mn.s0ChannelGains[i]?.gain.setTargetAtTime(value as number, t, 0.01);
  } else if (param.startsWith('s1-in-')) {
    const i = parseInt(param.slice(6));
    mn.s1ChannelGains[i]?.gain.setTargetAtTime(value as number, t, 0.01);
  }
}

// ── LFO ──────────────────────────────────────────────────────

function initLFO(ag: AudioGraph, id: string, params: Record<string, unknown>): void {
  if (!ag.ctx || _lfoNodes.has(id)) return;
  const ctx        = ag.ctx;
  const depth      = params.depth as number ?? 0.5;
  const inputGain  = ctx.createGain(); inputGain.gain.value = 1;
  const tremoloGain = ctx.createGain(); tremoloGain.gain.value = 1 - depth * 0.5;
  const outputGain  = ctx.createGain(); outputGain.gain.value = 1;
  const lfoOsc      = ctx.createOscillator(); lfoOsc.type = 'sine';
  lfoOsc.frequency.value = sliderToLfoRate(params.rate as number ?? 0.1);
  const lfoDepthGain = ctx.createGain(); lfoDepthGain.gain.value = depth * 0.5;
  lfoOsc.connect(lfoDepthGain);
  lfoDepthGain.connect(tremoloGain.gain);
  inputGain.connect(tremoloGain);
  tremoloGain.connect(outputGain);
  lfoOsc.start();
  _lfoNodes.set(id, { inputGain, lfoOsc, lfoDepthGain, tremoloGain, outputGain });
}

function syncLFOOutput(ag: AudioGraph): void {
  for (const [lfoId, ln] of _lfoNodes) {
    try { ln.outputGain.disconnect(); } catch (_) {}
    const outPatch = ag.registry.patchesFrom(lfoId).find(p => p.fromPort === 'audio');
    if (outPatch) {
      const dest = ag._getDestNode(outPatch.toId, outPatch.toPort);
      if (dest) ln.outputGain.connect(dest);
    }
  }
}

function removeLFO(ag: AudioGraph, id: string): void {
  const n = _lfoNodes.get(id);
  if (n) {
    [n.inputGain, n.lfoDepthGain, n.tremoloGain, n.outputGain].forEach(nd => { try { nd.disconnect(); } catch (_) {} });
    try { n.lfoOsc.stop(); }       catch (_) {}
    try { n.lfoOsc.disconnect(); } catch (_) {}
    _lfoNodes.delete(id);
  }
}

function updateLFOParam(ag: AudioGraph, id: string, param: string, value: unknown): void {
  if (!ag.ctx) return;
  const n = _lfoNodes.get(id);
  if (!n) return;
  if (param === 'rate')  n.lfoOsc.frequency.value = sliderToLfoRate(value as number);
  if (param === 'depth') {
    n.lfoDepthGain.gain.setTargetAtTime((value as number) * 0.5, ag.ctx.currentTime, 0.01);
    n.tremoloGain.gain.setTargetAtTime(1 - (value as number) * 0.5, ag.ctx.currentTime, 0.01);
  }
}

// ── Delay ─────────────────────────────────────────────────────

function initDelay(ag: AudioGraph, id: string, params: Record<string, unknown>): void {
  if (!ag.ctx || _delayNodes.has(id)) return;
  const ctx          = ag.ctx;
  const mix          = params.mix as number ?? 0.5;
  const inputGain    = ctx.createGain();     inputGain.gain.value = 1;
  const delayNode    = ctx.createDelay(2.0); delayNode.delayTime.value = sliderToDelayTime(params.time as number ?? 0.3);
  const feedbackGain = ctx.createGain();     feedbackGain.gain.value = (params.feedback as number ?? 0.3) * 0.9;
  const wetGain      = ctx.createGain();     wetGain.gain.value = mix;
  const dryGain      = ctx.createGain();     dryGain.gain.value = 1 - mix;
  const outGain      = ctx.createGain();     outGain.gain.value = 1;
  inputGain.connect(dryGain);
  inputGain.connect(delayNode);
  delayNode.connect(feedbackGain);
  feedbackGain.connect(delayNode);
  delayNode.connect(wetGain);
  dryGain.connect(outGain);
  wetGain.connect(outGain);
  _delayNodes.set(id, { inputGain, delayNode, feedbackGain, wetGain, dryGain, outGain });
}

function syncDelayOutput(ag: AudioGraph): void {
  for (const [delayId, dn] of _delayNodes) {
    try { dn.outGain.disconnect(); } catch (_) {}
    const outPatch = ag.registry.patchesFrom(delayId).find(p => p.fromPort === 'audio');
    if (outPatch) {
      const dest = ag._getDestNode(outPatch.toId, outPatch.toPort);
      if (dest) dn.outGain.connect(dest);
    }
  }
}

function removeDelay(ag: AudioGraph, id: string): void {
  const dn = _delayNodes.get(id);
  if (dn) {
    [dn.inputGain, dn.delayNode, dn.feedbackGain, dn.wetGain, dn.dryGain, dn.outGain]
      .forEach(n => { try { n.disconnect(); } catch (_) {} });
    _delayNodes.delete(id);
  }
}

function updateDelayParam(ag: AudioGraph, id: string, param: string, value: unknown): void {
  if (!ag.ctx) return;
  const dn = _delayNodes.get(id);
  if (!dn) return;
  if (param === 'time')     dn.delayNode.delayTime.setTargetAtTime(sliderToDelayTime(value as number), ag.ctx.currentTime, 0.02);
  if (param === 'feedback') dn.feedbackGain.gain.setTargetAtTime((value as number) * 0.9, ag.ctx.currentTime, 0.01);
  if (param === 'mix') {
    dn.wetGain.gain.setTargetAtTime(value as number, ag.ctx.currentTime, 0.01);
    dn.dryGain.gain.setTargetAtTime(1 - (value as number), ag.ctx.currentTime, 0.01);
  }
}

// ── Reverb ────────────────────────────────────────────────────
// Per-instance convolver. Signal flow:
//   inputGain → dryGain  → outputGain
//   inputGain → preDelay → convolver → dampFilter → wetGain → outputGain
//   outputGain → [audio patch out]
//
// Size changes are debounced + wet-faded to avoid convolver buffer swap crackle.

function _buildReverbIR(ctx: AudioContext, size: number): AudioBuffer {
  const duration = 0.4 + size * 3.6;
  const len   = Math.floor(ctx.sampleRate * duration);
  const buf   = ctx.createBuffer(2, len, ctx.sampleRate);
  const decay = 2 + size * 6;
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return buf;
}

const _fxSizeTimers = new Map<string, ReturnType<typeof setTimeout>>();

function initFX(ag: AudioGraph, id: string, params: Record<string, unknown>): void {
  if (!ag.ctx || _fxNodes.has(id)) return;
  const ctx  = ag.ctx;
  // Support legacy 'reverb' param name; scale wet by 0.55 to prevent convolver overload
  const wet  = ((params.wet as number) ?? (params.reverb as number) ?? 0.4) * 0.55;
  const dry  = (params.dry  as number) ?? 1.0;
  const size = (params.size as number) ?? 0.5;
  const damp = (params.damp as number) ?? 0.8;
  const pre  = (params.pre  as number) ?? 0.0;

  const inputGain  = ctx.createGain();      inputGain.gain.value = 1;
  const dryGain    = ctx.createGain();      dryGain.gain.value = dry;
  const preDelay   = ctx.createDelay(0.12); preDelay.delayTime.value = pre * 0.1;
  const convolver  = ctx.createConvolver(); convolver.buffer = _buildReverbIR(ctx, size);
  const dampFilter = ctx.createBiquadFilter();
  dampFilter.type = 'lowpass'; dampFilter.frequency.value = 1000 + damp * 19000;
  const wetGain    = ctx.createGain();      wetGain.gain.value = wet;
  const outputGain = ctx.createGain();      outputGain.gain.value = 1;

  inputGain.connect(dryGain);    dryGain.connect(outputGain);
  inputGain.connect(preDelay);   preDelay.connect(convolver);
  convolver.connect(dampFilter); dampFilter.connect(wetGain); wetGain.connect(outputGain);

  _fxNodes.set(id, { inputGain, dryGain, preDelay, convolver, dampFilter, wetGain, outputGain });
}

function syncFXOutput(ag: AudioGraph): void {
  for (const [fxId, fn] of _fxNodes) {
    try { fn.outputGain.disconnect(); } catch (_) {}
    const outPatch = ag.registry.patchesFrom(fxId).find(p => p.fromPort === 'audio');
    if (outPatch) {
      const dest = ag._getDestNode(outPatch.toId, outPatch.toPort);
      if (dest) fn.outputGain.connect(dest);
    }
  }
}

function removeFX(ag: AudioGraph, id: string): void {
  const existing = _fxSizeTimers.get(id);
  if (existing) { clearTimeout(existing); _fxSizeTimers.delete(id); }
  const fn = _fxNodes.get(id);
  if (fn) {
    [fn.inputGain, fn.dryGain, fn.preDelay, fn.convolver, fn.dampFilter, fn.wetGain, fn.outputGain]
      .forEach(n => { try { n.disconnect(); } catch (_) {} });
    _fxNodes.delete(id);
  }
}

function updateFXParam(ag: AudioGraph, id: string, param: string, value: unknown): void {
  if (!ag.ctx) return;
  const fn = _fxNodes.get(id);
  if (!fn) return;
  const t = ag.ctx.currentTime;

  if (param === 'wet') {
    fn.wetGain.gain.setTargetAtTime(value as number, t, 0.01);
    fn.dryGain.gain.setTargetAtTime(1 - (value as number), t, 0.01);
  }
  if (param === 'damp') {
    fn.dampFilter.frequency.setTargetAtTime(1000 + (value as number) * 19000, t, 0.02);
  }
  if (param === 'pre') {
    fn.preDelay.delayTime.setTargetAtTime((value as number) * 0.1, t, 0.02);
  }
  if (param === 'size') {
    // Debounce: wait for user to stop dragging, then fade wet → swap IR → fade back
    const existing = _fxSizeTimers.get(id);
    if (existing) clearTimeout(existing);
    _fxSizeTimers.set(id, setTimeout(() => {
      _fxSizeTimers.delete(id);
      if (!ag.ctx) return;
      const fn2 = _fxNodes.get(id);
      if (!fn2) return;
      const mod = ag.registry.modules.get(id);
      const targetWet = (mod?.params.wet as number) ?? 0.4;
      const ctx = ag.ctx;
      fn2.wetGain.gain.setTargetAtTime(0, ctx.currentTime, 0.025);
      setTimeout(() => {
        if (!ag.ctx) return;
        const fn3 = _fxNodes.get(id);
        if (!fn3) return;
        fn3.convolver.buffer = _buildReverbIR(ag.ctx, value as number);
        fn3.wetGain.gain.setTargetAtTime(targetWet, ag.ctx.currentTime, 0.04);
      }, 90);
    }, 180));
  }
}

// ── Sidechain ────────────────────────────────────────────────

function initSidechain(ag: AudioGraph, id: string, params: Record<string, unknown>): void {
  if (!ag.ctx || _sidechainNodes.has(id)) return;
  const ctx         = ag.ctx;
  const inputGain   = ctx.createGain(); inputGain.gain.value = 1;
  const keyGain     = ctx.createGain(); keyGain.gain.value = 1;
  const rectCurve   = new Float32Array(256);
  for (let i = 0; i < 256; i++) { const x = i * 2 / 255 - 1; rectCurve[i] = Math.abs(x); }
  const rectifier   = ctx.createWaveShaper(); rectifier.curve = rectCurve;
  const smoother    = ctx.createBiquadFilter(); smoother.type = 'lowpass'; smoother.frequency.value = 20;
  const duckerGain  = ctx.createGain(); duckerGain.gain.value = -(params.amount as number ?? 0.7) * 0.95;
  const processGain = ctx.createGain(); processGain.gain.value = 1;
  keyGain.connect(rectifier);
  rectifier.connect(smoother);
  smoother.connect(duckerGain);
  duckerGain.connect(processGain.gain);
  inputGain.connect(processGain);
  const dryGain = ctx.createGain(); dryGain.gain.value = params.dry as number ?? 0;
  const wetGain = ctx.createGain(); wetGain.gain.value = params.wet as number ?? 1;
  const outGain = ctx.createGain(); outGain.gain.value = 1;
  inputGain.connect(dryGain);
  processGain.connect(wetGain);
  dryGain.connect(outGain);
  wetGain.connect(outGain);
  _sidechainNodes.set(id, { inputGain, keyGain, rectifier, smoother, duckerGain, processGain, dryGain, wetGain, outGain });
}

function syncSidechainOutput(ag: AudioGraph): void {
  for (const [scId, sc] of _sidechainNodes) {
    try { sc.outGain.disconnect(); } catch (_) {}
    const outPatch = ag.registry.patchesFrom(scId).find(p => p.fromPort === 'audio');
    if (outPatch) {
      const dest = ag._getDestNode(outPatch.toId, outPatch.toPort);
      if (dest) sc.outGain.connect(dest);
    }
  }
}

function removeSidechain(ag: AudioGraph, id: string): void {
  const sc = _sidechainNodes.get(id);
  if (sc) {
    [sc.inputGain, sc.keyGain, sc.rectifier, sc.smoother, sc.processGain, sc.dryGain, sc.wetGain, sc.outGain]
      .forEach(n => { try { n.disconnect(); } catch (_) {} });
    _sidechainNodes.delete(id);
  }
}

function updateSidechainParam(ag: AudioGraph, id: string, param: string, value: unknown): void {
  if (!ag.ctx) return;
  const sc = _sidechainNodes.get(id);
  if (!sc) return;
  if (param === 'amount') sc.duckerGain.gain.setTargetAtTime(-(value as number) * 0.95, ag.ctx.currentTime, 0.01);
  if (param === 'wet')    sc.wetGain.gain.setTargetAtTime(value as number, ag.ctx.currentTime, 0.01);
  if (param === 'dry')    sc.dryGain.gain.setTargetAtTime(value as number, ag.ctx.currentTime, 0.01);
}

// ── VCF-X2 ────────────────────────────────────────────────────
// Dual cascaded BiquadFilter — routed through FX_DRIVERS, per-instance nodes.

function _vcf2FilterType(v: number): BiquadFilterType {
  return v < 0.33 ? 'lowpass' : v < 0.67 ? 'highpass' : 'bandpass';
}

function initVcfX2(ag: AudioGraph, id: string, params: Record<string, unknown>): void {
  if (!ag.ctx || _vcf2Nodes.has(id)) return;
  const ctx       = ag.ctx;
  const inputGain = ctx.createGain();      inputGain.gain.value = 1;
  const filter1   = ctx.createBiquadFilter();
  const filter2   = ctx.createBiquadFilter();
  const outputGain = ctx.createGain();     outputGain.gain.value = 1;
  const cutoff = sliderToFreq((params.cutoff as number) ?? 0.6);
  const q      = 0.1 + ((params.res as number) ?? 0.2) * 19;
  const ft     = _vcf2FilterType((params.filterType as number) ?? 0);
  [filter1, filter2].forEach(f => { f.type = ft; f.frequency.value = cutoff; f.Q.value = q; });
  inputGain.connect(filter1);
  filter1.connect(filter2);
  filter2.connect(outputGain);
  _vcf2Nodes.set(id, { inputGain, filter1, filter2, outputGain });
}

function syncVcfX2Output(ag: AudioGraph): void {
  for (const [vcfId, vn] of _vcf2Nodes) {
    try { vn.outputGain.disconnect(); } catch (_) {}
    const outPatch = ag.registry.patchesFrom(vcfId).find(p => p.fromPort === 'audio');
    if (outPatch) {
      const dest = ag._getDestNode(outPatch.toId, outPatch.toPort);
      if (dest) vn.outputGain.connect(dest);
    }
  }
}

function removeVcfX2(ag: AudioGraph, id: string): void {
  const vn = _vcf2Nodes.get(id);
  if (vn) {
    [vn.inputGain, vn.filter1, vn.filter2, vn.outputGain].forEach(n => { try { n.disconnect(); } catch (_) {} });
    _vcf2Nodes.delete(id);
  }
}

function updateVcfX2Param(ag: AudioGraph, id: string, param: string, value: unknown): void {
  if (!ag.ctx) return;
  const vn = _vcf2Nodes.get(id);
  if (!vn) return;
  if (param === 'cutoff')     [vn.filter1, vn.filter2].forEach(f => f.frequency.setTargetAtTime(sliderToFreq(value as number), ag.ctx!.currentTime, 0.01));
  if (param === 'res')        [vn.filter1, vn.filter2].forEach(f => f.Q.setTargetAtTime(0.1 + (value as number) * 19, ag.ctx!.currentTime, 0.01));
  if (param === 'filterType') [vn.filter1, vn.filter2].forEach(f => (f.type = _vcf2FilterType(value as number)));
}

// ── ADSR-X2 ───────────────────────────────────────────────────
// Patchable VCA envelope. Audio flows inputGain → envGain → outputGain.
// envGain is automated by note events via AudioGraph._triggerAdsrX2Attack/Release.
// Params are read dynamically at note-on; no live update needed.

function initAdsrX2(ag: AudioGraph, id: string, _params: Record<string, unknown>): void {
  if (!ag.ctx || _adsrX2Nodes.has(id)) return;
  const ctx        = ag.ctx;
  const inputGain  = ctx.createGain(); inputGain.gain.value = 1;
  const envGain    = ctx.createGain(); envGain.gain.value = 0;
  const outputGain = ctx.createGain(); outputGain.gain.value = 1;
  inputGain.connect(envGain);
  envGain.connect(outputGain);
  _adsrX2Nodes.set(id, { inputGain, envGain, outputGain, activeVoices: 0 } as AdsrX2Nodes);
}

function syncAdsrX2Output(ag: AudioGraph): void {
  for (const [id, nodes] of _adsrX2Nodes) {
    try { nodes.outputGain.disconnect(); } catch (_) {}
    const outPatch = ag.registry.patchesFrom(id).find(p => p.fromPort === 'audio');
    if (outPatch) {
      const dest = ag._getDestNode(outPatch.toId, outPatch.toPort);
      if (dest) nodes.outputGain.connect(dest);
    }
  }
}

function removeAdsrX2(ag: AudioGraph, id: string): void {
  const nodes = _adsrX2Nodes.get(id);
  if (nodes) {
    [nodes.inputGain, nodes.envGain, nodes.outputGain].forEach(n => { try { n.disconnect(); } catch (_) {} });
    _adsrX2Nodes.delete(id);
  }
}

function updateAdsrX2Param(_ag: AudioGraph, _id: string, _param: string, _value: unknown): void {
  // Params read dynamically at note events — no live Web Audio update needed
}

// ─────────────────────────────────────────────────────────────
// FX_DRIVERS registry
// Maps module type → driver hooks. AudioGraph dispatches all
// FX module lifecycle and param events through this map.
// To add a new FX module: implement the four hooks above,
// add a single entry here, declare the type in modules.ts.
// ─────────────────────────────────────────────────────────────

// ── Noise (osc-noise) ─────────────────────────────────────────
// Continuous noise source; routing is patch-driven via syncOutput.

function initNoise(ag: AudioGraph, id: string, params: Record<string, unknown>): void {
  if (!ag.ctx || _noiseNodes.has(id)) return;
  const ctx = ag.ctx;
  const nBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const nd = nBuf.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
  const bufSrc      = ctx.createBufferSource(); bufSrc.buffer = nBuf; bufSrc.loop = true;
  const gainNode    = ctx.createGain();         gainNode.gain.value = 0;
  const colorFilter = ctx.createBiquadFilter(); colorFilter.type = 'lowpass';
  colorFilter.frequency.value = 300 + ((params.color as number) ?? 1) * 19700; colorFilter.Q.value = 0.5;
  const gateGain    = ctx.createGain();         gateGain.gain.value = 0;
  bufSrc.connect(gainNode); gainNode.connect(colorFilter); colorFilter.connect(gateGain);
  bufSrc.start();
  _noiseNodes.set(id, { bufSrc, gainNode, colorFilter, gateGain });
}

function syncNoiseOutput(ag: AudioGraph): void {
  for (const [id, nn] of _noiseNodes) {
    try { nn.gateGain.disconnect(); } catch (_) {}
    const mod   = ag.registry.modules.get(id);
    const patch = mod ? ag.registry.patchesFrom(id).find(p => p.fromPort === 'audio') : null;
    if (patch) {
      const dest = ag._getDestNode(patch.toId, patch.toPort);
      nn.gainNode.gain.value = ((mod!.params.level as number) ?? 0.8) * 0.2;
      if (dest) nn.gateGain.connect(dest);
    } else {
      nn.gainNode.gain.value = 0;
    }
  }
}

function removeNoise(ag: AudioGraph, id: string): void {
  const nn = _noiseNodes.get(id);
  if (nn) {
    try { nn.bufSrc.stop(); } catch (_) {}
    [nn.gainNode, nn.colorFilter, nn.gateGain].forEach(n => { try { n.disconnect(); } catch (_) {} });
    _noiseNodes.delete(id);
  }
}

function updateNoiseParam(ag: AudioGraph, id: string, param: string, value: unknown): void {
  const nn = _noiseNodes.get(id);
  if (!nn) return;
  if (param === 'level') {
    const patched = ag.registry.patchesFrom(id).find(p => p.fromPort === 'audio');
    nn.gainNode.gain.value = patched ? (value as number) * 0.2 : 0;
  }
  if (param === 'color') nn.colorFilter.frequency.value = 300 + (value as number) * 19700;
}

// ─────────────────────────────────────────────────────────────
// FX_DRIVERS registry
// Maps module type → driver hooks. AudioGraph dispatches all
// FX module lifecycle and param events through this map.
// To add a new FX module: implement the four hooks above,
// add a single entry here, declare the type in modules.ts.
// ─────────────────────────────────────────────────────────────

export const FX_DRIVERS: Partial<Record<string, FxDriver>> = {
  mixer: {
    init:         initMixer,
    syncOutput:   syncMixerOutput,
    remove:       removeMixer,
    updateParam:  updateMixerParam,
    getInputNode: (ag, id, toPort) => {
      const mn = _mixerNodes.get(id);
      if (!mn) return null;
      if (toPort.startsWith('return-')) return mn.returnGains[parseInt(toPort.slice(7))] ?? null;
      if (toPort.startsWith('in-'))     return mn.inputSplitters[parseInt(toPort.slice(3))] ?? null;
      return null;
    },
  },
  lfo: {
    init:         initLFO,
    syncOutput:   syncLFOOutput,
    remove:       removeLFO,
    updateParam:  updateLFOParam,
    getInputNode: (ag, id) => _lfoNodes.get(id)?.inputGain ?? null,
  },
  delay: {
    init:         initDelay,
    syncOutput:   syncDelayOutput,
    remove:       removeDelay,
    updateParam:  updateDelayParam,
    getInputNode: (ag, id) => _delayNodes.get(id)?.inputGain ?? null,
  },
  fx: {
    init:         initFX,
    syncOutput:   syncFXOutput,
    remove:       removeFX,
    updateParam:  updateFXParam,
    getInputNode: (ag, id) => _fxNodes.get(id)?.inputGain ?? null,
  },
  'vcf-x2': {
    init:         initVcfX2,
    syncOutput:   syncVcfX2Output,
    remove:       removeVcfX2,
    updateParam:  updateVcfX2Param,
    getInputNode: (ag, id) => _vcf2Nodes.get(id)?.inputGain ?? null,
  },
  sidechain: {
    init:         initSidechain,
    syncOutput:   syncSidechainOutput,
    remove:       removeSidechain,
    updateParam:  updateSidechainParam,
    getInputNode: (ag, id, toPort) => {
      const sc = _sidechainNodes.get(id);
      if (!sc) return null;
      return toPort === 'return-0' ? sc.keyGain : sc.inputGain;
    },
  },
  'adsr-x2': {
    init:         initAdsrX2,
    syncOutput:   syncAdsrX2Output,
    remove:       removeAdsrX2,
    updateParam:  updateAdsrX2Param,
    getInputNode: (_ag, id) => _adsrX2Nodes.get(id)?.inputGain ?? null,
    onNoteOn(ag, id, _midi, velocity, time) {
      if (!ag.ctx) return;
      const mod   = ag.registry.modules.get(id);
      const nodes = _adsrX2Nodes.get(id);
      if (!nodes || !mod) return;
      const vol = (velocity / 127) * 0.28;
      nodes.activeVoices++;
      if (nodes.activeVoices === 1) {
        const atk = sliderToAttack((mod.params.attack  as number) ?? 0.02);
        const dec = sliderToDecay ((mod.params.decay   as number) ?? 0.22);
        const sus = (mod.params.sustain as number) ?? 0.55;
        nodes.envGain.gain.cancelScheduledValues(time);
        nodes.envGain.gain.setValueAtTime(0, time);
        nodes.envGain.gain.linearRampToValueAtTime(vol, time + atk);
        nodes.envGain.gain.linearRampToValueAtTime(vol * sus, time + atk + dec);
      }
    },
    onNoteOff(ag, id, _midi, time) {
      if (!ag.ctx) return;
      const mod   = ag.registry.modules.get(id);
      const nodes = _adsrX2Nodes.get(id);
      if (!nodes || !mod) return;
      nodes.activeVoices = Math.max(0, nodes.activeVoices - 1);
      if (nodes.activeVoices === 0) {
        const rel = sliderToRelease((mod.params.release as number) ?? 0.2);
        nodes.envGain.gain.cancelScheduledValues(time);
        nodes.envGain.gain.setValueAtTime(nodes.envGain.gain.value, time);
        nodes.envGain.gain.linearRampToValueAtTime(0, time + rel);
      }
    },
    getRelease(ag, id) {
      const mod = ag.registry.modules.get(id);
      return sliderToRelease((mod?.params.release as number) ?? 0.2);
    },
  },
  'osc-noise': {
    init:        initNoise,
    syncOutput:  syncNoiseOutput,
    remove:      removeNoise,
    updateParam: updateNoiseParam,
    // noise is a source, not a destination — no getInputNode
  },
  'audio-out': {
    init:         () => {},
    remove:       () => {},
    updateParam:  () => {},
    getInputNode: (ag) => ag.dryBus,
  },
};

// ─────────────────────────────────────────────────────────────
// Noise gate helpers — called from AudioGraph on note events
// ─────────────────────────────────────────────────────────────

export function openNoiseGates(t: number): void {
  for (const nn of _noiseNodes.values()) nn.gateGain.gain.setTargetAtTime(1, t, 0.008);
}

export function closeNoiseGates(t: number): void {
  for (const nn of _noiseNodes.values()) nn.gateGain.gain.setTargetAtTime(0, t, 0.06);
}

