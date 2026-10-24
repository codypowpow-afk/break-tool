// Audio engine: shared state, FX chain, slice voices, step scheduler, offline render.
window.BT = window.BT || {};

(function (BT) {
  'use strict';

  const S = (BT.S = {
    // source
    breaks: [], current: -1, name: '',
    src: null, proc: null, procRev: null,
    origBpm: 172, songBpm: 172, bars: 0, repitch: false,
    // slicing
    sliceMode: 'auto', evenCount: 16, sensitivity: 0.5, locked: false, manual: false,
    slices: [], sel: 0,
    // playback
    choke: true, fade: 0.15, volume: 0.8, swing: 0, human: 0,
    // pattern
    style: 'twostep', variant: 1, density: 0.5, chaos: 0.15, fill: false, seedSalt: 0,
    patterns: [null, null, null, null], editSlot: 0, playSlot: 0, chain: false, patLen: 2,
    lane: 'vel',
    // sampler
    rate: 0, bits: 16, mono: false,
    // fx
    filterType: 'lowpass', cutoff: 1, res: 0.1, drive: 0, comp: 0, room: 0,
    // transport
    playing: false, recording: false,
  });

  const E = (BT.engine = {});

  E.init = function () {
    if (E.ctx) return;
    E.ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
    E.chain = E.buildChain(E.ctx, E.ctx.destination, true);
    E.updateChain();
  };
  E.resume = function () { if (E.ctx && E.ctx.state !== 'running') E.ctx.resume(); };

  function impulse(ctx, seconds) {
    const len = Math.round(ctx.sampleRate * seconds);
    const b = ctx.createBuffer(2, len, ctx.sampleRate);
    const r = BT.rng(1234);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (r() * 2 - 1) * Math.pow(1 - i / len, 3.2);
    }
    return b;
  }

  // input -> drive -> filter -> comp -> makeup -> (dry + room) -> master -> [analyser] -> out
  E.buildChain = function (ctx, out, withAnalyser) {
    const c = {};
    c.input = ctx.createGain();
    c.shaper = ctx.createWaveShaper(); c.shaper.oversample = '2x';
    c.filter = ctx.createBiquadFilter();
    c.comp = ctx.createDynamicsCompressor();
    c.makeup = ctx.createGain();
    c.dry = ctx.createGain();
    c.wet = ctx.createGain();
    c.verb = ctx.createConvolver(); c.verb.buffer = impulse(ctx, 1.4);
    c.master = ctx.createGain();
    // brickwall-ish safety limiter: stacked hits on one step can sum well past 0 dBFS
    c.limiter = ctx.createDynamicsCompressor();
    c.limiter.threshold.value = -1.5; c.limiter.knee.value = 0; c.limiter.ratio.value = 20;
    c.limiter.attack.value = 0.001; c.limiter.release.value = 0.08;
    c.input.connect(c.shaper); c.shaper.connect(c.filter); c.filter.connect(c.comp);
    c.comp.connect(c.makeup); c.makeup.connect(c.dry); c.makeup.connect(c.verb);
    c.verb.connect(c.wet); c.dry.connect(c.master); c.wet.connect(c.master);
    c.master.connect(c.limiter);
    if (withAnalyser) {
      c.analyser = ctx.createAnalyser(); c.analyser.fftSize = 1024;
      c.limiter.connect(c.analyser); c.analyser.connect(out);
    } else c.limiter.connect(out);
    return c;
  };

  E.applyChain = function (c) {
    const k = S.drive * 24;
    if (k < 0.01) c.shaper.curve = null;
    else {
      const n = 2048, curve = new Float32Array(n), norm = Math.tanh(1 + k);
      for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; curve[i] = Math.tanh(x * (1 + k)) / norm; }
      c.shaper.curve = curve;
    }
    c.filter.type = S.filterType;
    let freq = 20 * Math.pow(2, S.cutoff * 10);
    if (S.filterType === 'lowpass' && S.cutoff >= 0.999) freq = 22000;
    c.filter.frequency.value = Math.min(22000, freq);
    c.filter.Q.value = 0.5 + S.res * 16;
    c.comp.threshold.value = -S.comp * 36;
    c.comp.ratio.value = 1 + S.comp * 11;
    c.comp.knee.value = 6; c.comp.attack.value = 0.004; c.comp.release.value = 0.12;
    c.makeup.gain.value = 1 + S.comp * 1.6;
    c.wet.gain.value = S.room * 0.55;
    c.dry.gain.value = 1 - S.room * 0.25;
    c.master.gain.value = S.volume;
  };
  E.updateChain = function () { if (E.chain) E.applyChain(E.chain); };

  // Rebuild the degraded (sample-rate / bit-depth / mono) source buffers.
  E.rebuildProcessed = function () {
    if (!S.src) return;
    S.proc = S.rate || S.bits < 16 || S.mono
      ? BT.degrade(E.ctx, S.src, { rate: S.rate, bits: S.bits, mono: S.mono })
      : S.src;
    S.procRev = BT.reverseBuffer(E.ctx, S.proc);
  };

  E.sliceEnd = function (i) {
    return i + 1 < S.slices.length ? S.slices[i + 1].pos : S.src.length;
  };

  E.baseRate = function () { return S.repitch ? S.songBpm / S.origBpm : 1; };

  // Plays slice i at time t into dest. o: {vel, pitch, rev, maxDur, buf, rbuf}
  E.playSlice = function (ctx, dest, i, t, o) {
    const sl = S.slices[i];
    if (!sl) return null;
    const buf = o.buf || S.proc, rbuf = o.rbuf || S.procRev;
    const sr = buf.sampleRate;
    const start = sl.pos, end = E.sliceEnd(i);
    const rev = !!sl.rev !== !!o.rev;
    const rate = E.baseRate() * Math.pow(2, (sl.pitch + (o.pitch || 0)) / 12);
    const segDur = ((end - start) / sr) * sl.decay;
    let dur = segDur / rate;
    if (o.maxDur) dur = Math.min(dur, o.maxDur);
    if (dur < 0.004) return null;

    const src = ctx.createBufferSource();
    src.buffer = rev ? rbuf : buf;
    src.playbackRate.value = rate;
    const env = ctx.createGain(), choke = ctx.createGain(), pan = ctx.createStereoPanner();
    const v = Math.max(0, (o.vel == null ? 1 : o.vel) * sl.gain);
    const fade = Math.max(0.004, dur * S.fade);
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(v, t + 0.0015);
    env.gain.setValueAtTime(v, Math.max(t + 0.0016, t + dur - fade));
    env.gain.linearRampToValueAtTime(0, t + dur);
    pan.pan.value = sl.pan;
    src.connect(env); env.connect(choke); choke.connect(pan); pan.connect(dest);
    const offset = rev ? (buf.length - end) / sr : start / sr;
    src.start(t, offset);
    src.stop(t + dur + 0.01);
    return { choke, src, end: t + dur, slice: i, start: t };
  };

  E.chokeVoice = function (voice, t) {
    if (!voice || voice.end <= t) return;
    try {
      voice.choke.gain.setValueAtTime(1, t);
      voice.choke.gain.linearRampToValueAtTime(0, t + 0.006);
      voice.src.stop(t + 0.008);
    } catch (e) { /* already stopped */ }
  };

  // Schedules one pattern step (an array of hits that sound together). ctxState carries the
  // voices of the previous step (for choke) and a humanize RNG. Choke cuts hits from earlier
  // steps, never hits stacked on the same step.
  E.scheduleStep = function (ctx, dest, step, t, stepDur, ctxState, bufs) {
    const hits = (step || []).filter((h) => h && S.slices[h.s]);
    if (!hits.length) return [];
    if (S.choke) (ctxState.last || []).forEach((v) => E.chokeVoice(v, t));
    const voices = [];
    hits.forEach((hit) => {
      const n = hit.roll || 1;
      let prev = null;
      for (let k = 0; k < n; k++) {
        const tt = t + (k * stepDur) / n;
        let vel = hit.v * (n > 1 ? 0.55 + (0.45 * (k + 1)) / n : 1);
        if (S.human) vel *= 1 - ctxState.rng() * S.human * 0.35;
        if (S.choke) E.chokeVoice(prev, tt);
        const voice = E.playSlice(ctx, dest, hit.s, tt, {
          vel, pitch: hit.p, rev: hit.r, maxDur: n > 1 ? stepDur / n : 0,
          buf: bufs && bufs.buf, rbuf: bufs && bufs.rbuf,
        });
        if (voice) { prev = voice; voices.push(voice); }
      }
    });
    ctxState.last = voices;
    return voices;
  };

  E.stepTime = function (i, base, stepDur, rng) {
    let t = base;
    if (i % 2 === 1) t += S.swing * stepDur * 0.5;
    if (S.human) t += (rng() - 0.5) * S.human * 0.02;
    return Math.max(0, t);
  };

  // ---------- realtime transport ----------
  const LOOKAHEAD = 0.12, TICK = 25;
  let timer = null, nextTime = 0, stepIdx = 0;
  const liveState = { last: null, rng: BT.rng(99) };
  E.queue = []; // {time, slot, step, voices}

  function slotPattern(slot) { return S.patterns[slot]; }

  function nextSlot(cur) {
    if (!S.chain) return S.editSlot;
    for (let k = 1; k <= 4; k++) {
      const s = (cur + k) % 4;
      if (S.patterns[s] && S.patterns[s].steps.some((x) => x.length)) return s;
    }
    return cur;
  }

  function tick() {
    const ctx = E.ctx;
    while (nextTime < ctx.currentTime + LOOKAHEAD) {
      const pat = slotPattern(S.playSlot);
      const stepDur = 60 / S.songBpm / 4;
      if (!pat) { nextTime += stepDur; continue; }
      if (stepIdx >= pat.steps.length) { stepIdx = 0; S.playSlot = nextSlot(S.playSlot); continue; }
      const step = pat.steps[stepIdx];
      const t = E.stepTime(stepIdx, nextTime, stepDur, liveState.rng);
      const voices = S.slices.length ? E.scheduleStep(ctx, E.chain.input, step, t, stepDur, liveState) : [];
      E.queue.push({ time: nextTime, slot: S.playSlot, step: stepIdx, voices });
      nextTime += stepDur;
      stepIdx++;
    }
  }

  E.start = function () {
    E.init(); E.resume();
    if (S.playing) return;
    S.playing = true;
    S.playSlot = S.editSlot;
    stepIdx = 0;
    nextTime = E.ctx.currentTime + 0.06;
    E.queue = [];
    tick();
    timer = setInterval(tick, TICK);
  };
  E.stop = function () {
    S.playing = false;
    clearInterval(timer); timer = null;
    const t = E.ctx.currentTime;
    E.queue.forEach((q) => q.voices.forEach((v) => E.chokeVoice(v, t)));
    (liveState.last || []).forEach((v) => E.chokeVoice(v, t));
    E.queue = [];
  };

  // Current transport position in steps (fractional), for quantised recording.
  E.position = function () {
    if (!S.playing) return null;
    const stepDur = 60 / S.songBpm / 4;
    const behind = (nextTime - E.ctx.currentTime) / stepDur;
    const pat = slotPattern(S.playSlot);
    const len = pat ? pat.steps.length : 32;
    return { slot: S.playSlot, step: (((stepIdx - behind) % len) + len) % len };
  };

  let previewVoice = null;
  E.preview = function (i, opts) {
    E.init(); E.resume();
    if (!S.proc || !S.slices[i]) return null;
    const t = E.ctx.currentTime + 0.005;
    if (S.choke) E.chokeVoice(previewVoice, t);
    previewVoice = E.playSlice(E.ctx, E.chain.input, i, t, opts || {});
    return previewVoice;
  };

  // ---------- offline render ----------
  // slots: list of slot indices to render back to back.
  E.render = async function (slots) {
    const sr = S.src.sampleRate;
    const stepDur = 60 / S.songBpm / 4;
    let total = 0;
    slots.forEach((s) => { total += S.patterns[s].steps.length; });
    const length = Math.ceil(total * stepDur * sr);
    const off = new OfflineAudioContext(2, length, sr);
    const chain = E.buildChain(off, off.destination, false);
    E.applyChain(chain);
    const st = { last: null, rng: BT.rng(99) };
    let base = 0;
    slots.forEach((s) => {
      S.patterns[s].steps.forEach((step, i) => {
        E.scheduleStep(off, chain.input, step, E.stepTime(i, base + i * stepDur, stepDur, st.rng), stepDur, st);
      });
      base += S.patterns[s].steps.length * stepDur;
    });
    return off.startRendering();
  };
})(window.BT);
