import { z } from 'zod';
import type {
  CanonicalTourismDataSource,
  CanonicalTourismMetric,
  ParsedTourismImport,
  TourismImportRejection,
} from './tourism-data.types';

const JsonObjectSchema = z.record(z.string(), z.unknown());
const DateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'must use YYYY-MM-DD')
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, 'must be a real calendar date');

const DataSourceSchema = z
  .object({
    datasetKey: z
      .string()
      .trim()
      .min(1)
      .max(160)
      .regex(/^[a-zA-Z0-9._-]+$/),
    name: z.string().trim().min(1).max(255),
    sourceName: z.string().trim().min(1).max(255),
    url: z.string().trim().url().max(1000),
    licenseUseCondition: z.string().trim().min(1).nullable().default(null),
    updateCycle: z.string().trim().min(1).max(120).nullable().default(null),
    spatialGranularity: z.string().trim().min(1).max(120),
    temporalGranularity: z.string().trim().min(1).max(120),
    apiAvailable: z.boolean().default(false),
    csvAvailable: z.boolean().default(false),
    metadata: JsonObjectSchema.default({}),
  })
  .strict();

const MetricSchema = z
  .object({
    areaCode: z.string().trim().min(1).max(120).nullable().default(null),
    areaName: z.string().trim().min(1).max(255).nullable().default(null),
    placeSource: z.string().trim().min(1).max(40).nullable().default(null),
    sourcePlaceId: z.string().trim().min(1).max(255).nullable().default(null),
    metricType: z.string().trim().min(1).max(160),
    value: z.number().finite(),
    unit: z.string().trim().min(1).max(80),
    periodStart: DateSchema.nullable().default(null),
    periodEnd: DateSchema.nullable().default(null),
    dimensions: JsonObjectSchema.default({}),
    metadata: JsonObjectSchema.default({}),
  })
  .strict()
  .superRefine((metric, context) => {
    const hasPlaceSource = metric.placeSource !== null;
    const hasSourcePlaceId = metric.sourcePlaceId !== null;
    if (hasPlaceSource !== hasSourcePlaceId) {
      context.addIssue({
        code: 'custom',
        message: 'placeSource and sourcePlaceId must be supplied together',
      });
    }
    if (!hasPlaceSource && metric.areaCode === null && metric.areaName === null) {
      context.addIssue({
        code: 'custom',
        message: 'an areaCode, areaName, or provider place identity is required',
      });
    }
    if (metric.periodStart && metric.periodEnd && metric.periodEnd < metric.periodStart) {
      context.addIssue({
        code: 'custom',
        message: 'periodEnd must not be earlier than periodStart',
      });
    }
  });

const JsonEnvelopeSchema = z
  .object({
    schemaVersion: z.literal('michi-tourism-metric-v1'),
    source: DataSourceSchema,
    referencePeriod: z.string().trim().min(1).max(160).nullable().default(null),
    mode: z.enum(['live', 'mock']),
    metrics: z.array(z.unknown()).min(1),
  })
  .strict();

function issues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join('.') || 'row'}: ${issue.message}`)
    .join('; ');
}

function validateMetrics(values: unknown[]): Pick<ParsedTourismImport, 'metrics' | 'rejections'> {
  const metrics: ParsedTourismImport['metrics'] = [];
  const rejections: TourismImportRejection[] = [];
  values.forEach((value, index) => {
    const row = index + 1;
    const parsed = MetricSchema.safeParse(value);
    if (parsed.success) metrics.push({ row, metric: parsed.data });
    else rejections.push({ row, code: 'INVALID_ROW', message: issues(parsed.error) });
  });
  return { metrics, rejections };
}

function parseJson(text: string): ParsedTourismImport {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new Error(
      `Tourism JSON is invalid: ${error instanceof Error ? error.message : 'parse error'}`,
    );
  }
  const envelope = JsonEnvelopeSchema.safeParse(raw);
  if (!envelope.success)
    throw new Error(`Tourism JSON envelope is invalid: ${issues(envelope.error)}`);
  return { ...envelope.data, ...validateMetrics(envelope.data.metrics) };
}

function csvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const input = text.replace(/^\uFEFF/, '');
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index]!;
    if (quoted) {
      if (character === '"' && input[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') quoted = false;
      else field += character;
    } else if (character === '"') quoted = true;
    else if (character === ',') {
      row.push(field);
      field = '';
    } else if (character === '\n') {
      row.push(field.replace(/\r$/, ''));
      if (row.some((value) => value.trim() !== '')) rows.push(row);
      row = [];
      field = '';
    } else field += character;
  }
  if (quoted) throw new Error('Tourism CSV contains an unclosed quoted field');
  row.push(field.replace(/\r$/, ''));
  if (row.some((value) => value.trim() !== '')) rows.push(row);
  return rows;
}

function optional(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function booleanValue(value: string | undefined, field: string): boolean {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return false;
  if (['true', '1', 'yes'].includes(normalized)) return true;
  if (['false', '0', 'no'].includes(normalized)) return false;
  throw new Error(`${field} must be true or false`);
}

function jsonObject(value: string | undefined, field: string): Record<string, unknown> {
  if (!value?.trim()) return {};
  try {
    return JsonObjectSchema.parse(JSON.parse(value));
  } catch {
    throw new Error(`${field} must be a JSON object`);
  }
}

function recordOf(headers: string[], row: string[]): Record<string, string | undefined> {
  return Object.fromEntries(headers.map((header, index) => [header, row[index]]));
}

const REQUIRED_CSV_HEADERS = [
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
] as const;

function csvSource(record: Record<string, string | undefined>): CanonicalTourismDataSource {
  return DataSourceSchema.parse({
    datasetKey: record.datasetKey,
    name: record.name,
    sourceName: record.sourceName,
    url: record.url,
    licenseUseCondition: optional(record.licenseUseCondition),
    updateCycle: optional(record.updateCycle),
    spatialGranularity: record.spatialGranularity,
    temporalGranularity: record.temporalGranularity,
    apiAvailable: booleanValue(record.apiAvailable, 'apiAvailable'),
    csvAvailable: booleanValue(record.csvAvailable, 'csvAvailable'),
    metadata: jsonObject(record.sourceMetadata, 'sourceMetadata'),
  });
}

function csvMetric(record: Record<string, string | undefined>): CanonicalTourismMetric {
  if (!record.value?.trim()) throw new Error('value is required');
  return MetricSchema.parse({
    areaCode: optional(record.areaCode),
    areaName: optional(record.areaName),
    placeSource: optional(record.placeSource),
    sourcePlaceId: optional(record.sourcePlaceId),
    metricType: record.metricType,
    value: Number(record.value),
    unit: record.unit,
    periodStart: optional(record.periodStart),
    periodEnd: optional(record.periodEnd),
    dimensions: jsonObject(record.dimensions, 'dimensions'),
    metadata: jsonObject(record.metadata, 'metadata'),
  });
}

function parseCsv(text: string): ParsedTourismImport {
  const rows = csvRows(text);
  const headers = rows[0]?.map((header) => header.trim());
  if (!headers) throw new Error('Tourism CSV is empty');
  const missing = REQUIRED_CSV_HEADERS.filter((header) => !headers.includes(header));
  if (missing.length > 0) throw new Error(`Tourism CSV is missing headers: ${missing.join(', ')}`);
  const records = rows.slice(1).map((row) => recordOf(headers, row));
  if (records.length === 0) throw new Error('Tourism CSV contains no data rows');

  let source: CanonicalTourismDataSource;
  try {
    source = csvSource(records[0]!);
  } catch (error) {
    throw new Error(`Tourism CSV source metadata is invalid: ${String(error)}`);
  }
  const referencePeriod = optional(records[0]!.referencePeriod);
  const mode = records[0]!.mode?.trim();
  if (mode !== 'live' && mode !== 'mock') throw new Error('Tourism CSV mode must be live or mock');

  const metrics: ParsedTourismImport['metrics'] = [];
  const preRejected: TourismImportRejection[] = [];
  records.forEach((record, index) => {
    const row = index + 2;
    try {
      if (JSON.stringify(csvSource(record)) !== JSON.stringify(source)) {
        throw new Error('source metadata differs from the first row');
      }
      if (optional(record.referencePeriod) !== referencePeriod || record.mode?.trim() !== mode) {
        throw new Error('referencePeriod or mode differs from the first row');
      }
      metrics.push({ row, metric: csvMetric(record) });
    } catch (error) {
      preRejected.push({
        row,
        code: 'INVALID_ROW',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });
  return {
    schemaVersion: 'michi-tourism-metric-v1',
    source,
    referencePeriod,
    mode,
    metrics,
    rejections: preRejected,
  };
}

export function parseCanonicalTourismData(
  text: string,
  format: 'csv' | 'json',
): ParsedTourismImport {
  return format === 'json' ? parseJson(text.replace(/^\uFEFF/, '')) : parseCsv(text);
}
