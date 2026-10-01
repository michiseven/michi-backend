import { explicitStrollDuration } from './stroll-duration-contract';
import { extractExplicitRequestContract } from './explicit-request-contract';

describe('explicit stroll duration', () => {
  it('keeps day-specific times separate instead of leaking them to all days', () => {
    expect(
      extractExplicitRequestContract('첫날 공덕에서 산책20분. 둘째날 종로에서散歩30分'),
    ).toMatchObject({
      activityDurationsByDay: { 1: { stroll: 20 }, 2: { stroll: 30 } },
    });
    expect(
      extractExplicitRequestContract('첫날 산책20분. 둘째날 카페').activityDurations,
    ).toBeUndefined();
  });
  it.each([
    '공덕 거리 산책 20분과 카페',
    '20분 동안 산책',
    '散歩を20分',
    '20分間散歩',
    'stroll 20 minutes',
    '이틀 전체 산책 시간은 총20분이야',
    '산책 시간은 합계 20분',
    '散歩時間は合計20分',
    'stroll duration is a total of20 minutes',
  ])('%s', (text) => {
    expect(explicitStrollDuration(text)).toBe(20);
    expect(extractExplicitRequestContract(text).activityDurations).toEqual({ stroll: 20 });
  });
  it.each([
    '산책과 이동20분',
    '도보20분 이내, 산책',
    '카페20분과 산책',
    '산책20분 이내',
    '산책0분',
    '산책999분',
    '산책20분은 하지 않아',
    '산책20분, 산책30분',
    '산책 시간은 총20분 이내',
    '산책 이동 시간은20분',
  ])('does not invent exact activity time: %s', (text) => {
    expect(explicitStrollDuration(text)).toBeUndefined();
  });
});
