'use strict';

// Original upbeat game-show loop for the 10-second vote, synthesized with the Web Audio API
// (no audio files). Plays on the laptop scoreboard only.
const VoteMusic = (() => {
  const BPM = 128;
  const STEP = 60 / BPM / 4; // one 16th note, in seconds
  // A minor loop: Am - F - C - G, one bar each (MIDI note numbers)
  const BASS = [45, 41, 36, 43];
  const CHORDS = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]];
  // Lead melody, 16 steps per bar, 0 = rest
  const LEAD = [
    [76, 0, 72, 0, 74, 76, 0, 72, 69, 0, 72, 0, 74, 0, 72, 0],
    [72, 0, 69, 0, 72, 74, 0, 72, 69, 0, 65, 0, 69, 0, 72, 0],
    [79, 0, 76, 0, 74, 76, 0, 79, 76, 0, 72, 0, 74, 0, 76, 0],
    [74, 0, 71, 0, 74, 79, 0, 78, 79, 0, 74, 0, 71, 0, 74, 79],
  ];

  let ctx = null;
  let master = null;
  let noise = null;
  let loop = null;
  let step = 0;
  let nextTime = 0;
  let muted = load();

  const hz = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

  // Browsers only allow sound after a click, so this runs on every click on the page.
  function unlock() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.45;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
  }

  function tone(freq, t, dur, type, vol) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  function kick(t) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    g.gain.setValueAtTime(0.8, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + 0.2);
  }

  function hat(t, vol) {
    if (!noise) {
      noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.05), ctx.sampleRate);
      const d = noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const src = ctx.createBufferSource();
    const hp = ctx.createBiquadFilter();
    const g = ctx.createGain();
    src.buffer = noise;
    hp.type = 'highpass';
    hp.frequency.value = 7000;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
    src.connect(hp).connect(g).connect(master);
    src.start(t);
  }

  function playStep(i, t) {
    const bar = Math.floor(i / 16) % 4;
    const s = i % 16;
    if (s % 4 === 0) kick(t);
    if (s % 2 === 0) hat(t, s % 4 === 2 ? 0.22 : 0.08);
    if (s % 2 === 0) tone(hz(BASS[bar] + (s % 4 === 2 ? 12 : 0)), t, STEP * 1.8, 'triangle', 0.3);
    if (s % 4 === 2) CHORDS[bar].forEach((n) => tone(hz(n), t, STEP * 1.2, 'square', 0.04));
    if (LEAD[bar][s]) tone(hz(LEAD[bar][s]), t, STEP * 1.6, 'triangle', 0.14);
  }

  function start() {
    stop();
    unlock();
    if (muted || !ctx) return;
    step = 0;
    nextTime = ctx.currentTime + 0.05;
    loop = setInterval(() => {
      while (nextTime < ctx.currentTime + 0.12) {
        playStep(step, nextTime);
        step += 1;
        nextTime += STEP;
      }
    }, 25);
  }

  function stop() {
    clearInterval(loop);
    loop = null;
  }

  // Short rising chord when the vote closes.
  function sting() {
    if (muted || !ctx) return;
    const t = ctx.currentTime + 0.02;
    [60, 64, 67, 72].forEach((n, i) => tone(hz(n), t + i * 0.08, 0.7, 'triangle', 0.18));
  }

  function setMuted(m) {
    muted = m;
    try { localStorage.setItem('muted', m ? '1' : ''); } catch { /* private mode */ }
    if (m) stop();
  }

  function load() {
    try { return localStorage.getItem('muted') === '1'; } catch { return false; }
  }

  return { unlock, start, stop, sting, setMuted, isMuted: () => muted };
})();
