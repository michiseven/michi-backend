import type { Place, ScoreBreakdownSnapshot, Trip, TripStop } from '../database/entities';
import type { StopExplanation, TripExplanation } from '../database/entities/entity-types';
import type { TripStopType } from '../database/entities/trip-stop.entity';
import type { RouteLegEstimate } from '../routing/routing-provider';
import type { AccessibilityLegEvidence } from '../routing/accessibility-evidence';
import { verifiedPlacePrice } from '../providers/place/place-price-evidence';
import { localizePlaceName } from './place-name-localizer';

interface TripStopWithPlace extends TripStop {
  place: Place;
}

export interface TripStopDto {
  id: string;
  order: number;
  dayNumber?: number;
  dayDate?: string;
  stopType?: TripStopType;
  placeId: string;
  placeName: string;
  category: string | null;
  address?: string;
  latitude: number;
  longitude: number;
  arrivalAt: string;
  leaveAt: string;
  estimatedStayMinutes: number;
  estimatedCost?: number;
  priceEvidence?: import('../database/entities/entity-types').PriceEvidence | null;
  reason: string;
  explanation?: StopExplanation | null;
  placeDescription?: {
    text: string;
    locale: 'ko' | 'ja';
    provider: 'openai-web-search';
    fetchedAt: string;
    sources: Array<{ title: string; url: string }>;
  };
  rainFallback?: {
    placeId: string;
    placeName: string;
    category: string | null;
  } | null;
  crowd?: {
    level: string | null;
    scope: 'area';
    areaName: string;
    observedAt: string | null;
    disclaimer: string;
    providerMode: 'mock' | 'live';
    requestedAreaName?: string;
    referenceDistanceMeters?: number;
  };
  scoreBreakdown: ScoreBreakdownSnapshot;
  imageUrl?: string;
  placeDetailLink?: {
    provider: 'kakao-map';
    url: string;
  };
  inboundRoute?: RouteLegEstimate | null;
  accessibility?: AccessibilityLegEvidence | null;
  tourism?: {
    concentration: {
      value: number | null;
      level: 'low' | 'medium' | 'high' | 'unavailable';
      scope: 'place' | 'area';
      areaName: string | null;
      referencePeriod: string | null;
    };
    localDiscovery: {
      value: number | null;
      level: 'low' | 'medium' | 'high' | 'unavailable';
    };
    isAlternative: boolean;
    sourceRef: string | null;
  };
}

export interface TripDto {
  id: string;
  isEditable?: boolean;
  status: string;
  date: string;
  startDate?: string;
  endDate?: string;
  totalDays?: number;
  days?: Array<{
    dayNumber: number;
    date: string;
    title?: string;
    area?: string;
    startTime?: string;
    endTime?: string;
  }>;
  startTime: string;
  endTime: string;
  budget: number | null;
  estimatedTotalCost: number | null;
  constraintStatus?: {
    mobilityChecked: boolean;
    indoorFallbackAvailable: boolean;
    mealWindowMatched: boolean;
    fixedAppointmentLocked: boolean;
  };
  explanation?: TripExplanation | null;
  preference: Record<string, unknown>;
  appliedWeights: Record<string, number>;
  stops: TripStopDto[];
}

export interface TripApiResponse {
  trip: TripDto;
  editToken?: string;
  providerModes: {
    place: 'mock' | 'live';
    kto: 'mock' | 'live';
    tourism: 'mock' | 'live' | 'mixed' | 'unavailable';
    crowd: 'mock' | 'live' | 'unavailable';
    llm: 'mock' | 'live';
    explanation: 'live' | 'mock' | 'fallback';
    routing: 'mock' | 'live';
    accessibility: 'live' | 'unavailable';
  };
  providerSources: {
    place: string;
    crowd: string;
  };
  warnings: string[];
}

export function toTripDto(trip: Trip, editToken?: string): TripDto {
  const preference = trip.preference;
  const prefJson = preference?.validatedJson ?? {};
  const rawDays = Array.isArray(prefJson.days)
    ? (prefJson.days as Array<{
        dayNumber: number;
        date: string;
        title?: string;
        area?: string;
        startTime?: string;
        endTime?: string;
      }>)
    : [];

  const startDate = typeof prefJson.startDate === 'string' ? prefJson.startDate : trip.travelDate;
  const totalDays =
    typeof prefJson.totalDays === 'number'
      ? prefJson.totalDays
      : rawDays.length > 0
        ? rawDays.length
        : 1;
  const endDate = typeof prefJson.endDate === 'string' ? prefJson.endDate : startDate;
  const responseLocale: 'ko' | 'ja' =
    trip.recommendationResult?.explanation?.locale === 'ko' || prefJson.locale === 'ko'
      ? 'ko'
      : 'ja';

  const stops = ((trip.stops ?? []) as TripStopWithPlace[])
    .sort((a, b) => a.order - b.order)
    .map((stop): TripStopDto => {
      const coordinates = stop.place.location?.coordinates;
      if (!coordinates) {
        throw new Error(`Trip stop ${stop.id} references a place without coordinates`);
      }
      const stopDate = seoulDate(stop.arrivalAt);
      let dayNumber = 1;
      try {
        const diffDays = Math.floor(
          (new Date(stopDate).getTime() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24),
        );
        dayNumber = diffDays >= 0 ? diffDays + 1 : 1;
      } catch {
        dayNumber = 1;
      }
      const verifiedPrice = verifiedPlacePrice(stop.estimatedCost, stop.place.priceEvidence);

      return {
        id: stop.id,
        order: stop.order,
        dayNumber,
        dayDate: stopDate,
        stopType: stop.stopType ?? 'general',
        placeId: stop.placeId,
        placeName: localizePlaceName(stop.place.name, responseLocale),
        category: stop.place.category,
        ...(stop.place.roadAddress || stop.place.address
          ? { address: stop.place.roadAddress ?? stop.place.address ?? undefined }
          : {}),
        latitude: coordinates[1],
        longitude: coordinates[0],
        arrivalAt: seoulTime(stop.arrivalAt),
        leaveAt: seoulTime(stop.leaveAt),
        estimatedStayMinutes: stop.estimatedStayMinutes,
        ...(verifiedPrice ? { estimatedCost: verifiedPrice.estimatedCostKrw } : {}),
        ...(verifiedPrice ? { priceEvidence: verifiedPrice.priceEvidence } : {}),
        reason: stop.reason,
        explanation: stop.explanation ?? null,
        ...placeDescriptionDto(stop.place, responseLocale),
        ...(stop.rainFallbackPlace
          ? {
              rainFallback: {
                placeId: stop.rainFallbackPlace.id,
                placeName: localizePlaceName(stop.rainFallbackPlace.name, responseLocale),
                category: stop.rainFallbackPlace.category,
              },
            }
          : {}),
        ...(stop.crowdContext
          ? {
              crowd: {
                level: stop.crowdContext.congestionLevel,
                scope: stop.crowdContext.scope,
                areaName: stop.crowdContext.areaName,
                observedAt: stop.crowdContext.observedAt,
                disclaimer: stop.crowdContext.disclaimer,
                providerMode: stop.crowdContext.providerMode,
                requestedAreaName: stop.crowdContext.requestedAreaName,
                referenceDistanceMeters: stop.crowdContext.referenceDistanceMeters,
              },
            }
          : {}),
        scoreBreakdown: stop.scoreBreakdown,
        inboundRoute: stop.inboundRoute ?? null,
        accessibility: stop.accessibilityContext ?? null,
        ...imageDto(stop.place.rawPayload),
        ...placeDetailLinkDto(stop.place),
        ...(stop.tourismEvidence
          ? {
              tourism: {
                concentration: {
                  value: stop.tourismEvidence.concentration.concentration,
                  level: concentrationLevel(stop.tourismEvidence.concentration.concentration),
                  scope: stop.tourismEvidence.spatialScope,
                  areaName: stop.tourismEvidence.areaName,
                  referencePeriod: stop.tourismEvidence.referencePeriod,
                },
                localDiscovery: {
                  value: stop.scoreBreakdown.localImpact ?? null,
                  level: favorableLevel(stop.scoreBreakdown.localImpact ?? null),
                },
                isAlternative: false,
                sourceRef:
                  stop.tourismEvidence.sources.map((source) => source.sourceRef).join(', ') || null,
              },
            }
          : {}),
      };
    });

  const isEditable = Boolean(trip.editToken && editToken && trip.editToken === editToken);

  return {
    id: trip.id,
    isEditable,
    status: trip.status,
    date: trip.travelDate,
    startDate,
    endDate,
    totalDays,
    days: rawDays,
    startTime: trip.startTime.slice(0, 5),
    endTime: trip.endTime.slice(0, 5),
    budget: trip.budgetKrw,
    estimatedTotalCost: trip.totalEstimatedCost,
    constraintStatus: {
      mobilityChecked: stops.some((stop) => stop.accessibility?.status === 'checked'),
      indoorFallbackAvailable: stops.some((s) => Boolean(s.rainFallback)),
      mealWindowMatched: stops.some((s) => s.stopType === 'meal'),
      fixedAppointmentLocked: stops.some((s) => s.stopType === 'fixed_appointment'),
    },
    explanation: trip.recommendationResult?.explanation ?? null,
    preference: prefJson,
    appliedWeights: trip.recommendationResult?.finalWeights ?? {},
    stops,
  };
}

function placeDescriptionDto(
  place: Place,
  locale: 'ko' | 'ja',
): Pick<TripStopDto, 'placeDescription'> {
  const translation = place.descriptionTranslations?.find((item) => item.locale === locale);
  if (!translation) return {};
  return {
    placeDescription: {
      text: translation.description,
      locale: translation.locale,
      provider: translation.provider,
      fetchedAt: translation.fetchedAt.toISOString(),
      sources: translation.sources,
    },
  };
}

function concentrationLevel(value: number | null): 'low' | 'medium' | 'high' | 'unavailable' {
  if (value === null) return 'unavailable';
  if (value < 1 / 3) return 'low';
  if (value < 2 / 3) return 'medium';
  return 'high';
}

function favorableLevel(value: number | null): 'low' | 'medium' | 'high' | 'unavailable' {
  if (value === null) return 'unavailable';
  if (value < 1 / 3) return 'low';
  if (value < 2 / 3) return 'medium';
  return 'high';
}

function imageDto(rawPayload?: Record<string, unknown>): { imageUrl?: string } {
  if (!rawPayload) return {};
  const sourceRecord = rawPayload.sourceRecord;
  if (!sourceRecord || typeof sourceRecord !== 'object') return {};
  const image = (sourceRecord as Record<string, unknown>).firstimage;
  return typeof image === 'string' && /^https:\/\//.test(image) ? { imageUrl: image } : {};
}

function placeDetailLinkDto(place: Place): Pick<TripStopDto, 'placeDetailLink'> {
  if (place.source !== 'kakao-local') return {};
  const sourceRecord = place.rawPayload?.sourceRecord;
  if (!sourceRecord || typeof sourceRecord !== 'object') return {};
  const candidate = (sourceRecord as Record<string, unknown>).place_url;
  if (typeof candidate !== 'string') return {};

  try {
    const url = new URL(candidate);
    if (url.hostname !== 'place.map.kakao.com') return {};
    url.protocol = 'https:';
    return { placeDetailLink: { provider: 'kakao-map', url: url.toString() } };
  } catch {
    return {};
  }
}

function seoulTime(value: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Seoul',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(value);
}

function seoulDate(value: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(value);
}

export interface StopAlternativeItem {
  placeId: string;
  name: string;
  category: string;
  address: string;
  roadAddress: string | null;
  latitude: number;
  longitude: number;
  estimatedCost: number | null;
  priceEvidence?: import('../database/entities/entity-types').PriceEvidence | null;
  reason: string;
  description?: string | null;
  distanceMeters?: number;
}

export interface StopAlternativesResponse {
  targetStop: {
    id: string;
    name: string;
    category: string;
  };
  alternatives: StopAlternativeItem[];
}

export interface SearchHotelItem {
  name: string;
  roadAddress: string | null;
  address: string | null;
  category: string | null;
  latitude: number | null;
  longitude: number | null;
}
