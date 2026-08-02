import { Component, input, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DataService } from '../services/data.service';

@Component({
  selector: 'app-harvest-filter-bar',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './harvest-filter-bar.component.html',
  host: { class: 'flex items-center gap-2 sm:gap-3 flex-wrap' }
})
export class HarvestFilterBarComponent {
  dataService = inject(DataService);
  placeholder = input<string>('Search...');
}
