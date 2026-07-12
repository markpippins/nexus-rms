import { Component, inject, signal, computed, effect, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DataService } from '../services/data.service';
import { AuditFile } from '../models/data.models';
import { renderMarkdown } from '../utils/markdown';

interface SearchResultEntry {
  fileId: string;
  filePath: string;
  matchCount: number;
  snippets: { line: number; text: string }[];
}

@Component({
  selector: 'app-audit-viewer',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './audit-viewer.component.html',
  host: {
    'style': 'display: flex; flex-direction: column; min-height: 0; height: 100%'
  }
})
export class AuditViewerComponent {
  dataService = inject(DataService);

  selectedFile = signal<AuditFile | null>(null);
  loading = signal(false);

  // ── Find-in-file state (single file) ──────────────────────────
  searchQuery = signal('');
  currentMatchIndex = signal(0);

  /** Read find-in-file visibility from DataService (controlled by toolbar) */
  get showSearch(): boolean { return this.dataService.auditShowFindInFile(); }

  /** Read search mode from DataService (controlled by toolbar) */
  get searchMode(): string { return this.dataService.auditSearchMode(); }

  /** Rendered HTML with optional search highlighting */
  renderedHtml = computed(() => {
    const content = this.selectedFile()?.content || '';
    const term = this.searchQuery();
    return renderMarkdown(content, term || undefined);
  });

  /** Total matches counted from data-match-index attributes */
  totalMatches = computed(() => {
    const html = this.renderedHtml();
    const matches = html.match(/data-match-index=/g);
    return matches ? matches.length : 0;
  });

  // ── Global search (across all files) state ────────────────────
  globalSearchQuery = signal('');
  globalSearchLoading = signal(false);

  /** Cache of fileId → content for all fetched audit files */
  private contentCache = signal<Record<string, string>>({});

  /** Results computed from cache + query */
  globalSearchResults = computed(() => {
    const query = this.globalSearchQuery().toLowerCase().trim();
    const cache = this.contentCache();
    if (!query) return [] as SearchResultEntry[];

    const files = this.dataService.auditFiles();
    const fileMap = new Map(files.map(f => [f.id, f]));
    const results: SearchResultEntry[] = [];

    for (const [fileId, content] of Object.entries(cache)) {
      const file = fileMap.get(fileId);
      if (!file) continue;

      const lines = content.split('\n');
      const snippets: { line: number; text: string }[] = [];

      for (let i = 0; i < lines.length; i++) {
        const idx = lines[i].toLowerCase().indexOf(query);
        if (idx !== -1) {
          snippets.push({
            line: i + 1,
            text: lines[i].trim().slice(0, 200),
          });
          if (snippets.length >= 5) break; // cap at 5 snippets per file
        }
      }

      if (snippets.length > 0) {
        results.push({ fileId, filePath: file.filePath, matchCount: snippets.length, snippets });
      }
    }

    return results.sort((a, b) => b.matchCount - a.matchCount);
  });

  /** Total match count across all files */
  globalTotalMatches = computed(() =>
    this.globalSearchResults().reduce((sum, r) => sum + r.matchCount, 0)
  );

  /** All files count — for showing progress */
  totalFileCount = computed(() => this.dataService.auditFiles().length);

  cachedFileCount = computed(() => Object.keys(this.contentCache()).length);

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

    // Reset file-scoped search when file changes
    effect(() => {
      this.selectedFile(); // read dependency
      this.searchQuery.set('');
      this.dataService.auditShowFindInFile.set(false);
      this.currentMatchIndex.set(0);
    });

    // Reset match index when search query changes
    effect(() => {
      this.searchQuery(); // read dependency
      this.currentMatchIndex.set(0);
    });

    // Auto-populate cache when entering global search mode
    effect(() => {
      if (this.searchMode === 'all') {
        this.fetchAllFileContents();
      }
    });

    // Watch refresh trigger from toolbar — re-read current file
    effect(() => {
      this.dataService.auditRefreshTrigger(); // read dependency
      const file = this.selectedFile();
      if (file) {
        this.regenerate();
      }
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

  // ── Find-in-file methods (single file) ────────────────────────

  toggleSearch() {
    this.dataService.auditShowFindInFile.update(v => !v);
    if (!this.showSearch) {
      this.searchQuery.set('');
    } else {
      setTimeout(() => document.getElementById('audit-search-input')?.focus(), 0);
    }
  }

  nextMatch() {
    const total = this.totalMatches();
    if (total === 0) return;
    this.currentMatchIndex.update(i => (i + 1) % total);
    this.scrollToCurrentMatch();
  }

  prevMatch() {
    const total = this.totalMatches();
    if (total === 0) return;
    this.currentMatchIndex.update(i => (i - 1 + total) % total);
    this.scrollToCurrentMatch();
  }

  private scrollToCurrentMatch() {
    const idx = this.currentMatchIndex();
    setTimeout(() => {
      const el = document.querySelector(`[data-match-index="${idx}"]`);
      if (el) {
        document.querySelectorAll('[data-current-match]').forEach(e => e.removeAttribute('data-current-match'));
        el.setAttribute('data-current-match', '');
        el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }, 0);
  }

  // ── Global search methods (across all files) ───────────────────

  setSearchMode(mode: 'file' | 'all') {
    this.dataService.auditSearchMode.set(mode);
    if (mode === 'all') {
      this.dataService.auditShowFindInFile.set(false);
      this.searchQuery.set('');
    } else {
      this.globalSearchQuery.set('');
    }
    setTimeout(() => {
      (mode === 'all'
        ? document.getElementById('audit-global-search-input')
        : document.getElementById('audit-find-btn')
      )?.focus();
    }, 0);
  }

  /** Fetch content for all audit files in batches, populating the cache */
  async fetchAllFileContents() {
    const files = this.dataService.auditFiles();
    const cache = this.contentCache();
    const missing = files.filter(f => !cache[f.id]);
    if (missing.length === 0) return;

    this.globalSearchLoading.set(true);
    const batchSize = 10;

    for (let i = 0; i < missing.length; i += batchSize) {
      const batch = missing.slice(i, i + batchSize);
      const results = await Promise.allSettled(
        batch.map(f => this.dataService.getAuditFileContent(f.id))
      );
      const newCache = { ...this.contentCache() };
      for (const result of results) {
        if (result.status === 'fulfilled' && result.value) {
          newCache[result.value.id] = result.value.content;
        }
      }
      this.contentCache.set(newCache);
    }

    this.globalSearchLoading.set(false);
  }

  /** Navigate to a specific file from global search results */
  navigateToResult(fileId: string) {
    const query = this.globalSearchQuery();
    this.dataService.auditSearchMode.set('file');
    this.dataService.selectedAuditFileId.set(fileId);
    // Carry the search term into per-file find so highlights show immediately
    this.searchQuery.set(query);
    this.dataService.auditShowFindInFile.set(true);
  }

  /** Format file path for display (show last 2 path segments + filename) */
  formatSearchPath(filePath: string): string {
    const parts = filePath.split('/');
    if (parts.length <= 2) return filePath;
    return '…/' + parts.slice(-2).join('/');
  }

  // ── Keyboard handling ─────────────────────────────────────────

  @HostListener('document:keydown', ['$event'])
  handleKeydown(e: KeyboardEvent) {
    // Ctrl+Shift+F / Cmd+Shift+F — toggle global search
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'F') {
      if (this.totalFileCount() > 0) {
        e.preventDefault();
        this.setSearchMode(this.searchMode === 'all' ? 'file' : 'all');
      }
      return;
    }

    // Ctrl+F / Cmd+F — toggle per-file search
    if ((e.ctrlKey || e.metaKey) && e.key === 'f' && !e.shiftKey) {
      if (this.selectedFile()) {
        e.preventDefault();
        this.setSearchMode('file');
        this.toggleSearch();
      }
      return;
    }

    // Escape — close search / exit global mode
    if (e.key === 'Escape') {
      if (this.searchMode === 'all') {
        this.setSearchMode('file');
        return;
      }
      if (this.showSearch) {
        this.dataService.auditShowFindInFile.set(false);
        this.searchQuery.set('');
        return;
      }
    }

    // Enter / Shift+Enter — navigate per-file matches
    if (e.key === 'Enter' && this.showSearch && this.searchMode === 'file') {
      e.preventDefault();
      if (e.shiftKey) this.prevMatch();
      else this.nextMatch();
    }
  }
}
