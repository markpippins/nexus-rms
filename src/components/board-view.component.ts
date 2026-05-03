
import { Component, inject, input, output, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DataService } from '../services/data.service';
import { Requirement, Status } from '../models/data.models';

@Component({
  selector: 'app-board-view',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './board-view.component.html'
})
export class BoardViewComponent {
  dataService = inject(DataService);
  requirements = input.required<Requirement[]>();
  copyReqPrompt = output<Requirement>();
  editReq = output<Requirement>();
  duplicateReq = output<Requirement>();

  columns: Status[] = ['Backlog', 'ToDo', 'InProgress', 'Done'];
  draggedReqId: string | null = null;
  
  subsystemColors = computed(() => this.dataService.subsystemColorMap());

  getRequirementsByStatus(status: Status) {
    return this.requirements().filter(r => r.status === status);
  }

  formatStatus(status: string) {
    return status.replace(/([A-Z])/g, ' $1').trim();
  }

  getPriorityColor(priority: string) {
    switch(priority) {
      case 'High': return 'bg-red-500';
      case 'Medium': return 'bg-yellow-500';
      case 'Low': return 'bg-blue-400';
      default: return 'bg-gray-300';
    }
  }

  deleteReq(id: string, event: Event) {
    event.stopPropagation();
    console.log('Deleting requirement:', id);
    this.dataService.deleteRequirement(id);
  }

  onCopy(req: Requirement, event: Event) {
    event.stopPropagation();
    this.copyReqPrompt.emit(req);
  }

  onEdit(req: Requirement, event: Event) {
      event.stopPropagation();
      this.editReq.emit(req);
  }

  onDuplicate(req: Requirement, event: Event) {
    event.stopPropagation();
    this.duplicateReq.emit(req);
  }

  // --- Drag and Drop Logic ---
  onDragStart(event: DragEvent, id: string) {
    this.draggedReqId = id;
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', id);
    }
  }

  onDragOver(event: DragEvent) {
    event.preventDefault(); 
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
  }

  onDrop(event: DragEvent, newStatus: Status) {
    event.preventDefault();
    const id = this.draggedReqId;
    if (id) {
      this.dataService.updateRequirementStatus(id, newStatus);
    }
    this.draggedReqId = null;
  }

  moveStatus(req: Requirement, direction: number) {
     const idx = this.columns.indexOf(req.status);
     const newIdx = idx + direction;
     if (newIdx >= 0 && newIdx < this.columns.length) {
        this.dataService.updateRequirementStatus(req.id, this.columns[newIdx]);
     }
  }
}
