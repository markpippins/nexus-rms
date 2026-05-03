
import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DataService } from '../services/data.service';
import { FormsModule } from '@angular/forms';
import { System, Subsystem, Feature } from '../models/data.models';

@Component({
  selector: 'app-hierarchy-nav',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './hierarchy-nav.component.html'
})
export class HierarchyNavComponent {
  dataService = inject(DataService);

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

  selectSystem(id: string) {
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

  selectSubsystem(systemId: string, subId: string) {
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

  selectFeature(systemId: string, subId: string, featureId: string) {
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
}
