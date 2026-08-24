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

  /** Human explanations for the (sometimes cryptic) sort modes. */
  readonly sortDescriptions: Record<string, string> = {
    created_at: 'Newest conversations first',
    created_at_asc: 'Oldest conversations first',
    code_blocks: 'Most code blocks',
    turns: 'Longest conversations (most turns)',
    block_density: 'Blocks per turn — densest conversations',
    candidate_count: 'Most candidates extracted',
    collaboration: 'User/assistant turn ratio',
    tag_frequency: 'Most tags',
    keyword_hits: 'Most keyword matches (enter a keyword)',
  };
}
