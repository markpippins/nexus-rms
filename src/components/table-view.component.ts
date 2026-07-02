
import { Component, input, output, signal, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DataService } from '../services/data.service';
import { Requirement, Status } from '../models/data.models';
import { getTypeBadgeClass, getTypeLabel } from '../utils/requirement-utils';
import { RequirementHierarchyState } from '../services/requirement-hierarchy.state';

@Component({
  selector: 'app-table-view',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './table-view.component.html',
  host: {
    'style': 'display: flex; flex-direction: column; flex: 1; min-height: 0; width: 100%;'
  }
})
export class TableViewComponent {
  dataService = inject(DataService);
  requirements = input.required<Requirement[]>();
  editReq = output<Requirement>();
  copyReqPrompt = output<Requirement>();
  duplicateReq = output<Requirement>();
  
  sortField = signal<keyof Requirement | 'date'>('date');
  sortDirection = signal<'asc' | 'desc'>('desc');

  subsystemColors = computed(() => this.dataService.subsystemColorMap());

  private hierarchy = new RequirementHierarchyState(this.dataService, this.requirements);

  // Delegates for template access
  toggleExpand = (req: Requirement, event: Event) => this.hierarchy.toggleExpand(req, event);
  hasInlineChildren = (parentId: string) => this.hierarchy.hasInlineChildren(parentId);
  getChildren = (parentId: string) => this.hierarchy.getChildren(parentId);
  isExpanded = (reqId: string) => this.hierarchy.isExpanded(reqId);
  isLoadingChildren = (reqId: string) => this.hierarchy.isLoadingChildren(reqId);
  getDepCount = (reqId: string) => this.hierarchy.getDepCount(reqId);

  sortedRequirements = computed(() => {
    const reqs = [...this.requirements()];
    const field = this.sortField();
    const dir = this.sortDirection();

    return reqs.sort((a, b) => {
      let valA: any = a[field as keyof Requirement];
      let valB: any = b[field as keyof Requirement];

      if (field === 'date') {
        valA = a.createdAt;
        valB = b.createdAt;
      }
      
      if (field === 'reqType') {
        valA = a.reqType || '';
        valB = b.reqType || '';
      }

      if (valA < valB) return dir === 'asc' ? -1 : 1;
      if (valA > valB) return dir === 'asc' ? 1 : -1;
      return 0;
    });
  });

  toggleSort(field: keyof Requirement | 'date') {
    if (this.sortField() === field) {
      this.sortDirection.update(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      this.sortField.set(field);
      this.sortDirection.set('desc'); // Default to desc for new columns usually better for dates/importance
    }
  }

  getPriorityClass(priority: string) {
    switch(priority) {
      case 'High': return 'bg-red-100 text-red-800';
      case 'Medium': return 'bg-yellow-100 text-yellow-800';
      case 'Low': return 'bg-blue-100 text-blue-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  }

  getStatusClass(status: string) {
     switch(status) {
      case 'Done': return 'bg-green-100 text-green-800';
      case 'InProgress': return 'bg-blue-100 text-blue-800';
      case 'ToDo': return 'bg-gray-100 text-gray-800';
      case 'Backlog': return 'bg-purple-100 text-purple-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  }

  onEdit(req: Requirement, event: Event) {
    event.stopPropagation();
    this.editReq.emit(req);
  }

  onCopy(req: Requirement, event: Event) {
    event.stopPropagation();
    this.copyReqPrompt.emit(req);
  }

  onDuplicate(req: Requirement, event: Event) {
    event.stopPropagation();
    this.duplicateReq.emit(req);
  }

  deleteReq(id: string, event: Event) {
    event.stopPropagation();
    console.log('Deleting requirement:', id);
    this.dataService.deleteRequirement(id);
  }

  // Shared type badge helpers
  getTypeBadgeClass = getTypeBadgeClass;
  getTypeLabel = getTypeLabel;

  getIndentClass(req: Requirement): string {
    return req.parentId ? 'bg-gray-50/50 dark:bg-gray-700/30' : '';
  }
}