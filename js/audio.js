'use strict';

/* Synthesised chip-style SFX. Nothing loads from disk: every sound is a
   square wave and/or a burst of noise, the way an 8-bit sound chip did it. */
const Sfx = {
  ctx: null,
  master: null,
  noiseBuf: null,
  muted: false,

  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);

    // one second of white noise, reused by every noise-based sound
    const len = Math.floor(this.ctx.sampleRate);
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  },

  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.5;
    return !this.muted;
  },

  // a pitched blip
  tone(type, f0, f1, dur, vol, delay) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime + (delay || 0);
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  },

  // a burst of filtered noise
  noise(dur, vol, filtType, f0, f1, delay) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime + (delay || 0);
    const s = this.ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    s.loop = true;
    const bp = this.ctx.createBiquadFilter();
    bp.type = filtType;
    bp.frequency.setValueAtTime(f0, t);
    bp.frequency.exponentialRampToValueAtTime(Math.max(60, f1), t + dur);
    bp.Q.value = 1.2;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    s.connect(bp); bp.connect(g); g.connect(this.master);
    s.start(t); s.stop(t + dur + 0.02);
  },

  /* ---- the actual game sounds ---- */

  whoosh(heavy) {            // a punch being thrown
    this.noise(heavy ? 0.16 : 0.10, heavy ? 0.16 : 0.10, 'bandpass', 1100, 260);
  },

  hitHead(power) {           // clean head shot: deep thud + crack
    const p = power || 1;
    this.tone('square', 200 * p, 55, 0.14, 0.30);
    this.tone('triangle', 120, 40, 0.20, 0.22);
    this.noise(0.09, 0.26, 'lowpass', 2600, 400);
  },

  hitBody(power) {           // body shot: lower, duller
    const p = power || 1;
    this.tone('sine', 130 * p, 38, 0.20, 0.34);
    this.noise(0.12, 0.16, 'lowpass', 900, 180);
  },

  block() {                  // leather on leather
    this.tone('square', 760, 420, 0.05, 0.16);
    this.noise(0.07, 0.20, 'highpass', 2400, 1200);
  },

  slip() {                   // punch ducked / slipped
    this.noise(0.13, 0.09, 'lowpass', 700, 220);
  },

  step() {
    this.noise(0.04, 0.045, 'lowpass', 500, 200);
  },

  tired() {                  // tried to throw with nothing left in the tank
    this.tone('square', 210, 90, 0.10, 0.10);
  },

  ko() {                     // a boxer hits the canvas
    this.tone('square', 300, 46, 0.55, 0.30);
    this.tone('triangle', 150, 34, 0.75, 0.26);
    this.noise(0.35, 0.20, 'lowpass', 1200, 140);
  },

  bell() {                   // round bell on reset
    this.tone('square', 1180, 1180, 0.5, 0.16);
    this.tone('square', 1570, 1560, 0.5, 0.10, 0.01);
    this.tone('square', 1180, 1170, 0.5, 0.12, 0.28);
  },
};
