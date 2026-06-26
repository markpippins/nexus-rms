import { Injectable, signal, computed, effect } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { System, Subsystem, Feature, Requirement, Status, WorkSession, FolderCategory, WorkspaceEntry, SystemDocsResponse, SubsystemDocsResponse, AuditFile, AuditScanResult, KnowledgeViewResponse, AuditGraphResponse, KnowledgeSummary, KnowledgeCrossReference, HarvestCandidate, SpawnPlanRequest, SpawnPlanResponse, SnapshotEntry, BlocksResponse, SegmentEntry, ProjectionOverrideEntry, ProjectionResponse, ReferencesResponse } from '../models/data.models';
import { environment } from '../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class DataService {
  // ── Configuration ──────────────────────────────────────────────
  private readonly apiUrl = environment.apiUrl;

  // ── State Signals ───────────────────────────────────────────────
  readonly systems = signal<System[]>([]);
  readonly requirements = signal<Requirement[]>([]);
  readonly workSessions = signal<WorkSession[]>([]);

  // ── Loading / Error Signals ────────────────────────────────────
  readonly loading = signal<boolean>(false);
  readonly error = signal<string | null>(null);

  // ── Preferences State ───────────────────────────────────────────
  private readonly preferencesLoaded = signal<boolean>(false);

  // ── Computed State for UI ──────────────────────────────────────
  readonly sortedSystems = computed(() => {
    const sortByName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
    return this.systems().map(sys => ({
      ...sys,
      subsystems: sys.subsystems.map(sub => ({
        ...sub,
        features: [...sub.features].sort(sortByName)
      })).sort(sortByName)
    })).sort(sortByName);
  });

  readonly subsystemColorMap = computed(() => {
    const map = new Map<string, string>();
    this.systems().forEach(sys => {
      sys.subsystems.forEach(sub => {
        if (sub.color) map.set(sub.id, sub.color);
      });
    });
    return map;
  });

  // ── Workspaces ─────────────────────────────────────────────────
  readonly workspaces = signal<WorkspaceEntry[]>([]);

  // ── UI State ───────────────────────────────────────────────────
  readonly darkMode = signal<boolean>(false);
  readonly viewMode = signal<'board' | 'table' | 'docs' | 'sessions' | 'info' | 'audit' | 'graph' | 'harvests'>('board');

  // ── Selection State ────────────────────────────────────────────
  readonly selectedSystemId = signal<string | null>(null);
  readonly selectedSubsystemId = signal<string | null>(null);
  readonly selectedFeatureId = signal<string | null>(null);

  // ── Harvest Candidate Detail Selection ─────────────────────────
  readonly selectedHarvestCandidateId = signal<string | null>(null);

  // Cross-component signal: when set, hierarchy-nav opens its spawn plan modal
  readonly spawnPlanIntent = signal<HarvestCandidate | null>(null);

  // ── Harvest Search & Filter State (shared with main toolbar) ────
  readonly harvestSearchTerm = signal('');
  readonly harvestSortMode = signal<string>('created_at');
  readonly harvestKeywordFilter = signal('');
  readonly harvestHideEmpty = signal(false);
  readonly harvestDateFrom = signal('');
  readonly harvestDateTo = signal('');
  readonly harvestTagFilter = signal('');
  readonly harvestFiltersExpanded = signal(false);
  readonly harvestShowDistribution = signal(false);
  readonly harvestHotTopicsData = signal<any[]>([]);
  readonly harvestHotTopicsLoading = signal(false);
  readonly harvestShowHotTopics = signal(false);
  readonly harvestDistributionData = signal<any>(null);
  readonly harvestDistributionLoading = signal(false);

  readonly harvestSortOptions: string[] = ['created_at', 'created_at_asc', 'code_blocks', 'turns', 'block_density', 'candidate_count', 'collaboration', 'tag_frequency', 'keyword_hits'];

  readonly harvestSortLabels: Record<string, string> = {
    created_at: 'Newest',
    created_at_asc: 'Oldest',
    code_blocks: 'Code',
    turns: 'Turns',
    block_density: 'Density',
    candidate_count: 'Cand.',
    collaboration: 'Collab',
    tag_frequency: 'Tags',
    keyword_hits: 'Keyword Hits',
  };

  readonly harvestHasCandidatesCount = computed(() =>
    this.harvests().filter(h => h.total_candidates > 0).length
  );

  readonly harvestFilteredHarvests = computed(() => {
    const term = this.harvestSearchTerm().toLowerCase().trim();
    let list = this.harvests();
    if (term) {
      list = list.filter((h: any) =>
        h.source_filename.toLowerCase().includes(term) ||
        h.source_path.toLowerCase().includes(term) ||
        (h.model && h.model.toLowerCase().includes(term))
      );
    }
    if (this.harvestHideEmpty()) {
      list = list.filter((h: any) => h.total_candidates > 0);
    }
    return list;
  });

  /** Harvest data fetched from API. */
  readonly harvests = signal<any[]>([]);
  readonly harvestsLoading = signal(false);
  readonly harvestsError = signal<string | null>(null);

  async fetchHarvests() {
    this.harvestsLoading.set(true);
    this.harvestsError.set(null);
    try {
      const data = await this.listHarvests({
        limit: 200,
        sort: this.harvestSortMode(),
        keyword: this.harvestKeywordFilter() || undefined,
        tag: this.harvestTagFilter() || undefined,
        dateFrom: this.harvestDateFrom() || undefined,
        dateTo: this.harvestDateTo() || undefined,
      });
      this.harvests.set(data.harvests || []);
    } catch (err: any) {
      this.harvestsError.set(err.message || 'Failed to fetch harvests');
    } finally {
      this.harvestsLoading.set(false);
    }
  }

  setHarvestSort(mode: string) {
    this.harvestSortMode.set(mode);
    this.fetchHarvests();
  }

  applyHarvestKeyword() {
    if (this.harvestSortMode() !== 'keyword_hits') {
      this.harvestSortMode.set('keyword_hits');
    }
    this.fetchHarvests();
  }

  async loadHarvestDistribution() {
    if (this.harvestShowDistribution()) {
      this.harvestShowDistribution.set(false);
      return;
    }
    this.harvestShowDistribution.set(true);
    this.harvestDistributionLoading.set(true);
    try {
      const data = await this.getHarvestDistribution();
      this.harvestDistributionData.set(data);
    } catch (err: any) {
      console.error('Failed to load distribution:', err);
    } finally {
      this.harvestDistributionLoading.set(false);
    }
  }

  async loadHarvestHotTopics() {
    if (this.harvestShowHotTopics()) {
      this.harvestShowHotTopics.set(false);
      return;
    }
    this.harvestShowHotTopics.set(true);
    this.harvestHotTopicsLoading.set(true);
    try {
      const data = await this.getHarvestDistribution();
      const tags = (data.topTags || []).slice(0, 15);
      const maxCnt = tags.length > 0 ? tags[0].cnt : 1;
      this.harvestHotTopicsData.set(tags.map((t: any) => ({ ...t, pct: Math.round((t.cnt / maxCnt) * 100) })));
    } catch (e) {
      console.error('Failed to load hot topics', e);
    } finally {
      this.harvestHotTopicsLoading.set(false);
    }
  }

  applyHarvestTagFilter(tag: string) {
    this.harvestTagFilter.set(tag);
    this.fetchHarvests();
  }

  toggleHarvestFilters() {
    this.harvestFiltersExpanded.update(v => !v);
  }

  // ── Audit State ────────────────────────────────────────────────
  readonly auditFiles = signal<AuditFile[]>([]);
  readonly selectedAuditFileId = signal<string | null>(null);
  readonly auditLoading = signal<boolean>(false);

  constructor(private http: HttpClient) {
    this.initTheme();
    this.bootstrap();
  }

  // ── Preferences API ─────────────────────────────────────────────

  async getPreference<T>(key: string): Promise<T | null> {
    try {
      const prefs = await firstValueFrom(
        this.http.get<Record<string, any>>(`${this.apiUrl}/preferences`)
      );
      return prefs?.[key] ?? null;
    } catch {
      return null;
    }
  }

  savePreference(key: string, value: any) {
    this.http.put(`${this.apiUrl}/preferences/${key}`, { value }).subscribe({
      error: (err) => console.error(`Failed to save preference ${key}:`, err),
    });
  }

  private async fetchPreferences() {
    try {
      const prefs = await firstValueFrom(
        this.http.get<Record<string, any>>(`${this.apiUrl}/preferences`)
      );
      if (prefs && typeof prefs.darkMode === 'boolean') {
        this.darkMode.set(prefs.darkMode);
      }
    } catch (err) {
      console.error('Failed to fetch preferences:', err);
    } finally {
      this.preferencesLoaded.set(true);
    }
  }

  // ── Bootstrap — fetch from API, seed if empty ───────────────────
  private async bootstrap() {
    this.loading.set(true);
    try {
      await this.fetchAll();
      await this.fetchPreferences();
      if (this.systems().length === 0) {
        await this.seedFromServer();
      }
    } catch (err: any) {
      console.error('Bootstrap failed:', err);
      this.error.set(err.message || 'Failed to load data');
    } finally {
      this.loading.set(false);
    }
  }

  async refreshData() {
    await this.fetchAll();
  }

  async refreshRequirements() {
    try {
      const requirements = await firstValueFrom(this.http.get<Requirement[]>(`${this.apiUrl}/requirements`));
      if (requirements) this.requirements.set(requirements);
    } catch (err) {
      console.error('Failed to refresh requirements:', err);
    }
  }

  private async fetchAll() {
    const [systems, requirements, sessions, workspaces] = await Promise.all([
      firstValueFrom(this.http.get<System[]>(`${this.apiUrl}/systems`)),
      firstValueFrom(this.http.get<Requirement[]>(`${this.apiUrl}/requirements`)),
      firstValueFrom(this.http.get<WorkSession[]>(`${this.apiUrl}/sessions`)),
      firstValueFrom(this.http.get<WorkspaceEntry[]>(`${this.apiUrl}/workspaces`)),
    ]);
    if (systems) this.systems.set(systems);
    if (requirements) this.requirements.set(requirements);
    if (sessions) this.workSessions.set(sessions);
    if (workspaces) this.workspaces.set(workspaces);
  }

  private async seedFromServer() {
    try {
      await firstValueFrom(this.http.post(`${this.apiUrl}/seed`, {}));
      await this.fetchAll();
      if (this.systems().length > 0) {
        this.selectedSystemId.set(this.systems()[0].id);
      }
    } catch (err) {
      console.error('Seed failed:', err);
    }
  }

  refreshWorkspaces() {
    this.http.get<WorkspaceEntry[]>(`${this.apiUrl}/workspaces`).subscribe({
      next: (ws) => this.workspaces.set(ws),
      error: (err) => console.error('Failed to fetch workspaces:', err),
    });
  }

  // ══════════════════════════════════════════════════════════════════
  //  INFO TABS (system info tabs persisted via API)
  // ══════════════════════════════════════════════════════════════════

  async fetchInfoTabs(systemId: string): Promise<{ tab_id: string; content: string }[]> {
    try {
      return await firstValueFrom(
        this.http.get<{ tab_id: string; content: string }[]>(`${this.apiUrl}/systems/${systemId}/info`)
      );
    } catch {
      return [];
    }
  }

  saveInfoTab(systemId: string, tabId: string, content: string) {
    this.http.put(`${this.apiUrl}/systems/${systemId}/info/${tabId}`, { content }).subscribe({
      error: (err) => console.error(`Failed to save info tab ${tabId}:`, err),
    });
  }

  async deleteInfoTab(systemId: string, tabId: string): Promise<void> {
    try {
      await firstValueFrom(this.http.delete(`${this.apiUrl}/systems/${systemId}/info/${tabId}`));
    } catch (err) {
      console.error(`Failed to delete info tab ${tabId}:`, err);
      throw err;
    }
  }

  // ══════════════════════════════════════════════════════════════════
  //  DOCS FILES (read from disk)
  // ══════════════════════════════════════════════════════════════════

  async fetchSystemDocs(systemId: string): Promise<SystemDocsResponse | null> {
    try {
      return await firstValueFrom(this.http.get<SystemDocsResponse>(`${this.apiUrl}/systems/${systemId}/docs`));
    } catch (err) {
      console.error('Failed to fetch system docs:', err);
      return null;
    }
  }

  async fetchSubsystemDocs(subsystemId: string): Promise<SubsystemDocsResponse | null> {
    try {
      return await firstValueFrom(this.http.get<SubsystemDocsResponse>(`${this.apiUrl}/subsystems/${subsystemId}/docs`));
    } catch (err) {
      console.error('Failed to fetch subsystem docs:', err);
      return null;
    }
  }

  // ── Theme ───────────────────────────────────────────────────────
  private initTheme() {
    // Initialize from system preference (overridden by API fetch in bootstrap)
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      this.darkMode.set(true);
    }
    // Apply theme to DOM + persist to API
    effect(() => {
      const isDark = this.darkMode();
      document.documentElement.classList.toggle('dark', isDark);
      if (this.preferencesLoaded()) {
        this.savePreference('darkMode', isDark);
      }
    });
  }

  toggleTheme() {
    this.darkMode.update(d => !d);
  }

  // ══════════════════════════════════════════════════════════════════
  //  HARVESTS
  // ══════════════════════════════════════════════════════════════════

  async listHarvests(params?: { model?: string; limit?: number; offset?: number; sort?: string; keyword?: string; tag?: string; dateFrom?: string; dateTo?: string }): Promise<{ harvests: any[]; count: number }> {
    try {
      const qs = new URLSearchParams();
      if (params?.model) qs.set('model', params.model);
      if (params?.limit) qs.set('limit', String(params.limit));
      if (params?.offset) qs.set('offset', String(params.offset));
      if (params?.sort) qs.set('sort', params.sort);
      if (params?.keyword) qs.set('keyword', params.keyword);
      if (params?.tag) qs.set('tag', params.tag);
      if (params?.dateFrom) qs.set('dateFrom', params.dateFrom);
      if (params?.dateTo) qs.set('dateTo', params.dateTo);
      const query = qs.toString();
      return await firstValueFrom(
        this.http.get<{ harvests: any[]; count: number }>(`${this.apiUrl}/harvests${query ? '?' + query : ''}`)
      );
    } catch (err) {
      console.error('Failed to list harvests:', err);
      return { harvests: [], count: 0 };
    }
  }

  async listHarvestCandidates(filters?: { harvestId?: string; systemId?: string; limit?: number; offset?: number }): Promise<{ candidates: HarvestCandidate[]; count: number }> {
    try {
      const qs = new URLSearchParams();
      if (filters?.harvestId) qs.set('harvestId', filters.harvestId);
      if (filters?.systemId) qs.set('systemId', filters.systemId);
      if (filters?.limit) qs.set('limit', String(filters.limit));
      if (filters?.offset) qs.set('offset', String(filters.offset));
      const query = qs.toString();
      return await firstValueFrom(
        this.http.get<{ candidates: HarvestCandidate[]; count: number }>(`${this.apiUrl}/harvest-candidates${query ? '?' + query : ''}`)
      );
    } catch (err) {
      console.error('Failed to list harvest candidates:', err);
      return { candidates: [], count: 0 };
    }
  }

  // ══════════════════════════════════════════════════════════════════
  //  HARVEST CANDIDATES (hierarchy lookups)
  // ══════════════════════════════════════════════════════════════════

  async getSystemHarvestCandidates(systemId: string): Promise<{ systemId: string; candidates: HarvestCandidate[]; count: number }> {
    try {
      return await firstValueFrom(
        this.http.get<{ systemId: string; candidates: HarvestCandidate[]; count: number }>(`${this.apiUrl}/systems/${systemId}/harvest-candidates`)
      );
    } catch (err) {
      console.error('Failed to fetch system harvest candidates:', err);
      return { systemId, candidates: [], count: 0 };
    }
  }

  async getSubsystemHarvestCandidates(subsystemId: string): Promise<{ subsystemId: string; candidates: HarvestCandidate[]; count: number }> {
    try {
      return await firstValueFrom(
        this.http.get<{ subsystemId: string; candidates: HarvestCandidate[]; count: number }>(`${this.apiUrl}/subsystems/${subsystemId}/harvest-candidates`)
      );
    } catch (err) {
      console.error('Failed to fetch subsystem harvest candidates:', err);
      return { subsystemId, candidates: [], count: 0 };
    }
  }

  async getFeatureHarvestCandidates(featureId: string): Promise<{ featureId: string; candidates: HarvestCandidate[]; count: number }> {
    try {
      return await firstValueFrom(
        this.http.get<{ featureId: string; candidates: HarvestCandidate[]; count: number }>(`${this.apiUrl}/features/${featureId}/harvest-candidates`)
      );
    } catch (err) {
      console.error('Failed to fetch feature harvest candidates:', err);
      return { featureId, candidates: [], count: 0 };
    }
  }

  async spawnPlanFromCandidate(candidateId: string, body: SpawnPlanRequest): Promise<SpawnPlanResponse | null> {
    try {
      return await firstValueFrom(
        this.http.post<SpawnPlanResponse>(`${this.apiUrl}/harvest-candidates/${candidateId}/spawn-plan`, body)
      );
    } catch (err) {
      console.error('Failed to spawn plan from candidate:', err);
      return null;
    }
  }

  async updateHarvestCandidate(id: string, updates: Partial<HarvestCandidate>): Promise<HarvestCandidate | null> {
    try {
      return await firstValueFrom(
        this.http.patch<HarvestCandidate>(`${this.apiUrl}/harvest-candidates/${id}`, updates)
      );
    } catch (err) {
      console.error('Failed to update harvest candidate:', err);
      return null;
    }
  }

  async getHarvestTranscript(harvestId: string): Promise<{ harvestId: string; title: string; source: string; units: any[]; stats: any; candidates: any[] }> {
    try {
      return await firstValueFrom(
        this.http.get<any>(`${this.apiUrl}/harvests/${harvestId}/transcript`)
      );
    } catch (err) {
      console.error('Failed to load transcript:', err);
      return { harvestId, title: '', source: '', units: [], stats: null, candidates: [] };
    }
  }

  async promoteHarvestCandidate(id: string): Promise<{ ok: boolean; result: string }> {
    const res = await firstValueFrom(
      this.http.post<{ ok: boolean; result: string }>(`${this.apiUrl}/harvest-candidates/${id}/promote`, { status: 'useful' })
    );
    return res;
  }

  async rejectHarvestCandidate(id: string): Promise<{ ok: boolean; result: string }> {
    const res = await firstValueFrom(
      this.http.post<{ ok: boolean; result: string }>(`${this.apiUrl}/harvest-candidates/${id}/promote`, { status: 'rejected' })
    );
    return res;
  }

  async promoteToPlan(candidateIds: string[], project?: string, goal?: string): Promise<{ ok: boolean; plan_id: number; plan_title: string; plan_goal: string; candidates_used: number; status_results: string[] }> {
    const res = await firstValueFrom(
      this.http.post<any>(`${this.apiUrl}/harvest-candidates/promote-to-plan`, { candidateIds, project, goal })
    );
    return res;
  }

  async getHarvestDistribution(): Promise<any> {
    const res = await firstValueFrom(
      this.http.get<any>(`${this.apiUrl}/harvests/distribution`)
    );
    return res;
  }

  // ══════════════════════════════════════════════════════════════════
  //  KNOWLEDGE / AUDIT GRAPH
  // ══════════════════════════════════════════════════════════════════

  async fetchKnowledgeView(limit: number = 500): Promise<KnowledgeViewResponse | null> {
    try {
      return await firstValueFrom(
        this.http.get<KnowledgeViewResponse>(`${this.apiUrl}/knowledge/view?limit=${limit}`)
      );
    } catch (err) {
      console.error('Failed to fetch knowledge view:', err);
      return null;
    }
  }

  async fetchAuditGraph(limit: number = 200): Promise<AuditGraphResponse | null> {
    try {
      return await firstValueFrom(
        this.http.get<AuditGraphResponse>(`${this.apiUrl}/audit/graph?limit=${limit}`)
      );
    } catch (err) {
      console.error('Failed to fetch audit graph:', err);
      return null;
    }
  }

  async fetchKnowledgeCrossReferences(limit: number = 500): Promise<KnowledgeCrossReference[]> {
    try {
      const result = await firstValueFrom(
        this.http.get<{ crossReferences: KnowledgeCrossReference[]; count: number }>(`${this.apiUrl}/knowledge/cross-references?limit=${limit}`)
      );
      return result.crossReferences || [];
    } catch (err) {
      console.error('Failed to fetch cross-references:', err);
      return [];
    }
  }

  async fetchKnowledgeSummary(): Promise<KnowledgeSummary | null> {
    try {
      return await firstValueFrom(
        this.http.get<KnowledgeSummary>(`${this.apiUrl}/knowledge/summary`)
      );
    } catch (err) {
      console.error('Failed to fetch knowledge summary:', err);
      return null;
    }
  }

  // ══════════════════════════════════════════════════════════════════
  //  AUDIT FILES
  // ══════════════════════════════════════════════════════════════════

  async fetchAuditFiles(): Promise<void> {
    this.auditLoading.set(true);
    try {
      const result = await firstValueFrom(
        this.http.get<AuditScanResult>(`${this.apiUrl}/audit`)
      );
      if (result && result.files) {
        this.auditFiles.set(result.files);
      }
    } catch (err) {
      console.error('Failed to fetch audit files:', err);
    } finally {
      this.auditLoading.set(false);
    }
  }

  async getAuditFileContent(id: string): Promise<AuditFile | null> {
    try {
      return await firstValueFrom(
        this.http.get<AuditFile>(`${this.apiUrl}/audit/${id}`)
      );
    } catch (err) {
      console.error('Failed to fetch audit file content:', err);
      return null;
    }
  }

  async syncAuditFiles(): Promise<void> {
    this.auditLoading.set(true);
    try {
      const result = await firstValueFrom(
        this.http.post<AuditScanResult>(`${this.apiUrl}/audit/sync`, {})
      );
      if (result && result.files) {
        this.auditFiles.set(result.files);
      }
    } catch (err) {
      console.error('Failed to sync audit files:', err);
    } finally {
      this.auditLoading.set(false);
    }
  }

  async regenerateAuditFile(id: string): Promise<void> {
    try {
      await firstValueFrom(
        this.http.post(`${this.apiUrl}/audit/${id}/regenerate`, {})
      );
    } catch (err) {
      console.error('Failed to regenerate audit file:', err);
    }
  }

  // ── Export (unchanged — file download) ──────────────────────────
  exportDatabase() {
    const data = {
      systems: this.systems(),
      requirements: this.requirements(),
      workSessions: this.workSessions(),
      meta: { exportedAt: new Date().toISOString(), version: '2.0' }
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `nebula-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    window.URL.revokeObjectURL(url);
  }

  importDatabase(file: File) {
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const json = JSON.parse(e.target?.result as string);
        if (json.systems || json.requirements || json.workSessions) {
          await firstValueFrom(this.http.post(`${this.apiUrl}/import`, {
            systems: json.systems || [],
            requirements: json.requirements || [],
            workSessions: json.workSessions || [],
          }));
          await this.fetchAll();
          alert('Database restored successfully!');
        }
      } catch (err) {
        console.error(err);
        alert('Failed to parse backup file.');
      }
    };
    reader.readAsText(file);
  }

  // ══════════════════════════════════════════════════════════════════
  //  SYSTEMS
  // ══════════════════════════════════════════════════════════════════

  addSystem(name: string, description: string) {
    const tempId = crypto.randomUUID();
    const previous = this.systems();
    const optimistic: System = { id: tempId, name, description, folders: [], subsystems: [] };
    this.systems.update(s => [...s, optimistic]);

    this.http.post<System>(`${this.apiUrl}/systems`, { name, description }).subscribe({
      next: (sys) => this.systems.update(s => s.map(x => x.id === tempId ? sys : x)),
      error: () => this.systems.set(previous),
    });
  }

  updateSystemName(id: string, name: string) {
    const previous = this.systems();
    this.systems.update(s => s.map(sys => sys.id === id ? { ...sys, name } : sys));
    this.http.patch(`${this.apiUrl}/systems/${id}`, { name }).subscribe({
      error: () => this.systems.set(previous),
    });
  }

  updateSystemReadme(id: string, readme: string) {
    const previous = this.systems();
    this.systems.update(s => s.map(sys => sys.id === id ? { ...sys, readme } : sys));
    this.http.patch(`${this.apiUrl}/systems/${id}`, { readme }).subscribe({
      error: () => this.systems.set(previous),
    });
  }

  updateSystemArchitecture(id: string, architecture: string) {
    const previous = this.systems();
    this.systems.update(s => s.map(sys => sys.id === id ? { ...sys, architecture } : sys));
    this.http.patch(`${this.apiUrl}/systems/${id}`, { architecture }).subscribe({
      error: () => this.systems.set(previous),
    });
  }

  deleteSystem(id: string) {
    const previousSystems = this.systems();
    const previousReqs = this.requirements();
    const previousSessions = this.workSessions();
    this.systems.update(s => s.filter(sys => sys.id !== id));
    this.requirements.update(r => r.filter(req => req.systemId !== id));
    this.workSessions.update(w => w.filter(s => s.parentId !== id));
    if (this.selectedSystemId() === id) {
      this.selectedSystemId.set(null);
      this.selectedSubsystemId.set(null);
      this.selectedFeatureId.set(null);
    }
    this.http.delete(`${this.apiUrl}/systems/${id}`).subscribe({
      error: () => {
        this.systems.set(previousSystems);
        this.requirements.set(previousReqs);
        this.workSessions.set(previousSessions);
      },
    });
  }

  // ══════════════════════════════════════════════════════════════════
  //  SUBSYSTEMS  (color assigned server-side — Plan 0093)
  // ══════════════════════════════════════════════════════════════════

  addSubsystem(systemId: string, name: string, description: string) {
    const tempId = crypto.randomUUID();
    const previous = this.systems();
    const optimistic: Subsystem = {
      id: tempId, name, description, color: '#3B82F6', features: [], systemId
    };
    this.systems.update(s => s.map(sys =>
      sys.id === systemId ? { ...sys, subsystems: [...sys.subsystems, optimistic] } : sys
    ));

    this.http.post<Subsystem>(`${this.apiUrl}/subsystems`, { systemId, name, description }).subscribe({
      next: (sub) => this.systems.update(s => s.map(sys =>
        sys.id === systemId ? {
          ...sys, subsystems: sys.subsystems.map(su => su.id === tempId ? sub : su)
        } : sys
      )),
      error: () => this.systems.set(previous),
    });
  }

  updateSubsystemName(systemId: string, subsystemId: string, name: string) {
    const previous = this.systems();
    this.systems.update(s => s.map(sys => sys.id === systemId ? {
      ...sys, subsystems: sys.subsystems.map(sub => sub.id === subsystemId ? { ...sub, name } : sub)
    } : sys));
    this.http.patch(`${this.apiUrl}/subsystems/${subsystemId}`, { name }).subscribe({
      error: () => this.systems.set(previous),
    });
  }

  updateSubsystemColor(systemId: string, subsystemId: string, color: string) {
    const previous = this.systems();
    this.systems.update(s => s.map(sys => sys.id === systemId ? {
      ...sys, subsystems: sys.subsystems.map(sub => sub.id === subsystemId ? { ...sub, color } : sub)
    } : sys));
    this.http.patch(`${this.apiUrl}/subsystems/${subsystemId}`, { color }).subscribe({
      error: () => this.systems.set(previous),
    });
  }

  updateSubsystemReadme(sysId: string, subId: string, readme: string) {
    const previous = this.systems();
    this.systems.update(s => s.map(sys => sys.id === sysId ? {
      ...sys, subsystems: sys.subsystems.map(sub => sub.id === subId ? { ...sub, readme } : sub)
    } : sys));
    this.http.patch(`${this.apiUrl}/subsystems/${subId}`, { readme }).subscribe({
      error: () => this.systems.set(previous),
    });
  }

  deleteSubsystem(systemId: string, subId: string) {
    const previousSystems = this.systems();
    const previousReqs = this.requirements();
    this.systems.update(s => s.map(sys => sys.id === systemId ? {
      ...sys, subsystems: sys.subsystems.filter(sub => sub.id !== subId)
    } : sys));
    this.requirements.update(r => r.filter(req => req.subsystemId !== subId));
    if (this.selectedSubsystemId() === subId) {
      this.selectedSubsystemId.set(null);
      this.selectedFeatureId.set(null);
    }
    this.http.delete(`${this.apiUrl}/subsystems/${subId}`).subscribe({
      error: () => {
        this.systems.set(previousSystems);
        this.requirements.set(previousReqs);
      },
    });
  }

  // ══════════════════════════════════════════════════════════════════
  //  FEATURES
  // ══════════════════════════════════════════════════════════════════

  addFeature(systemId: string, subsystemId: string, name: string, description: string) {
    const tempId = crypto.randomUUID();
    const previous = this.systems();
    const optimistic: Feature = { id: tempId, name, description, subsystemId };
    this.systems.update(s => s.map(sys => sys.id === systemId ? {
      ...sys, subsystems: sys.subsystems.map(sub =>
        sub.id === subsystemId ? { ...sub, features: [...sub.features, optimistic] } : sub
      )
    } : sys));

    this.http.post<Feature>(`${this.apiUrl}/features`, { subsystemId, name, description }).subscribe({
      next: (feat) => this.systems.update(s => s.map(sys => sys.id === systemId ? {
        ...sys, subsystems: sys.subsystems.map(sub => sub.id === subsystemId ? {
          ...sub, features: sub.features.map(f => f.id === tempId ? feat : f)
        } : sub)
      } : sys)),
      error: () => this.systems.set(previous),
    });
  }

  updateFeatureName(systemId: string, subsystemId: string, featureId: string, name: string) {
    const previous = this.systems();
    this.systems.update(s => s.map(sys => sys.id === systemId ? {
      ...sys, subsystems: sys.subsystems.map(sub => sub.id === subsystemId ? {
        ...sub, features: sub.features.map(f => f.id === featureId ? { ...f, name } : f)
      } : sub)
    } : sys));
    this.http.patch(`${this.apiUrl}/features/${featureId}`, { name }).subscribe({
      error: () => this.systems.set(previous),
    });
  }

  updateFeatureReadme(sysId: string, subId: string, featId: string, readme: string) {
    const previous = this.systems();
    this.systems.update(s => s.map(sys => sys.id === sysId ? {
      ...sys, subsystems: sys.subsystems.map(sub => sub.id === subId ? {
        ...sub, features: sub.features.map(f => f.id === featId ? { ...f, readme } : f)
      } : sub)
    } : sys));
    this.http.patch(`${this.apiUrl}/features/${featId}`, { readme }).subscribe({
      error: () => this.systems.set(previous),
    });
  }

  deleteFeature(systemId: string, subId: string, featId: string) {
    const previousSystems = this.systems();
    const previousReqs = this.requirements();
    this.systems.update(s => s.map(sys => sys.id === systemId ? {
      ...sys, subsystems: sys.subsystems.map(sub => sub.id === subId ? {
        ...sub, features: sub.features.filter(f => f.id !== featId)
      } : sub)
    } : sys));
    this.requirements.update(r => r.filter(req => req.featureId !== featId));
    if (this.selectedFeatureId() === featId) this.selectedFeatureId.set(null);
    this.http.delete(`${this.apiUrl}/features/${featId}`).subscribe({
      error: () => {
        this.systems.set(previousSystems);
        this.requirements.set(previousReqs);
      },
    });
  }

  // ══════════════════════════════════════════════════════════════════
  //  REQUIREMENTS
  // ══════════════════════════════════════════════════════════════════

  addRequirement(req: Omit<Requirement, 'id' | 'createdAt'>) {
    const tempId = crypto.randomUUID();
    const previous = this.requirements();
    const optimistic: Requirement = { ...req, id: tempId, createdAt: Date.now() };
    this.requirements.update(r => [...r, optimistic]);

    this.http.post<Requirement>(`${this.apiUrl}/requirements`, req).subscribe({
      next: (real) => this.requirements.update(r => r.map(x => x.id === tempId ? real : x)),
      error: () => this.requirements.set(previous),
    });
  }

  updateRequirementStatus(id: string, newStatus: Status) {
    const previous = this.requirements();
    this.requirements.update(r => r.map(req => req.id === id ? { ...req, status: newStatus } : req));
    this.http.patch(`${this.apiUrl}/requirements/${id}`, { status: newStatus }).subscribe({
      error: () => this.requirements.set(previous),
    });
  }

  batchUpdateRequirementStatus(ids: string[], newStatus: Status) {
    if (!ids.length) return;
    const previous = this.requirements();
    this.requirements.update(r => r.map(req => ids.includes(req.id) ? { ...req, status: newStatus } : req));
    this.http.patch(`${this.apiUrl}/requirements/batch`, { ids, status: newStatus }).subscribe({
      error: () => this.requirements.set(previous),
    });
  }

  updateRequirement(id: string, updates: Partial<Requirement>) {
    const previous = this.requirements();
    this.requirements.update(r => r.map(req => req.id === id ? { ...req, ...updates } : req));
    this.http.patch(`${this.apiUrl}/requirements/${id}`, updates).subscribe({
      error: () => this.requirements.set(previous),
    });
  }

  deleteRequirement(id: string) {
    const previous = this.requirements();
    this.requirements.update(r => r.filter(req => req.id !== id));
    this.http.delete(`${this.apiUrl}/requirements/${id}`).subscribe({
      error: () => this.requirements.set(previous),
    });
  }

  // ══════════════════════════════════════════════════════════════════
  //  COMPLEX OPERATIONS  (server-side, transactional)
  // ══════════════════════════════════════════════════════════════════

  moveFeature(featureId: string, targetSystemId: string, targetSubsystemId: string) {
    const previousSystems = this.systems();
    const previousReqs = this.requirements();
    // Optimistic: find feature, remove from old, add to new
    let feat: Feature | undefined;
    this.systems.update(s => s.map(sys => ({
      ...sys,
      subsystems: sys.subsystems.map(sub => {
        const found = sub.features.find(f => f.id === featureId);
        if (found) { feat = found; return { ...sub, features: sub.features.filter(f => f.id !== featureId) }; }
        return sub;
      })
    })));
    if (feat) {
      this.systems.update(s => s.map(sys => sys.id === targetSystemId ? {
        ...sys, subsystems: sys.subsystems.map(sub => sub.id === targetSubsystemId ? {
          ...sub, features: [...sub.features, { ...feat!, subsystemId: targetSubsystemId }]
        } : sub)
      } : sys));
      this.requirements.update(r => r.map(req => req.featureId === featureId ? {
        ...req, systemId: targetSystemId, subsystemId: targetSubsystemId
      } : req));
    }
    this.http.post(`${this.apiUrl}/features/move`, { featureId, targetSystemId, targetSubsystemId }).subscribe({
      error: () => {
        this.systems.set(previousSystems);
        this.requirements.set(previousReqs);
      },
    });
  }

  moveSubsystem(subsystemId: string, targetSystemId: string) {
    const previousSystems = this.systems();
    const previousReqs = this.requirements();
    let sub: Subsystem | undefined;
    this.systems.update(s => s.map(sys => {
      const found = sys.subsystems.find(su => su.id === subsystemId);
      if (found) { sub = found; return { ...sys, subsystems: sys.subsystems.filter(su => su.id !== subsystemId) }; }
      return sys;
    }));
    if (sub) {
      this.systems.update(s => s.map(sys => sys.id === targetSystemId ? {
        ...sys, subsystems: [...sys.subsystems, { ...sub!, systemId: targetSystemId }]
      } : sys));
      this.requirements.update(r => r.map(req => req.subsystemId === subsystemId ? { ...req, systemId: targetSystemId } : req));
    }
    this.http.post(`${this.apiUrl}/subsystems/move`, { subsystemId, targetSystemId }).subscribe({
      error: () => {
        this.systems.set(previousSystems);
        this.requirements.set(previousReqs);
      },
    });
  }

  demoteSystem(sourceSystemId: string, targetSystemId: string) {
    const previousSystems = this.systems();
    const previousReqs = this.requirements();
    // Optimistic is complex — just call server and refresh
    this.http.post<{ ok: boolean; newSubsystemId: string }>(
      `${this.apiUrl}/systems/demote/${sourceSystemId}`, { targetSystemId }
    ).subscribe({
      next: async () => {
        await this.fetchAll();
        this.selectedSystemId.set(targetSystemId);
      },
      error: () => {
        this.systems.set(previousSystems);
        this.requirements.set(previousReqs);
      },
    });
  }

  // ══════════════════════════════════════════════════════════════════
  //  FOLDERS
  // ══════════════════════════════════════════════════════════════════

  addSystemFolder(systemId: string, folder: { name: string, category: FolderCategory, note: string }) {
    const tempId = crypto.randomUUID();
    const previous = this.systems();
    const optimistic = { id: tempId, ...folder };
    this.systems.update(s => s.map(sys => sys.id === systemId ? {
      ...sys, folders: [...(sys.folders || []), optimistic]
    } : sys));

    this.http.post<any>(`${this.apiUrl}/systems/${systemId}/folders`, folder).subscribe({
      next: (real) => this.systems.update(s => s.map(sys => sys.id === systemId ? {
        ...sys, folders: (sys.folders || []).map(f => f.id === tempId ? { id: real.id, name: real.name, category: real.category, note: real.note } : f)
      } : sys)),
      error: () => this.systems.set(previous),
    });
  }

  deleteSystemFolder(systemId: string, folderId: string) {
    const previous = this.systems();
    this.systems.update(s => s.map(sys => sys.id === systemId ? {
      ...sys, folders: (sys.folders || []).filter(f => f.id !== folderId)
    } : sys));
    this.http.delete(`${this.apiUrl}/systems/${systemId}/folders/${folderId}`).subscribe({
      error: () => this.systems.set(previous),
    });
  }

  // ══════════════════════════════════════════════════════════════════
  //  WORK SESSIONS
  // ══════════════════════════════════════════════════════════════════

  addWorkSession(session: Omit<WorkSession, 'id' | 'createdAt' | 'updatedAt'>) {
    const tempId = crypto.randomUUID();
    const previous = this.workSessions();
    const optimistic: WorkSession = {
      ...session, id: tempId, createdAt: Date.now(), updatedAt: Date.now()
    };
    this.workSessions.update(s => [optimistic, ...s]);

    this.http.post<WorkSession>(`${this.apiUrl}/sessions`, session).subscribe({
      next: (real) => this.workSessions.update(s => s.map(x => x.id === tempId ? real : x)),
      error: () => this.workSessions.set(previous),
    });
  }

  updateWorkSession(id: string, updates: Partial<WorkSession>) {
    const previous = this.workSessions();
    this.workSessions.update(s => s.map(sess =>
      sess.id === id ? { ...sess, ...updates, updatedAt: Date.now() } : sess
    ));
    this.http.patch(`${this.apiUrl}/sessions/${id}`, updates).subscribe({
      error: () => this.workSessions.set(previous),
    });
  }

  deleteWorkSession(id: string) {
    const previous = this.workSessions();
    this.workSessions.update(s => s.filter(sess => sess.id !== id));
    this.http.delete(`${this.apiUrl}/sessions/${id}`).subscribe({
      error: () => this.workSessions.set(previous),
    });
  }

  // ══════════════════════════════════════════════════════════════════
  //  BLOCK SEGMENTATION
  // ══════════════════════════════════════════════════════════════════

  /** List all snapshots for a conversation. */
  async listSnapshots(conversationId: string): Promise<{ snapshots: SnapshotEntry[] }> {
    try {
      return await firstValueFrom(
        this.http.get<{ snapshots: SnapshotEntry[] }>(`${this.apiUrl}/conversations/${conversationId}/snapshots`)
      );
    } catch (err) {
      console.error('Failed to list snapshots:', err);
      return { snapshots: [] };
    }
  }

  /** List blocks for a snapshot, with optional diff from a previous snapshot. */
  async listBlocks(snapshotId: string, diffFrom?: string): Promise<BlocksResponse> {
    try {
      const params = diffFrom ? `?diffFrom=${diffFrom}` : '';
      return await firstValueFrom(
        this.http.get<BlocksResponse>(`${this.apiUrl}/snapshots/${snapshotId}/blocks${params}`)
      );
    } catch (err) {
      console.error('Failed to list blocks:', err);
      return { blocks: [], segments: [], overrides: [] };
    }
  }

  /** Create a new snapshot (harvest pipeline). */
  async createSnapshot(params: {
    conversationId: string;
    snapshotIndex: number;
    sourceHash: string;
    captureMode?: string;
    blockCount?: number;
    createdBy?: string;
    blocks?: Array<{
      blockIndex: number;
      blockType: string;
      contentMd: string;
      contentHash: string;
      parentTurnId?: string;
      parentBlockId?: string;
      domPath?: string;
      domFingerprint?: string;
      firstLineNo?: number;
      lastLineNo?: number;
    }>;
  }): Promise<{ snapshot: SnapshotEntry; blockCount: number } | null> {
    try {
      return await firstValueFrom(
        this.http.post<{ snapshot: SnapshotEntry; blockCount: number }>(`${this.apiUrl}/snapshots`, params)
      );
    } catch (err) {
      console.error('Failed to create snapshot:', err);
      return null;
    }
  }

  /** Commit a user-defined segment. */
  async createSegment(params: {
    conversationId: string;
    snapshotId: string;
    startBlockId: string;
    endBlockId: string;
    startBlockIndex: number;
    endBlockIndex: number;
    segmentType?: string;
    source?: string;
    title?: string;
    notesMd?: string;
    createdBy?: string;
  }): Promise<SegmentEntry | null> {
    try {
      return await firstValueFrom(
        this.http.post<SegmentEntry>(`${this.apiUrl}/segments`, params)
      );
    } catch (err) {
      console.error('Failed to create segment:', err);
      return null;
    }
  }

  /** Update a segment (type, state, title, notes). */
  async updateSegment(segmentId: string, updates: {
    segmentType?: string;
    state?: string;
    title?: string;
    notesMd?: string;
  }): Promise<SegmentEntry | null> {
    try {
      return await firstValueFrom(
        this.http.patch<SegmentEntry>(`${this.apiUrl}/segments/${segmentId}`, updates)
      );
    } catch (err) {
      console.error('Failed to update segment:', err);
      return null;
    }
  }

  /** Supersede (bitemporal expire) a segment. */
  async supersedeSegment(segmentId: string): Promise<{ ok: boolean } | null> {
    try {
      return await firstValueFrom(
        this.http.delete<{ ok: boolean }>(`${this.apiUrl}/segments/${segmentId}`)
      );
    } catch (err) {
      console.error('Failed to supersede segment:', err);
      return null;
    }
  }

  /** Add a projection override (suppression/deprioritization). */
  async createProjectionOverride(params: {
    conversationId: string;
    snapshotId: string;
    targetType: string;
    targetId: string;
    projectionTarget?: string;
    overrideType?: string;
    reasonCode?: string;
    notesMd?: string;
    source?: string;
    createdBy?: string;
  }): Promise<ProjectionOverrideEntry | null> {
    try {
      return await firstValueFrom(
        this.http.post<ProjectionOverrideEntry>(`${this.apiUrl}/projection-overrides`, params)
      );
    } catch (err) {
      console.error('Failed to create projection override:', err);
      return null;
    }
  }

  /** Remove a projection override (bitemporal expire). */
  async removeProjectionOverride(overrideId: string): Promise<{ ok: boolean } | null> {
    try {
      return await firstValueFrom(
        this.http.delete<{ ok: boolean }>(`${this.apiUrl}/projection-overrides/${overrideId}`)
      );
    } catch (err) {
      console.error('Failed to remove projection override:', err);
      return null;
    }
  }

  /** Get the BP projection for a snapshot. */
  async getProjection(snapshotId: string, target: string = 'BP'): Promise<ProjectionResponse | null> {
    try {
      return await firstValueFrom(
        this.http.get<ProjectionResponse>(`${this.apiUrl}/snapshots/${snapshotId}/projection?target=${target}`)
      );
    } catch (err) {
      console.error('Failed to get projection:', err);
      return null;
    }
  }

  /** Get harvest references for a snapshot. */
  async listReferences(snapshotId: string, filters?: {
    state?: string;
    edgeType?: string;
    minConfidence?: number;
  }): Promise<ReferencesResponse> {
    try {
      const params = new URLSearchParams();
      if (filters?.state) params.set('state', filters.state);
      if (filters?.edgeType) params.set('edgeType', filters.edgeType);
      if (filters?.minConfidence !== undefined) params.set('minConfidence', String(filters.minConfidence));
      const query = params.toString();
      return await firstValueFrom(
        this.http.get<ReferencesResponse>(`${this.apiUrl}/snapshots/${snapshotId}/references${query ? '?' + query : ''}`)
      );
    } catch (err) {
      console.error('Failed to list references:', err);
      return { references: [] };
    }
  }
}
