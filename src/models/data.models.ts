
export type Status = 'Backlog' | 'ToDo' | 'InProgress' | 'Active' | 'Blocked' | 'Done' | 'Cancelled' | 'Accepted';

export type FolderCategory = 'UI' | 'Service' | 'Library' | 'Documentation' | 'Config' | 'data' | 'api';

export interface SystemFolder {
  id: string;
  name: string;
  category: FolderCategory;
  note: string;
}

export interface System {
  id: string;
  name: string;
  description: string;
  readme?: string; // Context/Documentation
  architecture?: string; // Architecture documentation
  subsystems: Subsystem[];
  folders: SystemFolder[];
}

export interface Subsystem {
  id: string;
  name: string;
  description: string;
  readme?: string; // Context/Documentation
  color?: string; // UI Color identifier
  features: Feature[];
  systemId: string; // Parent reference
}

export interface Feature {
  id: string;
  name: string;
  description: string;
  readme?: string; // Context/Documentation
  subsystemId: string; // Parent reference
}

export type ReqType = 'Epic' | 'Story' | 'Task' | 'Bug';

export interface AcceptanceCriterion {
  criterion: string;
  done: boolean;
}

export interface Requirement {
  id: string;
  title: string;
  description: string;
  status: Status;
  priority: 'Low' | 'Medium' | 'High';
  systemId: string;
  subsystemId: string;
  featureId: string;
  startDate?: string;
  completionDate?: string;
  createdAt: number;
  parentId?: string | null;
  reqType?: ReqType | null;
  acceptanceCriteria?: AcceptanceCriterion[] | null;
  candidateId?: string | null;
}

export interface WorkSession {
  id: string;
  parentId: string;
  parentType: 'system' | 'subsystem' | 'feature' | 'requirement';
  parentName: string; // Snapshot for display
  context: string;
  platform: string;
  model: string;
  outcome?: string;
  status: 'Pending' | 'Completed';
  createdAt: number;
  updatedAt: number;
}

export interface DocFile {
  filename: string;
  content: string;
}

export interface WorkspaceDoc {
  workspacePath: string;
  subsystemId: string | null;
  files: DocFile[];
}

export interface SystemDocsResponse {
  systemId: string;
  docs: WorkspaceDoc[];
  found: number;
}

export interface SubsystemDocsResponse {
  subsystemId: string;
  docs: { workspacePath: string; files: DocFile[] }[];
  found: number;
}

export interface WorkspaceEntry {
  id: string;
  systemId: string;
  subsystemId: string | null;
  workspacePath: string;
  systemName?: string;
  subsystemName?: string | null;
}

// ── Audit Files ─────────────────────────────────────────────────

export interface AuditTreeNode {
  name: string;
  path: string;       // relative path from audit root
  type: 'file' | 'directory';
  children?: AuditTreeNode[];
  expanded?: boolean;
}

export interface AuditFile {
  id: string;
  filePath: string;   // relative path, e.g. 'ANALYSIS/reports/some-report.md'
  content: string;
  sizeBytes: number;
  updatedAt: number;
}

export interface AuditScanResult {
  files: AuditFile[];
  count: number;
}

// ── Knowledge Graph Types ────────────────────────────────────

export interface KnowledgeEntity {
  id: string;
  section: string;
  entity_id: string;
  name: string;
  entity_type: string;
  status: string;
  description_abbr?: string;
  description?: string;
  properties?: any;
  created_at: string;
  updated_at: string;
}

export interface KnowledgeEdge {
  id: string;
  source_section: string;
  source_id: string;
  relation_type: string;
  target_section: string;
  target_id: string;
  source_name?: string;
  target_name?: string;
  properties?: any;
  created_at?: string;
}

export interface KnowledgeCrossReference {
  id: string;
  map_name: string;
  source_section: string;
  source_id: string;
  target_section: string;
  target_id: string;
  weight: number;
}

export interface KnowledgeViewResponse {
  entities: KnowledgeEntity[];
  edges: KnowledgeEdge[];
  entityCount: number;
  edgeCount: number;
}

export interface AuditGraphResponse {
  entities: KnowledgeEntity[];
  edges: KnowledgeEdge[];
  entityCount: number;
  edgeCount: number;
}

export interface KnowledgeSummary {
  entityCount: number;
  edgeCount: number;
  crossReferenceCount: number;
  bySection: { section: string; count: number }[];
  byRelationType: { relation_type: string; count: number }[];
}

export type GraphSchemaMode = 'knowledge' | 'audit' | 'combined';

// ── Harvest Candidates ───────────────────────────────────────

export interface HarvestCandidate {
  id: string;
  harvest_id: string | null;
  title: string;
  intent_description: string | null;
  status: string;
  tags: string[] | null;
  system_id: string | null;
  subsystem_id: string | null;
  feature_id: string | null;
  harvest_source: string | null;
  valid_from: string;
  valid_until: string;
  created_at: string;
  updated_at: string;
}

export interface SpawnPlanRequest {
  systemId: string;
  subsystemId?: string;
  featureId?: string;
  planRef?: string;
  requirementTitle?: string;
  requirementDescription?: string;
}

export interface SpawnPlanResponse {
  candidate: HarvestCandidate;
  requirement: Requirement;
  crossReference: any | null;
}

// ── Requirement Dependencies ────────────────────────────────

export interface RequirementDependency {
  id: string;
  relType: 'req:blocks' | 'req:depends_on';
  sourceType: string;
  sourceId: string;
  targetType: string;
  targetId: string;
  direction: 'outgoing' | 'incoming';
  otherId: string;
  metadata: any;
  createdAt: number | null;
}

// ── Block Segmentation Types ────────────────────────────────

/** Block view model for the transcript segmentation UI. */
export interface BlockViewModel {
  blockId: string;
  index: number;
  type: string;
  content: string;
  isInSegment: boolean;
  segmentStart: boolean;
  segmentEnd: boolean;
  bpVisible: boolean;
  suppressed: boolean;
}

/** Events dispatched from the block segmentation UI. */
export type NebulaUIEvent =
  | { type: 'BLOCK_SEGMENT_START'; blockId: string }
  | { type: 'BLOCK_SEGMENT_END'; blockId: string }
  | { type: 'SEGMENT_COMMIT'; startBlockId: string; endBlockId: string }
  | { type: 'BLOCK_SUPPRESS_BP'; blockId: string }
  | { type: 'BLOCK_UNSUPPRESS_BP'; blockId: string };

// ── Block Segmentation API Response Types ────────────────────

export interface SnapshotEntry {
  id: string;
  conversation_id: string;
  snapshot_index: number;
  source_hash: string;
  capture_mode: string;
  block_count: number;
  created_by: string;
  created_at: string;
}

export interface BlockEntry {
  id: string;
  conversation_id: string;
  snapshot_id: string;
  block_index: number;
  parent_turn_id: string | null;
  parent_block_id: string | null;
  block_type: string;
  content_md: string;
  content_hash: string;
  dom_path: string | null;
  dom_fingerprint: string | null;
  first_line_no: number | null;
  last_line_no: number | null;
  created_at: string;
}

export interface SegmentEntry {
  id: string;
  conversation_id: string;
  snapshot_id: string;
  start_block_id: string;
  end_block_id: string;
  start_block_index: number;
  end_block_index: number;
  segment_type: string | null;
  state: string;
  source: string;
  title: string | null;
  notes_md: string | null;
  created_by: string;
  created_at: string;
}

export interface HarvestReferenceEntry {
  id: string;
  conversation_id: string;
  snapshot_id: string;
  source_block_id: string | null;
  source_segment_id: string | null;
  target_block_id: string | null;
  target_segment_id: string | null;
  edge_type: string;
  confidence: number;
  state: string;
  source: string;
  reason: string | null;
  evidence_json: any;
  provenance_json: any;
  created_by: string;
  created_at: string;
}

export interface ProjectionOverrideEntry {
  id: string;
  conversation_id: string;
  snapshot_id: string;
  target_type: string;
  target_id: string;
  projection_target: string;
  override_type: string;
  reason_code: string;
  notes_md: string | null;
  source: string;
  created_by: string;
  created_at: string;
}

export interface BlocksResponse {
  blocks: BlockEntry[];
  segments: SegmentEntry[];
  overrides: ProjectionOverrideEntry[];
  diff?: { added: number; modified: number; removed: number; unchanged: number };
}

export interface ProjectionResponse {
  blocks: BlockEntry[];
  segments: SegmentEntry[];
  overrides: ProjectionOverrideEntry[];
}

export interface ReferencesResponse {
  references: HarvestReferenceEntry[];
}

// ── AI Platforms ─────────────────────────────────────────────

export const AI_PLATFORMS: Record<string, string[]> = {
  'Cursor': ['Claude 3.5 Sonnet', 'GPT-4o', 'DeepSeek R1', 'Gemini 1.5 Pro', 'Big Pickle'],
  'Windsurf': ['Cascade (Claude 3.5)', 'Cascade (GPT-4o)'],
  'Trae': ['Claude 3.5 Sonnet', 'GPT-4o'],
  'OpenCode': ['Default Model'],
  'Antigravity': ['Default Model'],
  'Replit': ['Replit Agent', 'Ghostwriter'],
  'Google IDX': ['Gemini 2.0 Flash', 'Gemini 1.5 Pro'],
  'VS Code (Copilot)': ['GPT-4o', 'Claude 3.5 Sonnet'],
  'Web (ChatGPT)': ['GPT-4o', 'o1', 'o3-mini'],
  'Web (Claude)': ['Claude 3.5 Sonnet', 'Claude 3 Opus'],
  'Web (Gemini)': ['Gemini Advanced', 'Gemini 2.5 Flash'],
  'Custom': ['Other']
};
