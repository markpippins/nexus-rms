import { Component, input, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DataService } from '../services/data.service';

@Component({
  selector: 'app-list-view-sort-bar',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './list-view-sort-bar.component.html',
  host: { class: 'flex items-center gap-1.5 flex-wrap' }
})
export class ListViewSortBarComponent {
  dataService = inject(DataService);
  placeholder = input<string>('Search...');
}
