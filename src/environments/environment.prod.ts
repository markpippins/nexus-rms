
export const environment = {
  production: true,
  apiUrl: 'http://localhost:3101/api',
  uiEventBusUrl: 'http://localhost:3200',
  API_KEY: (() => {
    try {
      // @ts-ignore
      return (typeof process !== 'undefined' && process.env && process.env['API_KEY']) || '';
    } catch {
      return '';
    }
  })()
};
