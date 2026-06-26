import { Component, inject, signal, computed, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DataService } from '../services/data.service';
import { AuditFile, AuditTreeNode } from '../models/data.models';

@Component({
  selector: 'app-audit-tree',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './audit-tree.component.html'
})
export class AuditTreeComponent {
  dataService = inject(DataService);

  searchQuery = signal('');
  expandedDirs = signal<Set<string>>(new Set());

  constructor() {
    // Auto-expand all directories when a search query is active
    effect(() => {
      const query = this.searchQuery().toLowerCase().trim();
      if (query) {
        this.expandAllDirs(this.tree());
      }
    });
  }

  // Build tree from flat file list
  tree = computed<AuditTreeNode[]>(() => {
    const files = this.dataService.auditFiles();
    const root: AuditTreeNode[] = [];
    const dirMap = new Map<string, AuditTreeNode>();

    // Sort files by path
    const sorted = [...files].sort((a, b) => a.filePath.localeCompare(b.filePath));

    for (const file of sorted) {
      const parts = file.filePath.split('/');
      let currentChildren = root;

      // Navigate/create directory nodes
      for (let i = 0; i < parts.length - 1; i++) {
        const dirPath = parts.slice(0, i + 1).join('/');
        let dirNode = dirMap.get(dirPath);
        if (!dirNode) {
          dirNode = {
            name: parts[i],
            path: dirPath,
            type: 'directory',
            children: [],
          };
          dirMap.set(dirPath, dirNode);
          currentChildren.push(dirNode);
        }
        currentChildren = dirNode.children!;
      }

      // Add file node
      const fileName = parts[parts.length - 1];
      currentChildren.push({
        name: fileName,
        path: file.filePath,
        type: 'file',
      });
    }

    return root;
  });

  // Filter tree by search
  filteredTree = computed(() => {
    const query = this.searchQuery().toLowerCase().trim();
    if (!query) return this.tree();
    return this.filterNodes(this.tree(), query);
  });

  private filterNodes(nodes: AuditTreeNode[], query: string): AuditTreeNode[] {
    const result: AuditTreeNode[] = [];
    for (const node of nodes) {
      if (node.type === 'file') {
        if (node.name.toLowerCase().includes(query) || node.path.toLowerCase().includes(query)) {
          result.push(node);
        }
      } else if (node.children) {
        const filteredChildren = this.filterNodes(node.children, query);
        if (filteredChildren.length > 0) {
          result.push({ ...node, children: filteredChildren });
        }
      }
    }
    return result;
  }

  isExpanded(dirPath: string): boolean {
    return this.expandedDirs().has(dirPath);
  }

  toggleDir(dirPath: string) {
    this.expandedDirs.update(set => {
      const next = new Set(set);
      if (next.has(dirPath)) {
        next.delete(dirPath);
      } else {
        next.add(dirPath);
      }
      return next;
    });
  }

  private expandAllDirs(nodes: AuditTreeNode[]) {
    for (const node of nodes) {
      if (node.type === 'directory') {
        this.expandedDirs.update(set => {
          const next = new Set(set);
          next.add(node.path);
          return next;
        });
        if (node.children) this.expandAllDirs(node.children);
      }
    }
  }

  selectFile(file: AuditTreeNode) {
    if (file.type !== 'file') return;
    const auditFile = this.dataService.auditFiles().find(f => f.filePath === file.path);
    if (auditFile) {
      this.dataService.selectedAuditFileId.set(auditFile.id);
      // Auto-expand parent directories so the selected file is visible
      const parts = file.path.split('/');
      for (let i = 1; i < parts.length; i++) {
        const dirPath = parts.slice(0, i).join('/');
        this.expandedDirs.update(set => {
          const next = new Set(set);
          next.add(dirPath);
          return next;
        });
      }
    }
  }

  isSelected(filePath: string): boolean {
    const selectedId = this.dataService.selectedAuditFileId();
    if (!selectedId) return false;
    const file = this.dataService.auditFiles().find(f => f.id === selectedId);
    return file?.filePath === filePath;
  }

  syncFiles() {
    this.dataService.syncAuditFiles();
  }
}
