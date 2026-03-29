import type { AudioGraph } from './AudioGraph';
import type { AdsrX2Nodes } from './audioTypes';
import { sliderToLfoRate, sliderToDelayTime, sliderToFreq } from '../config/helpers';

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
  if (!ag.ctx || ag.mixerNodes.has(id)) return;
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

  ag.mixerNodes.set(id, {
    inputSplitters, channelGains, s0ChannelGains, s1ChannelGains,
    send0Bus, send1Bus, returnGains, preSumGain, outGain,
  });
}

function syncMixerOutput(ag: AudioGraph): void {
  for (const [mixerId, mn] of ag.mixerNodes) {
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
  const n = ag.mixerNodes.get(id);
  if (n) {
    [...n.inputSplitters, ...n.channelGains, ...n.s0ChannelGains, ...n.s1ChannelGains,
     ...n.returnGains, n.send0Bus, n.send1Bus, n.preSumGain, n.outGain]
      .forEach(g => { try { g.disconnect(); } catch (_) {} });
    ag.mixerNodes.delete(id);
  }
}

function updateMixerParam(ag: AudioGraph, id: string, param: string, value: unknown): void {
  if (!ag.ctx) return;
  const mn = ag.mixerNodes.get(id);
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
  if (!ag.ctx || ag.lfoNodes.has(id)) return;
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
  ag.lfoNodes.set(id, { inputGain, lfoOsc, lfoDepthGain, tremoloGain, outputGain });
}

function syncLFOOutput(ag: AudioGraph): void {
  for (const [lfoId, ln] of ag.lfoNodes) {
    try { ln.outputGain.disconnect(); } catch (_) {}
    const outPatch = ag.registry.patchesFrom(lfoId).find(p => p.fromPort === 'audio');
    if (outPatch) {
      const dest = ag._getDestNode(outPatch.toId, outPatch.toPort);
      if (dest) ln.outputGain.connect(dest);
    }
  }
}

function removeLFO(ag: AudioGraph, id: string): void {
  const n = ag.lfoNodes.get(id);
  if (n) {
    [n.inputGain, n.lfoDepthGain, n.tremoloGain, n.outputGain].forEach(nd => { try { nd.disconnect(); } catch (_) {} });
    try { n.lfoOsc.stop(); }       catch (_) {}
    try { n.lfoOsc.disconnect(); } catch (_) {}
    ag.lfoNodes.delete(id);
  }
}

function updateLFOParam(ag: AudioGraph, id: string, param: string, value: unknown): void {
  if (!ag.ctx) return;
  const n = ag.lfoNodes.get(id);
  if (!n) return;
  if (param === 'rate')  n.lfoOsc.frequency.value = sliderToLfoRate(value as number);
  if (param === 'depth') {
    n.lfoDepthGain.gain.setTargetAtTime((value as number) * 0.5, ag.ctx.currentTime, 0.01);
    n.tremoloGain.gain.setTargetAtTime(1 - (value as number) * 0.5, ag.ctx.currentTime, 0.01);
  }
}

// ── Delay ─────────────────────────────────────────────────────

function initDelay(ag: AudioGraph, id: string, params: Record<string, unknown>): void {
  if (!ag.ctx || ag.delayNodes.has(id)) return;
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
  ag.delayNodes.set(id, { inputGain, delayNode, feedbackGain, wetGain, dryGain, outGain });
}

function syncDelayOutput(ag: AudioGraph): void {
  for (const [delayId, dn] of ag.delayNodes) {
    try { dn.outGain.disconnect(); } catch (_) {}
    const outPatch = ag.registry.patchesFrom(delayId).find(p => p.fromPort === 'audio');
    if (outPatch) {
      const dest = ag._getDestNode(outPatch.toId, outPatch.toPort);
      if (dest) dn.outGain.connect(dest);
    }
  }
}

function removeDelay(ag: AudioGraph, id: string): void {
  const dn = ag.delayNodes.get(id);
  if (dn) {
    [dn.inputGain, dn.delayNode, dn.feedbackGain, dn.wetGain, dn.dryGain, dn.outGain]
      .forEach(n => { try { n.disconnect(); } catch (_) {} });
    ag.delayNodes.delete(id);
  }
}

function updateDelayParam(ag: AudioGraph, id: string, param: string, value: unknown): void {
  if (!ag.ctx) return;
  const dn = ag.delayNodes.get(id);
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
  if (!ag.ctx || ag.fxNodes.has(id)) return;
  const ctx  = ag.ctx;
  const wet  = (params.wet  as number) ?? 0.4;
  const size = (params.size as number) ?? 0.5;
  const damp = (params.damp as number) ?? 0.8;
  const pre  = (params.pre  as number) ?? 0.0;

  const inputGain  = ctx.createGain();      inputGain.gain.value = 1;
  const dryGain    = ctx.createGain();      dryGain.gain.value = 1 - wet;
  const preDelay   = ctx.createDelay(0.12); preDelay.delayTime.value = pre * 0.1;
  const convolver  = ctx.createConvolver(); convolver.buffer = _buildReverbIR(ctx, size);
  const dampFilter = ctx.createBiquadFilter();
  dampFilter.type = 'lowpass'; dampFilter.frequency.value = 1000 + damp * 19000;
  const wetGain    = ctx.createGain();      wetGain.gain.value = wet;
  const outputGain = ctx.createGain();      outputGain.gain.value = 1;

  inputGain.connect(dryGain);    dryGain.connect(outputGain);
  inputGain.connect(preDelay);   preDelay.connect(convolver);
  convolver.connect(dampFilter); dampFilter.connect(wetGain); wetGain.connect(outputGain);

  ag.fxNodes.set(id, { inputGain, dryGain, preDelay, convolver, dampFilter, wetGain, outputGain });
}

function syncFXOutput(ag: AudioGraph): void {
  for (const [fxId, fn] of ag.fxNodes) {
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
  const fn = ag.fxNodes.get(id);
  if (fn) {
    [fn.inputGain, fn.dryGain, fn.preDelay, fn.convolver, fn.dampFilter, fn.wetGain, fn.outputGain]
      .forEach(n => { try { n.disconnect(); } catch (_) {} });
    ag.fxNodes.delete(id);
  }
}

function updateFXParam(ag: AudioGraph, id: string, param: string, value: unknown): void {
  if (!ag.ctx) return;
  const fn = ag.fxNodes.get(id);
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
      const fn2 = ag.fxNodes.get(id);
      if (!fn2) return;
      const mod = ag.registry.modules.get(id);
      const targetWet = (mod?.params.wet as number) ?? 0.4;
      const ctx = ag.ctx;
      fn2.wetGain.gain.setTargetAtTime(0, ctx.currentTime, 0.025);
      setTimeout(() => {
        if (!ag.ctx) return;
        const fn3 = ag.fxNodes.get(id);
        if (!fn3) return;
        fn3.convolver.buffer = _buildReverbIR(ag.ctx, value as number);
        fn3.wetGain.gain.setTargetAtTime(targetWet, ag.ctx.currentTime, 0.04);
      }, 90);
    }, 180));
  }
}

// ── Sidechain ────────────────────────────────────────────────

function initSidechain(ag: AudioGraph, id: string, params: Record<string, unknown>): void {
  if (!ag.ctx || ag.sidechainNodes.has(id)) return;
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
  ag.sidechainNodes.set(id, { inputGain, keyGain, rectifier, smoother, duckerGain, processGain, dryGain, wetGain, outGain });
}

function syncSidechainOutput(ag: AudioGraph): void {
  for (const [scId, sc] of ag.sidechainNodes) {
    try { sc.outGain.disconnect(); } catch (_) {}
    const outPatch = ag.registry.patchesFrom(scId).find(p => p.fromPort === 'audio');
    if (outPatch) {
      const dest = ag._getDestNode(outPatch.toId, outPatch.toPort);
      if (dest) sc.outGain.connect(dest);
    }
  }
}

function removeSidechain(ag: AudioGraph, id: string): void {
  const sc = ag.sidechainNodes.get(id);
  if (sc) {
    [sc.inputGain, sc.keyGain, sc.rectifier, sc.smoother, sc.processGain, sc.dryGain, sc.wetGain, sc.outGain]
      .forEach(n => { try { n.disconnect(); } catch (_) {} });
    ag.sidechainNodes.delete(id);
  }
}

function updateSidechainParam(ag: AudioGraph, id: string, param: string, value: unknown): void {
  if (!ag.ctx) return;
  const sc = ag.sidechainNodes.get(id);
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
  if (!ag.ctx || ag.vcf2Nodes.has(id)) return;
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
  ag.vcf2Nodes.set(id, { inputGain, filter1, filter2, outputGain });
}

function syncVcfX2Output(ag: AudioGraph): void {
  for (const [vcfId, vn] of ag.vcf2Nodes) {
    try { vn.outputGain.disconnect(); } catch (_) {}
    const outPatch = ag.registry.patchesFrom(vcfId).find(p => p.fromPort === 'audio');
    if (outPatch) {
      const dest = ag._getDestNode(outPatch.toId, outPatch.toPort);
      if (dest) vn.outputGain.connect(dest);
    }
  }
}

function removeVcfX2(ag: AudioGraph, id: string): void {
  const vn = ag.vcf2Nodes.get(id);
  if (vn) {
    [vn.inputGain, vn.filter1, vn.filter2, vn.outputGain].forEach(n => { try { n.disconnect(); } catch (_) {} });
    ag.vcf2Nodes.delete(id);
  }
}

function updateVcfX2Param(ag: AudioGraph, id: string, param: string, value: unknown): void {
  if (!ag.ctx) return;
  const vn = ag.vcf2Nodes.get(id);
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
  if (!ag.ctx || ag.adsrX2Nodes.has(id)) return;
  const ctx        = ag.ctx;
  const inputGain  = ctx.createGain(); inputGain.gain.value = 1;
  const envGain    = ctx.createGain(); envGain.gain.value = 0;
  const outputGain = ctx.createGain(); outputGain.gain.value = 1;
  inputGain.connect(envGain);
  envGain.connect(outputGain);
  ag.adsrX2Nodes.set(id, { inputGain, envGain, outputGain, activeVoices: 0 } as AdsrX2Nodes);
}

function syncAdsrX2Output(ag: AudioGraph): void {
  for (const [id, nodes] of ag.adsrX2Nodes) {
    try { nodes.outputGain.disconnect(); } catch (_) {}
    const outPatch = ag.registry.patchesFrom(id).find(p => p.fromPort === 'audio');
    if (outPatch) {
      const dest = ag._getDestNode(outPatch.toId, outPatch.toPort);
      if (dest) nodes.outputGain.connect(dest);
    }
  }
}

function removeAdsrX2(ag: AudioGraph, id: string): void {
  const nodes = ag.adsrX2Nodes.get(id);
  if (nodes) {
    [nodes.inputGain, nodes.envGain, nodes.outputGain].forEach(n => { try { n.disconnect(); } catch (_) {} });
    ag.adsrX2Nodes.delete(id);
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

export const FX_DRIVERS: Partial<Record<string, FxDriver>> = {
  mixer: {
    init:        initMixer,
    syncOutput:  syncMixerOutput,
    remove:      removeMixer,
    updateParam: updateMixerParam,
  },
  lfo: {
    init:        initLFO,
    syncOutput:  syncLFOOutput,
    remove:      removeLFO,
    updateParam: updateLFOParam,
  },
  delay: {
    init:        initDelay,
    syncOutput:  syncDelayOutput,
    remove:      removeDelay,
    updateParam: updateDelayParam,
  },
  fx: {
    init:        initFX,
    syncOutput:  syncFXOutput,
    remove:      removeFX,
    updateParam: updateFXParam,
  },
  'vcf-x2': {
    init:        initVcfX2,
    syncOutput:  syncVcfX2Output,
    remove:      removeVcfX2,
    updateParam: updateVcfX2Param,
  },
  sidechain: {
    init:        initSidechain,
    syncOutput:  syncSidechainOutput,
    remove:      removeSidechain,
    updateParam: updateSidechainParam,
  },
  'adsr-x2': {
    init:        initAdsrX2,
    syncOutput:  syncAdsrX2Output,
    remove:      removeAdsrX2,
    updateParam: updateAdsrX2Param,
  },
};
