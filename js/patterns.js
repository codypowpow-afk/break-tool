// Pattern generator built on drum & bass conventions.
// A pattern is { steps: [[hit, ...]], locks: [bool], style, variant, edited }.
// Each step is an array of hits that sound together (empty = rest).
// A hit is { s: sliceIndex, v: velocity 0..1, p: semitones, r: reverse, roll: 1..4 }.
// The template builders below work on one hit per step; BT.generate wraps them into stacks.
window.BT = window.BT || {};

(function (BT) {
  'use strict';

  // Two-bar templates (32 sixteenths), written as v(bar1, bar2 = bar1). Legend:
  //  K main kick  k alt kick  S main snare  s alt snare  g ghost snare
  //  h hat        o alt/open hat   q hat roll x2   Q hat roll x3   r reversed snare
  //  t low tom  T high tom (the kick pitched up)   c crash
  //  X kick+snare  Y kick+hat  Z kick+alt snare  W kick+crash (stacked on one step)
  //  . flow (hats / continue the break, by density)   - forced rest
  // DnB styles keep the backbone (kick on the 1, snares on 2 & 4, or 3 for halftime);
  // the world/club styles map their signature rhythm onto the kit at DnB tempo.
  const v = (a, b) => a + (b == null ? a : b);
  // halftime stretch: a one-bar pattern written at half tempo spread over two bars
  const hx = (a) => a.split('').map((c) => c + '.').join('');
  const T = {
    stepping: [ // kick 1 & 3, snare 2 & 4
      v('K...S...K...S...'),                       // 1 straight
      v('K...S...K...S...', 'K...S...K..KS...'),   // 2 kick pickup into the last snare
      v('K...S...K.K.S...'),                       // 3 kick on 3 and 3&
      v('K...S..gK...S...', 'K...S..gK...S.g.'),   // 4 ghost snares before beat 3
      v('K.K.S...K...S...', 'K.K.S...K..KS...'),   // 5 breakbeat double kicks
      v('K...S...K...S...', 'K...S...K..gS.g.'),   // 6 ghosts around the last snare
      v('K...S..kK...S...'),                       // 7 alt kick on the 2a
      v('K...S.K.K...S...'),                       // 8 kick on 2& leading into 3
      v('K..KS...K..KS...'),                       // 9 bouncing kicks on the 1a and 3a
      v('K...S...K...S...', 'K.K.S...K.K.S.S.'),   // 10 busy answer bar with snare pickup
    ],
    twostep: [ // kick 1 + 3&, snare 2 & 4
      v('K...S.....K.S...'),                       // 1 the classic two-step
      v('K...S.....K.S...', '..K.S.....K.S...'),   // 2 bar 2 kick slides to the 1&
      v('K...S..g.gK.S...', 'K...S..g.gK.S..g'),   // 3 ghosts around the 3& kick
      v('K.K.S.....K.S...', 'K...S.....K.S...'),   // 4 double kick on bar 1
      v('K...S.....K.S...', 'K...S..K..K.S...'),   // 5 extra kick on the 2a in bar 2
      v('K...S.....K.S...', 'K...S.....K.S.S.'),   // 6 snare pickup on the 4&
      v('K...S.....K.S...', '..K.S.....K.S..k'),   // 7 1& kick, alt kick pushing the turn
      v('K...S..K..K.S...'),                       // 8 rolling kicks on 2a and 3&
      v('K...S.g...K.S.g.', 'K...S.g...KKS.g.'),   // 9 offbeat ghosts, double kick
      v('K..kS.....K.S...', 'K..kS....kK.S..g'),   // 10 alt kick shuffle
    ],
    threeand: [ // kick 1 & 3, snare 2 + 3&
      v('K...S...K.S.....'),                       // 1 broken backbeat
      v('K...S...K.S.....', 'K...S.....S.K...'),   // 2 bar 2 answers with a kick on 4
      v('K...S...K.S...K.', 'K...S...K.S.....'),   // 3 pickup kick on 4&
      v('K...S..gK.S..g..'),                       // 4 with ghost notes
      v('K...S.....S.K...', 'K...S.....K.S...'),   // 5 syncopated bar, then a two-step
      v('K...S...K.S..K..'),                       // 6 kick on the 4e
      v('K.K.S...K.S.....'),                       // 7 double kick start
      v('K...S...K.S...S.', 'K...S...K.S.....'),   // 8 extra snare on the 4&
      v('K...S..gK.S.g...', 'K...S..gK.S.g.K.'),   // 9 ghosts, pickup kick
      v('K...S...KKS.....', 'K...S...K.S..KK.'),   // 10 doubled kicks
    ],
    halftime: [ // kick 1, snare 3
      v('K.......S.......'),                       // 1 straight halftime
      v('K.......S.....K.', 'K.......S.......'),   // 2 pickup kick into bar 2
      v('K.....K.S.......'),                       // 3 kick on 2& before the snare
      v('K.......S..K....', 'K.......S..K..K.'),   // 4 syncopated kicks after the snare
      v('K..K....S.......', 'K..K....S...g...'),   // 5 kick on 1a, ghost after the snare
      v('K.......S.......', 'K.......S...K.K.'),   // 6 kick run at the end
      v('K...K...S.......'),                       // 7 kick on beat 2
      v('K.......S.g....g', 'K.......S.g.....'),   // 8 ghost notes
      v('K......KS.......', 'K.K.....S.....K.'),   // 9 kick right before the snare
      v('K.......S.......', 'K.......S...S.S.'),   // 10 snare pickups
    ],
    roller: [ // two-step with rolling ghost snares
      v('K...S..g.gK.S...'),
      v('K...S..g.gK.S..g', '..K.S..g.gK.S...'),
      v('K..gS..g.gK.S.g.'),
      v('K...S.g..gK.S...', 'K...S.g..gK.S.gg'),
      v('K.K.S..g.gK.S..g', 'K...S..g.gK.Sg.g'),
      v('K...S..g.gK.S.g.', 'K..gS..g.gK.S.g.'),
      v('K.g.S.g.g.K.S.g.', 'K.g.S.g.g.K.S.gg'),
      v('K...S..gKg..S..g', 'K...S..gKg..S.g.'),
      v('K..gS.gg.gK.S..g', '.gK.S.gg.gK.S.gg'),
      v('Kg.gS..g.gKgS.g.', 'Kg.gS..g.gKgSggg'),
    ],
    jungle: [ // amen-style: kicks 1, 1&, 3&, 3a; snares 2, 2a, 3e, 4, 4a
      v('K.K.S..s.sKKS..s'),                       // 1 the amen bar
      v('K.K.S..s.sKKS..s', 'K.K.S..s.sK...s.'),   // 2 amen bar 3 ending
      v('K.K.S..s.sKKS..s', '..sKS..s.sK...s.'),   // 3 amen bar 4 pickup
      v('K...S.....K.S...', 'K.K.S..s.sKKS..s'),   // 4 two-step into amen
      v('K.K.S..s.sKKS..s', 'K.K.S.ss.sK.ssss'),   // 5 amen with snare run out
      v('K.K.S..s.sKKS..s', 'K.K.S..s.sKKs.ss'),   // 6 amen, snares stutter at the end
      v('K...S..s.sK.S..s', 'K.K.S..s.sK.S..s'),   // 7 thinned-out amen
      v('K.......S..s.sK.', 'K.K.....S..s.sK.'),   // 8 halftime amen
      v('K.KsS..s.sKKS.ss'),                       // 9 busy amen
      v('K.K.S..s..K.S..s', '..K.S..s.sK.S.s.'),   // 10 syncopated amen
    ],
    fourfloor: [ // house / techno: kick every beat, clap on 2 & 4, offbeat hats
      v('K.h.X.h.K.h.X.h.'),
      v('K.h.X.h.K.h.X.h.', 'K.h.X.h.K.h.X.hh'),
      v('K.hhX.hhK.hhX.hh'),
      v('K.h.X.h.K.hKX.h.'),
      v('K.o.X.o.K.o.X.o.'),
      v('K.h.X.hgK.h.X.hg'),
      v('K.h.X.h.K.h.X.h.', 'K.h.X.h.X.X.XXXX'),
      v('Kqh.X.h.Kqh.X.h.'),
      v('K..hX..hK..hX..h'),
      v('K.hhX.h.K.hhX.hh', 'K.hhX.h.K.hKX.oh'),
    ],
    breakbeat: [ // funk breaks (Funky Drummer / Think / Apache feel)
      v('K.K.S..K..K.S...', 'K.K.S..K..K.S..K'),
      v('K..KS...K.K.S...'),
      v('K.K.S.gK.gK.S.g.'),
      v('K...S..K.KK.S...', 'K...S..K.K..S.K.'),
      v('K.KKS...K..KS...'),
      v('K..KS..K..K.S...'),
      v('K.K.S..K..K.S...', 'K.K.S..K..K.S.SS'),
      v('K...S.K...K.S...', 'K..KS.K...K.S...'),
      v('K.K.S..g.gK.S..g'),
      v('K..KS..K.K..S.K.', 'K..KS..K.K..SKS.'),
    ],
    trap: [ // halftime snare on 3, 808 kicks, rolling hats
      v('K.h.h.h.S.h.h.h.', 'K.h.h.hKS.h.h.h.'),
      v('K.h.hqh.S.h.hqh.', 'K.h.hqhKS.h.hQh.'),
      v('KhhhhhhhShhhhhhh', 'KhhhhhKhShhhhhhh'),
      v('K.h.h.K.S.h.h.h.', 'K.h.K.h.S.h.hqh.'),
      v('K.hqh.h.S.hqh.hK', 'K.hqh.hKS.hqhQh.'),
      v('K..Kh.h.S.h.h.h.', 'K..Kh.h.S.h.hKh.'),
      v('K.h.h.h.S.h.K.h.', 'K.h.h.h.S.h.hQQQ'),
      v('K.hhh.hhS.hhh.hh', 'K.hhh.KhS.hhh.hh'),
      v('K.h.h.h.Sgh.h.h.', 'K.h.hKh.Sgh.hqhg'),
      v('K.q.h.q.S.q.h.q.', 'K.q.hKq.S.q.Q.Q.'),
    ],
    dembow: [ // reggaeton: boom-ch-boom-chick in every half bar
      v('K..SK.S.K..SK.S.'),
      v('K..SK.S.K..SK.S.', 'K..SK.S.K..SKSSS'),
      v('Kh.SKhS.Kh.SKhS.'),
      v('K..SK.S.K..SK.Ss'),
      v('K..sK.S.K..sK.S.'),
      v('K..SK.SgK..SK.Sg'),
      v('K..S..S.K..S..S.'),
      v('K..SK.S.K..SK.S.', 'K..SK.S.KSKSKSKS'),
      v('KhhSKhShKhhSKhSh'),
      v('K..SK.S.K.KSK.S.', 'K..SK.S.K.KSKSS.'),
    ],
    afro: [ // afrobeats: 3-3-2 tresillo kicks, snare on 2 & 4
      v('K..KS.K.K..KS.K.'),
      v('K..KS.K.K..KS.K.', 'K..KS.K.K..KSsK.'),
      v('K..hS.K.K..hS.K.'),
      v('K.hKS.KhK.hKS.Kh'),
      v('K..KS.K.K.sKS.K.'),
      v('K...S.K...K.S...', 'K...S.K...K.S.K.'),
      v('K..s..s.K..s..S.'),
      v('K..KS.KgK..KS.Kg'),
      v('K..KS.K.K..KS.K.', 'K..KS.K.KSSKS.KS'),
      v('Kh.KShKhKh.KShKh'),
    ],
    clave: [ // son / rumba / bossa clave on the rim (alt snare)
      v('Z.....s.K...s...', 'K...s...Z.......'),   // 1 son clave 3-2
      v('K...s...Z.......', 'Z.....s.K...s...'),   // 2 son clave 2-3
      v('Z.....s.K.....s.', 'K...s...Z.......'),   // 3 rumba clave 3-2
      v('Z.....s.K...s...', 'K...s...K.s.....'),   // 4 bossa nova clave
      v('Z...S.s.K...S...', 'K...s...Z...S...'),   // 5 clave over a backbeat
      v('Z.h.h.s.K.h.s.h.', 'K.h.s.h.Z.h.h.h.'),   // 6 clave with 8th hats
      v('s.....Z.....Z...', '....s.K.s...K...'),   // 7 tumbao bass kicks
      v('K..Kh.h.K..Kh.h.', 'K..Kh.h.K..Kh.s.'),   // 8 baiao
      v('Zhhhhhs.Khhhshhh', 'KhhhshhhZhhhhhhh'),   // 9 clave with 16th hats
      v('Z.....s.K...s...', 'K...s...Z...ssSS'),   // 10 3-2 with a snare turn
    ],
    baile: [ // baile funk tamborzao / volt mix
      v('K..S..K.K.S..S..'),
      v('K..S..K.K.S..S..', 'K..S..K.K.S.SSSS'),
      v('K..K..S.K..K..S.'),
      v('K..S..KhK.S..S.h'),
      v('K..s..K.K.S..s..'),
      v('KK.S..K.K.S..S.K'),
      v('K..S..K.K.S..S..', 'K..S..K.KKS.KS..'),
      v('K..S.KK.K.S..S..'),
      v('Kh.ShhK.KhS.hS.h'),
      v('K..S..K.K.S..S..', '..KS..K.K.S.S.S.'),
    ],
    // ---- EDM / dance ----
    dubstep: [ // halftime: kick 1, snare 3, lots of space
      v('K.......S.......', 'K.....K.S.......'),
      v('K..h..h.S..h..h.'),
      v('K.......S.....K.', '..K.....S.......'),
      v('K...o...S...o...'),
      v('K.......S..K..K.', 'K.......S.......'),
      v('K.h.h.h.S.h.h.h.', 'K.h.h.K.S.h.hqhq'),
      v('K.......S.......', 'K.......S.S.S.SS'),
      v('K..K....S.......', '...K..K.S.......'),
      v('K.......Sg.....g', 'K.......Sg..K...'),
      v('K..h..h.S..h..h.', 'K..h..K.S..h.QQQ'),
    ],
    garage: [ // UK 2-step garage: skippy kicks, snare 2 & 4, shuffled hats
      v('K..hS.h..hK.S..h'),
      v('K..hS.hK.hK.S..h'),
      v('K.hhS.hh.hK.S.hh'),
      v('K..hS.h..hK.S..h', 'K..hS.h..hKKS..h'),
      v('K..oS.h..oK.S..o'),
      v('K..hS.hg.hK.S.gh'),
      v('K..hS..K..K.S..h', '..KhS..K..K.S..h'),
      v('K.hhS.hh.hK.ShKh'),
      v('K..hS.h..hK.S..h', 'K..hS.h..hK.SSSS'),
      v('Kq.hS.h.qhK.S..h'),
    ],
    electro: [ // 808 electro-funk: syncopated kicks, clap 2 & 4, 16th hats
      v('KhhhShhKhhKhShhh'),
      v('K.h.S.hKh.K.S.h.'),
      v('KhhhShhhKhKhShhh'),
      v('K.h.S.hKh.K.S.hK', 'h.K.S.hKh.K.S.h.'),
      v('KhhhShhKhhKhShhh', 'KhhhShhKhKKhSShh'),
      v('K.o.S.oKo.K.S.o.'),
      v('KhhKShhKhhKhShhh'),
      v('K.h.S.hKh.K.S.h.', 'K.h.S.hKh.KKS.SS'),
      v('KqhhShhKhhKhShqh'),
      v('K.hhShhKhhK.ShhK'),
    ],
    jersey: [ // Jersey club: bouncing kick runs under claps
      v('K...X...K..KX.K.'),
      v('K..KX...K..KX.K.'),
      v('K.K.X.K.K..KX.K.'),
      v('K...X...K..KX.K.', 'K...X...KKKKX.K.'),
      v('Kh.hXh.hK.hKXhKh'),
      v('K...X...K..KX.K.', 'K..KX..KK..KXKKK'),
      v('K...S...K..KS.K.'),
      v('KK..X...KK.KX.K.'),
      v('K...X..gK..KX.Kg'),
      v('K..KX.K.K..KX.K.', 'K..KX.K.KKKKXXXX'),
    ],
    footwork: [ // footwork / juke: triplet-feel kicks, clap on 3
      v('K..K..K.X..K..K.'),
      v('K..K..K.S..K..K.', 'K..K..K.X..KKKK.'),
      v('K..K..K.X..K.qK.'),
      v('KqhKh.K.X.hK.hK.'),
      v('K..K..K..K..X.K.'),
      v('K..K..K.X..K..K.', 'K..K..K.X..K.QQQ'),
      v('K.KK..K.S.KK..K.'),
      v('K..K..K.X.gK.gK.'),
      v('K..K..K..K..K..K', 'X..K..K..K..X.K.'),
      v('K..K..K.X..K..K.', 'KKKKKKKKX.X.X.X.'),
    ],
    gqom: [ // gqom: broken, tom-heavy, no hats
      v('K..t..t.S..t..t.'),
      v('K..t..T.S..t..T.'),
      v('K..t..t.S.t..t..'),
      v('K..t..t.S..t..t.', 'K..t..tTS..t.TT.'),
      v('K.t..t..S.t..t..'),
      v('K..t..t.K..t..t.', 'K..t..t.S..t..t.'),
      v('K..T..t.S..T..t.'),
      v('K..t.tt.S..t.tt.'),
      v('K..t..t.S..t..t.', 'K..t..t.S.tttTTT'),
      v('K..tK.t.S..tK.t.'),
    ],
    hardstyle: [ // kick every beat, offbeat reverse-bass kicks, clap 2 & 4
      v('K.k.X.k.K.k.X.k.'),
      v('K.k.X.k.K.k.X.kk'),
      v('Kkk.Xkk.Kkk.Xkk.'),
      v('K.k.X.k.K.k.X.k.', 'K.k.X.k.KKKKXXXX'),
      v('K.h.X.h.K.h.X.h.', 'K.k.X.k.K.k.X.k.'),
      v('K.kkX.kkK.kkX.kk'),
      v('K.k.X.k.K.k.X.k.', 'K...X...K...X...'),
      v('W.k.X.k.K.k.X.k.'),
      v('K.k.X.kgK.k.X.kg'),
      v('KkKkXkKkKkKkXkKk'),
    ],
    // ---- other common styles ----
    rock: [ // kick 1 & 3, snare 2 & 4, straight 8th hats
      v('Y.h.S.h.Y.h.S.h.'),
      v('Y.h.S.h.Y.Y.S.h.'),
      v('Y.h.S.hYY.h.S.h.'),
      v('W.h.S.h.Y.h.S.h.', 'Y.h.S.h.Y.Y.S.SS'),
      v('Y.o.S.o.Y.o.S.o.'),
      v('Y.h.S.h.h.Y.S.h.'),
      v('YhhhShhhYhhhShhh'),
      v('Y.h.S.h.Y.h.S.h.', 'Y.h.S.h.Y.h.SStT'),
      v('Y.h.S.hgY.h.S.hg'),
      v('Y.hYS.h.Y.hYS.h.'),
    ],
    shuffle: [ // blues / swing shuffle (hits on the beat and its "a")
      v('Y..hS..hY..hS..h'),
      v('Y..hS..hY..YS..h'),
      v('Y..hS.ghY..hS.gh'),
      v('Y..oS..oY..oS..o'),
      v('Y..hS..hY..hS..h', 'Y..hS..hY..hS.SS'),
      v('Y..YS..hY..YS..h'),
      v('Y..hS..hh..hS..h'),
      v('Y.ghS.ghY.ghS.gh'),
      v('Y..hX..hY..hX..h'),
      v('Y..hS..hY..hS..h', 'Y..hS..hS..SS.SS'),
    ],
    reggae: [ // one drop, rockers and steppers
      v('..h...h.X.h...h.'),                       // 1 one drop
      v('..h.s.h.X.h.s.h.'),                       // 2 one drop with rim clicks
      v('h.h.h.h.X.h.h.h.'),                       // 3 one drop, straight hats
      v('K.h.S.h.K.h.S.h.'),                       // 4 rockers
      v('K.h.K.h.X.h.K.h.'),                       // 5 steppers
      v('..h...h.X.h...h.', '..h...h.X.h.s.ss'),   // 6 one drop with a rim turn
      v('..o...o.X.o...o.'),                       // 7 one drop, open hats
      v('.hh..hh.Xhh..hh.'),                       // 8 skanking hats
      v('K.h.K.h.X.h.K.h.', 'K.h.K.h.X.h.KKSS'),   // 9 steppers with a turn
      v('..h.g.h.X.h.g.h.'),                       // 10 one drop with ghosts
    ],
    hiphop: [ // boom bap, stretched to halftime at DnB tempo
      hx('K..KS....KK.S...'),
      hx('K...S..K.K..S...'),
      hx('K..KS.K..K..S..K'),
      hx('K...S....K.KS...'),
      hx('K..KS..g.KK.S.g.'),
      hx('K.K.S....K..S.K.'),
      hx('K...S..K..K.S...'),
      hx('KK..S....K..S...'),
      hx('K..KS...KK..S..s'),
      hx('K..KS....KK.S.SS'),
    ],
    samba: [ // surdo (soft 1 / strong 2), caixa 16ths, toms
      v('kgsgKgsgkgsgKgsg'),
      v('k.s.K.s.k.s.K.s.'),
      v('kgsgKgsgkgsgKgss'),
      v('k..sK.s.k..sK.s.'),
      v('kgsgKgsgkgsgKgsg', 'kgsgKgsgkgsgKsss'),
      v('k.t.K.t.k.t.K.T.'),
      v('ksgsKsgskgsgKsgs'),
      v('k..tK..tk..tK..t'),
      v('kgsgKgsgkgsgKgsg', 'K.K.K.K.ssssssss'),
      v('k.s.K.ssk.s.K.ss'),
    ],
    motown: [ // soul: snare/tambourine on every beat, syncopated kick
      v('X.h.S.h.X.h.S.h.'),
      v('X.h.S.KhX.h.S.h.'),
      v('X.hKS.h.X.hKS.h.'),
      v('XhhhShhhXhhhShhh'),
      v('X.o.S.o.X.o.S.o.'),
      v('X.h.S.hKX.h.S.hK'),
      v('X.h.S.h.X.h.S.h.', 'X.h.S.h.X.h.SSSS'),
      v('X..hS..hX..hS..h'),
      v('X.h.SghKX.h.Sgh.'),
      v('X.hKS.hKX.hKS.hK'),
    ],
    metal: [ // double kick, crash accents, blast beats
      v('KKKKSKKKKKKKSKKK'),
      v('W.K.S.K.K.K.S.K.'),
      v('KK.KSK.KKK.KSK.K'),
      v('W...S...K...S...', 'K.K.S.K.K.K.S.K.'),
      v('KKKKSKKKKKKKSKKK', 'KKKKSKKKKKKKStTT'),
      v('K.KKS.KKK.KKS.KK'),
      v('W.K.K.K.S.K.K.K.'),
      v('KSKSKSKSKSKSKSKS'),
      v('KKKKSKKKKKKKSKKK', 'tttTTTSSKKKKSSSS'),
      v('W.KKS.KKK.KKS.KK'),
    ],
    // ---- more popular rhythms ----
    disco: [ // four on the floor with open hats on the offbeat
      v('K.o.X.o.K.o.X.o.'),
      v('KhohXhohKhohXhoh'),
      v('K.o.X.o.K.o.X.o.', 'K.o.X.o.K.o.XXXX'),
      v('K.oKX.o.K.oKX.o.'),
      v('Khh.Xhh.Khh.Xhh.'),
      v('K.o.X.ogK.o.X.og'),
      v('KhohXhohKhohXhoh', 'KhohXhohKhohXSSS'),
      v('K.o.S.o.K.o.S.o.'),
      v('Kqo.Xqo.Kqo.Xqo.'),
      v('K.o.X.o.K.oKX.oK'),
    ],
    drill: [ // UK drill: halftime snare on 3, late snare in bar 2, sliding kicks, rolling hats
      v('K..h.hK.S..h.h..', 'K..h.h..S..h.hS.'),
      v('K.hqh.K.S.h.hqh.', 'K.hqh...S.hqh.S.'),
      v('K..h..K.S..h..h.', '..Kh..h.S..hK.S.'),
      v('K.h.h.K.S.h.h.K.', 'K.h.h...S.h.hQS.'),
      v('K..K..h.S..h..h.', 'K..h..K.S..h.KS.'),
      v('K.hhhhK.Shhhhhh.', 'K.hhhh..ShhhhhS.'),
      v('K..h.hK.S..h.h..', 'K..h.hK.S..h.hSS'),
      v('K..q..K.S..q..h.', 'K..q....S..Q..S.'),
      v('K..h.hK.Sg.h.h.g', 'K..h.h..Sg.h.hS.'),
      v('K..h.hKKS..h.h..', 'K.Kh.h..S..hKhS.'),
    ],
    amapiano: [ // log-drum toms, 16th shakers, claps on 2 & 4
      v('KhhtShthKhhTShth'),
      v('K..tS.t.K..TS.t.'),
      v('KhhtShthKhhTShth', 'KhhtShthKhTTSTTh'),
      v('K..t..t.K..T..t.', 'K..tS.t.K..TS.t.'),
      v('KhhhShtTKhhhShtT'),
      v('K..tS.tTK..tS.tT'),
      v('KhhtShthKhhTShth', 'K..t..t.K..T..TT'),
      v('K.ttS.t.K.TTS.t.'),
      v('KhgtShthKhgTShth'),
      v('K..tS.t.K..TS.t.', 'KtTtStTtKtTtSTTT'),
    ],
    dancehall: [ // riddims: steppers, rim clicks, Diwali 3-3-2 claps
      v('K..KS...K..KS...'),
      v('K..sS.s.K..sS.s.'),
      v('K..KS..KK..KS...'),
      v('Z..s..s.Z..s..s.'),
      v('K..KS.h.K..KS.h.'),
      v('K...S..KK...S..K'),
      v('K..KS...K..KS...', 'K..KS...K.KKS.SS'),
      v('K.hKShhKK.hKShh.'),
      v('K..KS..gK..KS..g'),
      v('Z..s..s.Z..s..s.', 'K..KS...K..KS...'),
    ],
    cumbia: [ // guiro long-short-short, kick 1 & 3, snare 2 & 4
      v('K.hhS.hhK.hhS.hh'),
      v('K.hhs.hhK.hhs.hh'),
      v('K.hhS.hhK.hhS.hS'),
      v('K.hsS.hsK.hsS.hs'),
      v('K..hS..hK..hS..h'),
      v('K.hhS.hhK.hhS.hh', 'K.hhS.hhK.hhSSSS'),
      v('K.ohS.ohK.ohS.oh'),
      v('K.hhSKhhK.hhSKhh'),
      v('K.hgS.hgK.hgS.hg'),
      v('KKhhS.hhKKhhS.hh'),
    ],
    bhangra: [ // dhol chaal: bass on the 1 and its "a", tilli rim in between
      v('K..s.sK.K..s.sK.'),
      v('K..s.sK.K..sSsK.'),
      v('K..sSsK.K..sSsK.'),
      v('K.ss.sK.K.ss.sK.'),
      v('K..s.sK.K..s.sK.', 'K..s.sK.KKKsSsKK'),
      v('K..t.tK.K..t.tK.'),
      v('K..s.sKsK..s.sKs'),
      v('Kh.shsK.Kh.shsK.'),
      v('K..g.gK.S..g.gK.'),
      v('K..s.sK.K..s.sK.', 'KssKssKsKssKSSSS'),
    ],
    punk: [ // skank beats, d-beat, crash-driven 8ths
      v('Y.S.Y.S.Y.S.Y.S.'),
      v('W.S...K.K.S.....', 'K.S...K.K.S.....'),
      v('Y.Y.S.Y.Y.Y.S.Y.'),
      v('W.S.K.S.K.S.K.S.', 'K.S.K.S.K.S.SSSS'),
      v('KKS.KKS.KKS.KKS.'),
      v('Y.h.S.h.Y.Y.S.h.'),
      v('W.S.Y.S.Y.S.Y.S.', 'Y.S.Y.S.KKSSKKSS'),
      v('K.S.K.S.KKS.K.S.'),
      v('c.S.c.S.c.S.c.S.', 'K.S.K.S.K.S.K.S.'),
      v('W.S...K.K.S...K.', 'W.S.K.KSKSKSSSSS'),
    ],
  };

  // Fill templates: one bar each, applied to the last 4 / 8 / 16 steps before a phrase end.
  //  S snare  s alt snare  g ghost  K kick  r reversed snare  2/3/4 snare roll  u rising snare
  //  _ keep the groove  - silence
  BT.FILLS = [
    '____S___S.S.SS24', // 1 snare build into a 4-roll
    '__g___g.g.gSg.g3', // 2 ghost run into a roll
    '____S..S..S..r.2', // 3 syncopated with a reverse snare
    'K___S.K.K.S.K32.', // 4 kick/snare trade with rolls
    '________uuuuuuuu', // 5 rising snare run
    '____S.S.S.S.SSSS', // 6 straight 16th snares
    '____S_K_SKSKS2K4', // 7 kick-snare call and response
    '______r_r_r.S.S.', // 8 reversed snares
    '____s.ss.ss.ss.4', // 9 amen-style alt snare run
    '________----S-S-', // 10 drop out, then two snares
  ];

  BT.STYLES = [
    { id: 'asplayed', name: 'AS PLAYED', sub: 'ORIGINAL' },
    { id: 'stepping', name: 'STEPPING', sub: 'K-S-K-S' },
    { id: 'twostep', name: 'TWO-STEP', sub: 'SNARE 2 + 4' },
    { id: 'threeand', name: 'THREE-AND', sub: 'SNARE 2 + 3&' },
    { id: 'halftime', name: 'HALFTIME', sub: 'SNARE 3' },
    { id: 'roller', name: 'ROLLER', sub: 'GHOST FLOW' },
    { id: 'jungle', name: 'JUNGLE', sub: 'AMEN CHOPS' },
    { id: 'fourfloor', name: 'FOUR-FLOOR', sub: 'HOUSE / TECHNO' },
    { id: 'breakbeat', name: 'BREAKBEAT', sub: 'FUNK BREAKS' },
    { id: 'trap', name: 'TRAP', sub: '808 HALFTIME' },
    { id: 'dembow', name: 'DEMBOW', sub: 'REGGAETON' },
    { id: 'afro', name: 'AFROBEATS', sub: '3-3-2 TRESILLO' },
    { id: 'clave', name: 'CLAVE', sub: 'SON / BOSSA' },
    { id: 'baile', name: 'BAILE FUNK', sub: 'TAMBORZAO' },
    { id: 'dubstep', name: 'DUBSTEP', sub: 'HALFTIME BASS' },
    { id: 'garage', name: 'UK GARAGE', sub: '2-STEP SHUFFLE' },
    { id: 'electro', name: 'ELECTRO', sub: '808 FUNK' },
    { id: 'jersey', name: 'JERSEY CLUB', sub: 'KICK BOUNCE' },
    { id: 'footwork', name: 'FOOTWORK', sub: 'JUKE / 160' },
    { id: 'gqom', name: 'GQOM', sub: 'BROKEN TOMS' },
    { id: 'hardstyle', name: 'HARDSTYLE', sub: 'REVERSE BASS' },
    { id: 'rock', name: 'ROCK', sub: 'STRAIGHT 8THS' },
    { id: 'shuffle', name: 'SHUFFLE', sub: 'BLUES / SWING' },
    { id: 'reggae', name: 'REGGAE', sub: 'ONE DROP' },
    { id: 'hiphop', name: 'HIP-HOP', sub: 'BOOM BAP' },
    { id: 'samba', name: 'SAMBA', sub: 'SURDO + CAIXA' },
    { id: 'motown', name: 'MOTOWN', sub: 'FOUR ON SNARE' },
    { id: 'metal', name: 'METAL', sub: 'DOUBLE KICK' },
    { id: 'disco', name: 'DISCO', sub: 'OPEN HATS' },
    { id: 'drill', name: 'UK DRILL', sub: 'SLIDE 808' },
    { id: 'amapiano', name: 'AMAPIANO', sub: 'LOG DRUM' },
    { id: 'dancehall', name: 'DANCEHALL', sub: 'RIDDIM' },
    { id: 'cumbia', name: 'CUMBIA', sub: 'GUIRO' },
    { id: 'bhangra', name: 'BHANGRA', sub: 'DHOL' },
    { id: 'punk', name: 'PUNK', sub: 'D-BEAT' },
  ];
  BT.VARIANTS = 10;

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
    kit.crash = kit.C.length ? kit.C[0] : kit.altH;
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
    if (variant === 6) {
      // halftime: the break played at half speed (one original 16th per two steps)
      for (let i = 0; i < N; i++) {
        const c = i % 2 === 0 ? kit.startsAt[(i / 2) % kit.srcSteps] : null;
        steps[i] = c != null ? mk(c, 1) : null;
      }
    }
    if (variant === 7) {
      // beats played 1-4-3-2 in every bar
      const src = steps.map((x) => x && Object.assign({}, x));
      for (let bar = 0; bar < N; bar += 16) {
        [0, 3, 2, 1].forEach((from, beat) => {
          for (let k = 0; k < 4; k++) steps[bar + beat * 4 + k] = src[bar + from * 4 + k] && Object.assign({}, src[bar + from * 4 + k]);
        });
      }
    }
    if (variant === 8) {
      // bar 2 loops the first half of bar 1
      for (let b = 16; b < N; b += 32) { copy(b - 16, b, 8); copy(b - 16, b + 8, 8); }
    }
    if (variant === 9) {
      // double time: every other original 16th, so two bars of break squeeze into one
      for (let i = 0; i < N; i++) {
        const c = kit.startsAt[(i * 2) % kit.srcSteps];
        steps[i] = c != null ? mk(c, 1) : null;
      }
    }
    if (variant === 10) {
      // beat 2 repeats on beat 3, last 8th of each bar rolls
      for (let bar = 0; bar < N; bar += 16) {
        copy(bar + 4, bar + 8, 4);
        if (steps[bar + 14]) steps[bar + 14].roll = 2;
      }
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

  // Chooses which chop of a type plays at step i. With VARIETY at 0 every hit uses the main
  // chop; higher values pull in the rest of the kit. Variants rotate through three strategies:
  //  from the break - the chop of that type that sat nearest this spot in the original break
  //  per beat       - chops rotate beat by beat
  //  shuffled       - a seeded shuffle, repeating every 2 bars
  // Choices repeat every 2 bars so the groove stays coherent.
  function makePicker(kit, slices, rng, variety, variant) {
    const pools = { K: kit.K, S: kit.S, G: kit.ghosts, H: kit.hats, C: kit.C.length ? kit.C : kit.hats };
    const mains = { K: kit.mainK, S: kit.mainS, G: kit.mainG, H: kit.mainH, C: kit.crash };
    const strategy = (variant - 1) % 3;
    const shift = ((variant - 1) * 8) % kit.srcSteps; // later variants read from later in the break
    const rot = rng.int(16);
    const memo = {};
    const nearest = (pool, at) => {
      let best = pool[0], bd = Infinity;
      pool.forEach((c) => {
        const d0 = Math.abs(slices[c].origStep - at) % kit.srcSteps;
        const d = Math.min(d0, kit.srcSteps - d0);
        if (d < bd) { bd = d; best = c; }
      });
      return best;
    };
    return function (role, i) {
      const pool = pools[role];
      if (!pool || pool.length < 2) return mains[role];
      const key = role + (i % 32);
      if (memo[key] != null) return memo[key];
      // the bar's downbeat kick and the main backbeat stay put more often: they carry the groove
      const anchorHit = (role === 'K' && i % 16 === 0) || (role === 'S' && i % 8 === 4);
      let pick = mains[role];
      if (rng() < variety * (anchorHit ? 0.5 : 1)) {
        if (strategy === 0) pick = nearest(pool, (i + shift) % kit.srcSteps);
        else if (strategy === 1) pick = pool[(Math.floor(i / 4) + rot) % pool.length];
        else pick = pool[rng.int(pool.length)];
      }
      memo[key] = pick;
      return pick;
    };
  }

  function fromTemplate(kit, slices, tmpl, N, density, rng, variety, variant) {
    const steps = new Array(N).fill(null);
    const pick = makePicker(kit, slices, rng, variety, variant);
    const altKs = kit.K.filter((i) => i !== kit.mainK), altSs = kit.S.filter((i) => i !== kit.mainS);
    const altK = (i) => (altKs.length ? altKs[(Math.floor(i / 4) + variant) % altKs.length] : pick('K', i));
    const altS = (i) => (altSs.length ? altSs[(Math.floor(i / 4) + variant) % altSs.length] : pick('S', i));
    const ghostVel = kit.G.length ? 0.8 : 0.4;
    let anchor = null;
    for (let i = 0; i < N; i++) {
      const ch = tmpl[i % tmpl.length];
      let st = null;
      switch (ch) {
        case 'K': st = mk(pick('K', i), 1); break;
        case 'k': st = mk(altK(i), 0.85); break;
        case 'S': st = mk(pick('S', i), 1); break;
        case 's': st = mk(altS(i), 0.8); break;
        case 'g': st = mk(pick('G', i), ghostVel); break;
        case 'h': st = mk(pick('H', i), 0.8); break;
        case 'o': st = mk(kit.altH !== kit.mainH && rng() > variety ? kit.altH : pick('H', i + 1), 0.8); break;
        case 'q': st = mk(pick('H', i), 0.7, { roll: 2 }); break;
        case 'Q': st = mk(pick('H', i), 0.7, { roll: 3 }); break;
        case 'X': st = [mk(pick('K', i), 1), mk(pick('S', i), 1)]; break;
        case 'Y': st = [mk(pick('K', i), 1), mk(pick('H', i), 0.8)]; break;
        case 'Z': st = [mk(pick('K', i), 1), mk(altS(i), 0.85)]; break;
        case 't': st = mk(pick('K', i), 0.85, { p: 5 }); break;
        case 'T': st = mk(pick('K', i), 0.85, { p: 9 }); break;
        case 'c': st = mk(pick('C', i), 0.85); break;
        case 'W': st = [mk(pick('K', i), 1), mk(pick('C', i), 0.85)]; break;
        case 'r': st = mk(pick('S', i), 0.9, { r: true }); break;
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
          // otherwise a hat: offbeat 8ths first, then on-beats, then 16ths
          if (pos === 2 && rng() < Math.min(1, density * 1.6)) st = mk(pick('H', i), 0.85);
          else if (pos === 0 && rng() < density * 0.5) st = mk(pick('H', i), 0.65);
          else if (pos % 2 === 1 && rng() < Math.max(0, (density - 0.5) * 1.4)) st = mk(pick('H', i + 1), 0.5);
        }
      }
      steps[i] = st;
      if (st && ch !== '.') anchor = { s: Array.isArray(st) ? st[0].s : st.s, i };
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
      if (!st || Array.isArray(st)) return;
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

  // Writes fill `type` (1-10) over the `len` steps ending at step `end` (exclusive).
  function applyFill(steps, kit, type, len, end) {
    const tmpl = BT.FILLS[type - 1].slice(16 - len);
    const altSs = kit.S.filter((i) => i !== kit.mainS);
    const altS = altSs.length ? altSs[0] : kit.mainS;
    const ghostVel = kit.G.length ? 0.75 : 0.4;
    for (let k = 0; k < len; k++) {
      const i = end - len + k;
      if (i < 0) continue;
      const ch = tmpl[k], v = 0.55 + (0.45 * (k + 1)) / len;
      let st;
      if (ch === '_') continue;
      else if (ch === 'S') st = mk(kit.mainS, v);
      else if (ch === 's') st = mk(altS, v * 0.9);
      else if (ch === 'g') st = mk(kit.mainG, ghostVel);
      else if (ch === 'K') st = mk(kit.mainK, 1);
      else if (ch === 'r') st = mk(kit.mainS, v, { r: true });
      else if (ch === 'u') st = mk(kit.mainS, v, { p: Math.round(-5 + (12 * k) / Math.max(1, len - 1)) });
      else if (ch >= '2' && ch <= '4') st = mk(kit.mainS, v, { roll: +ch });
      else st = null;
      steps[i] = st;
    }
  }

  // opts: { style, variant, bars, density, chaos, fill, fillType (0 = follow variant), fillLen (steps),
  //         fillEvery (bars, 0 = end only), salt, prev }
  // Patterns are built on 16ths, then spread onto the BT.RES-per-16th (32nd-note) grid.
  BT.generate = function (slices, srcSteps, opts) {
    const N = opts.bars * 16, NR = N * BT.RES;
    const pat = { steps: [], locks: new Array(NR).fill(false), style: opts.style, variant: opts.variant, edited: false };
    if (!slices.length) { pat.steps = Array.from({ length: NR }, () => []); return pat; }
    const kit = BT.analyzeKit(slices, srcSteps);
    const rng = BT.rng(BT.hash(opts.style + ':' + opts.variant + ':' + (opts.salt || 0)));
    let steps;
    if (opts.style === 'asplayed') steps = asPlayed(kit, N, opts.variant, rng);
    else {
      const density = opts.style === 'roller' ? Math.max(opts.density, 0.65) : opts.density;
      const variety = opts.variety == null ? 0.6 : opts.variety;
      steps = fromTemplate(kit, slices, T[opts.style][opts.variant - 1], N, density, rng, variety, opts.variant);
    }
    applyChaos(steps, kit, slices, opts.chaos, rng);
    if (opts.fill && N >= 8) {
      const type = opts.fillType || ((opts.variant - 1) % BT.FILLS.length) + 1;
      const len = Math.min(opts.fillLen || 4, N);
      const every = (opts.fillEvery || 0) * 16;
      if (every) for (let end = every; end < N; end += every) applyFill(steps, kit, type, len, end);
      applyFill(steps, kit, type, len, N);
    }
    pat.steps = Array.from({ length: NR }, (_, i) => {
      const st = i % BT.RES ? null : steps[i / BT.RES];
      return Array.isArray(st) ? st : st ? [st] : [];
    });
    // keep locked steps from the previous pattern
    const prev = opts.prev;
    if (prev) {
      for (let i = 0; i < NR && i < prev.steps.length; i++) {
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
      const anchorPos = i % (4 * BT.RES) === 0;
      if (!step.length) {
        if (anchorPos || i % BT.RES) return step;
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

  // MIDI notes: C1 (36) + slice index. Event times are in 16ths.
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
            ev.push({ step: base + (i + (k * BT.RES) / n) / BT.RES, len: n > 1 ? 1 / n : st.len ? st.len / BT.RES : Math.min(next / BT.RES, 4), note: 36 + st.s, vel: st.v });
          }
        });
      });
      base += N / BT.RES;
    });
    return { events: ev, total: base };
  };
})(window.BT);
