import type { Repository, SelectQueryBuilder } from 'typeorm';
import type { Place, SeoulSpatialArea } from '../../database/entities';
import { SeoulSpatialAreaService } from './seoul-spatial-area.service';

describe('SeoulSpatialAreaService', () => {
  it('resolves administrative area by exact name and alias', async () => {
    const where = jest.fn().mockReturnThis();
    const andWhere = jest.fn().mockReturnThis();
    const orderBy = jest.fn().mockReturnThis();
    const getOne = jest
      .fn()
      .mockResolvedValue({ id: 'dong-1', name: '공덕동', areaKind: 'administrative_dong' });

    const builder = {
      where,
      andWhere,
      orderBy,
      getOne,
    } as unknown as SelectQueryBuilder<SeoulSpatialArea>;

    const areaRepo = {
      createQueryBuilder: jest.fn().mockReturnValue(builder),
    } as unknown as Repository<SeoulSpatialArea>;

    const service = new SeoulSpatialAreaService(areaRepo);
    const resolved = await service.administrativeArea('공덕');
    expect(resolved).toEqual({ id: 'dong-1', name: '공덕동' });
    expect(andWhere).toHaveBeenCalledWith(
      expect.stringContaining('regexp_replace'),
      expect.anything(),
    );
    const callArgs = andWhere.mock.calls[0] as [string, { names: string[] }];
    expect(callArgs[1].names).toContain('공덕');
    expect(callArgs[1].names).toContain('공덕동');
  });

  it('calculates nearest crowd area using shortest geometry-to-geometry distance', async () => {
    const builder = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue({ id: 'dong-1', name: '공덕동' }),
    } as unknown as SelectQueryBuilder<SeoulSpatialArea>;

    const query = jest.fn().mockResolvedValue([{ areaName: '충정로역', distanceMeters: '0' }]);

    const areaRepo = {
      createQueryBuilder: jest.fn().mockReturnValue(builder),
      query,
    } as unknown as Repository<SeoulSpatialArea>;

    const service = new SeoulSpatialAreaService(areaRepo);
    const nearest = await service.nearestCrowdArea('공덕동', 3000);

    expect(nearest).toEqual({ areaName: '충정로역', distanceMeters: 0 });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining(
        'ST_Distance(requested.geometry::geography, crowd.geometry::geography)',
      ),
      ['dong-1', 3000],
    );
  });

  it('returns null when no crowd observation area is within the max distance', async () => {
    const builder = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue({ id: 'dong-1', name: '공덕동' }),
    } as unknown as SelectQueryBuilder<SeoulSpatialArea>;

    const query = jest.fn().mockResolvedValue([]);

    const areaRepo = {
      createQueryBuilder: jest.fn().mockReturnValue(builder),
      query,
    } as unknown as Repository<SeoulSpatialArea>;

    const service = new SeoulSpatialAreaService(areaRepo);
    const nearest = await service.nearestCrowdArea('공덕동', 100);

    expect(nearest).toBeNull();
  });

  it('filters places prioritizing inside boundary and expanding up to 1km when insufficient', async () => {
    const builder = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue({ id: 'dong-1', name: '공덕동' }),
    } as unknown as SelectQueryBuilder<SeoulSpatialArea>;

    const mockPlaces = [
      { id: 'p1', name: 'Place 1' },
      { id: 'p2', name: 'Place 2' },
      { id: 'p3', name: 'Place 3' },
    ] as Place[];

    // 2 places inside, 1 place in expansion
    const query = jest.fn().mockResolvedValue([
      { id: 'p1', inside: true, distance: 0 },
      { id: 'p2', inside: true, distance: 0 },
      { id: 'p3', inside: false, distance: 350 },
    ]);

    const areaRepo = {
      createQueryBuilder: jest.fn().mockReturnValue(builder),
      query,
    } as unknown as Repository<SeoulSpatialArea>;

    const service = new SeoulSpatialAreaService(areaRepo);
    const result = await service.filterPlaces('공덕동', mockPlaces, 1000, 5);

    expect(result.applied).toBe(true);
    expect(result.expanded).toBe(true);
    expect(result.places).toHaveLength(3);
  });
});
