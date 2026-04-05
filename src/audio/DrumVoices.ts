import type { AudioGraph } from './AudioGraph';
import { sliderToDrumDecay, sliderToKickFreq } from '../config/helpers';

// ─────────────────────────────────────────────────────────────
// Shared drum helpers
// ─────────────────────────────────────────────────────────────

export function getDrumOutputDest(ag: AudioGraph, voiceId: string): AudioNode | null {
  const patch = ag.registry.patchesFrom(voiceId).find(p => p.fromPort === 'audio');
  if (!patch) return null;
  return ag._getDestNode(patch.toId, patch.toPort) ?? null;
}

export function getDrumNoiseBuffer(ag: AudioGraph, voiceId: string): AudioBuffer {
  if (ag.drumNoiseBuffers.has(voiceId)) return ag.drumNoiseBuffers.get(voiceId)!;
  const len = Math.floor(ag.ctx!.sampleRate * 0.5);
  const buf = ag.ctx!.createBuffer(1, len, ag.ctx!.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  ag.drumNoiseBuffers.set(voiceId, buf);
  return buf;
}

export function getKickClickBuffer(ag: AudioGraph): AudioBuffer | null {
  if (ag._kickClickBuf) return ag._kickClickBuf;
  if (!ag.ctx) return null;
  const len = Math.floor(ag.ctx.sampleRate * 0.01);
  const buf = ag.ctx.createBuffer(1, len, ag.ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  ag._kickClickBuf = buf;
  return buf;
}

// ─────────────────────────────────────────────────────────────
// Drum voice fire functions
// ─────────────────────────────────────────────────────────────

export function fireHat(ag: AudioGraph, voiceId: string, vel: number, time: number): void {
  const ctx = ag.ctx!;
  const mod = ag.registry.modules.get(voiceId);
  if (!mod) return;
  const atk   = sliderToDrumDecay(((mod.params.attack as number) ?? 0.28) * 0.1);
  const decay = sliderToDrumDecay((mod.params.decay  as number) ?? 0.55);
  const vol   = (vel / 127) * ((mod.params.level as number) ?? 0.7) * 0.4;
  const buf   = getDrumNoiseBuffer(ag, voiceId);
  const src   = ctx.createBufferSource(); src.buffer = buf;
  const hpf   = ctx.createBiquadFilter(); hpf.type = 'highpass'; hpf.frequency.value = 8000;
  const gain  = ctx.createGain();
  gain.gain.setValueAtTime(0, time);
  gain.gain.linearRampToValueAtTime(vol, time + atk);
  gain.gain.exponentialRampToValueAtTime(0.001, time + decay);
  src.connect(hpf); hpf.connect(gain);
  const dest = getDrumOutputDest(ag, voiceId);
  if (dest) gain.connect(dest);
  src.start(time); src.stop(time + decay + 0.05);
}

export function fireKick(ag: AudioGraph, voiceId: string, vel: number, time: number): void {
  const ctx   = ag.ctx!;
  const mod   = ag.registry.modules.get(voiceId);
  if (!mod) return;
  const decay     = sliderToDrumDecay((mod.params.decay as number) ?? 0.55);
  const startFreq = sliderToKickFreq((mod.params.freq  as number) ?? 0.3);
  const vol       = (vel / 127) * ((mod.params.punch as number) ?? 0.8) * 0.8;
  const dest      = getDrumOutputDest(ag, voiceId);

  const osc = ctx.createOscillator(); osc.type = 'sine';
  osc.frequency.setValueAtTime(startFreq, time);
  osc.frequency.exponentialRampToValueAtTime(30, time + decay * 0.7);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(vol, time);
  gain.gain.exponentialRampToValueAtTime(0.001, time + decay);
  osc.connect(gain);
  if (dest) gain.connect(dest);
  osc.start(time); osc.stop(time + decay + 0.05);

  const clickBuf = getKickClickBuffer(ag);
  if (clickBuf) {
    const clickSrc  = ctx.createBufferSource(); clickSrc.buffer = clickBuf;
    const clickGain = ctx.createGain(); clickGain.gain.value = vol * 0.8;
    clickSrc.connect(clickGain);
    if (dest) clickGain.connect(dest);
    clickSrc.start(time); clickSrc.stop(time + 0.05);
  }
}

export function fireSnare(ag: AudioGraph, voiceId: string, vel: number, time: number): void {
  const ctx = ag.ctx!;
  const mod = ag.registry.modules.get(voiceId);
  if (!mod) return;
  const decay    = sliderToDrumDecay((mod.params.decay as number) ?? 0.4);
  const snapAmt  = (mod.params.snap  as number) ?? 0.5;
  const toneFreq = 100 + ((mod.params.tone as number) ?? 0.3) * 200;
  const vol      = (vel / 127) * ((mod.params.level as number) ?? 0.7) * 0.6;
  const dest     = getDrumOutputDest(ag, voiceId);

  const noiseSrc  = ctx.createBufferSource(); noiseSrc.buffer = getDrumNoiseBuffer(ag, voiceId);
  const bpf       = ctx.createBiquadFilter(); bpf.type = 'bandpass'; bpf.frequency.value = 1500; bpf.Q.value = 0.8;
  const noiseGain = ctx.createGain();
  const noiseDec  = decay * (0.5 + snapAmt * 0.5);
  noiseGain.gain.setValueAtTime(vol * (0.4 + snapAmt * 0.4), time);
  noiseGain.gain.exponentialRampToValueAtTime(0.001, time + noiseDec);
  noiseSrc.connect(bpf); bpf.connect(noiseGain);

  const osc      = ctx.createOscillator(); osc.type = 'triangle'; osc.frequency.value = toneFreq;
  const toneGain = ctx.createGain();
  toneGain.gain.setValueAtTime(vol * (0.6 - snapAmt * 0.3), time);
  toneGain.gain.exponentialRampToValueAtTime(0.001, time + decay * 0.5);
  osc.connect(toneGain);

  if (dest) { noiseGain.connect(dest); toneGain.connect(dest); }
  noiseSrc.start(time); noiseSrc.stop(time + noiseDec + 0.05);
  osc.start(time); osc.stop(time + decay * 0.5 + 0.05);
}

// ─────────────────────────────────────────────────────────────
// DRUM_DRIVERS registry
// To add a new drum voice: implement a fire function above,
// add an entry here, declare the type in modules.ts.
// ─────────────────────────────────────────────────────────────

export const DRUM_DRIVERS: Partial<Record<string,
  (ag: AudioGraph, voiceId: string, vel: number, time: number) => void
>> = {
  'drum-hat':   fireHat,
  'drum-kick':  fireKick,
  'drum-snare': fireSnare,
};
