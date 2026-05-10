export const environment = {
  production: false,
  /** Dev: prefix mapped via proxy.conf.json → backend host */
  monitoringApiBaseUrl: '/api',
  monitoringApiKeyHeader: 'X-API-Key',
  /** Replace locally; avoid committing real secrets */
  monitoringApiKey: 'your-secret-api-key',
};
