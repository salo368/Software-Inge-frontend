import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

import { AppLayoutComponent } from '@shared/layout/app-layout.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, AppLayoutComponent],
  template: `
    <app-layout active="account">
      <router-outlet />
    </app-layout>
  `,
})
export class AppComponent {}
