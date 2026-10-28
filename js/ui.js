// UI: controls, waveform editor, step grid, lanes, pads, exports, keyboard.
(function (BT) {
  'use strict';
  const S = BT.S, E = BT.engine;
  const $ = (sel, el) => (el || document).querySelector(sel);
  const $$ = (sel, el) => Array.from((el || document).querySelectorAll(sel));
  const LABELS = ['K', 'S', 'H', 'G', 'C'];
  const LCOL = { K: '#ff9f43', S: '#ff5e57', H: '#6fd3ff', G: '#c9a6ff', C: '#ffd166' };
  const PAD_KEYS = ['1', '2', '3', '4', 'q', 'w', 'e', 'r', 'a', 's', 'd', 'f', 'z', 'x', 'c', 'v'];
  const dpr = () => window.devicePixelRatio || 1;
  let srcSteps = 64, padBank = 0, dirty = true;

  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 1800);
  }

  // ---------- state access ----------
  function get(key) {
    if (key.startsWith('slice.')) {
      const sl = S.slices[S.sel];
      return sl ? sl[key.slice(6)] : { pitch: 0, gain: 1, pan: 0, decay: 1, rev: false, sc: false }[key.slice(6)];
    }
    if (key === 'bits12') return S.bits === 12;
    if (key === 'bits8') return S.bits === 8;
    return S[key];
  }
  // ---------- undo / redo ----------
  // Snapshots of everything an edit can change (patterns, slices, pattern settings).
  // Calls with the same tag in quick succession (a knob drag, a paint stroke) merge into one step.
  const UNDO_LIMIT = 25;
  const UNDO_FIELDS = ['patterns', 'slices', 'editSlot', 'sel', 'manual', 'style', 'variant', 'patLen', 'origBpm', 'bars',
    'sliceMode', 'evenCount', 'sensitivity', 'density', 'chaos', 'variety', 'fill', 'seedSalt', 'fillType', 'fillLen', 'fillEvery', 'stampPos'];
  const UNDO_KEYS = ['sliceMode', 'evenCount', 'sensitivity', 'bars', 'density', 'chaos', 'variety', 'fill', 'patLen', 'fillType', 'fillLen', 'fillEvery'];
  const undoStack = [], redoStack = [];
  let lastTag = null, lastTagTime = 0;
  function snapshot() {
    const snap = {};
    UNDO_FIELDS.forEach((f) => { snap[f] = S[f]; });
    return JSON.stringify(snap);
  }
  function checkpoint(tag) {
    if (!S.src) return;
    const now = performance.now();
    if (tag && tag === lastTag && now - lastTagTime < 800) { lastTagTime = now; return; }
    lastTag = tag; lastTagTime = now;
    undoStack.push(snapshot());
    if (undoStack.length > UNDO_LIMIT) undoStack.shift();
    redoStack.length = 0;
    refreshUndoButtons();
  }
  function restore(json) {
    Object.assign(S, JSON.parse(json));
    computeSteps();
    lastTag = null;
    waveStaticDirty = true; dirty = true;
    refreshControls();
    refreshUndoButtons();
  }
  function undo() {
    if (!undoStack.length) { toast('Nothing to undo'); return; }
    redoStack.push(snapshot());
    restore(undoStack.pop());
    toast('Undo (' + undoStack.length + ' left)');
  }
  function redo() {
    if (!redoStack.length) { toast('Nothing to redo'); return; }
    undoStack.push(snapshot());
    restore(redoStack.pop());
    toast('Redo');
  }
  function clearHistory() { undoStack.length = 0; redoStack.length = 0; lastTag = null; refreshUndoButtons(); }
  function refreshUndoButtons() {
    $('#undoBtn').disabled = !undoStack.length;
    $('#redoBtn').disabled = !redoStack.length;
  }

  function set(key, v) {
    // knob drags merge into one undo step; button clicks are one step each
    const continuous = typeof v === 'number' && !!document.querySelector('.knob[data-key="' + key + '"]');
    if (key.startsWith('slice.') || UNDO_KEYS.includes(key)) checkpoint(continuous ? key + ':' + S.sel : null);
    if (key.startsWith('slice.')) { const sl = S.slices[S.sel]; if (sl) sl[key.slice(6)] = v; }
    else if (key === 'bits12') S.bits = v ? 12 : 16;
    else if (key === 'bits8') S.bits = v ? 8 : 16;
    else S[key] = v;
    react(key);
    refreshControls();
    dirty = true;
  }

  function react(key) {
    switch (key) {
      case 'evenCount': S.sliceMode = 'even'; // fallthrough
      case 'sliceMode': case 'sensitivity':
        if (S.locked) { toast('Cuts are locked'); break; }
        reslice(); break;
      case 'bars': applyBars(); break;
      case 'volume': case 'cutoff': case 'res': case 'drive': case 'comp': case 'room': case 'filterType':
      case 'lfoOn': case 'lfoRate': case 'lfoShape': case 'lfoDepth': case 'filterOn':
        E.updateChain(); break;
      case 'rate': case 'bits12': case 'bits8': case 'mono':
        E.rebuildProcessed(); waveStaticDirty = true; break;
      case 'density': case 'chaos': case 'variety': case 'fill': regenerate(S.editSlot); break;
      case 'stamp': if (S.stamp) startStamp(); else toast('CHOP STAMP off'); break;
      case 'fillType': case 'fillLen': case 'fillEvery': S.fill = true; regenerate(S.editSlot); break;
      case 'patLen': resizePattern(); break;
    }
  }

  // ---------- knobs ----------
  function fmtKnob(el, v) {
    const f = el.dataset.fmt, unit = el.dataset.unit;
    if (f === 'hz') { const hz = 20 * Math.pow(2, v * 10); return hz >= 1000 ? (hz / 1000).toFixed(1) + 'k' : Math.round(hz) + ''; }
    if (f === 'pan') return Math.abs(v) < 0.02 ? 'C' : (v < 0 ? 'L' : 'R') + Math.round(Math.abs(v) * 100);
    if (unit === 'st') return (v > 0 ? '+' : '') + Math.round(v) + 'st';
    return Math.round(v * 100) + '';
  }
  function initKnobs() {
    $$('.knob').forEach((el) => {
      el.innerHTML = '<div class="dial"></div><div class="kl">' + el.dataset.label + '</div><div class="kv"></div>';
      const dial = $('.dial', el);
      const min = +el.dataset.min, max = +el.dataset.max, step = +(el.dataset.step || 0);
      const key = el.dataset.key;
      const setV = (v) => {
        v = Math.max(min, Math.min(max, v));
        if (step) v = Math.round(v / step) * step;
        if (v !== get(key)) set(key, v);
      };
      let startY = 0, startV = 0, raw = 0;
      dial.addEventListener('pointerdown', (e) => {
        if (key.startsWith('slice.') && !S.slices.length) return;
        dial.setPointerCapture(e.pointerId);
        startY = e.clientY; startV = get(key); raw = startV;
      });
      dial.addEventListener('pointermove', (e) => {
        if (!dial.hasPointerCapture(e.pointerId)) return;
        const range = max - min, sens = e.shiftKey ? 600 : 160;
        raw = startV + ((startY - e.clientY) / sens) * range;
        setV(raw);
      });
      dial.addEventListener('dblclick', () => setV(+el.dataset.def));
      dial.addEventListener('wheel', (e) => {
        e.preventDefault();
        const d = step || (max - min) / 100;
        setV(get(key) + (e.deltaY < 0 ? d : -d));
      }, { passive: false });
    });
  }
  function refreshKnobs() {
    $$('.knob').forEach((el) => {
      const min = +el.dataset.min, max = +el.dataset.max, v = get(el.dataset.key);
      const ang = -135 + (270 * (v - min)) / (max - min);
      $('.dial', el).style.transform = 'rotate(' + ang + 'deg)';
      $('.kv', el).textContent = fmtKnob(el, v);
    });
  }

  // ---------- segmented buttons / toggles ----------
  function initSegs() {
    $$('.seg[data-key]').forEach((seg) => {
      const key = seg.dataset.key, num = seg.hasAttribute('data-num');
      $$('button', seg).forEach((b) => b.addEventListener('click', () => set(key, num ? +b.dataset.v : b.dataset.v)));
    });
    $$('button.toggle[data-key]').forEach((b) => b.addEventListener('click', () => {
      const key = b.dataset.key;
      if (key.startsWith('slice.') && !S.slices.length) return;
      set(key, !get(key));
    }));
  }
  function refreshControls() {
    $$('.seg[data-key]').forEach((seg) => {
      const v = get(seg.dataset.key);
      $$('button', seg).forEach((b) => b.classList.toggle('on', String(v) === b.dataset.v));
    });
    $$('button.toggle[data-key]').forEach((b) => b.classList.toggle('on', !!get(b.dataset.key)));
    $$('.seg[data-key="evenCount"] button').forEach((b) => { b.disabled = S.sliceMode !== 'even'; });
    $('#lockBtn').classList.toggle('on', S.locked);
    $('#repitchBtn').classList.toggle('on', S.repitch);
    $('#recBtn').classList.toggle('rec-on', S.recording);
    $('#playBtn').textContent = S.playing ? 'STOP' : 'PLAY';
    $$('#slotSeg button').forEach((b) => {
      const i = +b.dataset.v;
      b.classList.toggle('on', i === S.editSlot);
      b.style.opacity = S.patterns[i] && S.patterns[i].steps.some((x) => x.length) ? 1 : 0.6;
    });
    const sl = S.slices[S.sel];
    $('#selName').textContent = sl ? String(S.sel + 1).padStart(2, '0') + ' · ' + sl.label : '--';
    $$('#labelSeg button').forEach((b) => b.classList.toggle('on', !!sl && sl.label === b.dataset.v));
    $('#origBpm').value = S.origBpm.toFixed(1);
    if (document.activeElement !== $('#songBpm')) $('#songBpm').value = S.songBpm.toFixed(1);
    const pat = S.patterns[S.editSlot];
    $$('.style').forEach((el) => {
      const active = pat && pat.style === el.dataset.style;
      $('.main', el).classList.toggle('on', !!active);
      $$('.vars button', el).forEach((b) => b.classList.toggle('on', !!active && +b.dataset.v === pat.variant));
    });
    $('#laneHint').textContent = {
      vel: 'Drag to set hit velocity', chance: 'Drag down to make hits play only some of the time', pitch: 'Drag to pitch individual hits (±12 st)',
      roll: 'Drag to ratchet a hit into 2/3/4 rolls', rev: 'Click to reverse individual hits',
    }[S.lane];
    refreshKnobs();
    renderPads();
    renderPager();
  }

  // ---------- style buttons ----------
  function initStyles() {
    const wrap = $('#styles');
    BT.STYLES.forEach((st) => {
      const el = document.createElement('div');
      el.className = 'style'; el.dataset.style = st.id;
      el.innerHTML = '<div class="sub">' + st.sub + '</div><button class="btn main">' + st.name + '</button><div class="vars">' +
        Array.from({ length: BT.VARIANTS }, (_, k) => k + 1).map((v) => '<button class="btn" data-v="' + v + '">' + v + '</button>').join('') + '</div>';
      $('.main', el).addEventListener('click', () => { checkpoint(); S.style = st.id; regenerate(S.editSlot); refreshControls(); });
      $$('.vars button', el).forEach((b) => b.addEventListener('click', () => {
        checkpoint(); S.style = st.id; S.variant = +b.dataset.v; regenerate(S.editSlot); refreshControls();
      }));
      wrap.appendChild(el);
    });
  }

  // ---------- loading ----------
  async function loadFiles(files) {
    E.init();
    let first = -1;
    for (const f of files) {
      try {
        const ab = await f.arrayBuffer();
        const buffer = await E.ctx.decodeAudioData(ab);
        S.breaks.push({ name: f.name.replace(/\.[^.]+$/, ''), buffer });
        if (first < 0) first = S.breaks.length - 1;
      } catch (err) { toast('Could not decode ' + f.name); }
    }
    renderBreakList();
    if (first >= 0) selectBreak(first);
  }
  BT.loadURL = async function (url) {
    const r = await fetch(url);
    const blob = await r.blob();
    blob.name = decodeURIComponent(url.split('/').pop());
    await loadFiles([blob]);
  };
  function renderBreakList() {
    $('#breakSelect').innerHTML = S.breaks.map((b, i) => '<option value="' + i + '">' + b.name + '</option>').join('');
    $('#breakSelect').value = S.current;
  }
  function selectBreak(i) {
    const b = S.breaks[i];
    if (!b) return;
    if (S.playing) E.stop();
    E.resetDefaults(); // every import starts clean: 120 BPM, no FX, no crunch, fresh patterns
    S.current = i; S.src = b.buffer; S.name = b.name;
    $('#breakSelect').value = i;
    $('#dropHint').style.display = 'none';
    applyBars(true);
    E.rebuildProcessed();
    S.view = { a: 0, b: S.src.length };
    S.locked = false;
    reslice(true);
    clearHistory();
    refreshControls();
  }

  function applyBars(silent) {
    if (!S.src) return;
    const secs = S.src.length / S.src.sampleRate;
    S.origBpm = Math.round(BT.estimateBpm(secs, S.bars) * 10) / 10;
    computeSteps();
    if (!silent) { regenerateAll(); waveStaticDirty = true; }
  }

  // ---------- slicing ----------
  function computeSteps() {
    if (!S.src) return;
    const sr = S.src.sampleRate, stepSec = 60 / S.origBpm / 4;
    S.slices.forEach((sl) => { sl.origStep = Math.round(sl.pos / sr / stepSec); });
    srcSteps = Math.max(1, Math.round(S.src.length / sr / stepSec));
  }

  function makeSlice(pos, info) {
    return { pos, label: info.label, rms: info.rms, pitch: 0, gain: 1, pan: 0, decay: 1, rev: false, sc: false, origStep: 0 };
  }

  function reslice() {
    if (!S.src) return;
    const pos = S.sliceMode === 'even'
      ? BT.evenSlices(S.src.length, S.evenCount)
      : BT.detectOnsets(S.src, S.sensitivity, S.origBpm);
    const info = BT.classify(S.src, pos);
    S.slices = pos.map((p, i) => makeSlice(p, info[i]));
    S.manual = false;
    S.sel = Math.min(S.sel, S.slices.length - 1);
    computeSteps();
    regenerateAll(true);
    waveStaticDirty = true; dirty = true;
  }

  function reclassify(i) {
    S.slices[i].rms = BT.classify(S.src, S.slices.map((s) => s.pos))[i].rms;
  }

  function remapPatterns(fn) {
    S.patterns.forEach((p) => {
      if (!p) return;
      p.steps = p.steps.map((step) => step
        .map((h) => { const s = fn(h.s); return s == null ? null : Object.assign(h, { s }); })
        .filter((h) => h));
    });
  }

  function addMarker(pos) {
    pos = Math.round(pos);
    let k = S.slices.findIndex((s) => s.pos > pos);
    if (k < 0) k = S.slices.length;
    if ((k > 0 && pos - S.slices[k - 1].pos < 64) || (k < S.slices.length && S.slices[k].pos - pos < 64)) return;
    checkpoint();
    const info = BT.classify(S.src, [pos])[0];
    S.slices.splice(k, 0, makeSlice(pos, info));
    remapPatterns((s) => (s >= k ? s + 1 : s));
    S.manual = true; S.sel = k;
    computeSteps();
    waveStaticDirty = true; dirty = true; refreshControls();
  }
  function deleteMarker(k) {
    if (k <= 0 || k >= S.slices.length) return;
    checkpoint();
    S.slices.splice(k, 1);
    remapPatterns((s) => (s === k ? null : s > k ? s - 1 : s));
    S.manual = true; S.sel = Math.max(0, k - 1);
    computeSteps();
    waveStaticDirty = true; dirty = true; refreshControls();
  }

  // ---------- patterns ----------
  function genOpts(style, variant, prev) {
    return { style, variant, bars: S.patLen, density: S.density, chaos: S.chaos, variety: S.variety, fill: S.fill,
      fillType: S.fillType, fillLen: S.fillLen, fillEvery: S.fillEvery, salt: S.seedSalt, prev };
  }
  function regenerate(slot) {
    if (!S.slices.length) return;
    S.patterns[slot] = BT.generate(S.slices, srcSteps, genOpts(S.style, S.variant, S.patterns[slot]));
    dirty = true; refreshControls();
  }
  function regenerateAll(dropLocks) {
    S.patterns = S.patterns.map((p, i) => {
      if (!p && i !== S.editSlot) return null;
      const style = p ? p.style : S.style, variant = p ? p.variant : S.variant;
      return BT.generate(S.slices, srcSteps, genOpts(style, variant, dropLocks ? null : p));
    });
    dirty = true;
  }
  function resizePattern() {
    const p = S.patterns[S.editSlot];
    if (!p) return;
    if (!p.edited) { regenerate(S.editSlot); return; }
    const N = S.patLen * 16 * BT.RES, old = p.steps.length;
    const steps = [], locks = [];
    for (let i = 0; i < N; i++) {
      steps.push(BT.copyStep(p.steps[i % old]));
      locks.push(i < old ? p.locks[i] : false);
    }
    p.steps = steps; p.locks = locks; dirty = true;
  }
  const curPat = () => S.patterns[S.editSlot];

  // ---------- waveform ----------
  const wave = $('#wave'), wctx = wave.getContext('2d');
  const TOP = 20, BOTTOM = 18, BOXW = 30;
  let waveStatic = document.createElement('canvas'), waveStaticDirty = true;
  let hot = null; // currently sounding slice {slice, end}
  let drag = null;

  const xToS = (x, W) => S.view.a + (x / W) * (S.view.b - S.view.a);
  const sToX = (s, W) => ((s - S.view.a) / (S.view.b - S.view.a)) * W;

  function drawWaveStatic(W, H) {
    waveStatic.width = wave.width; waveStatic.height = wave.height;
    const c = waveStatic.getContext('2d');
    c.setTransform(dpr(), 0, 0, dpr(), 0, 0);
    c.fillStyle = '#142012'; c.fillRect(0, 0, W, H);
    if (!S.proc) return;
    const sr = S.src.sampleRate, stepS = (60 / S.origBpm / 4) * sr;
    const pxPerStep = (stepS / (S.view.b - S.view.a)) * W;
    // beat grid
    for (let st = Math.floor(S.view.a / stepS); st * stepS < S.view.b; st++) {
      const x = sToX(st * stepS, W);
      if (st % 16 === 0) c.strokeStyle = '#3f5c35';
      else if (st % 4 === 0) c.strokeStyle = '#2b4225';
      else if (pxPerStep > 8) c.strokeStyle = '#1c2c19';
      else continue;
      c.beginPath(); c.moveTo(x + 0.5, TOP); c.lineTo(x + 0.5, H - BOTTOM); c.stroke();
      if (st % 16 === 0) { c.fillStyle = '#5d8a52'; c.font = '10px Consolas'; c.fillText(String(st / 16 + 1), x + 3, H - BOTTOM - 4); }
    }
    // peaks
    const chs = []; for (let k = 0; k < S.proc.numberOfChannels; k++) chs.push(S.proc.getChannelData(k));
    const mid = TOP + (H - TOP - BOTTOM) / 2, amp = (H - TOP - BOTTOM) / 2 - 2;
    c.fillStyle = '#8ee27a';
    const spp = (S.view.b - S.view.a) / W;
    for (let x = 0; x < W; x++) {
      const a = Math.floor(S.view.a + x * spp), b = Math.max(a + 1, Math.floor(S.view.a + (x + 1) * spp));
      let mn = 0, mx = 0;
      const stride = Math.max(1, Math.floor((b - a) / 64));
      for (let i = a; i < b && i < S.proc.length; i += stride) {
        let v = 0; for (let k = 0; k < chs.length; k++) v += chs[k][i]; v /= chs.length;
        if (v < mn) mn = v; if (v > mx) mx = v;
      }
      c.fillRect(x, mid - mx * amp, 1, Math.max(1, (mx - mn) * amp));
    }
    waveStaticDirty = false;
  }

  function drawWave() {
    const W = wave.clientWidth, H = wave.clientHeight;
    if (wave.width !== Math.round(W * dpr()) || wave.height !== Math.round(H * dpr())) {
      wave.width = Math.round(W * dpr()); wave.height = Math.round(H * dpr()); waveStaticDirty = true;
    }
    if (waveStaticDirty) drawWaveStatic(W, H);
    wctx.setTransform(1, 0, 0, 1, 0, 0);
    wctx.drawImage(waveStatic, 0, 0);
    wctx.setTransform(dpr(), 0, 0, dpr(), 0, 0);
    if (!S.src) return;
    const now = E.ctx ? E.ctx.currentTime : 0;
    // sounding slice + selection
    S.slices.forEach((sl, i) => {
      const x0 = sToX(sl.pos, W), x1 = sToX(E.sliceEnd(i), W);
      if (x1 < 0 || x0 > W) return;
      if (hot && hot.slice === i && now < hot.end) { wctx.fillStyle = 'rgba(210,60,44,.45)'; wctx.fillRect(x0, TOP, x1 - x0, H - TOP - BOTTOM); }
      if (i === S.sel) { wctx.fillStyle = 'rgba(184,227,90,.10)'; wctx.fillRect(x0, TOP, x1 - x0, H - TOP - BOTTOM); }
    });
    // markers
    wctx.font = 'bold 10px Consolas';
    wctx.fillStyle = '#0d150b'; wctx.fillRect(0, 0, W, TOP);
    S.slices.forEach((sl, i) => {
      const x = sToX(sl.pos, W);
      if (x < -BOXW || x > W) return;
      const col = LCOL[sl.label] || '#ccc';
      wctx.strokeStyle = col; wctx.globalAlpha = 0.7;
      wctx.beginPath(); wctx.moveTo(x + 0.5, TOP); wctx.lineTo(x + 0.5, H - BOTTOM); wctx.stroke();
      wctx.globalAlpha = 1;
      wctx.fillStyle = i === S.sel ? col : '#1f2f1a';
      wctx.fillRect(x, 2, BOXW - 2, TOP - 4);
      wctx.strokeStyle = col; wctx.strokeRect(x + 0.5, 2.5, BOXW - 3, TOP - 5);
      wctx.fillStyle = i === S.sel ? '#111' : col;
      wctx.fillText((i + 1) + sl.label, x + 3, TOP - 6);
    });
    // footer
    wctx.fillStyle = '#0d150b'; wctx.fillRect(0, H - BOTTOM, W, BOTTOM);
    wctx.fillStyle = '#b8e35a'; wctx.font = 'bold 11px Consolas';
    const bars = BT.barsFor(S.src.length / S.src.sampleRate, S.origBpm);
    wctx.fillText(S.slices.length + ' HITS   ' + bars + ' BARS' + (S.manual ? '   EDITED' : '') + (S.locked ? '   LOCKED' : ''), 6, H - 5);
    const nm = S.name.toUpperCase();
    wctx.fillText(nm, W - wctx.measureText(nm).width - 6, H - 5);
    // scrollbar
    const thumb = $('#thumb'), bw = $('#scrollbar').clientWidth;
    thumb.style.left = (S.view.a / S.src.length) * bw + 'px';
    thumb.style.width = ((S.view.b - S.view.a) / S.src.length) * bw + 'px';
  }

  function markerAt(x, W) {
    for (let i = S.slices.length - 1; i >= 0; i--) {
      const mx = sToX(S.slices[i].pos, W);
      if (x >= mx - 2 && x <= mx + BOXW) return i;
    }
    return -1;
  }
  const sliceAtSample = (s) => {
    let k = 0;
    for (let i = 0; i < S.slices.length; i++) if (S.slices[i].pos <= s) k = i;
    return k;
  };

  function selectSlice(i, play) {
    if (i < 0 || i >= S.slices.length) return;
    S.sel = i;
    if (play) { const v = E.preview(i); if (v) hot = { slice: i, end: v.end }; flashPad(i); }
    refreshControls(); dirty = true;
  }

  wave.addEventListener('pointerdown', (e) => {
    if (!S.src || e.button !== 0) return;
    const r = wave.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, W = r.width;
    if (y < TOP) {
      const i = markerAt(x, W);
      if (i < 0) return;
      if (e.altKey) { deleteMarker(i); return; }
      selectSlice(i, true);
      if (i > 0 && !S.locked) { drag = { i, moved: false }; wave.setPointerCapture(e.pointerId); }
    } else {
      const i = sliceAtSample(xToS(x, W));
      selectSlice(i, true);
      if (S.stamp) stampChop(i);
    }
  });
  wave.addEventListener('pointermove', (e) => {
    const r = wave.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    wave.style.cursor = y < TOP && markerAt(x, r.width) >= 0 ? 'ew-resize' : 'crosshair';
    if (!drag) return;
    if (!drag.moved) checkpoint();
    const i = drag.i, lo = S.slices[i - 1].pos + 64, hi = i + 1 < S.slices.length ? S.slices[i + 1].pos - 64 : S.src.length - 64;
    S.slices[i].pos = Math.round(Math.max(lo, Math.min(hi, xToS(x, r.width))));
    drag.moved = true; dirty = true;
  });
  wave.addEventListener('pointerup', () => {
    if (drag && drag.moved) { S.manual = true; reclassify(drag.i); computeSteps(); }
    drag = null;
  });
  wave.addEventListener('dblclick', (e) => {
    if (!S.src || S.locked) return;
    const r = wave.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    if (y < TOP && markerAt(x, r.width) < 0) addMarker(xToS(x, r.width));
  });
  wave.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (!S.src) return;
    const r = wave.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    const i = y < TOP ? markerAt(x, r.width) : sliceAtSample(xToS(x, r.width));
    if (i < 0) return;
    checkpoint();
    const sl = S.slices[i];
    sl.label = LABELS[(LABELS.indexOf(sl.label) + 1) % LABELS.length];
    S.sel = i; refreshControls(); dirty = true;
  });
  wave.addEventListener('wheel', (e) => {
    if (!S.src) return;
    e.preventDefault();
    const r = wave.getBoundingClientRect(), W = r.width;
    const span = S.view.b - S.view.a, len = S.src.length;
    if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      const d = ((e.deltaX || e.deltaY) / W) * span;
      const a = Math.max(0, Math.min(len - span, S.view.a + d));
      S.view = { a, b: a + span };
    } else {
      const at = xToS(e.clientX - r.left, W), f = e.deltaY < 0 ? 0.8 : 1.25;
      const ns = Math.max(512, Math.min(len, span * f));
      let a = at - ((at - S.view.a) / span) * ns;
      a = Math.max(0, Math.min(len - ns, a));
      S.view = { a, b: a + ns };
    }
    waveStaticDirty = true; dirty = true;
  }, { passive: false });

  // scrollbar
  (function () {
    const thumb = $('#thumb'); let start = null;
    thumb.addEventListener('pointerdown', (e) => { thumb.setPointerCapture(e.pointerId); start = { x: e.clientX, a: S.view.a }; });
    thumb.addEventListener('pointermove', (e) => {
      if (!start || !S.src) return;
      const span = S.view.b - S.view.a, bw = $('#scrollbar').clientWidth;
      const a = Math.max(0, Math.min(S.src.length - span, start.a + ((e.clientX - start.x) / bw) * S.src.length));
      S.view = { a, b: a + span }; waveStaticDirty = true; dirty = true;
    });
    thumb.addEventListener('pointerup', () => { start = null; });
  })();

  // ---------- step grid ----------
  // Patterns are stored on a 32nd-note grid. The view shows columns of S.gridRes steps
  // (1 = 1/32, 2 = 1/16, 4 = 1/8); hits that fall between columns still show, drawn narrower.
  const grid = $('#grid'), gctx = grid.getContext('2d');
  const GHEAD = 16, GLEFT = 52;
  const BEAT = 4 * BT.RES, BAR = 16 * BT.RES; // steps per beat / bar
  let playhead = null, gridDrag = null;

  // Long patterns are shown 4 bars (one page) at a time.
  const PAGE = 4 * BAR;
  function gridView() {
    const pat = curPat();
    const len = pat ? pat.steps.length : S.patLen * BAR;
    const pages = Math.max(1, Math.ceil(len / PAGE));
    S.gridPage = Math.max(0, Math.min(pages - 1, S.gridPage || 0));
    const res = S.gridRes, span = Math.min(PAGE, len);
    return { off: S.gridPage * PAGE, span, res, N: span / res, pages, len };
  }
  function gridGeom() {
    const n = Math.max(1, S.slices.length);
    const rh = Math.max(6, Math.min(16, Math.floor(320 / n)));
    const W = grid.parentElement.clientWidth;
    const v = gridView();
    return { n, rh, W, H: GHEAD + n * rh, N: v.N, off: v.off, res: v.res, span: v.span, cw: (W - GLEFT) / v.N };
  }
  function setPage(p) {
    const v = gridView();
    const np = Math.max(0, Math.min(v.pages - 1, p));
    if (np !== S.gridPage) { S.gridPage = np; dirty = true; }
    renderPager();
  }
  function renderPager() {
    const v = gridView();
    $('#pager').style.display = v.pages > 1 ? '' : 'none';
    const a = S.gridPage * 4 + 1;
    $('#pageLabel').textContent = 'BARS ' + a + '-' + Math.min(v.len / BAR, a + 3) + ' / ' + v.len / BAR;
    $('#followBtn').classList.toggle('on', S.follow);
  }
  // hits of one column (steps [idx, idx + res)) with their step index
  function colHits(pat, idx, res) {
    const out = [];
    for (let j = idx; j < idx + res && j < pat.steps.length; j++) {
      pat.steps[j].forEach((h) => { if (S.slices[h.s]) out.push({ h, j }); });
    }
    return out;
  }

  function drawGrid() {
    const g = gridGeom();
    if (grid.width !== Math.round(g.W * dpr()) || grid.height !== Math.round(g.H * dpr())) {
      grid.width = Math.round(g.W * dpr()); grid.height = Math.round(g.H * dpr()); grid.style.height = g.H + 'px';
    }
    const c = gctx;
    c.setTransform(dpr(), 0, 0, dpr(), 0, 0);
    c.fillStyle = '#142012'; c.fillRect(0, 0, g.W, g.H);
    const pat = curPat();
    const locked = (a) => pat && pat.locks.slice(a, a + g.res).some((x) => x);
    // beat shading
    for (let i = 0; i < g.N; i++) {
      const x = GLEFT + i * g.cw, a = g.off + i * g.res;
      c.fillStyle = Math.floor(a / BEAT) % 2 === 0 ? '#182a15' : '#142012';
      c.fillRect(x, GHEAD, g.cw, g.H - GHEAD);
      if (locked(a)) { c.fillStyle = 'rgba(255,209,102,.10)'; c.fillRect(x, GHEAD, g.cw, g.H - GHEAD); }
    }
    // rows
    c.font = 'bold ' + Math.min(10, g.rh - 1) + 'px Consolas';
    S.slices.forEach((sl, r) => {
      const y = GHEAD + r * g.rh;
      c.fillStyle = r === S.sel ? '#26381f' : r % 2 ? '#101a0e' : '#0d150b';
      c.fillRect(0, y, GLEFT - 2, g.rh);
      c.fillStyle = LCOL[sl.label];
      c.fillRect(0, y, 3, g.rh);
      if (g.rh >= 8) { c.fillStyle = r === S.sel ? '#b8e35a' : '#8aa57f'; c.fillText(String(r + 1).padStart(2, '0') + ' ' + sl.label + (sl.sc ? ' sc' : ''), 7, y + g.rh - 2); }
      c.strokeStyle = '#0f180d'; c.beginPath(); c.moveTo(GLEFT, y + 0.5); c.lineTo(g.W, y + 0.5); c.stroke();
    });
    // bar / beat / 16th lines
    for (let i = 0; i <= g.N; i++) {
      const a = g.off + i * g.res;
      if (a % BEAT && !(g.res === 1 && a % BT.RES === 0 && g.cw > 5)) continue;
      const x = Math.round(GLEFT + i * g.cw) + 0.5;
      c.strokeStyle = a % BAR === 0 ? '#4d6e42' : a % BEAT === 0 ? '#2b4225' : '#1b2b18';
      c.beginPath(); c.moveTo(x, a % BEAT ? GHEAD : 0); c.lineTo(x, g.H); c.stroke();
    }
    // header
    c.fillStyle = '#0d150b'; c.fillRect(GLEFT, 0, g.W - GLEFT, GHEAD);
    c.font = 'bold 9px Consolas';
    for (let i = 0; i < g.N; i++) {
      const x = GLEFT + i * g.cw, a = g.off + i * g.res;
      const lk = locked(a);
      if (lk) { c.fillStyle = '#ffd166'; c.fillRect(x + 1, 2, g.cw - 2, GHEAD - 4); }
      if (g.cw > 13 || a % BEAT === 0) {
        // bar number on the downbeat, beat number (2-4) on other beats
        c.fillStyle = lk ? '#111' : a % BAR === 0 ? '#b8e35a' : a % BEAT === 0 ? '#6f8f63' : '#4f6b46';
        c.fillText(a % BAR === 0 ? String(a / BAR + 1) : a % BEAT === 0 ? '.' + ((a % BAR) / BEAT + 1) : '·', x + 3, GHEAD - 4);
      }
    }
    c.fillStyle = '#8aa57f'; c.fillText(['A', 'B', 'C', 'D'][S.editSlot] + ' ' + (pat ? pat.steps.length / BAR : 0) + 'BAR', 4, GHEAD - 4);
    // CHOP STAMP cursor: where the next clicked chop will be written
    if (S.stamp && pat && S.stampPos < pat.steps.length && S.stampPos >= g.off && S.stampPos < g.off + g.span) {
      const cx = GLEFT + ((S.stampPos - g.off) / g.res) * g.cw;
      c.fillStyle = '#3fd36b';
      c.fillRect(cx - 1, 0, 3, g.H);
      c.beginPath(); c.moveTo(cx - 5, 0); c.lineTo(cx + 5, 0); c.lineTo(cx, 7); c.fill();
    }
    // playhead
    if (playhead && S.playing && playhead.slot === S.editSlot && playhead.step >= g.off && playhead.step < g.off + g.span) {
      c.fillStyle = 'rgba(210,60,44,.35)';
      c.fillRect(GLEFT + ((playhead.step - g.off) / g.res) * g.cw, 0, g.cw / g.res, g.H);
    }
    // cells: on-column hits fill the column, in-between hits draw at their own position
    if (!pat) return;
    pat.steps.slice(g.off, g.off + g.span).forEach((step, rel) => step.forEach((st) => {
      if (!S.slices[st.s]) return;
      const sub = rel % g.res, sw = g.cw / g.res;
      const x = GLEFT + (rel / g.res) * g.cw + 1, y = GHEAD + st.s * g.rh + 1;
      const w = (sub ? sw : g.cw) - 2, h = g.rh - 2;
      c.globalAlpha = (0.35 + 0.65 * st.v) * (st.c != null && st.c < 1 ? 0.45 + 0.55 * st.c : 1);
      c.fillStyle = LCOL[S.slices[st.s].label];
      c.fillRect(x, y, w, h);
      c.globalAlpha = 1;
      if (sub) { c.strokeStyle = '#eaffd0'; c.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1); }
      if (st.len > 1) {
        // stamped chop: a tail across the steps it holds
        const tw = Math.min(g.W - x - w, ((st.len - 1) / g.res) * g.cw);
        c.fillStyle = LCOL[S.slices[st.s].label];
        c.globalAlpha = 0.45;
        c.fillRect(x + w, y + h * 0.3, tw, Math.max(2, h * 0.4));
        c.globalAlpha = 1;
      }
      if (st.c != null && st.c < 1 && w > 6) { c.fillStyle = '#111'; c.fillRect(x + 1, y + h - 2, (w - 2) * st.c, 2); }
      if (st.roll > 1) {
        c.fillStyle = '#111';
        for (let k = 1; k < st.roll; k++) c.fillRect(x + (w * k) / st.roll, y, 1, h);
      }
      if (st.r) { c.fillStyle = '#111'; c.beginPath(); c.moveTo(x + 2, y + h / 2); c.lineTo(x + Math.min(8, w - 2), y + 1); c.lineTo(x + Math.min(8, w - 2), y + h - 1); c.fill(); }
      if (st.p && g.rh >= 10 && w > 14) { c.fillStyle = '#111'; c.font = 'bold 8px Consolas'; c.fillText((st.p > 0 ? '+' : '') + st.p, x + w - 14, y + h - 1); }
    }));
  }

  // c: visible column; idx: first step of that column
  function gridCell(e) {
    const r = grid.getBoundingClientRect(), g = gridGeom();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    const col = Math.floor((x - GLEFT) / g.cw);
    return { c: col, idx: g.off + col * g.res, row: Math.floor((y - GHEAD) / g.rh), head: y < GHEAD, left: x < GLEFT, g };
  }
  grid.addEventListener('pointerdown', (e) => {
    const pat = curPat();
    if (!pat || !S.slices.length) return;
    const p = gridCell(e);
    if (p.left) { if (p.row >= 0 && p.row < S.slices.length) selectSlice(p.row, true); return; }
    if (p.c < 0 || p.c >= p.g.N) return;
    if (p.head) {
      checkpoint();
      const on = !pat.locks.slice(p.idx, p.idx + p.g.res).some((x) => x);
      for (let j = p.idx; j < p.idx + p.g.res; j++) pat.locks[j] = on;
      dirty = true; return;
    }
    if (p.row < 0 || p.row >= S.slices.length) return;
    checkpoint();
    const has = colHits(pat, p.idx, p.g.res).some((o) => o.h.s === p.row);
    gridDrag = { mode: has ? 'erase' : 'paint', last: -1 };
    grid.setPointerCapture(e.pointerId);
    applyGrid(p);
    gridDrag.from = p;
    if (gridDrag.mode === 'paint') { S.sel = p.row; if (!S.playing) selectSlice(p.row, true); else refreshControls(); }
  });
  grid.addEventListener('pointermove', (e) => {
    if (!gridDrag) return;
    // fill every cell between pointer events so fast drags don't skip rows/steps
    const p = gridCell(e), from = gridDrag.from || p;
    const n = Math.max(Math.abs(p.c - from.c), Math.abs(p.row - from.row));
    for (let k = 1; k <= n; k++) {
      const c = Math.round(from.c + ((p.c - from.c) * k) / n);
      applyGrid({ c, idx: p.g.off + c * p.g.res, row: Math.round(from.row + ((p.row - from.row) * k) / n), g: p.g });
    }
    gridDrag.from = p;
  });
  grid.addEventListener('pointerup', () => { gridDrag = null; refreshControls(); });
  function applyGrid(p) {
    const pat = curPat();
    if (p.c < 0 || p.c >= p.g.N || p.idx >= pat.steps.length || p.row < 0 || p.row >= S.slices.length) return;
    const key = p.idx * 1000 + p.row;
    if (key === gridDrag.last) return;
    gridDrag.last = key;
    if (gridDrag.mode === 'erase') {
      for (let j = p.idx; j < p.idx + p.g.res; j++) {
        const at = pat.steps[j].findIndex((h) => h.s === p.row);
        if (at >= 0) pat.steps[j].splice(at, 1);
      }
    } else if (!colHits(pat, p.idx, p.g.res).some((o) => o.h.s === p.row)) addHit(pat.steps[p.idx], p.row);
    pat.edited = true; dirty = true;
  }
  // CHOP STAMP: a sequential writer. Switching it on clears the current pattern and puts the
  // cursor (S.stampPos) at the start; each chop clicked is written at the cursor for its chopped
  // length (snapped to the grid resolution, at least one grid cell) and the cursor moves on,
  // so chops fill the pattern from start to end in the order they're clicked.
  function startStamp() {
    const pat = curPat();
    if (!pat) return;
    checkpoint();
    pat.steps = pat.steps.map((st, i) => (pat.locks[i] ? st : []));
    pat.edited = true;
    S.stampPos = 0;
    setPage(0);
    dirty = true;
    toast('CHOP STAMP on: pattern cleared, click chops to fill it in order');
  }
  function stampChop(i) {
    const pat = curPat(), sl = S.slices[i];
    if (!pat || !sl || !S.src) return;
    const N = pat.steps.length, pos = S.stampPos || 0;
    if (pos >= N) { toast('Pattern full: Ctrl+Z to step back, or toggle CHOP STAMP to start over'); return; }
    // chopped length in grid steps at the break's own tempo, snapped to the grid setting
    const stepSec = 60 / S.origBpm / 4 / BT.RES, res = S.gridRes;
    const raw = ((E.sliceEnd(i) - sl.pos) / S.src.sampleRate / stepSec) * sl.decay;
    const len = Math.min(N - pos, Math.max(res, Math.round(raw / res) * res));
    checkpoint();
    for (let k = pos; k < pos + len; k++) if (!pat.locks[k]) pat.steps[k] = [];
    pat.steps[pos].push({ s: i, v: 1, p: 0, r: false, roll: 1, len });
    pat.edited = true;
    S.stampPos = pos + len;
    if (S.follow) setPage(Math.floor(Math.min(S.stampPos, N - 1) / PAGE));
    const where = (k) => 'bar ' + (Math.floor(k / BAR) + 1) + '.' + (Math.floor((k % BAR) / BEAT) + 1);
    toast('Chop ' + (i + 1) + ' at ' + where(pos) + (S.stampPos >= N ? ' - pattern full' : ', next at ' + where(S.stampPos)));
    dirty = true;
  }

  // Steps hold any number of hits (one per slice), kept in slice order.
  function addHit(step, s) {
    if (step.some((h) => h.s === s)) return;
    step.push({ s, v: 1, p: 0, r: false, roll: 1 });
    step.sort((a, b) => a.s - b.s);
  }

  // ---------- lanes ----------
  const lane = $('#lane'), lctx = lane.getContext('2d');
  let laneDrag = null;
  function drawLane() {
    const W = lane.clientWidth, H = lane.clientHeight;
    if (lane.width !== Math.round(W * dpr())) { lane.width = Math.round(W * dpr()); lane.height = Math.round(H * dpr()); }
    const c = lctx; c.setTransform(dpr(), 0, 0, dpr(), 0, 0);
    c.fillStyle = '#142012'; c.fillRect(0, 0, W, H);
    const pat = curPat(); if (!pat) return;
    const v = gridView(), N = v.N, cw = (W - GLEFT) / N;
    c.fillStyle = '#8aa57f'; c.font = 'bold 10px Consolas';
    c.fillText(S.lane.toUpperCase(), 6, 14);
    if (S.lane === 'pitch') { c.strokeStyle = '#2b4225'; c.beginPath(); c.moveTo(GLEFT, H / 2 + 0.5); c.lineTo(W, H / 2 + 0.5); c.stroke(); }
    for (let i = 0; i < N; i++) {
      const x = GLEFT + i * cw, a = v.off + i * v.res;
      if (a % BEAT === 0) { c.strokeStyle = a % BAR === 0 ? '#4d6e42' : '#2b4225'; c.beginPath(); c.moveTo(Math.round(x) + 0.5, 0); c.lineTo(Math.round(x) + 0.5, H); c.stroke(); }
      const hits = colHits(pat, a, v.res).map((o) => o.h);
      const sw = (cw - 3) / Math.max(1, hits.length);
      hits.forEach((st, j) => {
        const hx = x + 2 + j * sw, hw = Math.max(1, sw - 1);
        c.fillStyle = LCOL[S.slices[st.s].label];
        if (S.lane === 'vel') { const h = st.v * (H - 6); c.fillRect(hx, H - 3 - h, hw, h); }
        else if (S.lane === 'chance') { const h = (st.c == null ? 1 : st.c) * (H - 6); c.fillRect(hx, H - 3 - h, hw, h); }
        else if (S.lane === 'pitch') {
          const h = (st.p / 12) * (H / 2 - 4);
          c.fillRect(hx, h > 0 ? H / 2 - h : H / 2, hw, Math.max(2, Math.abs(h)));
        } else if (S.lane === 'roll') {
          for (let k = 0; k < st.roll; k++) c.fillRect(hx, H - 6 - k * 14, hw, 10);
        } else if (S.lane === 'rev') {
          c.globalAlpha = st.r ? 1 : 0.18; c.fillRect(hx, 8, hw, H - 16); c.globalAlpha = 1;
        }
      });
    }
  }
  function laneApply(e) {
    const pat = curPat(); if (!pat) return;
    const r = lane.getBoundingClientRect(), W = r.width, H = r.height;
    const v = gridView(), cw = (W - GLEFT) / v.N;
    const fx = (e.clientX - r.left - GLEFT) / cw, col = Math.floor(fx);
    if (col < 0 || col >= v.N) return;
    const hits = colHits(pat, v.off + col * v.res, v.res).map((o) => o.h);
    if (!hits.length) return;
    // stacked hits split the column into sub-columns; pick the one under the pointer
    const st = hits[Math.max(0, Math.min(hits.length - 1, Math.floor((fx - col) * hits.length)))];
    const fy = 1 - Math.max(0, Math.min(1, (e.clientY - r.top) / H));
    if (S.lane === 'vel') st.v = Math.max(0.05, Math.round(fy * 20) / 20);
    else if (S.lane === 'chance') { const c = Math.max(0.05, Math.round(fy * 20) / 20); if (c >= 1) delete st.c; else st.c = c; }
    else if (S.lane === 'pitch') st.p = Math.round((fy - 0.5) * 2 * 12);
    else if (S.lane === 'roll') st.roll = Math.max(1, Math.min(4, 1 + Math.floor(fy * 4)));
    else if (S.lane === 'rev') {
      if (laneDrag.rev == null) laneDrag.rev = !st.r;
      st.r = laneDrag.rev;
    }
    pat.edited = true; dirty = true;
  }
  lane.addEventListener('pointerdown', (e) => { checkpoint(); laneDrag = {}; lane.setPointerCapture(e.pointerId); laneApply(e); });
  lane.addEventListener('pointermove', (e) => { if (laneDrag) laneApply(e); });
  lane.addEventListener('pointerup', () => { laneDrag = null; });

  // ---------- pads ----------
  const padHits = {};
  function renderPads() {
    const banks = Math.max(1, Math.ceil(S.slices.length / 16));
    padBank = Math.min(padBank, banks - 1);
    $('#bankSeg').innerHTML = banks > 1
      ? Array.from({ length: banks }, (_, i) => '<button class="' + (i === padBank ? 'on' : '') + '" data-b="' + i + '">' + 'ABCD'[i] + '</button>').join('')
      : '';
    $$('#bankSeg button').forEach((b) => b.addEventListener('click', () => { padBank = +b.dataset.b; renderPads(); }));
    const pads = $('#pads');
    if (pads.children.length !== 16) {
      pads.innerHTML = '';
      for (let k = 0; k < 16; k++) {
        const d = document.createElement('div'); d.className = 'pad'; d.dataset.k = k;
        d.addEventListener('pointerdown', () => { triggerPad(k); if (S.stamp && S.slices[padBank * 16 + k]) stampChop(padBank * 16 + k); });
        pads.appendChild(d);
      }
    }
    $$('.pad', pads).forEach((d, k) => {
      const i = padBank * 16 + k, sl = S.slices[i];
      d.classList.toggle('empty', !sl);
      d.classList.toggle('sel', i === S.sel);
      d.style.setProperty('--pc', sl ? LCOL[sl.label] : '#444');
      d.innerHTML = sl ? '<span>' + (i + 1) + ' ' + sl.label + '</span><small>' + PAD_KEYS[k].toUpperCase() + (sl.sc ? ' &middot; SC' : '') + '</small>' : '';
    });
  }
  function flashPad(i) { padHits[i] = performance.now(); }
  function triggerPad(k) {
    const i = padBank * 16 + k;
    if (!S.slices[i]) return;
    selectSlice(i, true);
    if (S.recording && S.playing) {
      const pos = E.position(), pat = S.patterns[pos.slot];
      if (pat) {
        // quantise to the grid resolution being shown
        const step = (Math.round(pos.step / S.gridRes) * S.gridRes) % pat.steps.length;
        checkpoint('rec');
        addHit(pat.steps[step], i);
        pat.edited = true; dirty = true;
      }
    }
  }

  // ---------- render loop ----------
  function frame() {
    const now = E.ctx ? E.ctx.currentTime : 0;
    while (E.queue.length && E.queue[0].time <= now) {
      const q = E.queue.shift();
      playhead = q;
      if (S.follow && q.slot === S.editSlot && Math.floor(q.step / PAGE) !== S.gridPage) setPage(Math.floor(q.step / PAGE));
      q.voices.forEach((v) => { hot = { slice: v.slice, end: v.end }; flashPad(v.slice); });
      dirty = true;
    }
    if (dirty || S.playing || (hot && now < hot.end + 0.05)) {
      drawWave(); drawGrid(); drawLane();
      dirty = false;
    }
    const t = performance.now();
    $$('.pad').forEach((d, k) => d.classList.toggle('hit', t - (padHits[padBank * 16 + k] || 0) < 90));
    drawMeter();
    requestAnimationFrame(frame);
  }
  const meter = $('#meter'), mctx = meter.getContext('2d');
  const meterBuf = new Float32Array(1024);
  let meterLvl = 0;
  function drawMeter() {
    let peak = 0;
    if (E.chain) {
      E.chain.analyser.getFloatTimeDomainData(meterBuf);
      for (let i = 0; i < meterBuf.length; i++) peak = Math.max(peak, Math.abs(meterBuf[i]));
    }
    meterLvl = Math.max(peak, meterLvl * 0.9);
    mctx.fillStyle = '#142012'; mctx.fillRect(0, 0, 16, 64);
    const h = Math.min(1, meterLvl) * 62;
    mctx.fillStyle = meterLvl > 0.98 ? '#ff5e57' : meterLvl > 0.7 ? '#ffd166' : '#8ee27a';
    mctx.fillRect(3, 63 - h, 10, h);
  }

  // ---------- transport & buttons ----------
  function togglePlay() {
    if (!S.src) { toast('Load a break first'); return; }
    if (!curPat()) regenerate(S.editSlot);
    if (S.playing) E.stop(); else E.start();
    refreshControls(); dirty = true;
  }
  function exportSlots() {
    if (!S.chain) return [S.editSlot];
    const slots = [0, 1, 2, 3].filter((i) => S.patterns[i] && S.patterns[i].steps.some((x) => x.length));
    return slots.length ? slots : [S.editSlot];
  }
  function midiBytes() {
    const pats = exportSlots().map((i) => S.patterns[i]);
    const m = BT.patternToMidiEvents(pats);
    return BT.encodeMidi(m.events, S.songBpm, m.total);
  }
  const baseName = () => (S.name || 'break').replace(/[^\w-]+/g, '_') + '_' + Math.round(S.songBpm);

  function initButtons() {
    $('#playBtn').addEventListener('click', togglePlay);
    $('#recBtn').addEventListener('click', () => { S.recording = !S.recording; refreshControls(); });
    $('#loadBtn').addEventListener('click', () => $('#fileInput').click());
    $('#fileInput').addEventListener('change', (e) => { loadFiles(Array.from(e.target.files)); e.target.value = ''; });
    $('#breakSelect').addEventListener('change', (e) => selectBreak(+e.target.value));
    $('#lockBtn').addEventListener('click', () => { S.locked = !S.locked; refreshControls(); dirty = true; });
    $('#resetBtn').addEventListener('click', () => { if (S.locked) { toast('Cuts are locked'); return; } checkpoint(); reslice(); refreshControls(); });
    $('#repitchBtn').addEventListener('click', () => { S.repitch = !S.repitch; refreshControls(); });
    $('#origBpm').addEventListener('change', (e) => {
      const v = parseFloat(e.target.value);
      if (v > 40 && v < 400) { checkpoint(); S.origBpm = v; computeSteps(); regenerateAll(); waveStaticDirty = true; dirty = true; }
      refreshControls();
    });
    $('#songBpm').addEventListener('change', (e) => {
      const v = parseFloat(e.target.value);
      if (v > 40 && v < 400) { S.songBpm = v; E.updateChain(); }
      refreshControls();
    });
    $$('#slotSeg button').forEach((b) => b.addEventListener('click', () => {
      S.editSlot = +b.dataset.v;
      const p = curPat();
      if (!p) regenerate(S.editSlot);
      else { S.style = p.style; S.variant = p.variant; S.patLen = p.steps.length / BAR; }
      refreshControls(); dirty = true;
    }));
    $('#copyBtn').addEventListener('click', () => {
      const p = curPat(); if (!p) return;
      checkpoint();
      const to = (S.editSlot + 1) % 4;
      S.patterns[to] = JSON.parse(JSON.stringify(p));
      S.editSlot = to; refreshControls(); dirty = true;
      toast('Copied to slot ' + 'ABCD'[to]);
    });
    $('#mutateBtn').addEventListener('click', mutate);
    $('#undoBtn').addEventListener('click', undo);
    $$('[data-sc]').forEach((b) => b.addEventListener('click', () => {
      if (!S.slices.length) return;
      checkpoint();
      const lbl = b.dataset.sc;
      S.slices.forEach((sl) => { sl.sc = lbl === 'none' ? false : lbl === sl.label ? true : sl.sc; });
      if (lbl !== 'none') S.sub = true;
      refreshControls(); dirty = true;
    }));
    $$('[data-rep]').forEach((b) => {
      const on = () => { E.setRepeat(+b.dataset.rep); b.classList.add('on'); };
      const off = () => { E.setRepeat(0); b.classList.remove('on'); };
      b.addEventListener('pointerdown', on);
      b.addEventListener('pointerup', off);
      b.addEventListener('pointerleave', off);
    });
    $('#pagePrev').addEventListener('click', () => setPage(S.gridPage - 1));
    $('#pageNext').addEventListener('click', () => setPage(S.gridPage + 1));
    $('#followBtn').addEventListener('click', () => { S.follow = !S.follow; renderPager(); });
    $('#redoBtn').addEventListener('click', redo);
    $('#newSeedBtn').addEventListener('click', newTake);
    $('#clearBtn').addEventListener('click', () => {
      const p = curPat(); if (!p) return;
      checkpoint();
      p.steps = p.steps.map((st, i) => (p.locks[i] ? st : [])); p.edited = true; dirty = true; refreshControls();
    });
    $$('#labelSeg button').forEach((b) => b.addEventListener('click', () => {
      const sl = S.slices[S.sel]; if (!sl) return;
      checkpoint();
      sl.label = b.dataset.v; refreshControls(); dirty = true;
    }));

    // exports
    const midi = $('#midiBtn');
    midi.addEventListener('click', () => { if (curPat()) BT.download(new Blob([midiBytes()], { type: 'audio/midi' }), baseName() + '.mid'); });
    midi.addEventListener('dragstart', (e) => {
      if (!curPat()) { e.preventDefault(); return; }
      const bytes = midiBytes();
      let bin = ''; bytes.forEach((b) => { bin += String.fromCharCode(b); });
      const name = baseName() + '.mid';
      e.dataTransfer.setData('DownloadURL', 'audio/midi:' + name + ':data:audio/midi;base64,' + btoa(bin));
      e.dataTransfer.effectAllowed = 'copy';
    });
    $('#wavBtn').addEventListener('click', async () => {
      if (!curPat()) return;
      toast('Rendering…');
      const buf = await E.render(exportSlots());
      const chs = []; for (let c = 0; c < buf.numberOfChannels; c++) chs.push(buf.getChannelData(c));
      BT.download(new Blob([BT.encodeWav(chs, buf.sampleRate)], { type: 'audio/wav' }), baseName() + '.wav');
    });
    $('#kitBtn').addEventListener('click', async () => {
      if (!S.slices.length) return;
      toast('Building kit…');
      const files = S.slices.map((sl, i) => ({
        name: String(i + 1).padStart(2, '0') + '_' + sl.label + '.wav',
        data: BT.bufferRegionToWav(S.proc, sl.pos, sl.pos + Math.round((E.sliceEnd(i) - sl.pos) * sl.decay), sl.rev),
      }));
      if (curPat()) {
        files.push({ name: baseName() + '_pattern.mid', data: midiBytes() });
        const buf = await E.render(exportSlots());
        const chs = []; for (let c = 0; c < buf.numberOfChannels; c++) chs.push(buf.getChannelData(c));
        files.push({ name: baseName() + '_loop.wav', data: BT.encodeWav(chs, buf.sampleRate) });
      }
      BT.download(BT.zip(files), baseName() + '_kit.zip');
    });
  }

  function mutate() {
    const p = curPat(); if (!p) return;
    checkpoint();
    BT.mutate(p, S.slices, srcSteps, S.chaos, (Math.random() * 1e9) | 0);
    dirty = true;
  }
  function newTake() { checkpoint(); S.seedSalt++; regenerate(S.editSlot); }

  // ---------- keyboard ----------
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.target.tagName !== 'INPUT') {
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return; }
      if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); redo(); return; }
    }
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.ctrlKey || e.metaKey) return;
    const k = e.key.toLowerCase();
    if (e.code === 'Space') { e.preventDefault(); togglePlay(); return; }
    if (e.repeat) return;
    if (REPEAT_KEYS[k]) { E.setRepeat(REPEAT_KEYS[k]); $('[data-rep="' + REPEAT_KEYS[k] + '"]').classList.add('on'); return; }
    const pi = PAD_KEYS.indexOf(k);
    if (pi >= 0) { triggerPad(pi); return; }
    if (k === 'p') set('stamp', !S.stamp);
    else if (k === 'm') mutate();
    else if (k === 'n') newTake();
    else if (k === 'delete' || k === 'backspace') { if (!S.locked) deleteMarker(S.sel); }
    else if (k === 'arrowleft') selectSlice(Math.max(0, S.sel - 1), true);
    else if (k === 'arrowright') selectSlice(Math.min(S.slices.length - 1, S.sel + 1), true);
  });

  // keys 5-8 hold beat repeat at 1/4, 1/8, 1/16, 1/32 (in 32nd steps)
  const REPEAT_KEYS = { 5: 4 * BT.RES * 1, 6: 2 * BT.RES, 7: BT.RES, 8: 1 };
  document.addEventListener('keyup', (e) => {
    const len = REPEAT_KEYS[e.key];
    if (!len) return;
    E.setRepeat(0);
    $('[data-rep="' + len + '"]').classList.remove('on');
  });

  // ---------- drag & drop ----------
  ['dragover', 'dragenter'].forEach((ev) => document.addEventListener(ev, (e) => {
    if (e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')) { e.preventDefault(); $('#waveWrap').classList.add('dragover'); }
  }));
  ['dragleave', 'drop'].forEach((ev) => document.addEventListener(ev, () => $('#waveWrap').classList.remove('dragover')));
  document.addEventListener('drop', (e) => {
    if (!e.dataTransfer || !e.dataTransfer.files.length) return;
    e.preventDefault();
    loadFiles(Array.from(e.dataTransfer.files).filter((f) => /audio|\.(wav|aiff?|mp3|flac|ogg)$/i.test(f.type + f.name)));
  });

  window.addEventListener('resize', () => { waveStaticDirty = true; dirty = true; });
  document.addEventListener('pointerdown', () => E.resume(), { once: true });

  // ---------- boot ----------
  initKnobs(); initSegs(); initStyles(); initButtons();
  refreshControls();
  refreshUndoButtons();
  requestAnimationFrame(frame);
  // ?load=a.wav,b.wav works when served over http (file:// blocks fetch)
  const q = new URLSearchParams(location.search).get('load');
  if (q && location.protocol.startsWith('http')) {
    (async () => { for (const f of q.split(',')) { try { await BT.loadURL(f); } catch (err) { toast('Could not load ' + f); } } selectBreak(0); })();
  }
  BT.ui = { selectBreak, regenerate, reslice, get srcSteps() { return srcSteps; } };
})(window.BT);
