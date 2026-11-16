// character/mob.js
// 아라한(몹) 정보와 공격 패턴. 추후 Firestore 이전을 고려해 순수 데이터로만 구성.
//
// arena     : 전장 크기, 장애물(좌표 라벨), 출격 구역(행 번호, 1부터)
// size      : 몹이 점유하는 마스 (size x size)
// start     : 몹 좌상단 시작 좌표 라벨
// sequence  : cycle(순서대로) | random
// phases    : HP 비율이 hpBelow 미만이 되면 패턴 목록 교체
//
// pattern.shape
//   around      몹 주변 radius 마스 (몹 위치 기준 → 밀치기/끌어오기로 비껴갈 수 있음)
//   cross       몹이 점유한 행/열 방향 radius 마스 (몹 위치 기준)
//   all         전장 전체
//   targetBlast 예고 시 고른 대상 위치 반경 radius (도발 시 도발자 위치로 변경)
//   row         예고 시 고른 대상의 가로줄 전체 (도발 시 도발자 줄로 변경)
//   column      예고 시 고른 대상의 세로줄 전체 (도발 시 도발자 줄로 변경)
//   lockOn      대상 한 명 추적 공격, 이동으로 회피 불가 (도발/엄호로만 대응)
//   randomCells 무작위 count 마스
//   none        공격 없음 (충전 등)
// pattern.targetRule : nearest | farthest | lowestHp | highestAnima | random
// pattern.after      : teleport (공격 후 무작위 위치로 이동)
// damage  : HP 피해   disrupt : 교란 (EGO 감소, EGO 0이면 아니마 상승)

const MOBS = {
  graus: {
    id: 'graus', name: '짓눌린 자 그라우스', size: 2, hp: 700,
    desc: '거대한 몸으로 주변을 짓누르는 아라한. 기본기 위주의 입문용 보스.',
    arena: { w: 7, h: 7, obstacles: ['B4', 'F4'], deployRows: [6, 7] },
    start: 'D2',
    sequence: 'cycle',
    patterns: [
      { id: 'press', name: '짓누르기', shape: 'around', radius: 1, damage: 18, disrupt: 8,
        desc: '몹 주변 1마스를 내려찍는다.' },
      { id: 'meteor', name: '낙하 충격', shape: 'targetBlast', radius: 1, targetRule: 'farthest', damage: 16, disrupt: 10,
        desc: '가장 먼 이나니스 주변 1마스에 낙하.' },
      { id: 'cross', name: '십자 절단', shape: 'cross', radius: 6, damage: 22, disrupt: 6,
        desc: '몹이 점유한 행과 열 전체를 가른다.' },
      { id: 'wave', name: '아니마 파동', shape: 'all', damage: 4, disrupt: 14,
        desc: '전장 전체에 교란 파동.' },
    ],
    phases: [
      { hpBelow: 0.4, message: '그라우스가 분노한다! 패턴이 거칠어진다.',
        patterns: [
          { id: 'press2', name: '연속 짓누르기', shape: 'around', radius: 2, damage: 20, disrupt: 10,
            desc: '몹 주변 2마스를 내려찍는다.' },
          { id: 'lock', name: '붕괴의 손', shape: 'lockOn', targetRule: 'lowestHp', damage: 24, disrupt: 12,
            desc: 'HP가 가장 낮은 이나니스를 추적해 움켜쥔다.' },
          { id: 'wave2', name: '아니마 해일', shape: 'all', damage: 6, disrupt: 18,
            desc: '전장 전체에 강한 교란.' },
        ] },
    ],
  },

  weeper: {
    id: 'weeper', name: '울음 짓는 자', size: 1, hp: 520,
    desc: '피해보다 교란이 강한 아라한. EGO 관리와 아니마 안정화가 핵심.',
    arena: { w: 7, h: 7, obstacles: ['C3', 'E3', 'D5'], deployRows: [6, 7] },
    start: 'D2',
    sequence: 'cycle',
    patterns: [
      { id: 'scream', name: '비명', shape: 'around', radius: 2, damage: 6, disrupt: 20,
        desc: '주변 2마스에 날카로운 비명.' },
      { id: 'gaze', name: '응시', shape: 'lockOn', targetRule: 'highestAnima', damage: 10, disrupt: 24,
        desc: '아니마가 가장 높은 이나니스를 응시한다.' },
      { id: 'echo', name: '메아리 장', shape: 'randomCells', count: 14, damage: 10, disrupt: 16,
        desc: '무작위 14마스에 메아리가 울린다.' },
      { id: 'erode', name: '침식', shape: 'all', damage: 0, disrupt: 12,
        desc: '전장 전체의 에고를 갉아먹는다.' },
    ],
  },

  colossus: {
    id: 'colossus', name: '철골 거상', size: 2, hp: 1000,
    desc: '느리지만 한 방이 무거운 아라한. 충전 후 대형 공격에 주의.',
    arena: { w: 8, h: 8, obstacles: ['B5', 'G5', 'D6'], deployRows: [7, 8] },
    start: 'D2',
    sequence: 'cycle',
    patterns: [
      { id: 'slam', name: '대지 강타', shape: 'row', radius: 0, targetRule: 'nearest', damage: 28, disrupt: 6,
        desc: '가장 가까운 이나니스의 가로줄 전체를 내리친다.' },
      { id: 'sweep', name: '쓸어내기', shape: 'around', radius: 2, damage: 20, disrupt: 8,
        desc: '몹 주변 2마스를 쓸어낸다.' },
      { id: 'charge', name: '충전', shape: 'none', damage: 0, disrupt: 0,
        desc: '에너지를 모은다. 다음 턴 전장 전체 공격!' },
      { id: 'quake', name: '대진동', shape: 'all', damage: 18, disrupt: 12,
        desc: '전장 전체가 흔들린다.' },
      { id: 'brand', name: '잠식 낙인', shape: 'lockOn', targetRule: 'lowestHp', damage: 26, disrupt: 10,
        desc: 'HP가 가장 낮은 이나니스에게 낙인을 찍는다.' },
    ],
    phases: [
      { hpBelow: 0.5, message: '철골 거상의 장갑이 벗겨지며 폭주한다!',
        patterns: [
          { id: 'slam2', name: '이중 강타', shape: 'column', radius: 1, targetRule: 'farthest', damage: 26, disrupt: 8,
            desc: '가장 먼 이나니스 주변 세로 3줄을 내리친다.' },
          { id: 'sweep2', name: '광역 쓸어내기', shape: 'around', radius: 3, damage: 18, disrupt: 10,
            desc: '몹 주변 3마스를 쓸어낸다.' },
          { id: 'charge2', name: '과충전', shape: 'none', damage: 0, disrupt: 0,
            desc: '에너지를 모은다. 다음 턴 전장 전체 공격!' },
          { id: 'quake2', name: '붕괴 진동', shape: 'all', damage: 22, disrupt: 16,
            desc: '전장 전체가 무너진다.' },
        ] },
    ],
  },

  echo: {
    id: 'echo', name: '잔향', size: 1, hp: 420,
    desc: '공격 후 순간이동하는 아라한. 위치 예측과 원거리 화력이 중요.',
    arena: { w: 7, h: 7, obstacles: ['B2', 'F2', 'D4'], deployRows: [6, 7] },
    start: 'D2',
    sequence: 'random',
    patterns: [
      { id: 'pierce', name: '관통선', shape: 'column', radius: 0, targetRule: 'random', damage: 20, disrupt: 10,
        desc: '무작위 이나니스의 세로줄을 꿰뚫는다. 이후 순간이동.', after: 'teleport' },
      { id: 'blast', name: '잔향 폭발', shape: 'targetBlast', radius: 1, targetRule: 'nearest', damage: 18, disrupt: 12,
        desc: '가장 가까운 이나니스 주변 1마스 폭발.' },
      { id: 'ring', name: '공명 고리', shape: 'around', radius: 1, damage: 14, disrupt: 14,
        desc: '주변 1마스에 공명. 이후 순간이동.', after: 'teleport' },
      { id: 'hunt', name: '사냥', shape: 'lockOn', targetRule: 'highestAnima', damage: 16, disrupt: 16,
        desc: '아니마가 가장 높은 이나니스를 쫓는다.' },
    ],
  },
};
