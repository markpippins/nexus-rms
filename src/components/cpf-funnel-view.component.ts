import { Component, inject, signal, computed, effect, viewChild, afterNextRender, ElementRef, DestroyRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DataService } from '../services/data.service';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

interface CpfCandidate {
  id: string;
  title: string;
  compilation_readiness: number;
  system_name?: string;
  subsystem_name?: string;
  status?: string;
  tags?: string[];
  dep_count?: number;
  promotable?: boolean;
}

interface CpfCounts {
  total: number;
  ready: number;
  promoted: number;
  near_miss: number;
  low: number;
}

interface CpfPageResponse {
  data: CpfCandidate[];
  count: number;
  limit?: number;
  offset?: number;
}

interface ReadinessBand {
  label: string;
  min: number;
  color: string;
  textColor: string;
}

@Component({
  selector: 'app-cpf-funnel-view',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './cpf-funnel-view.component.html',
  host: { class: 'flex-1 flex flex-col min-h-0' },
})
export class CpfFunnelViewComponent {
  private http = inject(HttpClient);
  dataService = inject(DataService);
  private readonly CPF_API_URL = 'http://localhost:3108';

  // ── Constants ───────────────────────────────────────────────────
  readonly PAGE_SIZE = 100;

  // ── State Signals ────────────────────────────────────────────────
  readonly candidates = signal<CpfCandidate[]>([]);
  readonly counts = signal<CpfCounts | null>(null);
  readonly loading = signal(false);
  readonly loadingMore = signal(false);
  readonly error = signal<string | null>(null);
  readonly totalCandidateCount = signal(0);
  readonly allLoaded = signal(false);

  // ── Filters ──────────────────────────────────────────────────────
  readonly threshold = signal(0.7);
  readonly systemFilter = signal<string>('');
  readonly statusFilter = signal<string>('');
  readonly selectedBand = signal<number | null>(null);

  // ── Sorting ───────────────────────────────────────────────────────
  readonly sortField = signal<'score' | 'title' | 'system' | 'status' | 'deps'>('score');
  readonly sortDirection = signal<'asc' | 'desc'>('desc');

  setSort(field: 'score' | 'title' | 'system' | 'status' | 'deps') {
    if (this.sortField() === field) {
      this.sortDirection.update(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      this.sortField.set(field);
      this.sortDirection.set('desc');
    }
  }

  // ── Funnel tabs ──────────────────────────────────────────────────
  readonly activeTab = signal<'ready' | 'promoted'>('ready');

  readonly readinessBands: ReadinessBand[] = [
    { label: '0.90–1.00', min: 0.9, color: 'bg-emerald-500', textColor: 'text-emerald-700 dark:text-emerald-300' },
    { label: '0.80–0.89', min: 0.8, color: 'bg-emerald-400', textColor: 'text-emerald-700 dark:text-emerald-300' },
    { label: '0.70–0.79', min: 0.7, color: 'bg-green-400', textColor: 'text-green-700 dark:text-green-300' },
    { label: '0.60–0.69', min: 0.6, color: 'bg-amber-400', textColor: 'text-amber-700 dark:text-amber-300' },
    { label: '0.50–0.59', min: 0.5, color: 'bg-orange-400', textColor: 'text-orange-700 dark:text-orange-300' },
    { label: '0.00–0.49', min: 0, color: 'bg-red-400', textColor: 'text-red-700 dark:text-red-300' },
  ];

  /** Resolve selected system name from DataService hierarchy. */
  readonly hierarchySystemName = computed(() => {
    const sysId = this.dataService.selectedSystemId();
    if (!sysId) return null;
    const sys = this.dataService.systems().find(s => s.id === sysId);
    return sys?.name || null;
  });

  /** Resolve selected subsystem name from DataService hierarchy. */
  readonly hierarchySubsystemName = computed(() => {
    const subId = this.dataService.selectedSubsystemId();
    if (!subId) return null;
    const sysId = this.dataService.selectedSystemId();
    if (!sysId) return null;
    const sys = this.dataService.systems().find(s => s.id === sysId);
    return sys?.subsystems.find(s => s.id === subId)?.name || null;
  });

  /** Build the query param string for hierarchy scoping. */
  private hierarchyParams(): string {
    const sys = this.hierarchySystemName();
    const sub = this.hierarchySubsystemName();
    const parts: string[] = [];
    if (sys) parts.push(`system=${encodeURIComponent(sys)}`);
    if (sub) parts.push(`subsystem=${encodeURIComponent(sub)}`);
    return parts.length > 0 ? '&' + parts.join('&') : '';
  }

  readonly systemNames = computed(() => {
    return this.dataService.systems().map(s => s.name).sort();
  });

  /** Unique statuses found in loaded (hierarchy-scoped) candidates. */
  readonly statusOptions = computed(() => {
    const statuses = new Set<string>();
    for (const c of this.candidates()) {
      if (c.status) statuses.add(c.status);
    }
    return [...statuses].sort();
  });

  /** Compute band counts from loaded candidates (approximate until all pages loaded). */
  readonly bandCounts = computed(() => {
    const counts: Record<number, number> = {};
    for (const band of this.readinessBands) {
      const upper = band.min >= 0.9 ? 1.01 : band.min + 0.1;
      counts[band.min] = this.candidates().filter(c => {
        const r = c.compilation_readiness;
        return r >= band.min && r < upper;
      }).length;
    }
    return counts;
  });

  readonly maxBandCount = computed(() => {
    return Math.max(1, ...Object.values(this.bandCounts()));
  });

  readonly filteredCandidates = computed(() => {
    const threshold = this.threshold();
    const system = this.systemFilter();
    const status = this.statusFilter();
    const bandMin = this.selectedBand();

    let filtered = this.candidates();

    // Tab filter
    if (this.activeTab() === 'ready') {
      filtered = filtered.filter(c => c.compilation_readiness >= threshold && c.status !== 'promoted' && c.status !== 'rejected');
    } else {
      filtered = filtered.filter(c => c.status === 'promoted');
    }

    // Band click filter
    if (bandMin !== null) {
      const band = this.readinessBands.find(b => b.min === bandMin);
      if (band) {
        const upper = band.min >= 0.9 ? 1.01 : band.min + 0.1;
        filtered = filtered.filter(c => c.compilation_readiness >= band.min && c.compilation_readiness < upper);
      }
    }

    // System filter
    if (system) {
      filtered = filtered.filter(c => c.system_name === system);
    }

    // Status filter
    if (status) {
      filtered = filtered.filter(c => c.status === status);
    }

    // Apply dynamic sorting
    const sortField = this.sortField();
    const sortDir = this.sortDirection();
    const multiplier = sortDir === 'desc' ? -1 : 1;

    return [...filtered].sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case 'score':
          cmp = a.compilation_readiness - b.compilation_readiness;
          break;
        case 'title':
          cmp = (a.title || '').localeCompare(b.title || '');
          break;
        case 'system':
          cmp = (a.system_name || '').localeCompare(b.system_name || '');
          break;
        case 'status':
          cmp = (a.status || '').localeCompare(b.status || '');
          break;
        case 'deps':
          cmp = (a.dep_count ?? 0) - (b.dep_count ?? 0);
          break;
      }
      return cmp * multiplier;
    });
  });

  readonly promotingId = signal<string | null>(null);
  readonly linkCopied = signal(false);

  /** Sentinel element for infinite scroll IntersectionObserver. */
  readonly scrollSentinel = viewChild<ElementRef<HTMLElement>>('scrollSentinel');

  private observer: IntersectionObserver | null = null;
  private destroyRef = inject(DestroyRef);
  /** Guard to prevent the hierarchy effect from triggering a duplicate initial load. */
  private hierarchyInitialized = false;

  constructor() {
    // Restore CPF funnel filters from URL query params
    this.restoreFiltersFromUrl();

    // Auto-reload when hierarchy selection changes (skips first fire to avoid duping initial load)
    effect(() => {
      this.dataService.selectedSystemId();
      this.dataService.selectedSubsystemId();
      if (!this.hierarchyInitialized) {
        this.hierarchyInitialized = true;
        return;
      }
      this.loadData();
    }, { allowSignalWrites: true });

    // Sync filter state to URL on any change
    effect(() => {
      // Track all filter signals to react to changes
      this.threshold();
      this.systemFilter();
      this.statusFilter();
      this.selectedBand();
      this.activeTab();
      this.syncFiltersToUrl();
    });

    // Explicit initial load (runs after filters restored from URL)
    this.loadData();

    // Defer observer setup until the sentinel is actually rendered (after data loads)
    effect(() => {
      // Track candidates to re-run this effect when data loads
      this.candidates();

      if (this.observer) return; // already set up

      afterNextRender(() => {
        const sentinel = this.scrollSentinel()?.nativeElement;
        if (!sentinel) return;

        this.observer = new IntersectionObserver(
          (entries) => {
            if (entries[0]?.isIntersecting && !this.allLoaded() && !this.loadingMore()) {
              this.loadMore();
            }
          },
          { rootMargin: '200px' }
        );

        this.observer.observe(sentinel);
        this.destroyRef.onDestroy(() => this.observer?.disconnect());
      });
    });
  }

  async loadData() {
    this.observer?.disconnect();
    this.observer = null;
    this.loading.set(true);
    this.error.set(null);
    this.candidates.set([]);
    this.totalCandidateCount.set(0);
    this.allLoaded.set(false);
    try {
      const countsData = await this.fetchCounts();
      this.counts.set(countsData);
      this.totalCandidateCount.set(countsData.total);

      // Fetch first page
      const page = await this.fetchPage(0);
      this.candidates.set(page.data);
      if (page.data.length < this.PAGE_SIZE) {
        this.allLoaded.set(true);
      }
    } catch (err: any) {
      this.error.set(err.message || 'Failed to load CPF data');
      console.error('CPF Funnel load error:', err);
    } finally {
      this.loading.set(false);
    }
  }

  async loadMore() {
    if (this.allLoaded() || this.loadingMore()) return;

    this.loadingMore.set(true);
    try {
      const offset = this.candidates().length;
      const page = await this.fetchPage(offset);
      this.candidates.update(existing => [...existing, ...page.data]);
      if (page.data.length < this.PAGE_SIZE) {
        this.allLoaded.set(true);
      }
    } catch (err: any) {
      console.error('Failed to load more candidates:', err);
    } finally {
      this.loadingMore.set(false);
    }
  }

  private async fetchPage(offset: number): Promise<{ data: CpfCandidate[] }> {
    const res = await firstValueFrom(
      this.http.get<CpfPageResponse>(`${this.CPF_API_URL}/api/cpf?all=1&limit=${this.PAGE_SIZE}&offset=${offset}${this.hierarchyParams()}`)
    );
    return { data: res.data || [] };
  }

  private async fetchCounts(): Promise<CpfCounts> {
    const h = this.hierarchyParams();
    const url = h ? `${this.CPF_API_URL}/api/cpf/count?${h.slice(1)}` : `${this.CPF_API_URL}/api/cpf/count`;
    const res = await firstValueFrom(this.http.get<CpfCounts>(url));
    return res;
  }

  /** Called when filters/tab change — reset to first page. */
  resetPagination() {
    this.candidates.set([]);
    this.allLoaded.set(false);
    this.selectedBand.set(null);
    this.loadData();
  }

  /** Number of active filters (excluding hierarchy scope). */
  readonly activeFilterCount = computed(() => {
    let count = 0;
    if (this.threshold() !== 0.7) count++;
    if (this.systemFilter()) count++;
    if (this.statusFilter()) count++;
    if (this.selectedBand() !== null) count++;
    return count;
  });

  /** Reset all filters (including sort) to defaults and reload. */
  resetFilters() {
    this.threshold.set(0.7);
    this.systemFilter.set('');
    this.statusFilter.set('');
    this.selectedBand.set(null);
    this.sortField.set('score');
    this.sortDirection.set('desc');
    this.resetPagination();
  }

  /** Restore CPF funnel filters from URL query params. */
  private restoreFiltersFromUrl(): void {
    const params = new URLSearchParams(window.location.search);

    const threshold = params.get('cpf_threshold');
    if (threshold !== null) {
      const val = parseFloat(threshold);
      if (!isNaN(val) && val >= 0 && val <= 1) {
        this.threshold.set(val);
      }
    }

    const system = params.get('cpf_system');
    if (system) {
      this.systemFilter.set(system);
    }

    const status = params.get('cpf_status');
    if (status) {
      this.statusFilter.set(status);
    }

    const band = params.get('cpf_band');
    if (band !== null) {
      const val = parseInt(band, 10);
      if (!isNaN(val)) {
        this.selectedBand.set(val);
      }
    }

    const tab = params.get('cpf_tab');
    if (tab === 'promoted') {
      this.activeTab.set('promoted');
    }

    const sort = params.get('cpf_sort');
    if (sort === 'title' || sort === 'system' || sort === 'status' || sort === 'deps') {
      this.sortField.set(sort);
    }

    const dir = params.get('cpf_dir');
    if (dir === 'asc' || dir === 'desc') {
      this.sortDirection.set(dir);
    }
  }

  /** Write current filter state to URL query params via replaceState, preserving unrelated params. */
  private syncFiltersToUrl(): void {
    const params = new URLSearchParams(window.location.search);
    // Clear any stale CPF-prefixed params first
    for (const key of ['cpf_threshold', 'cpf_system', 'cpf_status', 'cpf_band', 'cpf_tab', 'cpf_sort', 'cpf_dir']) {
      params.delete(key);
    }
    // Set non-default values
    if (this.threshold() !== 0.7) params.set('cpf_threshold', this.threshold().toString());
    if (this.systemFilter()) params.set('cpf_system', this.systemFilter());
    if (this.statusFilter()) params.set('cpf_status', this.statusFilter());
    if (this.selectedBand() !== null) params.set('cpf_band', this.selectedBand()!.toString());
    if (this.activeTab() !== 'ready') params.set('cpf_tab', this.activeTab());
    if (this.sortField() !== 'score') params.set('cpf_sort', this.sortField());
    if (this.sortDirection() !== 'desc') params.set('cpf_dir', this.sortDirection());

    const search = params.toString();
    const url = search ? `${window.location.pathname}?${search}` : window.location.pathname;
    history.replaceState(null, '', url);
  }

  /** Copy the current URL (with filter params) to clipboard. */
  shareLink() {
    navigator.clipboard.writeText(window.location.href).catch(() => {
      // Fallback for older browsers
      const textarea = document.createElement('textarea');
      textarea.value = window.location.href;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    });
    this.linkCopied.set(true);
    const timer = setTimeout(() => this.linkCopied.set(false), 2000);
    this.destroyRef.onDestroy(() => clearTimeout(timer));
  }

  async promoteCandidate(id: string) {
    this.promotingId.set(id);
    try {
      await firstValueFrom(
        this.http.post(`${this.CPF_API_URL}/api/cpf/promote`, { candidate_id: id })
      );
      // Reload data after promote
      await this.loadData();
    } catch (err: any) {
      console.error('Failed to promote candidate:', err);
    } finally {
      this.promotingId.set(null);
    }
  }

  onThresholdChange(event: Event) {
    const input = event.target as HTMLInputElement;
    this.threshold.set(input.valueAsNumber / 100);
    this.resetPagination();
  }

  onSystemFilterChange(event: Event) {
    const select = event.target as HTMLSelectElement;
    this.systemFilter.set(select.value);
    this.resetPagination();
  }

  onStatusFilterChange(event: Event) {
    const select = event.target as HTMLSelectElement;
    this.statusFilter.set(select.value);
    this.resetPagination();
  }

  selectBand(min: number | null) {
    this.selectedBand.set(this.selectedBand() === min ? null : min);
    this.resetPagination();
  }

  setTab(tab: 'ready' | 'promoted') {
    this.activeTab.set(tab);
    this.resetPagination();
  }

  formatPct(v: number): string {
    return Math.round(v * 100) + '%';
  }

  getBarWidth(count: number): number {
    return (count / this.maxBandCount()) * 100;
  }
}
