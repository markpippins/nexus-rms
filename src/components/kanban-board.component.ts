
import { Component, inject, computed, signal, effect, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DataService } from '../services/data.service';
import { AiService } from '../services/ai.service';
import { Requirement, Status, ReqType, AcceptanceCriterion, AI_PLATFORMS, FolderCategory, HarvestCandidate } from '../models/data.models';
import { FormsModule } from '@angular/forms';
import { BoardViewComponent } from './board-view.component';
import { TableViewComponent } from './table-view.component';
import { WorkSessionViewComponent } from './work-session-view.component';
import { SystemInfoComponent } from './system-info.component';
import { GraphViewComponent } from './graph-view.component';

@Component({
  selector: 'app-kanban-board',
  standalone: true,
  imports: [CommonModule, FormsModule, BoardViewComponent, TableViewComponent, WorkSessionViewComponent, SystemInfoComponent, GraphViewComponent],
  templateUrl: './kanban-board.component.html',
  host: {
    'style': 'display: block; height: 100%'
  }
})
export class KanbanBoardComponent {
  dataService = inject(DataService);
  aiService = inject(AiService);
  
  searchTerm = signal('');
  showModal = signal(false);
  showAiModal = signal(false);
  showApiKeyModal = signal(false);
  showExportModal = signal(false); // New modal for export
  isGenerating = signal(false);

  // Form State
  editingReqId = signal<string | null>(null);
  isDuplicating = signal(false);
  newReqTitle = '';
  newReqDesc = '';
  newReqPriority: 'Low' | 'Medium' | 'High' = 'Medium';
  newReqType = signal<ReqType | null>(null);
  newReqParentId = signal<string | null>(null);
  newAcceptanceCriteria = signal<AcceptanceCriterion[]>([]);
  newCriterionText = '';
  // New modal state for hierarchy selection
  modalSystemId = signal<string | null>(null);
  modalSubsystemId = signal<string | null>(null);
  modalFeatureId = signal<string | null>(null);
  
  // AI Form State
  userStoryPrompt = '';
  apiKeyInput = '';

  // Export Modal State
  exportContextText = signal('');
  exportPlatform = signal('Cursor');
  exportModel = signal('');
  exportParentId = signal('');
  exportParentType = signal<'system' | 'subsystem' | 'feature' | 'requirement'>('system');
  exportParentName = signal('');
  includeInProgress = signal(false);
  pendingExportReqIds = signal<string[]>([]); // Store IDs to update status later
  
  // Platform Data (Sorted)
  platforms = Object.keys(AI_PLATFORMS).sort((a, b) => a.localeCompare(b));
  availableModels = computed(() => {
    const models = AI_PLATFORMS[this.exportPlatform()] || [];
    return [...models].sort((a, b) => a.localeCompare(b));
  });

  // Docs Editing State
  editableReadme = signal('');
  importMode: 'append' | 'replace' = 'append';

  // Docs Resizing State
  docsTopHeight = signal(400);
  isDocsResizing = signal(false);

  // ── Backlog Summary (Backlog #1) ───────────────────────────────────
  backlogCounts = computed(() => {
    const reqs = this.dataService.requirements();
    return {
      backlog: reqs.filter(r => r.status === 'Backlog').length,
      todo: reqs.filter(r => r.status === 'ToDo').length,
      inProgress: reqs.filter(r => r.status === 'InProgress').length,
      done: reqs.filter(r => r.status === 'Done').length,
      total: reqs.length,
    };
  });

  // ── Harvest Candidates (shown in Docs view when hierarchy selected) ──
  harvestCandidates = signal<HarvestCandidate[]>([]);
  candidatesLoading = signal(false);
  candidatesCount = signal(0);
  private candidatesRequestId = 0; // race-condition guard

  // ── Harvest Candidates Inline Edit State ──
  editingCandidateId = signal<string | null>(null);
  editCandidateSysId = signal<string>('');
  editCandidateSubId = signal<string>('');
  editCandidateFeatId = signal<string>('');

  // ── Spawn Plan Flow (triggered from Docs view candidate cards) ──
  showSpawnPlanModal = signal(false);
  spawnPlanCandidate = signal<HarvestCandidate | null>(null);
  spawnPlanSystemId = '';
  spawnPlanSubsystemId = '';
  spawnPlanFeatureId = '';
  spawnPlanPlanRef = '';
  spawnPlanTitle = '';
  spawnPlanDescription = '';
  spawnPlanLoading = signal(false);
  spawnPlanResult = signal<string | null>(null);

  // Fetch harvest candidates when hierarchy selection changes
  private candidatesEffect = effect(() => {
    const featId = this.dataService.selectedFeatureId();
    const subId = this.dataService.selectedSubsystemId();
    const sysId = this.dataService.selectedSystemId();

    if (!featId && !subId && !sysId) {
      this.harvestCandidates.set([]);
      this.candidatesCount.set(0);
      return;
    }

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

  // ── Docs Resize Handlers ──
  startDocsResize(event: MouseEvent) {
    event.preventDefault();
    this.isDocsResizing.set(true);
  }

  @HostListener('document:mousemove', ['$event'])
  onDocsMouseMove(event: MouseEvent) {
    if (this.isDocsResizing()) {
      event.preventDefault();
      this.docsTopHeight.update(h => Math.max(100, h + event.movementY));
    }
  }

  @HostListener('document:mouseup')
  onDocsMouseUp() {
    if (this.isDocsResizing()) {
      this.isDocsResizing.set(false);
    }
  }

  // ── Candidate Actions ──
  selectCandidate(candidate: HarvestCandidate) {
    const textToAppend = `\n\n### ${candidate.title}\n${candidate.intent_description || ''}\n`.trimStart();
    const current = this.editableReadme() || '';
    this.editableReadme.set(current ? `${current}\n\n${textToAppend}` : textToAppend);
  }

  startEditingCandidate(c: HarvestCandidate, event: MouseEvent) {
    event.stopPropagation();
    this.editingCandidateId.set(c.id);
    this.editCandidateSysId.set(c.system_id || '');
    this.editCandidateSubId.set(c.subsystem_id || '');
    this.editCandidateFeatId.set(c.feature_id || '');
  }

  cancelCandidateEdit(event?: MouseEvent) {
    if (event) event.stopPropagation();
    this.editingCandidateId.set(null);
  }

  async saveCandidateEdit(id: string, event: MouseEvent) {
    event.stopPropagation();
    await this.dataService.updateHarvestCandidate(id, {
      system_id: this.editCandidateSysId() || null,
      subsystem_id: this.editCandidateSubId() || null,
      feature_id: this.editCandidateFeatId() || null
    });
    this.editingCandidateId.set(null);
    // Refresh candidates
    const featId = this.dataService.selectedFeatureId();
    const subId = this.dataService.selectedSubsystemId();
    const sysId = this.dataService.selectedSystemId();
    if (featId) {
      this.dataService.getFeatureHarvestCandidates(featId).then(r => { this.harvestCandidates.set(r.candidates); this.candidatesCount.set(r.count); });
    } else if (subId) {
      this.dataService.getSubsystemHarvestCandidates(subId).then(r => { this.harvestCandidates.set(r.candidates); this.candidatesCount.set(r.count); });
    } else if (sysId) {
      this.dataService.getSystemHarvestCandidates(sysId).then(r => { this.harvestCandidates.set(r.candidates); this.candidatesCount.set(r.count); });
    }
  }

  getEditCandidateSubsystems() {
    const sysId = this.editCandidateSysId();
    if (!sysId) return [];
    return this.dataService.systems().find(s => s.id === sysId)?.subsystems || [];
  }

  getEditCandidateFeatures() {
    const sysId = this.editCandidateSysId();
    const subId = this.editCandidateSubId();
    if (!sysId || !subId) return [];
    return this.dataService.systems().find(s => s.id === sysId)?.subsystems.find(s => s.id === subId)?.features || [];
  }

  // ── Spawn Plan Handlers ──
  openSpawnPlan(candidate: HarvestCandidate, event?: MouseEvent) {
    if (event) event.stopPropagation();
    this.spawnPlanCandidate.set(candidate);
    const sysId = this.dataService.selectedSystemId();
    this.spawnPlanSystemId = candidate.system_id || sysId || '';
    this.spawnPlanSubsystemId = candidate.subsystem_id || this.dataService.selectedSubsystemId() || '';
    this.spawnPlanFeatureId = candidate.feature_id || this.dataService.selectedFeatureId() || '';
    this.spawnPlanPlanRef = '';
    this.spawnPlanTitle = candidate.title || '';
    this.spawnPlanDescription = candidate.intent_description || '';
    this.spawnPlanResult.set(null);
    this.showSpawnPlanModal.set(true);
  }

  closeSpawnPlan() {
    this.showSpawnPlanModal.set(false);
    this.spawnPlanCandidate.set(null);
    this.spawnPlanResult.set(null);
  }

  executeSpawnPlan() {
    const candidate = this.spawnPlanCandidate();
    if (!candidate || !this.spawnPlanSystemId) return;

    this.spawnPlanLoading.set(true);
    this.dataService.spawnPlanFromCandidate(candidate.id, {
      systemId: this.spawnPlanSystemId,
      subsystemId: this.spawnPlanSubsystemId || undefined,
      featureId: this.spawnPlanFeatureId || undefined,
      planRef: this.spawnPlanPlanRef || undefined,
      requirementTitle: this.spawnPlanTitle || undefined,
      requirementDescription: this.spawnPlanDescription || undefined,
    }).then(result => {
      this.spawnPlanLoading.set(false);
      if (result) {
        this.spawnPlanResult.set(`Plan spawned! Requirement "${result.requirement.title}" created${result.crossReference ? ' with cross-reference' : ''}.`);
        // Refresh candidates
        const featId = this.dataService.selectedFeatureId();
        const subId = this.dataService.selectedSubsystemId();
        const sysId = this.dataService.selectedSystemId();
        if (featId) {
          this.dataService.getFeatureHarvestCandidates(featId).then(r => {
            this.harvestCandidates.set(r.candidates);
            this.candidatesCount.set(r.count);
          });
        } else if (subId) {
          this.dataService.getSubsystemHarvestCandidates(subId).then(r => {
            this.harvestCandidates.set(r.candidates);
            this.candidatesCount.set(r.count);
          });
        } else if (sysId) {
          this.dataService.getSystemHarvestCandidates(sysId).then(r => {
            this.harvestCandidates.set(r.candidates);
            this.candidatesCount.set(r.count);
          });
        }
        this.dataService.refreshRequirements();
      } else {
        this.spawnPlanResult.set('Failed to spawn plan.');
      }
    }).catch(() => {
      this.spawnPlanLoading.set(false);
      this.spawnPlanResult.set('Error spawning plan.');
    });
  }

  // System Folders State (Sorted)
  readonly folderCategories: FolderCategory[] = ['Library', 'Service', 'UI', 'Documentation', 'Config', 'data', 'api'];
  newFolderName = signal('');
  newFolderCategory = signal<FolderCategory>('Library');
  newFolderNote = signal('');

  // Computed Context
  selectedSystem = computed(() => 
    this.dataService.systems().find(s => s.id === this.dataService.selectedSystemId())
  );

  selectedSubsystem = computed(() => {
    const sys = this.selectedSystem();
    return sys?.subsystems.find(s => s.id === this.dataService.selectedSubsystemId());
  });

  selectedFeature = computed(() => {
    const sub = this.selectedSubsystem();
    return sub?.features.find(f => f.id === this.dataService.selectedFeatureId());
  });

  // Computed properties for modal dropdowns
  modalAvailableSubsystems = computed(() => {
      const sysId = this.modalSystemId();
      if (!sysId) return [];
      const system = this.dataService.systems().find(s => s.id === sysId);
      return system ? system.subsystems : [];
  });

  modalAvailableFeatures = computed(() => {
      const sysId = this.modalSystemId();
      const subId = this.modalSubsystemId();
      if (!sysId || !subId) return [];
      const system = this.dataService.systems().find(s => s.id === sysId);
      const subsystem = system?.subsystems.find(s => s.id === subId);
      return subsystem ? subsystem.features : [];
  });

  // Requirements available as parents (from same feature, excluding self)
  availableParents = computed(() => {
    const featId = this.modalFeatureId();
    if (!featId) return [];
    const editId = this.editingReqId();
    return this.dataService.requirements().filter(r =>
      r.featureId === featId && r.id !== editId
    );
  });

  // The editing requirement's candidateId (shown as link badge)
  editReqCandidateId = computed(() => {
    const editId = this.editingReqId();
    if (!editId) return null;
    return this.dataService.requirements().find(r => r.id === editId)?.candidateId || null;
  });

  // Current Documentation based on selection level
  currentReadme = computed(() => {
    if (this.selectedFeature()) return this.selectedFeature()!.readme || '';
    if (this.selectedSubsystem()) return this.selectedSubsystem()!.readme || '';
    if (this.selectedSystem()) return this.selectedSystem()!.readme || '';
    return '';
  });

  // Check if AI is available
  aiEnabled = computed(() => this.aiService.isConfigured());

  // Effect to update editor when selection changes
  constructor() {
    effect(() => {
        this.editableReadme.set(this.currentReadme());
    });
    
    // Set default model when platform changes
    effect(() => {
        const models = this.availableModels();
        if (models && models.length > 0) {
            this.exportModel.set(models[0]);
        }
    });
  }

  saveReadme() {
    const content = this.editableReadme();
    const feat = this.selectedFeature();
    const sub = this.selectedSubsystem();
    const sys = this.selectedSystem();

    if (feat && sub && sys) {
        this.dataService.updateFeatureReadme(sys.id, sub.id, feat.id, content);
    } else if (sub && sys) {
        this.dataService.updateSubsystemReadme(sys.id, sub.id, content);
    } else if (sys) {
        this.dataService.updateSystemReadme(sys.id, content);
    }
  }

  // --- Folder Logic ---
  addFolder() {
    const sys = this.selectedSystem();
    if (sys && this.newFolderName().trim()) {
        this.dataService.addSystemFolder(sys.id, {
            name: this.newFolderName(),
            category: this.newFolderCategory(),
            note: this.newFolderNote()
        });
        this.newFolderName.set('');
        this.newFolderNote.set('');
        this.newFolderCategory.set('Library');
    }
  }

  deleteFolder(folderId: string) {
     const sys = this.selectedSystem();
     if (sys) {
         if (confirm('Delete this folder?')) {
            this.dataService.deleteSystemFolder(sys.id, folderId);
         }
     }
  }

  getCategoryClass(category: FolderCategory) {
      switch(category) {
          case 'UI': return 'bg-purple-100 text-purple-800 dark:bg-purple-900/50 dark:text-purple-300';
          case 'Service': return 'bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-300';
          case 'Library': return 'bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-300';
          case 'Documentation': return 'bg-orange-100 text-orange-800 dark:bg-orange-900/50 dark:text-orange-300';
          case 'Config': return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/50 dark:text-yellow-300';
          case 'data': return 'bg-teal-100 text-teal-800 dark:bg-teal-900/50 dark:text-teal-300';
          case 'api': return 'bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-300';
          default: return 'bg-gray-100 text-gray-800';
      }
  }

  triggerImport(mode: 'append' | 'replace', input: HTMLInputElement) {
    this.importMode = mode;
    input.value = ''; // Reset to allow re-selecting same file
    input.click();
  }

  onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input.files?.length) return;
    
    const file = input.files[0];
    const reader = new FileReader();
    
    reader.onload = (e) => {
        const text = e.target?.result as string;
        if (this.importMode === 'replace') {
             if (!this.editableReadme() || confirm('This will replace the current documentation. Continue?')) {
                 this.editableReadme.set(text);
             }
        } else {
             const current = this.editableReadme();
             this.editableReadme.set(current ? current + '\n\n' + text : text);
        }
    };
    reader.readAsText(file);
  }

  filteredRequirements = computed(() => {
    let reqs = this.dataService.requirements();
    const fId = this.dataService.selectedFeatureId();
    const sId = this.dataService.selectedSubsystemId();
    const sysId = this.dataService.selectedSystemId();

    // Context Filtering
    if (fId) reqs = reqs.filter(r => r.featureId === fId);
    else if (sId) reqs = reqs.filter(r => r.subsystemId === sId);
    else if (sysId) reqs = reqs.filter(r => r.systemId === sysId);

    // Search Filtering
    const term = this.searchTerm().toLowerCase();
    if (term) {
        reqs = reqs.filter(r => 
            r.title.toLowerCase().includes(term) || 
            r.description.toLowerCase().includes(term)
        );
    }

    return reqs;
  });

  canAddRequirement = computed(() => !!this.dataService.selectedSystemId());

  closeModal() {
    this.showModal.set(false);
    this.isDuplicating.set(false);
  }

  // ── Acceptance Criteria Helpers ────────────────────────────────
  addCriterion() {
    if (!this.newCriterionText.trim()) return;
    this.newAcceptanceCriteria.update(criteria => [
      ...criteria,
      { criterion: this.newCriterionText.trim(), done: false }
    ]);
    this.newCriterionText = '';
  }

  removeCriterion(index: number) {
    this.newAcceptanceCriteria.update(criteria => criteria.filter((_, i) => i !== index));
  }

  toggleCriterion(index: number) {
    this.newAcceptanceCriteria.update(criteria =>
      criteria.map((c, i) => i === index ? { ...c, done: !c.done } : c)
    );
  }

  openAddModal() {
    this.editingReqId.set(null);
    this.isDuplicating.set(false);
    this.newReqTitle = '';
    this.newReqDesc = '';
    this.newReqPriority = 'Medium';
    this.newReqType.set(null);
    this.newReqParentId.set(null);
    this.newAcceptanceCriteria.set([]);
    this.newCriterionText = '';

    // Pre-fill with current context
    this.modalSystemId.set(this.dataService.selectedSystemId());
    this.modalSubsystemId.set(this.dataService.selectedSubsystemId());
    this.modalFeatureId.set(this.dataService.selectedFeatureId());

    this.showModal.set(true);
  }

  openEditModal(req: Requirement) {
    this.editingReqId.set(req.id);
    this.isDuplicating.set(false);
    this.newReqTitle = req.title;
    this.newReqDesc = req.description;
    this.newReqPriority = req.priority;
    this.newReqType.set(req.reqType || null);
    this.newReqParentId.set(req.parentId || null);
    this.newAcceptanceCriteria.set(req.acceptanceCriteria || []);
    this.newCriterionText = '';

    // Pre-fill with requirement's own context
    this.modalSystemId.set(req.systemId);
    this.modalSubsystemId.set(req.subsystemId);
    this.modalFeatureId.set(req.featureId);

    this.showModal.set(true);
  }

  openDuplicateModal(req: Requirement) {
    this.editingReqId.set(null); // Ensure we are in create mode
    this.isDuplicating.set(true);

    this.newReqTitle = `${req.title} (Copy)`;
    this.newReqDesc = req.description;
    this.newReqPriority = req.priority;
    this.newReqType.set(req.reqType || null);
    this.newReqParentId.set(null); // Duplicates start fresh
    this.newAcceptanceCriteria.set(
      (req.acceptanceCriteria || []).map(c => ({ ...c, done: false }))
    );
    this.newCriterionText = '';

    this.modalSystemId.set(req.systemId);
    this.modalSubsystemId.set(req.subsystemId);
    this.modalFeatureId.set(req.featureId);

    this.showModal.set(true);
  }

  openAiModal() {
    if (!this.aiEnabled()) {
        this.apiKeyInput = '';
        this.showApiKeyModal.set(true);
        return;
    }
    this.userStoryPrompt = '';
    this.showAiModal.set(true);
  }

  configureApiKey() {
    if (this.apiKeyInput.trim()) {
        const success = this.aiService.configure(this.apiKeyInput.trim());
        if (success) {
            this.showApiKeyModal.set(false);
            // Do not automatically open the AI generation modal
        } else {
            alert('Failed to configure AI service.');
        }
    }
  }

  async generateAiRequirements() {
    const feat = this.selectedFeature();
    const sub = this.selectedSubsystem();
    const sys = this.selectedSystem();
    
    if (!feat || !sub || !sys || !this.userStoryPrompt.trim()) return;

    this.isGenerating.set(true);
    const context = `System: ${sys.name}, Subsystem: ${sub.name}, Feature: ${feat.name}`;

    let docStack = '';
    if (sys.readme) docStack += `[SYSTEM DOCS]:\n${sys.readme}\n\n`;
    if (sub.readme) docStack += `[SUBSYSTEM DOCS]:\n${sub.readme}\n\n`;
    if (feat.readme) docStack += `[FEATURE DOCS]:\n${feat.readme}\n\n`;

    try {
      const generated = await this.aiService.generateRequirements(context, docStack, this.userStoryPrompt);
      
      generated.forEach(req => {
        this.dataService.addRequirement({
          title: req.title,
          description: req.description,
          priority: req.priority,
          status: 'Backlog',
          systemId: sys.id,
          subsystemId: sub.id,
          featureId: feat.id
        });
      });
      
      this.showAiModal.set(false);
    } finally {
      this.isGenerating.set(false);
    }
  }

  // --- Modal Logic ---

  onModalSystemChange(systemId: string) {
    this.modalSystemId.set(systemId);
    // Cascade reset/update
    const availableSubs = this.modalAvailableSubsystems();
    this.onModalSubsystemChange(availableSubs.length > 0 ? availableSubs[0].id : null);
  }

  onModalSubsystemChange(subsystemId: string | null) {
      this.modalSubsystemId.set(subsystemId);
      // Cascade reset/update
      const availableFeats = this.modalAvailableFeatures();
      this.modalFeatureId.set(availableFeats.length > 0 ? availableFeats[0].id : null);
  }

  saveManual() {
    const sysId = this.modalSystemId();
    const subId = this.modalSubsystemId();
    const featId = this.modalFeatureId();

    if (!sysId || !subId || !featId) {
        alert("A requirement must be linked to a System, Subsystem, and Feature.");
        return;
    }

    const payload = {
        title: this.newReqTitle,
        description: this.newReqDesc,
        priority: this.newReqPriority,
        systemId: sysId,
        subsystemId: subId,
        featureId: featId,
        reqType: this.newReqType(),
        parentId: this.newReqParentId() || undefined,
        acceptanceCriteria: this.newAcceptanceCriteria().length > 0 ? this.newAcceptanceCriteria() : undefined,
    };

    // Edit mode
    const editId = this.editingReqId();
    if (editId) {
        this.dataService.updateRequirement(editId, payload);
    } else {
        // Create or Duplicate mode
        this.dataService.addRequirement({
            ...payload,
            status: 'Backlog',
        });
    }
    
    this.closeModal();
  }

  // --- Export Logic ---

  toggleExportFilter() {
     this.includeInProgress.update(v => !v);
     // Re-generate context with new filter
     this.generateExportContext(this.includeInProgress());
  }

  copyPrompt(req?: Requirement) {
      if (req) {
          // Single Requirement Export
          this.generateExportContext(false, req);
          this.showExportModal.set(true);
      } else {
          // Scope Export (Default: ToDo only)
          this.includeInProgress.set(false);
          this.generateExportContext(false);
          this.showExportModal.set(true);
      }
  }

  generateExportContext(includeInProgress: boolean, singleReq?: Requirement) {
    const sys = this.selectedSystem();
    const sub = this.selectedSubsystem();
    const feat = this.selectedFeature();
    
    let content = 'PROJECT CONTEXT\n===============\n';
    if (sys) content += `System: ${sys.name}\nDescription: ${sys.description}\n\n`;
    if (sub) content += `Subsystem: ${sub.name}\nDescription: ${sub.description}\n\n`;
    if (feat) content += `Feature: ${feat.name}\nDescription: ${feat.description}\n\n`;

    content += 'DOCUMENTATION\n=============\n';
    if (sys?.readme) content += `[SYSTEM: ${sys.name}]\n${sys.readme}\n\n`;
    if (sub?.readme) content += `[SUBSYSTEM: ${sub.name}]\n${sub.readme}\n\n`;
    if (feat?.readme) content += `[FEATURE: ${feat.name}]\n${feat.readme}\n\n`;

    // Add Folders to Context if System
    if (sys?.folders && sys.folders.length > 0) {
        content += `\n[SYSTEM STRUCTURE]\n`;
        sys.folders.forEach(f => {
            content += `- ${f.name} [${f.category}]: ${f.note}\n`;
        });
        content += `\n`;
    }

    if (singleReq) {
      content += 'SELECTED REQUIREMENT\n====================\n';
      content += `Title: ${singleReq.title}\n`;
      content += `Status: ${singleReq.status}\n`;
      content += `Priority: ${singleReq.priority}\n`;
      content += `Description:\n${singleReq.description}\n`;
      
      content += '\nTASK\n====\n';
      content += `[Generate implementation steps, test cases, or code for: "${singleReq.title}"]\n`;
      
      this.exportParentId.set(singleReq.id);
      this.exportParentType.set('requirement');
      this.exportParentName.set(singleReq.title);
      this.pendingExportReqIds.set([]); // No status update for single export? Or should we? Assuming no for now based on req.
    } else {
        // ROLL-UP REQUIREMENTS LOGIC
        const allReqs = this.dataService.requirements();
        let scopeReqs: Requirement[] = [];

        if (feat) {
            scopeReqs = allReqs.filter(r => r.featureId === feat.id);
        } else if (sub) {
            scopeReqs = allReqs.filter(r => r.subsystemId === sub.id);
        } else if (sys) {
            scopeReqs = allReqs.filter(r => r.systemId === sys.id);
        } else {
             scopeReqs = allReqs; 
        }

        // Apply Status Filter
        // Default: ToDo. With Toggle: ToDo + InProgress
        const allowedStatuses: Status[] = includeInProgress ? ['ToDo', 'InProgress'] : ['ToDo'];
        
        const filteredReqs = scopeReqs.filter(r => allowedStatuses.includes(r.status));
        this.pendingExportReqIds.set(filteredReqs.map(r => r.id));

        if (filteredReqs.length > 0) {
            content += 'SCOPE REQUIREMENTS\n==================\n';
            filteredReqs.forEach((r, index) => {
                content += `${index + 1}. [${r.status}] ${r.title} (Priority: ${r.priority})\n`;
                if (r.description) {
                    content += `   Details: ${r.description.replace(/\n/g, '\n   ')}\n`;
                }
                content += '\n';
            });
        }

        content += 'TASK\n====\n';
        content += '[Enter instruction here, e.g., Implement the requirements listed above, Generate test plan, etc.]\n';
        
        // Determine parent scope IDs for the session record
        if (feat) {
            this.exportParentId.set(feat.id);
            this.exportParentType.set('feature');
            this.exportParentName.set(feat.name);
        } else if (sub) {
            this.exportParentId.set(sub.id);
            this.exportParentType.set('subsystem');
            this.exportParentName.set(sub.name);
        } else if (sys) {
            this.exportParentId.set(sys.id);
            this.exportParentType.set('system');
            this.exportParentName.set(sys.name);
        }
    }
    
    this.exportContextText.set(content);
  }

  saveExportSession(action: 'copy' | 'download') {
      // 1. Save to DB
      this.dataService.addWorkSession({
          parentId: this.exportParentId(),
          parentType: this.exportParentType(),
          parentName: this.exportParentName(),
          context: this.exportContextText(),
          platform: this.exportPlatform(),
          model: this.exportModel(),
          status: 'Pending'
      });
      
      // 2. Update Requirements Status
      if (this.pendingExportReqIds().length > 0) {
          this.dataService.batchUpdateRequirementStatus(this.pendingExportReqIds(), 'InProgress');
      }

      // 3. Perform action: copy or download
      if (action === 'copy') {
          navigator.clipboard.writeText(this.exportContextText()).then(() => {
              alert('Session Created! Context copied to clipboard.');
          }).catch(err => {
              console.error('Copy failed', err);
              alert('Session Created, but failed to copy text automatically.');
          });
      } else { // 'download'
          this.downloadContextAsFile();
      }

      // 4. Close & Reset
      this.showExportModal.set(false);
  }

  private downloadContextAsFile() {
    const context = this.exportContextText();
    const parentName = this.exportParentName()
      .replace(/\s+/g, '_') // Replace spaces with underscores
      .replace(/[^a-zA-Z0-9_]/g, '') // Remove non-alphanumeric chars
      .slice(0, 50);
    const timestamp = new Date().toISOString().slice(0, 10);
    const filename = `nebula-session-${parentName}-${timestamp}.md`;
    
    const blob = new Blob([context], { type: 'text/markdown;charset=utf-8;' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a); // Required for Firefox
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
    
    alert('Session Created! Context file is downloading.');
  }
}
