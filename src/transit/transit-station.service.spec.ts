import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { TransitStation, type GeoPoint } from '../database/entities';
import { TransitStationService } from './transit-station.service';
import { ConfigService } from '@nestjs/config';

describe('TransitStationService', () => {
  let service: TransitStationService;
  let repository: {
    find: jest.Mock;
    save: jest.Mock;
    upsert: jest.Mock;
    create: jest.Mock;
    createQueryBuilder: jest.Mock;
  };

  beforeEach(async () => {
    repository = {
      find: jest.fn().mockResolvedValue([]),
      save: jest.fn(),
      upsert: jest.fn(),
      create: jest.fn((d: object = {}) => d),
      createQueryBuilder: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([]),
      }),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TransitStationService,
        {
          provide: getRepositoryToken(TransitStation),
          useValue: repository,
        },
        {
          provide: ConfigService,
          useValue: { get: jest.fn(), getOrThrow: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<TransitStationService>(TransitStationService);
  });

  it('does not silently substitute a fixture when the live table is empty', async () => {
    const pointNearGongdeok: GeoPoint = {
      type: 'Point',
      coordinates: [126.952, 37.544], // ~100m away
    };

    const result = await service.findNearestStation(pointNearGongdeok, 1500);
    expect(result).toBeNull();
  });

  it('returns null when no station is within maxDistanceMeters', async () => {
    // Somewhere far away (e.g. Busan)
    const farPoint: GeoPoint = {
      type: 'Point',
      coordinates: [129.0756, 35.1796],
    };

    const result = await service.findNearestStation(farPoint, 1500);
    expect(result).toBeNull();
  });

  it('returns null when point is null', async () => {
    const result = await service.findNearestStation(null, 1500);
    expect(result).toBeNull();
  });

  it('normalizes official subway and bus station master responses', async () => {
    global.fetch = jest.fn().mockImplementation((input: string) => {
      const subway = input.includes('subwayStationMaster');
      const serviceName = subway ? 'subwayStationMaster' : 'tbisMasterStation';
      const row = subway
        ? [
            {
              BLDN_ID: '0150',
              BLDN_NM: '서울역',
              ROUTE: '1호선',
              LAT: '37.556228',
              LOT: '126.972135',
            },
          ]
        : [
            {
              CRTR_ID: '100000001',
              CRTR_NM: '종로2가사거리',
              CRTR_TYPE: '중앙차로',
              CRTR_NO: '01001',
              LAT: 37.5698055407,
              LOT: 126.9877522923,
              BUS_ARVL_INFO_GUIDEM_INSTL: '설치   ',
            },
          ];
      return Promise.resolve({
        ok: true,
        json: jest.fn().mockResolvedValue({
          [serviceName]: {
            list_total_count: 1,
            RESULT: { CODE: 'INFO-000', MESSAGE: '정상 처리되었습니다' },
            row,
          },
        }),
      });
    });

    const result = await service.syncOfficialStations();

    expect(result.subway).toMatchObject({ fetched: 1, inserted: 1, rejected: 0 });
    expect(result.bus).toMatchObject({ fetched: 1, inserted: 1, rejected: 0 });
    expect(repository.upsert).toHaveBeenCalledTimes(2);
    const insertedRows = repository.upsert.mock.calls.flatMap(
      (call: [Array<Record<string, unknown>>]) => call[0],
    );
    expect(insertedRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ transportMode: 'subway', stationName: '서울역' }),
        expect.objectContaining({ transportMode: 'bus', stationName: '종로2가사거리' }),
      ]),
    );
  });
});
