import { Place } from './entities';
import dataSource from './data-source';

async function seed(): Promise<void> {
  await dataSource.initialize();
  try {
    if (process.env.SEED_MOCK_DATA !== 'true') {
      process.stdout.write(
        'No rows inserted. Set SEED_MOCK_DATA=true to add visibly labelled synthetic development POIs.\n',
      );
      return;
    }
    const repository = dataSource.getRepository(Place);
    const existing = await repository.findOneBy({
      source: 'mock-seed',
      sourcePlaceId: 'mock-seed-cafe-1',
    });
    await repository.save(
      repository.create({
        ...existing,
        source: 'mock-seed',
        sourcePlaceId: 'mock-seed-cafe-1',
        name: '[MOCK] 開発用カフェ',
        category: 'cafe',
        address: '서울특별시 성동구 성수동1가',
        roadAddress: null,
        location: { type: 'Point', coordinates: [127.0436, 37.5467] },
        district: '성동구',
        rawCategory: 'MOCK',
        rawPayload: { fixture: true, synthetic: true },
      }),
    );
    process.stdout.write('Inserted 1 visibly labelled synthetic development POI.\n');
  } finally {
    await dataSource.destroy();
  }
}

void seed();
