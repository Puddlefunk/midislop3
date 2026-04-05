// ─────────────────────────────────────────────────────────────
// Shared Web Audio node-group interfaces used across audio/ files.
// ─────────────────────────────────────────────────────────────

export interface VoiceNode {
  osc:     OscillatorNode;
  gain:    GainNode;
  shaper?: WaveShaperNode;
}

export interface Voice {
  oscNodes:     Map<string, VoiceNode>;
  envGains:     Map<string, GainNode>;   // per-osc — each follows its own audio cable
  rel:          number;
  sustainLevel: number;
  ownedOscIds:  string[];
  flatEnvIds:   Set<string>;             // osc ids whose envGain is flat (adsr-x2 handles envelope)
  noteCtx:      { midi: number; velocity: number };
  litModIds:    string[];                // module ids lit up for this voice (cleared on note-off)
}

export interface NoiseNodes {
  bufSrc:      AudioBufferSourceNode;
  gainNode:    GainNode;
  colorFilter: BiquadFilterNode;
  gateGain:    GainNode;
}

export interface AdsrX2Nodes {
  inputGain:    GainNode;
  envGain:      GainNode;
  outputGain:   GainNode;
  activeVoices: number;
}

export interface MixerNodes {
  // index matches channel number (0-3)
  inputSplitters: GainNode[];   // source connects here; fans out to ch gain + both send gains
  channelGains:   GainNode[];   // post-fader level → preSumGain
  s0ChannelGains: GainNode[];   // per-channel send-0 amount → send0Bus
  s1ChannelGains: GainNode[];   // per-channel send-1 amount → send1Bus
  send0Bus:       GainNode;     // sum of s0 per-channel → send-0 output patch
  send1Bus:       GainNode;     // sum of s1 per-channel → send-1 output patch
  returnGains:    GainNode[];   // [2]: return-0, return-1 → preSumGain
  preSumGain:     GainNode;     // channels + returns → outGain
  outGain:        GainNode;     // master level → audio-0 + audio-1 output patches
}

export interface DelayNodes {
  inputGain:    GainNode;
  delayNode:    DelayNode;
  feedbackGain: GainNode;
  wetGain:      GainNode;
  dryGain:      GainNode;
  outGain:      GainNode;
}

export interface LfoNodes {
  inputGain:    GainNode;
  lfoOsc:       OscillatorNode;
  lfoDepthGain: GainNode;
  tremoloGain:  GainNode;
  outputGain:   GainNode;
}

export interface VibratoNodes {
  lfoOsc:    OscillatorNode;
  depthGain: GainNode;
}

export interface FxNodes {
  inputGain:   GainNode;
  dryGain:     GainNode;
  preDelay:    DelayNode;
  convolver:   ConvolverNode;
  dampFilter:  BiquadFilterNode;
  wetGain:     GainNode;
  outputGain:  GainNode;
}

export interface VcfX2Nodes {
  inputGain:  GainNode;
  filter1:    BiquadFilterNode;
  filter2:    BiquadFilterNode;
  outputGain: GainNode;
}

export interface SidechainNodes {
  inputGain:   GainNode;
  keyGain:     GainNode;
  rectifier:   WaveShaperNode;
  smoother:    BiquadFilterNode;
  duckerGain:  GainNode;
  processGain: GainNode;
  dryGain:     GainNode;
  wetGain:     GainNode;
  outGain:     GainNode;
}
