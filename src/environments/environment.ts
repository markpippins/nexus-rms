
export const environment = {
  production: false,
  apiUrl: '/api',
  uiEventBusUrl: 'http://localhost:3200',
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
