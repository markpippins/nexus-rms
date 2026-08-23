# DRIFT.md — nebula-ui Client vs nebula-srv Mismatches

**Date:** 2026-07-23
**Compared:** `src/services/data.service.ts` ↔ `nexus/typescript/nebula-srv/src/routes.ts` + `index.ts`
**Status:** 0 critical, 2 medium, 22 correct endpoints

---

## Medium

### M1 — Client-Only Endpoints (no backend route found)

These endpoints are called by `data.service.ts` but no matching route was found in `nebula-srv/src/routes.ts`. They may be served by a different backend (e.g., `nebula-mcp`) or may be aspirational:

| Client Method | Endpoint | Purpose | Likely Cause |
|---|---|---|---|
| GET harvest-candidates | `/harvest-candidates` | List harvest candidates | May be served by nebula-mcp |
| GET harvest-candidate | `/harvest-candidates/:id` | Get single candidate | May be served by nebula-mcp |
| POST promote candidate | `/harvest-candidates/:id/promote-to-requirement` | Promote candidate | May be served by conduit-mcp |
| GET candidates by system | `/systems/:id/harvest-candidates` | Hierarchy-scoped | May be served by nebula-mcp |
| GET candidates by subsystem | `/subsystems/:id/harvest-candidates` | Hierarchy-scoped | May be served by nebula-mcp |
| GET candidates by feature | `/features/:id/harvest-candidates` | Hierarchy-scoped | May be served by nebula-mcp |
| GET snapshots | `/conversations/:id/snapshots` | List snapshots | Block segmentation — possibly served by nebula-srv at different URL |
| GET snapshot blocks | `/snapshots/:id/blocks` | Get blocks | Block segmentation |
| POST create snapshot | `/snapshots` | Create snapshot | Block segmentation |
| GET projection | `/snapshots/:id/projection` | Get BP projection | Block segmentation |
| GET references | `/snapshots/:id/references` | Get references | Block segmentation |
| POST/segment CRUD | `/segments` and `/segments/:id` | User-defined segments | Block segmentation |
| POST/POST/DELETE projection overrides | `/projection-overrides` and `/:id` | Projection overrides | Block segmentation |

**Impact:** These endpoints may work against `nebula-mcp` or `conduit-mcp` instead of `nebula-srv`. If the client's base URL points at `nebula-srv`, these calls silently return 404s (data.service.ts may swallow errors). Verify the client's API base URL configuration.

**Remediation:** Audit which backend serves each endpoint group. Map block-segmentation endpoints to `nebula-mcp` if that's where they live. Document the backend split.

---

### M2 — Backend-Only Endpoints (not called by client)

These routes exist in `nebula-srv` but are **not consumed** by `data.service.ts`:

| Backend Route | Method | Purpose | Feature Gap |
|---|---|---|---|
| `/systems/:id/docs` | GET | System documentation | No docs viewer |
| `/systems/:id/implementation-plans` | GET | System plans | No plan viewer |
| `/subsystems/:id/docs` | GET | Subsystem documentation | No docs viewer |
| `/subsystems/:id/implementation-plans` | GET | Subsystem plans | No plan viewer |
| `/features/:id/implementation-plans` | GET | Feature plans | No plan viewer |
| `/requirements/:id/move` | POST | Reorder requirement | No reorder UI |
| `/requirements/:id/compile` | POST | Compile to plan | No compile trigger |
| `/docs` | GET | Documentation listing | No docs UI |
| `/plans` | GET, POST | Plan CRUD | No plan management |
| `/plans/:id` | GET | Single plan detail | No plan detail view |
| `/implementation-plans/statuses` | GET | Plan statuses | No status filter |
| `/audit` | GET | Audit trail | No audit viewer |
| `/audit/graph` | GET | Audit graph | No audit graph |
| `/audit/:id` | GET | Single audit entry | No audit detail |
| `/audit/sync` | POST | Sync audit | No sync trigger |
| `/audit/:id/regenerate` | POST | Regenerate projection | No regenerate trigger |
| `/workspaces/:id` | DELETE | Delete workspace | No delete workspace UI |

**Impact:** Feature gaps only — no data corruption. Users cannot browse plans, view audit trails, or manage documentation from nebula-ui.

---

## Correct Endpoints (no changes needed)

| Client Endpoint | Backend Route | Verdict |
|---|---|---|
| `GET /systems` | `GET /systems` | ✅ |
| `POST /systems` | `POST /systems` | ✅ |
| `PATCH /systems/:id` | `PATCH /systems/:id` | ✅ |
| `DELETE /systems/:id` | `DELETE /systems/:id` | ✅ |
| `POST /seed` | `POST /seed` | ✅ |
| `GET /systems/:systemId/info` | `GET /systems/:id/info` | ✅ |
| `PUT /systems/:systemId/info/:tabId` | `PUT /systems/:id/info/:tabId` | ✅ |
| `DELETE /systems/:systemId/info/:tabId` | `DELETE /systems/:id/info/:tabId` | ✅ |
| `POST /systems/:systemId/folders` | `POST /systems/:id/folders` | ✅ |
| `DELETE /systems/:systemId/folders/:folderId` | `DELETE /systems/:systemId/folders/:folderId` | ✅ |
| `POST /subsystems` | `POST /subsystems` | ✅ |
| `PATCH /subsystems/:id` | `PATCH /subsystems/:id` | ✅ |
| `POST /subsystems/move` | `POST /subsystems/move` | ✅ |
| `POST /features` | `POST /features` | ✅ |
| `PATCH /features/:id` | `PATCH /features/:id` | ✅ |
| `POST /features/move` | `POST /features/move` | ✅ |
| `POST /systems/demote/:id` | `POST /systems/demote/:id` | ✅ |
| `GET /requirements` | `GET /requirements` | ✅ |
| `POST /requirements` | `POST /requirements` | ✅ |
| `PATCH /requirements/:id` | `PATCH /requirements/:id` | ✅ |
| `PATCH /requirements/batch` | `PATCH /requirements/batch` | ✅ |
| `DELETE /requirements/:id` | `DELETE /requirements/:id` | ✅ |
| `GET /requirements/:id/children` | `GET /requirements/:id/children` | ✅ |
| `GET /requirements/:id/dependencies` | `GET /requirements/:id/dependencies` | ✅ |
| `POST /requirements/:id/dependencies` | `POST /requirements/:id/dependencies` | ✅ |
| `DELETE /requirements/:id/dependencies/:depId` | `DELETE /requirements/:id/dependencies/:depId` | ✅ |
| `GET /sessions` | `GET /sessions` | ✅ |
| `POST /sessions` | `POST /sessions` | ✅ |
| `PATCH /sessions/:id` | `PATCH /sessions/:id` | ✅ |
| `DELETE /sessions/:id` | `DELETE /sessions/:id` | ✅ |
| `GET /workspaces` | `GET /workspaces` | ✅ |
| `GET /preferences` | `GET /preferences` | ✅ |
| `PUT /preferences/:key` | `PUT /preferences/:key` | ✅ |
| `POST /import` | `POST /import` | ✅ |
| `GET /harvests` | `GET /harvests` | ✅ |

---

## Summary

| Priority | Area | Count | Actions |
|---|---|---|---|
| **Medium** | Client-only endpoints | ~17 | Audit backend routing — may be served by nebula-mcp |
| **Medium** | Backend-only routes | ~17 | UI feature gaps — plans, audit, docs not exposed |
| **None** | Matched endpoints | ~33 | No changes needed |
