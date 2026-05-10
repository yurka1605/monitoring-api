import { DatePipe, DecimalPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  NgZone,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ChartConfiguration, ChartOptions } from 'chart.js';
import { BaseChartDirective } from 'ng2-charts';
import { Subscription, interval, startWith, switchMap } from 'rxjs';

import {
  MONITORING_EXPORT_FORMAT_VERSION,
  parseMonitoringExport,
  type MonitoringExportFile,
  type MonitoringExportSample,
} from './monitoring-export.schema';
import { MonitoringService } from './monitoring.service';
import { MonitoringSnapshot } from './monitoring.types';

const POLL_MS = 3000;

@Component({
  selector: 'app-monitoring-load-page',
  standalone: true,
  imports: [BaseChartDirective, DatePipe, DecimalPipe],
  templateUrl: './monitoring-load-page.component.html',
  styleUrl: './monitoring-load-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MonitoringLoadPageComponent {
  private readonly monitoring = inject(MonitoringService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly zone = inject(NgZone);

  private pollSub: Subscription | undefined;

  protected readonly isRunning = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly lastSampleAt = signal<Date | null>(null);

  protected readonly memoryTotalMb = signal<number | null>(null);
  protected readonly diskTotalGb = signal<number | null>(null);

  /** Wall-clock start of the current test session (ms since epoch). */
  private readonly sessionStartMs = signal<number | null>(null);
  /** Elapsed test duration; refreshed on each sample while running, frozen on Stop. */
  protected readonly testDurationMs = signal(0);

  /** After Stop or successful import: можно скачать JSON ещё раз. */
  protected readonly exportReady = signal(false);

  /** Просмотр загруженного файла — без живого опроса (кнопка «Старт» скрыта). */
  protected readonly importedView = signal(false);

  /** Имя выбранного JSON на диске (только после успешной загрузки). */
  protected readonly importedFileLabel = signal<string | null>(null);

  protected readonly labels = signal<string[]>([]);
  /** Wall-clock instant of each sample (ISO 8601), parallel to labels / metric arrays. */
  protected readonly sampleAtIso = signal<string[]>([]);
  protected readonly cpuPercent = signal<number[]>([]);
  protected readonly memoryAvailableMb = signal<number[]>([]);
  protected readonly memoryUsedMb = signal<number[]>([]);
  protected readonly memoryPercent = signal<number[]>([]);
  protected readonly diskFreeGb = signal<number[]>([]);
  protected readonly diskPercent = signal<number[]>([]);

  protected readonly lineOptions: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: { enabled: true },
    },
    scales: {
      x: {
        ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 10 },
        grid: { display: false },
      },
      y: {
        beginAtZero: true,
        ticks: { maxTicksLimit: 6 },
      },
    },
  };

  protected readonly cpuChartData = computed<ChartConfiguration<'line'>['data']>(() =>
    this.lineDataset('CPU, %', '#2563eb', this.cpuPercent()),
  );

  protected readonly memoryAvailableChartData = computed<ChartConfiguration<'line'>['data']>(() =>
    this.lineDataset('Память доступно, МБ', '#059669', this.memoryAvailableMb()),
  );

  protected readonly memoryUsedChartData = computed<ChartConfiguration<'line'>['data']>(() =>
    this.lineDataset('Память занято, МБ', '#d97706', this.memoryUsedMb()),
  );

  protected readonly memoryPercentChartData = computed<ChartConfiguration<'line'>['data']>(() =>
    this.lineDataset('Память, %', '#7c3aed', this.memoryPercent()),
  );

  protected readonly diskFreeChartData = computed<ChartConfiguration<'line'>['data']>(() =>
    this.lineDataset('Диск свободно, ГБ', '#0d9488', this.diskFreeGb()),
  );

  protected readonly diskPercentChartData = computed<ChartConfiguration<'line'>['data']>(() =>
    this.lineDataset('Диск занято, %', '#dc2626', this.diskPercent()),
  );

  constructor() {
    this.destroyRef.onDestroy(() => this.stopInternal());
  }

  protected start(): void {
    this.stopInternal();
    this.importedView.set(false);
    this.importedFileLabel.set(null);
    this.exportReady.set(false);
    this.clearSeries();
    this.error.set(null);
    this.sessionStartMs.set(Date.now());
    this.testDurationMs.set(0);
    this.isRunning.set(true);

    this.pollSub = interval(POLL_MS)
      .pipe(
        startWith(0),
        switchMap(() => this.monitoring.getSnapshot()),
      )
      .subscribe({
        next: (snapshot) => this.onSnapshot(snapshot),
        error: (err: unknown) =>
          this.error.set(err instanceof Error ? err.message : 'Не удалось получить данные'),
      });
  }

  protected stop(): void {
    this.stopInternal();
    this.exportReady.set(true);
  }

  /** Сброс режима просмотра файла и очистка графиков — дальше можно нажать «Старт». */
  protected prepareNewLiveTest(): void {
    this.stopInternal();
    this.importedView.set(false);
    this.importedFileLabel.set(null);
    this.exportReady.set(false);
    this.clearSeries();
    this.error.set(null);
  }

  protected onImportFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;

    const chosenName = file.name;
    const reader = new FileReader();
    reader.onload = (): void => {
      this.zone.run(() => {
        try {
          const text = reader.result as string;
          const parsed: unknown = JSON.parse(text);
          const data = parseMonitoringExport(parsed);
          if (!data) {
            this.error.set(
              'Файл не распознан: нужен JSON результатов мониторинга (formatVersion 1), сохранённый этой страницей.',
            );
            return;
          }
          this.applyImportedSession(data, chosenName);
          this.error.set(null);
        } catch {
          this.error.set('Не удалось прочитать JSON из файла.');
        }
      });
    };
    reader.onerror = (): void =>
      this.zone.run(() => this.error.set('Ошибка чтения файла.'));
    reader.readAsText(file, 'utf-8');
  }

  /** JSON: все снимки + meta с памятью/диском с первого запроса — для повторной загрузки на страницу. */
  protected downloadResults(): void {
    const memoryTotalMb = this.memoryTotalMb();
    const diskTotalGb = this.diskTotalGb();
    if (memoryTotalMb === null || diskTotalGb === null) {
      this.error.set('Нечего сохранять: нет данных первого снимка (память/диск).');
      return;
    }

    const exportedAt = new Date().toISOString();
    const payload = this.buildExportPayload(exportedAt, memoryTotalMb, diskTotalGb);
    const json = `${JSON.stringify(payload, null, 2)}\n`;
    const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
    const safeStamp = exportedAt.replace(/[:.]/g, '-');
    const filename = `monitoring-load-${safeStamp}.json`;

    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.rel = 'noopener';
    anchor.click();
    queueMicrotask(() => URL.revokeObjectURL(url));
    this.error.set(null);
  }

  private buildExportPayload(
    exportedAt: string,
    memoryTotalMb: number,
    diskTotalGb: number,
  ): MonitoringExportFile {
    const n = MonitoringLoadPageComponent.parallelSampleLength(this);
    const samples: MonitoringExportSample[] = [];
    for (let i = 0; i < n; i++) {
      samples.push({
        sampleTimeIso: this.sampleAtIso()[i],
        timeLabelLocal: this.labels()[i],
        cpuPercent: this.cpuPercent()[i],
        memoryAvailableMb: this.memoryAvailableMb()[i],
        memoryUsedMb: this.memoryUsedMb()[i],
        memoryPercent: this.memoryPercent()[i],
        diskFreeGb: this.diskFreeGb()[i],
        diskPercent: this.diskPercent()[i],
      });
    }

    return {
      formatVersion: MONITORING_EXPORT_FORMAT_VERSION,
      meta: {
        exportedAt,
        pollIntervalSeconds: POLL_MS / 1000,
        testDurationMs: this.testDurationMs(),
        testDurationDisplay: this.formatTestDuration(this.testDurationMs()),
        memoryTotalMb,
        diskTotalGb,
      },
      samples,
    };
  }

  private applyImportedSession(data: MonitoringExportFile, sourceFileName: string): void {
    this.stopInternal();

    const samples = data.samples;
    const iso = samples.map((s) => s.sampleTimeIso);
    const lbl = samples.map((s) => s.timeLabelLocal);

    this.memoryTotalMb.set(data.meta.memoryTotalMb);
    this.diskTotalGb.set(data.meta.diskTotalGb);
    this.testDurationMs.set(data.meta.testDurationMs);
    this.sampleAtIso.set(iso);
    this.labels.set(lbl);
    this.cpuPercent.set(samples.map((s) => s.cpuPercent));
    this.memoryAvailableMb.set(samples.map((s) => s.memoryAvailableMb));
    this.memoryUsedMb.set(samples.map((s) => s.memoryUsedMb));
    this.memoryPercent.set(samples.map((s) => s.memoryPercent));
    this.diskFreeGb.set(samples.map((s) => s.diskFreeGb));
    this.diskPercent.set(samples.map((s) => s.diskPercent));

    const lastIso = iso.at(-1);
    this.lastSampleAt.set(lastIso ? new Date(lastIso) : null);

    this.importedFileLabel.set(sourceFileName);
    this.importedView.set(true);
    this.exportReady.set(true);
    this.isRunning.set(false);
  }

  private static parallelSampleLength(self: MonitoringLoadPageComponent): number {
    return Math.min(
      self.sampleAtIso().length,
      self.labels().length,
      self.cpuPercent().length,
      self.memoryAvailableMb().length,
      self.memoryUsedMb().length,
      self.memoryPercent().length,
      self.diskFreeGb().length,
      self.diskPercent().length,
    );
  }

  private stopInternal(): void {
    const start = this.sessionStartMs();
    if (start !== null) {
      this.testDurationMs.set(Date.now() - start);
    }
    this.sessionStartMs.set(null);
    this.pollSub?.unsubscribe();
    this.pollSub = undefined;
    this.isRunning.set(false);
  }

  private clearSeries(): void {
    this.sessionStartMs.set(null);
    this.testDurationMs.set(0);
    this.labels.set([]);
    this.sampleAtIso.set([]);
    this.cpuPercent.set([]);
    this.memoryAvailableMb.set([]);
    this.memoryUsedMb.set([]);
    this.memoryPercent.set([]);
    this.diskFreeGb.set([]);
    this.diskPercent.set([]);
    this.lastSampleAt.set(null);
    this.memoryTotalMb.set(null);
    this.diskTotalGb.set(null);
  }

  private onSnapshot(snapshot: MonitoringSnapshot): void {
    this.error.set(null);

    const sampleTime = this.resolveSampleTime(snapshot);
    this.lastSampleAt.set(sampleTime);

    if (this.memoryTotalMb() === null) {
      this.memoryTotalMb.set(snapshot.host.memory_total_mb);
      this.diskTotalGb.set(snapshot.host.disk_total_gb);
    }

    const label = sampleTime.toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    const { host: h } = snapshot;

    const sessionStart = this.sessionStartMs();
    if (sessionStart !== null && this.isRunning()) {
      this.testDurationMs.set(Date.now() - sessionStart);
    }

    this.sampleAtIso.update((v) => [...v, sampleTime.toISOString()]);
    this.labels.update((v) => [...v, label]);
    this.cpuPercent.update((v) => [...v, h.cpu_percent]);
    this.memoryAvailableMb.update((v) => [...v, h.memory_available_mb]);
    this.memoryUsedMb.update((v) => [...v, h.memory_used_mb]);
    this.memoryPercent.update((v) => [...v, h.memory_percent]);
    this.diskFreeGb.update((v) => [...v, h.disk_free_gb]);
    this.diskPercent.update((v) => [...v, h.disk_percent]);
  }

  private resolveSampleTime(snapshot: MonitoringSnapshot): Date {
    const ts = snapshot.timestamp;
    if (typeof ts !== 'number' || !Number.isFinite(ts) || ts <= 0) {
      return new Date();
    }
    if (ts > 1_000_000_000_000) {
      return new Date(ts);
    }
    if (ts > 1_000_000_000) {
      return new Date(ts * 1000);
    }
    return new Date();
  }

  /** Human-readable duration for the summary strip (H optional). */
  protected formatTestDuration(ms: number): string {
    const totalSec = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    const mm = m.toString().padStart(2, '0');
    const ss = s.toString().padStart(2, '0');
    return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
  }

  private lineDataset(
    label: string,
    color: string,
    values: number[],
  ): ChartConfiguration<'line'>['data'] {
    return {
      labels: [...this.labels()],
      datasets: [
        {
          label,
          data: [...values],
          borderColor: color,
          backgroundColor: `${color}26`,
          borderWidth: 1.5,
          tension: 0.25,
          pointRadius: 0,
          fill: false,
        },
      ],
    };
  }
}
