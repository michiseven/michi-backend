import { extractExplicitRequestContract } from './explicit-request-contract';
import { missingActivityCounts, requiredActivityCountsForDay } from './activity-count-contract';

describe('activity count scope', () => {
  it('does not move day two cafes into day one', () => {
    const contract = extractExplicitRequestContract(
      '첫날 공원 한 곳. 둘째날 카페 두 곳을 가고 싶어.',
    );
    expect(contract.requiredActivityCounts).toBeUndefined();
    expect(requiredActivityCountsForDay(contract, 1, 2)).toEqual({ park: 1 });
    expect(requiredActivityCountsForDay(contract, 2, 2)).toEqual({ cafe: 2 });
  });
  it('requires the daily quota on every day, not only the first', () => {
    const contract = extractExplicitRequestContract(
      '이틀 동안 매일 카페 두 곳과 공원 한 곳을 가고 싶어',
    );
    expect(contract.dailyActivityCounts).toEqual({ cafe: 2, park: 1 });
    expect(requiredActivityCountsForDay(contract, 1, 2)).toEqual({ cafe: 2, park: 1 });
    expect(requiredActivityCountsForDay(contract, 2, 2)).toEqual({ cafe: 2, park: 1 });
  });
  it('keeps a whole-trip quota out of individual day hard constraints', () => {
    const contract = extractExplicitRequestContract('여행 전체 카페 두 곳. 2일차 공원 한 곳');
    expect(contract.requiredActivityCounts).toEqual({ cafe: 2 });
    expect(requiredActivityCountsForDay(contract, 1, 2)).toEqual({});
    expect(requiredActivityCountsForDay(contract, 2, 2)).toEqual({ park: 1 });
    expect(missingActivityCounts(contract.requiredActivityCounts, ['cafe'])).toEqual({ cafe: 1 });
    expect(missingActivityCounts(contract.requiredActivityCounts, ['cafe', 'cafe'])).toEqual({});
  });
  it('keeps single-day behavior and Japanese digit day markers', () => {
    expect(
      requiredActivityCountsForDay(extractExplicitRequestContract('카페 두 곳'), 1, 1),
    ).toEqual({ cafe: 2 });
    const contract = extractExplicitRequestContract('1日目 公園1箇所、2日目 カフェ2軒');
    expect(requiredActivityCountsForDay(contract, 1, 2)).toEqual({ park: 1 });
    expect(requiredActivityCountsForDay(contract, 2, 2)).toEqual({ cafe: 2 });
  });
  it('merges overlapping daily and date requirements without adding invented visits', () => {
    const contract = extractExplicitRequestContract('매일 카페 한 곳. 둘째날 카페 두 곳');
    expect(requiredActivityCountsForDay(contract, 1, 2)).toEqual({ cafe: 1 });
    expect(requiredActivityCountsForDay(contract, 2, 2)).toEqual({ cafe: 2 });
  });
});
