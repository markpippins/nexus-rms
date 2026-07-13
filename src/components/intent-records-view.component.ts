import { Component, inject, signal, computed, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DataService } from '../services/data.service';
import { formatDate, formatFullDate, getStatusColor, createHierarchyLabel, lookupHierarchyName, CANDIDATE_STATUS_COLORS } from '../app/utils/view-helpers';

@Component({
  selector: 'app-intent-records-view',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './intent-records-view.component.html',
  host: { class: 'flex-1 flex flex-col min-h-0' },
  styles: [`
    .scrollbar-thin {
      scrollbar-width: thin;
      scrollbar-color: #cbd5e1 transparent;
    }
    .dark .scrollbar-thin {
      scrollbar-color: #475569 transparent;
    }
    .scrollbar-thin::-webkit-scrollbar {
      width: 6px;
      height: 6px;
    }
    .scrollbar-thin::-webkit-scrollbar-track {
      background: transparent;
    }
    .scrollbar-thin::-webkit-scrollbar-thumb {
      background: #cbd5e1;
      border-radius: 3px;
    }
    .scrollbar-thin::-webkit-scrollbar-thumb:hover {
      background: #94a3b8;
    }
    .dark .scrollbar-thin::-webkit-scrollbar-thumb {
      background: #475569;
    }
    .dark .scrollbar-thin::-webkit-scrollbar-thumb:hover {
      background: #64748b;
    }
  `],
})
export class IntentRecordsViewComponent {
  dataService = inject(DataService);

  intentRecords = signal<any[]>([]);
  count = signal(0);
  loading = signal(false);
  error = signal<string | null>(null);

  // Detail view state
  selectedRecordId = signal<string | null>(null);
  selectedRecordData = signal<any | null>(null);
  recordLoading = signal(false);
  linkedCandidate = signal<any | null>(null);
  candidateLoading = signal(false);

  // Promote to requirement state
  promotingToRequirement = signal(false);
  promotionError = signal<string | null>(null);

  selectedRecord = computed(() => {
    return this.selectedRecordData();
  });

  // Filters
  statusFilter = signal<string | null>(null);

  // Retry trigger (bump to re-fetch on error)
  retryTrigger = signal(0);

  private readonly STATUS_COLORS: Record<string, string> = {
    draft: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400',
    pending: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
    approved: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
    rejected: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
    promoted: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    implemented: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  };

  readonly hierarchyLabel = createHierarchyLabel(this.dataService);

  // Filtered records
  filteredRecords = computed(() => {
    const term = this.dataService.listViewSearchTerm().toLowerCase().trim();
    let result = this.intentRecords();
    if (this.statusFilter()) {
      result = result.filter(r => r.status === this.statusFilter());
    }
    if (term) {
      result = result.filter((r: any) =>
        (r.title || '').toLowerCase().includes(term) ||
        (r.description || '').toLowerCase().includes(term) ||
        (r.source_type || '').toLowerCase().includes(term)
      );
    }
    return this.dataService.sortByMode(result);
  });

  statusCounts = computed(() => {
    const counts: Record<string, number> = {};
    for (const r of this.intentRecords()) {
      const s = r.status || 'unknown';
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

      let promise: Promise<{ intentRecords: any[]; count: number }>;
      if (featId) {
        promise = this.dataService.getFeatureIntentRecords(featId).then(r => ({ intentRecords: r.intentRecords, count: r.count }));
      } else if (subId) {
        promise = this.dataService.getSubsystemIntentRecords(subId).then(r => ({ intentRecords: r.intentRecords, count: r.count }));
      } else if (sysId) {
        promise = this.dataService.getSystemIntentRecords(sysId).then(r => ({ intentRecords: r.intentRecords, count: r.count }));
      } else {
        // No hierarchy selected — show all intent records unfiltered
        promise = this.dataService.listIntentRecords(500).then(r => ({ intentRecords: r.intentRecords, count: r.count }));
      }

      promise.then(({ intentRecords, count }) => {
        if (currentId !== requestId) return;
        this.intentRecords.set(intentRecords);
        this.count.set(count);
        this.loading.set(false);
      }).catch(err => {
        if (currentId !== requestId) return;
        this.error.set(err.message || 'Failed to fetch intent records');
        this.loading.set(false);
      });
    });
  }

  async selectRecord(record: any) {
    const newId = this.selectedRecordId() === record.id ? null : record.id;
    this.selectedRecordId.set(newId);
    if (newId) {
      // Show in-memory data immediately so detail view renders instantly
      this.selectedRecordData.set(record);
      // Upgrade from API (includes hierarchy fields even in scoped mode)
      this.recordLoading.set(true);
      try {
        const fullRecord = await this.dataService.getIntentRecord(record.id);
        if (fullRecord) this.selectedRecordData.set(fullRecord);
      } finally {
        this.recordLoading.set(false);
      }
      // Fetch linked candidate if present
      if (record.candidate_id) {
        this.candidateLoading.set(true);
        try {
          this.linkedCandidate.set(
            await this.dataService.getHarvestCandidate(record.candidate_id)
          );
        } finally {
          this.candidateLoading.set(false);
        }
      } else {
        this.linkedCandidate.set(null);
      }
    } else {
      this.selectedRecordData.set(null);
      this.linkedCandidate.set(null);
    }
  }

  async promoteToRequirement(record: any) {
    this.promotingToRequirement.set(true);
    this.promotionError.set(null);
    try {
      const newReq = await this.dataService.promoteIntentToRequirement(record.id);
      if (newReq) {
        // Refresh requirements list and switch to board view to edit the new requirement
        await this.dataService.refreshRequirements();
        // Select the system/subsystem/feature from the intent record for context
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
      this.promotingToRequirement.set(false);
    }
  }

  closeDetail() {
    this.selectedRecordId.set(null);
    this.selectedRecordData.set(null);
    this.linkedCandidate.set(null);
    this.promotionError.set(null);
    this.promotingToRequirement.set(false);
  }

  getHierarchyLabel(id: string, type: 'system' | 'subsystem' | 'feature'): string {
    return lookupHierarchyName(this.dataService, id, type);
  }

  getStatusColor(status: string): string {
    return getStatusColor(status, this.STATUS_COLORS);
  }

  getCandidateStatusColor(status: string): string {
    return getStatusColor(status, CANDIDATE_STATUS_COLORS);
  }

  readonly formatDate = formatDate;
  readonly formatFullDate = formatFullDate;
}
