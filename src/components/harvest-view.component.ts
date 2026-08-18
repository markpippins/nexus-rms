import { Component, inject, signal, computed, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DataService } from '../services/data.service';
import { HarvestFilterBarComponent } from './harvest-filter-bar.component';
import { ToastService } from '../services/toast.service';
import { relativeTime, getStatusColor, CANDIDATE_STATUS_COLORS, getBlockTypeBadgeClasses } from '../app/utils/view-helpers';
import { HarvestCandidate, SegmentEntry, ProjectionOverrideEntry } from '../models/data.models';

interface HarvestEntry {
  id: string;
  sourcePath: string;
  sourceFilename: string;
  model: string;
  totalCandidates: number;
  tags: string[] | null;
  metadata: any;
  createdAt: number; // epoch ms — /api/harvests camelCases rows (camelCaseRow converts Date→getTime())
  codeBlocks?: number;
  turns?: number;
  blocksPerTurn?: number;
  userTurns?: number;
  keywordHits?: number;
  tagFrequency?: number;
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
  imports: [CommonModule, FormsModule, HarvestFilterBarComponent],
  templateUrl: './harvest-view.component.html',
  host: { class: 'flex-1 flex flex-col min-h-0' },
})
export class HarvestViewComponent {
  dataService = inject(DataService);
  toastService = inject(ToastService);

  selectedHarvestId = signal<string | null>(null);
  selectedHarvestCandidates = signal<HarvestCandidate[]>([]);
  candidatesLoading = signal(false);

  // Transcript viewer state
  transcriptOpen = signal(false);
  transcriptMaximized = signal(false);
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
  promotingToAgenda = signal(false);
  promoteToAgendaResult = signal<string | null>(null);

  // Filter state
  hideCompleted = signal(false);
  /** Status filter for the candidate inbox ('all' or a CandidateStatus). */
  candidateStatusFilter = signal<string>('all');

  /** Middle-pane mode: candidate inbox (default) or the minimal intent-records browse. */
  inboxMode = signal<'candidates' | 'intents'>('candidates');

  readonly candidateStatusChips = [
    { key: 'all', label: 'All' },
    { key: 'pending', label: 'Pending' },
    { key: 'linked', label: 'Linked' },
    { key: 'useful', label: 'Staged' },
    { key: 'promoted', label: 'Promoted' },
    { key: 'rejected', label: 'Rejected' },
    { key: 'superseded', label: 'Superseded' },
  ];

  /** Per-status counts for the filter chips. */
  candidateStatusCounts = computed(() => {
    const map: Record<string, number> = { pending: 0, linked: 0, useful: 0, promoted: 0, rejected: 0, superseded: 0 };
    for (const c of this.selectedHarvestCandidates()) {
      const s = c.status || 'pending';
      map[s] = (map[s] ?? 0) + 1;
    }
    return map;
  });

  filteredCandidates = computed(() => {
    let list = this.selectedHarvestCandidates();
    if (this.hideCompleted()) list = list.filter(c => !c.completed);
    const sf = this.candidateStatusFilter();
    if (sf !== 'all') list = list.filter(c => (c.status || 'pending') === sf);
    return list;
  });

  /** The harvest object for the currently selected row (left pane). */
  selectedHarvest = computed(() => {
    const id = this.selectedHarvestId();
    if (!id) return null;
    return this.dataService.harvests().find(h => h.id === id) ?? null;
  });

  /** Staged/promoted/done breakdown for the selected harvest's loaded candidates. */
  selectedHarvestProgress = computed(() => {
    const cands = this.selectedHarvestCandidates();
    const total = cands.length;
    if (total === 0) return { total: 0, staged: 0, promoted: 0, done: 0, pct: 0 };
    const staged = cands.filter(c => c.status === 'useful').length;
    const promoted = cands.filter(c => c.status === 'promoted').length;
    const done = cands.filter(c => c.completed).length;
    const moved = staged + promoted;
    return { total, staged, promoted, done, pct: Math.round((moved / total) * 100) };
  });

  // ── Keyboard focus + overflow menu state ─────────────────────
  focusedCandidateId = signal<string | null>(null);
  openMenuId = signal<string | null>(null);
  candidateTotalCount = signal(0);
  candidatesLoadingMore = signal(false);

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
    // Warm the intent-record + open-question indexes (fire-and-forget) so 📋/❓ badges populate.
    this.dataService.loadIntentRecordIndex();
    this.dataService.loadOpenQuestionIndex();
  }

  async toggleHarvest(id: string) {
    this.promoteToAgendaResult.set(null); // Clear stale result when switching
    if (this.selectedHarvestId() === id) {
      this.selectedHarvestId.set(null);
      this.selectedHarvestCandidates.set([]);
      this.candidateTotalCount.set(0);
      this.focusedCandidateId.set(null);
      this.openMenuId.set(null);
      return;
    }
    this.selectedHarvestId.set(id);
    this.selectedCandidateIds.set(new Set()); // clear selection on harvest switch
    this.candidateStatusFilter.set('all');
    this.focusedCandidateId.set(null);
    this.openMenuId.set(null);
    this.candidatesLoading.set(true);
    try {
      const data = await this.dataService.listHarvestCandidates({ harvestId: id, page: 1, pageSize: 100 });
      this.selectedHarvestCandidates.set(data.candidates || []);
      this.candidateTotalCount.set(data.count ?? (data.candidates || []).length);
    } catch (err: any) {
      console.error('Failed to fetch candidates:', err);
    } finally {
      this.candidatesLoading.set(false);
    }
  }

  /** Append the next page of candidates for the selected harvest. */
  async loadMoreCandidates() {
    const hid = this.selectedHarvestId();
    if (!hid || this.candidatesLoading() || this.candidatesLoadingMore()) return;
    if (this.selectedHarvestCandidates().length >= this.candidateTotalCount()) return;
    this.candidatesLoadingMore.set(true);
    try {
      const data = await this.dataService.listHarvestCandidates({
        harvestId: hid,
        page: Math.floor(this.selectedHarvestCandidates().length / 100) + 1,
        pageSize: 100,
      });
      const known = new Set(this.selectedHarvestCandidates().map(c => c.id));
      const fresh = (data.candidates || []).filter((c: HarvestCandidate) => !known.has(c.id));
      this.selectedHarvestCandidates.update(list => [...list, ...fresh]);
      this.candidateTotalCount.set(data.count ?? this.selectedHarvestCandidates().length);
    } catch (err: any) {
      console.error('Failed to load more candidates:', err);
    } finally {
      this.candidatesLoadingMore.set(false);
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
  readonly getBlockTypeBadgeClasses = getBlockTypeBadgeClasses;

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

  async openTranscript(harvest: HarvestEntry, anchorPhrase?: string) {
    // Reset find-in-file state for fresh transcript
    this.transcriptSearchQuery.set('');
    this.transcriptShowSearch.set(false);
    this.transcriptSearchMatchIndex.set(0);
    this.transcriptOpen.set(true);
    this.transcriptHarvestId.set(harvest.id);
    this.transcriptTitle.set(harvest.sourceFilename);
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
      if (anchorPhrase) this.anchorTranscriptTo(anchorPhrase);
    } catch (err: any) {
      console.error('Failed to load transcript:', err);
    } finally {
      this.transcriptLoading.set(false);
    }
  }

  /** Open the transcript for a candidate, anchored near its title text (heuristic search). */
  openTranscriptForCandidate(harvest: HarvestEntry | null, candidate: HarvestCandidate | null) {
    if (!harvest) return;
    this.openTranscript(harvest, candidate?.title || undefined);
  }

  /** Heuristic anchor: search the transcript for the candidate title and jump to the first match. */
  private anchorTranscriptTo(phrase: string) {
    const tokens = phrase.split(/\s+/).filter(w => w.length > 3).slice(0, 4);
    if (tokens.length === 0) return;
    this.transcriptSearchQuery.set(tokens.join(' '));
    this.transcriptShowSearch.set(true);
    setTimeout(() => {
      if (this.transcriptTotalMatches() > 0) {
        this.transcriptSearchMatchIndex.set(0);
        this.scrollToTranscriptMatch();
      }
    }, 60);
  }

  toggleTranscriptMaximize() {
    this.transcriptMaximized.update(v => !v);
  }

  closeTranscript() {
    this.transcriptOpen.set(false);
    this.transcriptMaximized.set(false);
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

  // ── Promote / Stage ──────────────────────────────────

  async promoteCandidate(candidate: HarvestCandidate) {
    this.promotingId.set(candidate.id);
    try {
      await this.dataService.promoteHarvestCandidate(candidate.id);
      // Update local state (the server's state machine stores this as 'useful')
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

  get stagedCandidates(): HarvestCandidate[] {
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

  async promoteToAgenda() {
    const staged = this.stagedCandidates;
    if (staged.length === 0) return;

    this.promotingToAgenda.set(true);
    this.promoteToAgendaResult.set(null);
    try {
      const result = await this.dataService.promoteToAgenda(staged.map(c => c.id));
      this.promoteToAgendaResult.set(`Agenda created: ${result.agenda_title}`);
      // Mark all promoted as promoted locally
      const promotedIds = new Set(staged.map(c => c.id));
      const updated = this.selectedHarvestCandidates().map(c =>
        promotedIds.has(c.id) ? { ...c, status: 'promoted' } : c
      );
      this.selectedHarvestCandidates.set(updated);
    } catch (err: any) {
      console.error('Failed to promote to agenda:', err);
      this.promoteToAgendaResult.set('Error: ' + (err.message || 'Unknown error'));
    } finally {
      this.promotingToAgenda.set(false);
    }
  }

  // ── Keyboard handling: transcript find-in-file + candidate triage ──

  /** Close the overflow menu when clicking anywhere else. */
  @HostListener('document:click')
  closeMenuOnOutsideClick() {
    if (this.openMenuId()) this.openMenuId.set(null);
  }

  private isTypingTarget(el: HTMLElement | null): boolean {
    if (!el) return false;
    const tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
  }

  @HostListener('document:keydown', ['$event'])
  handleKeydown(e: KeyboardEvent) {
    if (this.transcriptOpen()) {
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
      return;
    }

    // Candidate inbox triage (j/k move, Enter open, s stage, x reject, c done)
    if (this.isTypingTarget(e.target as HTMLElement)) return;
    const targetTag = (e.target as HTMLElement | null)?.tagName;
    // Let native activation win on buttons/links (Enter/Space would both trigger).
    if ((e.key === 'Enter' || e.key === ' ') && (targetTag === 'BUTTON' || targetTag === 'A')) return;
    // Triage keys apply to the candidate inbox only — not the intent-records browse.
    if (this.inboxMode() === 'intents') return;
    if (!this.selectedHarvestId() || this.filteredCandidates().length === 0) return;
    const key = e.key;
    if (key === 'j' || key === 'ArrowDown') {
      e.preventDefault();
      this.moveKeyboardFocus(1);
      return;
    }
    if (key === 'k' || key === 'ArrowUp') {
      e.preventDefault();
      this.moveKeyboardFocus(-1);
      return;
    }
    const focused = this.filteredCandidates().find(c => c.id === this.focusedCandidateId());
    if (!focused) return;
    const harvest = this.selectedHarvest();
    switch (key) {
      case 'Enter':
        e.preventDefault();
        if (harvest) this.openTranscript(harvest, focused.title);
        break;
      case 's':
        e.preventDefault();
        if (focused.status === 'linked' || focused.status === 'pending') this.promoteCandidate(focused);
        break;
      case 'x':
        e.preventDefault();
        if (focused.status !== 'rejected' && focused.status !== 'promoted') this.rejectCandidate(focused);
        break;
      case 'c':
        e.preventDefault();
        this.toggleCandidateCompleted(focused);
        break;
    }
  }

  /** Move keyboard focus across the visible candidate list (wraps). */
  moveKeyboardFocus(delta: number) {
    const vis = this.filteredCandidates();
    if (vis.length === 0) return;
    const idx = vis.findIndex(c => c.id === this.focusedCandidateId());
    const next = idx === -1 ? 0 : (idx + delta + vis.length) % vis.length;
    this.focusedCandidateId.set(vis[next].id);
    setTimeout(() => {
      const el = document.getElementById('cand-' + this.focusedCandidateId());
      el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 0);
  }

  /** Set keyboard focus when a candidate row is clicked. */
  focusCandidate(candidate: HarvestCandidate) {
    this.focusedCandidateId.set(candidate.id);
  }

  /** Open the slide-out document for a candidate (auto-opens the app right panel). */
  openCandidateDoc(candidate: HarvestCandidate) {
    this.focusedCandidateId.set(candidate.id);
    this.dataService.selectedHarvestCandidateId.set(candidate.id);
  }

  /** Open the slide-out document for a candidate by id (from an intent-record row). */
  openCandidateDocById(candidateId: string) {
    this.dataService.selectedHarvestCandidateId.set(candidateId);
  }

  /** Toggle the middle pane between the candidate inbox and the intent-records browse. */
  toggleInboxMode() {
    this.inboxMode.set(this.inboxMode() === 'intents' ? 'candidates' : 'intents');
    if (this.inboxMode() === 'intents') this.dataService.loadIntentRecordIndex();
  }

  /** Tailwind classes for intent-record status badges. */
  getIntentStatusClass(status: string): string {
    const map: Record<string, string> = {
      draft: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400',
      pending: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
      approved: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
      rejected: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
      promoted: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
      implemented: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
    };
    return map[status] || 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400';
  }

  /** Promote an intent record to a requirement from the minimal browse (stays in place). */
  async promoteIntentRecord(record: any) {
    try {
      const result = await this.dataService.promoteIntentToRequirement(record.id);
      if (result) {
        this.dataService.updateIntentRecordStatus(record.id, 'promoted');
        this.toastService.show(`"${(record.title || 'Intent').slice(0, 40)}${(record.title || '').length > 40 ? '…' : ''}" promoted to requirement`, 'success');
      } else {
        this.toastService.show('Failed to promote intent record', 'error');
      }
    } catch (err: any) {
      this.toastService.show(err.message || 'Promotion failed', 'error');
    }
  }

  // ── Overflow menu (⋯) actions ───────────────────────────────

  toggleCandidateMenu(candidateId: string) {
    this.openMenuId.update(v => (v === candidateId ? null : candidateId));
  }

  onMenuTransform(candidate: HarvestCandidate) {
    this.openMenuId.set(null);
    this.transformToRequirement(candidate);
  }

  onMenuReject(candidate: HarvestCandidate) {
    this.openMenuId.set(null);
    this.rejectCandidate(candidate);
  }

  onMenuToggleCompleted(candidate: HarvestCandidate) {
    this.openMenuId.set(null);
    this.toggleCandidateCompleted(candidate);
  }

  onMenuTranscript(candidate: HarvestCandidate) {
    this.openMenuId.set(null);
    this.openTranscriptForCandidate(this.selectedHarvest(), candidate);
  }

  getStatusColor(status: string): string {
    return getStatusColor(status, CANDIDATE_STATUS_COLORS);
  }

  readonly relativeTime = relativeTime;

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

