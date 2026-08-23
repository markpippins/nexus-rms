export const environment = {
  production: false,
  // Dev default: relative /api routed through proxy.conf.json → nebula-srv:3101.
  // Override at build time with NEBULA_API_URL to point elsewhere.
  apiUrl: (() => {
    try {
      // @ts-ignore
      return (typeof process !== 'undefined' && process.env && process.env['NEBULA_API_URL']) || '/api';
    } catch {
      return '/api';
    }
  })(),
  uiEventBusUrl: (() => {
    try {
      // @ts-ignore
      return (typeof process !== 'undefined' && process.env && process.env['NEBULA_EVENT_BUS_URL']) || 'http://localhost:3200';
    } catch {
      return 'http://localhost:3200';
    }
  })(),
  // Try to auto-detect API key from global scope (polyfill) or default to empty.
  // In a real Angular CLI build, this value would be set here or replaced.
  API_KEY: (() => {
    try {
      // @ts-ignore
      return (typeof process !== 'undefined' && process.env && process.env['API_KEY']) || '';
    } catch {
      return '';
    }
  })()
};
