import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DataService } from '../services/data.service';
import { HarvestCandidate, SegmentEntry, ProjectionOverrideEntry } from '../models/data.models';

interface HarvestEntry {
  id: string;
  source_path: string;
  source_filename: string;
  model: string;
  total_candidates: number;
  tags: string[] | null;
  metadata: any;
  created_at: string;
  code_blocks?: number;
  turns?: number;
  blocks_per_turn?: number;
  user_turns?: number;
  keyword_hits?: number;
  tag_frequency?: number;
}

interface TranscriptUnit {
  turn_index: number;
  heading: string;
  role: string | null;
  body: string;
  block_count: number;
  blocks: TranscriptBlock[];
}

interface TranscriptBlock {
  index: number;
  type: 'paragraph' | 'code' | 'quote' | 'list' | 'diagram' | 'separator';
  content?: string;
  items?: string[];
}



@Component({
  selector: 'app-harvest-view',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './harvest-view.component.html',
})
export class HarvestViewComponent {
  dataService = inject(DataService);

  selectedHarvestId = signal<string | null>(null);
  selectedHarvestCandidates = signal<HarvestCandidate[]>([]);
  candidatesLoading = signal(false);

  // Transcript viewer state
  transcriptOpen = signal(false);
  transcriptHarvestId = signal<string | null>(null);
  transcriptTitle = signal('');
  transcriptUnits = signal<TranscriptUnit[]>([]);
  transcriptStats = signal<any>(null);
  transcriptCandidates = signal<any[]>([]);
  transcriptLoading = signal(false);

  // Promote state
  promotingId = signal<string | null>(null);
  promotingToPlan = signal(false);
  promoteToPlanResult = signal<string | null>(null);

  // Transform to Requirement state
  transformingId = signal<string | null>(null);

  constructor() {
    this.dataService.fetchHarvests();
  }

  async toggleHarvest(id: string) {
    this.promoteToPlanResult.set(null); // Clear stale result when switching
    if (this.selectedHarvestId() === id) {
      this.selectedHarvestId.set(null);
      this.selectedHarvestCandidates.set([]);
      return;
    }
    this.selectedHarvestId.set(id);
    this.candidatesLoading.set(true);
    try {
      const data = await this.dataService.listHarvestCandidates({ harvestId: id, limit: 100 });
      this.selectedHarvestCandidates.set(data.candidates || []);
    } catch (err: any) {
      console.error('Failed to fetch candidates:', err);
    } finally {
      this.candidatesLoading.set(false);
    }
  }

  // ── Transcript Viewer ──────────────────────────────────────

  // Block Segmentation state
  segmentMode = signal(false);
  segmentState = signal<'IDLE' | 'START_SELECTED' | 'SEGMENT_READY'>('IDLE');
  segmentStartBlockId = signal<number | null>(null);
  segmentEndBlockId = signal<number | null>(null);
  committingSegment = signal(false);
  segmentError = signal<string | null>(null);

  // Serialized/deserialized block segmentation data from API
  committedSegments = signal<SegmentEntry[]>([]);
  activeOverrides = signal<ProjectionOverrideEntry[]>([]);
  snapshotLoading = signal(false);

  /** Track which committed segments are expanded (collapsible). */
  segmentExpanded = signal<Record<string, boolean>>({});

  toggleSegmentExpanded(segId: string) {
    this.segmentExpanded.update(m => ({ ...m, [segId]: !m[segId] }));
  }

  isSegmentExpanded(segId: string): boolean {
    return this.segmentExpanded()[segId] !== false;
  }

  /** Check if a block index falls within a committed segment. */
  isBlockInCommittedSegment(blockIndex: number): { inSegment: boolean; segmentIndex: number } {
    const segments = this.committedSegments();
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      if (blockIndex >= seg.start_block_index && blockIndex <= seg.end_block_index) {
        return { inSegment: true, segmentIndex: i };
      }
    }
    return { inSegment: false, segmentIndex: -1 };
  }

  /** Check if a block is suppressed from BP projection. */
  isBlockSuppressed(blockIndex: number): boolean {
    const blockId = `block-${blockIndex}`;
    return this.activeOverrides().some(
      o => o.target_id === blockId && o.override_type === 'EXCLUDE'
    );
  }

  /** Return CSS classes for a block's container based on its state. */
  getBlockContainerClasses(blockIndex: number): string {
    const segInfo = this.isBlockInCommittedSegment(blockIndex);
    const isSuppressed = this.isBlockSuppressed(blockIndex);
    const mode = this.segmentMode();
    const state = this.segmentState();
    const startId = this.segmentStartBlockId();
    const endId = this.segmentEndBlockId();

    if (isSuppressed) return 'opacity-40 grayscale';
    if (segInfo.inSegment) return 'bg-blue-50/40 dark:bg-blue-900/10';
    if (!mode) return '';
    if (state !== 'IDLE' && (startId === blockIndex || endId === blockIndex)) return 'bg-amber-50 dark:bg-amber-900/10';
    if (state === 'SEGMENT_READY' && startId !== null && endId !== null && blockIndex > startId && blockIndex < endId) return 'bg-amber-50/30 dark:bg-amber-900/5';
    return '';
  }

  /** Return left rail CSS classes for a block. */
  getBlockLeftRailClasses(blockIndex: number): string {
    const segInfo = this.isBlockInCommittedSegment(blockIndex);
    const mode = this.segmentMode();
    const state = this.segmentState();
    const startId = this.segmentStartBlockId();
    const endId = this.segmentEndBlockId();

    if (segInfo.inSegment) return 'bg-blue-400 dark:bg-blue-500';
    if (!mode) return 'bg-transparent';
    if (state !== 'IDLE' && (startId === blockIndex || endId === blockIndex)) return 'bg-amber-400 dark:bg-amber-500';
    if (state === 'SEGMENT_READY' && startId !== null && endId !== null && blockIndex > startId && blockIndex < endId) return 'bg-amber-300/50 dark:bg-amber-500/30';
    return 'bg-transparent';
  }

  /** Return CSS classes for a block type badge. */
  getBlockTypeBadgeClasses(type: string): string {
    switch (type) {
      case 'code': return 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400';
      case 'diagram': return 'bg-indigo-50 dark:bg-indigo-900/20 text-indigo-500 dark:text-indigo-400';
      case 'quote': return 'bg-amber-50 dark:bg-amber-900/20 text-amber-500 dark:text-amber-400';
      case 'list': return 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-500 dark:text-emerald-400';
      default: return 'bg-transparent text-gray-400 dark:text-gray-500';
    }
  }

  /** Return CSS for the START/END button based on whether it's selected. */
  getSegmentToggleClasses(isSelected: boolean): string {
    return isSelected
      ? 'bg-amber-400 text-white'
      : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 hover:bg-amber-100 dark:hover:bg-amber-900/30 hover:text-amber-600 dark:hover:text-amber-400';
  }

  /** Return CSS for the state bar based on current segment state. */
  getStateBarClasses(): string {
    switch (this.segmentState()) {
      case 'START_SELECTED': return 'border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-900/10';
      case 'SEGMENT_READY': return 'border-green-200 dark:border-green-800 bg-green-50/50 dark:bg-green-900/10';
      default: return 'border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-900/10';
    }
  }

  /** Return text color for the state bar label. */
  getStateBarTextClasses(): string {
    switch (this.segmentState()) {
      case 'START_SELECTED': return 'text-amber-700 dark:text-amber-400';
      case 'SEGMENT_READY': return 'text-green-700 dark:text-green-400';
      default: return 'text-blue-700 dark:text-blue-400';
    }
  }

  async openTranscript(harvest: HarvestEntry) {
    this.transcriptOpen.set(true);
    this.transcriptHarvestId.set(harvest.id);
    this.transcriptTitle.set(harvest.source_filename);
    this.transcriptLoading.set(true);
    try {
      const data = await this.dataService.getHarvestTranscript(harvest.id);
      this.transcriptUnits.set(data.units || []);
      this.transcriptStats.set(data.stats);
      this.transcriptCandidates.set(data.candidates || []);
    } catch (err: any) {
      console.error('Failed to load transcript:', err);
    } finally {
      this.transcriptLoading.set(false);
    }
  }

  closeTranscript() {
    this.transcriptOpen.set(false);
    this.transcriptHarvestId.set(null);
    this.transcriptUnits.set([]);
    this.transcriptCandidates.set([]);
    this.transcriptStats.set(null);
    this.committedSegments.set([]);
    this.activeOverrides.set([]);
    this.segmentExpanded.set({});
    this.segmentMode.set(false);
    this.resetSegmentMachine();
  }

  // ── Segment State Machine ──────────────────────────────────

  resetSegmentMachine() {
    this.segmentState.set('IDLE');
    this.segmentStartBlockId.set(null);
    this.segmentEndBlockId.set(null);
    this.segmentError.set(null);
  }

  /** Toggle segmentation mode on/off. */
  toggleSegmentMode() {
    this.segmentMode.update(v => !v);
    this.resetSegmentMachine();
  }

  /** Click START on a block: sets start or resets it. */
  onBlockSegmentStart(blockIndex: number) {
    if (!this.segmentMode()) return;
    const currentStart = this.segmentStartBlockId();

    // Re-clicking the same start block resets to IDLE
    if (currentStart === blockIndex) {
      this.resetSegmentMachine();
      return;
    }

    this.segmentStartBlockId.set(blockIndex);

    // If we already have an end set from a previous attempt, check ordering
    const currentEnd = this.segmentEndBlockId();
    if (currentEnd !== null && blockIndex < currentEnd) {
      this.segmentState.set('SEGMENT_READY');
    } else if (currentEnd !== null && blockIndex >= currentEnd) {
      // Start after end — reset end
      this.segmentEndBlockId.set(null);
      this.segmentState.set('START_SELECTED');
    } else {
      this.segmentState.set('START_SELECTED');
    }
  }

  /** Click END on a block: sets end or transitions to SEGMENT_READY. */
  onBlockSegmentEnd(blockIndex: number) {
    if (!this.segmentMode()) return;
    const currentStart = this.segmentStartBlockId();

    // Must have a start first, and end must be after start
    if (currentStart === null) return;
    if (blockIndex <= currentStart) return;

    this.segmentEndBlockId.set(blockIndex);
    this.segmentState.set('SEGMENT_READY');
  }

  /** Cancel the current pending segment. */
  cancelSegment() {
    this.resetSegmentMachine();
  }

  /** Commit the pending segment via API. */
  async commitSegment() {
    const startId = this.segmentStartBlockId();
    const endId = this.segmentEndBlockId();
    if (startId === null || endId === null) return;

    this.committingSegment.set(true);
    this.segmentError.set(null);

    const harvestId = this.transcriptHarvestId();
    if (!harvestId) {
      this.segmentError.set('No harvest context');
      this.committingSegment.set(false);
      return;
    }

    try {
      // TODO: map harvestId → actual conversation_id + snapshot_id
      // Currently using harvestId as a placeholder until the snapshot
      // selection/creation flow is added in a later integration step.
      const result = await this.dataService.createSegment({
        conversationId: harvestId,
        snapshotId: harvestId,
        startBlockId: `block-${startId}`,
        endBlockId: `block-${endId}`,
        startBlockIndex: startId,
        endBlockIndex: endId,
        segmentType: null,
        source: 'USER',
        title: `Segment ${this.committedSegments().length + 1}`,
        createdBy: 'USER',
      });

      if (result) {
        this.committedSegments.update(segments => [...segments, result]);
        this.resetSegmentMachine();
      } else {
        this.segmentError.set('Failed to create segment');
      }
    } catch (err: any) {
      this.segmentError.set(err.message || 'Failed to commit segment');
    } finally {
      this.committingSegment.set(false);
    }
  }

  /** Toggle BP suppression for a block (optimistic update with rollback). */
  async toggleBlockSuppression(blockIndex: number) {
    const harvestId = this.transcriptHarvestId();
    if (!harvestId) return;

    const blockId = `block-${blockIndex}`;
    const existing = this.activeOverrides().find(
      o => o.target_id === blockId && o.override_type === 'EXCLUDE'
    );

    if (existing) {
      // Optimistic remove
      const previous = this.activeOverrides();
      this.activeOverrides.update(overrides =>
        overrides.filter(o => o.id !== existing.id)
      );
      const result = await this.dataService.removeProjectionOverride(existing.id);
      if (!result) {
        this.activeOverrides.set(previous); // rollback
      }
    } else {
      // Optimistic add
      const tempId = crypto.randomUUID();
      const optimistic: ProjectionOverrideEntry = {
        id: tempId,
        conversation_id: harvestId,
        snapshot_id: harvestId,
        target_type: 'BLOCK',
        target_id: blockId,
        projection_target: 'BP',
        override_type: 'EXCLUDE',
        reason_code: 'USER_OVERRIDE',
        notes_md: null,
        source: 'USER',
        created_by: 'USER',
        created_at: new Date().toISOString(),
      };
      this.activeOverrides.update(overrides => [...overrides, optimistic]);

      const result = await this.dataService.createProjectionOverride({
        conversationId: harvestId,
        snapshotId: harvestId,
        targetType: 'BLOCK',
        targetId: blockId,
        projectionTarget: 'BP',
        overrideType: 'EXCLUDE',
        reasonCode: 'USER_OVERRIDE',
        source: 'USER',
        createdBy: 'USER',
      });

      if (result) {
        // Replace optimistic with real
        this.activeOverrides.update(overrides =>
          overrides.map(o => o.id === tempId ? result : o)
        );
      } else {
        // Rollback
        this.activeOverrides.update(overrides =>
          overrides.filter(o => o.id !== tempId)
        );
      }
    }
  }

  // ── Promote / Mark Useful ──────────────────────────────────

  async promoteCandidate(candidate: HarvestCandidate) {
    this.promotingId.set(candidate.id);
    try {
      await this.dataService.promoteHarvestCandidate(candidate.id);
      // Update local state
      const updated = this.selectedHarvestCandidates().map(c =>
        c.id === candidate.id ? { ...c, status: 'useful' } : c
      );
      this.selectedHarvestCandidates.set(updated);
    } catch (err: any) {
      console.error('Failed to promote candidate:', err);
    } finally {
      this.promotingId.set(null);
    }
  }

  async rejectCandidate(candidate: HarvestCandidate) {
    this.promotingId.set(candidate.id);
    try {
      await this.dataService.rejectHarvestCandidate(candidate.id);
      const updated = this.selectedHarvestCandidates().map(c =>
        c.id === candidate.id ? { ...c, status: 'rejected' } : c
      );
      this.selectedHarvestCandidates.set(updated);
    } catch (err: any) {
      console.error('Failed to reject candidate:', err);
    } finally {
      this.promotingId.set(null);
    }
  }

  // ── Promote to Plan ──────────────────────────────────────────

  get usefulCandidates(): HarvestCandidate[] {
    return this.selectedHarvestCandidates().filter(c => c.status === 'useful');
  }

  async transformToRequirement(candidate: HarvestCandidate) {
    if (!candidate.system_id) return;
    this.transformingId.set(candidate.id);
    try {
      await this.dataService.addRequirement({
        title: candidate.title || 'Untitled Candidate',
        description: candidate.intent_description || '',
        status: 'Backlog',
        priority: 'Medium',
        reqType: 'Task',
        candidateId: candidate.id,
        systemId: candidate.system_id,
        subsystemId: candidate.subsystem_id || undefined,
        featureId: candidate.feature_id || undefined,
      });
      // Mark as promoted locally
      const updated = this.selectedHarvestCandidates().map(c =>
        c.id === candidate.id ? { ...c, status: 'promoted' } : c
      );
      this.selectedHarvestCandidates.set(updated);
    } catch (err: any) {
      console.error('Failed to transform candidate:', err);
    } finally {
      this.transformingId.set(null);
    }
  }

  async promoteToPlan() {
    const useful = this.usefulCandidates;
    if (useful.length === 0) return;

    this.promotingToPlan.set(true);
    this.promoteToPlanResult.set(null);
    try {
      const result = await this.dataService.promoteToPlan(useful.map(c => c.id));
      this.promoteToPlanResult.set(`Plan #${result.plan_id} created: ${result.plan_title}`);
      // Mark all promoted as promoted locally
      const promotedIds = new Set(useful.map(c => c.id));
      const updated = this.selectedHarvestCandidates().map(c =>
        promotedIds.has(c.id) ? { ...c, status: 'promoted' } : c
      );
      this.selectedHarvestCandidates.set(updated);
    } catch (err: any) {
      console.error('Failed to promote to plan:', err);
      this.promoteToPlanResult.set('Error: ' + (err.message || 'Unknown error'));
    } finally {
      this.promotingToPlan.set(false);
    }
  }

  getStatusColor(status: string): string {
    const cols: Record<string, string> = {
      pending: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400',
      linked: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
      useful: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
      rejected: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
      promoted: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    };
    return cols[status] || 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400';
  }

  formatDate(iso: string): string {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  truncatePath(path: string): string {
    if (!path) return '';
    const parts = path.replace(/^.*\/nexus\//, '').split('/');
    if (parts.length <= 2) return parts.join('/');
    return parts.slice(-2).join('/');
  }

  formatMetric(n: number | undefined): string {
    if (n === undefined || n === null) return '—';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
    return n.toLocaleString();
  }

  formatTags(tags: string[] | null | undefined): string {
    if (!tags || tags.length === 0) return '';
    return tags.slice(0, 4).join(', ') + (tags.length > 4 ? ` +${tags.length - 4}` : '');
  }

}

