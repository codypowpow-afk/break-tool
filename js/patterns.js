// Pattern generator built on drum & bass conventions.
// A pattern is { steps: [[hit, ...]], locks: [bool], style, variant, edited }.
// Each step is an array of hits that sound together (empty = rest).
// A hit is { s: sliceIndex, v: velocity 0..1, p: semitones, r: reverse, roll: 1..4 }.
// The template builders below work on one hit per step; BT.generate wraps them into stacks.
window.BT = window.BT || {};

(function (BT) {
  'use strict';

  // Two-bar templates (32 sixteenths, written one beat per group of 4). Legend:
  //  K main kick  k alt kick  S main snare  s alt snare  g ghost snare
  //  h hat        r reversed snare          . flow (hats / continue the break, by density)
  //  - forced rest
  // Every template keeps the DnB backbone: kick on the 1, snares on the backbeat (2 & 4,
  // or 3 for halftime); variants move kicks, add ghosts or syncopate the second snare.
  const T = {
    stepping: [ // kick 1 & 3, snare 2 & 4
      'K...S...K...S...K...S...K...S...', // straight
      'K...S...K...S...K...S...K..KS...', // kick pickup into the last snare
      'K...S...K.K.S...K...S...K.K.S...', // kick on 3 and 3&
      'K...S..gK...S...K...S..gK...S.g.', // ghost snares before beat 3
      'K.K.S...K...S...K.K.S...K..KS...', // breakbeat double kicks
    ],
    twostep: [ // kick 1 + 3&, snare 2 & 4
      'K...S.....K.S...K...S.....K.S...', // the classic two-step
      'K...S.....K.S.....K.S.....K.S...', // bar 2 kick slides to the 1&
      'K...S..g.gK.S...K...S..g.gK.S..g', // ghosts around the 3& kick
      'K.K.S.....K.S...K...S.....K.S...', // double kick on bar 1
      'K...S.....K.S...K...S..K..K.S...', // extra kick on the 2a in bar 2
    ],
    threeand: [ // kick 1 & 3, snare 2 + 3&
      'K...S...K.S.....K...S...K.S.....', // broken backbeat
      'K...S...K.S.....K...S.....S.K...', // bar 2 answers with a kick on 4
      'K...S...K.S...K.K...S...K.S.....', // pickup kick on 4&
      'K...S..gK.S..g..K...S..gK.S..g..', // with ghost notes
      'K...S.....S.K...K...S.....K.S...', // syncopated bar, then a two-step
    ],
    halftime: [ // kick 1, snare 3
      'K.......S.......K.......S.......', // straight halftime
      'K.......S.....K.K.......S.......', // pickup kick into bar 2
      'K.....K.S.......K.....K.S.......', // kick on 2& before the snare
      'K.......S..K....K.......S..K..K.', // syncopated kicks after the snare
      'K..K....S.......K..K....S...g...', // kick on 1a, ghost after the snare
    ],
    roller: [ // two-step with rolling ghost snares
      'K...S..g.gK.S...K...S..g.gK.S...',
      'K...S..g.gK.S..g..K.S..g.gK.S...',
      'K..gS..g.gK.S.g.K..gS..g.gK.S.g.',
      'K...S.g..gK.S...K...S.g..gK.S.gg',
      'K.K.S..g.gK.S..gK...S..g.gK.Sg.g',
    ],
    jungle: [ // amen-style: kicks 1, 1&, 3&, 3a; snares 2, 2a, 3e, 4, 4a
      'K.K.S..s.sKKS..sK.K.S..s.sKKS..s', // the amen bar
      'K.K.S..s.sKKS..sK.K.S..s.sK...s.', // amen bar 3 ending
      'K.K.S..s.sKKS..s..sKS..s.sK...s.', // amen bar 4 pickup
      'K...S.....K.S...K.K.S..s.sKKS..s', // two-step into amen
      'K.K.S..s.sKKS..sK.K.S.ss.sK.ssss', // amen with snare run out
    ],
  };

  BT.STYLES = [
    { id: 'asplayed', name: 'AS PLAYED', sub: 'ORIGINAL' },
    { id: 'stepping', name: 'STEPPING', sub: 'K-S-K-S' },
    { id: 'twostep', name: 'TWO-STEP', sub: 'SNARE 2 + 4' },
    { id: 'threeand', name: 'THREE-AND', sub: 'SNARE 2 + 3&' },
    { id: 'halftime', name: 'HALFTIME', sub: 'SNARE 3' },
    { id: 'roller', name: 'ROLLER', sub: 'GHOST FLOW' },
    { id: 'jungle', name: 'JUNGLE', sub: 'AMEN CHOPS' },
  ];

  // Groups slices by type and maps original grid steps to slices.
  BT.analyzeKit = function (slices, srcSteps) {
    const kit = { K: [], S: [], H: [], G: [], C: [], startsAt: {}, srcSteps: Math.max(1, srcSteps) };
    slices.forEach((sl, i) => {
      (kit[sl.label] || kit.H).push(i);
      if (kit.startsAt[sl.origStep] == null) kit.startsAt[sl.origStep] = i;
    });
    const byStep = (a, b) => slices[a].origStep - slices[b].origStep;
    kit.K.sort(byStep); kit.S.sort(byStep);
    const loud = (a, b) => slices[b].rms - slices[a].rms;
    if (!kit.K.length) kit.K = [0];
    if (!kit.S.length) {
      const cands = slices.map((s, i) => i).filter((i) => !kit.K.includes(i)).sort(loud);
      kit.S = cands.length ? [cands[0]] : [0];
    }
    const downbeat = kit.K.find((i) => slices[i].origStep % 16 === 0);
    kit.mainK = downbeat != null ? downbeat : kit.K[0];
    const back = kit.S.filter((i) => slices[i].origStep % 8 === 4).sort(loud);
    kit.mainS = back.length ? back[0] : kit.S.slice().sort(loud)[0];
    kit.ghosts = kit.G.length ? kit.G : kit.S;
    // one consistent ghost: the most snare-like ghost, or the main snare played softly
    kit.mainG = kit.G.length ? kit.G.slice().sort(loud)[0] : kit.mainS;
    if (kit.H.length) kit.hats = kit.H;
    else if (kit.G.length) kit.hats = kit.G;
    else {
      // no hats found: use the quietest non-kick hits
      const quiet = slices.map((s, i) => i).filter((i) => slices[i].label !== 'K').sort((a, b) => slices[a].rms - slices[b].rms);
      kit.hats = quiet.length ? quiet.slice(0, Math.max(1, Math.ceil(quiet.length / 3))) : [kit.mainK];
    }
    // one consistent hat for the 8ths (prefer one that sat on an offbeat in the break)
    const off = kit.hats.filter((i) => slices[i].origStep % 4 === 2);
    kit.mainH = off.length ? off[0] : kit.hats[0];
    kit.altH = kit.hats.find((i) => i !== kit.mainH);
    if (kit.altH == null) kit.altH = kit.mainH;
    return kit;
  };

  function mk(s, v, extra) { return Object.assign({ s, v: v == null ? 1 : v, p: 0, r: false, roll: 1 }, extra || {}); }

  function asPlayed(kit, N, variant, rng) {
    const steps = [];
    for (let i = 0; i < N; i++) {
      const c = kit.startsAt[i % kit.srcSteps];
      steps.push(c != null ? mk(c, 1) : null);
    }
    const copy = (from, to, len) => { for (let k = 0; k < len; k++) if (to + k < N) steps[to + k] = steps[from + k] ? Object.assign({}, steps[from + k]) : null; };
    if (variant === 2) { for (let b = 16; b < N; b += 32) copy(b - 16, b, 16); }
    if (variant === 3) {
      // shuffle beats 2-4 of every bar, keep the downbeat
      const src = steps.map((x) => x && Object.assign({}, x));
      for (let bar = 0; bar < N; bar += 16) {
        for (let beat = 1; beat < 4; beat++) {
          const from = bar + rng.int(4) * 4;
          for (let k = 0; k < 4; k++) steps[bar + beat * 4 + k] = src[(from + k) % N] && Object.assign({}, src[(from + k) % N]);
        }
      }
    }
    if (variant === 4) {
      // stutter the last beat of every 2 bars
      for (let b = 28; b < N; b += 32) { copy(b, b + 2, 2); if (steps[b + 2]) steps[b + 2].roll = 2; }
    }
    if (variant === 5) {
      // second bar jumps to the second half of the break
      for (let i = 16; i < N; i += 32) {
        for (let k = 0; k < 16 && i + k < N; k++) {
          const c = kit.startsAt[(i + 8 + k) % kit.srcSteps];
          steps[i + k] = c != null ? mk(c, 1) : null;
        }
      }
    }
    return steps;
  }

  function fromTemplate(kit, slices, tmpl, N, density, rng) {
    const steps = new Array(N).fill(null);
    const altKs = kit.K.filter((i) => i !== kit.mainK), altSs = kit.S.filter((i) => i !== kit.mainS);
    // pick the alternates once so a pattern keeps a consistent sound
    const altK = altKs.length ? rng.pick(altKs) : kit.mainK;
    const altS = altSs.length ? rng.pick(altSs) : kit.mainS;
    const ghostVel = kit.G.length ? 0.8 : 0.4;
    let anchor = null;
    for (let i = 0; i < N; i++) {
      const ch = tmpl[i % tmpl.length];
      let st = null;
      switch (ch) {
        case 'K': st = mk(kit.mainK, 1); break;
        case 'k': st = mk(altK, 0.85); break;
        case 'S': st = mk(kit.mainS, 1); break;
        case 's': st = mk(altS, 0.8); break;
        case 'g': st = mk(kit.mainG, ghostVel); break;
        case 'h': st = mk(kit.mainH, 0.8); break;
        case 'r': st = mk(kit.mainS, 0.9, { r: true }); break;
        case '-': st = null; break;
        default: {
          if (density <= 0) break;
          const pos = i % 4; // 0 on the beat, 2 offbeat 8th, 1/3 sixteenths
          // continue the original break from the last hit (hats/ghosts only, never K/S)
          if (anchor && (pos === 2 || density > 0.5)) {
            const target = (slices[anchor.s].origStep + (i - anchor.i)) % kit.srcSteps;
            const c = kit.startsAt[target];
            if (c != null && slices[c].label !== 'K' && slices[c].label !== 'S' && rng() < density * 0.8) {
              st = mk(c, pos === 2 ? 0.9 : 0.7);
              break;
            }
          }
          // otherwise a steady hat: offbeat 8ths first, then on-beats, then 16ths
          if (pos === 2 && rng() < Math.min(1, density * 1.6)) st = mk(kit.mainH, 0.85);
          else if (pos === 0 && rng() < density * 0.5) st = mk(kit.mainH, 0.65);
          else if (pos % 2 === 1 && rng() < Math.max(0, (density - 0.5) * 1.4)) st = mk(kit.altH, 0.5);
        }
      }
      steps[i] = st;
      if (st && ch !== '.') anchor = { s: st.s, i };
    }
    return steps;
  }

  function applyChaos(steps, kit, slices, chaos, rng) {
    if (chaos <= 0) return;
    const N = steps.length;
    // jungle-style beat swaps: drop a random beat of the original break into place
    for (let b = 4; b < N; b += 4) {
      if (b % 16 === 0 || !rng.chance(chaos * 0.22)) continue;
      const from = rng.int(Math.max(1, Math.floor(kit.srcSteps / 4))) * 4;
      for (let k = 0; k < 4; k++) {
        const c = kit.startsAt[(from + k) % kit.srcSteps];
        steps[b + k] = c != null ? mk(c, 1) : null;
      }
    }
    steps.forEach((st, i) => {
      if (!st) return;
      const lbl = slices[st.s].label;
      if (lbl === 'S' && i % 8 === 4) {
        const altS = kit.S.filter((x) => x !== st.s);
        if (altS.length && rng.chance(chaos * 0.15)) st.s = rng.pick(altS);
        return;
      }
      if (i % 16 === 0) return;
      if (rng.chance(chaos * 0.1)) st.roll = rng.pick(i % 16 >= 12 ? [2, 3, 4] : [2, 2, 3]);
      if (rng.chance(chaos * 0.05)) st.r = true;
      if ((lbl === 'H' || lbl === 'G') && rng.chance(chaos * 0.12)) st.p = rng.pick([-12, -5, -2, 3, 5, 7, 12]);
    });
  }

  // Snare fill on the last beat ending at step `end` (exclusive).
  function applyFill(steps, kit, rng, variant, end) {
    const N = end, S = kit.mainS;
    const g = kit.ghosts[0];
    const fills = [
      [mk(S, 0.55), mk(S, 0.7), mk(S, 0.85, { roll: 2 }), mk(S, 1, { roll: 4 })],
      [mk(g, 0.45), mk(g, 0.55), mk(S, 0.9, { roll: 2 }), mk(S, 1, { roll: 3 })],
      [mk(S, 1), null, mk(S, 0.9, { r: true }), mk(S, 1, { roll: 2 })],
      [mk(kit.mainK, 1), mk(S, 0.8, { roll: 3 }), null, mk(S, 1, { roll: 4, p: 2 })],
      [mk(S, 0.6, { p: -2 }), mk(S, 0.7, { p: 0 }), mk(S, 0.85, { p: 2 }), mk(S, 1, { p: 4, roll: 2 })],
    ];
    const f = fills[(variant - 1 + rng.int(2)) % fills.length];
    for (let k = 0; k < 4; k++) steps[N - 4 + k] = f[k] && Object.assign({}, f[k]);
  }

  // opts: { style, variant, bars, density, chaos, fill, salt, prev }
  BT.generate = function (slices, srcSteps, opts) {
    const N = opts.bars * 16;
    const pat = { steps: [], locks: new Array(N).fill(false), style: opts.style, variant: opts.variant, edited: false };
    if (!slices.length) { pat.steps = Array.from({ length: N }, () => []); return pat; }
    const kit = BT.analyzeKit(slices, srcSteps);
    const rng = BT.rng(BT.hash(opts.style + ':' + opts.variant + ':' + (opts.salt || 0)));
    let steps;
    if (opts.style === 'asplayed') steps = asPlayed(kit, N, opts.variant, rng);
    else {
      const density = opts.style === 'roller' ? Math.max(opts.density, 0.65) : opts.density;
      steps = fromTemplate(kit, slices, T[opts.style][opts.variant - 1], N, density, rng);
    }
    applyChaos(steps, kit, slices, opts.chaos, rng);
    // DnB phrasing: fills land at the end of every 8 bars and at the end of the pattern
    if (opts.fill && N >= 8) {
      for (let end = 128; end < N; end += 128) applyFill(steps, kit, rng, opts.variant, end);
      applyFill(steps, kit, rng, opts.variant, N);
    }
    pat.steps = steps.map((st) => (st ? [st] : []));
    // keep locked steps from the previous pattern
    const prev = opts.prev;
    if (prev) {
      for (let i = 0; i < N && i < prev.steps.length; i++) {
        if (prev.locks[i]) { pat.steps[i] = BT.copyStep(prev.steps[i]); pat.locks[i] = true; }
      }
    }
    return pat;
  };

  BT.copyStep = function (step) { return (step || []).map((h) => Object.assign({}, h)); };

  // Small random edits that keep the groove: swaps within type, ghosts, rolls, pitch, reverse.
  BT.mutate = function (pat, slices, srcSteps, chaos, seed) {
    const kit = BT.analyzeKit(slices, srcSteps);
    const rng = BT.rng(seed);
    const amt = 0.12 + chaos * 0.3;
    pat.steps = pat.steps.map((step, i) => {
      if (pat.locks[i] || !rng.chance(amt)) return step;
      const anchorPos = i % 4 === 0;
      if (!step.length) {
        if (anchorPos) return step;
        return [rng.chance(0.5) ? mk(rng.pick(kit.ghosts), 0.4) : mk(rng.pick(kit.hats), 0.7)];
      }
      const out = BT.copyStep(step);
      const j = rng.int(out.length), n = out[j];
      const lbl = slices[n.s] ? slices[n.s].label : 'H';
      if (anchorPos && (lbl === 'K' || lbl === 'S') && rng.chance(0.75)) return step;
      switch (rng.int(6)) {
        case 0: { const pool = kit[lbl] && kit[lbl].length > 1 ? kit[lbl] : kit.hats; n.s = rng.pick(pool); break; }
        case 1: n.roll = n.roll > 1 ? 1 : rng.pick([2, 3, 4]); break;
        case 2: n.p = n.p ? 0 : rng.pick([-12, -7, -5, 5, 7, 12]); break;
        case 3: n.r = !n.r; break;
        case 4: {
          // layer a hat or ghost under the hit
          const layer = rng.pick(lbl === 'H' ? kit.ghosts : kit.hats);
          if (!out.some((h) => h.s === layer)) out.push(mk(layer, 0.5));
          break;
        }
        default: if (lbl !== 'K' && lbl !== 'S') out.splice(j, 1); else n.v = Math.max(0.3, n.v * 0.6);
      }
      // a slice appears at most once per step
      return out.filter((h, k) => out.findIndex((x) => x.s === h.s) === k);
    });
    pat.edited = true;
    return pat;
  };

  // MIDI notes: C1 (36) + slice index.
  BT.patternToMidiEvents = function (patterns) {
    const ev = [];
    let base = 0;
    patterns.forEach((pat) => {
      const N = pat.steps.length;
      pat.steps.forEach((step, i) => {
        if (!step.length) return;
        let next = 1;
        while (next < N - i && !pat.steps[i + next].length) next++;
        step.forEach((st) => {
          const n = st.roll || 1;
          for (let k = 0; k < n; k++) {
            ev.push({ step: base + i + k / n, len: n > 1 ? 1 / n : Math.min(next, 4), note: 36 + st.s, vel: st.v });
          }
        });
      });
      base += N;
    });
    return { events: ev, total: base };
  };
})(window.BT);
