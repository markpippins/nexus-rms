import { Component, inject, signal, computed, effect, HostListener, afterNextRender } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HierarchyNavComponent } from './components/hierarchy-nav.component';
import { KanbanBoardComponent } from './components/kanban-board.component';
import { AuditTreeComponent } from './components/audit-tree.component';
import { AuditViewerComponent } from './components/audit-viewer.component';
import { HarvestViewComponent } from './components/harvest-view.component';
import { AnalysisViewComponent } from './components/analysis-view.component';
import { CandidatesViewComponent } from './components/candidates-view.component';
import { IntentRecordsViewComponent } from './components/intent-records-view.component';
import { AgendasViewComponent } from './components/agendas-view.component';
import { SpecificationsViewComponent } from './components/specifications-view.component';
import { ImplementationPlansViewComponent } from './components/implementation-plans-view.component';
import { WorkRequestsViewComponent } from './components/work-requests-view.component';
import { ToastComponent } from './components/toast.component';
import { DataService } from './services/data.service';
import { formatDate, lookupHierarchyName } from './app/utils/view-helpers';
import { UiEventBusService } from './app/services/ui-event-bus.service';
import { HarvestCandidate } from './models/data.models';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule, HierarchyNavComponent, KanbanBoardComponent, AuditTreeComponent, AuditViewerComponent, HarvestViewComponent, AnalysisViewComponent, CandidatesViewComponent, IntentRecordsViewComponent, AgendasViewComponent, SpecificationsViewComponent, ImplementationPlansViewComponent, WorkRequestsViewComponent, ToastComponent],
  templateUrl: './app.component.html'
})
export class AppComponent {
  dataService = inject(DataService);
  private eventBus = inject(UiEventBusService);

  readonly MIN_SIDEBAR_WIDTH = 224; // w-56
  readonly MAX_SIDEBAR_WIDTH = 600;

  sidebarWidth = signal<number>(288); // Default w-72
  isResizing = signal<boolean>(false);

  // ── Service Health Detail (expandable in banner) ─────────────
  showServiceHealthDetail = signal(false);

  // ── Right Slide Panel (Backlog #4) ────────────────────────────
  showRightPanel = signal(false);
  rightPanelWidth = signal(380);
  isRightResizing = signal(false);
  harvestCandidates = signal<HarvestCandidate[]>([]);
  candidatesLoading = signal(false);
  candidatesCount = signal(0);
  private candidatesRequestId = 0;

  // ── Candidate Detail Panel State ─────────────────────────────
  promotingCandidateId = signal<string | null>(null);

  selectedCandidate = computed(() => {
    const id = this.dataService.selectedHarvestCandidateId();
    if (!id) return null;
    return this.harvestCandidates().find(c => c.id === id) || null;
  });

  closeCandidateDetail() {
    this.dataService.selectedHarvestCandidateId.set(null);
  }

  selectCandidateInPanel(candidate: HarvestCandidate) {
    if (this.dataService.selectedHarvestCandidateId() === candidate.id) {
      this.dataService.selectedHarvestCandidateId.set(null);
    } else {
      this.dataService.selectedHarvestCandidateId.set(candidate.id);
    }
  }

  readonly formatDate = formatDate;

  getHierarchyLabel(id: string, type: 'system' | 'subsystem' | 'feature'): string {
    return lookupHierarchyName(this.dataService, id, type);
  }

  async markCandidateUseful(candidate: HarvestCandidate) {
    this.promotingCandidateId.set(candidate.id);
    try {
      await this.dataService.promoteHarvestCandidate(candidate.id);
      // Update local state
      const updated = this.harvestCandidates().map(c =>
        c.id === candidate.id ? { ...c, status: 'useful' } : c
      );
      this.harvestCandidates.set(updated);
    } catch (err: any) {
      console.error('Failed to promote candidate:', err);
    } finally {
      this.promotingCandidateId.set(null);
    }
  }

  async rejectCandidateFromPanel(candidate: HarvestCandidate) {
    this.promotingCandidateId.set(candidate.id);
    try {
      await this.dataService.rejectHarvestCandidate(candidate.id);
      const updated = this.harvestCandidates().map(c =>
        c.id === candidate.id ? { ...c, status: 'rejected' } : c
      );
      this.harvestCandidates.set(updated);
      this.closeCandidateDetail();
    } catch (err: any) {
      console.error('Failed to reject candidate:', err);
    } finally {
      this.promotingCandidateId.set(null);
    }
  }

  /** Open the spawn plan modal for a candidate from the right panel */
  spawnPlanFromPanel(candidate: HarvestCandidate) {
    // Set the cross-component signal — hierarchy-nav watches and opens its modal
    this.dataService.spawnPlanIntent.set(candidate);
  }

  // ── Address Bar (Backlog #3) ──────────────────────────────────
  breadcrumbParts = computed(() => {
    const sysId = this.dataService.selectedSystemId();
    const subId = this.dataService.selectedSubsystemId();
    const featId = this.dataService.selectedFeatureId();
    const parts: { label: string; icon: string; level: string; id?: string }[] = [
      { label: 'Nebula', icon: 'root', level: 'root' },
    ];

    if (sysId) {
      const sys = this.dataService.systems().find(s => s.id === sysId);
      if (sys) parts.push({ label: sys.name, icon: 'system', level: 'system', id: sysId });
    }
    if (subId) {
      const sys = this.dataService.systems().find(s => s.id === this.dataService.selectedSystemId());
      const sub = sys?.subsystems.find(s => s.id === subId);
      if (sub) parts.push({ label: sub.name, icon: 'subsystem', level: 'subsystem', id: subId });
    }
    if (featId) {
      const sys = this.dataService.systems().find(s => s.id === this.dataService.selectedSystemId());
      const sub = sys?.subsystems.find(s => s.id === this.dataService.selectedSubsystemId());
      const feat = sub?.features.find(f => f.id === featId);
      if (feat) parts.push({ label: feat.name, icon: 'feature', level: 'feature', id: featId });
    }
    return parts;
  });

  navigateToBreadcrumb(part: { label: string; icon: string; level: string; id?: string }) {
    if (part.level === 'root') {
      // Go all the way home — clear all hierarchy selections
      this.dataService.selectedSystemId.set(null);
      this.dataService.selectedSubsystemId.set(null);
      this.dataService.selectedFeatureId.set(null);
    } else if (part.level === 'feature') {
      return; // already at deepest level
    } else if (part.level === 'subsystem') {
      this.dataService.selectedFeatureId.set(null);
    } else if (part.level === 'system') {
      this.dataService.selectedSubsystemId.set(null);
      this.dataService.selectedFeatureId.set(null);
    }
  }

  // ── View mode display labels ──────────────────────────────────
  viewModeLabel = computed(() => {
    const labels: Record<string, string> = {
      board: 'Kanban Board',
      table: 'Table View',
      docs: 'Documentation',
      graph: 'Graph View',
      info: 'System Info',
      sessions: 'Work Sessions',
      harvests: 'Harvests',
      audit: 'Audit Files',
      analysis: 'Analysis',
      candidates: 'Candidates',
      intents: 'Intent Records',
      agendas: 'Agendas',
      specifications: 'Specifications',
      plans: 'Implementation Plans',
      'work-requests': 'Work Requests',
    };
    return labels[this.dataService.viewMode()] || this.dataService.viewMode();
  });

  constructor() {
    // ── Publish addressbar changes to the ui-event-bus ─────────────
    // (data.service.ts already owns the eventBus.connect('nebula-ui') call)
    effect(() => {
      const parts = this.breadcrumbParts();
      if (parts.length > 0) {
        this.eventBus.publish('location-change', parts);
      }
    });

    afterNextRender(() => {
      this.dataService.getPreference<number>('sidebarWidth').then(val => {
        if (val && val >= this.MIN_SIDEBAR_WIDTH && val <= this.MAX_SIDEBAR_WIDTH) {
          this.sidebarWidth.set(val);
        }
      });
      this.dataService.getPreference<number>('rightPanelWidth').then(val => {
        if (val && val >= 280 && val <= 600) {
          this.rightPanelWidth.set(val);
        }
      });
      this.dataService.getPreference<boolean>('showRightPanel').then(val => {
        if (val !== null) {
          this.showRightPanel.set(val);
        }
      });
    });

    effect(() => {
      this.dataService.savePreference('sidebarWidth', this.sidebarWidth());
    });

    effect(() => {
      this.dataService.savePreference('rightPanelWidth', this.rightPanelWidth());
    });

    effect(() => {
      this.dataService.savePreference('showRightPanel', this.showRightPanel());
    });

    // Clear candidate detail selection when hierarchy selection changes
    effect(() => {
      // Read these to track dependency
      this.dataService.selectedSystemId();
      this.dataService.selectedSubsystemId();
      this.dataService.selectedFeatureId();
      // Clear the detail selection when navigating hierarchy
      this.dataService.selectedHarvestCandidateId.set(null);
    });

    // Auto-open right panel when a harvest candidate is selected for detail
    effect(() => {
      const selectedId = this.dataService.selectedHarvestCandidateId();
      if (selectedId) {
        this.showRightPanel.set(true);
      }
    });

    // Fetch candidates for right panel when selection or panel visibility changes
    effect(() => {
      if (!this.showRightPanel()) return;

      const sysId = this.dataService.selectedSystemId();
      const subId = this.dataService.selectedSubsystemId();
      const featId = this.dataService.selectedFeatureId();
      if (!sysId && !subId && !featId) return;

      const requestId = ++this.candidatesRequestId;
      this.candidatesLoading.set(true);

      let promise: Promise<{ candidates: HarvestCandidate[]; count: number }>;
      if (featId) {
        promise = this.dataService.getFeatureHarvestCandidates(featId).then(r => ({ candidates: r.candidates, count: r.count }));
      } else if (subId) {
        promise = this.dataService.getSubsystemHarvestCandidates(subId).then(r => ({ candidates: r.candidates, count: r.count }));
      } else {
        promise = this.dataService.getSystemHarvestCandidates(sysId!).then(r => ({ candidates: r.candidates, count: r.count }));
      }

      promise.then(({ candidates, count }) => {
        if (requestId !== this.candidatesRequestId) return;
        this.harvestCandidates.set(candidates);
        this.candidatesCount.set(count);
        this.candidatesLoading.set(false);
      }).catch(() => {
        if (requestId !== this.candidatesRequestId) return;
        this.candidatesLoading.set(false);
      });
    });
  }

  // ── Sidebar Resize ────────────────────────────────────────────
  startResize(event: MouseEvent): void {
    event.preventDefault();
    this.isResizing.set(true);
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
  }

  @HostListener('document:keydown.escape', ['$event'])
  onEscape(event: KeyboardEvent): void {
    // Prevent default only if we actually have a selection to clear —
    // otherwise let Escape pass through for other handlers (modals, etc.)
    if (this.dataService.selectedSystemId() || this.dataService.selectedSubsystemId() || this.dataService.selectedFeatureId()) {
      event.preventDefault();
      this.navigateToBreadcrumb({ label: 'Nebula', icon: 'root', level: 'root' });
    }
  }

  @HostListener('document:mouseup')
  stopResize(): void {
    if (this.isResizing()) {
      this.isResizing.set(false);
      document.body.style.userSelect = 'auto';
      document.body.style.cursor = 'auto';
    }
    if (this.isRightResizing()) {
      this.isRightResizing.set(false);
      document.body.style.userSelect = 'auto';
      document.body.style.cursor = 'auto';
    }
  }

  @HostListener('document:mousemove', ['$event'])
  onResize(event: MouseEvent): void {
    if (this.isResizing()) {
      let newWidth = event.clientX;
      if (newWidth < this.MIN_SIDEBAR_WIDTH) newWidth = this.MIN_SIDEBAR_WIDTH;
      if (newWidth > this.MAX_SIDEBAR_WIDTH) newWidth = this.MAX_SIDEBAR_WIDTH;
      this.sidebarWidth.set(newWidth);
    }
    if (this.isRightResizing()) {
      const viewportWidth = window.innerWidth;
      let newWidth = viewportWidth - event.clientX;
      if (newWidth < 280) newWidth = 280;
      if (newWidth > 600) newWidth = 600;
      this.rightPanelWidth.set(newWidth);
    }
  }

  // ── Right Panel Resize ────────────────────────────────────────
  startRightResize(event: MouseEvent): void {
    event.preventDefault();
    this.isRightResizing.set(true);
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
  }

  toggleRightPanel(): void {
    this.showRightPanel.update(v => !v);
  }

  // ── View Mode Switching ───────────────────────────────────────
  setViewMode(mode: 'board' | 'table' | 'docs' | 'sessions' | 'info' | 'audit' | 'graph' | 'harvests' | 'analysis' | 'candidates' | 'intents' | 'agendas' | 'specifications' | 'plans' | 'work-requests'): void {
    this.dataService.viewMode.set(mode);
    if (mode === 'audit') {
      this.dataService.fetchAuditFiles();
    }
  }

  openAuditView(): void {
    if (this.dataService.viewMode() !== 'audit') {
      this.dataService.viewMode.set('audit');
      this.dataService.fetchAuditFiles();
    }
  }

}
