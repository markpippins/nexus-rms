
import { Component, inject, input, computed, signal, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DataService } from '../services/data.service';
import { WorkSession } from '../models/data.models';

@Component({
  selector: 'app-work-session-view',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './work-session-view.component.html'
})
export class WorkSessionViewComponent {
  dataService = inject(DataService);

  // Filters from parent selection
  selectedSystemId = computed(() => this.dataService.selectedSystemId());
  selectedSubsystemId = computed(() => this.dataService.selectedSubsystemId());
  selectedFeatureId = computed(() => this.dataService.selectedFeatureId());

  // Editing State
  editingSession = signal<WorkSession | null>(null);
  editOutcome = signal('');

  // Filtered Sessions
  sessions = computed(() => {
    const all = this.dataService.workSessions();
    const sysId = this.selectedSystemId();
    const subId = this.selectedSubsystemId();
    const featId = this.selectedFeatureId();

    if (featId) {
        // Show Feature sessions + Requirement sessions belonging to this feature
        // Finding req ids for this feature
        const reqIds = this.dataService.requirements()
            .filter(r => r.featureId === featId)
            .map(r => r.id);
        
        return all.filter(s => s.parentId === featId || reqIds.includes(s.parentId));
    }

    if (subId) {
        return all.filter(s => s.parentId === subId);
    }

    if (sysId) {
        return all.filter(s => s.parentId === sysId);
    }

    // Fallback: show all if nothing selected (or handle as "Select item")
    return all;
  });

  openEdit(session: WorkSession) {
    this.editingSession.set(session);
    this.editOutcome.set(session.outcome || '');
  }

  saveOutcome() {
    const session = this.editingSession();
    if (session) {
        this.dataService.updateWorkSession(session.id, {
            outcome: this.editOutcome(),
            status: 'Completed'
        });
        this.editingSession.set(null);
    }
  }

  cancelEdit() {
    this.editingSession.set(null);
  }

  deleteSession(id: string, event: Event) {
    event.stopPropagation();
    if(confirm('Delete this work session history?')) {
        this.dataService.deleteWorkSession(id);
    }
  }

  getTypeClass(type: string) {
    switch(type) {
        case 'system': return 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200';
        case 'subsystem': return 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200';
        case 'feature': return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200';
        case 'requirement': return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200';
        default: return 'bg-gray-100 text-gray-800';
    }
  }
}
