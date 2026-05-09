/* =====================================================================
 * 雀阁 · AI 选牌建议（智囊 / 机器人决策）
 * 全局对象：window.AISuggest（CommonJS 下：module.exports.AISuggest）
 *   AISuggest.suggest(myCards, lastInfo)
 *     myCards: [{value,type,...}, ...]   value: 3..15(2), 16(小王), 17(大王)
 *     lastInfo: { len, key, type, ctxPos }
 *               若 ctxPos === 'self' 或 lastInfo.len===0 → 自由出牌。
 *     return:  [{value,type}, ...]   建议出的牌；空数组表示不出/无可出。
 * 牌型 type 与 parser.js 对齐：
 *   A / AA / AAA / AAAB(3+1或飞机带单) / AAABB(3+2或飞机带对)
 *   ABCDE(顺) / AABBCC(连对) / AAABBB(纯飞机)
 *   AAAABC(4+2单) / AAAABBCC(4+2对) / AAAA(炸) / KING(王炸)
 * 设计要点：
 *   - 自由出牌：优先打出长牌型（顺子 > 连对 > 飞机 > 三带 > 对 > 单），尽量多消牌、保留高控牌。
 *   - 跟牌：完整覆盖以上各类，并支持炸/王炸压制。
 * ===================================================================== */
(function (global) {
  'use strict';

  // ========== 工具 ==========
  function byValAsc(a, b) { return a.value - b.value; }
  function isJoker(v) { return v === 16 || v === 17; }

  function groupByValue(cards) {
    var g = {};
    cards.forEach(function (c) { (g[c.value] = g[c.value] || []).push(c); });
    return g;
  }

  // 在 group 中根据 valuesArr 顺序，每个 value 取 n 张，拼成数组
  function takeFromValues(g, valuesArr, n) {
    var out = [];
    for (var i = 0; i < valuesArr.length; i++) {
      out = out.concat(g[valuesArr[i]].slice(0, n));
    }
    return out;
  }

  // 收集所有炸弹（包含王炸）。
  // type='AAAA' key=value, 或 type='KING' key=16
  function getBombs(g) {
    var out = [];
    Object.keys(g).forEach(function (k) {
      var v = +k;
      if (v < 16 && g[v].length >= 4) {
        out.push({ key: v, cards: g[v].slice(0, 4), type: 'AAAA' });
      }
    });
    out.sort(function (a, b) { return a.key - b.key; });
    if (g[16] && g[17]) {
      out.push({ key: 16, cards: [g[16][0], g[17][0]], type: 'KING' });
    }
    return out;
  }

  // 给飞机/4带 找附带牌：从 g 中挑选 tripleCount 组、每组 attachUnit 张牌作附带。
  // 排除 excludeValues（核心三/四的值）；优先用恰好等于 attachUnit 张的小值，避免拆三/拆炸。
  function findAttachments(g, excludeValues, groupCount, attachUnit) {
    var ex = {};
    excludeValues.forEach(function (v) { ex[v] = true; });
    // 候选：value (非核心、非王且数量 >= attachUnit)
    // attachUnit=1 时允许王作为单张候选；但优先非王
    var prim = [], second = [];
    Object.keys(g).forEach(function (k) {
      var v = +k;
      if (ex[v]) return;
      var n = g[v].length;
      if (n < attachUnit) return;
      // 等于 attachUnit 且非炸非王 → 最优；数量更多但非炸非王 → 次选
      if (isJoker(v)) { if (attachUnit === 1) second.push(v); return; }
      if (n === attachUnit) prim.push(v);
      else if (n < 4) second.push(v);
      else second.push(v); // 拆炸为最次选
    });
    prim.sort(function (a, b) { return a - b; });
    second.sort(function (a, b) {
      // 王留到最后；非炸优先
      var aJ = isJoker(a) ? 1 : 0, bJ = isJoker(b) ? 1 : 0;
      if (aJ !== bJ) return aJ - bJ;
      var aB = g[a].length >= 4 ? 1 : 0, bB = g[b].length >= 4 ? 1 : 0;
      if (aB !== bB) return aB - bB;
      return a - b;
    });
    var picks = prim.concat(second);
    if (picks.length < groupCount) return null;
    var sel = picks.slice(0, groupCount);
    return takeFromValues(g, sel, attachUnit);
  }

  // ========== 跟牌 ==========

  // 跟单（不主动拆炸；若手中只剩王也可走单）
  function followSingle(hand, key) {
    var g = groupByValue(hand);
    var keys = Object.keys(g).map(Number).sort(function (a, b) { return a - b; });
    // 优先：单张数量正好为1、且 < 16
    for (var i = 0; i < keys.length; i++) {
      var v = keys[i];
      if (v > key && g[v].length === 1 && !isJoker(v)) return [g[v][0]];
    }
    // 次：拆 2/3 张组（不拆炸）
    for (i = 0; i < keys.length; i++) {
      v = keys[i];
      if (v > key && g[v].length >= 1 && g[v].length < 4 && !isJoker(v)) return [g[v][0]];
    }
    // 单走小王 / 大王
    if (g[16] && key < 16) return [g[16][0]];
    if (g[17] && key < 17) return [g[17][0]];
    return null;
  }

  // 跟对（不拆炸；不算王）
  function followPair(hand, key) {
    var g = groupByValue(hand);
    var keys = Object.keys(g).map(Number).sort(function (a, b) { return a - b; });
    for (var i = 0; i < keys.length; i++) {
      var v = keys[i];
      if (v > key && !isJoker(v) && g[v].length >= 2 && g[v].length < 4) return g[v].slice(0, 2);
    }
    return null;
  }

  // 跟三（先不拆炸；找不到再拆）
  function followTriple(hand, key) {
    var g = groupByValue(hand);
    var keys = Object.keys(g).map(Number).sort(function (a, b) { return a - b; });
    for (var pass = 0; pass < 2; pass++) {
      for (var i = 0; i < keys.length; i++) {
        var v = keys[i];
        if (v > key && !isJoker(v) && g[v].length >= 3) {
          if (pass === 0 && g[v].length === 3) return g[v].slice(0, 3);
          if (pass === 1) return g[v].slice(0, 3);
        }
      }
    }
    return null;
  }

  // 跟三带 (attachUnit=1: 三带一; attachUnit=2: 三带二)
  function followTripleAttach(hand, key, attachUnit) {
    var triple = followTriple(hand, key);
    if (!triple) return null;
    var tv = triple[0].value;
    var rest = hand.filter(function (c) { return c.value !== tv; });
    if (!rest.length) return null;
    var rg = groupByValue(rest);
    var att = findAttachments(rg, [], 1, attachUnit);
    if (!att) return null;
    return triple.concat(att);
  }

  // 跟顺子（len 张连续，3..14）
  function followStraight(hand, key, len) {
    var g = groupByValue(hand);
    for (var start = key + 1; start + len - 1 <= 14; start++) {
      var ok = true;
      for (var k = 0; k < len; k++) {
        if (!g[start + k] || g[start + k].length < 1) { ok = false; break; }
      }
      if (ok) {
        var pick = [];
        for (var k2 = 0; k2 < len; k2++) pick.push(g[start + k2][0]);
        return pick;
      }
    }
    return null;
  }

  // 跟连对（len = 张数，对数 = len/2）
  function followPairRun(hand, key, len) {
    var pairs = len / 2;
    var g = groupByValue(hand);
    for (var start = key + 1; start + pairs - 1 <= 14; start++) {
      var ok = true;
      for (var k = 0; k < pairs; k++) {
        if (!g[start + k] || g[start + k].length < 2) { ok = false; break; }
      }
      if (ok) {
        var pick = [];
        for (var k2 = 0; k2 < pairs; k2++) pick = pick.concat(g[start + k2].slice(0, 2));
        return pick;
      }
    }
    return null;
  }

  // 跟纯飞机（len = 三的个数 * 3）
  function followPlane(hand, key, len) {
    var triples = len / 3;
    var g = groupByValue(hand);
    for (var start = key + 1; start + triples - 1 <= 14; start++) {
      var ok = true;
      for (var k = 0; k < triples; k++) {
        if (!g[start + k] || g[start + k].length < 3) { ok = false; break; }
      }
      if (ok) {
        var pick = [];
        for (var k2 = 0; k2 < triples; k2++) pick = pick.concat(g[start + k2].slice(0, 3));
        return pick;
      }
    }
    return null;
  }

  // 跟飞机带 (attachUnit=1 带单 / =2 带对)
  // len = triples * (3 + attachUnit)
  function followPlaneAttach(hand, key, len, attachUnit) {
    var triples = len / (3 + attachUnit);
    var g = groupByValue(hand);
    for (var start = key + 1; start + triples - 1 <= 14; start++) {
      var ok = true;
      var coreVals = [];
      for (var k = 0; k < triples; k++) {
        if (!g[start + k] || g[start + k].length < 3) { ok = false; break; }
        coreVals.push(start + k);
      }
      if (!ok) continue;
      var att = findAttachments(g, coreVals, triples, attachUnit);
      if (!att) continue;
      var pick = [];
      coreVals.forEach(function (v) { pick = pick.concat(g[v].slice(0, 3)); });
      return pick.concat(att);
    }
    return null;
  }

  // 跟 4 带 2 单
  function followFourTwoSingles(hand, key) {
    var g = groupByValue(hand);
    var fours = Object.keys(g).map(Number)
      .filter(function (v) { return !isJoker(v) && g[v].length >= 4; })
      .sort(function (a, b) { return a - b; });
    for (var i = 0; i < fours.length; i++) {
      var v = fours[i];
      if (v <= key) continue;
      var att = findAttachments(g, [v], 2, 1);
      if (att) return g[v].slice(0, 4).concat(att);
    }
    return null;
  }

  // 跟 4 带 2 对
  function followFourTwoPairs(hand, key) {
    var g = groupByValue(hand);
    var fours = Object.keys(g).map(Number)
      .filter(function (v) { return !isJoker(v) && g[v].length >= 4; })
      .sort(function (a, b) { return a - b; });
    for (var i = 0; i < fours.length; i++) {
      var v = fours[i];
      if (v <= key) continue;
      var att = findAttachments(g, [v], 2, 2);
      if (att) return g[v].slice(0, 4).concat(att);
    }
    return null;
  }

  // 用炸 / 王炸压制
  function followBomb(hand, lastType, lastKey) {
    var g = groupByValue(hand);
    var bombs = getBombs(g);
    for (var i = 0; i < bombs.length; i++) {
      var b = bombs[i];
      if (lastType === 'AAAA') {
        if (b.type === 'AAAA' && b.key > lastKey) return b.cards;
        if (b.type === 'KING') return b.cards;
      } else if (lastType === 'KING') {
        return null;
      } else {
        return b.cards;
      }
    }
    return null;
  }

  // ========== 自由出牌：综合选择最有价值的组合 ==========
  function freePlay(hand) {
    if (!hand.length) return [];
    var g = groupByValue(hand);

    // 1) 顺子（5..12 长，越长越优先；同长起手越小越优先）
    for (var L = 12; L >= 5; L--) {
      for (var s = 3; s + L - 1 <= 14; s++) {
        var ok = true;
        for (var k = 0; k < L; k++) if (!g[s + k] || g[s + k].length < 1) { ok = false; break; }
        if (ok) {
          var pick = [];
          for (var k2 = 0; k2 < L; k2++) pick.push(g[s + k2][0]);
          return pick;
        }
      }
    }

    // 2) 连对（≥3 对；越长越优先）
    for (var P = 8; P >= 3; P--) {
      for (var s2 = 3; s2 + P - 1 <= 14; s2++) {
        var ok2 = true;
        for (var k3 = 0; k3 < P; k3++) if (!g[s2 + k3] || g[s2 + k3].length < 2) { ok2 = false; break; }
        if (ok2) {
          var pick2 = [];
          for (var k4 = 0; k4 < P; k4++) pick2 = pick2.concat(g[s2 + k4].slice(0, 2));
          return pick2;
        }
      }
    }

    // 3) 飞机（≥2 三连续，可带单/带对）
    var bestPlane = null;
    var v = 3;
    while (v <= 14) {
      if (g[v] && g[v].length >= 3 && v < 15) {
        var e = v;
        while (e + 1 <= 14 && g[e + 1] && g[e + 1].length >= 3) e++;
        var cnt = e - v + 1;
        if (cnt >= 2 && (!bestPlane || cnt > bestPlane.count)) {
          bestPlane = { start: v, count: cnt };
        }
        v = e + 1;
      } else {
        v++;
      }
    }
    if (bestPlane) {
      var coreVals = [];
      var pickCore = [];
      for (var k5 = 0; k5 < bestPlane.count; k5++) {
        coreVals.push(bestPlane.start + k5);
        pickCore = pickCore.concat(g[bestPlane.start + k5].slice(0, 3));
      }
      // 优先带对，其次带单，其次裸飞
      var att = findAttachments(g, coreVals, bestPlane.count, 2);
      if (att) return pickCore.concat(att);
      att = findAttachments(g, coreVals, bestPlane.count, 1);
      if (att) return pickCore.concat(att);
      return pickCore;
    }

    // 4) 三带（小三优先；先三带二，再三带一，最后裸三）
    var triples = [];
    Object.keys(g).forEach(function (k) {
      var vv = +k;
      if (!isJoker(vv) && g[vv].length === 3) triples.push(vv);
    });
    triples.sort(function (a, b) { return a - b; });
    if (triples.length) {
      var tv = triples[0];
      var rest = hand.filter(function (c) { return c.value !== tv; });
      if (rest.length) {
        var rg = groupByValue(rest);
        var att2 = findAttachments(rg, [], 1, 2);
        if (att2) return g[tv].slice(0, 3).concat(att2);
        var att1 = findAttachments(rg, [], 1, 1);
        if (att1) return g[tv].slice(0, 3).concat(att1);
      }
      return g[tv].slice(0, 3);
    }

    // 5) 对子（最小，非炸）
    var pairs = [];
    Object.keys(g).forEach(function (k) {
      var vv = +k;
      if (!isJoker(vv) && g[vv].length === 2) pairs.push(vv);
    });
    pairs.sort(function (a, b) { return a - b; });
    if (pairs.length) return g[pairs[0]].slice(0, 2);

    // 6) 单张（优先非2非王的最小单）
    var singles = [];
    Object.keys(g).forEach(function (k) {
      var vv = +k;
      if (g[vv].length === 1) singles.push(vv);
    });
    singles.sort(function (a, b) { return a - b; });
    for (var x = 0; x < singles.length; x++) {
      if (singles[x] < 15) return [g[singles[x]][0]];
    }
    if (singles.length) return [g[singles[0]][0]];

    // 7) 仅余炸 / 王炸：拆最小一张
    var allKeys = Object.keys(g).map(Number).sort(function (a, b) { return a - b; });
    if (allKeys.length) return [g[allKeys[0]][0]];
    return [];
  }

  // ========== 入口 ==========
  function suggest(myCards, lastInfo) {
    if (!myCards || !myCards.length) return [];
    var hand = myCards.map(function (c) { return { value: c.value, type: c.type }; });
    hand.sort(byValAsc);

    var freeMode = !lastInfo || !lastInfo.len || lastInfo.ctxPos === 'self';
    if (freeMode) return freePlay(hand);

    var t = lastInfo.type, key = lastInfo.key, len = lastInfo.len;
    var pick = null;

    switch (t) {
      case 'A':        pick = followSingle(hand, key); break;
      case 'AA':       pick = followPair(hand, key); break;
      case 'AAA':      pick = followTriple(hand, key); break;
      case 'AAAB':
        if (len === 4) pick = followTripleAttach(hand, key, 1);
        else           pick = followPlaneAttach(hand, key, len, 1); // 飞机带单
        break;
      case 'AAABB':
        if (len === 5) pick = followTripleAttach(hand, key, 2);
        else           pick = followPlaneAttach(hand, key, len, 2); // 飞机带对
        break;
      case 'ABCDE':    pick = followStraight(hand, key, len); break;
      case 'AABBCC':   pick = followPairRun(hand, key, len); break;
      case 'AAABBB':   pick = followPlane(hand, key, len); break;
      case 'AAAABC':   pick = followFourTwoSingles(hand, key); break;
      case 'AAAABBCC': pick = followFourTwoPairs(hand, key); break;
      case 'AAAA':     pick = followBomb(hand, 'AAAA', key); break;
      case 'KING':     pick = null; break;
      default:         pick = null;
    }

    // 找不到常规跟法 → 试炸压
    if (!pick) pick = followBomb(hand, t, key);
    return pick || [];
  }

  global.AISuggest = { suggest: suggest };
})(typeof window !== 'undefined' ? window : this);
