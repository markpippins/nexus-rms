import { Component, inject, signal, computed, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DataService } from '../services/data.service';
import { ListViewSortBarComponent } from './list-view-sort-bar.component';
import { formatDate, getStatusColor, createHierarchyLabel } from '../app/utils/view-helpers';

@Component({
  selector: 'app-specifications-view',
  standalone: true,
  imports: [CommonModule, FormsModule, ListViewSortBarComponent],
  templateUrl: './specifications-view.component.html',
  host: { class: 'flex-1 flex flex-col min-h-0' },
})
export class SpecificationsViewComponent {
  dataService = inject(DataService);

  specifications = signal<any[]>([]);
  count = signal(0);
  loading = signal(false);
  error = signal<string | null>(null);

  // Filters
  sourceTypeFilter = signal<string | null>(null);

  // Retry trigger
  retryTrigger = signal(0);

  // Detail view state
  selectedSpecId = signal<string | null>(null);
  selectedSpecData = signal<any | null>(null);

  // Link requirements state
  linkingRequirements = signal(false);
  linkResult = signal<{ linked: number; candidate_count: number; requirement_count: number } | null>(null);

  selectedSpec = computed(() => this.selectedSpecData());

  private readonly STATUS_COLORS: Record<string, string> = {
    draft: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400',
    ready_for_review: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
    in_review: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    specified: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
    archived: 'bg-gray-200 text-gray-500 dark:bg-gray-600 dark:text-gray-400',
  };

  readonly hierarchyLabel = createHierarchyLabel(this.dataService);

  filteredSpecs = computed(() => {
    const term = this.dataService.listViewSearchTerm().toLowerCase().trim();
    let result = this.specifications();
    if (this.sourceTypeFilter()) {
      result = result.filter(s => {
        const items = s.items || [];
        return items.some((i: any) => i.source_type === this.sourceTypeFilter());
      });
    }
    if (term) {
      result = result.filter((s: any) => {
        const items = s.items || [];
        return (s.change_summary || '').toLowerCase().includes(term) ||
          (s.agenda_title || '').toLowerCase().includes(term) ||
          items.some((i: any) =>
            (i.title || '').toLowerCase().includes(term) ||
            (i.body || '').toLowerCase().includes(term)
          );
      });
    }
    return this.dataService.sortByMode(result);
  });

  sourceTypeCounts = computed(() => {
    const counts: Record<string, number> = {};
    for (const s of this.specifications()) {
      const items = s.items || [];
      for (const item of items) {
        const st = item.source_type || 'unknown';
        counts[st] = (counts[st] || 0) + 1;
      }
    }
    return counts;
  });

  /** Get item count for a spec revision. */
  itemCount(spec: any): number {
    return (spec.items || []).length;
  }

  // Group specs by agenda
  groupedByAgenda = computed(() => {
    const groups: Record<string, { agenda_title: string; agenda_status: string; items: any[] }> = {};
    for (const spec of this.filteredSpecs()) {
      const key = spec.agenda_id || '_unlinked';
      if (!groups[key]) {
        groups[key] = {
          agenda_title: spec.agenda_title || 'Untitled Agenda',
          agenda_status: spec.agenda_status || 'draft',
          items: [],
        };
      }
      groups[key].items.push(spec);
    }
    return Object.entries(groups);
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

      let promise: Promise<{ specifications: any[]; count: number }>;
      if (featId) {
        promise = this.dataService.getFeatureSpecifications(featId).then(r => ({ specifications: r.specifications, count: r.count }));
      } else if (subId) {
        promise = this.dataService.getSubsystemSpecifications(subId).then(r => ({ specifications: r.specifications, count: r.count }));
      } else if (sysId) {
        promise = this.dataService.getSystemSpecifications(sysId).then(r => ({ specifications: r.specifications, count: r.count }));
      } else {
        // No hierarchy selected — show all specifications unfiltered
        promise = this.dataService.listSpecifications(500).then(r => ({ specifications: r.specifications, count: r.count }));
      }

      promise.then(({ specifications, count }) => {
        if (currentId !== requestId) return;
        this.specifications.set(specifications);
        this.count.set(count);
        this.loading.set(false);
      }).catch(err => {
        if (currentId !== requestId) return;
        this.error.set(err.message || 'Failed to fetch specifications');
        this.loading.set(false);
      });
    });
  }

  async selectSpec(spec: any) {
    const newId = this.selectedSpecId() === spec.id ? null : spec.id;
    this.selectedSpecId.set(newId);
    if (newId) {
      this.selectedSpecData.set(spec);
      const full = await this.dataService.getSpecification(spec.id);
      if (full) this.selectedSpecData.set(full);
    } else {
      this.selectedSpecData.set(null);
    }
  }

  closeDetail() {
    this.selectedSpecId.set(null);
    this.selectedSpecData.set(null);
    this.linkResult.set(null);
  }

  async linkRequirements(specId: string) {
    this.linkingRequirements.set(true);
    this.linkResult.set(null);
    try {
      const result = await this.dataService.linkSpecRequirements(specId);
      if (result?.ok) {
        this.linkResult.set({ linked: result.linked, candidate_count: result.candidate_count, requirement_count: result.requirement_count });
      } else {
        this.linkResult.set({ linked: 0, candidate_count: 0, requirement_count: 0 });
      }
    } catch (err: any) {
      console.error('Failed to link requirements:', err);
    } finally {
      this.linkingRequirements.set(false);
    }
  }

  getStatusColor(status: string): string {
    return getStatusColor(status, this.STATUS_COLORS);
  }

  getSourceTypeIcon(sourceType: string): string {
    const icons: Record<string, string> = {
      requirement: '📐',
      agent_record: '📝',
      harvest_candidate: '💡',
      knowledge_graph_entry: '🧠',
    };
    return icons[sourceType] || '📌';
  }

  readonly formatDate = formatDate;
}
