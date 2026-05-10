export const environment = {
  production: true,
  /**
   * Production: use same-origin gateway path or absolute API URL if CORS allows.
   * Example direct host (may fail in browser without CORS): 'http://217.168.244.96:8000'
   */
  monitoringApiBaseUrl: '/api',
  monitoringApiKeyHeader: 'X-API-Key',
  monitoringApiKey: 'your-secret-api-key',
};
