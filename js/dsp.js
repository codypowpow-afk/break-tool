// DSP + file helpers: onset detection, hit classification, sampler degradation,
// WAV / MIDI / ZIP encoders, seeded RNG.
window.BT = window.BT || {};

(function (BT) {
  'use strict';

  // ---------- RNG ----------
  BT.rng = function (seed) {
    let a = seed >>> 0;
    const r = function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    r.int = (n) => Math.floor(r() * n);
    r.pick = (arr) => arr[Math.floor(r() * arr.length)];
    r.chance = (p) => r() < p;
    return r;
  };
  BT.hash = function (str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  };

  // ---------- helpers ----------
  BT.mono = function (buffer) {
    const n = buffer.length, out = new Float32Array(n);
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      const d = buffer.getChannelData(c);
      for (let i = 0; i < n; i++) out[i] += d[i];
    }
    const k = 1 / buffer.numberOfChannels;
    for (let i = 0; i < n; i++) out[i] *= k;
    return out;
  };

  // Loop length in bars -> BPM. "auto" picks the bar count that lands in DnB range.
  BT.estimateBpm = function (seconds, bars) {
    if (bars) return (bars * 4 * 60) / seconds;
    let best = null;
    for (const b of [1, 2, 4, 8, 16]) {
      const bpm = (b * 4 * 60) / seconds;
      const score = Math.abs(bpm - 172);
      if (!best || score < best.score) best = { bars: b, bpm, score };
    }
    return best.bpm;
  };
  BT.barsFor = function (seconds, bpm) {
    return Math.max(1, Math.round((seconds * bpm) / 240));
  };

  // ---------- onset detection ----------
  // Log-energy rise over ~23ms on full band + a high-frequency-emphasised band,
  // so both kicks and hats register. The threshold is relative to a typical
  // strong hit in this file, so quiet and loud breaks slice alike.
  BT.detectOnsets = function (buffer, sensitivity, bpm) {
    const x = BT.mono(buffer);
    const sr = buffer.sampleRate;
    const hop = 128, win = 1024, L = 8;
    const frames = Math.floor((x.length - win) / hop);
    if (frames < L + 4) return [0];
    const eFull = new Float32Array(frames), eHi = new Float32Array(frames);
    let maxE = 0;
    for (let f = 0; f < frames; f++) {
      let s = 0, sh = 0, prev = x[f * hop];
      for (let i = 0; i < win; i++) {
        const v = x[f * hop + i];
        s += v * v;
        const d = v - prev; prev = v;
        sh += d * d;
      }
      eFull[f] = s / win; eHi[f] = sh / win;
      maxE = Math.max(maxE, eFull[f]);
    }
    const eps = 1e-6 * maxE + 1e-12;
    const odf = new Float32Array(frames);
    for (let f = L; f < frames; f++) {
      const rf = Math.log((eFull[f] + eps) / (eFull[f - L] + eps));
      const rh = Math.log((eHi[f] + eps) / (eHi[f - L] + eps));
      odf[f] = Math.max(0, 0.5 * rf + 0.5 * rh);
    }
    const stepSec = 60 / (bpm || 172) / 4;
    const minGapF = Math.round((Math.max(0.03, stepSec * 0.55) * sr) / hop);

    const peaks = [];
    for (let f = L; f < frames - 4; f++) {
      const v = odf[f];
      if (v <= 0) continue;
      let isMax = true;
      for (let k = -4; k <= 4; k++) if (odf[f + k] > v) { isMax = false; break; }
      if (!isMax) continue;
      if (peaks.length && f - peaks[peaks.length - 1].f < minGapF) {
        if (v > peaks[peaks.length - 1].v) peaks[peaks.length - 1] = { f, v };
        continue;
      }
      peaks.push({ f, v });
    }
    if (!peaks.length) return [0];
    // reference = strength of a typical beat-level hit (robust to one huge transient)
    const sorted = peaks.map((p) => p.v).sort((a, b) => b - a);
    const beats = Math.max(4, Math.round(buffer.duration / (stepSec * 4)));
    const ref = sorted[Math.min(sorted.length - 1, Math.round(beats * 0.75))] || sorted[0];
    const thresh = ref * (1.5 - sensitivity * 1.4);
    // refine to the attack: walk back from the loudest 32-sample block in the
    // frame until the envelope drops, then back off 1ms onto a zero crossing
    const B = 32;
    const pos = peaks.filter((p) => p.v >= thresh).map((p) => {
      const a = Math.max(0, p.f * hop), b = Math.min(x.length, p.f * hop + win + 256);
      const env = [];
      for (let i = a; i < b; i += B) {
        let m = 0;
        for (let k = i; k < i + B && k < b; k++) m = Math.max(m, Math.abs(x[k]));
        env.push(m);
      }
      let pk = 0;
      env.forEach((v, i) => { if (v > env[pk]) pk = i; });
      let j = pk;
      while (j > 0 && env[j - 1] > env[pk] * 0.25) j--;
      let s = Math.max(0, a + j * B - Math.round(0.001 * sr));
      for (let i = 0; i < 200 && s > 0; i++, s--) {
        if ((x[s] >= 0) !== (x[s - 1] >= 0)) break;
      }
      return s;
    });
    if (!pos.length || pos[0] > stepSec * 0.5 * sr) pos.unshift(0);
    else pos[0] = 0;
    return pos;
  };

  BT.evenSlices = function (length, count) {
    const out = [];
    for (let i = 0; i < count; i++) out.push(Math.round((i * length) / count));
    return out;
  };

  // ---------- hit classification ----------
  // Band energy ratios over the first ~45ms of each slice.
  BT.classify = function (buffer, positions) {
    const x = BT.mono(buffer);
    const sr = buffer.sampleRate;
    const aLo = 1 - Math.exp((-2 * Math.PI * 140) / sr);
    const aHi = 1 - Math.exp((-2 * Math.PI * 5000) / sr);
    const feats = positions.map((p, i) => {
      const end = Math.min(i + 1 < positions.length ? positions[i + 1] : x.length, p + Math.round(0.045 * sr));
      let l1 = 0, l2 = 0, h1 = 0, eLo = 0, eHi = 0, eT = 0, peak = 0;
      for (let n = p; n < end; n++) {
        const v = x[n];
        l1 += aLo * (v - l1); l2 += aLo * (l1 - l2);
        h1 += aHi * (v - h1);
        const hi = v - h1;
        eLo += l2 * l2; eHi += hi * hi; eT += v * v;
        peak = Math.max(peak, Math.abs(v));
      }
      const len = Math.max(1, end - p);
      return { lo: eLo / (eT + 1e-9), hi: eHi / (eT + 1e-9), rms: Math.sqrt(eT / len), peak };
    });
    const maxRms = Math.max(1e-6, ...feats.map((f) => f.rms));
    const maxLo = Math.max(1e-6, ...feats.map((f) => f.lo));
    // thresholds are relative to this break so quiet / dark / bright loops all sort out
    const label = (f) => {
      const loud = f.rms / maxRms;
      if (f.lo >= Math.max(0.07, 0.55 * maxLo) && f.lo >= f.hi && loud > 0.2) return 'K';
      if (f.hi >= 0.22 && loud < 0.85) return loud > 0.7 && f.hi > 0.4 ? 'C' : 'H';
      if (loud >= 0.6) return f.hi > 0.5 ? 'C' : 'S';
      if (loud >= 0.3) return 'G';
      return 'H';
    };
    return feats.map((f) => ({ label: label(f), rms: f.rms, lo: f.lo, hi: f.hi }));
  };

  // ---------- sampler degradation (SP-1200 / S950 style) ----------
  BT.degrade = function (ctx, src, opts) {
    const chs = opts.mono ? 1 : src.numberOfChannels;
    const out = ctx.createBuffer(chs, src.length, src.sampleRate);
    const data = [];
    for (let c = 0; c < src.numberOfChannels; c++) data.push(src.getChannelData(c));
    const hold = opts.rate ? src.sampleRate / opts.rate : 1;
    const levels = opts.bits < 16 ? Math.pow(2, opts.bits - 1) : 0;
    for (let c = 0; c < chs; c++) {
      const o = out.getChannelData(c);
      let phase = hold, held = 0;
      for (let i = 0; i < src.length; i++) {
        let v;
        if (opts.mono) { v = 0; for (let k = 0; k < data.length; k++) v += data[k][i]; v /= data.length; }
        else v = data[c][i];
        phase += 1;
        if (phase >= hold) { phase -= hold; held = v; }
        v = held;
        if (levels) v = Math.round(v * levels) / levels;
        o[i] = v;
      }
    }
    return out;
  };

  BT.reverseBuffer = function (ctx, src) {
    const out = ctx.createBuffer(src.numberOfChannels, src.length, src.sampleRate);
    for (let c = 0; c < src.numberOfChannels; c++) {
      const s = src.getChannelData(c), o = out.getChannelData(c), n = s.length;
      for (let i = 0; i < n; i++) o[i] = s[n - 1 - i];
    }
    return out;
  };

  // ---------- encoders ----------
  BT.encodeWav = function (channels, sampleRate) {
    const n = channels[0].length, chs = channels.length;
    const buf = new ArrayBuffer(44 + n * chs * 2);
    const dv = new DataView(buf);
    const w = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); dv.setUint32(4, 36 + n * chs * 2, true); w(8, 'WAVE');
    w(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, chs, true);
    dv.setUint32(24, sampleRate, true); dv.setUint32(28, sampleRate * chs * 2, true);
    dv.setUint16(32, chs * 2, true); dv.setUint16(34, 16, true);
    w(36, 'data'); dv.setUint32(40, n * chs * 2, true);
    let o = 44;
    for (let i = 0; i < n; i++) {
      for (let c = 0; c < chs; c++) {
        const v = Math.max(-1, Math.min(1, channels[c][i]));
        dv.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true); o += 2;
      }
    }
    return new Uint8Array(buf);
  };

  BT.bufferRegionToWav = function (buffer, start, end, reverse) {
    const chs = [];
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      const seg = buffer.getChannelData(c).slice(start, end);
      if (reverse) seg.reverse();
      const fade = Math.min(64, seg.length);
      for (let i = 0; i < fade; i++) seg[seg.length - 1 - i] *= i / fade;
      chs.push(seg);
    }
    return BT.encodeWav(chs, buffer.sampleRate);
  };

  // events: [{step (float, in 16ths), len (16ths), note, vel 0..1}]
  BT.encodeMidi = function (events, bpm, totalSteps) {
    const PPQ = 96, TPS = PPQ / 4;
    const msgs = [];
    events.forEach((e) => {
      const on = Math.round(e.step * TPS), off = Math.max(on + 1, Math.round((e.step + e.len) * TPS) - 1);
      const vel = Math.max(1, Math.min(127, Math.round(e.vel * 127)));
      msgs.push({ t: on, d: [0x90, e.note, vel] });
      msgs.push({ t: off, d: [0x80, e.note, 0] });
    });
    msgs.sort((a, b) => a.t - b.t || (a.d[0] === 0x80 ? -1 : 1));
    const bytes = [];
    const vlq = (v) => {
      const st = [v & 0x7f];
      while ((v >>= 7)) st.unshift((v & 0x7f) | 0x80);
      bytes.push(...st);
    };
    const tempo = Math.round(60000000 / bpm);
    vlq(0); bytes.push(0xff, 0x51, 0x03, (tempo >> 16) & 255, (tempo >> 8) & 255, tempo & 255);
    vlq(0); bytes.push(0xff, 0x58, 0x04, 4, 2, 24, 8);
    let last = 0;
    msgs.forEach((m) => { vlq(m.t - last); last = m.t; bytes.push(...m.d); });
    vlq(Math.max(0, totalSteps * TPS - last)); bytes.push(0xff, 0x2f, 0x00);
    const head = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, (PPQ >> 8) & 255, PPQ & 255,
      0x4d, 0x54, 0x72, 0x6b, (bytes.length >>> 24) & 255, (bytes.length >>> 16) & 255, (bytes.length >>> 8) & 255, bytes.length & 255];
    return new Uint8Array(head.concat(bytes));
  };

  const crcTable = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  const crc32 = (d) => {
    let c = 0xffffffff;
    for (let i = 0; i < d.length; i++) c = crcTable[(c ^ d[i]) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };

  // Uncompressed ZIP. files: [{name, data: Uint8Array}]
  BT.zip = function (files) {
    const enc = new TextEncoder();
    const parts = [], central = [];
    let offset = 0;
    files.forEach((f) => {
      const name = enc.encode(f.name), crc = crc32(f.data), size = f.data.length;
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint32(14, crc, true);
      lh.setUint32(18, size, true); lh.setUint32(22, size, true); lh.setUint16(26, name.length, true);
      parts.push(new Uint8Array(lh.buffer), name, f.data);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true);
      ch.setUint32(16, crc, true); ch.setUint32(20, size, true); ch.setUint32(24, size, true);
      ch.setUint16(28, name.length, true); ch.setUint32(42, offset, true);
      central.push(new Uint8Array(ch.buffer), name);
      offset += 30 + name.length + size;
    });
    const cSize = central.reduce((s, p) => s + p.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, cSize, true); end.setUint32(16, offset, true);
    return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: 'application/zip' });
  };

  BT.download = function (blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  };
})(window.BT);
