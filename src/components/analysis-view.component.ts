import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DataService } from '../services/data.service';
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

  selectTab(index: number) {
    this.activeTabIndex.set(index);
    this.loadTranscript(index);
  }

  activeTab = computed(() => this.tabs()[this.activeTabIndex()] || null);

  // ── Helpers ──────────────────────────────────────────────────

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
}
