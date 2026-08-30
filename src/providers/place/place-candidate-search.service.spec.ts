import type { Repository, SelectQueryBuilder } from 'typeorm';
import type { Place } from '../../database/entities';
import { PlaceCandidateSearchService } from './place-candidate-search.service';

describe('PlaceCandidateSearchService', () => {
  it('uses ST_DWithin and boosts requested categories', async () => {
    const andWhere = jest.fn().mockReturnThis();
    const addSelect = jest.fn().mockReturnThis();
    const setParameter = jest.fn().mockReturnThis();
    const take = jest.fn().mockReturnThis();
    const builder = {
      where: jest.fn().mockReturnThis(),
      andWhere,
      addSelect,
      addOrderBy: jest.fn().mockReturnThis(),
      setParameter,
      take,
      getMany: jest.fn().mockResolvedValue([]),
    } as unknown as SelectQueryBuilder<Place>;
    const repository = {
      createQueryBuilder: jest.fn().mockReturnValue(builder),
    } as unknown as Repository<Place>;

    await new PlaceCandidateSearchService(repository).searchKtoCandidates({
      area: '성수',
      interests: ['cafe', 'shopping'],
      limit: 30,
    });

    expect(andWhere).toHaveBeenCalledWith(expect.stringContaining('ST_DWithin'), {
      longitude: 127.0447,
      latitude: 37.5444,
      radiusMeters: 3500,
    });
    expect(setParameter).toHaveBeenCalledWith('categories', ['cafe', 'shopping']);
    expect(take).toHaveBeenCalledWith(30);
  });

  it('uses an imported administrative boundary before a center fallback', async () => {
    const andWhere = jest.fn().mockReturnThis();
    const addOrderBy = jest.fn().mockReturnThis();
    const addSelect = jest.fn().mockReturnThis();
    const innerJoin = jest.fn().mockReturnThis();
    const builder = {
      where: jest.fn().mockReturnThis(),
      andWhere,
      innerJoin,
      addSelect,
      addOrderBy,
      setParameter: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
    } as unknown as SelectQueryBuilder<Place>;
    const repository = {
      createQueryBuilder: jest.fn().mockReturnValue(builder),
    } as unknown as Repository<Place>;
    const spatialAreas = {
      administrativeArea: jest.fn().mockResolvedValue({ id: 'area-id', name: '공덕동' }),
    };

    await new PlaceCandidateSearchService(repository, spatialAreas as never).searchKtoCandidates({
      area: '공덕',
    });

    expect(innerJoin).toHaveBeenCalledWith('seoul_spatial_areas', 'area', 'area.id = :areaId', {
      areaId: 'area-id',
    });
    expect(andWhere).toHaveBeenCalledWith(
      'ST_DWithin(place.location, area.geometry::geography, :radiusMeters)',
      { radiusMeters: 1000 },
    );
    expect(addSelect).toHaveBeenCalledWith(expect.stringContaining('ST_Covers'), 'inside_rank');
    expect(addOrderBy).toHaveBeenCalledWith('inside_rank', 'ASC');
  });

  it('does not fall back to all of Seoul for an unknown area without GIS data', async () => {
    const createQueryBuilder = jest.fn();
    const repository = {
      createQueryBuilder,
    } as unknown as Repository<Place>;
    const spatialAreas = { administrativeArea: jest.fn().mockResolvedValue(null) };

    await expect(
      new PlaceCandidateSearchService(repository, spatialAreas as never).searchKtoCandidates({
        area: '공덕',
      }),
    ).resolves.toEqual([]);
    expect(createQueryBuilder).not.toHaveBeenCalled();
  });
});
