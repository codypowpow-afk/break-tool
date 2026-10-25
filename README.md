# Break Tool

A drum & bass break chopper and pattern sequencer. Load a breakbeat, let it auto-slice and label the hits
(kick / snare / hat / ghost / crash), then generate new patterns from DnB conventions or program your own.
Runs fully offline.

## Run it

- **Windows app:** download `BreakTool.exe` from the [Releases](../../releases) page and run it. It needs the
  Microsoft Edge WebView2 Runtime, which is built into Windows 11 (and most up-to-date Windows 10).
- **Browser:** open `index.html` in Chrome or Edge.

## Features

- **Slicing:** auto (onset detection with sensitivity) or even 8/16/32/64; drag, add, delete and relabel markers;
  lock cuts; loop length in bars sets the original BPM.
- **35 pattern styles** (10 variants each), all mapped onto your break at DnB tempo:
  - DnB: As Played, Stepping, Two-Step (snare 2+4), Three-And, Halftime, Roller, Jungle
  - Club / world: Four-Floor, Breakbeat, Trap, Dembow, Afrobeats, Clave, Baile Funk
  - EDM / dance: Dubstep, UK Garage, Electro, Jersey Club, Footwork, Gqom, Hardstyle
  - Other common: Rock, Shuffle, Reggae, Hip-Hop, Samba, Motown, Metal
  - More popular rhythms: Disco, UK Drill, Amapiano, Dancehall, Cumbia, Bhangra, Punk
  Density, Chaos, Mutate and New Take shape the result.
- **Fills:** 10 fill types (or Auto to follow the variant), 1 beat / 2 beats / 1 bar long, every 2 / 4 / 8 bars or
  only at the end.
- **Step grid** on 32nd notes, painted at 1/8, 1/16 or 1/32, with any number of stacked hits per step and per-hit
  velocity, chance (probability), pitch, roll (2/3/4) and reverse lanes,
  lockable steps, slots A–D with chain, and pattern lengths of 1/2/4/8/12/16/32 bars (paged 4 bars at a time,
  with fills every 8 bars).
- **Undo / redo** (Ctrl+Z / Ctrl+Y), 25 steps deep.
- **Beat repeat:** hold 1/4, 1/8, 1/16 or 1/32 (or keys 5-8) to loop the current slice of the groove live.
- **Sub bass:** a sine sub in any key that plays on every kick, with glide and decay.
- **Per-slice** pitch, gain, pan, length and reverse; 16 keyboard pads with live record.
- **Sampler character:** sample-rate reduction (32k–8k), 12-bit / 8-bit, mono.
- **Mix FX:** LP/HP/BP filter with resonance and a tempo-synced LFO sweep (sine/tri/saw/square, 1/4 to 4 bars),
  drive, compressor, room.
- **Tempo:** song BPM with optional repitch (sampler-style) or fixed-pitch chops; swing and humanize.
- **Export:** rendered WAV loop, MIDI (slice 1 = C1 / note 36; drag or click), or a zip kit of every slice + MIDI + loop.

Keys: `Space` play/stop · `5-8` hold beat repeat · `Ctrl+Z` undo · `Ctrl+Y` redo · `1-4 Q-R A-F Z-V` pads · `M` mutate · `N` new take · `Del` delete marker · `←/→` select slice.

## Build the exe

Uses only the C# compiler that ships with Windows (.NET Framework 4.x); the WebView2 SDK is fetched from NuGet on
first build.

```
powershell -ExecutionPolicy Bypass -File desktop\build.ps1
```

Output: `dist\BreakTool.exe` (about 1 MB). The web app is embedded and served from memory; only the WebView2
loader DLL and browser profile live in `%LOCALAPPDATA%\BreakTool`.
