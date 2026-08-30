import { existsSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { prepareSeoulAreas, SEOUL_DISTRICT_CODES } from './prepare-seoul-spatial-areas';

describe('prepareSeoulAreas', () => {
  it('maps district codes correctly', () => {
    expect(SEOUL_DISTRICT_CODES['11440']).toBe('마포구');
    expect(SEOUL_DISTRICT_CODES['11110']).toBe('종로구');
    expect(SEOUL_DISTRICT_CODES['11680']).toBe('강남구');
  });

  it('converts administrative dong raw zip file into GeoJSON with properties and 5181 SRID', async () => {
    const rawZip = resolve(__dirname, '../../../data/raw/seoul-commercial-analysis-dong.zip');
    const outGeoJson = resolve(__dirname, '../../../data/processed/test-dong.geojson');
    if (!existsSync(rawZip)) {
      return;
    }

    try {
      const result = await prepareSeoulAreas(rawZip, outGeoJson);
      expect(result.featureCount).toBe(425);
      expect(result.sourceSrid).toBe(5181);
      expect(result.propertiesDetected).toContain('ADSTRD_CD');
      expect(result.propertiesDetected).toContain('ADSTRD_NM');
      expect(existsSync(outGeoJson)).toBe(true);
    } finally {
      if (existsSync(outGeoJson)) {
        unlinkSync(outGeoJson);
      }
    }
  });

  it('converts crowd observation 121 places zip file into GeoJSON with 4326 SRID', async () => {
    const rawZip = resolve(__dirname, '../../../data/raw/seoul-121-places.zip');
    const outGeoJson = resolve(__dirname, '../../../data/processed/test-crowd.geojson');
    if (!existsSync(rawZip)) {
      return;
    }

    try {
      const result = await prepareSeoulAreas(rawZip, outGeoJson);
      expect(result.featureCount).toBe(121);
      expect(result.sourceSrid).toBe(4326);
      expect(result.propertiesDetected).toContain('AREA_CD');
      expect(result.propertiesDetected).toContain('AREA_NM');
      expect(existsSync(outGeoJson)).toBe(true);
    } finally {
      if (existsSync(outGeoJson)) {
        unlinkSync(outGeoJson);
      }
    }
  });

  it('throws an error if zip file is missing required shp/dbf files', async () => {
    const invalidZip = resolve(__dirname, '../../../package.json'); // not a valid zip
    await expect(prepareSeoulAreas(invalidZip, 'out.geojson')).rejects.toThrow();
  });
});
