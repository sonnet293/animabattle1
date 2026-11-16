// character/users.js
// 유저(이나니스) 정보. 추후 Firestore 의 users 컬렉션으로 이전 예정.
// stats: 출력(power) / 내구(endurance) / 기동(mobility) / 동조(sync)
//   - 각 스탯 기본 3 + 자유 포인트 18 배분 → 합계 30, 스탯 하나의 상한 15
//   - 주력 스탯 10 이상: 포지션 형성, 12 이상: 전문화 (포지션은 main.js 에서 스탯으로 계산)
// skills: character/skill.js 의 SKILLS 키
// basicRange: 기본 공격 사거리 (기본 1, 원거리 무기/전용 쉘은 별도 지정)

const USERS = {
  kael: {
    id: 'kael', name: '카엘', shell: '레드 팽',
    stats: { power: 15, endurance: 5, mobility: 6, sync: 4 },
    basicRange: 1,
    skills: ['overdrive_slash', 'anima_burst', 'blink'],
  },
  serin: {
    id: 'serin', name: '세린', shell: '롱 아이',
    stats: { power: 12, endurance: 4, mobility: 8, sync: 6 },
    basicRange: 3,
    skills: ['piercing_shot', 'marking_shot', 'grapple'],
  },
  bar: {
    id: 'bar', name: '바르', shell: '모놀리스',
    stats: { power: 5, endurance: 15, mobility: 3, sync: 7 },
    basicRange: 1,
    skills: ['taunt', 'cover', 'fortress', 'shield_bash'],
  },
  iona: {
    id: 'iona', name: '이오나', shell: '할로',
    stats: { power: 7, endurance: 12, mobility: 4, sync: 7 },
    basicRange: 1,
    skills: ['taunt', 'barrier', 'ego_guard', 'shield_bash'],
  },
  luka: {
    id: 'luka', name: '루카', shell: '스위프트',
    stats: { power: 6, endurance: 4, mobility: 15, sync: 5 },
    basicRange: 1,
    skills: ['repel', 'rescue', 'swap', 'jam'],
  },
  mir: {
    id: 'mir', name: '미르', shell: '라일락',
    stats: { power: 4, endurance: 6, mobility: 5, sync: 15 },
    basicRange: 2,
    skills: ['heal', 'ego_restore', 'stabilize', 'mass_heal'],
  },
  harang: {
    id: 'harang', name: '하랑', shell: '윈드벨',
    stats: { power: 5, endurance: 5, mobility: 8, sync: 12 },
    basicRange: 2,
    skills: ['heal', 'stabilize', 'overclock', 'rescue'],
  },
  noa: {
    id: 'noa', name: '노아', shell: '그레이',
    stats: { power: 9, endurance: 7, mobility: 7, sync: 7 },
    basicRange: 1,
    skills: ['overdrive_slash', 'heal', 'taunt'],
  },
};
