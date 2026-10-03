// Tiny synthesized sound effects with the Web Audio API: no sound files needed.
export class Audio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.volume = 0.6;
    this.listener = { x: 0, y: 0, z: 0, yaw: 0 };
    this.noiseBuf = null;
  }

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(this.ctx.destination);
    const len = this.ctx.sampleRate;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  // Output node with distance falloff and stereo pan for a world position
  out(pos, vol = 1) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    let gain = vol;
    let pan = 0;
    if (pos) {
      const L = this.listener;
      const dx = pos.x - L.x, dz = pos.z - L.z;
      const d = Math.hypot(dx, (pos.y || 0) - L.y, dz);
      gain *= 1 / (1 + d * 0.12);
      if (d > 0.5) {
        // Right vector of the listener is (cos yaw, -sin yaw)
        const rx = Math.cos(L.yaw), rz = -Math.sin(L.yaw);
        pan = Math.max(-1, Math.min(1, (dx * rx + dz * rz) / d));
      }
    }
    g.gain.value = gain;
    if (ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan * 0.8;
      g.connect(p);
      p.connect(this.master);
    } else {
      g.connect(this.master);
    }
    return g;
  }

  tone(dest, { type = 'sine', f0 = 440, f1 = f0, t = 0.15, vol = 0.3, delay = 0, attack = 0.005 }) {
    const ctx = this.ctx;
    const now = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, now);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), now + t);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(vol, now + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, now + t);
    o.connect(g); g.connect(dest);
    o.start(now); o.stop(now + t + 0.05);
  }

  noise(dest, { t = 0.2, vol = 0.3, type = 'bandpass', f0 = 1000, f1 = f0, q = 1, delay = 0 }) {
    const ctx = this.ctx;
    const now = ctx.currentTime + delay;
    const s = ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, now);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), now + t);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + t);
    s.connect(f); f.connect(g); g.connect(dest);
    s.start(now, Math.random() * 0.5); s.stop(now + t + 0.05);
  }

  play(name, pos = null, vol = 1, pitch = 1) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const o = this.out(pos, vol);
    switch (name) {
      case 'swing': this.noise(o, { t: 0.14, vol: 0.35, f0: 600, f1: 2500, q: 2 }); break;
      case 'spin': this.noise(o, { t: 0.4, vol: 0.35, f0: 300, f1: 1800, q: 3 }); break;
      case 'hit':
        this.tone(o, { type: 'square', f0: 180, f1: 60, t: 0.12, vol: 0.25 });
        this.noise(o, { t: 0.08, vol: 0.4, type: 'lowpass', f0: 1500 });
        break;
      case 'hurt':
        this.tone(o, { type: 'sawtooth', f0: 220, f1: 90, t: 0.25, vol: 0.3 });
        break;
      case 'heal':
        this.tone(o, { f0: 660, t: 0.12, vol: 0.2 });
        this.tone(o, { f0: 990, t: 0.18, vol: 0.2, delay: 0.08 });
        break;
      case 'kill':
        this.tone(o, { type: 'triangle', f0: 500, f1: 120, t: 0.5, vol: 0.3 });
        break;
      case 'steal':
        this.tone(o, { type: 'sawtooth', f0: 200, f1: 1600, t: 0.25, vol: 0.15 });
        break;
      case 'build':
        for (let i = 0; i < 3; i++) this.tone(o, { type: 'square', f0: 300 + i * 80, f1: 200, t: 0.06, vol: 0.15, delay: i * 0.09 });
        break;
      case 'collapse':
        this.noise(o, { t: 1.4, vol: 0.9, type: 'lowpass', f0: 900, f1: 60 });
        this.tone(o, { type: 'sine', f0: 90, f1: 30, t: 1.0, vol: 0.6 });
        break;
      case 'break':
        this.noise(o, { t: 0.6, vol: 0.5, type: 'lowpass', f0: 1200, f1: 100 });
        break;
      case 'throw': this.noise(o, { t: 0.2, vol: 0.2, f0: 400, f1: 1200, q: 1 }); break;
      case 'splash':
        this.noise(o, { t: 0.35, vol: 0.4, type: 'highpass', f0: 3000, f1: 1500 });
        this.tone(o, { f0: 500, f1: 900, t: 0.15, vol: 0.1, delay: 0.05 });
        break;
      case 'medkit':
        this.tone(o, { f0: 523, t: 0.1, vol: 0.2 });
        this.tone(o, { f0: 659, t: 0.1, vol: 0.2, delay: 0.1 });
        this.tone(o, { f0: 784, t: 0.2, vol: 0.2, delay: 0.2 });
        break;
      case 'click': this.tone(o, { type: 'square', f0: 1200, f1: 800, t: 0.03, vol: 0.12 }); break;
      case 'step': this.noise(o, { t: 0.05, vol: 0.25, type: 'lowpass', f0: 700 }); break;
      case 'hop': this.tone(o, { f0: 250, f1: 500, t: 0.1, vol: 0.12 }); break;
      case 'land': this.noise(o, { t: 0.15, vol: 0.5, type: 'lowpass', f0: 400 }); break;
      case 'fail': this.tone(o, { type: 'square', f0: 140, t: 0.12, vol: 0.12 }); break;
      case 'beep': this.tone(o, { type: 'square', f0: 660, t: 0.12, vol: 0.15 }); break;
      case 'fight':
        this.tone(o, { type: 'sawtooth', f0: 440, t: 0.5, vol: 0.2 });
        this.tone(o, { type: 'sawtooth', f0: 660, t: 0.5, vol: 0.15 });
        break;
      case 'win':
        [523, 659, 784, 1046].forEach((f, i) => this.tone(o, { type: 'triangle', f0: f, t: 0.25, vol: 0.2, delay: i * 0.12 }));
        break;
      case 'lose':
        [392, 330, 262].forEach((f, i) => this.tone(o, { type: 'triangle', f0: f, t: 0.3, vol: 0.2, delay: i * 0.18 }));
        break;
      case 'pick': this.tone(o, { f0: 880, t: 0.08, vol: 0.15 }); break;
      case 'shoot':
        this.noise(o, { t: 0.06, vol: 0.5, type: 'highpass', f0: 2500 });
        this.tone(o, { type: 'square', f0: 900, f1: 300, t: 0.06, vol: 0.12 });
        break;
      case 'nailHit': this.tone(o, { type: 'square', f0: 1800, f1: 1200, t: 0.04, vol: 0.08 }); break;
      case 'deflect': this.tone(o, { type: 'triangle', f0: 2400, f1: 3000, t: 0.12, vol: 0.15 }); break;
      case 'shimmer': this.tone(o, { type: 'sine', f0: 1200, f1: 1800, t: 0.35, vol: 0.12 }); break;
      case 'ping':
        // Short beep; higher pitch as the last stand runs out
        this.tone(o, { type: 'sine', f0: 1046 * pitch, t: 0.18, vol: 0.25 });
        this.tone(o, { type: 'square', f0: 1046 * pitch, t: 0.08, vol: 0.05 });
        break;
    }
  }
}
