// Audio engine: shared state, FX chain, slice voices, sub bass, step scheduler, offline render.
// Patterns run on a 32nd-note grid (BT.RES steps per 16th); rolls always span one 16th.
window.BT = window.BT || {};

(function (BT) {
  'use strict';

  BT.RES = 2; // pattern steps per 16th note (32nd-note grid)

  const S = (BT.S = {
    // source
    breaks: [], current: -1, name: '',
    src: null, proc: null, procRev: null,
    origBpm: 172, songBpm: 120, bars: 0, repitch: false,
    // slicing
    sliceMode: 'auto', evenCount: 16, sensitivity: 0.5, locked: false, manual: false,
    slices: [], sel: 0,
    // playback
    choke: true, fade: 0.06, volume: 0.8, swing: 0, human: 0,
    // pattern
    style: 'twostep', variant: 1, density: 0.5, chaos: 0, fill: false, seedSalt: 0,
    fillType: 0, fillLen: 4, fillEvery: 8,
    patterns: [null, null, null, null], editSlot: 0, playSlot: 0, chain: false, patLen: 2,
    gridPage: 0, follow: true, gridRes: 2,
    lane: 'vel',
    // sampler
    rate: 0, bits: 16, mono: false,
    // fx
    filterOn: false, filterType: 'lowpass', cutoff: 1, res: 0.1, drive: 0, comp: 0, room: 0,
    lfoOn: false, lfoRate: 4, lfoShape: 'sine', lfoDepth: 0.5,
    // sub bass that follows the kicks
    sub: false, subKey: 5, subLevel: 0.7, subDecay: 0.45, subGlide: true,
    scDepth: 0.8, scRelease: 0.25, // sidechain: how far / how slowly the sub ducks under trigger chops
    // transport
    playing: false, recording: false,
  });

  // Everything a freshly loaded break resets to, so imports always start clean.
  // (Volume, the break list and view settings like FOLLOW are left alone.)
  const RESET_KEYS = ['songBpm', 'repitch', 'bars', 'sliceMode', 'evenCount', 'sensitivity', 'choke', 'fade', 'swing', 'human',
    'style', 'variant', 'density', 'chaos', 'fill', 'seedSalt', 'fillType', 'fillLen', 'fillEvery', 'patLen', 'gridRes', 'lane',
    'rate', 'bits', 'mono', 'filterOn', 'filterType', 'cutoff', 'res', 'drive', 'comp', 'room',
    'lfoOn', 'lfoRate', 'lfoShape', 'lfoDepth', 'sub', 'subKey', 'subLevel', 'subDecay', 'subGlide', 'scDepth', 'scRelease'];
  const DEFAULTS = JSON.parse(JSON.stringify(RESET_KEYS.reduce((o, k) => { o[k] = S[k]; return o; }, {})));

  const E = (BT.engine = {});

  E.resetDefaults = function () {
    Object.assign(S, JSON.parse(JSON.stringify(DEFAULTS)));
    S.patterns = [null, null, null, null];
    S.editSlot = 0; S.playSlot = 0; S.gridPage = 0; S.locked = false;
    E.updateChain();
  };

  E.init = function () {
    if (E.ctx) return;
    E.ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
    E.chain = E.buildChain(E.ctx, E.ctx.destination, true);
    E.updateChain();
  };
  E.resume = function () { if (E.ctx && E.ctx.state !== 'running') E.ctx.resume(); };

  E.stepDur = function () { return 60 / S.songBpm / 4 / BT.RES; };

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

  // input -> drive -> [filter (+LFO) | bypass] -> comp -> makeup -> (dry + room) -> master -> limiter -> [analyser] -> out
  // The sub bass enters after the filter (through the sidechain ducker) so sweeps never thin out the low end.
  E.buildChain = function (ctx, out, withAnalyser) {
    const c = {};
    c.input = ctx.createGain();
    c.shaper = ctx.createWaveShaper(); c.shaper.oversample = '2x';
    c.filter = ctx.createBiquadFilter();
    c.lfoAmt = ctx.createGain(); c.lfoAmt.gain.value = 0;
    c.lfoAmt.connect(c.filter.detune);
    c.filterWet = ctx.createGain(); c.filterDry = ctx.createGain();
    c.subIn = ctx.createGain();
    c.subDuck = ctx.createGain();
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
    c.input.connect(c.shaper);
    c.shaper.connect(c.filter); c.filter.connect(c.filterWet); c.filterWet.connect(c.comp);
    c.shaper.connect(c.filterDry); c.filterDry.connect(c.comp);
    c.subIn.connect(c.subDuck); c.subDuck.connect(c.comp);
    c.comp.connect(c.makeup); c.makeup.connect(c.dry); c.makeup.connect(c.verb);
    c.verb.connect(c.wet); c.dry.connect(c.master); c.wet.connect(c.master);
    c.master.connect(c.limiter);
    if (withAnalyser) {
      c.analyser = ctx.createAnalyser(); c.analyser.fftSize = 1024;
      c.limiter.connect(c.analyser); c.analyser.connect(out);
    } else c.limiter.connect(out);
    E.startLfo(c, ctx, 0);
    return c;
  };

  // (Re)starts the filter LFO at time t so its phase lines up with the bar.
  E.startLfo = function (c, ctx, t) {
    if (c.lfo) { try { c.lfo.stop(); } catch (e) { /* not started */ } c.lfo.disconnect(); }
    c.lfo = ctx.createOscillator();
    c.lfo.connect(c.lfoAmt);
    E.applyLfo(c);
    c.lfo.start(t);
  };
  E.applyLfo = function (c) {
    if (!c.lfo) return;
    // a falling saw sweeps closed each cycle; the others start at the top of the sweep
    c.lfo.type = S.lfoShape === 'saw' ? 'sawtooth' : S.lfoShape;
    c.lfo.frequency.value = S.songBpm / 60 / S.lfoRate;
    // detune swings +/- depth*2 octaves around a centre 2*depth octaves below the cutoff,
    // so the sweep runs between the cutoff and 4*depth octaves under it
    c.lfoAmt.gain.value = S.lfoOn && S.filterOn ? S.lfoDepth * 2400 * (S.lfoShape === 'saw' ? -1 : 1) : 0;
  };

  E.applyChain = function (c) {
    const k = S.drive * 24;
    if (k < 0.01) c.shaper.curve = null;
    else {
      const n = 2048, curve = new Float32Array(n), norm = Math.tanh(1 + k);
      for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; curve[i] = Math.tanh(x * (1 + k)) / norm; }
      c.shaper.curve = curve;
    }
    // filter off = a clean bypass path, not just a wide-open filter
    c.filterWet.gain.value = S.filterOn ? 1 : 0;
    c.filterDry.gain.value = S.filterOn ? 0 : 1;
    c.filter.type = S.filterType;
    let freq = 20 * Math.pow(2, S.cutoff * 10);
    if (S.filterType === 'lowpass' && S.cutoff >= 0.999) freq = 22000;
    if (S.lfoOn && S.filterOn) freq *= Math.pow(2, -2 * S.lfoDepth);
    c.filter.frequency.value = Math.min(22000, freq);
    c.filter.Q.value = 0.5 + S.res * 16;
    E.applyLfo(c);
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

  // Mono sine sub on a kick: a short pitch drop for punch, then an exponential tail.
  // With glide on, a new note slides from where the previous one was instead of cutting.
  E.playSub = function (ctx, dest, t, vel, ctxState) {
    const freq = 440 * Math.pow(2, (S.subKey + 24 - 69) / 12); // key in octave 1 (F1 ~ 43.7 Hz)
    const prev = ctxState.sub;
    const osc = ctx.createOscillator(), g = ctx.createGain(), choke = ctx.createGain();
    osc.type = 'sine';
    const startF = prev && prev.end > t && S.subGlide ? freq * 1.12 : freq * 2.6;
    osc.frequency.setValueAtTime(startF, t);
    osc.frequency.exponentialRampToValueAtTime(freq, t + 0.045);
    const level = S.subLevel * Math.max(0.2, vel);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(level, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0008, t + 0.05 + S.subDecay * 1.4);
    osc.connect(g); g.connect(choke); choke.connect(dest);
    const end = t + 0.06 + S.subDecay * 1.4;
    osc.start(t); osc.stop(end);
    if (prev) E.chokeVoice(prev, t);
    ctxState.sub = { choke, src: osc, end };
  };

  // Sidechain: dip the sub under a trigger chop, then let it swell back over scRelease.
  E.duckSub = function (chain, t) {
    const g = chain.subDuck.gain;
    g.cancelScheduledValues(t);
    g.setTargetAtTime(1 - S.scDepth, t, 0.003);
    g.setTargetAtTime(1, t + 0.03, Math.max(0.01, S.scRelease) / 3);
  };

  // Schedules one pattern step (an array of hits that sound together). ctxState carries the
  // voices of the previous step (for choke), the sub voice and an RNG for humanize/chance.
  // Choke cuts hits from earlier steps, never hits stacked on the same step.
  E.scheduleStep = function (ctx, dest, step, t, stepDur, ctxState, chain) {
    const hits = (step || []).filter((h) => h && S.slices[h.s] && (h.c == null || h.c >= 1 || ctxState.rng() < h.c));
    if (!hits.length) return [];
    if (S.choke) (ctxState.last || []).forEach((v) => E.chokeVoice(v, t));
    const span = stepDur * BT.RES; // rolls subdivide one 16th
    const voices = [];
    let kicked = 0;
    hits.forEach((hit) => {
      const n = hit.roll || 1;
      let prev = null;
      for (let k = 0; k < n; k++) {
        const tt = t + (k * span) / n;
        let vel = hit.v * (n > 1 ? 0.55 + (0.45 * (k + 1)) / n : 1);
        if (S.human) vel *= 1 - ctxState.rng() * S.human * 0.35;
        if (S.choke) E.chokeVoice(prev, tt);
        const voice = E.playSlice(ctx, dest, hit.s, tt, { vel, pitch: hit.p, rev: hit.r, maxDur: n > 1 ? span / n : 0 });
        if (voice) { prev = voice; voices.push(voice); }
      }
      if (S.slices[hit.s].label === 'K' && !hit.p) kicked = Math.max(kicked, hit.v);
    });
    if (S.sub && chain) {
      if (hits.some((h) => S.slices[h.s].sc)) E.duckSub(chain, t);
      if (kicked) E.playSub(ctx, chain.subIn, t, kicked, ctxState);
    }
    ctxState.last = voices;
    return voices;
  };

  // Swing pushes the offbeat 16th; the 32nds either side move half as far.
  E.stepTime = function (i, base, stepDur, rng) {
    let t = base;
    const m = i % (2 * BT.RES), d = S.swing * stepDur * BT.RES * 0.5;
    if (m === BT.RES) t += d;
    else if (m % BT.RES) t += d / 2;
    if (S.human) t += (rng() - 0.5) * S.human * 0.02;
    return Math.max(0, t);
  };

  // ---------- realtime transport ----------
  const LOOKAHEAD = 0.12, TICK = 25;
  let timer = null, nextTime = 0, stepIdx = 0;
  const liveState = { last: null, sub: null, rng: BT.rng(99) };
  let repeat = null; // beat repeat: {start, len} in steps
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
      const stepDur = E.stepDur();
      if (!pat) { nextTime += stepDur; continue; }
      if (stepIdx >= pat.steps.length) { stepIdx = 0; S.playSlot = nextSlot(S.playSlot); continue; }
      // while beat repeat is held the transport keeps counting, but we replay the held slice
      const idx = repeat && repeat.start + repeat.len <= pat.steps.length
        ? repeat.start + ((stepIdx - repeat.start) % repeat.len + repeat.len) % repeat.len
        : stepIdx;
      const t = E.stepTime(idx, nextTime, stepDur, liveState.rng);
      const voices = S.slices.length ? E.scheduleStep(ctx, E.chain.input, pat.steps[idx], t, stepDur, liveState, E.chain) : [];
      E.queue.push({ time: nextTime, slot: S.playSlot, step: idx, voices });
      nextTime += stepDur;
      stepIdx++;
    }
  }

  // Beat repeat: loop the last `len` steps (aligned to `len`) until released (len 0).
  E.setRepeat = function (len) {
    if (!len || !S.playing) { repeat = null; return; }
    repeat = { start: Math.floor(stepIdx / len) * len, len };
  };

  E.start = function () {
    E.init(); E.resume();
    if (S.playing) return;
    S.playing = true;
    S.playSlot = S.editSlot;
    stepIdx = 0; repeat = null;
    nextTime = E.ctx.currentTime + 0.06;
    E.startLfo(E.chain, E.ctx, nextTime);
    E.queue = [];
    tick();
    timer = setInterval(tick, TICK);
  };
  E.stop = function () {
    S.playing = false; repeat = null;
    clearInterval(timer); timer = null;
    const t = E.ctx.currentTime;
    E.queue.forEach((q) => q.voices.forEach((v) => E.chokeVoice(v, t)));
    (liveState.last || []).forEach((v) => E.chokeVoice(v, t));
    E.chokeVoice(liveState.sub, t);
    E.queue = [];
  };

  // Current transport position in steps (fractional), for quantised recording.
  E.position = function () {
    if (!S.playing) return null;
    const behind = (nextTime - E.ctx.currentTime) / E.stepDur();
    const pat = slotPattern(S.playSlot);
    const len = pat ? pat.steps.length : 64;
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
    const stepDur = E.stepDur();
    let total = 0;
    slots.forEach((s) => { total += S.patterns[s].steps.length; });
    const length = Math.ceil(total * stepDur * sr);
    const off = new OfflineAudioContext(2, length, sr);
    const chain = E.buildChain(off, off.destination, false);
    E.applyChain(chain);
    const st = { last: null, sub: null, rng: BT.rng(99) };
    let base = 0;
    slots.forEach((s) => {
      S.patterns[s].steps.forEach((step, i) => {
        E.scheduleStep(off, chain.input, step, E.stepTime(i, base + i * stepDur, stepDur, st.rng), stepDur, st, chain);
      });
      base += S.patterns[s].steps.length * stepDur;
    });
    return off.startRendering();
  };
})(window.BT);
