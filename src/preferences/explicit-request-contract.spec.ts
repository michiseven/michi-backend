import {
  assessExplicitRequestContract,
  extractExplicitRequestContract,
} from './explicit-request-contract';

describe('explicit request contract', () => {
  it('preserves hotel checkout without any airport mention', () => {
    expect(
      extractExplicitRequestContract('호텔 11시 체크아웃 뒤 성수 13시부터16시까지 카페'),
    ).toMatchObject({
      hotel: { checkoutTime: '11:00' },
      activityWindow: { startTime: '13:00', endTime: '16:00' },
    });
  });
  it.each(['13시부터16시까지', '13:00〜16:00', '13時から16時まで'])(
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
