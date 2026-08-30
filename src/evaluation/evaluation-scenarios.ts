export interface EvaluationScenario {
  id: string;
  label: string;
  input: {
    text: string;
    startArea: string;
    startTime: string;
    endTime: string;
    budget: number;
  };
}

/** Fixed, reviewable inputs. They contain no claimed outcome and use no randomness. */
export const EVALUATION_SCENARIOS: readonly EvaluationScenario[] = Object.freeze([
  {
    id: 'cafe-shopping-young-adult',
    label: '20대 / 카페 / 쇼핑',
    input: {
      text: '聖水でカフェとセレクトショップを楽しみたい。',
      startArea: '성수',
      startTime: '13:00',
      endTime: '20:00',
      budget: 80_000,
    },
  },
  {
    id: 'solo-quiet',
    label: '혼자 / 조용한 장소',
    input: {
      text: '一人で静かな場所をゆっくり歩きたい。混雑は避けたい。',
      startArea: '성수',
      startTime: '12:00',
      endTime: '19:00',
      budget: 60_000,
    },
  },
  {
    id: 'couple-photo-night',
    label: '커플 / 사진 / 야경',
    input: {
      text: '二人で写真と夜景を楽しめるコースがいい。',
      startArea: '홍대',
      startTime: '15:00',
      endTime: '22:00',
      budget: 120_000,
    },
  },
  {
    id: 'first-seoul-landmarks',
    label: '첫 서울여행 / 대표 관광지',
    input: {
      text: '初めてのソウル旅行なので代表的な観光地を見たい。',
      startArea: '종로',
      startTime: '10:00',
      endTime: '19:00',
      budget: 100_000,
    },
  },
  {
    id: 'returning-local',
    label: '재방문 / 로컬 여행',
    input: {
      text: 'ソウルは二回目なので、地元らしい店と街を歩きたい。',
      startArea: '망원',
      startTime: '11:00',
      endTime: '20:00',
      budget: 90_000,
    },
  },
]);
