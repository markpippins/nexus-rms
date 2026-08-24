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
import { ToastComponent } from './components/toast.component';
import { DataService } from './services/data.service';
import { UiEventBusService } from './app/services/ui-event-bus.service';

@Component({
  selector: 'app-root',
  standalone: true,    imports: [CommonModule, FormsModule, HierarchyNavComponent, KanbanBoardComponent, AuditTreeComponent, AuditViewerComponent, HarvestViewComponent, AnalysisViewComponent, AgendasViewComponent, AgendaAnalysisViewComponent, SpecificationsViewComponent, ImplementationPlansViewComponent, WorkRequestsViewComponent, CpfFunnelViewComponent, ToastComponent],
  templateUrl: './app.component.html'
})
export class AppComponent {
  dataService = inject(DataService);
  private eventBus = inject(UiEventBusService);

  readonly MIN_SIDEBAR_WIDTH = 224; // w-56
  readonly MAX_SIDEBAR_WIDTH = 600;

  sidebarWidth = signal<number>(288); // Default w-72
  isResizing = signal<boolean>(false);

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
    });

    effect(() => {
      this.dataService.savePreference('sidebarWidth', this.sidebarWidth());
    });

    // Clear the harvest candidate selection when the hierarchy selection changes
    effect(() => {
      // Read these to track dependency
      this.dataService.selectedSystemId();
      this.dataService.selectedSubsystemId();
      this.dataService.selectedFeatureId();
      this.dataService.selectedHarvestCandidateId.set(null);
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
  }

  @HostListener('document:mousemove', ['$event'])
  onResize(event: MouseEvent): void {
    if (this.isResizing()) {
      let newWidth = event.clientX;
      if (newWidth < this.MIN_SIDEBAR_WIDTH) newWidth = this.MIN_SIDEBAR_WIDTH;
      if (newWidth > this.MAX_SIDEBAR_WIDTH) newWidth = this.MAX_SIDEBAR_WIDTH;
      this.sidebarWidth.set(newWidth);
    }
  }

  // ── View Mode Switching ───────────────────────────────────────
  setViewMode(mode: 'board' | 'table' | 'docs' | 'sessions' | 'info' | 'audit' | 'graph' | 'harvests' | 'analysis' | 'agendas' | 'agenda-analysis' | 'specifications' | 'plans' | 'work-requests' | 'cpf-funnel'): void {
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
