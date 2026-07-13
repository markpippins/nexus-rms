import { Component, inject, signal, computed, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DataService } from '../services/data.service';
import { formatDate, formatFullDate, getStatusColor, getStatusIcon, createHierarchyLabel } from '../app/utils/view-helpers';

@Component({
  selector: 'app-work-requests-view',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './work-requests-view.component.html',
  host: { class: 'flex-1 flex flex-col min-h-0' },
})
export class WorkRequestsViewComponent {
  dataService = inject(DataService);

  readonly workRequests = signal<any[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly retryTrigger = signal(0);

  readonly statusFilter = signal<string | null>(null);

  // Detail view state
  selectedWorkRequestId = signal<string | null>(null);
  selectedWorkRequestData = signal<any | null>(null);

  selectedWorkRequest = computed(() => this.selectedWorkRequestData());

  readonly canonicalStatuses = ['DRAFT', 'APPROVED', 'DISPATCHED', 'COMPLETED', 'CANCELLED'];

  readonly filteredWorkRequests = computed(() => {
    const term = this.dataService.listViewSearchTerm().toLowerCase().trim();
    const filter = this.statusFilter();
    let all = this.workRequests();
    if (term) {
      all = all.filter((wr: any) =>
        (wr.title || '').toLowerCase().includes(term) ||
        (wr.description || '').toLowerCase().includes(term) ||
        (wr.intent || '').toLowerCase().includes(term)
      );
    }
    if (!filter) return all;
    return this.dataService.sortByMode(all.filter(wr => wr.status === filter));
  });

  readonly statusCounts = computed(() => {
    const counts: Record<string, number> = {};
    for (const s of this.canonicalStatuses) counts[s] = 0;
    for (const wr of this.workRequests()) {
      const s = wr.status || 'DRAFT';
      counts[s] = (counts[s] || 0) + 1;
    }
    return counts;
  });

  private readonly STATUS_COLORS: Record<string, string> = {
    DRAFT: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
    APPROVED: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    DISPATCHED: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
    COMPLETED: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
    CANCELLED: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  };

  private readonly STATUS_ICONS: Record<string, string> = {
    DRAFT: '📝',
    APPROVED: '✅',
    DISPATCHED: '🚀',
    COMPLETED: '🏁',
    CANCELLED: '❌',
  };

  readonly hierarchyLabel = createHierarchyLabel(this.dataService, { fullPath: true });

  constructor() {
    let requestId = 0;

    effect(() => {
      const sysId = this.dataService.selectedSystemId();
      const subId = this.dataService.selectedSubsystemId();
      const featId = this.dataService.selectedFeatureId();
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const _retry = this.retryTrigger();

      const currentId = ++requestId;
      this.loading.set(true);
      this.error.set(null);

      let promise: Promise<{ workRequests: any[]; count: number }>;
      if (featId) {
        promise = this.dataService.getFeatureWorkRequests(featId);
      } else if (subId) {
        promise = this.dataService.getSubsystemWorkRequests(subId);
      } else if (sysId) {
        promise = this.dataService.getSystemWorkRequests(sysId);
      } else {
        // No hierarchy selected — show all work requests unfiltered
        promise = this.dataService.listWorkRequests(500).then(r => ({ workRequests: r.workRequests, count: r.count }));
      }

      promise
        .then(({ workRequests }) => {
          if (currentId !== requestId) return;
          this.workRequests.set(workRequests);
          this.loading.set(false);
        })
        .catch((err: any) => {
          if (currentId !== requestId) return;
          this.error.set(err.message || 'Failed to load work requests');
          this.loading.set(false);
        });
    });
  }

  async selectWorkRequest(wr: any) {
    const newId = this.selectedWorkRequestId() === wr.id ? null : wr.id;
    this.selectedWorkRequestId.set(newId);
    if (newId) {
      this.selectedWorkRequestData.set(wr);
      const full = await this.dataService.getWorkRequest(wr.id);
      if (full) this.selectedWorkRequestData.set(full);
    } else {
      this.selectedWorkRequestData.set(null);
    }
  }

  closeDetail() {
    this.selectedWorkRequestId.set(null);
    this.selectedWorkRequestData.set(null);
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

  readonly formatDate = formatDate;
  readonly formatFullDate = formatFullDate;
}
