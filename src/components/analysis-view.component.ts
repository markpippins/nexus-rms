import { Component, inject, signal, computed, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DataService } from '../services/data.service';
import { ToastService } from '../services/toast.service';
import { getStatusColor, CANDIDATE_STATUS_COLORS } from '../app/utils/view-helpers';
import { HarvestCandidate } from '../models/data.models';

/** Union of candidate statuses that can be set via the analysis view. */
type CandidateStatus = 'useful' | 'rejected';

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

interface TabData {
  candidate: HarvestCandidate;
  harvestId: string;
  harvestTitle: string;
  transcriptUnits: TranscriptUnit[];
  transcriptStats: any;
  transcriptCandidates: any[];
  loaded: boolean;
  loading: boolean;
}

@Component({
  selector: 'app-analysis-view',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './analysis-view.component.html',
})
export class AnalysisViewComponent {
  dataService = inject(DataService);
  toastService = inject(ToastService);

  tabs = signal<TabData[]>([]);
  activeTabIndex = signal(0);
  loading = signal(false);
  error = signal<string | null>(null);

  // Tab scroll state
  tabScrollLeft = signal(0);

  constructor() {
    this.loadUsefulCandidates();
  }

  async loadUsefulCandidates() {
    // Reset find-in-file state on refresh
    this.searchQuery.set('');
    this.showSearch.set(false);
    this.searchMatchIndex.set(0);
    this.loading.set(true);
    this.error.set(null);
    this.tabScrollLeft.set(0);
    try {
      // Fetch all candidates and filter for 'useful' client-side
      const data = await this.dataService.listHarvestCandidates({ limit: 500 });
      const useful = (data.candidates || []).filter((c: HarvestCandidate) => c.status === 'useful');

      // Deduplicate by harvest_id — one tab per harvest that has at least one useful candidate
      const seenHarvests = new Map<string, HarvestCandidate>();
      for (const c of useful) {
        const hid = c.harvest_id;
        if (hid && !seenHarvests.has(hid)) {
          seenHarvests.set(hid, c);
        }
      }

      const tabList: TabData[] = Array.from(seenHarvests.entries()).map(([harvestId, candidate]) => ({
        candidate,
        harvestId,
        harvestTitle: candidate.harvest_source || harvestId.slice(0, 12),
        transcriptUnits: [],
        transcriptStats: null,
        transcriptCandidates: [],
        loaded: false,
        loading: false,
      }));

      this.tabs.set(tabList);

      if (tabList.length > 0) {
        // Auto-load the first tab
        this.loadTranscript(0);
      }
    } catch (err: any) {
      this.error.set(err.message || 'Failed to load useful candidates');
    } finally {
      this.loading.set(false);
    }
  }

  async loadTranscript(tabIndex: number) {
    const tab = this.tabs()[tabIndex];
    if (!tab || tab.loaded || tab.loading) return;

    this.tabs.update(list => list.map((t, i) =>
      i === tabIndex ? { ...t, loading: true } : t
    ));

    try {
      const data = await this.dataService.getHarvestTranscript(tab.harvestId);
      this.tabs.update(list => list.map((t, i) =>
        i === tabIndex ? {
          ...t,
          transcriptUnits: data.units || [],
          transcriptStats: data.stats,
          transcriptCandidates: data.candidates || [],
          harvestTitle: data.title || t.harvestTitle,
          loaded: true,
          loading: false,
        } : t
      ));
    } catch (err: any) {
      console.error('Failed to load transcript:', err);
      this.tabs.update(list => list.map((t, i) =>
        i === tabIndex ? { ...t, loading: false } : t
      ));
    }
  }

  // ── Find-in-file state for transcript content ──────────────────
  searchQuery = signal('');
  showSearch = signal(false);
  searchMatchIndex = signal(0);

  totalMatches = computed(() => {
    const query = this.searchQuery().toLowerCase().trim();
    if (!query) return 0;
    const tab = this.activeTab();
    if (!tab) return 0;
    let count = 0;
    for (const unit of tab.transcriptUnits) {
      for (const block of unit.blocks) {
        const text = block.content || block.items?.join(' ') || '';
        const lower = text.toLowerCase();
        let idx = -1;
        while ((idx = lower.indexOf(query, idx + 1)) !== -1) count++;
      }
    }
    return count;
  });

  toggleSearch() {
    this.showSearch.update(v => !v);
    if (!this.showSearch()) {
      this.searchQuery.set('');
    } else {
      setTimeout(() => document.getElementById('analysis-search-input')?.focus(), 0);
    }
  }

  nextMatch() {
    const total = this.totalMatches();
    if (total === 0) return;
    this.searchMatchIndex.update(i => (i + 1) % total);
    this.scrollToCurrentMatch();
  }

  prevMatch() {
    const total = this.totalMatches();
    if (total === 0) return;
    this.searchMatchIndex.update(i => (i - 1 + total) % total);
    this.scrollToCurrentMatch();
  }

  private scrollToCurrentMatch() {
    const idx = this.searchMatchIndex();
    setTimeout(() => {
      const marks = document.querySelectorAll('#analysis-content .analysis-highlight');
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
    const query = this.searchQuery();
    const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    if (!query) return escaped;
    const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    return escaped.replace(regex, '<mark class="analysis-highlight">$1</mark>');
  }

  selectTab(index: number) {
    // Reset find-in-file state when switching tabs
    this.searchQuery.set('');
    this.showSearch.set(false);
    this.searchMatchIndex.set(0);
    this.activeTabIndex.set(index);
    this.loadTranscript(index);
  }

  activeTab = computed(() => this.tabs()[this.activeTabIndex()] || null);

  // ── Helpers ──────────────────────────────────────────────────

  getStatusColor(status: string): string {
    return getStatusColor(status, CANDIDATE_STATUS_COLORS);
  }

  getBlockTypeBadgeClasses(type: string): string {
    switch (type) {
      case 'code': return 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400';
      case 'diagram': return 'bg-indigo-50 dark:bg-indigo-900/20 text-indigo-500 dark:text-indigo-400';
      case 'quote': return 'bg-amber-50 dark:bg-amber-900/20 text-amber-500 dark:text-amber-400';
      case 'list': return 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-500 dark:text-emerald-400';
      default: return 'bg-transparent text-gray-400 dark:text-gray-500';
    }
  }

  scrollTabs(direction: 'left' | 'right') {
    const amount = direction === 'left' ? -200 : 200;
    this.tabScrollLeft.update(v => Math.max(0, v + amount));
  }

  /** ID of the candidate currently being promoted/rejected (for spinner). */
  togglingCandidateId = signal<string | null>(null);

  /** Mark a candidate as useful or rejected from the candidates list. */
  async toggleCandidateStatus(candidate: HarvestCandidate, status: CandidateStatus) {
    this.togglingCandidateId.set(candidate.id);
    try {
      if (status === 'useful') {
        await this.dataService.promoteHarvestCandidate(candidate.id);
      } else {
        await this.dataService.rejectHarvestCandidate(candidate.id);
      }
      // Update local state in the active tab's transcriptCandidates
      this.tabs.update(list => list.map(t => ({
        ...t,
        transcriptCandidates: t.transcriptCandidates.map(c =>
          c.id === candidate.id ? { ...c, status } : c
        ),
      })));
      // If rejected, also remove from the "useful" filter so it won't appear on reload
      // (We don't reload — let the user see the status change inline.)
    } catch (err: any) {
      console.error('Failed to update candidate status:', err);
    } finally {
      this.togglingCandidateId.set(null);
    }
  }

  /** Whether a candidate is currently being toggled. */
  isToggling(id: string): boolean {
    return this.togglingCandidateId() === id;
  }

  /** ID of the candidate currently having its completed flag toggled. */
  togglingCompletedId = signal<string | null>(null);

  /** Toggle a candidate's completed flag with optimistic update + rollback. */
  async toggleCandidateCompleted(candidate: HarvestCandidate) {
    const previousValue = candidate.completed;
    const newValue = !previousValue;
    const actionLabel = newValue ? 'completed' : 'uncompleted';

    this.togglingCompletedId.set(candidate.id);

    // Optimistic update across all tabs' transcriptCandidates
    this.tabs.update(list => list.map(t => ({
      ...t,
      transcriptCandidates: t.transcriptCandidates.map(c =>
        c.id === candidate.id ? { ...c, completed: newValue } : c
      ),
    })));

    try {
      const result = await this.dataService.updateHarvestCandidate(candidate.id, { completed: newValue });
      if (result) {
        this.toastService.show(`"${candidate.title.slice(0, 40)}${candidate.title.length > 40 ? '…' : ''}" marked as ${actionLabel}`, 'success');
      } else {
        // Rollback on null response
        this.tabs.update(list => list.map(t => ({
          ...t,
          transcriptCandidates: t.transcriptCandidates.map(c =>
            c.id === candidate.id ? { ...c, completed: previousValue } : c
          ),
        })));
        this.toastService.show('Failed to update candidate status', 'error');
      }
    } catch (err: any) {
      console.error('Failed to toggle candidate completed:', err);
      // Rollback
      this.tabs.update(list => list.map(t => ({
        ...t,
        transcriptCandidates: t.transcriptCandidates.map(c =>
          c.id === candidate.id ? { ...c, completed: previousValue } : c
        ),
      })));
      this.toastService.show('Failed to update candidate status', 'error');
    } finally {
      this.togglingCompletedId.set(null);
    }
  }

  isTogglingCompleted(id: string): boolean {
    return this.togglingCompletedId() === id;
  }

  // -- Transform to Requirement --
  transformingId = signal<string | null>(null);

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
      // Update local state: mark as promoted
      this.tabs.update(list => list.map(t => ({
        ...t,
        transcriptCandidates: t.transcriptCandidates.map(c =>
          c.id === candidate.id ? { ...c, status: 'promoted' } : c
        ),
      })));
    } catch (err: any) {
      console.error('Failed to transform candidate:', err);
    } finally {
      this.transformingId.set(null);
    }
  }

  isTransforming(id: string): boolean {
    return this.transformingId() === id;
  }

  // ── Keyboard handling for find-in-file ────────────────────────

  @HostListener('document:keydown', ['$event'])
  handleKeydown(e: KeyboardEvent) {
    // Only handle when we have an active tab loaded
    const tab = this.activeTab();
    if (!tab || !tab.loaded) return;

    // Ctrl+F / Cmd+F — toggle search
    if ((e.ctrlKey || e.metaKey) && e.key === 'f' && !e.shiftKey) {
      e.preventDefault();
      this.toggleSearch();
      return;
    }

    // Escape — close search
    if (e.key === 'Escape' && this.showSearch()) {
      this.showSearch.set(false);
      this.searchQuery.set('');
      return;
    }

    // Enter / Shift+Enter — navigate matches
    if (e.key === 'Enter' && this.showSearch()) {
      e.preventDefault();
      if (e.shiftKey) this.prevMatch();
      else this.nextMatch();
    }
  }
}
