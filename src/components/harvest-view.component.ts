import { Component, inject, signal, computed, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DataService } from '../services/data.service';
import { ToastService } from '../services/toast.service';
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
  toastService = inject(ToastService);

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
  transcriptConversationId = signal<string | null>(null);
  transcriptSnapshotId = signal<string | null>(null);

  // ── Transcript find-in-file state ────────────────────────────
  transcriptSearchQuery = signal('');
  transcriptShowSearch = signal(false);
  transcriptSearchMatchIndex = signal(0);

  transcriptTotalMatches = computed(() => {
    const query = this.transcriptSearchQuery().toLowerCase().trim();
    if (!query) return 0;
    let count = 0;
    for (const unit of this.transcriptUnits()) {
      for (const block of unit.blocks) {
        const text = block.content || block.items?.join(' ') || '';
        const lower = text.toLowerCase();
        let idx = -1;
        while ((idx = lower.indexOf(query, idx + 1)) !== -1) count++;
      }
    }
    return count;
  });

  toggleTranscriptSearch() {
    this.transcriptShowSearch.update(v => !v);
    if (!this.transcriptShowSearch()) {
      this.transcriptSearchQuery.set('');
    } else {
      setTimeout(() => document.getElementById('transcript-search-input')?.focus(), 0);
    }
  }

  transcriptNextMatch() {
    const total = this.transcriptTotalMatches();
    if (total === 0) return;
    this.transcriptSearchMatchIndex.update(i => (i + 1) % total);
    this.scrollToTranscriptMatch();
  }

  transcriptPrevMatch() {
    const total = this.transcriptTotalMatches();
    if (total === 0) return;
    this.transcriptSearchMatchIndex.update(i => (i - 1 + total) % total);
    this.scrollToTranscriptMatch();
  }

  private scrollToTranscriptMatch() {
    const idx = this.transcriptSearchMatchIndex();
    setTimeout(() => {
      const marks = document.querySelectorAll('#transcript-content .transcript-highlight');
      if (marks.length === 0) return;
      marks.forEach(m => m.removeAttribute('data-current'));
      if (idx < marks.length) {
        marks[idx].setAttribute('data-current', '');
        marks[idx].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }, 0);
  }

  /** Escape HTML and highlight search matches */
  highlightText(text: string | null | undefined): string {
    if (!text) return '';
    const query = this.transcriptSearchQuery();
    // Escape HTML first
    const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    if (!query) return escaped;
    const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    return escaped.replace(regex, '<mark class="transcript-highlight">$1</mark>');
  }

  // Promote state
  promotingId = signal<string | null>(null);
  promotingToPlan = signal(false);
  promoteToPlanResult = signal<string | null>(null);

  // Filter state
  hideCompleted = signal(false);

  filteredCandidates = computed(() => {
    if (!this.hideCompleted()) return this.selectedHarvestCandidates();
    return this.selectedHarvestCandidates().filter(c => !c.completed);
  });

  // Bulk selection state
  selectedCandidateIds = signal<Set<string>>(new Set());
  bulkMarkingCompleted = signal(false);

  /** Derived signal: are all visible candidates selected? */
  allVisibleSelected = computed(() => {
    const visible = this.filteredCandidates();
    if (visible.length === 0) return false;
    const ids = this.selectedCandidateIds();
    return visible.every(c => ids.has(c.id));
  });

  // Toggle completed state
  togglingCompletedId = signal<string | null>(null);

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
    this.selectedCandidateIds.set(new Set()); // clear selection on harvest switch
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
    // Reset find-in-file state for fresh transcript
    this.transcriptSearchQuery.set('');
    this.transcriptShowSearch.set(false);
    this.transcriptSearchMatchIndex.set(0);
    this.transcriptOpen.set(true);
    this.transcriptHarvestId.set(harvest.id);
    this.transcriptTitle.set(harvest.source_filename);
    this.transcriptLoading.set(true);
    try {
      const data = await this.dataService.getHarvestTranscript(harvest.id);
      this.transcriptUnits.set(data.units || []);
      this.transcriptStats.set(data.stats);
      this.transcriptCandidates.set(data.candidates || []);
      this.transcriptConversationId.set(data.conversationId);
      this.transcriptSnapshotId.set(data.snapshotId);
      this.committedSegments.set(data.committedSegments || []);
      this.activeOverrides.set(data.activeOverrides || []);
    } catch (err: any) {
      console.error('Failed to load transcript:', err);
    } finally {
      this.transcriptLoading.set(false);
    }
  }

  closeTranscript() {
    this.transcriptOpen.set(false);
    this.transcriptHarvestId.set(null);
    this.transcriptConversationId.set(null);
    this.transcriptSnapshotId.set(null);
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

    const conversationId = this.transcriptConversationId();
    const snapshotId = this.transcriptSnapshotId();
    if (!conversationId || !snapshotId) {
      this.segmentError.set('No snapshot context — has this harvest been auto-segmented?');
      this.committingSegment.set(false);
      return;
    }

    try {
      const result = await this.dataService.createSegment({
        conversationId,
        snapshotId,
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
    const conversationId = this.transcriptConversationId();
    const snapshotId = this.transcriptSnapshotId();
    if (!conversationId || !snapshotId) return;

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
        conversation_id: conversationId,
        snapshot_id: snapshotId,
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
        conversationId,
        snapshotId,
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

  /** Toggle a candidate's completed flag via API (optimistic update with rollback). */
  async toggleCandidateCompleted(candidate: HarvestCandidate) {
    const previousValue = candidate.completed;
    const newValue = !previousValue;
    const actionLabel = newValue ? 'completed' : 'uncompleted';

    this.togglingCompletedId.set(candidate.id);

    // Optimistic update
    this.selectedHarvestCandidates.update(list =>
      list.map(c => c.id === candidate.id ? { ...c, completed: newValue } : c)
    );

    try {
      const result = await this.dataService.updateHarvestCandidate(candidate.id, { completed: newValue });
      if (result) {
        this.toastService.show(`"${candidate.title.slice(0, 40)}${candidate.title.length > 40 ? '…' : ''}" marked as ${actionLabel}`, 'success');
      } else {
        // Rollback on null response
        this.selectedHarvestCandidates.update(list =>
          list.map(c => c.id === candidate.id ? { ...c, completed: previousValue } : c)
        );
        this.toastService.show('Failed to update candidate status', 'error');
      }
    } catch (err: any) {
      console.error('Failed to toggle candidate completed:', err);
      // Rollback
      this.selectedHarvestCandidates.update(list =>
        list.map(c => c.id === candidate.id ? { ...c, completed: previousValue } : c)
      );
      this.toastService.show('Failed to update candidate status', 'error');
    } finally {
      this.togglingCompletedId.set(null);
    }
  }

  /** Toggle selection of a single candidate. */
  toggleCandidateSelection(candidateId: string) {
    this.selectedCandidateIds.update(ids => {
      const next = new Set(ids);
      if (next.has(candidateId)) {
        next.delete(candidateId);
      } else {
        next.add(candidateId);
      }
      return next;
    });
  }

  /** Select or deselect all visible candidates. */
  toggleSelectAllVisible() {
    const visible = this.filteredCandidates();
    const allSelected = this.allVisibleSelected();
    this.selectedCandidateIds.update(ids => {
      const next = new Set(ids);
      if (allSelected) {
        visible.forEach(c => next.delete(c.id));
      } else {
        visible.forEach(c => next.add(c.id));
      }
      return next;
    });
  }

  /** Clear all selections. */
  clearSelection() {
    this.selectedCandidateIds.set(new Set());
  }

  /** Bulk-mark selected candidates as completed. */
  async bulkMarkSelectedCompleted() {
    const ids = Array.from(this.selectedCandidateIds());
    if (ids.length === 0) return;

    this.bulkMarkingCompleted.set(true);

    // Snapshot for rollback
    const previousCandidates = this.selectedHarvestCandidates();

    // Optimistic update
    this.selectedHarvestCandidates.update(list =>
      list.map(c => ids.includes(c.id) ? { ...c, completed: true } : c)
    );

    // Clear selection after optimistic update
    this.selectedCandidateIds.set(new Set());

    const results = await Promise.allSettled(
      ids.map(id => this.dataService.updateHarvestCandidate(id, { completed: true }))
    );

    const succeeded = results.filter(r => r.status === 'fulfilled' && r.value).length;
    const failed = ids.length - succeeded;

    if (failed > 0) {
      // Rollback failed ones
      const failedIds = new Set(
        results
          .map((r, i) => ({ r, id: ids[i] }))
          .filter(({ r }) => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value))
          .map(({ id }) => id)
      );
      this.selectedHarvestCandidates.update(list =>
        list.map(c => failedIds.has(c.id)
          ? { ...c, completed: previousCandidates.find(pc => pc.id === c.id)?.completed ?? c.completed }
          : c
        )
      );
      this.toastService.show(`${succeeded} marked as completed, ${failed} failed`, 'error');
    } else {
      this.toastService.show(`${succeeded} candidate${succeeded !== 1 ? 's' : ''} marked as completed`, 'success');
    }

    this.bulkMarkingCompleted.set(false);
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

  // ── Keyboard handling for transcript find-in-file ────────────

  @HostListener('document:keydown', ['$event'])
  handleKeydown(e: KeyboardEvent) {
    if (!this.transcriptOpen()) return;

    // Ctrl+F / Cmd+F — toggle transcript search
    if ((e.ctrlKey || e.metaKey) && e.key === 'f' && !e.shiftKey) {
      e.preventDefault();
      this.toggleTranscriptSearch();
      return;
    }

    // Escape — close search
    if (e.key === 'Escape' && this.transcriptShowSearch()) {
      this.transcriptShowSearch.set(false);
      this.transcriptSearchQuery.set('');
      return;
    }

    // Enter / Shift+Enter — navigate matches
    if (e.key === 'Enter' && this.transcriptShowSearch()) {
      e.preventDefault();
      if (e.shiftKey) this.transcriptPrevMatch();
      else this.transcriptNextMatch();
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

