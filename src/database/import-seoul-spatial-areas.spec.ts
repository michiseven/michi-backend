import { importSeoulSpatialAreas } from './import-seoul-spatial-areas';

describe('importSeoulSpatialAreas', () => {
  it('validates required kind parameter', async () => {
    await expect(
      importSeoulSpatialAreas({
        file: 'dummy.geojson',
        source: 'test-source',
        sourceUrl: 'https://example.com',
        idProperty: 'id',
        nameProperty: 'name',
        sourceSrid: 4326,
        kind: 'invalid_kind' as never,
      }),
    ).rejects.toThrow('--kind must be administrative_dong or crowd_observation');
  });

  it('validates positive source SRID integer', async () => {
    await expect(
      importSeoulSpatialAreas({
        file: 'dummy.geojson',
        source: 'test-source',
        sourceUrl: 'https://example.com',
        idProperty: 'id',
        nameProperty: 'name',
        sourceSrid: -1,
        kind: 'administrative_dong',
      }),
    ).rejects.toThrow('--source-srid must be a positive EPSG integer');
  });

  it('validates HTTP(S) source URL', async () => {
    await expect(
      importSeoulSpatialAreas({
        file: 'dummy.geojson',
        source: 'test-source',
        sourceUrl: 'ftp://example.com',
        idProperty: 'id',
        nameProperty: 'name',
        sourceSrid: 4326,
        kind: 'administrative_dong',
      }),
    ).rejects.toThrow('--source-url must be an HTTP(S) URL');
  });

  it('declares repaired count in the return type definition', () => {
    type ImportResult = Awaited<ReturnType<typeof importSeoulSpatialAreas>>;
    const sampleResult: ImportResult = {
      file: 'test.geojson',
      source: 'test-source',
      kind: 'administrative_dong',
      sourceSrid: 5181,
      accepted: 425,
      repaired: 0,
      rejected: 0,
    };
    expect(sampleResult.repaired).toBe(0);
  });
});
