import { Component, inject, signal, computed, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DataService } from '../services/data.service';
import { ListViewSortBarComponent } from './list-view-sort-bar.component';
import { formatDate } from '../app/utils/view-helpers';

@Component({
  selector: 'app-open-questions-view',
  standalone: true,
  imports: [CommonModule, ListViewSortBarComponent],
  templateUrl: './open-questions-view.component.html',
  host: { class: 'flex-1 flex flex-col min-h-0' },
})
export class OpenQuestionsViewComponent {
  dataService = inject(DataService);

  questions = signal<any[]>([]);
  count = signal(0);
  loading = signal(false);
  error = signal<string | null>(null);

  // Selection / detail
  selectedQuestionId = signal<string | null>(null);
  answers = signal<any[]>([]);
  answersLoading = signal(false);

  // Filters
  statusFilter = signal<string | null>(null);

  // Retry trigger
  retryTrigger = signal(0);

  private readonly STATUS_COLORS: Record<string, string> = {
    OPEN: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
    RESOLVED: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
    WONT_FIX: 'bg-gray-200 text-gray-600 dark:bg-gray-600 dark:text-gray-400',
  };

  private readonly CATEGORY_COLORS: Record<string, string> = {
    NEEDS_SPEC: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
    BLOCKER: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
    CLARIFICATION: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    TECHNICAL: 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400',
    PROCESS: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  };

  private readonly ROLE_COLORS: Record<string, string> = {
    architect: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400 border-purple-200 dark:border-purple-700',
    engineer: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400 border-blue-200 dark:border-blue-700',
    analyst: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400 border-amber-200 dark:border-amber-700',
    planner: 'bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-400 border-teal-200 dark:border-teal-700',
    reviewer: 'bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-400 border-rose-200 dark:border-rose-700',
    inspector: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400 border-orange-200 dark:border-orange-700',
    critic: 'bg-slate-100 text-slate-800 dark:bg-slate-900/30 dark:text-slate-400 border-slate-200 dark:border-slate-700',
  };

  private readonly CONFIDENCE_COLORS: Record<string, string> = {
    HIGH: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
    MEDIUM: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
    LOW: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
  };

  filteredQuestions = computed(() => {
    const term = this.dataService.listViewSearchTerm().toLowerCase().trim();
    let result = this.questions();
    if (this.statusFilter()) {
      result = result.filter((q: any) => q.status === this.statusFilter());
    }
    if (term) {
      result = result.filter((q: any) =>
        (q.title || '').toLowerCase().includes(term) ||
        (q.description || '').toLowerCase().includes(term) ||
        (q.category || '').toLowerCase().includes(term)
      );
    }
    return this.dataService.sortByMode(result);
  });

  statusCounts = computed(() => {
    const counts: Record<string, number> = {};
    for (const q of this.questions()) {
      const s = q.status || 'unknown';
      counts[s] = (counts[s] || 0) + 1;
    }
    return counts;
  });

  constructor() {
    let requestId = 0;

    effect(() => {
      this.retryTrigger();
      const currentId = ++requestId;
      this.loading.set(true);
      this.error.set(null);

      const promise = this.dataService.listOpenQuestions({ limit: 200 });

      promise.then(({ questions, count }) => {
        if (currentId !== requestId) return;
        this.questions.set(questions);
        this.count.set(count);
        this.loading.set(false);
      }).catch(err => {
        if (currentId !== requestId) return;
        this.error.set(err.message || 'Failed to fetch open questions');
        this.loading.set(false);
      });
    });
  }

  selectQuestion(id: string) {
    const newId = this.selectedQuestionId() === id ? null : id;
    this.selectedQuestionId.set(newId);
    if (newId) {
      this.answers.set([]);
      this.answersLoading.set(true);
      this.dataService.getOpenQuestionAnswers(newId).then(({ answers }) => {
        if (this.selectedQuestionId() === newId) {
          this.answers.set(answers);
          this.answersLoading.set(false);
        }
      }).catch(() => {
        if (this.selectedQuestionId() === newId) {
          this.answers.set([]);
          this.answersLoading.set(false);
        }
      });
    } else {
      this.answers.set([]);
    }
  }

  clearSelection() {
    this.selectedQuestionId.set(null);
    this.answers.set([]);
  }

  setStatusFilter(status: string | null) {
    this.statusFilter.set(status);
  }

  getStatusColor(status: string): string {
    return this.STATUS_COLORS[status] || 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400';
  }

  getCategoryColor(category: string): string {
    return this.CATEGORY_COLORS[category] || 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400';
  }

  getRoleColor(role: string): string {
    return this.ROLE_COLORS[role?.toLowerCase()] || 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400 border-gray-200 dark:border-gray-700';
  }

  getConfidenceColor(confidence: string): string {
    return this.CONFIDENCE_COLORS[confidence?.toUpperCase()] || 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400';
  }

  readonly formatDate = formatDate;
}
