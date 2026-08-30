export interface Coordinates {
  longitude: number;
  latitude: number;
}

function toRadians(degree: number): number {
  return (degree * Math.PI) / 180;
}

export function haversineDistanceKm(a: Coordinates, b: Coordinates): number {
  const deltaLat = toRadians(b.latitude - a.latitude);
  const deltaLon = toRadians(b.longitude - a.longitude);
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);
  const haversine =
    Math.sin(deltaLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

export function coordinatesOf(
  location: { coordinates: [number, number] } | null,
): Coordinates | null {
  if (!location) return null;
  const [longitude, latitude] = location.coordinates;
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return null;
  return { longitude, latitude };
}
