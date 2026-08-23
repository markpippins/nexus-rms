export const environment = {
  production: false,
  // LAC single-config resolution (thread 83d2fd5c): ONE url rule for every
  // build mode — NEBULA_API_URL wins when set; otherwise the relative /api
  // base, which works through proxy.conf.json (dev) and same-origin proxies
  // (deployed). No absolute localhost default here: targets come from env.
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
  API_KEY: (() => {
    try {
      // @ts-ignore
      return (typeof process !== 'undefined' && process.env && process.env['API_KEY']) || '';
    } catch {
      return '';
    }
  })()
};
