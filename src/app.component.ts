import { Component, inject, signal, computed, effect, HostListener, afterNextRender } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HierarchyNavComponent } from './components/hierarchy-nav.component';
import { KanbanBoardComponent } from './components/kanban-board.component';
import { AuditTreeComponent } from './components/audit-tree.component';
import { AuditViewerComponent } from './components/audit-viewer.component';
import { HarvestViewComponent } from './components/harvest-view.component';
import { AnalysisViewComponent } from './components/analysis-view.component';
import { AgendasViewComponent } from './components/agendas-view.component';
import { AgendaAnalysisViewComponent } from './components/agenda-analysis-view.component';
import { SpecificationsViewComponent } from './components/specifications-view.component';
import { ImplementationPlansViewComponent } from './components/implementation-plans-view.component';
import { WorkRequestsViewComponent } from './components/work-requests-view.component';
import { CpfFunnelViewComponent } from './components/cpf-funnel-view.component';
import { OpenQuestionsViewComponent } from './components/open-questions-view.component';
import { ToastComponent } from './components/toast.component';
import { DataService } from './services/data.service';
import { formatDate, lookupHierarchyName, getBlockTypeBadgeClasses, getStatusColor, CANDIDATE_STATUS_COLORS } from './app/utils/view-helpers';
import { UiEventBusService } from './app/services/ui-event-bus.service';
import { HarvestCandidate } from './models/data.models';

@Component({
  selector: 'app-root',
  standalone: true,    imports: [CommonModule, FormsModule, HierarchyNavComponent, KanbanBoardComponent, AuditTreeComponent, AuditViewerComponent, HarvestViewComponent, AnalysisViewComponent, AgendasViewComponent, AgendaAnalysisViewComponent, SpecificationsViewComponent, ImplementationPlansViewComponent, WorkRequestsViewComponent, CpfFunnelViewComponent, OpenQuestionsViewComponent, ToastComponent],
  templateUrl: './app.component.html'
})
export class AppComponent {
  dataService = inject(DataService);
  private eventBus = inject(UiEventBusService);

  readonly MIN_SIDEBAR_WIDTH = 224; // w-56
  readonly MAX_SIDEBAR_WIDTH = 600;

  sidebarWidth = signal<number>(288); // Default w-72
  isResizing = signal<boolean>(false);

  // ── Right Slide Panel (Backlog #4) ────────────────────────────
  showRightPanel = signal(false);
  rightPanelWidth = signal(520);
  readonly MIN_RIGHT_PANEL_WIDTH = 320;
  readonly MAX_RIGHT_PANEL_WIDTH = 760;
  isRightResizing = signal(false);
  harvestCandidates = signal<HarvestCandidate[]>([]);
  candidatesLoading = signal(false);
  candidatesCount = signal(0);
  private candidatesRequestId = 0;

  // ── Candidate Detail Panel State ─────────────────────────────
  promotingCandidateId = signal<string | null>(null);
  promotingToRequirementId = signal<string | null>(null);
  promotionError = signal<string | null>(null);

  /** Detail fetched on demand when the selected candidate isn't in the hierarchy-scoped list. */
  private selectedCandidateDetail = signal<HarvestCandidate | null>(null);
  private candidateDetailRequestId = 0;

  selectedCandidate = computed(() => {
    const id = this.dataService.selectedHarvestCandidateId();
    if (!id) return null;
    return this.harvestCandidates().find(c => c.id === id) || this.selectedCandidateDetail();
  });

  /** Intent records linked to the candidate shown in the document pane. */
  docCandidateIntentRecords = computed(() => {
    const c = this.selectedCandidate();
    if (!c) return [];
    return this.dataService.intentRecordsFor(c.id);
  });

  closeCandidateDetail() {
    this.closeTranscript();
    this.selectedCandidateDetail.set(null);
    this.dataService.selectedHarvestCandidateId.set(null);
  }

  // ── Transcript viewer state (inline, not modal) ────────────
  transcriptExpanded = signal(false);
  transcriptLoading = signal(false);
  transcriptTitle = signal('');
  transcriptUnits = signal<any[]>([]);
  transcriptStats = signal<any>(null);
  transcriptCandidates = signal<any[]>([]);
  private transcriptHarvestId = signal<string | null>(null);
  private pendingAutoExpandHarvestId = signal<string | null>(null);

  // ── Transcript find-in-file state ────────────────────────────
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

  readonly getBlockTypeBadgeClasses = getBlockTypeBadgeClasses;

  toggleTranscriptSearch() {
    this.transcriptShowSearch.update(v => !v);
    if (!this.transcriptShowSearch()) {
      this.transcriptSearchQuery.set('');
      this.transcriptSearchMatchIndex.set(0);
    } else {
      setTimeout(() => document.getElementById('panel-transcript-search-input')?.focus(), 0);
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
      const marks = document.querySelectorAll('#panel-transcript-content .transcript-highlight');
      if (marks.length === 0) return;
      marks.forEach(m => m.removeAttribute('data-current'));
      if (idx < marks.length) {
        marks[idx].setAttribute('data-current', '');
        marks[idx].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }, 0);
  }

  highlightText(text: string | null | undefined): string {
    if (!text) return '';
    const query = this.transcriptSearchQuery();
    const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    if (!query) return escaped;
    const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    return escaped.replace(regex, '<mark class="transcript-highlight">$1</mark>');
  }

  async toggleTranscript(harvestId: string, title: string) {
    // If already expanded for this harvest, collapse
    if (this.transcriptExpanded() && this.transcriptHarvestId() === harvestId) {
      this.closeTranscript();
      return;
    }
    this.transcriptSearchQuery.set('');
    this.transcriptShowSearch.set(false);
    this.transcriptSearchMatchIndex.set(0);
    this.transcriptExpanded.set(true);
    this.transcriptHarvestId.set(harvestId);
    this.transcriptTitle.set(title);
    this.transcriptLoading.set(true);
    try {
      const data = await this.dataService.getHarvestTranscript(harvestId);
      this.transcriptUnits.set(data.units || []);
      this.transcriptStats.set(data.stats);
      this.transcriptCandidates.set(data.candidates || []);
      if (data.title) this.transcriptTitle.set(data.title);
    } catch (err: any) {
      console.error('Failed to load transcript:', err);
    } finally {
      this.transcriptLoading.set(false);
    }
  }

  closeTranscript() {
    this.transcriptExpanded.set(false);
    this.transcriptHarvestId.set(null);
    this.transcriptUnits.set([]);
    this.transcriptCandidates.set([]);
    this.transcriptStats.set(null);
    this.transcriptSearchQuery.set('');
    this.transcriptShowSearch.set(false);
    this.transcriptSearchMatchIndex.set(0);
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

  getCandidateStatusClass(status: string): string {
    return getStatusColor(status, CANDIDATE_STATUS_COLORS);
  }

  async stageCandidate(candidate: HarvestCandidate) {
    this.promotingCandidateId.set(candidate.id);
    try {
      await this.dataService.promoteHarvestCandidate(candidate.id);
      // Update local state
      const updated = this.harvestCandidates().map(c =>
        c.id === candidate.id ? { ...c, status: 'staged' } : c
      );
      this.harvestCandidates.set(updated);
    } catch (err: any) {
      console.error('Failed to stage candidate:', err);
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

  /** Promote to requirement — mirrors the (hidden) Candidates view behavior. */
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

  /** Promote an intent record to requirement (same server flow as the hidden Intents view). */
  async promoteIntentRecordToRequirement(record: any) {
    this.promotingToRequirementId.set(record.id);
    this.promotionError.set(null);
    try {
      const newReq = await this.dataService.promoteIntentToRequirement(record.id);
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
      agendas: 'Agendas',
      'agenda-analysis': 'Agenda Analysis',
      specifications: 'Specifications',
      plans: 'Implementation Plans',
      'work-requests': 'Work Requests',
      'cpf-funnel': 'CPF Funnel',
      'open-questions': 'Open Questions',
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
        if (val && val >= this.MIN_RIGHT_PANEL_WIDTH && val <= this.MAX_RIGHT_PANEL_WIDTH) {
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
      // Clear the detail selection and close transcript when navigating hierarchy
      this.closeTranscript();
      this.selectedCandidateDetail.set(null);
      this.dataService.selectedHarvestCandidateId.set(null);
    });

    // Fetch the candidate detail on demand when it's not in the hierarchy-scoped
    // list (e.g. opened from the harvests view), and lazily warm the intent index.
    effect(() => {
      const id = this.dataService.selectedHarvestCandidateId();
      if (!id) return;
      this.dataService.loadIntentRecordIndex();
      if (this.harvestCandidates().some(c => c.id === id)) return;
      const requestId = ++this.candidateDetailRequestId;
      this.dataService.getHarvestCandidate(id).then(cand => {
        if (requestId !== this.candidateDetailRequestId || this.dataService.selectedHarvestCandidateId() !== id) return;
        this.selectedCandidateDetail.set(cand);
      });
    });

    // Auto-open right panel when a harvest candidate is selected for detail
    effect(() => {
      const selectedId = this.dataService.selectedHarvestCandidateId();
      if (selectedId) {
        this.showRightPanel.set(true);
      }
    });

    // Auto-expand transcript when triggered from sidebar transcript button
    effect(() => {
      if (this.dataService.autoExpandTranscript()) {
        this.dataService.autoExpandTranscript.set(false); // reset
        const candidate = this.selectedCandidate();
        if (candidate?.harvest_id) {
          this.toggleTranscript(candidate.harvest_id, candidate.harvest_source || candidate.title || '');
        } else {
          // Candidates not loaded yet — store the intent, will retry when loaded
          this.pendingAutoExpandHarvestId.set('pending');
        }
      }
    });

    // Retry auto-expand when candidates finish loading
    effect(() => {
      if (this.pendingAutoExpandHarvestId()) {
        this.pendingAutoExpandHarvestId.set(null);
        const candidate = this.selectedCandidate();
        if (candidate?.harvest_id) {
          // Small delay to ensure DOM is ready
          setTimeout(() => {
            this.toggleTranscript(candidate.harvest_id, candidate.harvest_source || candidate.title || '');
          }, 50);
        }
      }
    }, { allowSignalWrites: true });

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
      if (newWidth < this.MIN_RIGHT_PANEL_WIDTH) newWidth = this.MIN_RIGHT_PANEL_WIDTH;
      if (newWidth > this.MAX_RIGHT_PANEL_WIDTH) newWidth = this.MAX_RIGHT_PANEL_WIDTH;
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
  setViewMode(mode: 'board' | 'table' | 'docs' | 'sessions' | 'info' | 'audit' | 'graph' | 'harvests' | 'analysis' | 'agendas' | 'agenda-analysis' | 'specifications' | 'plans' | 'work-requests' | 'cpf-funnel' | 'open-questions'): void {
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
