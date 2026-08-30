import { parseCanonicalTourismData } from './canonical-tourism-data.parser';

const source = {
  datasetKey: 'mock-dataset',
  name: '[MOCK] dataset',
  sourceName: 'MOCK',
  url: 'https://example.invalid/mock',
  licenseUseCondition: 'synthetic fixture',
  updateCycle: null,
  spatialGranularity: 'mock area',
  temporalGranularity: 'mock month',
  apiAvailable: false,
  csvAvailable: true,
  metadata: { fixture: true },
};

describe('parseCanonicalTourismData', () => {
  it('keeps valid JSON metrics and reports invalid rows without inventing a subject', () => {
    const result = parseCanonicalTourismData(
      JSON.stringify({
        schemaVersion: 'michi-tourism-metric-v1',
        source,
        referencePeriod: 'MOCK-2026-01',
        mode: 'mock',
        metrics: [
          {
            areaCode: 'MOCK-A',
            areaName: '[MOCK] A',
            placeSource: null,
            sourcePlaceId: null,
            metricType: 'mock_count',
            value: 10,
            unit: 'synthetic_count',
            periodStart: '2026-01-01',
            periodEnd: '2026-01-31',
            dimensions: {},
            metadata: { fixture: true },
          },
          {
            areaCode: null,
            areaName: null,
            placeSource: null,
            sourcePlaceId: null,
            metricType: 'mock_count',
            value: 1,
            unit: 'synthetic_count',
            periodStart: null,
            periodEnd: null,
            dimensions: {},
            metadata: {},
          },
        ],
      }),
      'json',
    );

    expect(result.metrics).toHaveLength(1);
    expect(result.rejections).toEqual([expect.objectContaining({ row: 2, code: 'INVALID_ROW' })]);
  });

  it('parses quoted CSV JSON fields and rejects a row with an empty numeric value', () => {
    const headers = [
      'datasetKey',
      'name',
      'sourceName',
      'url',
      'spatialGranularity',
      'temporalGranularity',
      'mode',
      'metricType',
      'value',
      'unit',
      'areaCode',
      'areaName',
      'dimensions',
    ].join(',');
    const common =
      'mock-dataset,[MOCK] dataset,MOCK,https://example.invalid/mock,mock area,mock month,mock,mock_count';
    const csv = `${headers}\n${common},10,synthetic_count,MOCK-A,[MOCK] A,"{""segment"":""MOCK,solo""}"\n${common},,synthetic_count,MOCK-B,[MOCK] B,{}`;

    const result = parseCanonicalTourismData(csv, 'csv');

    expect(result.metrics[0]?.metric.dimensions).toEqual({ segment: 'MOCK,solo' });
    expect(result.rejections).toEqual([
      expect.objectContaining({ row: 3, code: 'INVALID_ROW', message: 'value is required' }),
    ]);
  });
});
