import { Component, inject, signal, computed, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DataService } from '../services/data.service';
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

  agendas = signal<any[]>([]);
  count = signal(0);
  loading = signal(false);
  error = signal<string | null>(null);

  // Filters
  statusFilter = signal<string | null>(null);

  // Expand/collapse
  expandedAgendaIds = signal<Set<string>>(new Set());

  // Detail view state
  selectedAgendaId = signal<string | null>(null);
  selectedAgendaData = signal<any | null>(null);

  selectedAgenda = computed(() => this.selectedAgendaData());

  // Retry trigger
  retryTrigger = signal(0);

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

  async selectAgenda(agenda: any) {
    const newId = this.selectedAgendaId() === agenda.id ? null : agenda.id;
    this.selectedAgendaId.set(newId);
    if (newId) {
      this.selectedAgendaData.set(agenda);
      const full = await this.dataService.getAgenda(agenda.id);
      if (full) this.selectedAgendaData.set(full);
    } else {
      this.selectedAgendaData.set(null);
    }
  }

  closeDetail() {
    this.selectedAgendaId.set(null);
    this.selectedAgendaData.set(null);
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
