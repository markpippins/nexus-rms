// LAC contract test (architect thread 83d2fd5c, rule 5) — nebula-ui.
// Single-config-module variant: asserts the unified URL resolution —
// env wins, documented relative default, no build-mode divergence.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const ENV_BACKUP = { ...process.env };

function resetEnv() {
  delete process.env.NEBULA_API_URL;
  delete process.env.NEBULA_EVENT_BUS_URL;
}

describe('LAC contract: nebula-ui environment resolution', () => {
  beforeEach(() => {
    vi.resetModules();
    resetEnv();
    return () => {
      process.env = { ...ENV_BACKUP };
    };
  });

  it('defaults to the relative /api base in EVERY mode (no dev/prod divergence)', async () => {
    const dev = await import('../environments/environment');
    expect(dev.environment.apiUrl).toBe('/api');
    vi.resetModules();
    const prod = await import('../environments/environment.prod');
    expect(prod.environment.apiUrl).toBe('/api');
  });

  it('honors NEBULA_API_URL override', async () => {
    process.env.NEBULA_API_URL = 'http://nebula-srv.example:3101/api';
    const mod = await import('../environments/environment');
    expect(mod.environment.apiUrl).toBe('http://nebula-srv.example:3101/api');
  });

  it('event bus target is env-overridable with a documented default', async () => {
    const mod = await import('../environments/environment');
    expect(mod.environment.uiEventBusUrl).toBe('http://localhost:3200');
    vi.resetModules();
    process.env.NEBULA_EVENT_BUS_URL = 'http://bus.internal:3200';
    const mod2 = await import('../environments/environment');
    expect(mod2.environment.uiEventBusUrl).toBe('http://bus.internal:3200');
  });
});
