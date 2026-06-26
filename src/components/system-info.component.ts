import { Component, inject, computed, signal, effect, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject, debounceTime, distinctUntilChanged, takeUntil } from 'rxjs';
import { DataService } from '../services/data.service';
import { DocFile } from '../models/data.models';
import { renderMarkdown } from '../utils/markdown';

export type InfoTab = 'artifacts' | 'architecture' | 'readme' | 'specification' | 'reference-guide' | 'notes' | 'harvest_context';

export const INFO_TABS: { id: InfoTab; label: string; readOnly?: boolean }[] = [
  { id: 'artifacts', label: 'Artifacts' },
  { id: 'architecture', label: 'Architecture' },
  { id: 'readme', label: 'Readme' },
  { id: 'specification', label: 'Specification' },
  { id: 'reference-guide', label: 'Reference Guide' },
  { id: 'notes', label: 'Notes' },
  { id: 'harvest_context', label: 'Harvest', readOnly: true },
];

@Component({
  selector: 'app-system-info',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './system-info.component.html'
})
export class SystemInfoComponent implements OnDestroy {
  dataService = inject(DataService);

  activeTab = signal<InfoTab>('artifacts');
  isEditing = signal(false);
  docsLoading = signal(false);

  // Debounced save for architecture/readme tabs
  private saveSubject = new Subject<{ systemId: string; content: string; type: 'readme' | 'architecture' }>();
  private destroy$ = new Subject<void>();
  private pendingEditContent = ''; // latest typed content for immediate flush

  // Docs fetched from API (disk-backed README.md / ARCHITECTURE.md)
  private diskDocs = signal<Map<string, DocFile[]>>(new Map()); // keyed by system ID
  private subsystemDocs = signal<Map<string, DocFile[]>>(new Map()); // keyed by subsystem ID

  // Content storage for API-backed info tabs (spec, ref-guide, notes)
  private contentStore = signal<Map<string, string>>(new Map());

  readonly tabs = INFO_TABS;

  selectedSystem = computed(() =>
    this.dataService.systems().find(s => s.id === this.dataService.selectedSystemId())
  );

  // ── Workspace paths for the selected system ────────────────────
  systemWorkspaces = computed(() => {
    const sys = this.selectedSystem();
    if (!sys) return [];
    return this.dataService.workspaces().filter(w => w.systemId === sys.id);
  });

  // ── Current content for the active tab ──────────────────────────
  currentContent = computed(() => {
    const sys = this.selectedSystem();
    const tab = this.activeTab();
    if (!sys) return '';

    // Architecture tab: subsystem docs → system-level disk docs → DB architecture → default
    if (tab === 'architecture') {
      // Check subsystem-level docs first
      const subId = this.dataService.selectedSubsystemId();
      if (subId) {
        const subFiles = this.subsystemDocs().get(subId) || [];
        const archFile = subFiles.find(f => f.filename.toUpperCase() === 'ARCHITECTURE.MD');
        if (archFile) return archFile.content;
      }
      // Fall back to system-level disk docs
      const sysFiles = this.diskDocs().get(sys.id) || [];
      const archFile = sysFiles.find(f => f.filename.toUpperCase() === 'ARCHITECTURE.MD');
      if (archFile) return archFile.content;
      return sys.architecture || this.getDefaultContent(sys, tab);
    }

    // Readme tab: subsystem docs → system-level disk docs → DB readme → default
    if (tab === 'readme') {
      const subId = this.dataService.selectedSubsystemId();
      if (subId) {
        const subFiles = this.subsystemDocs().get(subId) || [];
        const readmeFile = subFiles.find(f => f.filename.toUpperCase() === 'README.MD');
        if (readmeFile) return readmeFile.content;
      }
      const sysFiles = this.diskDocs().get(sys.id) || [];
      const readmeFile = sysFiles.find(f => f.filename.toUpperCase() === 'README.MD');
      if (readmeFile) return readmeFile.content;
      return sys.readme || this.getDefaultContent(sys, tab);
    }

    // Specification tab: subsystem docs → system-level disk docs → API-backed cache → default
    if (tab === 'specification') {
      const subId = this.dataService.selectedSubsystemId();
      if (subId) {
        const subFiles = this.subsystemDocs().get(subId) || [];
        const specFile = subFiles.find(f => f.filename.toUpperCase() === 'SPEC.MD');
        if (specFile) return specFile.content;
      }
      const sysFiles = this.diskDocs().get(sys.id) || [];
      const specFile = sysFiles.find(f => f.filename.toUpperCase() === 'SPEC.MD');
      if (specFile) return specFile.content;
      return this.contentStore().get(`${sys.id}:specification`) || this.getDefaultContent(sys, tab);
    }

    // Reference Guide tab: subsystem docs → system-level disk docs → API-backed cache → default
    if (tab === 'reference-guide') {
      const subId = this.dataService.selectedSubsystemId();
      if (subId) {
        const subFiles = this.subsystemDocs().get(subId) || [];
        const refFile = subFiles.find(f => f.filename.toUpperCase() === 'REFERENCE.MD');
        if (refFile) return refFile.content;
      }
      const sysFiles = this.diskDocs().get(sys.id) || [];
      const refFile = sysFiles.find(f => f.filename.toUpperCase() === 'REFERENCE.MD');
      if (refFile) return refFile.content;
      return this.contentStore().get(`${sys.id}:reference-guide`) || this.getDefaultContent(sys, tab);
    }

    // Harvest context tab: API-backed, read-only (auto-generated from candidate linking)
    if (tab === 'harvest_context') {
      return this.contentStore().get(`${sys.id}:harvest_context`) || '# No Harvest Context\n\nNo harvest candidates are linked to this system yet.\nUse the spawn-plan flow or PATCH a candidate to link it.';
    }

    // Other markdown tabs (notes): API-backed
    return this.contentStore().get(`${sys.id}:${tab}`) || this.getDefaultContent(sys, tab);
  });

  private getDefaultContent(sys: { id: string; name: string; description: string }, tab: InfoTab): string {
    const defaults: Record<InfoTab, string> = {
      artifacts: '',
      architecture: `# ${sys.name} — Architecture\n\n## Overview\n\nArchitecture documentation for **${sys.name}**.\n\n## Key Components\n\n-\n\n## Data Flow\n\n-\n\n## Deployment\n\n-`,
      readme: `# ${sys.name}\n\n${sys.description || ''}`,
      specification: `# ${sys.name} — Specification\n\n## Functional Requirements\n\n-\n\n## Non-Functional Requirements\n\n-\n\n## API\n\n-\n\n## Data Model\n\n-`,
      'reference-guide': `# ${sys.name} — Reference Guide\n\n## Configuration\n\n-\n\n## Environment Variables\n\n-\n\n## Commands\n\n-\n\n## Troubleshooting\n\n-`,
      notes: `# ${sys.name} — Notes\n\n## Development Notes\n\n-\n\n## Known Issues\n\n-\n\n## Roadmap\n\n-`,
      harvest_context: '', // auto-generated, no default
    };
    return defaults[tab] || '';
  }

  constructor() {
    // Debounced save listener: fires 500ms after the user stops typing
    this.saveSubject.pipe(
      debounceTime(500),
      distinctUntilChanged((a, b) => a.content === b.content && a.systemId === b.systemId && a.type === b.type),
      takeUntil(this.destroy$)
    ).subscribe(({ systemId, content, type }) => {
      if (type === 'readme') {
        this.dataService.updateSystemReadme(systemId, content);
      } else {
        this.dataService.updateSystemArchitecture(systemId, content);
      }
    });

    // Fetch system-level disk-backed docs when system selection changes
    effect(() => {
      const sys = this.selectedSystem();
      if (!sys) return;

      this.docsLoading.set(true);
      this.activeTab.set('artifacts');
      this.isEditing.set(false);

      this.dataService.fetchSystemDocs(sys.id).then(response => {
        if (response && response.docs.length > 0) {
          const allFiles: DocFile[] = [];
          for (const doc of response.docs) {
            for (const f of doc.files) {
              const existing = allFiles.findIndex(x => x.filename === f.filename);
              if (existing === -1) {
                allFiles.push(f);
              }
            }
          }
          const map = new Map(this.diskDocs());
          map.set(sys.id, allFiles);
          this.diskDocs.set(map);
        }
        this.docsLoading.set(false);
      }).catch(() => {
        this.docsLoading.set(false);
      });
    });

    // Fetch subsystem-level disk-backed docs when subsystem selection changes
    effect(() => {
      const subId = this.dataService.selectedSubsystemId();
      if (!subId) return;

      this.docsLoading.set(true);
      this.dataService.fetchSubsystemDocs(subId).then(response => {
        if (response && response.docs.length > 0) {
          const allFiles: DocFile[] = [];
          for (const doc of response.docs) {
            for (const f of doc.files) {
              const existing = allFiles.findIndex(x => x.filename === f.filename);
              if (existing === -1) {
                allFiles.push(f);
              }
            }
          }
          const map = new Map(this.subsystemDocs());
          map.set(subId, allFiles);
          this.subsystemDocs.set(map);
        }
        this.docsLoading.set(false);
      }).catch(() => {
        this.docsLoading.set(false);
      });
    });

    // Fetch info tabs from API when system selection changes
    effect(() => {
      const sys = this.selectedSystem();
      if (!sys) return;

      this.dataService.fetchInfoTabs(sys.id).then(tabs => {
        const map = new Map(this.contentStore());
        for (const tab of tabs) {
          map.set(`${sys.id}:${tab.tab_id}`, tab.content);
        }
        this.contentStore.set(map);
      });
    });
  }

  onContentChange(content: string) {
    const sys = this.selectedSystem();
    const tab = this.activeTab();
    if (!sys || tab === 'artifacts') return;

    // Architecture & Readme tabs: debounced persist to the API (separate DB columns)
    if (tab === 'architecture' || tab === 'readme') {
      this.pendingEditContent = content;
      this.saveSubject.next({ systemId: sys.id, content, type: tab as 'readme' | 'architecture' });
      // Clear disk cache so user's edit shows up instead of stale file
      const fileToRemove = tab === 'readme' ? 'README.MD' : 'ARCHITECTURE.MD';
      // Clear system-level disk cache
      const sysMap = new Map(this.diskDocs());
      const sysFiles = (sysMap.get(sys.id) || []).filter(f => f.filename.toUpperCase() !== fileToRemove);
      sysMap.set(sys.id, sysFiles);
      this.diskDocs.set(sysMap);
      // Also clear subsystem-level disk cache if a subsystem is selected
      const subId = this.dataService.selectedSubsystemId();
      if (subId) {
        const subMap = new Map(this.subsystemDocs());
        const subFiles = (subMap.get(subId) || []).filter(f => f.filename.toUpperCase() !== fileToRemove);
        subMap.set(subId, subFiles);
        this.subsystemDocs.set(subMap);
      }
      return;
    }

    // Specification tab: clear disk cache so user's edit shows up, persist to API
    if (tab === 'specification') {
      const fileToRemove = 'SPEC.MD';
      // Clear system-level disk cache
      const sysMap = new Map(this.diskDocs());
      const sysFiles = (sysMap.get(sys.id) || []).filter(f => f.filename.toUpperCase() !== fileToRemove);
      sysMap.set(sys.id, sysFiles);
      this.diskDocs.set(sysMap);
      // Also clear subsystem-level disk cache if a subsystem is selected
      const subId = this.dataService.selectedSubsystemId();
      if (subId) {
        const subMap = new Map(this.subsystemDocs());
        const subFiles = (subMap.get(subId) || []).filter(f => f.filename.toUpperCase() !== fileToRemove);
        subMap.set(subId, subFiles);
        this.subsystemDocs.set(subMap);
      }
      // Persist to API + update local cache
      const storeMap = new Map(this.contentStore());
      storeMap.set(`${sys.id}:specification`, content);
      this.contentStore.set(storeMap);
      this.dataService.saveInfoTab(sys.id, 'specification', content);
      return;
    }

    // Reference Guide tab: clear disk cache, persist to API
    if (tab === 'reference-guide') {
      const fileToRemove = 'REFERENCE.MD';
      // Clear system-level disk cache
      const sysMap = new Map(this.diskDocs());
      const sysFiles = (sysMap.get(sys.id) || []).filter(f => f.filename.toUpperCase() !== fileToRemove);
      sysMap.set(sys.id, sysFiles);
      this.diskDocs.set(sysMap);
      // Also clear subsystem-level disk cache if a subsystem is selected
      const subId = this.dataService.selectedSubsystemId();
      if (subId) {
        const subMap = new Map(this.subsystemDocs());
        const subFiles = (subMap.get(subId) || []).filter(f => f.filename.toUpperCase() !== fileToRemove);
        subMap.set(subId, subFiles);
        this.subsystemDocs.set(subMap);
      }
      // Persist to API + update local cache
      const storeMap = new Map(this.contentStore());
      storeMap.set(`${sys.id}:reference-guide`, content);
      this.contentStore.set(storeMap);
      this.dataService.saveInfoTab(sys.id, 'reference-guide', content);
      return;
    }

    // Other tabs: persist to API
    const map = new Map(this.contentStore());
    map.set(`${sys.id}:${tab}`, content);
    this.contentStore.set(map);
    this.dataService.saveInfoTab(sys.id, tab, content);
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  toggleEdit() {
    // Flush pending debounced save when switching from edit to preview
    if (this.isEditing()) {
      const sys = this.selectedSystem();
      const tab = this.activeTab();
      if (sys && (tab === 'architecture' || tab === 'readme') && this.pendingEditContent) {
        if (tab === 'readme') {
          this.dataService.updateSystemReadme(sys.id, this.pendingEditContent);
        } else {
          this.dataService.updateSystemArchitecture(sys.id, this.pendingEditContent);
        }
      }
    }
    this.isEditing.update(v => !v);
  }

  // Use shared markdown renderer
  renderMarkdown = renderMarkdown;

  // ── Harvest Context (read-only auto-generated tab) ──────────────
  async deleteHarvestContext() {
    const sys = this.selectedSystem();
    if (!sys) return;
    const previousContent = this.contentStore().get(`${sys.id}:harvest_context`);
    // Optimistic clear
    const map = new Map(this.contentStore());
    map.delete(`${sys.id}:harvest_context`);
    this.contentStore.set(map);
    // Persist delete to server; restore on failure
    try {
      await this.dataService.deleteInfoTab(sys.id, 'harvest_context');
    } catch {
      const restoreMap = new Map(this.contentStore());
      if (previousContent) restoreMap.set(`${sys.id}:harvest_context`, previousContent);
      this.contentStore.set(restoreMap);
    }
  }

  // ── Artifacts data (subsystems + features + workspace paths) ────
  artifactsData = computed(() => {
    const sys = this.selectedSystem();
    const workspaces = this.systemWorkspaces();
    if (!sys) return [];

    const rows: {
      type: string;
      name: string;
      description: string;
      path: string;
      children: number;
    }[] = [];

    for (const sub of sys.subsystems) {
      const subWorkspace = workspaces.find(w => w.subsystemId === sub.id);
      rows.push({
        type: 'Subsystem',
        name: sub.name,
        description: sub.description || '',
        path: subWorkspace?.workspacePath || '',
        children: sub.features.length,
      });
      for (const feat of sub.features) {
        rows.push({
          type: 'Feature',
          name: feat.name,
          description: feat.description || '',
          path: '',
          children: 0,
        });
      }
    }

    // Add workspace-only entries (no subsystem association)
    for (const ws of workspaces) {
      if (!ws.subsystemId) {
        rows.push({
          type: 'Workspace',
          name: ws.workspacePath,
          description: ws.systemName || '',
          path: ws.workspacePath,
          children: 0,
        });
      }
    }

    return rows;
  });
}
