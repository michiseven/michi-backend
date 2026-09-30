import { knownSeoulSearchArea } from './seoul-area-centers';

describe('living-neighbourhood boundaries', () => {
  it('does not treat the whole Mapo district as Hongdae', () => {
    const center = knownSeoulSearchArea('홍대')!;
    expect(center.radiusMeters).toBe(1200);
    // Gongdeok is over three kilometres east, outside this discovery boundary.
    expect(Math.abs(126.9517 - center.longitude) * 88000).toBeGreaterThan(center.radiusMeters);
  });
  it('keeps a requested station-specific 15-minute discovery bound distinct', () => {
    expect(knownSeoulSearchArea('홍대입구역')).toEqual({
      longitude: 126.9237,
      latitude: 37.5573,
      radiusMeters: 1050,
    });
    // This bounds candidate retrieval; it is not verified walking-time evidence.
  });
});
