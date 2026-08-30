import { ConfigService } from '@nestjs/config';
import { ServiceUnavailableException } from '@nestjs/common';
import type { GeoPoint, TransitStation } from '../database/entities';
import type { TransitStationService } from '../transit/transit-station.service';
import { DistanceBasedRoutingProvider } from './distance-based-routing.provider';
import {
  SeoulSubwayRoutingProvider,
  subwayApiStationNameCandidates,
} from './seoul-subway-routing.provider';

describe('SeoulSubwayRoutingProvider', () => {
  const gongdeokPoint: GeoPoint = { type: 'Point', coordinates: [126.951592, 37.54322] };
  const angukPoint: GeoPoint = { type: 'Point', coordinates: [126.985474, 37.576477] };

  const gongdeokStation: TransitStation = {
    id: 'st-1',
    source: 'seoul-metro-v1',
    transportMode: 'subway',
    stationCode: '2528',
    stationName: '공덕',
    line: '5호선',
    district: '마포구',
    location: gongdeokPoint,
    sourceUrl: null,
    rawMetadata: {},
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const angukStation: TransitStation = {
    id: 'st-2',
    source: 'seoul-metro-v1',
    transportMode: 'subway',
    stationCode: '0312',
    stationName: '안국',
    line: '3호선',
    district: '종로구',
    location: angukPoint,
    sourceUrl: null,
    rawMetadata: {},
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const createProvider = (
    configMap: Record<string, unknown>,
    findStationMock?: jest.Mock,
  ): SeoulSubwayRoutingProvider => {
    const config = {
      get: (key: string) => configMap[key],
      getOrThrow: (key: string) => {
        if (configMap[key] === undefined) throw new Error(`Missing ${key}`);
        return configMap[key];
      },
    } as unknown as ConfigService;

    const transitStationService = {
      findNearestStation:
        findStationMock ??
        jest.fn().mockImplementation((p: GeoPoint) => {
          if (p.coordinates[0] === gongdeokPoint.coordinates[0]) {
            return Promise.resolve({ station: gongdeokStation, distanceMeters: 100 });
          }
          if (p.coordinates[0] === angukPoint.coordinates[0]) {
            return Promise.resolve({ station: angukStation, distanceMeters: 150 });
          }
          return Promise.resolve(null);
        }),
    } as unknown as TransitStationService;

    const fallback = new DistanceBasedRoutingProvider();
    return new SeoulSubwayRoutingProvider(config, transitStationService, fallback);
  };

  it('keeps mock subway values explicitly estimated without invented fare', async () => {
    const provider = createProvider({
      SEOUL_SUBWAY_PROVIDER_MODE: 'mock',
    });

    const result = await provider.measureLeg(gongdeokPoint, angukPoint, 'subway', {
      travelDate: '2026-08-29',
      departureTime: '13:00',
    });

    expect(result.method).toBe('seoul-subway-estimate-v1');
    expect(result.evidence).toBe('estimated');
    expect(result.transportMode).toBe('subway');
    expect(result.subwayDetails).toBeDefined();
    expect(result.subwayDetails?.departureStation).toBe('공덕');
    expect(result.subwayDetails?.arrivalStation).toBe('안국');
    expect(result.subwayDetails?.fareKrw).toBeNull();
    expect(result.measuredAt).toBeUndefined();
    expect(result.subwayDetails?.accessWalkMinutes).toBeGreaterThanOrEqual(1);
    expect(result.subwayDetails?.egressWalkMinutes).toBeGreaterThanOrEqual(1);
  });

  it('falls back to walking estimate when no station is in range', async () => {
    const provider = createProvider(
      { SEOUL_SUBWAY_PROVIDER_MODE: 'mock' },
      jest.fn().mockResolvedValue(null),
    );

    const result = await provider.measureLeg(gongdeokPoint, angukPoint, 'subway');
    expect(result.evidence).toBe('estimated');
    expect(result.disclaimer).toContain('지하철역을 찾지 못해');
  });

  it('falls back to walking estimate when origin and destination stations are the same', async () => {
    const provider = createProvider(
      { SEOUL_SUBWAY_PROVIDER_MODE: 'mock' },
      jest.fn().mockResolvedValue({ station: gongdeokStation, distanceMeters: 50 }),
    );

    const result = await provider.measureLeg(gongdeokPoint, gongdeokPoint, 'subway');
    expect(result.evidence).toBe('estimated');
    expect(result.disclaimer).toContain('동일한 공덕역');
  });

  it('normalizes live subway API response correctly', async () => {
    const provider = createProvider({
      SEOUL_SUBWAY_PROVIDER_MODE: 'live',
      SEOUL_OPEN_DATA_API_KEY: 'test-seoul-key',
      SEOUL_SUBWAY_API_BASE_URL: 'http://openapi.seoul.go.kr:8088',
      SEOUL_SUBWAY_SEARCH_TYPE: 'duration',
    });

    const mockApiResponse = {
      header: { resultCode: '00', resultMsg: '성공' },
      body: {
        searchType: 'duration',
        totalDstc: 6117,
        totalReqHr: 970,
        totalCardCrg: 1550,
        trsitNmtm: 1,
        paths: [
          {
            dptreStn: { stnCd: '2530', stnNm: '공덕', lineNm: '5호선' },
            arvlStn: { stnCd: '2531', stnNm: '애오개', lineNm: '5호선' },
            stnSctnDstc: 1100,
            reqHr: 80,
            trsitYn: 'N',
          },
          {
            dptreStn: { stnCd: '2535', stnNm: '종로3가', lineNm: '5호선' },
            arvlStn: { stnCd: '0319', stnNm: '종로3가', lineNm: '3호선' },
            stnSctnDstc: 117,
            reqHr: 339,
            trsitYn: 'Y',
          },
          {
            dptreStn: { stnCd: '0319', stnNm: '종로3가', lineNm: '3호선' },
            arvlStn: { stnCd: '0318', stnNm: '안국', lineNm: '3호선' },
            stnSctnDstc: 1000,
            reqHr: 90,
            trsitYn: 'N',
          },
        ],
      },
    };

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue(mockApiResponse),
    });

    const result = await provider.measureLeg(gongdeokPoint, angukPoint, 'subway', {
      travelDate: '2026-08-29',
      departureTime: '14:00',
    });

    expect(result.evidence).toBe('mixed');
    expect(result.subwayDetails?.subwayDurationMinutes).toBe(17);
    expect(result.subwayDetails?.subwayDistanceKm).toBe(6.117);
    expect(result.subwayDetails?.fareKrw).toBe(1550);
    expect(result.subwayDetails?.transferCount).toBe(1);
    expect(result.subwayDetails?.pathSummary).toContain('공덕');
    expect(result.subwayDetails?.segments).toHaveLength(3);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/json/getShtrmPath/1/1000/'),
      expect.any(Object),
    );
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/2026-08-29%2014%3A00%3A00/duration'),
      expect.any(Object),
    );
  });

  it('throws ServiceUnavailableException and masks API key when live API fails', async () => {
    const provider = createProvider({
      SEOUL_SUBWAY_PROVIDER_MODE: 'live',
      SEOUL_OPEN_DATA_API_KEY: 'super-secret-key-12345',
      SEOUL_SUBWAY_API_BASE_URL: 'http://openapi.seoul.go.kr:8088',
    });

    global.fetch = jest.fn().mockRejectedValue(new Error('Network connection timeout'));

    await expect(provider.measureLeg(gongdeokPoint, angukPoint, 'subway')).rejects.toThrow(
      ServiceUnavailableException,
    );
  });

  it('retries a station-not-found response with a parenthetical station alias removed', async () => {
    const daeheungStation = {
      ...angukStation,
      id: 'st-daeheung',
      stationCode: '2626',
      stationName: '대흥(서강대앞)',
      line: '6호선',
    };
    const provider = createProvider(
      {
        SEOUL_SUBWAY_PROVIDER_MODE: 'live',
        SEOUL_OPEN_DATA_API_KEY: 'test-seoul-key',
        SEOUL_SUBWAY_API_BASE_URL: 'http://openapi.seoul.go.kr:8088',
      },
      jest
        .fn()
        .mockResolvedValueOnce({ station: gongdeokStation, distanceMeters: 100 })
        .mockResolvedValueOnce({ station: daeheungStation, distanceMeters: 150 }),
    );
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({
          header: {
            resultCode: 'INFO-200',
            resultMsg: '출발역명 또는 도착역명이 존재하지 않습니다.',
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({
          header: { resultCode: '00', resultMsg: '성공' },
          body: {
            totalDstc: 900,
            totalReqHr: 180,
            totalCardCrg: 1550,
            trsitNmtm: 0,
            paths: [
              {
                dptreStn: { stnNm: '공덕', lineNm: '6호선' },
                arvlStn: { stnNm: '대흥', lineNm: '6호선' },
                stnSctnDstc: 900,
                reqHr: 180,
                trsitYn: 'N',
              },
            ],
          },
        }),
      });
    global.fetch = fetchMock;

    const result = await provider.measureLeg(gongdeokPoint, angukPoint, 'subway');

    expect(result.evidence).toBe('mixed');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit?]>;
    const secondUrl = calls[1]?.[0] ?? '';
    expect(decodeURIComponent(secondUrl)).toContain('/공덕/대흥/');
  });
});

describe('subwayApiStationNameCandidates', () => {
  it('keeps the official master name first and adds safe aliases', () => {
    expect(subwayApiStationNameCandidates('대흥(서강대앞)역')).toEqual([
      '대흥(서강대앞)',
      '대흥',
      '서강대앞',
    ]);
  });
});
