export function allowedPlaceSourcesForTrip(
  tripMode: 'mock' | 'live',
  activePlaceSource: string | null | undefined,
  ktoSource: string | null | undefined,
  persistedTripSources: Array<string | null | undefined>,
): string[] {
  if (tripMode === 'mock') {
    const mockSources = [activePlaceSource, ...persistedTripSources]
      .filter(
        (source): source is string =>
          typeof source === 'string' && source.toLowerCase().includes('mock'),
      )
      .filter((source, index, all) => all.indexOf(source) === index);
    return mockSources.length > 0 ? mockSources : ['mock-place'];
  }

  return [activePlaceSource, ktoSource, ...persistedTripSources]
    .filter(
      (source): source is string =>
        typeof source === 'string' && source.length > 0 && !source.toLowerCase().includes('mock'),
    )
    .filter((source, index, all) => all.indexOf(source) === index);
}
