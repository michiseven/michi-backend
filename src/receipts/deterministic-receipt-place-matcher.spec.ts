import { DeterministicReceiptPlaceMatcher } from './deterministic-receipt-place-matcher';

describe('DeterministicReceiptPlaceMatcher', () => {
  const matcher = new DeterministicReceiptPlaceMatcher();

  it('sorts deterministic candidates by merchant and address similarity', () => {
    const candidates = matcher.match(
      {
        merchantName: '성수 영수증 카페',
        merchantAddress: '서울특별시 성동구 성수동 연무장길 10',
      },
      [
        {
          placeId: 'place-b',
          name: '성수 영수증 카페',
          address: '서울특별시 마포구',
          roadAddress: null,
          district: '마포구',
        },
        {
          placeId: 'place-a',
          name: '성수 영수증 카페',
          address: '서울특별시 성동구 성수동',
          roadAddress: '서울특별시 성동구 연무장길 10',
          district: '성동구',
        },
      ],
    );

    expect(candidates.map((candidate) => candidate.placeId)).toEqual(['place-a', 'place-b']);
    expect(candidates[0]?.confidence).toBeGreaterThan(candidates[1]?.confidence ?? 0);
  });

  it('keeps even a perfect-confidence match as an unconfirmed candidate', () => {
    const [candidate] = matcher.match({ merchantName: '카페 미치', merchantAddress: null }, [
      {
        placeId: 'place-perfect',
        name: '카페 미치',
        address: null,
        roadAddress: null,
        district: null,
      },
    ]);

    expect(candidate).toEqual(
      expect.objectContaining({
        status: 'candidate',
        confidence: 1,
        requiresUserConfirmation: true,
      }),
    );
    expect(candidate).not.toHaveProperty('confirmedAt');
    expect(candidate).not.toHaveProperty('visitId');
  });

  it('returns no candidate when a receipt has no merchant name', () => {
    expect(matcher.match({ merchantName: null, merchantAddress: null }, [])).toEqual([]);
  });
});
