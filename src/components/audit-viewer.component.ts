import { Component, inject, signal, computed, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DataService } from '../services/data.service';
import { AuditFile } from '../models/data.models';
import { renderMarkdown } from '../utils/markdown';

@Component({
  selector: 'app-audit-viewer',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './audit-viewer.component.html'
})
export class AuditViewerComponent {
  dataService = inject(DataService);

  selectedFile = signal<AuditFile | null>(null);
  loading = signal(false);

  constructor() {
    // Fetch full content when selected file changes
    effect(() => {
      const id = this.dataService.selectedAuditFileId();
      if (!id) {
        this.selectedFile.set(null);
        return;
      }
      this.loading.set(true);
      this.dataService.getAuditFileContent(id).then(file => {
        this.selectedFile.set(file);
        this.loading.set(false);
      }).catch(() => {
        this.loading.set(false);
      });
    });
  }

  get displayName(): string {
    const file = this.selectedFile();
    if (!file) return '';
    const parts = file.filePath.split('/');
    return parts[parts.length - 1];
  }

  get displayPath(): string {
    return this.selectedFile()?.filePath || '';
  }

  async regenerate() {
    const file = this.selectedFile();
    if (!file) return;
    this.loading.set(true);
    await this.dataService.regenerateAuditFile(file.id);
    // Re-fetch the updated content
    const updated = await this.dataService.getAuditFileContent(file.id);
    this.selectedFile.set(updated);
    this.loading.set(false);
  }

  // Use shared markdown renderer
  renderMarkdown = renderMarkdown;
}
