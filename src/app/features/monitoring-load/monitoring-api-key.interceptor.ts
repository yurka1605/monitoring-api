import { HttpInterceptorFn } from '@angular/common/http';

import { environment } from '../../../environments/environment';

export const monitoringApiKeyInterceptor: HttpInterceptorFn = (req, next) => {
  if (!req.url.includes('/v1/monitoring')) {
    return next(req);
  }

  const key = environment.monitoringApiKey;
  if (!key) {
    return next(req);
  }

  return next(
    req.clone({
      setHeaders: {
        [environment.monitoringApiKeyHeader]: key,
      },
    }),
  );
};
