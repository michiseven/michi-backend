import type { Repository } from 'typeorm';
import type { Place } from '../../database/entities';
import type { KtoPlaceProvider } from './kto-place.provider';
import { KtoSeoulSyncService } from './kto-seoul-sync.service';
import type { PlaceNormalizer } from './place-normalizer';

describe('KtoSeoulSyncService', () => {
  it('paginates Seoul data and updates existing source identities without deleting rows', async () => {
    const provider = {
      name: 'kto-tour-jpn',
      fetchSeoulPage: jest
        .fn()
        .mockResolvedValueOnce({
          pageNo: 1,
          numOfRows: 2,
          totalCount: 3,
          places: [{ sourcePlaceId: 'old' }, { sourcePlaceId: 'new' }],
          rejectedCount: 0,
        })
        .mockResolvedValueOnce({
          pageNo: 2,
          numOfRows: 2,
          totalCount: 3,
          places: [{ sourcePlaceId: 'last' }],
          rejectedCount: 0,
        }),
    } as unknown as KtoPlaceProvider;
    const normalizer = {
      normalize: jest.fn((record: { sourcePlaceId: string }) => ({
        source: 'kto-tour-jpn',
        sourcePlaceId: record.sourcePlaceId,
        name: record.sourcePlaceId,
        category: null,
        address: null,
        roadAddress: null,
        location: null,
        district: null,
        rawCategory: null,
        rawPayload: {},
      })),
    } as unknown as PlaceNormalizer;
    const save = jest.fn().mockResolvedValue([]);
    const create = jest.fn((value: object) => value);
    const repository = {
      find: jest
        .fn()
        .mockResolvedValueOnce([{ id: 'existing-id', sourcePlaceId: 'old' }])
        .mockResolvedValueOnce([]),
      create,
      save,
    } as unknown as Repository<Place>;

    const result = await new KtoSeoulSyncService(repository, provider, normalizer).synchronize({
      pageSize: 2,
    });

    expect(result).toEqual({
      fetched: 3,
      accepted: 3,
      rejected: 0,
      inserted: 2,
      updated: 1,
      pages: 2,
      totalAvailable: 3,
    });
    expect(save).toHaveBeenCalledTimes(2);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ id: 'existing-id' }));
  });
});
