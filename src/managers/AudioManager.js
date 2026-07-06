// 音效管理器：使用 Web Audio API 即時合成音效與簡易 BGM
// 依需求：攻擊、擊殺、升級、Boss、BGM
export default class AudioManager {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.bgmGain = null;
    this.bgmNodes = [];
    this.enabled = true;
    this.bgmPlaying = false;
  }

  _ensureCtx() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 0.5;
      this.masterGain.connect(this.ctx.destination);
      this.bgmGain = this.ctx.createGain();
      this.bgmGain.gain.value = 0.18;
      this.bgmGain.connect(this.masterGain);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  _tone(freq, dur, type = 'sine', gainVal = 0.3, when = 0, sweepTo = null) {
    if (!this.enabled) return;
    this._ensureCtx();
    const t0 = this.ctx.currentTime + when;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (sweepTo) osc.frequency.exponentialRampToValueAtTime(sweepTo, t0 + dur);
    gain.gain.setValueAtTime(gainVal, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  attack() { this._tone(440, 0.06, 'square', 0.15, 0, 260); }
  hit() { this._tone(180, 0.08, 'sawtooth', 0.18, 0, 90); }
  kill() { this._tone(320, 0.12, 'triangle', 0.2, 0, 120); }
  levelUp() {
    this._tone(523, 0.12, 'sine', 0.25, 0);
    this._tone(659, 0.12, 'sine', 0.25, 0.08);
    this._tone(784, 0.2, 'sine', 0.25, 0.16);
  }
  pickup() { this._tone(880, 0.05, 'sine', 0.12, 0, 1200); }
  bossRoar() {
    this._tone(80, 0.5, 'sawtooth', 0.35, 0, 40);
    this._tone(120, 0.4, 'square', 0.25, 0.05, 60);
  }
  bossDeath() {
    this._tone(300, 0.6, 'sawtooth', 0.3, 0, 40);
    this._tone(200, 0.6, 'square', 0.25, 0.1, 30);
  }
  dash() { this._tone(600, 0.08, 'sine', 0.15, 0, 900); }
  gameOver() {
    this._tone(400, 0.3, 'sine', 0.25, 0, 200);
    this._tone(300, 0.4, 'sine', 0.25, 0.2, 100);
  }

  startBgm() {
    if (this.bgmPlaying) return;
    this._ensureCtx();
    this.bgmPlaying = true;
    const notes = [261.6, 293.7, 329.6, 349.2, 392.0, 440.0, 392.0, 349.2];
    let i = 0;
    this._bgmInterval = setInterval(() => {
      if (!this.bgmPlaying) return;
      const t0 = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(notes[i % notes.length], t0);
      gain.gain.setValueAtTime(0.001, t0);
      gain.gain.linearRampToValueAtTime(0.15, t0 + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.4);
      osc.connect(gain);
      gain.connect(this.bgmGain);
      osc.start(t0);
      osc.stop(t0 + 0.45);
      i++;
    }, 420);
  }

  stopBgm() {
    this.bgmPlaying = false;
    if (this._bgmInterval) clearInterval(this._bgmInterval);
  }
}

export const audioManager = new AudioManager();
