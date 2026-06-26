# Nexus RMS — PostgreSQL Conversion Plan

**Status:** Refined — ready for implementation  
**Date:** June 11, 2026  
**Context:** Nexus RMS currently uses Angular signals + localStorage for persistence. The Convex schema and API files exist but are **not connected** — the `data.service.ts` has no Convex client calls. This plan defines the migration to PostgreSQL as the backend.

**Resolved Decisions:**
- API server lives at `/home/codex/dev/nexus/typescript/nebula-srv` (separate process)
- Database name: `nebula`, same PostgreSQL instance as conduit-mcp
- Real-time updates via SSE (other clients will consume this endpoint)
- Optimistic updates: mutate signals immediately, rollback on HTTP error
- Authentication: deferred until future version
- `convex/` directory: deleted entirely

---

## 1. Current Architecture

```
┌────────────────────────────────────────┐
│  Angular Frontend (signals + signals)  │
│                                        │
│  data.service.ts                       │
│  ├─ systems: Signal<System[]>          │
│  ├─ requirements: Signal<Requirement[]>│
│  ├─ workSessions: Signal<WorkSession[]>│
│  └─ effect() → localStorage auto-save  │
│                                        │
│  ai.service.ts                         │
│  └─ @google/genai (Gemini)             │
│                                        │
│  convex/schema.ts  (UNUSED)            │
│  convex/board.ts   (UNUSED)            │
└────────────────────────────────────────┘
```

**Key facts:**
- All CRUD operations mutate Angular signals in-memory
- An `effect()` serializes all three collections to `localStorage` on every change
- `loadFromStorage()` hydrates state on app init
- Import/Export uses JSON file downloads/uploads
- The AI service calls Gemini directly (no backend involved)
- `crypto.randomUUID()` generates all IDs client-side
- `convex` is listed in `package.json` but not imported in any source file

**What this means for the conversion:** There's no Convex API to untangle — the conversion is from localStorage to PostgreSQL, plus adding an API layer that doesn't currently exist.

---

## 2. Target Architecture

```
┌──────────────────────┐     ┌──────────────────────┐     ┌────────────┐
│  Angular Frontend    │────▶│  Express API Server   │────▶│ PostgreSQL │
│  (signals + http)    │◀────│  nebula-srv           │◀────│  nebula    │
│                      │◀─SSE│  /home/codex/dev/nexus│     │            │
│  data.service.ts     │     │  /typescript/nebula-  │     │  systems   │
│  ai.service.ts       │     │  srv/                 │     │  subsys    │
│  components/*        │     │                       │     │  features  │
│  models/*            │     │  POST /systems        │     │  reqs      │
└──────────────────────┘     │  GET  /systems        │     │  sessions  │
                             │  POST /reqs           │     └────────────┘
                             │  PATCH /reqs/:id      │
                             │  GET  /sse/events     │
                             └──────────────────────┘
```

- **Database:** Same PostgreSQL instance as conduit-mcp, database name `nebula`
- **API Server:** Separate process at `/home/codex/dev/nexus/typescript/nebula-srv`
- **Real-time updates:** SSE endpoint (`GET /sse/events`) for other clients consuming this data

---

## 3. PostgreSQL Schema

The Convex `schema.ts` defines 5 tables. PostgreSQL equivalents:

```sql
CREATE TABLE systems (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    readme      TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE subsystems (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    system_id   UUID NOT NULL REFERENCES systems(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    readme      TEXT,
    color       TEXT NOT NULL DEFAULT '#3B82F6',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_subsystems_system ON subsystems(system_id);

CREATE TABLE features (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subsystem_id  UUID NOT NULL REFERENCES subsystems(id) ON DELETE CASCADE,
    name          TEXT NOT NULL,
    description   TEXT NOT NULL DEFAULT '',
    readme        TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_features_subsystem ON features(subsystem_id);

CREATE TABLE requirements (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    system_id       UUID NOT NULL REFERENCES systems(id) ON DELETE CASCADE,
    subsystem_id    UUID NOT NULL REFERENCES subsystems(id) ON DELETE CASCADE,
    feature_id      UUID REFERENCES features(id) ON DELETE CASCADE,
    title           TEXT NOT NULL,
    description     TEXT NOT NULL DEFAULT '',
    status          TEXT NOT NULL DEFAULT 'Backlog'
                    CHECK(status IN ('Backlog', 'ToDo', 'InProgress', 'Done')),
    priority        TEXT NOT NULL DEFAULT 'Medium'
                    CHECK(priority IN ('Low', 'Medium', 'High')),
    start_date      TEXT,
    completion_date TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_requirements_system ON requirements(system_id);
CREATE INDEX idx_requirements_subsystem ON requirements(subsystem_id);
CREATE INDEX idx_requirements_feature ON requirements(feature_id);
CREATE INDEX idx_requirements_status ON requirements(status);

-- System folders (currently nested in System object)
CREATE TABLE system_folders (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    system_id   UUID NOT NULL REFERENCES systems(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    category    TEXT NOT NULL CHECK(category IN ('UI', 'Service', 'Library')),
    note        TEXT NOT NULL DEFAULT ''
);
CREATE INDEX idx_folders_system ON system_folders(system_id);

-- Work sessions (AI history)
CREATE TABLE work_sessions (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    parent_id   TEXT NOT NULL,
    parent_type TEXT NOT NULL CHECK(parent_type IN ('System', 'Subsystem', 'Feature', 'Requirement')),
    parent_name TEXT NOT NULL DEFAULT '',
    context     TEXT NOT NULL DEFAULT '',
    platform    TEXT NOT NULL DEFAULT '',
    model       TEXT NOT NULL DEFAULT '',
    outcome     TEXT,
    status      TEXT NOT NULL DEFAULT 'Pending'
                CHECK(status IN ('Pending', 'Completed')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Auto-update updated_at trigger ─────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_requirements_updated_at
    BEFORE UPDATE ON requirements
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_work_sessions_updated_at
    BEFORE UPDATE ON work_sessions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
```

### Schema Design Decisions

| Decision | Rationale |
|----------|-----------|
| `UUID` PKs (not SERIAL) | Matches current `crypto.randomUUID()` pattern; no migration of ID types needed |
| `ON DELETE CASCADE` | Subsystems deleted when system deleted; features when subsystem deleted; requirements when parent system deleted |
| `feature_id ON DELETE CASCADE` | Matches current `deleteFeature()` behavior which cascade-deletes requirements for the deleted feature |
| `TEXT` + `CHECK` for enums | Same approach as conduit-mcp spec — easier to extend, matches current string-based types |
| `system_folders` as separate table | Currently nested in System object; separating avoids JSONB complexity and allows proper indexing |
| `work_sessions.parent_id` as TEXT | References can point to system/subsystem/feature/requirement — no single FK column possible without polymorphic associations. TEXT avoids this complexity. |
| No `metadata` JSONB column | Defer until a concrete use case exists (same principle as conduit spec) |

### Timestamp Type Mismatch

The TypeScript interfaces use `number` (epoch milliseconds) for `createdAt`/`updatedAt`. PostgreSQL uses `TIMESTAMPTZ`. The API layer must convert:
- **Response (DB → client):** Convert `TIMESTAMPTZ` to epoch ms: `new Date(row.created_at).getTime()`
- **Request (client → DB):** Convert epoch ms to `TIMESTAMPTZ`: `new Date(epochMs).toISOString()`
- Alternatively, return ISO strings from the API and update the TypeScript types to `string`, which is simpler and avoids precision loss.

---

## 4. API Layer Design

The app needs a REST API. Two viable approaches:

### Option A: Lightweight Express Backend (Recommended)

Add a small Express/Fastify server alongside the Angular app. Keeps things simple.

```typescript
// server/index.ts  (new file)
import express from 'express';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const app = express();
app.use(express.json());

// Systems
app.get('/api/systems', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM systems ORDER BY name');
  // Also fetch subsystems, features, folders for each system
  // Assemble into nested hierarchy matching current System[] shape
  res.json(rows);
});

app.post('/api/systems', async (req, res) => {
  const { name, description } = req.body;
  const { rows: [system] } = await pool.query(
    'INSERT INTO systems (name, description) VALUES ($1, $2) RETURNING *',
    [name, description]
  );
  res.json(system);
});

// ... similar CRUD for subsystems, features, requirements, folders, work_sessions
```

**API shape:** The frontend currently works with nested objects (`System.subsystems[].features[]`). The API should return the same nested shape to minimize frontend changes:

```json
GET /api/systems
[
  {
    "id": "uuid",
    "name": "E-Commerce Platform",
    "description": "...",
    "readme": "...",
    "folders": [{ "id": "uuid", "name": "webapp", "category": "UI", "note": "..." }],
    "subsystems": [{
      "id": "uuid",
      "name": "Checkout",
      "color": "#10B981",
      "features": [{ "id": "uuid", "name": "Payment Gateway", ... }]
    }]
  }
]
```

### Option B: PostgreSQL Direct via pg + Angular Proxy (Simpler)

Use `pg` directly in an Express proxy, or use PostgREST for auto-generated REST API. Less code to write, less control.

### Option C: Keep Signals + Add HTTP Sync

The least disruptive approach: keep the signals-based architecture but replace the localStorage `effect()` with HTTP sync calls.

**Verdict:** Option A is the right balance. It's straightforward, matches the existing data shapes, and can be colocated in the project.

---

## 5. Data Service Migration

### Current Pattern → New Pattern

| Current (localStorage) | New (PostgreSQL via API) |
|------------------------|--------------------------|
| `systems.set(data)` | `this.http.get<System[]>('/api/systems').subscribe(data => this.systems.set(data))` |
| `systems.update(s => [...s, newSystem])` | `this.http.post<System>('/api/systems', body).subscribe(s => this.systems.update(sys => [...sys, s]))` |
| `effect()` auto-saves to localStorage | Remove the auto-save effect — state is persisted server-side |
| `loadFromStorage()` on init | `fetchSystems()` HTTP call on init |
| `importDatabase(file)` / `exportDatabase()` | Server-side import/export endpoints |

### Migration Strategy

1. **Add `apiUrl` config** to `environment.ts` pointing to the API server
2. **Rewrite `DataService` methods** to call HTTP endpoints instead of mutating signals directly
3. **Keep the signals** — they remain the reactive UI layer. Mutations go `signal → HTTP → response → signal`
4. **Optimistic updates:** Mutate signals immediately on mutation calls, then rollback on HTTP error. This keeps UI responsiveness while the server processes the write.
5. **Remove `localStorage` auto-save** — persistence is server-side
6. **Add loading/error states** — `systemsLoading`, `systemsError` signals for UI feedback

### Example: `addSystem()` Before/After (with Optimistic Update)

```typescript
// BEFORE (localStorage)
addSystem(name: string, description: string) {
  const newSystem: System = {
    id: crypto.randomUUID(),
    name, description,
    folders: [],
    subsystems: []
  };
  this.systems.update(s => [...s, newSystem]);
}

// AFTER (PostgreSQL — optimistic update)
addSystem(name: string, description: string) {
  const tempId = crypto.randomUUID();
  const previous = this.systems();
  // Optimistically add to UI immediately
  this.systems.update(s => [...s, {
    id: tempId, name, description,
    folders: [], subsystems: []
  }]);

  this.http.post<System>(`${this.apiUrl}/systems`, { name, description })
    .subscribe({
      next: (newSystem) => {
        // Replace temp entry with real server response
        this.systems.update(s => s.map(sys =>
          sys.id === tempId ? newSystem : sys
        ));
      },
      error: () => {
        // Rollback on failure
        this.systems.set(previous);
      }
    });
}
```

---

## 6. Data Seeding & Migration

### Current Seed Data

`data.service.ts` has a `seedData()` method that creates an example system with one subsystem and one feature. After conversion, this should seed PostgreSQL instead.

### Existing localStorage Data

Users with existing data in localStorage need a migration path:

1. On first load after conversion, check localStorage for existing data
2. If found, offer to import it via `POST /api/import` (bulk insert endpoint)
3. After successful import, clear localStorage keys (`nebula_systems`, `nebula_requirements`, `nebula_sessions`)
4. If no localStorage data, seed the default example data into PostgreSQL

### Bulk Import Endpoint

```typescript
POST /api/import
{
  "systems": [...],
  "requirements": [...],
  "workSessions": [...]
}
```

This endpoint inserts all data in a transaction, preserving the existing UUIDs and relationships.

---

## 7. What Gets Removed

| Artifact | Disposition |
|----------|-------------|
| `convex/` directory | Delete — Convex schema and API files are unused |
| `convex` from `package.json` dependencies | Remove |
| `localStorage` auto-save `effect()` | Replace with HTTP sync |
| `loadFromStorage()` | Replace with HTTP `fetchSystems()` |
| `seedData()` client-side seeding | Move to server-side seed endpoint |
| `importDatabase()` / `exportDatabase()` JSON file | Keep as server-side import/export; or deprecate in favor of DB-native backup |
| `crypto.randomUUID()` ID generation | Keep on client for optimistic UI, or move to `DEFAULT gen_random_uuid()` server-side |

---

## 8. What Stays Unchanged

| Component | Reason |
|-----------|--------|
| `ai.service.ts` (Gemini) | Calls Gemini directly — no backend needed. Unchanged. |
| Angular components (kanban, board, table, hierarchy-nav, work-session) | They consume `DataService` signals. If the signal shape stays the same, components need zero changes. |
| `data.models.ts` | Types/interfaces remain the same. PostgreSQL schema mirrors them. |
| Tailwind CSS styling | Unchanged |
| Angular 21 + signals architecture | Unchanged. Only the persistence layer changes. |
| Dark mode toggle | Unchanged |
| Kanban drag-and-drop | Unchanged |

---

## 9. Implementation Phases

### Phase 1: PostgreSQL Schema & Seed

- Create the PostgreSQL database and run the schema DDL (Section 3)
- Create a seed script that inserts the default example data
- Verify schema matches the TypeScript interfaces in `data.models.ts`

### Phase 2: API Server (`nebula-srv`)

- Create Express server at `/home/codex/dev/nexus/typescript/nebula-srv` (separate project from the Angular app)
- Configure connection pooling with `pg.Pool` pointing to the `nebula` database
- Implement CRUD endpoints for all 6 tables
- Endpoints return nested hierarchy matching the current `System[]` shape
- **SSE endpoint** (`GET /sse/events`): Emit events on every create/update/delete. Other clients will consume this for real-time updates.
- Add bulk import endpoint for localStorage migration
- Add seed endpoint for default example data
- Add transactional endpoints for complex operations (`moveFeature`, `moveSubsystem`, `demoteSystem`)
- **Dev workflow:** Update `start.sh` to run both `ng serve` and the Express server concurrently. Add Angular proxy config (`proxy.conf.json`) so `/api` and `/sse` requests from the dev server reach the Express port.

### Phase 3: Data Service Rewrite

- Add `apiUrl` to `environment.ts`
- Rewrite `DataService` methods to call HTTP endpoints
- Remove localStorage auto-save `effect()`
- Replace `loadFromStorage()` with `fetchSystems()` HTTP call on init
- Add localStorage migration check on first load:
  1. Check if `localStorage.getItem('nebula_systems')` returns data
  2. If yes, `POST /api/import` with the serialized data
  3. On success, clear the localStorage keys and re-fetch from API
  4. If no localStorage data, seed default data via `POST /api/seed`
- Add loading/error signals for UI feedback
- **Complex operations** (`moveFeature`, `moveSubsystem`, `demoteSystem`) need transactional server-side endpoints that atomically update all affected rows. The current client-side logic (find-and-remove, then add) is not safe with a real database.

### Phase 3.1: Color Deduplication Fix
- `getUniqueColor()` currently deduplicates against in-memory state. With PostgreSQL, concurrent subsystem creation can produce duplicate colors. Move color assignment to the server: `POST /api/subsystems` selects the first unused color from the palette via a query, or accepts occasional duplicates and deduplicates in the UI only.

### Phase 4: Cleanup

- Remove `convex/` directory
- Remove `convex` from `package.json`
- Remove unused localStorage helpers
- Test all CRUD operations end-to-end
- Verify kanban board, table view, board view, hierarchy nav all work

### Phase 5: Production Hardening

- Authentication: **deferred** until future version (currently single-user)
- Add connection pool tuning for the `nebula` database on the shared PostgreSQL instance
- Add database backups
- Environment-specific `DATABASE_URL` configuration pointing to database `nebula`

---

## 10. Open Questions for Refinement

1. **API server hosting:** ✅ Resolved — separate process at `/home/codex/dev/nexus/typescript/nebula-srv`
2. **Authentication:** ✅ Resolved — deferred until future version
3. **Real-time updates:** ✅ Resolved — include SSE endpoint for other clients
4. **Optimistic updates:** ✅ Resolved — mutate signals immediately, rollback on error
5. **Database hosting:** ✅ Resolved — same PostgreSQL instance, database name `nebula`
6. **Convex `_generated/`:** ✅ Resolved — delete entirely
