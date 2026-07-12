import { Injectable, signal } from '@angular/core';

export interface Toast {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info';
}

@Injectable({ providedIn: 'root' })
export class ToastService {
  toasts = signal<Toast[]>([]);

  show(message: string, type: 'success' | 'error' | 'info' = 'info') {
    const id = Math.random().toString(36).slice(2, 11);
    this.toasts.update(list => [...list, { id, message, type }]);
    // Auto-dismiss after 3s
    setTimeout(() => this.dismiss(id), 3000);
  }

  dismiss(id: string) {
    this.toasts.update(list => list.filter(t => t.id !== id));
  }
}
