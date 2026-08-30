import { incompletePriceWarning } from './trip-price-coverage';

describe('incompletePriceWarning', () => {
  it('warns when a stop price has no verified evidence', () => {
    expect(
      incompletePriceWarning([{ estimatedCost: null, place: { priceEvidence: null } }], 'ko'),
    ).toContain('전체 예산을 완전히 검증할 수 없습니다');
  });

  it('does not warn when every stop has verified evidence', () => {
    expect(
      incompletePriceWarning(
        [
          {
            estimatedCost: 12_000,
            place: {
              priceEvidence: {
                source: 'kto-detail',
                verificationStatus: 'verified',
                sourceUrl: 'https://example.test/kto/place/1',
                averageCostKrw: 12_000,
                lastFetchedAt: '2026-08-28T00:00:00.000Z',
              },
            },
          },
        ],
        'ja',
      ),
    ).toBeNull();
  });
});
