export interface HostMetrics {
  cpu_percent: number;
  memory_total_mb: number;
  memory_available_mb: number;
  memory_used_mb: number;
  memory_percent: number;
  disk_total_gb: number;
  disk_free_gb: number;
  disk_percent: number;
}

export interface MonitoringSnapshot {
  timestamp: number;
  host: HostMetrics;
  vms: {
    total: number;
    by_status: Record<string, number>;
  };
  alerts: string[];
}
