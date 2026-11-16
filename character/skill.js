// character/skill.js
// 스킬 정의. 효과는 데이터(effects 배열)로만 기술하고, 실제 처리는 js/main.js 에서 한다.
// (함수 없이 순수 데이터만 두어 추후 Firestore 이전이 쉽도록 구성)
//
// category : attack | defense | control | support  → 처리 우선순위 defense > control > support > attack
// target   : self | enemy | ally | cell
//   - ally 는 includeSelf: true 이면 자기 자신도 대상 가능
//   - area: { radius } 가 있으면 대상(또는 자신) 주변 반경 내 아군 전체에 효과 적용
// anima    : 사용 시 아니마 상승량 (EGO로 막을 수 없음)
// cooldown : 사용 후 다시 쓸 수 있을 때까지의 턴 수
// effects  : { type, stat, mult, base, ... }  수치 = stats[stat] * mult + base
//
// effect type 목록
//   damage     적 피해
//   heal       HP 회복 (기절 해제 가능)
//   ego        EGO 회복
//   calm       아니마 감소
//   taunt      이번 턴 대상 지정 공격을 자신에게 끌어옴 (reduce: 피해 감소율)
//   cover      이번 턴 대상 아군이 받는 공격을 대신 받음
//   reduce     이번 턴 받는 피해(dmg)/교란(disrupt) 감소율
//   shield     이번 턴 HP 피해를 흡수하는 보호막
//   push       적을 시전자 반대 방향으로 dist 칸 밀침
//   pull       적을 시전자 방향으로 dist 칸 끌어옴
//   rescue     아군을 시전자 옆 빈 칸으로 끌어옴 (기절 아군 가능)
//   blink      지정한 빈 칸으로 순간이동 (장애물 무시)
//   swap       아군과 위치 교환
//   weaken     이번 턴 적 공격의 피해·교란 배율 (mult)
//   vulnerable 적이 받는 피해 배율 (mult) 을 turns 턴 동안 부여
//   empower    이번 턴 대상의 공격 피해 배율 (mult)

const SKILLS = {
  // ───────── 공격 ─────────
  overdrive_slash: {
    id: 'overdrive_slash', name: '과부하 참격', category: 'attack',
    desc: '쉘의 출력을 한계까지 끌어올려 베어낸다.',
    target: 'enemy', range: 1, anima: 10, cooldown: 0,
    effects: [{ type: 'damage', stat: 'power', mult: 4 }],
  },
  anima_burst: {
    id: 'anima_burst', name: '아니마 폭주', category: 'attack',
    desc: '아니마를 직접 태워 폭발시킨다. 강력하지만 붕괴에 가까워진다.',
    target: 'enemy', range: 1, anima: 25, cooldown: 2,
    effects: [{ type: 'damage', stat: 'power', mult: 7 }],
  },
  piercing_shot: {
    id: 'piercing_shot', name: '관통 사격', category: 'attack',
    desc: '원거리에서 장갑을 꿰뚫는 사격.',
    target: 'enemy', range: 4, anima: 8, cooldown: 0,
    effects: [{ type: 'damage', stat: 'power', mult: 3 }],
  },
  marking_shot: {
    id: 'marking_shot', name: '약점 표식', category: 'attack',
    desc: '약점을 표시해 2턴간 적이 받는 피해 +30%.',
    target: 'enemy', range: 4, anima: 12, cooldown: 3,
    effects: [
      { type: 'damage', stat: 'power', mult: 2 },
      { type: 'vulnerable', mult: 1.3, turns: 2 },
    ],
  },
  shield_bash: {
    id: 'shield_bash', name: '방패 강타', category: 'attack',
    desc: '내구로 밀어붙여 피해를 주고 이번 턴 적 공격을 30% 약화.',
    target: 'enemy', range: 1, anima: 8, cooldown: 2,
    effects: [
      { type: 'damage', stat: 'endurance', mult: 2 },
      { type: 'weaken', mult: 0.7 },
    ],
  },

  // ───────── 방어 ─────────
  taunt: {
    id: 'taunt', name: '도발', category: 'defense',
    desc: '이번 턴 대상 지정 공격(표적/추적/열)을 자신에게 끌어온다. 받는 피해 -30%.',
    target: 'self', range: 0, anima: 8, cooldown: 1,
    effects: [{ type: 'taunt', reduce: 0.3 }],
  },
  cover: {
    id: 'cover', name: '엄호', category: 'defense',
    desc: '이번 턴 지정한 아군이 받는 공격을 대신 받는다.',
    target: 'ally', range: 2, anima: 6, cooldown: 1,
    effects: [{ type: 'cover' }],
  },
  fortress: {
    id: 'fortress', name: '철벽', category: 'defense',
    desc: '이번 턴 받는 피해와 교란 -70%.',
    target: 'self', range: 0, anima: 10, cooldown: 2,
    effects: [{ type: 'reduce', dmg: 0.7, disrupt: 0.7 }],
  },
  barrier: {
    id: 'barrier', name: '보호막 전개', category: 'defense',
    desc: '아군 하나에게 이번 턴 HP 피해를 흡수하는 보호막 부여.',
    target: 'ally', includeSelf: true, range: 3, anima: 10, cooldown: 1,
    effects: [{ type: 'shield', stat: 'endurance', mult: 2, base: 5 }],
  },
  ego_guard: {
    id: 'ego_guard', name: '에고 공명', category: 'defense',
    desc: '자신 주변 2마스 아군의 이번 턴 교란 -50%.',
    target: 'self', range: 0, area: { radius: 2 }, anima: 12, cooldown: 2,
    effects: [{ type: 'reduce', dmg: 0, disrupt: 0.5 }],
  },

  // ───────── 제어 ─────────
  repel: {
    id: 'repel', name: '충격파', category: 'control',
    desc: '적을 시전자 반대 방향으로 2칸 밀친다. 적 기준 범위 공격을 비껴가게 한다.',
    target: 'enemy', range: 2, anima: 10, cooldown: 2,
    effects: [{ type: 'push', dist: 2 }],
  },
  grapple: {
    id: 'grapple', name: '인력', category: 'control',
    desc: '적을 시전자 쪽으로 1칸 끌어온다.',
    target: 'enemy', range: 4, anima: 10, cooldown: 2,
    effects: [{ type: 'pull', dist: 1 }],
  },
  rescue: {
    id: 'rescue', name: '구조 이동', category: 'control',
    desc: '아군(기절 포함)을 자신 옆 빈 칸으로 끌어온다.',
    target: 'ally', range: 4, anima: 8, cooldown: 1,
    effects: [{ type: 'rescue' }],
  },
  blink: {
    id: 'blink', name: '순간 이동', category: 'control',
    desc: '장애물을 무시하고 지정한 빈 칸으로 이동한다.',
    target: 'cell', range: 4, anima: 6, cooldown: 1,
    effects: [{ type: 'blink' }],
  },
  swap: {
    id: 'swap', name: '위치 교환', category: 'control',
    desc: '아군과 위치를 맞바꾼다.',
    target: 'ally', range: 5, anima: 8, cooldown: 1,
    effects: [{ type: 'swap' }],
  },
  jam: {
    id: 'jam', name: '패턴 교란', category: 'control',
    desc: '적의 움직임을 흐트러뜨려 이번 턴 공격의 피해·교란 -50%.',
    target: 'enemy', range: 3, anima: 15, cooldown: 3,
    effects: [{ type: 'weaken', mult: 0.5 }],
  },

  // ───────── 지원 ─────────
  heal: {
    id: 'heal', name: '수복', category: 'support',
    desc: '아군의 HP 회복. 기절한 아군을 일으킬 수 있다.',
    target: 'ally', includeSelf: true, range: 3, anima: 6, cooldown: 0,
    effects: [{ type: 'heal', stat: 'sync', mult: 2.5 }],
  },
  ego_restore: {
    id: 'ego_restore', name: '에고 재구축', category: 'support',
    desc: '아군의 EGO 회복. 파괴된 에고도 다시 세운다.',
    target: 'ally', includeSelf: true, range: 3, anima: 8, cooldown: 1,
    effects: [{ type: 'ego', stat: 'sync', mult: 2 }],
  },
  stabilize: {
    id: 'stabilize', name: '아니마 안정화', category: 'support',
    desc: '다른 아군의 아니마를 낮춘다. (자신에게는 불가)',
    target: 'ally', range: 2, anima: 5, cooldown: 1,
    effects: [{ type: 'calm', stat: 'sync', mult: 1.5 }],
  },
  mass_heal: {
    id: 'mass_heal', name: '광역 수복', category: 'support',
    desc: '자신 주변 2마스 아군 모두의 HP 회복.',
    target: 'self', range: 0, area: { radius: 2 }, anima: 15, cooldown: 3,
    effects: [{ type: 'heal', stat: 'sync', mult: 1.5 }],
  },
  overclock: {
    id: 'overclock', name: '동조 증폭', category: 'support',
    desc: '아군의 이번 턴 공격 피해 x1.5. (지원은 공격보다 먼저 처리된다)',
    target: 'ally', includeSelf: true, range: 3, anima: 10, cooldown: 2,
    effects: [{ type: 'empower', mult: 1.5 }],
  },
};
