import type { Repository } from 'typeorm';
import type { Place } from '../database/entities';
import { KTO_PLACE_SOURCE } from '../providers/place/kto-place.provider';
import type {
  ImportTourismBufferOptions,
  TourismDataImportService,
} from './tourism-data-import.service';
import type { TourismImportSummary } from './tourism-data.types';
import type { KtoDataLabConcentrationProvider } from './kto-datalab-concentration.provider';
import {
  ktoPlaceNameAliases,
  KtoDataLabConcentrationSyncService,
  uniqueKtoPlaceMatch,
} from './kto-datalab-concentration-sync.service';

function place(id: string, name: string): Place {
  return {
    id,
    source: KTO_PLACE_SOURCE,
    sourcePlaceId: `source-${id}`,
    name,
  } as Place;
}

describe('KtoDataLabConcentrationSyncService', () => {
  it('extracts a conservative Korean alias from a Japanese KTO title', () => {
    expect(ktoPlaceNameAliases('広蔵市場（광장시장）')).toContain('광장시장');
    expect(ktoPlaceNameAliases('金仙寺（ソウル）（금선사（서울））')).toContain('금선사서울');
    expect(ktoPlaceNameAliases('AK PLAZA弘大（AK PLAZA 홍대）')).toContain('akplaza홍대');
    expect(ktoPlaceNameAliases('KT&Gサンサンマダン（弘大）（KT&G 상상마당（홍대））')).toContain(
      'ktg상상마당홍대',
    );
    expect(ktoPlaceNameAliases('梨花女子高100周年記念館（이화여고100주년기념관）')).toContain(
      '이화여고100주년기념관',
    );
    expect(ktoPlaceNameAliases('国立4.19民主墓地（국립4.19민주묘지）')).toContain(
      '국립419민주묘지',
    );
    expect(ktoPlaceNameAliases('SJ.KUNSTHALLE（SJ쿤스트할레）')).toContain('sj쿤스트할레');
  });

  it('normalizes DataLab attraction names with qualifiers and brackets', () => {
    const aliases = new Map<string, Place[]>([
      ['우표박물관', [place('stamp-museum', '切手博物館（우표박물관）')]],
      ['봉은사서울', [place('bongeunsa', '奉恩寺（ソウル）（봉은사（서울））')]],
      ['봉은사', [place('bongeunsa', '奉恩寺（ソウル）（봉은사（서울））')]],
    ]);
    expect(uniqueKtoPlaceMatch('우표박물관 (구.우표문화누리)', aliases)).toMatchObject({
      id: 'stamp-museum',
    });
    expect(uniqueKtoPlaceMatch('봉은사(서울)', aliases)).toMatchObject({ id: 'bongeunsa' });
    expect(uniqueKtoPlaceMatch('전혀 관련 없는 장소', aliases)).toBeNull();
  });

  it('does not choose an ambiguous provider place', () => {
    const matches = new Map<string, Place[]>([
      ['광화문', [place('one', '光化門（광화문）'), place('two', '광화문')]],
    ]);
    expect(uniqueKtoPlaceMatch('광화문', matches)).toBe('ambiguous');
  });

  it('imports only exact unique place matches as live daily forecast metrics', async () => {
    const matchedPlace = place('gwanghwamun', '光化門（광화문）');
    const places = {
      find: jest.fn().mockResolvedValue([matchedPlace]),
    } as unknown as Repository<Place>;
    const provider = {
      fetchDistrict: jest.fn().mockResolvedValue({
        pages: 1,
        rejectedCount: 0,
        records: [
          {
            areaCode: '11',
            areaName: '서울특별시',
            districtCode: '11110',
            districtName: '종로구',
            attractionName: '광화문',
            forecastDate: '2026-08-21',
            concentrationIndex: 72.95,
          },
          {
            areaCode: '11',
            areaName: '서울특별시',
            districtCode: '11110',
            districtName: '종로구',
            attractionName: '연결되지 않은 장소',
            forecastDate: '2026-08-21',
            concentrationIndex: 50,
          },
        ],
      }),
    } as unknown as KtoDataLabConcentrationProvider;
    let capturedImport: ImportTourismBufferOptions | undefined;
    const importBuffer = jest.fn(
      (options: ImportTourismBufferOptions): Promise<TourismImportSummary> => {
        capturedImport = options;
        return Promise.resolve({
          importRunId: 'run',
          datasetKey: 'kto-datalab-tourism-concentration-forecast',
          fileName: 'forecast.json',
          fileSha256: 'a'.repeat(64),
          mode: 'live',
          skipped: false,
          accepted: 1,
          rejected: 0,
          rejections: [],
        });
      },
    );
    const importer = { importBuffer } as unknown as TourismDataImportService;
    const service = new KtoDataLabConcentrationSyncService(places, provider, importer);

    const summary = await service.synchronize({ districtNames: ['종로구'] });

    expect(summary).toMatchObject({
      districts: 1,
      fetched: 2,
      matchedRows: 1,
      matchedPlaces: 1,
      unmatchedAttractions: 1,
    });
    expect(capturedImport?.runMetadata).toMatchObject({
      districts: 1,
      fetched: 2,
      matchedRows: 1,
      matchedPlaces: 1,
      unmatchedAttractions: 1,
      ambiguousAttractions: 0,
      matchingPolicyVersion: 'kto-datalab-matching-v2-paren-alias',
    });
    const bytes = capturedImport?.bytes;
    if (!bytes) throw new Error('Expected canonical tourism import bytes');
    const document = JSON.parse(Buffer.from(bytes).toString('utf8')) as {
      mode: string;
      metrics: Array<Record<string, unknown>>;
    };
    expect(document.mode).toBe('live');
    expect(document.metrics).toEqual([
      expect.objectContaining({
        placeSource: KTO_PLACE_SOURCE,
        sourcePlaceId: matchedPlace.sourcePlaceId,
        metricType: 'concentration_forecast_index',
        value: 72.95,
        unit: 'relative_index_0_100',
        periodStart: '2026-08-21',
      }),
    ]);
  });
});
