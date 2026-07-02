import { signal, computed, Signal } from '@angular/core';
import { Requirement } from '../models/data.models';
import type { DataService } from './data.service';

/**
 * Shared hierarchy & expand state used by board-view and table-view.
 * Each component instantiates its own copy via the constructor.
 */
export class RequirementHierarchyState {
  readonly expandedReqs = signal<Set<string>>(new Set());
  readonly childRequirements = signal<Record<string, Requirement[]>>({});
  readonly loadingChildren = signal<Set<string>>(new Set());
  readonly depCounts = signal<Record<string, number>>({});

  readonly childCountByParent: Signal<Record<string, number>>;

  constructor(
    private dataService: DataService,
    private requirements: Signal<Requirement[]>,
  ) {
    this.childCountByParent = computed(() => {
      const map: Record<string, number> = {};
      for (const r of this.requirements()) {
        if (r.parentId) {
          map[r.parentId] = (map[r.parentId] || 0) + 1;
        }
      }
      return map;
    });
  }

  // ── Methods ──────────────────────────────────────────────

  async toggleExpand(req: Requirement, event: Event): Promise<void> {
    event.stopPropagation();
    const id = req.id;
    const expanded = this.expandedReqs();
    const newExpanded = new Set(expanded);

    if (expanded.has(id)) {
      newExpanded.delete(id);
      this.expandedReqs.set(newExpanded);
      return;
    }

    newExpanded.add(id);
    this.expandedReqs.set(newExpanded);

    // Load children if not already cached
    if (!this.childRequirements()[id]) {
      const loading = new Set(this.loadingChildren());
      loading.add(id);
      this.loadingChildren.set(loading);
      try {
        const children = await this.dataService.fetchChildren(id);
        this.childRequirements.update(prev => ({ ...prev, [id]: children }));
        for (const child of children) {
          this.loadDepCount(child.id);
        }
      } catch (err) {
        console.error('Failed to load children for', id, err);
      } finally {
        const loading2 = new Set(this.loadingChildren());
        loading2.delete(id);
        this.loadingChildren.set(loading2);
      }
    }

    this.loadDepCount(id);
  }

  async loadDepCount(reqId: string): Promise<void> {
    if (this.depCounts()[reqId] !== undefined) return;
    try {
      const deps = await this.dataService.fetchDependencies(reqId);
      this.depCounts.update(prev => ({ ...prev, [reqId]: deps.length }));
    } catch {
      this.depCounts.update(prev => ({ ...prev, [reqId]: 0 }));
    }
  }

  getChildren(parentId: string): Requirement[] {
    return this.childRequirements()[parentId] || [];
  }

  isExpanded(reqId: string): boolean {
    return this.expandedReqs().has(reqId);
  }

  isLoadingChildren(reqId: string): boolean {
    return this.loadingChildren().has(reqId);
  }

  hasInlineChildren(parentId: string): number {
    return this.childCountByParent()[parentId] || 0;
  }

  getDepCount(reqId: string): number {
    return this.depCounts()[reqId] || 0;
  }
}
