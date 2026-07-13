import { Component, inject, signal, computed, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DataService } from '../services/data.service';
import { formatDate, getStatusColor, getStatusIcon, createHierarchyLabel } from '../app/utils/view-helpers';

@Component({
  selector: 'app-implementation-plans-view',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './implementation-plans-view.component.html',
  host: { class: 'flex-1 flex flex-col min-h-0' },
})
export class ImplementationPlansViewComponent {
  dataService = inject(DataService);

  plans = signal<any[]>([]);
  count = signal(0);
  loading = signal(false);
  error = signal<string | null>(null);

  // Filters
  statusFilter = signal<string | null>(null);

  // Dynamic status list from DB (populated on init)
  availableStatuses = signal<string[]>([]);

  // Retry trigger
  retryTrigger = signal(0);

  private readonly STATUS_COLORS: Record<string, string> = {
    pending: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
    planning: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    proposed: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
    active: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
    completed: 'bg-gray-200 text-gray-600 dark:bg-gray-600 dark:text-gray-400',
  };

  private readonly STATUS_ICONS: Record<string, string> = {
    pending: '⏳',
    planning: '📐',
    proposed: '💡',
    active: '🚧',
    completed: '✅',
  };

  readonly hierarchyLabel = createHierarchyLabel(this.dataService);

  filteredPlans = computed(() => {
    const term = this.dataService.listViewSearchTerm().toLowerCase().trim();
    let result = this.plans();
    if (this.statusFilter()) {
      result = result.filter(p => p.status === this.statusFilter());
    }
    if (term) {
      result = result.filter((p: any) =>
        (p.title || '').toLowerCase().includes(term) ||
        (p.goal || '').toLowerCase().includes(term) ||
        (p.id || '').toLowerCase().includes(term)
      );
    }
    return this.dataService.sortByMode(result);
  });

  statusCounts = computed(() => {
    const counts: Record<string, number> = {};
    for (const p of this.plans()) {
      const s = p.status || 'unknown';
      counts[s] = (counts[s] || 0) + 1;
    }
    return counts;
  });

  constructor() {
    let requestId = 0;

    // Fetch available statuses once on init
    this.dataService.listPlanStatuses().then(statuses => {
      this.availableStatuses.set(statuses);
    });

    effect(() => {
      const sysId = this.dataService.selectedSystemId();
      this.retryTrigger();
      const subId = this.dataService.selectedSubsystemId();
      const featId = this.dataService.selectedFeatureId();

      const currentId = ++requestId;
      this.loading.set(true);
      this.error.set(null);

      let promise: Promise<{ plans: any[]; count: number }>;
      if (featId) {
        promise = this.dataService.getFeatureImplementationPlans(featId).then(r => ({ plans: r.plans, count: r.count }));
      } else if (subId) {
        promise = this.dataService.getSubsystemImplementationPlans(subId).then(r => ({ plans: r.plans, count: r.count }));
      } else if (sysId) {
        promise = this.dataService.getSystemImplementationPlans(sysId).then(r => ({ plans: r.plans, count: r.count }));
      } else {
        // No hierarchy selected — show all plans unfiltered
        promise = this.dataService.listPlans().then(r => ({ plans: r.plans, count: r.count }));
      }

      promise.then(({ plans, count }) => {
        if (currentId !== requestId) return;
        this.plans.set(plans);
        this.count.set(count);
        this.loading.set(false);
      }).catch(err => {
        if (currentId !== requestId) return;
        this.error.set(err.message || 'Failed to fetch plans');
        this.loading.set(false);
      });
    });
  }

  setStatusFilter(status: string | null) {
    this.statusFilter.set(status);
  }

  getStatusColor(status: string): string {
    return getStatusColor(status, this.STATUS_COLORS);
  }

  getStatusIcon(status: string): string {
    return getStatusIcon(status, this.STATUS_ICONS);
  }

  formatSize(bytes: number): string {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  readonly formatDate = formatDate;
}
