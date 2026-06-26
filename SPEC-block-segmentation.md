# Nebula Block Segmentation — Specification

> **Source:** Harvest `5cf9d5c2` — "Nebula Block Segmentation"
> **Date:** 2026-06-26
> **Status:** Proposed

---

## 1. Overview

Nebula Block Segmentation enables Engineers to interactively mark ranges of
blocks within harvested conversation transcripts, suppressing irrelevant blocks
from blueprint (BP) projections. It layers user intent on top of automated
harvest output without deleting data — overrides are append-only and revertible.

The system operates across two durability tiers:
- **Postgres** — durable, bitemporal append-only tables
- **Redis** — volatile, recomputable session-memory layer

---

## 2. Functional Requirements

### 2.1 Block-Level Interaction

- **FR-01:** Every block in the transcript view is rendered as a `BlockViewModel`.
- **FR-02:** Each block exposes a **START toggle** and an **END toggle**.
- **FR-03:** Clicking START on a block sets it as the segment start. Clicking START again resets.
- **FR-04:** Clicking END on a block sets it as the segment end. A segment is formed when both START and END are set.
- **FR-05:** Clicking CONFIRM commits the segment to durable storage.
- **FR-06:** Blocks can be suppressed from BP projections via `BLOCK_SUPPRESS_BP` / `BLOCK_UNSUPPRESS_BP` events.
- **FR-07:** The UI **never deletes** data. Suppression maps to `projection_overrides` with `override_type = EXCLUDE`.

### 2.2 Segment State Machine

```
IDLE
  ↓ START clicked on block
START_SELECTED
  ↓ END clicked on block
SEGMENT_READY
  ↓ CONFIRM
SEGMENT_COMMITTED
```

### 2.3 Visual States

| State | Appearance |
|---|---|
| Normal | Neutral |
| In segment | Highlighted band (left rail bracket or background band) |
| BP suppressed | Faded / greyed |
| Changed since last snapshot | Subtle border indicator |

### 2.4 Segment Rendering

- Segments drawn as **left rail bracket** OR **background band**
- Optional **label header** (editable)
- **Collapsible** in BP view
- **Not draggable** initially (constraint for UI stability)

### 2.5 Incremental Harvest

- New harvest snapshots are diffed against the previous snapshot
- Blocks with changed `content_hash` invalidate stale projections
- BP projection is rebuilt from active blocks (minus suppressed)

---

## 3. Data Model — Postgres (Durable)

All tables follow the existing SCD Type 4 bitemporal pattern: `_history` base
table + active-row view + INSTEAD OF triggers for INSERT/UPDATE/DELETE.

### 3.1 `conversation_snapshots`

Immutable point-in-time captures of a conversation.

| Column | Type | Notes |
|---|---|---|
| `snapshot_pk` | BIGSERIAL | Surrogate primary key |
| `snapshot_id` | UUID | Business key |
| `conversation_id` | UUID | Groups snapshots of same conversation |
| `snapshot_index` | INTEGER | Ordinal within conversation |
| `source_hash` | TEXT | Content hash of source file |
| `capture_mode` | TEXT | `AFTER_ACTION` \| `INCREMENTAL` |
| `block_count` | INTEGER | Total blocks in snapshot |
| `created_by` | TEXT | `USER` \| `SYSTEM` \| `IMPORTER` |
| `created_at` | TIMESTAMPTZ | Transaction time |
| `as_of_dt` | TIMESTAMPTZ | Business valid-from (bitemporal) |
| `expiration_dt` | TIMESTAMPTZ | Business valid-until (sentinel = `9999-12-31`) |

### 3.2 `conversation_blocks`

Every block as an individually addressable row.

| Column | Type | Notes |
|---|---|---|
| `block_pk` | BIGSERIAL | Surrogate primary key |
| `block_id` | UUID | Business key |
| `conversation_id` | UUID | Parent conversation |
| `snapshot_id` | UUID | Owning snapshot |
| `block_index` | INTEGER | Position within snapshot |
| `parent_turn_id` | TEXT | Turn heading (nullable) |
| `parent_block_id` | UUID | Parent block for nested content (nullable) |
| `block_type` | TEXT | `paragraph` \| `code` \| `list` \| `emphasis` \| `quote` \| `heading` \| `diagram` \| `separator` |
| `content_md` | TEXT | Markdown content |
| `content_hash` | TEXT | Deterministic hash for diffing |
| `dom_path` | TEXT | Structural path (nullable) |
| `dom_fingerprint` | TEXT | Structural fingerprint (nullable) |
| `first_line_no` | INTEGER | Source line range start (nullable) |
| `last_line_no` | INTEGER | Source line range end (nullable) |
| `created_at` | TIMESTAMPTZ | Transaction time |
| `as_of_dt` | TIMESTAMPTZ | Bitemporal valid-from |
| `expiration_dt` | TIMESTAMPTZ | Bitemporal valid-until |

**Partial indexes:**
```sql
CREATE INDEX idx_blocks_active_snapshot
  ON conversation_blocks (snapshot_id, block_index)
  WHERE expiration_dt = '9999-12-31 23:59:59+00';

CREATE INDEX idx_blocks_content_hash
  ON conversation_blocks (snapshot_id, content_hash)
  WHERE expiration_dt = '9999-12-31 23:59:59+00';
```

### 3.3 `segments`

User-defined block ranges with classification and lifecycle state.

| Column | Type | Notes |
|---|---|---|
| `segment_pk` | BIGSERIAL | Surrogate primary key |
| `segment_id` | UUID | Business key |
| `conversation_id` | UUID | Parent conversation |
| `snapshot_id` | UUID | Owning snapshot |
| `start_block_id` | UUID | First block in segment |
| `end_block_id` | UUID | Last block in segment |
| `start_block_index` | INTEGER | Ordinal of start block |
| `end_block_index` | INTEGER | Ordinal of end block |
| `segment_type` | TEXT | `architecture` \| `design_discussion` \| `war_story` \| `ir_spec` \| `decision` \| etc. (nullable) |
| `state` | TEXT | `PROPOSED` \| `CONFIRMED` \| `SUPERSEDED` |
| `source` | TEXT | `USER` \| `BP` \| `HARVEST` |
| `title` | TEXT | Editable label (nullable) |
| `notes_md` | TEXT | Freeform notes (nullable) |
| `created_by` | TEXT | Actor identifier |
| `created_at` | TIMESTAMPTZ | Transaction time |
| `as_of_dt` | TIMESTAMPTZ | Bitemporal valid-from |
| `expiration_dt` | TIMESTAMPTZ | Bitemporal valid-until |

### 3.4 `harvest_references`

Typed, confidence-weighted edges between blocks and segments.

| Column | Type | Notes |
|---|---|---|
| `harvest_reference_pk` | BIGSERIAL | Surrogate primary key |
| `harvest_reference_id` | UUID | Business key |
| `conversation_id` | UUID | Parent conversation |
| `snapshot_id` | UUID | Owning snapshot |
| `source_block_id` | UUID | Source block (nullable) |
| `source_segment_id` | UUID | Source segment (nullable) |
| `target_block_id` | UUID | Target block (nullable) |
| `target_segment_id` | UUID | Target segment (nullable) |
| `edge_type` | TEXT | `explicit` \| `implicit` \| `conceptual` \| `structural` \| `temporal` |
| `confidence` | NUMERIC(5,4) | 0.0000 – 1.0000 |
| `state` | TEXT | `CANDIDATE` \| `VALIDATED` \| `REJECTED` \| `STALE` |
| `source` | TEXT | `HARVEST` \| `BP` \| `USER` |
| `reason` | TEXT | Human-readable justification (nullable) |
| `evidence_json` | JSONB | Supporting evidence (nullable) |
| `provenance_json` | JSONB | Provenance chain (nullable) |
| `created_by` | TEXT | Actor identifier |
| `created_at` | TIMESTAMPTZ | Transaction time |
| `as_of_dt` | TIMESTAMPTZ | Bitemporal valid-from |
| `expiration_dt` | TIMESTAMPTZ | Bitemporal valid-until |

### 3.5 `projection_overrides`

Instructions controlling block/segment visibility in downstream projections.

| Column | Type | Notes |
|---|---|---|
| `projection_override_pk` | BIGSERIAL | Surrogate primary key |
| `projection_override_id` | UUID | Business key |
| `conversation_id` | UUID | Parent conversation |
| `snapshot_id` | UUID | Owning snapshot |
| `target_type` | TEXT | `BLOCK` \| `SEGMENT` \| `REFERENCE` |
| `target_id` | UUID | ID of the target entity |
| `projection_target` | TEXT | `BP` \| `PLANNER` \| `REFLECTION` \| `ALL` |
| `override_type` | TEXT | `EXCLUDE` \| `DEPRIORITIZE` \| `FORCE_INCLUDE` |
| `reason_code` | TEXT | `DIGRESSION` \| `STRAY_COMMENT` \| `USER_OVERRIDE` \| etc. |
| `notes_md` | TEXT | Freeform notes (nullable) |
| `source` | TEXT | `USER` \| `BP` |
| `created_by` | TEXT | Actor identifier |
| `created_at` | TIMESTAMPTZ | Transaction time |
| `as_of_dt` | TIMESTAMPTZ | Bitemporal valid-from |
| `expiration_dt` | TIMESTAMPTZ | Bitemporal valid-until |

---

## 4. Data Model — Redis (Volatile / Session Memory)

| Key Pattern | Content | Notes |
|---|---|---|
| `nebula:session:{conversation_id}` | `{ conversation_id, active_snapshot_id, mode, ... }` | Current session context |
| `nebula:snapshot:{snapshot_id}:block:{block_id}` | Block metadata hash | Fast block lookup |
| `nebula:snapshot:{snapshot_id}:segment_candidates` | Hash of `{candidate_id → JSON}` | Pending segment candidates |
| `nebula:graph:{snapshot_id}:out:{node_id}` | SET of outgoing edge IDs | Forward adjacency |
| `nebula:graph:{snapshot_id}:in:{node_id}` | SET of incoming edge IDs | Reverse adjacency |
| `nebula:snapshot:{snapshot_id}:bp_projection` | `{ visible_node_ids, visible_edge_ids, version }` | Cached BP projection |

All Redis keys are **recomputable** from Postgres — Redis is a performance
cache, not a source of truth.

---

## 5. UI Data Model — `BlockViewModel`

```typescript
type BlockViewModel = {
  blockId: string;
  index: number;
  type: "code" | "list" | "paragraph" | "emphasis" | "quote";
  content: string;
  // UI state
  isInSegment: boolean;
  segmentStart: boolean;
  segmentEnd: boolean;
  bpVisible: boolean;
  suppressed: boolean;
};
```

## 6. UI Events

```typescript
type NebulaUIEvent =
  | { type: "BLOCK_SEGMENT_START"; blockId: string }
  | { type: "BLOCK_SEGMENT_END"; blockId: string }
  | { type: "SEGMENT_COMMIT"; startBlockId: string; endBlockId: string }
  | { type: "BLOCK_SUPPRESS_BP"; blockId: string }
  | { type: "BLOCK_UNSUPPRESS_BP"; blockId: string };
```

Events are dispatched from the transcript viewer and handled by a service layer
that persists to Redis (optimistic) → Postgres (durable).

---

## 7. API Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/conversations/:id/snapshots` | List snapshots for a conversation |
| `GET` | `/api/snapshots/:id/blocks` | List blocks in a snapshot |
| `GET` | `/api/snapshots/:id/blocks?diffFrom=:prevSnapshotId` | Diff blocks against previous snapshot |
| `POST` | `/api/snapshots` | Create a new snapshot (harvest pipeline) |
| `POST` | `/api/segments` | Commit a user-defined segment |
| `PATCH` | `/api/segments/:id` | Update segment (type, title, notes) |
| `DELETE` | `/api/segments/:id` | Supersede (bitemporal expire) a segment |
| `POST` | `/api/projection-overrides` | Add a suppression/deprioritization |
| `DELETE` | `/api/projection-overrides/:id` | Remove an override |
| `GET` | `/api/snapshots/:id/projection` | Get the BP projection for a snapshot |
| `GET` | `/api/snapshots/:id/references` | Get harvest references for a snapshot |

---

## 8. Non-Functional Requirements

- **Bitemporal:** All Postgres tables use SCD Type 4 (as_of_dt / expiration_dt + views + INSTEAD OF triggers)
- **Append-only:** No destructive UPDATE/DELETE — only bitemporal expiration
- **Redis is recomputable:** All Redis state can be rebuilt from Postgres at any time
- **Optimistic UI:** Segment selection and suppression render immediately; persistence is async
- **Diff-based:** Incremental harvests detect changed blocks via `content_hash`
