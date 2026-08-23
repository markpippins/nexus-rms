export const environment = {
  production: true,
  // Canonical live target: nebula-srv:3101. Override at build time with
  // NEBULA_API_URL (e.g. a remote host) without source edits.
  apiUrl: (() => {
    try {
      // @ts-ignore
      return (typeof process !== 'undefined' && process.env && process.env['NEBULA_API_URL']) || 'http://localhost:3101/api';
    } catch {
      return 'http://localhost:3101/api';
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
  API_KEY: (() => {
    try {
      // @ts-ignore
      return (typeof process !== 'undefined' && process.env && process.env['API_KEY']) || '';
    } catch {
      return '';
    }
  })()
};
