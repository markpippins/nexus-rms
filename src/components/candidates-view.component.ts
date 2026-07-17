import { Component, inject, signal, computed, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DataService } from '../services/data.service';
import { HarvestCandidate } from '../models/data.models';
import { formatDate, formatFullDate, getStatusColor, createHierarchyLabel, CANDIDATE_STATUS_COLORS, lookupHierarchyName, getBlockTypeBadgeClasses } from '../app/utils/view-helpers';

@Component({
  selector: 'app-candidates-view',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './candidates-view.component.html',
  host: { class: 'flex-1 flex flex-col min-h-0' },
})
export class CandidatesViewComponent {
  dataService = inject(DataService);

  candidates = signal<HarvestCandidate[]>([]);
  count = signal(0);
  loading = signal(false);
  error = signal<string | null>(null);

  // Filters
  hideCompleted = signal(false);
  statusFilter = signal<string | null>(null);

  // Retry trigger (bump to re-fetch on error)
  retryTrigger = signal(0);

  // Promote/reject state
  promotingId = signal<string | null>(null);
  promotingToRequirementId = signal<string | null>(null);
  promotionError = signal<string | null>(null);

  // Detail view state
  selectedCandidateId = signal<string | null>(null);

  // Transcript state (loaded when candidate detail opens)
  transcriptLoading = signal(false);
  transcriptUnits = signal<any[]>([]);
  transcriptStats = signal<any>(null);
  transcriptTitle = signal('');

  // Transcript find-in-file state
  transcriptSearchQuery = signal('');
  transcriptShowSearch = signal(false);
  transcriptSearchMatchIndex = signal(0);

  transcriptTotalMatches = computed(() => {
    const query = this.transcriptSearchQuery().toLowerCase().trim();
    if (!query) return 0;
    let count = 0;
    for (const unit of this.transcriptUnits()) {
      for (const block of unit.blocks) {
        const text = block.content || (block.items || []).join(' ') || '';
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
      this.transcriptSearchMatchIndex.set(0);
    } else {
      setTimeout(() => document.getElementById('candidate-transcript-search')?.focus(), 0);
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
      const marks = document.querySelectorAll('#candidate-transcript-content .transcript-highlight');
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
    const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    if (!query) return escaped;
    const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    return escaped.replace(regex, '<mark class="transcript-highlight">$1</mark>');
  }

  selectedCandidate = computed(() => {
    const id = this.selectedCandidateId();
    if (!id) return null;
    return this.candidates().find(c => c.id === id) || null;
  });

  readonly hierarchyLabel = createHierarchyLabel(this.dataService);

  // Filtered candidates
  filteredCandidates = computed(() => {
    const term = this.dataService.listViewSearchTerm().toLowerCase().trim();
    let result = this.candidates();
    if (this.hideCompleted()) {
      result = result.filter(c => !c.completed);
    }
    if (this.statusFilter()) {
      result = result.filter(c => c.status === this.statusFilter());
    }
    if (term) {
      result = result.filter((c: any) =>
        (c.title || '').toLowerCase().includes(term) ||
        (c.intent_description || '').toLowerCase().includes(term) ||
        (c.status || '').toLowerCase().includes(term)
      );
    }
    return this.dataService.sortByMode(result);
  });

  statusCounts = computed(() => {
    const counts: Record<string, number> = {};
    for (const c of this.candidates()) {
      const s = c.status || 'unknown';
      counts[s] = (counts[s] || 0) + 1;
    }
    return counts;
  });

  constructor() {
    let requestId = 0;

    effect(() => {
      const sysId = this.dataService.selectedSystemId();
      // Track retry trigger to force re-fetch on manual retry
      this.retryTrigger();
      const subId = this.dataService.selectedSubsystemId();
      const featId = this.dataService.selectedFeatureId();

      const currentId = ++requestId;
      this.loading.set(true);
      this.error.set(null);

      let promise: Promise<{ candidates: HarvestCandidate[]; count: number }>;
      if (featId) {
        promise = this.dataService.getFeatureHarvestCandidates(featId).then(r => ({ candidates: r.candidates, count: r.count }));
      } else if (subId) {
        promise = this.dataService.getSubsystemHarvestCandidates(subId).then(r => ({ candidates: r.candidates, count: r.count }));
      } else if (sysId) {
        promise = this.dataService.getSystemHarvestCandidates(sysId).then(r => ({ candidates: r.candidates, count: r.count }));
      } else {
        // No hierarchy selected — show all candidates unfiltered
        promise = this.dataService.listHarvestCandidates({ limit: 500 }).then(r => ({ candidates: r.candidates, count: r.count }));
      }

      promise.then(({ candidates, count }) => {
        if (currentId !== requestId) return;
        this.candidates.set(candidates);
        this.count.set(count);
        this.loading.set(false);
      }).catch(err => {
        if (currentId !== requestId) return;
        this.error.set(err.message || 'Failed to fetch candidates');
        this.loading.set(false);
      });
    });
  }

  selectCandidate(candidate: HarvestCandidate) {
    const newId = this.selectedCandidateId() === candidate.id ? null : candidate.id;
    this.selectedCandidateId.set(newId);
    if (newId && candidate.harvest_id) {
      this.loadTranscript(candidate.harvest_id, candidate.harvest_source || '');
    } else {
      this.clearTranscript();
    }
  }

  async promoteCandidateToRequirement(candidate: HarvestCandidate) {
    this.promotingToRequirementId.set(candidate.id);
    this.promotionError.set(null);
    try {
      const newReq = await this.dataService.promoteCandidateToRequirement(candidate.id);
      if (newReq) {
        await this.dataService.refreshRequirements();
        if (newReq.systemId) this.dataService.selectedSystemId.set(newReq.systemId);
        if (newReq.subsystemId) this.dataService.selectedSubsystemId.set(newReq.subsystemId);
        if (newReq.featureId) this.dataService.selectedFeatureId.set(newReq.featureId);
        this.dataService.viewMode.set('board');
      } else {
        this.promotionError.set('Failed to create requirement — check console for details');
      }
    } catch (err: any) {
      this.promotionError.set(err.message || 'Promotion failed');
    } finally {
      this.promotingToRequirementId.set(null);
    }
  }

  closeDetail() {
    this.selectedCandidateId.set(null);
    this.clearTranscript();
    this.promotingToRequirementId.set(null);
    this.promotionError.set(null);
  }

  private async loadTranscript(harvestId: string, sourceTitle: string) {
    this.transcriptSearchQuery.set('');
    this.transcriptShowSearch.set(false);
    this.transcriptSearchMatchIndex.set(0);
    this.transcriptLoading.set(true);
    this.transcriptTitle.set(sourceTitle);
    try {
      const data = await this.dataService.getHarvestTranscript(harvestId);
      this.transcriptUnits.set(data.units || []);
      this.transcriptStats.set(data.stats);
      // Use the API-returned title if available, fall back to harvest source
      if (data.title) this.transcriptTitle.set(data.title);
    } catch (err: any) {
      console.error('Failed to load transcript:', err);
    } finally {
      this.transcriptLoading.set(false);
    }
  }

  private clearTranscript() {
    this.transcriptTitle.set('');
    this.transcriptUnits.set([]);
    this.transcriptStats.set(null);
    this.transcriptSearchQuery.set('');
    this.transcriptShowSearch.set(false);
    this.transcriptSearchMatchIndex.set(0);
    this.transcriptLoading.set(false);
  }


  readonly getBlockTypeBadgeClasses = getBlockTypeBadgeClasses;

  getHierarchyLabel(id: string, type: 'system' | 'subsystem' | 'feature'): string {
    return lookupHierarchyName(this.dataService, id, type);
  }

  readonly formatFullDate = formatFullDate;

  async promoteCandidate(candidate: HarvestCandidate) {
    this.promotingId.set(candidate.id);
    try {
      await this.dataService.promoteHarvestCandidate(candidate.id);
      this.candidates.update(list =>
        list.map(c => c.id === candidate.id ? { ...c, status: 'staged' } : c)
      );
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
      this.candidates.update(list =>
        list.map(c => c.id === candidate.id ? { ...c, status: 'rejected' } : c)
      );
    } catch (err: any) {
      console.error('Failed to reject candidate:', err);
    } finally {
      this.promotingId.set(null);
    }
  }

  getStatusColor(status: string): string {
    return getStatusColor(status, CANDIDATE_STATUS_COLORS);
  }

  readonly formatDate = formatDate;
}
