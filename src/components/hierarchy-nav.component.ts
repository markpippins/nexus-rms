
import { Component, inject, signal, computed, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DataService } from '../services/data.service';
import { ToastService } from '../services/toast.service';
import { FormsModule } from '@angular/forms';
import { System, Subsystem, Feature, HarvestCandidate } from '../models/data.models';

@Component({
  selector: 'app-hierarchy-nav',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './hierarchy-nav.component.html'
})
export class HierarchyNavComponent {
  dataService = inject(DataService);
  toastService = inject(ToastService);

  isAddingSystem = signal(false);
  addingSubsystemTo = signal<string | null>(null);
  addingFeatureTo = signal<string | null>(null);

  newSystemName = '';
  newSubsystemName = '';
  newFeatureName = '';

  // --- Collapsible State ---
  collapsedSystems = signal(new Set<string>());
  collapsedSubsystems = signal(new Set<string>());

  // --- Inline Editing State ---
  editingItem = signal<{ type: 'System' | 'Subsystem' | 'Feature', id: string, systemId?: string, subsystemId?: string } | null>(null);
  editingName = signal('');

  // --- Move/Reparent Modal State ---
  showMoveModal = signal(false);
  moveTargetType = signal<'System' | 'Subsystem' | 'Feature'>('System'); // What we are moving
  movingItemId = signal<string | null>(null);
  movingItemName = signal<string>('');
  
  // For Feature Move:
  targetSystemIdForFeature = signal<string>('');
  
  // Selection
  selectedMoveTargetId = signal<string>('');

  selectSystem(id: string, event?: MouseEvent) {
    // Ctrl/Meta+click on already-selected system clears the filter
    if (event && (event.ctrlKey || event.metaKey) && this.dataService.selectedSystemId() === id) {
      this.dataService.selectedSystemId.set(null);
      this.dataService.selectedSubsystemId.set(null);
      this.dataService.selectedFeatureId.set(null);
      return;
    }
    this.dataService.selectedSystemId.set(id);
    this.dataService.selectedSubsystemId.set(null);
    this.dataService.selectedFeatureId.set(null);
    // Expand when selected
    this.collapsedSystems.update(set => {
      const newSet = new Set(set);
      newSet.delete(id);
      return newSet;
    });
  }

  selectSubsystem(systemId: string, subId: string, event?: MouseEvent) {
    // Ctrl/Meta+click on already-selected subsystem clears the filter
    if (event && (event.ctrlKey || event.metaKey) && this.dataService.selectedSubsystemId() === subId) {
      this.dataService.selectedSystemId.set(null);
      this.dataService.selectedSubsystemId.set(null);
      this.dataService.selectedFeatureId.set(null);
      return;
    }
    this.dataService.selectedSystemId.set(systemId);
    this.dataService.selectedSubsystemId.set(subId);
    this.dataService.selectedFeatureId.set(null);
    // Expand subsystem and its parent system
    this.collapsedSystems.update(set => {
      const newSet = new Set(set);
      newSet.delete(systemId);
      return newSet;
    });
    this.collapsedSubsystems.update(set => {
      const newSet = new Set(set);
      newSet.delete(subId);
      return newSet;
    });
  }

  selectFeature(systemId: string, subId: string, featureId: string, event?: MouseEvent) {
    // Ctrl/Meta+click on already-selected feature clears the filter
    if (event && (event.ctrlKey || event.metaKey) && this.dataService.selectedFeatureId() === featureId) {
      this.dataService.selectedSystemId.set(null);
      this.dataService.selectedSubsystemId.set(null);
      this.dataService.selectedFeatureId.set(null);
      return;
    }
    this.dataService.selectedSystemId.set(systemId);
    this.dataService.selectedSubsystemId.set(subId);
    this.dataService.selectedFeatureId.set(featureId);
     // Expand parents
     this.collapsedSystems.update(set => {
      const newSet = new Set(set);
      newSet.delete(systemId);
      return newSet;
    });
    this.collapsedSubsystems.update(set => {
      const newSet = new Set(set);
      newSet.delete(subId);
      return newSet;
    });
  }

  createSystem() {
    if (this.newSystemName.trim()) {
      this.dataService.addSystem(this.newSystemName, '');
      this.newSystemName = '';
      this.isAddingSystem.set(false);
    }
  }

  createSubsystem(systemId: string) {
    if (this.newSubsystemName.trim()) {
      this.dataService.addSubsystem(systemId, this.newSubsystemName, '');
      this.newSubsystemName = '';
      this.addingSubsystemTo.set(null);
    }
  }

  createFeature(systemId: string, subsystemId: string) {
     if (this.newFeatureName.trim()) {
      this.dataService.addFeature(systemId, subsystemId, this.newFeatureName, '');
      this.newFeatureName = '';
      this.addingFeatureTo.set(null);
    }
  }

  updateSubsystemColor(systemId: string, subId: string, event: Event) {
    const input = event.target as HTMLInputElement;
    if (input && input.value) {
        this.dataService.updateSubsystemColor(systemId, subId, input.value);
    }
  }

  // --- Import / Export ---
  triggerExport() {
    this.dataService.exportDatabase();
  }

  triggerImport(input: HTMLInputElement) {
    input.value = '';
    input.click();
  }

  onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files?.length) {
      this.dataService.importDatabase(input.files[0]);
    }
  }

  deleteSystem(id: string, event: Event) {
    event.stopPropagation();
    console.log('Deleting system:', id);
    this.dataService.deleteSystem(id);
  }

  deleteSubsystem(systemId: string, subId: string, event: Event) {
    event.stopPropagation();
    console.log('Deleting subsystem:', subId, 'from system:', systemId);
    this.dataService.deleteSubsystem(systemId, subId);
  }

  deleteFeature(systemId: string, subId: string, featId: string, event: Event) {
    event.stopPropagation();
    console.log('Deleting feature:', featId, 'from subsystem:', subId);
    this.dataService.deleteFeature(systemId, subId, featId);
  }

  // --- Collapsible Logic ---
  toggleSystem(id: string, event: Event) {
    event.stopPropagation();
    this.collapsedSystems.update(set => {
      const newSet = new Set(set);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  }

  isSystemCollapsed(id: string): boolean {
    return this.collapsedSystems().has(id);
  }

  toggleSubsystem(id: string, event: Event) {
    event.stopPropagation();
    this.collapsedSubsystems.update(set => {
      const newSet = new Set(set);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  }

  isSubsystemCollapsed(id: string): boolean {
    return this.collapsedSubsystems().has(id);
  }


  // --- Inline Editing Logic ---
  startEditing(
      type: 'System' | 'Subsystem' | 'Feature', 
      item: {id: string, name: string}, 
      event: Event, 
      systemId?: string, 
      subsystemId?: string
  ) {
      event.stopPropagation();
      this.editingItem.set({ type, id: item.id, systemId, subsystemId });
      this.editingName.set(item.name);
  }

  saveEdit() {
      const item = this.editingItem();
      const newName = this.editingName().trim();
      if (!item || !newName) {
          this.cancelEdit();
          return;
      }
      
      switch(item.type) {
          case 'System':
              this.dataService.updateSystemName(item.id, newName);
              break;
          case 'Subsystem':
              if (item.systemId) {
                  this.dataService.updateSubsystemName(item.systemId, item.id, newName);
              }
              break;
          case 'Feature':
              if (item.systemId && item.subsystemId) {
                  this.dataService.updateFeatureName(item.systemId, item.subsystemId, item.id, newName);
              }
              break;
      }

      this.cancelEdit();
  }

  cancelEdit() {
      this.editingItem.set(null);
      this.editingName.set('');
  }

  // --- Move Logic ---

  initiateMove(type: 'System' | 'Subsystem' | 'Feature', item: System | Subsystem | Feature, event: Event) {
      event.stopPropagation();
      this.moveTargetType.set(type);
      this.movingItemId.set(item.id);
      this.movingItemName.set(item.name);
      this.selectedMoveTargetId.set('');
      this.showMoveModal.set(true);

      // Pre-select first valid target if possible
      if (type === 'System' || type === 'Subsystem') {
          const firstSys = this.dataService.systems().find(s => s.id !== item.id); // Exclude self
          if (firstSys) this.selectedMoveTargetId.set(firstSys.id);
      } else if (type === 'Feature') {
          // Default to current system for feature move context
          const currentSysId = this.dataService.selectedSystemId();
          if (currentSysId) this.targetSystemIdForFeature.set(currentSysId);
      }
  }

  executeMove() {
      const type = this.moveTargetType();
      const itemId = this.movingItemId();
      const targetId = this.selectedMoveTargetId();

      if (!itemId || !targetId) return;

      if (type === 'System') {
          // Demote System -> Subsystem
          if (confirm(`Convert System "${this.movingItemName()}" into a Subsystem of the selected target? This will restructure its contents.`)) {
              this.dataService.demoteSystem(itemId, targetId);
          }
      } else if (type === 'Subsystem') {
          // Move Subsystem -> New System
          this.dataService.moveSubsystem(itemId, targetId);
      } else if (type === 'Feature') {
          // Move Feature -> New Subsystem
          const sysId = this.targetSystemIdForFeature(); // System of the target subsystem
          if (sysId) {
             this.dataService.moveFeature(itemId, sysId, targetId);
          }
      }

      this.showMoveModal.set(false);
  }

  // Helper for Feature move modal: Filter subsystems based on selected System
  availableSubsystemsForFeature = computed(() => {
      if (this.moveTargetType() !== 'Feature') return [];
      const sysId = this.targetSystemIdForFeature();
      if (!sysId) return [];
      const sys = this.dataService.sortedSystems().find(s => s.id === sysId);
      // subsystems are pre-sorted in sortedSystems computed property
      return sys ? sys.subsystems : [];
  });
  
  // Helper for System/Subsystem move: List of Systems
  availableSystems = computed(() => {
      const type = this.moveTargetType();
      const movingId = this.movingItemId();
      const sorted = this.dataService.sortedSystems();
      // Exclude self if moving a system
      if (type === 'System') {
          return sorted.filter(s => s.id !== movingId);
      }
      return sorted;
  });

  // ── Harvest Candidates Panel ────────────────────────────────────
  harvestCandidates = signal<HarvestCandidate[]>([]);
  candidatesLoading = signal(false);
  candidatesCount = signal(0);
  showCandidatesPanel = signal(false);
  private candidatesRequestId = 0; // race-condition guard

  // Candidate context (what level are we viewing candidates for)
  candidateContext = computed(() => {
    const sysId = this.dataService.selectedSystemId();
    const subId = this.dataService.selectedSubsystemId();
    const featId = this.dataService.selectedFeatureId();
    if (featId) return { level: 'Feature' as const, id: featId, label: 'feature' };
    if (subId) return { level: 'Subsystem' as const, id: subId, label: 'subsystem' };
    if (sysId) return { level: 'System' as const, id: sysId, label: 'system' };
    return null;
  });

  // Fetch candidates when selection changes (with race-condition guard)
  private candidatesEffect = effect(() => {
    const ctx = this.candidateContext();
    if (!ctx) {
      this.harvestCandidates.set([]);
      this.candidatesCount.set(0);
      return;
    }

    const requestId = ++this.candidatesRequestId;
    this.candidatesLoading.set(true);
    let promise: Promise<{ candidates: HarvestCandidate[]; count: number }>;

    if (ctx.level === 'System') {
      promise = this.dataService.getSystemHarvestCandidates(ctx.id).then(r => ({ candidates: r.candidates, count: r.count }));
    } else if (ctx.level === 'Subsystem') {
      promise = this.dataService.getSubsystemHarvestCandidates(ctx.id).then(r => ({ candidates: r.candidates, count: r.count }));
    } else {
      promise = this.dataService.getFeatureHarvestCandidates(ctx.id).then(r => ({ candidates: r.candidates, count: r.count }));
    }

    promise.then(({ candidates, count }) => {
      // Ignore stale responses
      if (requestId !== this.candidatesRequestId) return;
      this.harvestCandidates.set(candidates);
      this.candidatesCount.set(count);
      this.candidatesLoading.set(false);
      if (count > 0) this.showCandidatesPanel.set(true);
    }).catch(() => {
      if (requestId !== this.candidatesRequestId) return;
      this.candidatesLoading.set(false);
    });
  });

  toggleCandidatesPanel() {
    this.showCandidatesPanel.update(v => !v);
  }

  // ── Completed Toggle ────────────────────────────────────────────
  togglingCompletedId = signal<string | null>(null);

  async toggleCandidateCompleted(candidate: HarvestCandidate) {
    const previousValue = candidate.completed;
    const newValue = !previousValue;
    const actionLabel = newValue ? 'completed' : 'uncompleted';

    this.togglingCompletedId.set(candidate.id);

    // Optimistic update
    this.harvestCandidates.update(list =>
      list.map(c => c.id === candidate.id ? { ...c, completed: newValue } : c)
    );

    try {
      const result = await this.dataService.updateHarvestCandidate(candidate.id, { completed: newValue });
      if (result) {
        this.toastService.show(`"${candidate.title.slice(0, 40)}${candidate.title.length > 40 ? '…' : ''}" marked as ${actionLabel}`, 'success');
      } else {
        // Rollback on null response
        this.harvestCandidates.update(list =>
          list.map(c => c.id === candidate.id ? { ...c, completed: previousValue } : c)
        );
        this.toastService.show('Failed to update candidate status', 'error');
      }
    } catch (err: any) {
      console.error('Failed to toggle candidate completed:', err);
      // Rollback
      this.harvestCandidates.update(list =>
        list.map(c => c.id === candidate.id ? { ...c, completed: previousValue } : c)
      );
      this.toastService.show('Failed to update candidate status', 'error');
    } finally {
      this.togglingCompletedId.set(null);
    }
  }

  isTogglingCompleted(id: string): boolean {
    return this.togglingCompletedId() === id;
  }

  // ── Spawn Plan Flow ─────────────────────────────────────────────
  showSpawnPlanModal = signal(false);
  spawnPlanCandidate = signal<HarvestCandidate | null>(null);

  /** Select a candidate and open its detail in the right slide-out panel */
  viewCandidateDetail(candidate: HarvestCandidate) {
    // Toggle off if already selected
    if (this.dataService.selectedHarvestCandidateId() === candidate.id) {
      this.dataService.selectedHarvestCandidateId.set(null);
    } else {
      this.dataService.selectedHarvestCandidateId.set(candidate.id);
    }
  }

  /** Select a candidate and auto-expand its transcript in the right panel */
  viewCandidateTranscript(candidate: HarvestCandidate, event: Event) {
    event.stopPropagation();
    this.dataService.selectedHarvestCandidateId.set(candidate.id);
    this.dataService.autoExpandTranscript.set(true);
  }

  /** Watch for spawn plan intent from the right panel detail view */
  private spawnPlanIntentEffect = effect(() => {
    const candidate = this.dataService.spawnPlanIntent();
    if (candidate) {
      this.openSpawnPlan(candidate, new Event('intent'));
      // Clear the intent so it doesn't re-fire
      this.dataService.spawnPlanIntent.set(null);
    }
  });
  spawnPlanSystemId = '';
  spawnPlanSubsystemId = '';
  spawnPlanFeatureId = '';
  spawnPlanPlanRef = '';
  spawnPlanTitle = '';
  spawnPlanDescription = '';
  spawnPlanLoading = signal(false);
  spawnPlanResult = signal<string | null>(null);

  openSpawnPlan(candidate: HarvestCandidate, event: Event) {
    event.stopPropagation();
    this.spawnPlanCandidate.set(candidate);
    // Pre-populate from current selection
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
        const ctx = this.candidateContext();
        if (ctx) {
          this.candidatesLoading.set(true);
          if (ctx.level === 'System') {
            this.dataService.getSystemHarvestCandidates(ctx.id).then(r => {
              this.harvestCandidates.set(r.candidates);
              this.candidatesCount.set(r.count);
              this.candidatesLoading.set(false);
            });
          }
        }
        // Refresh requirements from server
        this.dataService.refreshRequirements();
      } else {
        this.spawnPlanResult.set('Failed to spawn plan.');
      }
    }).catch(() => {
      this.spawnPlanLoading.set(false);
      this.spawnPlanResult.set('Error spawning plan.');
    });
  }
}
