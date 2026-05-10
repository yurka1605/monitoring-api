import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { environment } from '../../../environments/environment';

import { MonitoringSnapshot } from './monitoring.types';

@Injectable({ providedIn: 'root' })
export class MonitoringService {
  private readonly http = inject(HttpClient);

  getSnapshot(): Observable<MonitoringSnapshot> {
    const url = `${environment.monitoringApiBaseUrl}/v1/monitoring`;
    return this.http.get<MonitoringSnapshot>(url);
  }
}
