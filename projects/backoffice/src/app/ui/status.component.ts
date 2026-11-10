import { Component, Input } from '@angular/core';

import { ProcessStage } from '@shared/core/processes.service';

import { STAGE_LABEL } from '../core/labels';

/** Stage of a process as a quiet pill: coloured dot + label. */
@Component({
  selector: 'app-status',
  standalone: true,
  template: `<span class="bo-status" [class.bo-status-lg]="large" [attr.data-stage]="stage">{{ label }}</span>`,
})
export class StatusComponent {
  @Input({ required: true }) stage!: ProcessStage;
  @Input() large = false;

  get label(): string {
    return STAGE_LABEL[this.stage] ?? this.stage;
  }
}
