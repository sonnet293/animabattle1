// js/main.js
// rule.md 기반 턴제 마스 레이드 진행 로직
// 흐름: 편성 → 출격 위치 배치 → [패턴 예고 → 행동 선택 → 이동 처리 → 행동 처리 → 적 공격 → 정산] 반복
(() => {
  'use strict';
  const $ = (s) => document.querySelector(s);

  // ───────── 상수 ─────────
  const STAT_KO = { power: '출력', endurance: '내구', mobility: '기동', sync: '동조' };
  const POS_BY_STAT = { power: '딜러', endurance: '탱커', mobility: '컨트롤러', sync: '서포터' };
  const CAT_KO = { attack: '공격', defense: '방어', control: '제어', support: '지원' };
  const PRIORITY = { defense: 1, control: 2, support: 3, attack: 4 }; // 같은 턴 행동 처리 순서
  const EFFECT_KO = { damage: '피해', heal: '회복', ego: 'EGO', calm: '아니마 -', shield: '보호막' };

  // ───────── 유틸 ─────────
  const K = (x, y) => x + ',' + y;
  const L = (x, y) => String.fromCharCode(65 + x) + (y + 1);
  const parseL = (s) => ({ x: s.toUpperCase().charCodeAt(0) - 65, y: parseInt(s.slice(1), 10) - 1 });
  const dist = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

  function getPosition(stats) {
    let best = null;
    for (const k in POS_BY_STAT) if (stats[k] >= 10 && (!best || stats[k] > stats[best])) best = k;
    if (!best) return '올라운더';
    return (stats[best] >= 12 ? '전문 ' : '') + POS_BY_STAT[best];
  }

  function validateStats(u) {
    const vals = Object.keys(STAT_KO).map((k) => u.stats[k]);
    const sum = vals.reduce((a, b) => a + b, 0);
    if (sum !== 30 || vals.some((v) => v < 3 || v > 15)) {
      console.warn(`[users.js] ${u.name}: 스탯 규칙 위반 (합계 ${sum}, 각 3~15 / 합계 30 이어야 함)`);
    }
    u.skills.forEach((id) => { if (!SKILLS[id]) console.warn(`[users.js] ${u.name}: 없는 스킬 ${id}`); });
  }

  // 데이터 객체의 키와 id가 달라도 id로 찾을 수 있도록
  const findById = (obj, id) => obj[id] || Object.values(obj).find((v) => v.id === id);

  const effVal = (c, eff) => Math.round((c.stats[eff.stat] || 0) * (eff.mult || 0) + (eff.base || 0));

  // ───────── 상태 ─────────
  let S = null;
  let pickMob = null;
  const pickUsers = new Set();

  const getChar = (id) => S.chars.find((c) => c.id === id);
  const active = () => S.chars.filter((c) => !c.retired && c.placed);
  const inB = (x, y) => x >= 0 && y >= 0 && x < S.arena.w && y < S.arena.h;
  const isObs = (x, y) => S.arena.obstacles.has(K(x, y));
  const isMob = (x, y, m = S.mob) => x >= m.x && x < m.x + m.size && y >= m.y && y < m.y + m.size;
  const charAt = (x, y) => active().find((c) => c.x === x && c.y === y);
  const plannedPos = (c) => c.plan.move || { x: c.x, y: c.y };
  const occupiedPlanned = (x, y, except) =>
    active().some((c) => c !== except && plannedPos(c).x === x && plannedPos(c).y === y);

  function mobCells(m = S.mob) {
    const out = [];
    for (let dy = 0; dy < m.size; dy++) for (let dx = 0; dx < m.size; dx++) out.push({ x: m.x + dx, y: m.y + dy });
    return out;
  }
  const distMob = (p) => Math.min(...mobCells().map((c) => dist(c, p)));
  const resetSt = (c) => { c.st = { dmgRed: [], disRed: [] }; };

  function log(msg, cls) {
    S.log.push({ msg, cls });
  }

  // ───────── 편성 화면 ─────────
  function renderSetup() {
    $('#mobList').innerHTML = Object.values(MOBS).map((m) => `
      <div class="card ${pickMob === m.id ? 'on' : ''}" data-mob="${m.id}">
        <b>${esc(m.name)}</b><br>
        HP ${m.hp} · 크기 ${m.size}x${m.size} · 전장 ${m.arena.w}x${m.arena.h}<br>
        <span class="muted">${esc(m.desc)}</span><br>
        패턴: ${m.patterns.map((p) => esc(p.name)).join(', ')}
        ${m.phases ? `<br><span class="warn">페이즈 전환 있음</span>` : ''}
      </div>`).join('');

    $('#userList').innerHTML = Object.values(USERS).map((u) => {
      return `
      <div class="card ${pickUsers.has(u.id) ? 'on' : ''}" data-user="${u.id}">
        <b>${esc(u.name)}</b> <span class="muted">(${esc(u.shell)})</span> — ${getPosition(u.stats)}<br>
        ${Object.keys(STAT_KO).map((k) => `${STAT_KO[k]} ${u.stats[k]}`).join(' / ')}<br>
        HP ${u.hp} · EGO ${u.ego} · 이동 ${u.move} · 사거리 ${u.basicRange || 1}<br>
        스킬: ${u.skills.map((id) => esc(SKILLS[id] ? SKILLS[id].name : id)).join(', ')}
      </div>`;
    }).join('');

    $('#btnStart').disabled = !(pickMob && pickUsers.size >= 1);
  }

  $('#setup').addEventListener('click', (e) => {
    const m = e.target.closest('[data-mob]');
    const u = e.target.closest('[data-user]');
    if (m) pickMob = m.dataset.mob;
    if (u) {
      const id = u.dataset.user;
      if (pickUsers.has(id)) pickUsers.delete(id);
      else if (pickUsers.size < 4) pickUsers.add(id);
    }
    if (e.target.id === 'btnStart') return startBattle();
    renderSetup();
  });

  // ───────── 전투 초기화 ─────────
  function makeChar(u) {
    const d = { maxHp: u.hp, maxEgo: u.ego, move: u.move };
    const c = {
      id: u.id, def: u, name: u.name, stats: u.stats, d,
      position: getPosition(u.stats),
      hp: d.maxHp, ego: d.maxEgo, anima: 0,
      x: -1, y: -1, placed: false, downed: false, retired: false,
      cds: {}, plan: { move: null, action: null },
    };
    resetSt(c);
    return c;
  }

  function startBattle() {
    const m = findById(MOBS, pickMob);
    const ar = m.arena;
    const start = parseL(m.start);
    S = {
      phase: 'deploy', turn: 1, log: [], msg: '',
      arena: {
        w: ar.w, h: ar.h,
        obstacles: new Set(ar.obstacles.map((l) => { const p = parseL(l); return K(p.x, p.y); })),
        deploy: new Set(),
      },
      mob: {
        def: m, name: m.name, hp: m.hp, maxHp: m.hp, size: m.size, x: start.x, y: start.y,
        patterns: m.patterns, pIdx: 0, phaseIdx: -1, weaken: 1, vuln: null, lastPattern: null,
      },
      chars: [...pickUsers].map((id) => makeChar(findById(USERS, id))),
      telegraph: null, sel: null, mode: null, pending: null,
    };
    ar.deployRows.forEach((row) => {
      for (let x = 0; x < ar.w; x++) if (!isObs(x, row - 1)) S.arena.deploy.add(K(x, row - 1));
    });
    S.sel = S.chars[0].id;
    log(`[전장 공개] ${ar.w}x${ar.h} · 장애물 ${ar.obstacles.join(', ') || '없음'} · ${m.name} 출현 (${L(start.x, start.y)})`);
    log('출격 구역(파란 칸)에 이나니스를 배치하세요.');
    $('#setup').hidden = true;
    $('#result').hidden = true;
    $('#battle').hidden = false;
    render();
  }

  // ───────── 이동/대상 계산 ─────────
  function reachable(c) {
    const res = new Set([K(c.x, c.y)]);
    const seen = new Map([[K(c.x, c.y), 0]]);
    const q = [{ x: c.x, y: c.y }];
    while (q.length) {
      const p = q.shift();
      const d = seen.get(K(p.x, p.y));
      if (d >= c.d.move) continue;
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        const nx = p.x + dx, ny = p.y + dy, k = K(nx, ny);
        if ((!dx && !dy) || !inB(nx, ny) || isObs(nx, ny) || isMob(nx, ny) || seen.has(k)) continue;
        seen.set(k, d + 1);
        q.push({ x: nx, y: ny }); // 아군 칸은 통과 가능, 종료만 불가
        if (!occupiedPlanned(nx, ny, c)) res.add(k);
      }
    }
    return res;
  }

  // 반환: Map(셀키 → 대상 객체)
  function validTargets(c, pend) {
    const o = plannedPos(c);
    const out = new Map();
    const addMob = (range) => {
      if (distMob(o) <= range) mobCells().forEach((p) => out.set(K(p.x, p.y), { kind: 'mob' }));
    };
    if (pend.type === 'attack') { addMob(c.def.basicRange || 1); return out; }
    const sk = SKILLS[pend.skillId];
    if (sk.target === 'enemy') addMob(sk.range);
    else if (sk.target === 'ally') {
      active().forEach((a) => {
        if (a === c && !sk.includeSelf) return;
        const ap = plannedPos(a);
        if (dist(o, ap) <= sk.range) out.set(K(ap.x, ap.y), { kind: 'char', id: a.id });
      });
    } else if (sk.target === 'cell') {
      for (let y = 0; y < S.arena.h; y++) for (let x = 0; x < S.arena.w; x++) {
        if (isObs(x, y) || isMob(x, y) || occupiedPlanned(x, y, c)) continue;
        const dd = dist(o, { x, y });
        if (dd > 0 && dd <= sk.range) out.set(K(x, y), { kind: 'cell', x, y });
      }
    }
    return out;
  }

  function targetStillValid(c) {
    const a = c.plan.action;
    if (!a || !a.target) return true;
    const t = validTargets(c, a);
    if (a.target.kind === 'mob') return true; // 몹 대상은 유지, 사거리 밖이면 계획에 경고 표시
    if (a.target.kind === 'cell') return t.has(K(a.target.x, a.target.y));
    return [...t.values()].some((v) => v.id === a.target.id);
  }

  // ───────── 적 패턴 ─────────
  function pickTarget(rule) {
    const pool = active();
    if (!pool.length) return null;
    const by = (f, dir) => pool.reduce((b, c) => (dir * (f(c) - f(b)) > 0 ? c : b));
    switch (rule) {
      case 'farthest': return by(distMob, 1);
      case 'lowestHp': return by((c) => c.hp, -1);
      case 'highestAnima': return by((c) => c.anima, 1);
      case 'random': return pick(pool);
      default: return by(distMob, -1); // nearest
    }
  }

  function reveal() {
    const m = S.mob;
    let p;
    if (m.def.sequence === 'random') {
      const pool = m.patterns.length > 1 ? m.patterns.filter((x) => x !== m.lastPattern) : m.patterns;
      p = pick(pool);
    } else {
      p = m.patterns[m.pIdx % m.patterns.length];
      m.pIdx++;
    }
    m.lastPattern = p;
    const tg = { pattern: p };
    if (['targetBlast', 'row', 'column', 'lockOn'].includes(p.shape)) {
      const t = pickTarget(p.targetRule);
      if (t) { tg.targetId = t.id; tg.center = { x: t.x, y: t.y }; }
    }
    if (p.shape === 'randomCells') {
      const all = [];
      for (let y = 0; y < S.arena.h; y++) for (let x = 0; x < S.arena.w; x++)
        if (!isObs(x, y) && !isMob(x, y)) all.push(K(x, y));
      all.sort(() => Math.random() - 0.5);
      tg.cells = all.slice(0, p.count || 8);
    }
    S.telegraph = tg;
    const t = tg.targetId ? getChar(tg.targetId) : null;
    log(`── ${S.turn}턴 ── [패턴 예고] ${p.name}: ${p.desc}${t ? ` (대상: ${t.name})` : ''}`, 'turn');
  }

  const getTaunter = () => active().find((c) => c.st.taunt && !c.downed);

  // final=true 이면 실제 공격 시점 (도발 적용, 몹 위치 변경 반영)
  function attackCells(final) {
    const tg = S.telegraph;
    if (!tg) return [];
    const p = tg.pattern, m = S.mob, r = p.radius || 0;
    const taunter = final ? getTaunter() : null;
    const center = taunter ? { x: taunter.x, y: taunter.y } : tg.center;
    const out = [];
    const each = (fn) => {
      for (let y = 0; y < S.arena.h; y++) for (let x = 0; x < S.arena.w; x++)
        if (!isObs(x, y) && !isMob(x, y) && fn(x, y)) out.push(K(x, y));
    };
    const gap = (v, lo, hi) => (v < lo ? lo - v : v > hi ? v - hi : 0);
    switch (p.shape) {
      case 'around': each((x, y) => distMob({ x, y }) <= r); break;
      case 'cross': {
        const x0 = m.x, x1 = m.x + m.size - 1, y0 = m.y, y1 = m.y + m.size - 1;
        each((x, y) => (y >= y0 && y <= y1 && gap(x, x0, x1) <= r) || (x >= x0 && x <= x1 && gap(y, y0, y1) <= r));
        break;
      }
      case 'all': each(() => true); break;
      case 'targetBlast': if (center) each((x, y) => dist({ x, y }, center) <= r); break;
      case 'row': if (center) each((x, y) => Math.abs(y - center.y) <= r); break;
      case 'column': if (center) each((x, y) => Math.abs(x - center.x) <= r); break;
      case 'randomCells': out.push(...tg.cells); break;
      case 'lockOn': {
        const t = taunter || getChar(tg.targetId);
        if (t && !t.retired) {
          const pp = final ? t : plannedPos(t);
          out.push(K(pp.x, pp.y));
        }
        break;
      }
      default: break; // none
    }
    return out;
  }

  // ───────── 게이지 처리 ─────────
  function raiseAnima(c, n, why) {
    if (c.retired || n <= 0) return;
    c.anima = Math.min(100, c.anima + n);
    log(`  ${c.name} 아니마 +${n} (${why}) → ${c.anima}`);
    if (c.anima >= 100) arhat(c);
  }

  function arhat(c) {
    c.retired = true;
    log(`  ★ ${c.name} 아라한화! 이나니스가 붕괴하여 리타이어합니다. (${L(c.x, c.y)})`, 'bad');
  }

  function heal(c, n) {
    if (c.retired) return;
    const before = c.hp;
    c.hp = Math.min(c.d.maxHp, c.hp + n);
    log(`  ${c.name} HP +${c.hp - before} → ${c.hp}`);
    if (c.downed && c.hp > 0) { c.downed = false; log(`  ${c.name} 기절에서 깨어남 (다음 턴부터 행동)`, 'good'); }
  }

  function applyHit(c, dmg, dis) {
    let dm = dmg, ds = dis;
    if (c.st.defend) { dm *= 0.5; ds *= 0.5; }
    c.st.dmgRed.forEach((r) => { dm *= 1 - r; });
    c.st.disRed.forEach((r) => { ds *= 1 - r; });
    dm = Math.ceil(dm); ds = Math.ceil(ds); // 감소 후 올림
    const parts = [];
    if (c.st.shield && dm > 0) {
      const ab = Math.min(c.st.shield, dm);
      c.st.shield -= ab; dm -= ab;
      parts.push(`보호막 ${ab} 흡수`);
    }
    if (dm > 0 || dmg > 0) {
      c.hp = Math.max(0, c.hp - dm);
      parts.push(`HP -${dm} → ${c.hp}`);
    }
    if (ds > 0) {
      if (c.ego > 0) {
        c.ego = Math.max(0, c.ego - ds);
        parts.push(`EGO -${ds} → ${c.ego}`);
      } else {
        parts.push(`교란 ${ds} (에고 없음)`);
      }
    }
    log(`  ${c.name} 피격: ${parts.join(', ') || '피해 없음'}`);
    // EGO 파괴 상태에서 받은 교란은 아니마 상승
    if (ds > 0 && parts.some((x) => x.startsWith('교란'))) raiseAnima(c, ds, '교란');
    else if (ds > 0 && c.ego === 0) log(`  ${c.name}의 에고 파괴! 이후 교란은 아니마를 상승시킵니다.`, 'bad');
    if (c.hp === 0 && !c.downed && !c.retired) { c.downed = true; log(`  ${c.name} 기절!`, 'bad'); }
  }

  function hitMob(c, base, label) {
    const m = S.mob;
    const mult = (c.st.empower || 1) * (m.vuln ? m.vuln.mult : 1);
    const dmg = Math.round(base * mult);
    m.hp = Math.max(0, m.hp - dmg);
    log(`  ${c.name}의 ${label} → ${m.name}에게 ${dmg} 피해${mult !== 1 ? ` (x${mult.toFixed(2)})` : ''} (HP ${m.hp}/${m.maxHp})`);
  }

  function canPlaceMob(x, y) {
    const m = S.mob;
    for (let dy = 0; dy < m.size; dy++) for (let dx = 0; dx < m.size; dx++) {
      const cx = x + dx, cy = y + dy;
      if (!inB(cx, cy) || isObs(cx, cy) || charAt(cx, cy)) return false;
    }
    return true;
  }

  function moveMob(c, sign, n) {
    const m = S.mob;
    const cx = m.x + (m.size - 1) / 2, cy = m.y + (m.size - 1) / 2;
    const dx = Math.sign(cx - c.x) * sign, dy = Math.sign(cy - c.y) * sign;
    let moved = 0;
    for (let i = 0; i < n; i++) {
      const opts = [[dx, dy], [dx, 0], [0, dy]].filter(([a, b]) => a || b);
      const ok = opts.find(([a, b]) => canPlaceMob(m.x + a, m.y + b));
      if (!ok) break;
      m.x += ok[0]; m.y += ok[1]; moved++;
    }
    log(moved ? `  ${m.name}이(가) ${moved}칸 ${sign > 0 ? '밀려났다' : '끌려왔다'} → ${L(m.x, m.y)}` : `  ${m.name}을(를) 움직일 공간이 없다.`);
  }

  function teleportMob() {
    const m = S.mob, opts = [];
    for (let y = 0; y < S.arena.h; y++) for (let x = 0; x < S.arena.w; x++) {
      if (canPlaceMob(x, y) && !(x === m.x && y === m.y)) opts.push({ x, y });
    }
    if (!opts.length) return;
    const p = pick(opts);
    m.x = p.x; m.y = p.y;
    log(`  ${m.name}이(가) ${L(p.x, p.y)}로 순간이동했다.`);
  }

  function freeCell(x, y) {
    return inB(x, y) && !isObs(x, y) && !isMob(x, y) && !charAt(x, y);
  }

  // ───────── 행동 처리 ─────────
  function resolveTarget(c, sk, t) {
    switch (sk.target) {
      case 'self': return { kind: 'self' };
      case 'enemy': return distMob(c) <= sk.range ? { kind: 'mob' } : false;
      case 'ally': {
        const a = t && getChar(t.id);
        return a && !a.retired && dist(c, a) <= sk.range ? a : false;
      }
      case 'cell':
        return t && freeCell(t.x, t.y) && dist(c, t) <= sk.range ? t : false;
      default: return false;
    }
  }

  function applyEffects(c, sk, tgt) {
    const recips = () => {
      if (sk.area) {
        const center = sk.target === 'self' ? c : tgt;
        return active().filter((a) => dist(a, center) <= sk.area.radius);
      }
      if (sk.target === 'self') return [c];
      if (sk.target === 'ally') return [tgt];
      return [];
    };
    sk.effects.forEach((eff) => {
      const v = effVal(c, eff);
      switch (eff.type) {
        case 'damage': hitMob(c, v, sk.name); break;
        case 'heal': recips().forEach((r) => heal(r, v)); break;
        case 'ego': recips().forEach((r) => {
          r.ego = Math.min(r.d.maxEgo, r.ego + v);
          log(`  ${r.name} EGO 회복 → ${r.ego}`, 'good');
        }); break;
        case 'calm': recips().forEach((r) => {
          r.anima = Math.max(0, r.anima - v);
          log(`  ${r.name} 아니마 -${v} → ${r.anima}`, 'good');
        }); break;
        case 'taunt':
          c.st.taunt = true; c.st.dmgRed.push(eff.reduce || 0);
          log(`  ${c.name}이(가) 적을 도발한다!`);
          break;
        case 'cover':
          tgt.st.coveredBy = c.id;
          log(`  ${c.name}이(가) ${tgt.name}을(를) 엄호한다.`);
          break;
        case 'reduce': recips().forEach((r) => {
          if (eff.dmg) r.st.dmgRed.push(eff.dmg);
          if (eff.disrupt) r.st.disRed.push(eff.disrupt);
          log(`  ${r.name} 이번 턴 피해 -${Math.round((eff.dmg || 0) * 100)}% / 교란 -${Math.round((eff.disrupt || 0) * 100)}%`);
        }); break;
        case 'shield': recips().forEach((r) => {
          r.st.shield = (r.st.shield || 0) + v;
          log(`  ${r.name} 보호막 ${v}`);
        }); break;
        case 'push': moveMob(c, 1, eff.dist || 1); break;
        case 'pull': moveMob(c, -1, eff.dist || 1); break;
        case 'rescue': {
          if (dist(c, tgt) <= 1) { log(`  ${tgt.name}은(는) 이미 곁에 있다.`); break; }
          const opts = [];
          for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++)
            if ((dx || dy) && freeCell(c.x + dx, c.y + dy)) opts.push({ x: c.x + dx, y: c.y + dy });
          if (!opts.length) { log('  끌어올 빈 칸이 없다.'); break; }
          opts.sort((a, b) => dist(a, tgt) - dist(b, tgt));
          tgt.x = opts[0].x; tgt.y = opts[0].y;
          log(`  ${tgt.name}을(를) ${L(tgt.x, tgt.y)}로 끌어왔다.`, 'good');
          break;
        }
        case 'blink':
          c.x = tgt.x; c.y = tgt.y;
          log(`  ${c.name}이(가) ${L(c.x, c.y)}로 순간이동.`);
          break;
        case 'swap': {
          const tx = tgt.x, ty = tgt.y;
          tgt.x = c.x; tgt.y = c.y; c.x = tx; c.y = ty;
          log(`  ${c.name} ↔ ${tgt.name} 위치 교환.`);
          break;
        }
        case 'weaken':
          S.mob.weaken *= eff.mult;
          log(`  ${S.mob.name}의 이번 공격 위력 x${eff.mult}`);
          break;
        case 'vulnerable':
          S.mob.vuln = { mult: eff.mult, turns: eff.turns };
          log(`  ${S.mob.name}에게 약점 표식 (${eff.turns}턴, 받는 피해 x${eff.mult})`);
          break;
        case 'empower': recips().forEach((r) => {
          r.st.empower = Math.max(r.st.empower || 1, eff.mult);
          log(`  ${r.name} 이번 턴 공격 x${eff.mult}`, 'good');
        }); break;
        default: break;
      }
    });
  }

  function actionCategory(a) {
    if (!a) return 'attack';
    if (a.type === 'defend') return 'defense';
    if (a.type === 'skill') return SKILLS[a.skillId].category;
    return 'attack';
  }

  function doAction(c) {
    const a = c.plan.action;
    if (!a || c.retired || c.downed) return;
    if (a.type === 'wait') { log(`${c.name}: 대기`); return; }
    if (a.type === 'defend') { c.st.defend = true; log(`${c.name}: 방어 태세 (이번 턴 피해·교란 -50%)`); return; }
    if (a.type === 'attack') {
      log(`${c.name}: 기본 공격`);
      if (distMob(c) > (c.def.basicRange || 1)) { log('  사거리 밖 — 공격 실패', 'bad'); return; }
      hitMob(c, c.stats.power * 2, '기본 공격');
      return;
    }
    const sk = SKILLS[a.skillId];
    log(`${c.name}: ${sk.name}`);
    const tgt = resolveTarget(c, sk, a.target);
    if (tgt === false) { log('  대상이 사거리 밖이거나 유효하지 않음 — 스킬 실패', 'bad'); return; }
    c.cds[sk.id] = sk.cooldown + 1; // 정산 때 1 감소
    raiseAnima(c, sk.anima, '스킬 사용');
    if (c.retired) { log(`  아라한화로 ${sk.name} 발동 실패`, 'bad'); return; }
    applyEffects(c, sk, tgt);
  }

  function resolveMoves() {
    let pending = active().filter((c) => !c.downed && c.plan.move);
    let progress = true;
    while (pending.length && progress) {
      progress = false;
      for (const c of [...pending]) {
        const m = c.plan.move;
        if (!charAt(m.x, m.y)) {
          log(`${c.name}: ${L(c.x, c.y)} → ${L(m.x, m.y)} 이동`);
          c.x = m.x; c.y = m.y;
          pending = pending.filter((p) => p !== c);
          progress = true;
        }
      }
    }
    pending.forEach((c) => log(`${c.name}: 목적지가 점유되어 이동 실패`, 'bad'));
  }

  function mobAttack() {
    const tg = S.telegraph, p = tg.pattern, m = S.mob;
    log(`[적 공격] ${m.name} — ${p.name}`, 'turn');
    if (p.shape === 'none') { log(`  ${p.desc}`); return; }
    const dmg = p.damage * m.weaken, dis = p.disrupt * m.weaken;
    let hits;
    if (p.shape === 'lockOn') {
      const t = getTaunter() || getChar(tg.targetId);
      hits = t && !t.retired ? [t] : [];
    } else {
      const cells = new Set(attackCells(true));
      hits = active().filter((c) => cells.has(K(c.x, c.y)));
    }
    const taunter = getTaunter();
    if (taunter && ['targetBlast', 'row', 'column', 'lockOn'].includes(p.shape)) log(`  도발! 공격이 ${taunter.name}에게 향한다.`);
    if (!hits.length) { log('  아무도 맞지 않았다.', 'good'); return; }
    hits.forEach((c) => {
      let recv = c;
      const cv = c.st.coveredBy && getChar(c.st.coveredBy);
      if (cv && !cv.retired && !cv.downed && cv !== c) { recv = cv; log(`  ${cv.name}이(가) ${c.name} 대신 공격을 받는다!`); }
      if (!recv.retired) applyHit(recv, dmg, dis);
    });
  }

  function checkEnd() {
    if (S.mob.hp <= 0) return endBattle(true);
    if (!active().some((c) => !c.downed)) return endBattle(false);
    return false;
  }

  function settle() {
    const m = S.mob;
    if (S.telegraph.pattern.after === 'teleport') teleportMob();
    S.chars.forEach((c) => {
      resetSt(c);
      Object.keys(c.cds).forEach((k) => { if (c.cds[k] > 0) c.cds[k]--; });
      c.plan = { move: null, action: null };
    });
    m.weaken = 1;
    if (m.vuln && --m.vuln.turns <= 0) m.vuln = null;
    (m.def.phases || []).forEach((ph, i) => {
      if (i > m.phaseIdx && m.hp / m.maxHp < ph.hpBelow) {
        m.phaseIdx = i; m.patterns = ph.patterns; m.pIdx = 0;
        log(`[페이즈 전환] ${ph.message}`, 'bad');
      }
    });
    S.turn++;
    reveal();
  }

  function runTurn() {
    S.msg = '';
    S.mode = null;
    log(`[행동 처리] ${S.turn}턴`, 'turn');
    resolveMoves();
    const order = active()
      .filter((c) => !c.downed && c.plan.action)
      .sort((a, b) => PRIORITY[actionCategory(a.plan.action)] - PRIORITY[actionCategory(b.plan.action)]
        || b.stats.mobility - a.stats.mobility);
    for (const c of order) {
      doAction(c);
      if (S.mob.hp <= 0) break;
    }
    if (checkEnd()) return;
    mobAttack();
    if (checkEnd()) return;
    settle();
    render();
  }

  function endBattle(win) {
    S.phase = 'over';
    log(win ? `[전투 종료] ${S.mob.name} 토벌 성공!` : '[전투 종료] 파티 전멸...', win ? 'good' : 'bad');
    $('#battle').hidden = true;
    const r = $('#result');
    r.hidden = false;
    r.innerHTML = `
      <h2>${win ? '토벌 성공' : '토벌 실패'}</h2>
      <p>${esc(S.mob.name)} · ${S.turn}턴 · 남은 HP ${S.mob.hp}/${S.mob.maxHp}</p>
      ${S.chars.map((c) => `
        <div class="box"><b>${esc(c.name)}</b> (${c.position}) —
          ${c.retired ? '<span class="warn">아라한화 (리타이어)</span>' : c.downed ? '기절' : '생존'}
          · HP ${c.hp}/${c.d.maxHp} · EGO ${c.ego}/${c.d.maxEgo} · 아니마 ${c.anima}
        </div>`).join('')}
      <button id="btnAgain">편성으로 돌아가기</button>
      <h3>전투 기록</h3>
      <div id="log2" style="max-height:300px;overflow:auto;font-size:12px;white-space:pre-wrap;border:1px solid #ccc;padding:6px">${S.log.map((l) => esc(l.msg)).join('\n')}</div>`;
    return true;
  }

  $('#result').addEventListener('click', (e) => {
    if (e.target.id !== 'btnAgain') return;
    $('#result').hidden = true;
    $('#setup').hidden = false;
    renderSetup();
  });

  // ───────── 렌더링 ─────────
  const bar = (v, max, color) => `<span class="bar"><i style="width:${Math.max(0, Math.min(100, (v / max) * 100))}%;background:${color}"></i></span>`;

  function render() {
    renderTop();
    renderBoard();
    renderSide();
    const lg = $('#log');
    lg.innerHTML = S.log.map((l) => `<div class="${l.cls === 'bad' ? 'warn' : ''}">${l.cls === 'turn' ? '<b>' : ''}${esc(l.msg)}${l.cls === 'turn' ? '</b>' : ''}</div>`).join('');
    lg.scrollTop = lg.scrollHeight;
  }

  function renderTop() {
    $('#topbar').innerHTML = S.phase === 'deploy'
      ? '<b>출격 준비</b> — 캐릭터를 고른 뒤 파란 출격 구역을 클릭해 배치하세요.'
      : `<b>${S.turn}턴</b> — 캐릭터를 선택해 이동 칸(하늘색)과 행동을 정한 뒤 [턴 실행]을 누르세요. 모든 행동은 동시에 제출되어 우선순위(방어 → 제어 → 지원 → 공격)대로 처리됩니다.`;
  }

  function renderBoard() {
    const A = S.arena, sel = getChar(S.sel);
    let reach = new Set(), targets = new Map(), range = new Set();
    if (S.phase === 'plan' && sel && !sel.downed && !sel.retired) {
      const pend = S.mode === 'target' ? S.pending : S.preview;
      if (pend) {
        targets = validTargets(sel, pend);
        const o = plannedPos(sel);
        const r = pend.type === 'attack' ? (sel.def.basicRange || 1) : SKILLS[pend.skillId].range;
        for (let y = 0; y < A.h; y++) for (let x = 0; x < A.w; x++) {
          const dd = dist(o, { x, y });
          if (dd > 0 && dd <= r && !isObs(x, y) && !isMob(x, y)) range.add(K(x, y));
        }
      } else reach = reachable(sel);
    }
    if (S.phase === 'deploy') A.deploy.forEach((k) => { const [x, y] = k.split(',').map(Number); if (!charAt(x, y)) reach.add(k); });
    const danger = S.phase === 'plan' ? new Set(attackCells(false)) : new Set();

    // 계획된 행동 표시: 대상 칸(몹/아군/지정 칸) 또는 자기 칸(방어·대기·자기 스킬)
    const actMarks = new Map();
    if (S.phase === 'plan') active().forEach((c) => {
      const a = c.plan.action;
      if (!a || c.downed) return;
      const name = { attack: '공격', defend: '방어', wait: '대기' }[a.type] || SKILLS[a.skillId].name;
      let pos = plannedPos(c);
      const t = a.target;
      if (t && t.kind === 'mob') pos = { x: S.mob.x, y: S.mob.y };
      else if (t && t.kind === 'char') { const tc = getChar(t.id); if (tc) pos = plannedPos(tc); }
      else if (t && t.kind === 'cell') pos = t;
      const key = K(pos.x, pos.y);
      if (!actMarks.has(key)) actMarks.set(key, []);
      actMarks.get(key).push(`${c.name}:${name}`);
    });

    let h = '<div class="cell head"></div>';
    for (let x = 0; x < A.w; x++) h += `<div class="cell head">${String.fromCharCode(65 + x)}</div>`;
    for (let y = 0; y < A.h; y++) {
      h += `<div class="cell head">${y + 1}</div>`;
      for (let x = 0; x < A.w; x++) {
        const k = K(x, y);
        const cls = ['cell'];
        if (S.phase === 'deploy' && A.deploy.has(k)) cls.push('deploy');
        if (isObs(x, y)) cls.push('obstacle');
        if (isMob(x, y)) cls.push('mob');
        if (danger.has(k)) cls.push('danger');
        if (reach.has(k)) cls.push('reach');
        if (range.has(k)) cls.push('range');
        if (targets.has(k)) cls.push('target');
        let inner = '';
        if (x === S.mob.x && y === S.mob.y) inner += `<span class="tok">${esc(S.mob.name.split(' ').pop())}</span>`;
        const c = charAt(x, y);
        if (c) inner += `<span class="tok ${c.id === S.sel ? 'sel' : ''} ${c.downed ? 'down' : ''}">${esc(c.name)}${c.downed ? '(기절)' : ''}</span>`;
        const ghost = active().filter((a) => a.plan.move && a.plan.move.x === x && a.plan.move.y === y);
        if (ghost.length) inner += `<span class="ghost">→${ghost.map((g) => esc(g.name)).join(',')}</span>`;
        const acts = actMarks.get(k);
        if (acts) inner += `<span class="act" title="${esc(acts.join(', '))}">${acts.map(esc).join('<br>')}</span>`;
        inner += `<span class="coord">${L(x, y)}</span>`;
        h += `<div class="${cls.join(' ')}" data-x="${x}" data-y="${y}">${inner}</div>`;
      }
    }
    const board = $('#board');
    board.style.gridTemplateColumns = `28px repeat(${A.w}, 52px)`;
    board.innerHTML = h;
  }

  function planText(c) {
    const p = c.plan, parts = [];
    if (p.move) parts.push(`이동 → ${L(p.move.x, p.move.y)}`);
    const a = p.action;
    if (a) {
      let t = { attack: '기본 공격', defend: '방어', wait: '대기' }[a.type] || SKILLS[a.skillId].name;
      if (a.target) {
        if (a.target.kind === 'char') t += ` → ${getChar(a.target.id).name}`;
        if (a.target.kind === 'cell') t += ` → ${L(a.target.x, a.target.y)}`;
        if (a.target.kind === 'mob') {
          t += ` → ${S.mob.name}`;
          if (!validTargets(c, a).size) t += ' <span class="warn">(사거리 밖)</span>';
        }
      }
      parts.push(t);
    } else if (S.mode === 'target' && S.sel === c.id && S.pending) {
      parts.push(`<span class="muted">${esc(SKILLS[S.pending.skillId].name)}: 대상 선택 중</span>`);
    }
    return parts.join(' / ') || '<span class="muted">미정</span>';
  }

  function skillPreview(c, sk) {
    const vals = sk.effects.filter((e) => e.stat).map((e) => `${EFFECT_KO[e.type] || e.type} ${effVal(c, e)}`);
    return vals.length ? ` (${vals.join(', ')})` : '';
  }

  function renderSide() {
    const m = S.mob, sel = getChar(S.sel);
    let h = '';

    // 몹 정보 & 예고
    h += `<div class="box"><b>${esc(m.name)}</b> ${bar(m.hp, m.maxHp, '#c33')} ${m.hp}/${m.maxHp} · 위치 ${L(m.x, m.y)}
      ${m.vuln ? `<br>약점 표식: 받는 피해 x${m.vuln.mult} (${m.vuln.turns}턴)` : ''}`;
    if (S.phase === 'plan' && S.telegraph) {
      const p = S.telegraph.pattern, t = S.telegraph.targetId && getChar(S.telegraph.targetId);
      h += `<br><span class="warn"><b>예고: ${esc(p.name)}</b></span> — ${esc(p.desc)}
        <br>피해 ${p.damage} · 교란 ${p.disrupt}${t ? ` · 대상 ${esc(t.name)}` : ''}
        ${['targetBlast', 'row', 'column', 'lockOn'].includes(p.shape) ? '<br><span class="muted">도발 시 도발자에게 향함</span>' : ''}
        ${['around', 'cross'].includes(p.shape) ? '<br><span class="muted">몹 위치 기준 — 밀치기/끌어오기로 범위 이동 가능</span>' : ''}
        ${p.shape === 'lockOn' ? '<br><span class="muted">추적 공격 — 이동으로 회피 불가</span>' : ''}`;
    }
    h += '</div>';

    // 파티
    h += '<div class="box"><b>파티</b>';
    S.chars.forEach((c) => {
      h += `<div class="unit ${c.id === S.sel ? 'sel' : ''} ${c.retired ? 'out' : ''}" data-char="${c.id}">
        <b>${esc(c.name)}</b> <span class="muted">${c.position}</span>
        ${c.placed ? `· ${L(c.x, c.y)}` : '· 미배치'}
        ${c.retired ? '<span class="warn"> 아라한화(리타이어)</span>' : c.downed ? '<span class="warn"> 기절</span>' : ''}<br>
        HP ${bar(c.hp, c.d.maxHp, '#3a3')} ${c.hp}/${c.d.maxHp}
        EGO ${bar(c.ego, c.d.maxEgo, '#36c')} ${c.ego}/${c.d.maxEgo}${c.ego === 0 ? '<span class="warn">(파괴)</span>' : ''}<br>
        아니마 ${bar(c.anima, 100, '#a3a')} <span class="${c.anima >= 70 ? 'warn' : ''}">${c.anima}/100</span>
        ${S.phase === 'plan' && !c.retired && !c.downed ? `<br>계획: ${planText(c)}` : ''}
      </div>`;
    });
    h += '</div>';

    // 선택 캐릭터 조작
    if (S.phase === 'deploy') {
      h += `<div class="box">배치할 캐릭터: <b>${sel ? esc(sel.name) : '-'}</b><br>
        <button data-cmd="autoDeploy">자동 배치</button>
        <button data-cmd="begin" ${S.chars.every((c) => c.placed) ? '' : 'disabled'}>전투 시작</button></div>`;
    } else if (S.phase === 'plan' && sel) {
      h += `<div class="box"><b>${esc(sel.name)}</b> — 이동 ${sel.d.move}마스 · 기본공격 사거리 ${sel.def.basicRange || 1}<br>`;
      if (sel.retired) h += '<span class="warn">아라한화로 조작 불가</span>';
      else if (sel.downed) h += '<span class="warn">기절 — 이동/행동 불가 (회복되면 다음 턴부터 행동)</span>';
      else {
        h += `계획: ${planText(sel)}<br>
          <span class="muted">${S.mode === 'target' ? '노란 칸 = 사거리, 초록 칸을 클릭해 대상을 지정하세요.' : '하늘색 칸을 클릭해 이동 위치를 지정 (자기 칸 = 제자리).'}</span><br>`;
        const cur = sel.plan.action;
        const btn = (cmd, label, title, dis, warn, on) =>
          `<button data-cmd="${cmd}" title="${esc(title)}" ${dis ? 'disabled' : ''} class="${warn ? 'warn' : ''}" style="${on ? 'font-weight:bold;outline:2px solid #06c' : ''}">${label}</button>`;
        h += btn('act:attack', `기본 공격 (${sel.stats.power * 2})`, '사거리 내 적에게 출력x2 피해, 아니마 상승 없음', false, false, cur && cur.type === 'attack');
        h += btn('act:defend', '방어', '이번 턴 받는 피해·교란 50% 감소', false, false, cur && cur.type === 'defend');
        h += btn('act:wait', '대기', '행동하지 않음', false, false, cur && cur.type === 'wait');
        h += '<br>';
        sel.def.skills.forEach((id) => {
          const sk = SKILLS[id];
          if (!sk) return;
          const cd = sel.cds[id] || 0;
          const danger = sel.anima + sk.anima >= 100;
          h += btn(`skill:${id}`,
            `${sk.name} [${CAT_KO[sk.category]}] 아니마+${sk.anima}${cd ? ` (CD ${cd})` : ''}${danger ? ' ⚠아라한화' : ''}`,
            `${sk.desc}${skillPreview(sel, sk)} / 사거리 ${sk.range} / 쿨타임 ${sk.cooldown}`,
            cd > 0, danger, cur && cur.skillId === id);
        });
        h += `<br><button data-cmd="clearMove">이동 취소</button><button data-cmd="clearAct">행동 취소</button>`;
        h += '<ul class="muted" style="padding-left:16px;margin:4px 0">' + sel.def.skills.map((id) => {
          const sk = SKILLS[id];
          return sk ? `<li>${esc(sk.name)}: ${esc(sk.desc)}${skillPreview(sel, sk)} · 사거리 ${sk.range} · CD ${sk.cooldown}</li>` : '';
        }).join('') + '</ul>';
      }
      if (S.msg) h += `<div class="warn">${esc(S.msg)}</div>`;
      h += '</div>';
      h += '<button data-cmd="run" style="font-size:16px;padding:6px 16px">턴 실행</button>';
      h += ' <button data-cmd="quit">전투 포기</button>';
    }
    $('#side').innerHTML = h;
  }

  // ───────── 입력 ─────────
  function selectChar(id) {
    S.sel = id;
    S.mode = null;
    S.pending = null;
    S.preview = null;
    S.msg = '';
  }

  function onCell(x, y) {
    const k = K(x, y);
    const sel = getChar(S.sel);
    if (S.phase === 'deploy') {
      const c = charAt(x, y);
      if (c) { selectChar(c.id); return render(); }
      if (sel && S.arena.deploy.has(k)) {
        sel.x = x; sel.y = y; sel.placed = true;
        const next = S.chars.find((c2) => !c2.placed);
        if (next) S.sel = next.id;
      }
      return render();
    }
    if (S.phase !== 'plan') return;

    if (S.mode === 'target' && sel) {
      const t = validTargets(sel, S.pending).get(k);
      if (t) {
        sel.plan.action = { ...S.pending, target: t };
        S.msg = '';
      }
      S.mode = null; S.pending = null;
      return render();
    }

    const c = charAt(x, y);
    if (c && c !== sel && !(sel && reachable(sel).has(k))) { selectChar(c.id); return render(); }

    if (sel && !sel.downed && !sel.retired && reachable(sel).has(k)) {
      sel.plan.move = (x === sel.x && y === sel.y) ? null : { x, y };
      if (!targetStillValid(sel)) { sel.plan.action = null; S.msg = '이동으로 대상이 사거리를 벗어나 행동이 취소되었습니다.'; }
      else S.msg = '';
      return render();
    }
    if (c) { selectChar(c.id); render(); }
  }

  function onCmd(cmd) {
    const sel = getChar(S.sel);
    if (cmd === 'autoDeploy') {
      const cells = [...S.arena.deploy].map((k) => k.split(',').map(Number));
      S.chars.forEach((c) => {
        if (c.placed) return;
        const free = cells.find(([x, y]) => !charAt(x, y));
        if (free) { c.x = free[0]; c.y = free[1]; c.placed = true; }
      });
      return render();
    }
    if (cmd === 'begin') {
      S.phase = 'plan';
      log('[전투 시작] 아라한의 첫 패턴이 공개됩니다.');
      reveal();
      return render();
    }
    if (cmd === 'run') return runTurn();
    if (cmd === 'quit') return endBattle(false);
    if (!sel) return;
    if (cmd === 'clearMove') { sel.plan.move = null; if (!targetStillValid(sel)) sel.plan.action = null; }
    else if (cmd === 'clearAct') { sel.plan.action = null; S.mode = null; }
    else if (cmd === 'act:defend' || cmd === 'act:wait') { sel.plan.action = { type: cmd.slice(4) }; S.mode = null; }
    else if (cmd === 'act:attack' || cmd.startsWith('skill:')) {
      const pend = cmd === 'act:attack' ? { type: 'attack' } : { type: 'skill', skillId: cmd.slice(6) };
      if (pend.type === 'skill' && SKILLS[pend.skillId].target === 'self') {
        sel.plan.action = pend; S.mode = null;
      } else {
        const t = validTargets(sel, pend);
        if (pend.type === 'attack' || SKILLS[pend.skillId].target === 'enemy') {
          // 적은 몹 하나뿐 → 즉시 등록 (사거리 판정은 실행 시점)
          sel.plan.action = { ...pend, target: { kind: 'mob' } };
          S.mode = null; S.pending = null; S.preview = pend; // 사거리 표시 유지
          S.msg = t.size ? '' : '(이동 후 위치 기준) 현재 사거리 밖입니다 — 노란 칸이 사거리. 이대로면 행동이 실패합니다.';
        } else {
          S.mode = 'target'; S.pending = pend; S.preview = null;
          S.msg = t.size ? '' : '(이동 후 위치 기준) 사거리 안에 대상이 없습니다. 노란 칸이 사거리입니다 — 빈 칸을 클릭하면 취소됩니다.';
        }
      }
    }
    render();
  }

  $('#battle').addEventListener('click', (e) => {
    if (!S) return;
    const cell = e.target.closest('.cell[data-x]');
    if (cell) return onCell(+cell.dataset.x, +cell.dataset.y);
    const unit = e.target.closest('[data-char]');
    if (unit) { selectChar(unit.dataset.char); return render(); }
    const b = e.target.closest('[data-cmd]');
    if (b && !b.disabled) onCmd(b.dataset.cmd);
  });

  // 공격/스킬 버튼 호버 → 이동 후 위치 기준 사거리 미리보기
  const previewOf = (el) => {
    const b = el && el.closest && el.closest('[data-cmd]');
    if (!b) return null;
    const cmd = b.dataset.cmd;
    if (cmd === 'act:attack') return { type: 'attack' };
    if (cmd.startsWith('skill:') && SKILLS[cmd.slice(6)]) return { type: 'skill', skillId: cmd.slice(6) };
    return null;
  };
  $('#battle').addEventListener('mouseover', (e) => {
    if (!S || S.phase !== 'plan' || S.mode === 'target') return;
    const p = previewOf(e.target);
    const same = (p && S.preview && p.type === S.preview.type && p.skillId === S.preview.skillId) || (!p && !S.preview);
    if (same) return;
    S.preview = p;
    renderBoard();
  });
  $('#battle').addEventListener('mouseleave', () => {
    if (S && S.preview) { S.preview = null; renderBoard(); }
  });

  // ───────── 시작 ─────────
  Object.values(USERS).forEach(validateStats);
  renderSetup();
})();
