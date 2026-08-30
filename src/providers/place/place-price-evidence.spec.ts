import { verifiedPlacePrice } from './place-price-evidence';

describe('verifiedPlacePrice', () => {
  const timestamp = '2026-08-28T00:00:00.000Z';

  it('accepts provider evidence with a source URL', () => {
    expect(
      verifiedPlacePrice(12_000, {
        source: 'kto-detail',
        verificationStatus: 'verified',
        sourceUrl: 'https://example.test/kto/place/1',
        averageCostKrw: 12_000,
        lastFetchedAt: timestamp,
      }),
    ).not.toBeNull();
  });

  it('accepts manually verified evidence only with an audit title', () => {
    expect(
      verifiedPlacePrice(9_000, {
        source: 'manual',
        verificationStatus: 'verified',
        sourceTitle: '운영자 확인 2026-08-28',
        averageCostKrw: 9_000,
        lastFetchedAt: timestamp,
      }),
    ).not.toBeNull();
  });

  it.each(['benchmark-prior', 'free', 'naver-search'])(
    'rejects legacy inferred source %s',
    (source) => {
      expect(
        verifiedPlacePrice(8_000, {
          source,
          verificationStatus: 'verified',
          averageCostKrw: 8_000,
          lastFetchedAt: timestamp,
        }),
      ).toBeNull();
    },
  );

  it('rejects provider evidence without a traceable URL', () => {
    expect(
      verifiedPlacePrice(12_000, {
        source: 'kakao-place-menu',
        verificationStatus: 'verified',
        averageCostKrw: 12_000,
        lastFetchedAt: timestamp,
      }),
    ).toBeNull();
  });
});
