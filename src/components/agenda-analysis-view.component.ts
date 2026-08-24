import { Component, inject, signal, computed, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DataService } from '../services/data.service';
import { ToastService } from '../services/toast.service';
import { getStatusColor, CANDIDATE_STATUS_COLORS } from '../app/utils/view-helpers';
import { HarvestCandidate } from '../models/data.models';

/** Union of candidate statuses that can be set via the analysis view. */
type CandidateStatus = 'staged' | 'rejected';

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
  selector: 'app-agenda-analysis-view',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './agenda-analysis-view.component.html',
})
export class AgendaAnalysisViewComponent {
  dataService = inject(DataService);
  toastService = inject(ToastService);

  tabs = signal<TabData[]>([]);
  activeTabIndex = signal(0);
  loading = signal(false);
  error = signal<string | null>(null);

  // Tab scroll state
  tabScrollLeft = signal(0);

  // Collapse toggle for long planner analysis text
  plannerAnalysisExpanded = signal(false);

  /** Proportional collapse threshold: half the text length, min 300, max 800 chars. */
  plannerAnalysisThreshold = computed(() => {
    const text = this.dataService.agendaAnalysisData()?.plannerAnalysis || '';
    if (!text) return 500;
    return Math.min(800, Math.max(300, Math.floor(text.length / 2)));
  });

  /** Assessment items from the agenda (when no candidates are available). */
  assessmentItems = computed(() => {
    const data = this.dataService.agendaAnalysisData();
    if (!data?.items) return [];
    return data.items.filter((item: any) => item.source_type === 'assessment');
  });

  constructor() {
    this.loadAgendaCandidates();
  }

  /** Navigate back to the Agendas view. */
  backToAgendas() {
    this.dataService.viewMode.set('agendas');
  }

  /** Load candidates from the agendaAnalysisCandidateIds signal (bypasses staged filter). */
  async loadAgendaCandidates() {
    this.searchQuery.set('');
    this.showSearch.set(false);
    this.searchMatchIndex.set(0);
    this.loading.set(true);
    this.error.set(null);
    this.tabScrollLeft.set(0);
    this.plannerAnalysisExpanded.set(false);

    try {
      const candidateIds = this.dataService.agendaAnalysisCandidateIds();
      if (candidateIds.length === 0) {
        this.loading.set(false);
        return;
      }

      // Fetch each candidate by ID
      const results = await Promise.allSettled(
        candidateIds.map(id => this.dataService.getHarvestCandidate(id))
      );

      // Deduplicate by harvest_id — one tab per harvest
      const seenHarvests = new Map<string, any>();
      let failedFetches = 0;
      for (const result of results) {
        if (result.status === 'fulfilled' && result.value) {
          const candidate = result.value;
          const hid = candidate.harvestId;
          if (hid && !seenHarvests.has(hid)) {
            seenHarvests.set(hid, candidate);
          }
        } else {
          failedFetches++;
        }
      }

      const tabList: TabData[] = Array.from(seenHarvests.entries()).map(([harvestId, candidate]) => ({
        candidate,
        harvestId,
        harvestTitle: candidate.harvestSource || harvestId.slice(0, 12),
        transcriptUnits: [],
        transcriptStats: null,
        transcriptCandidates: [],
        loaded: false,
        loading: false,
      }));

      this.tabs.set(tabList);

      if (tabList.length > 0) {
        const total = candidateIds.length;
        const loaded = seenHarvests.size;
        const msg = `Loaded ${loaded} harvest${loaded !== 1 ? 's' : ''}` +
          (failedFetches > 0 ? ` (${failedFetches} candidate${failedFetches !== 1 ? 's' : ''} unavailable)` : '') +
          ` from ${total} candidate${total !== 1 ? 's' : ''}.`;
        this.toastService.show(msg, failedFetches > 0 ? 'info' : 'success');
        this.loadTranscript(0);
      } else if (candidateIds.length > 0) {
        this.toastService.show(
          `${candidateIds.length} candidate${candidateIds.length !== 1 ? 's' : ''} could not be fetched — they may have been deleted.`,
          'error'
        );
      }
    } catch (err: any) {
      this.error.set(err.message || 'Failed to load candidates');
    } finally {
      this.loading.set(false);
    }
  }

  async loadStagedCandidates() {
    // Keep as fallback for the Analysis view (not used by Agenda Analysis)
    return this.loadAgendaCandidates();
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
      setTimeout(() => document.getElementById('agenda-analysis-search-input')?.focus(), 0);
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
      const marks = document.querySelectorAll('#agenda-analysis-content .agenda-analysis-highlight');
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
    return escaped.replace(regex, '<mark class="agenda-analysis-highlight">$1</mark>');
  }

  /** Close a tab: unset staged → linked (non-terminal), remove from tracked IDs,
   *  delete the agenda item from the DB, and drop the tab. */
  async closeTab(event: MouseEvent, tabIndex: number) {
    event.stopPropagation();
    const tab = this.tabs()[tabIndex];
    if (!tab) return;

    const candidateId = tab.candidate.id;
    const agendaId = this.dataService.agendaAnalysisData()?.id;

    try {
      // Unset staged → linked via PATCH (bypasses terminal state enforcement)
      await this.dataService.updateHarvestCandidate(candidateId, { status: 'linked' });
    } catch (err: any) {
      console.error('Failed to unmark candidate:', err);
      this.toastService.show('Failed to remove candidate from analysis', 'error');
      return;
    }

    // Remove from the tracked candidate IDs so Refresh won't bring it back
    this.dataService.agendaAnalysisCandidateIds.update(ids =>
      ids.filter(id => id !== candidateId)
    );

    // Delete the agenda item from the DB (best-effort — fires but doesn't block)
    if (agendaId) {
      this.dataService.deleteAgendaItem(agendaId, candidateId).catch(err =>
        console.error('Failed to delete agenda item:', err)
      );
    }

    this.toastService.show(`"${tab.candidate.title.slice(0, 40)}${tab.candidate.title.length > 40 ? '…' : ''}" removed from analysis`, 'info');

    // Remove the tab from the list
    this.tabs.update(list => {
      const updated = [...list];
      updated.splice(tabIndex, 1);
      return updated;
    });

    // Adjust active tab if current was removed or if out of bounds
    if (this.activeTabIndex() >= this.tabs().length) {
      this.activeTabIndex.set(Math.max(0, this.tabs().length - 1));
    }
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

  /** Mark a candidate as staged or rejected from the candidates list. */
  async toggleCandidateStatus(candidate: HarvestCandidate, status: CandidateStatus) {
    this.togglingCandidateId.set(candidate.id);
    try {
      if (status === 'staged') {
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

  // ── Finalize Agenda ──────────────────────────────────────────

  finalizing = signal(false);

  async finalizeAgenda() {
    const agendaId = this.dataService.agendaAnalysisData()?.id;
    if (!agendaId) {
      this.toastService.show('No agenda data loaded', 'error');
      return;
    }
    this.finalizing.set(true);
    try {
      const result = await this.dataService.finalizeAgenda(agendaId);
      if (result?.ok) {
        this.toastService.show(`Specification created (${result.spec_id.slice(0, 8)}…)`, 'success');
        this.dataService.viewMode.set('specifications');
      } else {
        this.toastService.show('Failed to finalize agenda — server did not return OK.', 'error');
      }
    } catch (err: any) {
      console.error('Failed to finalize agenda:', err);
      this.toastService.show(err.message || 'Failed to finalize agenda', 'error');
    } finally {
      this.finalizing.set(false);
    }
  }

  // ── New Agenda Dialog ──────────────────────────────────────────

  showNewAgendaDialog = signal(false);
  newAgendaTitle = signal('');
  creatingAgenda = signal(false);
  createAgendaError = signal<string | null>(null);

  openNewAgendaDialog() {
    this.showNewAgendaDialog.set(true);
    this.newAgendaTitle.set('');
    this.createAgendaError.set(null);
    setTimeout(() => document.getElementById('agenda-analysis-agenda-title')?.focus(), 100);
  }

  cancelNewAgenda() {
    this.showNewAgendaDialog.set(false);
    this.newAgendaTitle.set('');
    this.createAgendaError.set(null);
  }

  async createAgenda() {
    const title = this.newAgendaTitle().trim();
    if (!title) return;

    this.creatingAgenda.set(true);
    this.createAgendaError.set(null);

    // Collect all staged candidate IDs from all open tabs
    const candidateIds = this.tabs().map(t => t.candidate.id);

    try {
      const result = await this.dataService.promoteToAgenda(candidateIds, title);
      if (result.ok) {
        this.toastService.show(`Agenda "${title}" created with ${result.candidates_used} candidates`, 'success');
        this.showNewAgendaDialog.set(false);
        this.newAgendaTitle.set('');
        // Switch to agendas view so the user can see it
        this.dataService.viewMode.set('agendas');
      } else {
        this.createAgendaError.set('Failed to create agenda — server did not return OK.');
      }
    } catch (err: any) {
      console.error('Failed to create agenda:', err);
      this.createAgendaError.set(err.message || 'An unexpected error occurred.');
    } finally {
      this.creatingAgenda.set(false);
    }
  }

  // -- Transform to Requirement --
  transformingId = signal<string | null>(null);

  async transformToRequirement(candidate: HarvestCandidate) {
    if (!candidate.systemId) return;
    this.transformingId.set(candidate.id);
    try {
      await this.dataService.addRequirement({
        title: candidate.title || 'Untitled Candidate',
        description: candidate.intentDescription || '',
        status: 'Backlog',
        priority: 'Medium',
        reqType: 'Task',
        candidateId: candidate.id,
        systemId: candidate.systemId,
        subsystemId: candidate.subsystemId || undefined,
        featureId: candidate.featureId || undefined,
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
