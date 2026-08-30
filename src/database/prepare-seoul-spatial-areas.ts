import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import AdmZip from 'adm-zip';
import * as shapefile from 'shapefile';
import * as iconv from 'iconv-lite';

function resolvePath(filePath: string): string {
  if (isAbsolute(filePath)) return filePath;
  const candidates = [
    resolve(process.cwd(), filePath),
    resolve(__dirname, '../../..', filePath),
    resolve(__dirname, '../..', filePath),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return resolve(process.cwd(), filePath);
}

export const SEOUL_DISTRICT_CODES: Readonly<Record<string, string>> = {
  '11110': '종로구',
  '11140': '중구',
  '11170': '용산구',
  '11200': '성동구',
  '11215': '광진구',
  '11230': '동대문구',
  '11260': '중랑구',
  '11290': '성북구',
  '11305': '강북구',
  '11320': '도봉구',
  '11350': '노원구',
  '11380': '은평구',
  '11410': '서대문구',
  '11440': '마포구',
  '11470': '양천구',
  '11500': '강서구',
  '11530': '구로구',
  '11545': '금천구',
  '11560': '영등포구',
  '11590': '동작구',
  '11620': '관악구',
  '11650': '서초구',
  '11680': '강남구',
  '11710': '송파구',
  '11740': '강동구',
};

interface GeoJsonFeature {
  type: 'Feature';
  geometry: { type: string; coordinates?: unknown; geometries?: unknown };
  properties: Record<string, unknown>;
}

interface GeoJsonFeatureCollection {
  type: 'FeatureCollection';
  features: GeoJsonFeature[];
}

function argumentsMap(): Map<string, string> {
  const result = new Map<string, string>();
  for (const argument of process.argv.slice(2)) {
    const match = argument.match(/^--([^=]+)=(.*)$/s);
    if (match?.[1] !== undefined && match[2] !== undefined) result.set(match[1], match[2]);
  }
  return result;
}

function parseDbfRecords(
  buffer: Buffer,
  preferredEncoding: string,
): { fields: string[]; records: Record<string, unknown>[] } {
  const numRecords = buffer.readUInt32LE(4);
  const headerLen = buffer.readUInt16LE(8);
  const recordLen = buffer.readUInt16LE(10);

  const fieldDefs: { name: string; type: string; length: number }[] = [];
  let offset = 32;
  while (offset < headerLen - 1) {
    if (buffer[offset] === 0x0d) break;
    const name = buffer
      .toString('ascii', offset, offset + 11)
      .replace(/\0/g, '')
      .trim();
    const type = String.fromCharCode(buffer[offset + 11] ?? 32);
    const length = buffer[offset + 16] ?? 0;
    fieldDefs.push({ name, type, length });
    offset += 32;
  }

  const records: Record<string, unknown>[] = [];
  let recOffset = headerLen;
  for (let r = 0; r < numRecords; r++) {
    let fieldOffset = recOffset + 1;
    const record: Record<string, unknown> = {};
    for (const f of fieldDefs) {
      const raw = buffer.subarray(fieldOffset, fieldOffset + f.length);
      let str = iconv.decode(raw, preferredEncoding).trim();
      // If decoding with preferred encoding yielded replacement characters, fallback to UTF-8
      if (str.includes('\ufffd') && preferredEncoding.toLowerCase() !== 'utf-8') {
        str = iconv.decode(raw, 'utf-8').trim();
      }
      if (f.type === 'N' || f.type === 'F') {
        record[f.name] = str ? Number(str) : null;
      } else {
        record[f.name] = str;
      }
      fieldOffset += f.length;
    }
    records.push(record);
    recOffset += recordLen;
  }
  return { fields: fieldDefs.map((f) => f.name), records };
}

export async function prepareSeoulAreas(
  zipFilePath: string,
  outputGeoJsonPath: string,
): Promise<{ featureCount: number; sourceSrid: number; propertiesDetected: string[] }> {
  const zipBuffer = await readFile(zipFilePath);
  const zip = new AdmZip(zipBuffer);
  const entries = zip.getEntries();

  let shpBuf: Buffer | null = null;
  let dbfBuf: Buffer | null = null;
  let prjStr = '';
  let cpgStr = '';

  for (const entry of entries) {
    const lowerName = entry.entryName.toLowerCase();
    if (lowerName.endsWith('.shp')) shpBuf = entry.getData();
    if (lowerName.endsWith('.dbf')) dbfBuf = entry.getData();
    if (lowerName.endsWith('.prj')) prjStr = entry.getData().toString('utf-8');
    if (lowerName.endsWith('.cpg')) cpgStr = entry.getData().toString('utf-8').trim();
  }

  if (!shpBuf || !dbfBuf) {
    throw new Error(`ZIP archive must contain both .shp and .dbf files: ${zipFilePath}`);
  }

  // Detect SRID from PRJ
  let sourceSrid = 4326;
  if (prjStr.includes('Korea_2000') || prjStr.includes('Central_Belt')) {
    sourceSrid = 5181;
  } else if (prjStr.includes('WGS_1984') || prjStr.includes('WGS 84') || prjStr.includes('4326')) {
    sourceSrid = 4326;
  }

  // Detect encoding from CPG or default to utf-8 with cp949 fallback
  const encoding = cpgStr ? cpgStr.toLowerCase() : 'utf-8';
  const { fields, records } = parseDbfRecords(dbfBuf, encoding);

  // Parse geometries from SHP
  const geometries: GeoJsonFeature['geometry'][] = [];
  const shpSource = await shapefile.open(shpBuf, undefined);
  while (true) {
    const result = await shpSource.read();
    if (result.done) break;
    if (result.value?.geometry) {
      geometries.push(result.value.geometry);
    }
  }

  if (geometries.length !== records.length) {
    throw new Error(
      `Geometry count (${geometries.length}) does not match DBF record count (${records.length})`,
    );
  }

  const features: GeoJsonFeature[] = geometries.map((geom, idx) => {
    const rawProps = records[idx] ?? {};
    const props: Record<string, unknown> = { ...rawProps };

    // If administrative dong (ADSTRD_CD exists), augment with district and aliases
    const rawCode = rawProps['ADSTRD_CD'];
    const dongCode =
      typeof rawCode === 'string' || typeof rawCode === 'number' ? String(rawCode).trim() : '';
    const rawName = rawProps['ADSTRD_NM'];
    const dongName = typeof rawName === 'string' ? rawName.trim() : '';

    if (dongCode.length >= 5) {
      const distCode = dongCode.slice(0, 5);
      const district = SEOUL_DISTRICT_CODES[distCode] ?? null;
      if (district) {
        props['district'] = district;
      }
    }
    if (dongName) {
      const alias = dongName.endsWith('동') ? dongName.replace(/동$/u, '') : null;
      if (alias && alias !== dongName) {
        props['aliases'] = [alias];
      }
    }

    return {
      type: 'Feature',
      geometry: geom,
      properties: props,
    };
  });

  const collection: GeoJsonFeatureCollection = {
    type: 'FeatureCollection',
    features,
  };

  await writeFile(outputGeoJsonPath, JSON.stringify(collection, null, 2), 'utf-8');

  return {
    featureCount: features.length,
    sourceSrid,
    propertiesDetected: fields,
  };
}

async function run(): Promise<void> {
  const args = argumentsMap();
  const fileArg = args.get('file');
  const outputArg = args.get('output');

  if (!fileArg || !outputArg) {
    process.stdout.write(
      'Usage: npm --prefix backend run prepare:seoul-areas -- --file=./data/raw/<file>.zip --output=./data/processed/<output>.geojson\n',
    );
    return;
  }

  const zipFile = resolvePath(fileArg);
  const outputFile = resolvePath(outputArg);

  const result = await prepareSeoulAreas(zipFile, outputFile);
  process.stdout.write(
    `Seoul spatial area preparation complete:\n${JSON.stringify(
      {
        inputFile: fileArg,
        outputFile: outputArg,
        featureCount: result.featureCount,
        sourceSrid: result.sourceSrid,
        propertiesDetected: result.propertiesDetected,
      },
      null,
      2,
    )}\n`,
  );
}

if (require.main === module) {
  run().catch((error: unknown) => {
    process.stderr.write(
      `Preparation failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
