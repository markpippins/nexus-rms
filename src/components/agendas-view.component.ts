import { Component, inject, signal, computed, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DataService } from '../services/data.service';
import { ToastService } from '../services/toast.service';
import { formatDate, getStatusColor, createHierarchyLabel, getCohesionColor, getCohesionBg } from '../app/utils/view-helpers';

@Component({
  selector: 'app-agendas-view',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './agendas-view.component.html',
  host: { class: 'flex-1 flex flex-col min-h-0' },
})
export class AgendasViewComponent {
  dataService = inject(DataService);
  toastService = inject(ToastService);

  agendas = signal<any[]>([]);
  count = signal(0);
  loading = signal(false);
  error = signal<string | null>(null);

  // Filters
  statusFilter = signal<string | null>(null);

  // Expand/collapse
  expandedAgendaIds = signal<Set<string>>(new Set());

  // Retry trigger
  retryTrigger = signal(0);

  /** Whether we are currently processing an agenda click (clear + mark + navigate). */
  openingAgenda = signal(false);

  private readonly STATUS_COLORS: Record<string, string> = {
    draft: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400',
    ready_for_review: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
    in_review: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    specified: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
    archived: 'bg-gray-200 text-gray-500 dark:bg-gray-600 dark:text-gray-400 line-through',
  };

  readonly hierarchyLabel = createHierarchyLabel(this.dataService);

  filteredAgendas = computed(() => {
    const term = this.dataService.listViewSearchTerm().toLowerCase().trim();
    let result = this.agendas();
    if (this.statusFilter()) {
      result = result.filter(a => a.status === this.statusFilter());
    }
    if (term) {
      result = result.filter((a: any) =>
        (a.title || '').toLowerCase().includes(term) ||
        (a.scope || '').toLowerCase().includes(term) ||
        (a.planner_analysis || '').toLowerCase().includes(term)
      );
    }
    return this.dataService.sortByMode(result);
  });

  statusCounts = computed(() => {
    const counts: Record<string, number> = {};
    for (const a of this.agendas()) {
      const s = a.status || 'draft';
      counts[s] = (counts[s] || 0) + 1;
    }
    return counts;
  });

  totalItems = computed(() => {
    return this.agendas().reduce((sum, a) => sum + (a.item_count || a.items?.length || 0), 0);
  });

  constructor() {
    let requestId = 0;

    effect(() => {
      const sysId = this.dataService.selectedSystemId();
      this.retryTrigger();
      const subId = this.dataService.selectedSubsystemId();
      const featId = this.dataService.selectedFeatureId();

      const currentId = ++requestId;
      this.loading.set(true);
      this.error.set(null);

      let promise: Promise<{ agendas: any[]; count: number }>;
      if (featId) {
        promise = this.dataService.getFeatureAgendas(featId).then(r => ({ agendas: r.agendas, count: r.count }));
      } else if (subId) {
        promise = this.dataService.getSubsystemAgendas(subId).then(r => ({ agendas: r.agendas, count: r.count }));
      } else if (sysId) {
        promise = this.dataService.getSystemAgendas(sysId).then(r => ({ agendas: r.agendas, count: r.count }));
      } else {
        // No hierarchy selected — show all agendas unfiltered
        promise = this.dataService.listAgendas(500).then(r => ({ agendas: r.agendas, count: r.count }));
      }

      promise.then(({ agendas, count }) => {
        if (currentId !== requestId) return;
        this.agendas.set(agendas);
        this.count.set(count);
        this.loading.set(false);
      }).catch(err => {
        if (currentId !== requestId) return;
        this.error.set(err.message || 'Failed to fetch agendas');
        this.loading.set(false);
      });
    });
  }

  /**
   * When an agenda card is clicked:
   * 1. Fetch the full agenda (to get item source_ids)
   * 2. Clear the "useful" flag from all candidates
   * 3. Mark the agenda's candidate items as "useful"
   * 4. Navigate to the Agenda Analysis view
   */
  async selectAgenda(agenda: any) {
    if (this.openingAgenda()) return;
    this.openingAgenda.set(true);

    try {
      // 1. Get full agenda with items, resolve candidate IDs from both direct
      //    harvest_candidate items AND intent_record items that link to candidates.
      const full = await this.dataService.getAgenda(agenda.id);
      const items = full?.items || [];

      // Direct harvest_candidate items
      const directCandidateIds = items
        .filter((item: any) => item.source_type === 'harvest_candidate')
        .map((item: any) => item.source_id)
        .filter(Boolean);

      // Intent record items — fetch each and extract its candidate_id (with source_ref fallback)
      const intentRecordItems = items.filter((item: any) => item.source_type === 'intent_record');
      const intentCandidateIds: string[] = [];
      let unresolvableIntentRecords = 0;
      if (intentRecordItems.length > 0) {
        const intentResults = await Promise.allSettled(
          intentRecordItems.map((item: any) => this.dataService.getIntentRecord(item.source_id))
        );
        for (const result of intentResults) {
          if (result.status === 'fulfilled' && result.value) {
            // Prefer candidate_id, fall back to source_ref (both point to the same harvest candidate)
            const cid = result.value.candidate_id || result.value.source_ref;
            if (cid) {
              intentCandidateIds.push(cid);
            } else {
              unresolvableIntentRecords++;
            }
          } else {
            unresolvableIntentRecords++;
          }
        }
      }

      // Assessment items — can't resolve to candidates, track for warning
      const assessmentCount = items.filter((item: any) => item.source_type === 'assessment').length;

      const agendaCandidateIds = new Set<string>([...directCandidateIds, ...intentCandidateIds]);

      if (agendaCandidateIds.size === 0) {
        // If there are assessment items, still navigate so the user can see them
        if (assessmentCount > 0) {
          this.dataService.agendaAnalysisCandidateIds.set([]);
          this.dataService.agendaAnalysisData.set(full || agenda);
          this.dataService.viewMode.set('agenda-analysis');
          this.toastService.show(
            `No harvest candidates found, but ${assessmentCount} assessment${assessmentCount !== 1 ? 's' : ''} available.`,
            'info'
          );
          return;
        }
        const parts: string[] = [];
        if (items.length > 0) parts.push(`${items.length} total items`);
        if (intentRecordItems.length > 0) parts.push(`${intentRecordItems.length} intent records`);
        if (unresolvableIntentRecords > 0) parts.push(`${unresolvableIntentRecords} unresolvable intent records`);
        this.toastService.show(
          'No harvest candidates found' + (parts.length > 0 ? ' — ' + parts.join(', ') : '') + '.',
          'info'
        );
        return;
      }

      // 2. Clear existing "useful" flags via direct PATCH (bypasses terminal state restrictions)
      let previouslyUsefulIds: string[] = [];
      try {
        const data = await this.dataService.listHarvestCandidates({ limit: 500 });
        const usefulOnes = (data.candidates || []).filter((c: any) => c.status === 'useful');
        previouslyUsefulIds = usefulOnes.map((c: any) => c.id);
        for (const c of usefulOnes) {
          await this.dataService.updateHarvestCandidate(c.id, { status: 'linked' });
        }
      } catch (err: any) {
        console.error('Failed to clear existing useful flags:', err);
      }

      // 3. Mark the agenda's candidates as useful (direct PATCH, bypasses terminal state)
      let promotedCount = 0;
      const promotionErrors: string[] = [];
      for (const candidateId of agendaCandidateIds) {
        try {
          await this.dataService.updateHarvestCandidate(candidateId, { status: 'useful' });
          promotedCount++;
        } catch (err: any) {
          console.error(`Failed to mark candidate ${candidateId} as useful:`, err);
          promotionErrors.push(candidateId);
        }
      }

      if (promotedCount === 0) {
        // Restore previously useful candidates since we have nothing new to show
        if (previouslyUsefulIds.length > 0) {
          let restoredCount = 0;
          for (const id of previouslyUsefulIds) {
            try {
              await this.dataService.updateHarvestCandidate(id, { status: 'useful' });
              restoredCount++;
            } catch (err: any) {
              console.error(`Failed to restore candidate ${id}:`, err);
            }
          }
          if (restoredCount > 0) {
            this.toastService.show(
              `No agenda candidates loaded — restored ${restoredCount} previously useful candidate${restoredCount !== 1 ? 's' : ''}.`,
              'info'
            );
          }
        }
        this.toastService.show('Failed to load any candidates for this agenda.', 'error');
        return;
      }

      this.toastService.show(
        `Loaded ${promotedCount} candidate${promotedCount !== 1 ? 's' : ''} from "${(full?.title || agenda.title || 'Untitled Agenda').slice(0, 40)}"`,
        'success'
      );

      // 4. Pass candidate IDs and agenda data to the agenda analysis view and navigate
      this.dataService.agendaAnalysisCandidateIds.set([...agendaCandidateIds]);
      this.dataService.agendaAnalysisData.set(full || agenda);
      this.dataService.viewMode.set('agenda-analysis');
    } catch (err: any) {
      console.error('Failed to open agenda:', err);
      this.toastService.show('Failed to open agenda: ' + (err.message || 'unknown error'), 'error');
    } finally {
      this.openingAgenda.set(false);
    }
  }

  toggleExpand(agendaId: string) {
    this.expandedAgendaIds.update(set => {
      const next = new Set(set);
      if (next.has(agendaId)) {
        next.delete(agendaId);
      } else {
        next.add(agendaId);
      }
      return next;
    });
  }

  isExpanded(agendaId: string): boolean {
    return this.expandedAgendaIds().has(agendaId);
  }

  getStatusColor(status: string): string {
    return getStatusColor(status, this.STATUS_COLORS);
  }

  getStatusLabel(status: string): string {
    const labels: Record<string, string> = {
      draft: 'Draft',
      ready_for_review: 'Ready',
      in_review: 'In Review',
      specified: 'Specified',
      archived: 'Archived',
    };
    return labels[status] || status;
  }

  readonly getCohesionColor = getCohesionColor;
  readonly getCohesionBg = getCohesionBg;

  getItemIncludedColor(included: boolean | null): string {
    if (included === true) return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400';
    if (included === false) return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400';
    return 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400';
  }

  getItemIncludedLabel(included: boolean | null): string {
    if (included === true) return 'In Spec';
    if (included === false) return 'Rejected';
    return 'Pending';
  }

  readonly formatDate = formatDate;

  getSourceTypeIcon(sourceType: string): string {
    const icons: Record<string, string> = {
      intent_record: '📋',
      requirement: '📐',
      agent_record: '📝',
      harvest_candidate: '💡',
      knowledge_graph_entry: '🧠',
    };
    return icons[sourceType] || '📌';
  }

  getCandidateStatusColor(status: string | null): string {
    const colors: Record<string, string> = {
      pending: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400',
      linked: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
      useful: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
      promoted: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
      rejected: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
    };
    return colors[status || ''] || 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400';
  }

  viewCandidate(sourceId: string) {
    this.dataService.selectedHarvestCandidateId.set(sourceId);
    this.dataService.viewMode.set('candidates');
  }
}
