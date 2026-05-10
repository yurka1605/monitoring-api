import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'monitoring/load-test' },
  {
    path: 'monitoring/load-test',
    loadComponent: () =>
      import('./features/monitoring-load/monitoring-load-page.component').then(
        (m) => m.MonitoringLoadPageComponent,
      ),
  },
  { path: '**', redirectTo: 'monitoring/load-test' },
];
