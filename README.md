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
- **Pattern styles** (5 variants each): As Played, Stepping, Two-Step (snare 2+4), Three-And, Halftime, Roller,
  Jungle. Density, Chaos, Fill, Mutate and New Take shape the result.
- **Step grid** with per-step velocity, pitch, roll (2/3/4) and reverse lanes; lockable steps; slots A–D with chain.
- **Per-slice** pitch, gain, pan, length and reverse; 16 keyboard pads with live record.
- **Sampler character:** sample-rate reduction (32k–8k), 12-bit / 8-bit, mono.
- **Mix FX:** LP/HP/BP filter with resonance, drive, compressor, room.
- **Tempo:** song BPM with optional repitch (sampler-style) or fixed-pitch chops; swing and humanize.
- **Export:** rendered WAV loop, MIDI (slice 1 = C1 / note 36; drag or click), or a zip kit of every slice + MIDI + loop.

Keys: `Space` play/stop · `1-4 Q-R A-F Z-V` pads · `M` mutate · `N` new take · `Del` delete marker · `←/→` select slice.

## Build the exe

Uses only the C# compiler that ships with Windows (.NET Framework 4.x); the WebView2 SDK is fetched from NuGet on
first build.

```
powershell -ExecutionPolicy Bypass -File desktop\build.ps1
```

Output: `dist\BreakTool.exe` (about 1 MB, with the web app embedded). At launch it unpacks to
`%LOCALAPPDATA%\BreakTool`.
