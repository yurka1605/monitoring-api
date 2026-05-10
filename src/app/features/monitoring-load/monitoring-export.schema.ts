/** Round-trip export/import for saved load-test sessions. */

export const MONITORING_EXPORT_FORMAT_VERSION = 1 as const;

export interface MonitoringExportSample {
  sampleTimeIso: string;
  timeLabelLocal: string;
  cpuPercent: number;
  memoryAvailableMb: number;
  memoryUsedMb: number;
  memoryPercent: number;
  diskFreeGb: number;
  diskPercent: number;
}

export interface MonitoringExportMeta {
  /** ISO 8601 instant when the file was written */
  exportedAt: string;
  pollIntervalSeconds: number;
  testDurationMs: number;
  testDurationDisplay: string;
  /** Totals taken from the first successful snapshot of the original session */
  memoryTotalMb: number;
  diskTotalGb: number;
}

export interface MonitoringExportFile {
  formatVersion: typeof MONITORING_EXPORT_FORMAT_VERSION;
  meta: MonitoringExportMeta;
  samples: MonitoringExportSample[];
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

function isSample(v: unknown): v is MonitoringExportSample {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return (
    isNonEmptyString(o['sampleTimeIso']) &&
    typeof o['timeLabelLocal'] === 'string' &&
    isFiniteNumber(o['cpuPercent']) &&
    isFiniteNumber(o['memoryAvailableMb']) &&
    isFiniteNumber(o['memoryUsedMb']) &&
    isFiniteNumber(o['memoryPercent']) &&
    isFiniteNumber(o['diskFreeGb']) &&
    isFiniteNumber(o['diskPercent'])
  );
}

/** Accepts JSON produced by this app (version 1). */
export function parseMonitoringExport(raw: unknown): MonitoringExportFile | null {
  if (!raw || typeof raw !== 'object') return null;
  const root = raw as Record<string, unknown>;
  if (root['formatVersion'] !== MONITORING_EXPORT_FORMAT_VERSION) return null;
  const metaRaw = root['meta'];
  if (!metaRaw || typeof metaRaw !== 'object') return null;
  const m = metaRaw as Record<string, unknown>;
  if (!Array.isArray(root['samples'])) return null;

  if (
    !isNonEmptyString(m['exportedAt']) ||
    !isFiniteNumber(m['pollIntervalSeconds']) ||
    !isFiniteNumber(m['testDurationMs']) ||
    typeof m['testDurationDisplay'] !== 'string' ||
    !isFiniteNumber(m['memoryTotalMb']) ||
    !isFiniteNumber(m['diskTotalGb'])
  ) {
    return null;
  }

  const samples = root['samples'];
  if (!samples.every(isSample)) return null;

  return {
    formatVersion: MONITORING_EXPORT_FORMAT_VERSION,
    meta: {
      exportedAt: m['exportedAt'],
      pollIntervalSeconds: m['pollIntervalSeconds'],
      testDurationMs: m['testDurationMs'],
      testDurationDisplay: m['testDurationDisplay'],
      memoryTotalMb: m['memoryTotalMb'],
      diskTotalGb: m['diskTotalGb'],
    },
    samples,
  };
}
