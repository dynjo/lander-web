// Simple Web Audio synthesizer for game sounds

export class Audio {
  constructor() {
    this.ctx = null;
    this.thrustNode = null;
    this.thrustGain = null;
    this.thrustOn = false;
  }

  init() {
    if (this.ctx) return;
    this.ctx = new AudioContext();

    // Master gain
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.3;
    this.master.connect(this.ctx.destination);

    // Thrust: filtered noise (continuous, toggled on/off)
    this.thrustGain = this.ctx.createGain();
    this.thrustGain.gain.value = 0;
    const thrustFilter = this.ctx.createBiquadFilter();
    thrustFilter.type = 'lowpass';
    thrustFilter.frequency.value = 300;
    thrustFilter.Q.value = 2;

    // Use a buffer of white noise
    const bufSize = this.ctx.sampleRate * 2;
    const noiseBuf = this.ctx.createBuffer(1, bufSize, this.ctx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1;

    this.thrustNode = this.ctx.createBufferSource();
    this.thrustNode.buffer = noiseBuf;
    this.thrustNode.loop = true;
    this.thrustNode.connect(thrustFilter);
    thrustFilter.connect(this.thrustGain);
    this.thrustGain.connect(this.master);
    this.thrustNode.start();
  }

  setThrust(on) {
    if (!this.ctx) return;
    const target = on ? 0.6 : 0;
    this.thrustGain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.05);
    this.thrustOn = on;
  }

  playLaser() {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(880, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(220, this.ctx.currentTime + 0.15);
    gain.gain.setValueAtTime(0.4, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.15);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start();
    osc.stop(this.ctx.currentTime + 0.15);
  }

  playExplosion() {
    if (!this.ctx) return;
    const bufSize = this.ctx.sampleRate;
    const buf = this.ctx.createBuffer(1, bufSize, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < bufSize; i++) d[i] = Math.random() * 2 - 1;

    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(800, this.ctx.currentTime);
    filter.frequency.exponentialRampToValueAtTime(100, this.ctx.currentTime + 0.5);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.8, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.5);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    src.start();
    src.stop(this.ctx.currentTime + 0.5);
  }

  playCrash() {
    if (!this.ctx) return;
    // Louder, longer explosion
    const bufSize = this.ctx.sampleRate * 2;
    const buf = this.ctx.createBuffer(1, bufSize, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < bufSize; i++) d[i] = Math.random() * 2 - 1;

    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(600, this.ctx.currentTime);
    filter.frequency.exponentialRampToValueAtTime(40, this.ctx.currentTime + 1.0);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(1.0, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 1.0);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    src.start();
    src.stop(this.ctx.currentTime + 1.0);
  }
}
