import dataSource from '../database/data-source';
import { SeoulSpatialArea, Place } from '../database/entities';
import { SeoulSpatialAreaService } from '../providers/place/seoul-spatial-area.service';
import { PlaceCandidateSearchService } from '../providers/place/place-candidate-search.service';

function argumentsMap(): Map<string, string> {
  const result = new Map<string, string>();
  for (const argument of process.argv.slice(2)) {
    const match = argument.match(/^--([^=]+)=(.*)$/s);
    if (match?.[1] !== undefined && match[2] !== undefined) result.set(match[1], match[2]);
  }
  return result;
}

export interface SeoulSpatialVerificationReport {
  databaseSummary: {
    totalRows: number;
    administrativeDongs: number;
    crowdObservations: number;
    invalidSridCount: number;
    invalidGeometryCount: number;
    missingSourceCount: number;
    integrityStatus: 'PASS' | 'FAIL';
  };
  areaResolution: {
    inputQuery: string;
    resolved: { id: string; name: string } | null;
    aliasQuery: string;
    aliasResolved: { id: string; name: string } | null;
    status: 'PASS' | 'FAIL';
  };
  nearestCrowdObservation: {
    requestedArea: string;
    nearestAreaName: string | null;
    geometryDistanceMeters: number | null;
    within3kmRadius: boolean;
    farRadiusConstraintCheck: boolean;
    status: 'PASS' | 'FAIL';
  };
  candidateFiltering: {
    targetArea: string;
    placesInsideExactBoundary: number;
    placesWithin1kmExpansion: number;
    ktoCandidatesFound: number;
    sampleCandidateNames: string[];
    status: 'PASS' | 'FAIL';
  };
  tripStopsIntegrity: {
    recentTripId: string | null;
    totalStopsChecked: number;
    stopsWithin1km: number;
    outOfBoundStops: Array<{
      name: string;
      distanceMeters: number;
      sourcePlaceId: string;
    }>;
    status: 'PASS' | 'FAIL' | 'NO_TRIPS';
  };
}

export async function verifySeoulSpatial(
  areaQuery = '공덕동',
): Promise<SeoulSpatialVerificationReport> {
  if (!dataSource.isInitialized) {
    await dataSource.initialize();
  }

  const areaRepo = dataSource.getRepository(SeoulSpatialArea);
  const placeRepo = dataSource.getRepository(Place);
  const spatialService = new SeoulSpatialAreaService(areaRepo);
  const candidateSearchService = new PlaceCandidateSearchService(placeRepo, spatialService);

  // 1. Row counts & data integrity
  const counts = await areaRepo.query<
    {
      total: string;
      dongs: string;
      crowds: string;
      invalid_srid: string;
      invalid_geom: string;
      missing_source: string;
    }[]
  >(`
    SELECT
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE area_kind = 'administrative_dong') AS dongs,
      COUNT(*) FILTER (WHERE area_kind = 'crowd_observation') AS crowds,
      COUNT(*) FILTER (WHERE ST_SRID(geometry) != 4326) AS invalid_srid,
      COUNT(*) FILTER (WHERE NOT ST_IsValid(geometry)) AS invalid_geom,
      COUNT(*) FILTER (WHERE source IS NULL OR source_url IS NULL) AS missing_source
    FROM seoul_spatial_areas
  `);
  const countRow = counts[0] ?? {
    total: '0',
    dongs: '0',
    crowds: '0',
    invalid_srid: '0',
    invalid_geom: '0',
    missing_source: '0',
  };

  // 2. Area resolution (with full name and alias)
  const resolvedDirect = await spatialService.administrativeArea(areaQuery);
  const aliasQuery = areaQuery.endsWith('동') ? areaQuery.replace(/동$/u, '') : `${areaQuery}동`;
  const resolvedAlias = await spatialService.administrativeArea(aliasQuery);

  // 3. Nearest crowd observation lookup
  const nearestCrowd = await spatialService.nearestCrowdArea(areaQuery, 3000);
  const farCrowdCheck = await spatialService.nearestCrowdArea(areaQuery, 10); // Very narrow radius test

  // 4. Spatial place candidate search inside vs expansion
  const ktoCandidates = await candidateSearchService.searchKtoCandidates({
    area: areaQuery,
    limit: 50,
  });

  // Places inside exact boundary vs within 1km expansion
  let placesInsideBoundary = 0;
  let placesWithinExpansion = 0;
  let recentTripId: string | null = null;
  let totalStopsChecked = 0;
  let stopsWithin1km = 0;
  const outOfBoundStops: Array<{
    name: string;
    distanceMeters: number;
    sourcePlaceId: string;
  }> = [];

  if (resolvedDirect) {
    const insideRows = await areaRepo.query<{ inside_count: string; expansion_count: string }[]>(
      `
        SELECT
          COUNT(*) FILTER (WHERE ST_Covers(area.geometry, place.location::geometry)) AS inside_count,
          COUNT(*) FILTER (WHERE ST_DWithin(place.location, area.geometry::geography, 1000)) AS expansion_count
        FROM places place
        JOIN seoul_spatial_areas area ON area.id = $1
        WHERE place.location IS NOT NULL
      `,
      [resolvedDirect.id],
    );
    placesInsideBoundary = Number(insideRows[0]?.inside_count ?? 0);
    placesWithinExpansion = Number(insideRows[0]?.expansion_count ?? 0);

    // Check recent trips for this area
    const recentTripRows = await areaRepo.query<{ trip_id: string }[]>(
      `
        SELECT id AS trip_id
        FROM trips
        WHERE raw_preferences->>'area' ILIKE $1 OR raw_preferences->>'area' ILIKE $2
        ORDER BY created_at DESC
        LIMIT 1
      `,
      [`%${areaQuery}%`, `%${aliasQuery}%`],
    );
    if (recentTripRows.length > 0 && recentTripRows[0]) {
      recentTripId = recentTripRows[0].trip_id;
      const stopRows = await areaRepo.query<
        {
          place_name: string;
          source_place_id: string;
          distance_meters: string;
          within_1km: boolean;
        }[]
      >(
        `
          SELECT
            place.name AS place_name,
            place.source_place_id AS source_place_id,
            ROUND(ST_Distance(place.location, area.geometry::geography)) AS distance_meters,
            ST_DWithin(place.location, area.geometry::geography, 1000) AS within_1km
          FROM trip_stops stop
          JOIN places place ON place.id = stop.place_id
          JOIN seoul_spatial_areas area ON area.id = $1
          WHERE stop.trip_id = $2
          ORDER BY stop.stop_order ASC
        `,
        [resolvedDirect.id, recentTripId],
      );
      totalStopsChecked = stopRows.length;
      for (const row of stopRows) {
        if (row.within_1km) {
          stopsWithin1km += 1;
        } else {
          outOfBoundStops.push({
            name: row.place_name,
            distanceMeters: Number(row.distance_meters),
            sourcePlaceId: row.source_place_id,
          });
        }
      }
    }
  }

  const tripStopsStatus =
    recentTripId === null
      ? ('NO_TRIPS' as const)
      : outOfBoundStops.length === 0
        ? ('PASS' as const)
        : ('FAIL' as const);

  return {
    databaseSummary: {
      totalRows: Number(countRow.total),
      administrativeDongs: Number(countRow.dongs),
      crowdObservations: Number(countRow.crowds),
      invalidSridCount: Number(countRow.invalid_srid),
      invalidGeometryCount: Number(countRow.invalid_geom),
      missingSourceCount: Number(countRow.missing_source),
      integrityStatus:
        Number(countRow.invalid_srid) === 0 &&
        Number(countRow.invalid_geom) === 0 &&
        Number(countRow.missing_source) === 0 &&
        Number(countRow.dongs) > 0 &&
        Number(countRow.crowds) > 0
          ? 'PASS'
          : 'FAIL',
    },
    areaResolution: {
      inputQuery: areaQuery,
      resolved: resolvedDirect ? { id: resolvedDirect.id, name: resolvedDirect.name } : null,
      aliasQuery,
      aliasResolved: resolvedAlias ? { id: resolvedAlias.id, name: resolvedAlias.name } : null,
      status: resolvedDirect && resolvedAlias ? 'PASS' : 'FAIL',
    },
    nearestCrowdObservation: {
      requestedArea: areaQuery,
      nearestAreaName: nearestCrowd?.areaName ?? null,
      geometryDistanceMeters: nearestCrowd?.distanceMeters ?? null,
      within3kmRadius: nearestCrowd !== null,
      farRadiusConstraintCheck: farCrowdCheck === null || farCrowdCheck.distanceMeters <= 10,
      status: nearestCrowd ? 'PASS' : 'FAIL',
    },
    candidateFiltering: {
      targetArea: areaQuery,
      placesInsideExactBoundary: placesInsideBoundary,
      placesWithin1kmExpansion: placesWithinExpansion,
      ktoCandidatesFound: ktoCandidates.length,
      sampleCandidateNames: ktoCandidates.slice(0, 5).map((p) => p.name),
      status: placesWithinExpansion > 0 && ktoCandidates.length > 0 ? 'PASS' : 'FAIL',
    },
    tripStopsIntegrity: {
      recentTripId,
      totalStopsChecked,
      stopsWithin1km,
      outOfBoundStops,
      status: tripStopsStatus,
    },
  };
}

async function run(): Promise<void> {
  const args = argumentsMap();
  const area = args.get('area') ?? '공덕동';

  try {
    const result = await verifySeoulSpatial(area);
    process.stdout.write(
      `\n=== SEOUL SPATIAL VERIFICATION REPORT (${area}) ===\n${JSON.stringify(
        result,
        null,
        2,
      )}\n====================================================\n`,
    );
    const isAllPass =
      result.databaseSummary.integrityStatus === 'PASS' &&
      result.areaResolution.status === 'PASS' &&
      result.nearestCrowdObservation.status === 'PASS' &&
      result.candidateFiltering.status === 'PASS' &&
      result.tripStopsIntegrity.status !== 'FAIL';
    if (!isAllPass) {
      process.stderr.write(`\nVerification failed for area: ${area}\n`);
      process.exitCode = 1;
    }
  } finally {
    if (dataSource.isInitialized) {
      await dataSource.destroy();
    }
  }
}

if (require.main === module) {
  run().catch((error: unknown) => {
    process.stderr.write(
      `Spatial verification failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
