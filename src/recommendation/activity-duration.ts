import type { CandidatePlace, OptimizeRouteInput, RouteStopPlan } from './ports';

/** A requested stroll is activity time, not transfer time or a fixed booking. */
export function isTimedStroll(place: CandidatePlace): boolean {
  return (
    !place.isAnchor &&
    !place.fixedAppointment &&
    (place.category === 'stroll' || place.category === 'park')
  );
}

export function strollMinutes(input: OptimizeRouteInput, route: RouteStopPlan[]): number {
  const places = new Map(
    input.candidates.map((candidate) => [candidate.place.placeId, candidate.place]),
  );
  return route.reduce((total, stop) => {
    const place = places.get(stop.placeId);
    return place && isTimedStroll(place)
      ? total + (Date.parse(stop.leaveAt) - Date.parse(stop.arrivalAt)) / 60_000
      : total;
  }, 0);
}
