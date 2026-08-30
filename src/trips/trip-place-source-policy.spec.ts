import { allowedPlaceSourcesForTrip } from './trip-place-source-policy';

describe('allowedPlaceSourcesForTrip', () => {
  it('keeps live current, KTO, and historical live sources while excluding mock rows', () => {
    expect(
      allowedPlaceSourcesForTrip('live', 'kakao-local', 'kto-tour-jpn', [
        'naver-local',
        'mock-place',
      ]),
    ).toEqual(['kakao-local', 'kto-tour-jpn', 'naver-local']);
  });

  it('isolates a mock trip to its active mock source', () => {
    expect(
      allowedPlaceSourcesForTrip('mock', 'mock-place', 'kto-tour-jpn', ['kakao-local']),
    ).toEqual(['mock-place']);
  });

  it('keeps a persisted mock source when the current server has switched to live mode', () => {
    expect(
      allowedPlaceSourcesForTrip('mock', 'kakao-local', 'kto-tour-jpn', ['mock-place']),
    ).toEqual(['mock-place']);
  });
});
