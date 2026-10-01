import {
  assessExplicitRequestContract,
  extractExplicitRequestContract,
} from './explicit-request-contract';

describe('explicit request contract', () => {
  it.each(['3人で鐘路。1人予算80000ウォン', '1人予算80000ウォン。友達3人で鐘路'])(
    'keeps party size distinct from Japanese per-person budget: %s',
    (text) => {
      expect(extractExplicitRequestContract(text)).toMatchObject({
        partySize: 3,
        budget: { amountKrw: 80000, scope: 'per_person' },
      });
    },
  );
  it('preserves total Japanese budget wording', () => {
    expect(extractExplicitRequestContract('3人で鐘路、全体予算80000ウォン')).toMatchObject({
      partySize: 3,
      budget: { amountKrw: 80000, scope: 'total' },
    });
  });
  it.each([
    '공덕 호텔11시 체크아웃, 캐리어, 관광11–16시, ICN T1 18시 도착 마감, 비행20:30',
    '孔徳ホテル11時チェックアウト、キャリーケース、観光11〜16時、仁川空港第1ターミナル18時までに到着、フライト20:30',
  ])('keeps three distinct departure clocks for %s', (text) => {
    expect(extractExplicitRequestContract(text)).toMatchObject({
      activityWindow: { endTime: '16:00' },
      airport: { arrivalDeadline: '18:00', flightTime: '20:30', terminal: 'T1' },
      hotel: { checkoutTime: '11:00' },
    });
  });
  it.each(['2026-10-03 토요일 카페', '3~5명과 카페', '13~25시 카페'])(
    'does not mistake a date, party range, or invalid hour for an activity window: %s',
    (text) => expect(extractExplicitRequestContract(text).activityWindow).toBeUndefined(),
  );
  it.each(['카페 두 곳', '카페2곳', 'カフェ2軒', 'カフェ二軒', 'cafe 2 places'])(
    'retains explicit cafe count: %s',
    (text) => {
      expect(extractExplicitRequestContract(text).requiredActivityCounts).toEqual({ cafe: 2 });
    },
  );
  it('keeps activity counts separate from party size and excluded venues in a real request', () => {
    expect(
      extractExplicitRequestContract(
        '토요일 홍대에서 친구 3명과 13시부터18시까지 카페 두 곳과 산책. 스터디카페 2곳 제외',
      ),
    ).toMatchObject({ partySize: 3, requiredActivityCounts: { cafe: 2 } });
    expect(
      extractExplicitRequestContract('친구 3명 카페에서 쉬고 산책').requiredActivityCounts,
    ).toBeUndefined();
    expect(
      extractExplicitRequestContract('스터디카페 두 곳 제외, 공원은 산책').requiredActivityCounts,
    ).toBeUndefined();
    expect(
      extractExplicitRequestContract('카페 두 곳은 빼줘').requiredActivityCounts,
    ).toBeUndefined();
    expect(
      extractExplicitRequestContract('カフェ二軒には行かない').requiredActivityCounts,
    ).toBeUndefined();
    expect(
      extractExplicitRequestContract('스타벅스카페2호점에 가자').requiredActivityCounts,
    ).toBeUndefined();
  });
  it('extracts only explicit quantities for other canonical activities', () => {
    expect(
      extractExplicitRequestContract('공원 한 곳과 식당 두 곳, 박물관 세 곳과 관광지 4곳')
        .requiredActivityCounts,
    ).toEqual({ park: 1, restaurant: 2, culture: 3, attraction: 4 });
  });
  it('preserves hotel checkout without any airport mention', () => {
    expect(
      extractExplicitRequestContract('호텔 11시 체크아웃 뒤 성수 13시부터16시까지 카페'),
    ).toMatchObject({
      hotel: { checkoutTime: '11:00' },
      activityWindow: { startTime: '13:00', endTime: '16:00' },
    });
  });
  it.each(['13시부터16시까지', '13:00〜16:00', '13時から16時まで', '13~16시', '13〜16時'])(
    'extracts a separate activity range: %s',
    (range) => {
      expect(
        extractExplicitRequestContract(
          `${range} 카페. 호텔11시 체크아웃. 인천공항20:30비행기여서18시까지 공항에 도착`,
        ),
      ).toMatchObject({
        activityWindow: { startTime: '13:00', endTime: '16:00' },
        hotel: { checkoutTime: '11:00' },
        airport: { arrivalDeadline: '18:00', flightTime: '20:30' },
      });
    },
  );
  const now = new Date('2026-09-30T18:00:00Z'); // Thursday in Seoul.
  it.each(['토요일 아이와 3명 가족 여행, 총 예산 8만원', '土曜日に3人で家族旅行。予算8万ウォン'])(
    'preserves next Saturday and total family budget: %s',
    (text) => {
      expect(extractExplicitRequestContract(text, now)).toMatchObject({
        startDate: '2026-10-03',
        partySize: 3,
        budget: { amountKrw: 80_000, scope: 'total' },
      });
    },
  );
  it('keeps next week distinct from this Saturday and ignores time numbers for party count', () => {
    expect(extractExplicitRequestContract('다음 주 토요일 12시, 1인당 2만원', now)).toMatchObject({
      startDate: '2026-10-10',
      budget: { amountKrw: 20_000, scope: 'per_person' },
    });
    expect(extractExplicitRequestContract('12시 카페', now).partySize).toBeUndefined();
  });
  it('preserves airport deadline and luggage without inventing evidence', () => {
    const contract = extractExplicitRequestContract(
      '출국 전에 홍대 관광, 짐 보관 후 회수하고 인천공항에 17시까지 도착해야 해',
      now,
    );
    expect(contract).toMatchObject({
      airport: { name: 'ICN', role: 'departure', terminal: null, deadline: '17:00' },
      luggage: { requested: true, storageRequired: true, recoveryRequired: true },
    });
    expect(assessExplicitRequestContract(contract)).toMatchObject({
      status: 'partial',
      unavailable: [
        { code: 'airport_terminal' },
        { code: 'airport_transfer' },
        { code: 'luggage_storage' },
      ],
    });
  });
  it('keeps an explicit ISO date independent of model defaults', () => {
    expect(extractExplicitRequestContract('2026-10-12 일정', now).startDate).toBe('2026-10-12');
  });
  it('preserves the full departure traveller request without confusing tourism and flight times', () => {
    const text =
      '2026-10-01 홍대입구 근처 숙소에서 11시 체크아웃 뒤 캐리어 1개를 보관하고, 홍대에서 점심과 가벼운 관광을 16시까지 한 뒤 짐을 회수하고 싶어요. 인천공항 20시 30분 비행기이므로 18시 공항 도착이 필요하고 터미널은 미확인입니다.';
    expect(extractExplicitRequestContract(text, now)).toMatchObject({
      hotel: { checkoutTime: '11:00' },
      airport: { arrivalDeadline: '18:00', flightTime: '20:30', terminal: null },
      luggage: { recoveryRequired: true },
    });
  });
  it('sums family members, preserves comma amounts and recognizes Japanese per-person budget', () => {
    expect(
      extractExplicitRequestContract('어른 2명과 5살 아이 1명, 전체 60,000원', now),
    ).toMatchObject({ partySize: 3, budget: { amountKrw: 60_000, scope: 'total' } });
    expect(extractExplicitRequestContract('友達2人、予算1人8万ウォン', now).budget).toEqual({
      amountKrw: 80_000,
      scope: 'per_person',
    });
    expect(
      extractExplicitRequestContract('来週月曜日', new Date('2026-10-04T03:00:00Z')).startDate,
    ).toBe('2026-10-05');
  });
  it('accepts verified transfer, storage and recovery evidence without universal refusal', () => {
    const contract = extractExplicitRequestContract(
      '인천공항 T1 18시까지 도착, 짐 보관 후 회수',
      now,
    );
    expect(
      assessExplicitRequestContract(contract, {
        airportTransferVerified: true,
        luggageStorageVerified: true,
        luggageRecoveryVerified: true,
      }),
    ).toEqual({ status: 'satisfied', unavailable: [] });
  });
});
