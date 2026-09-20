import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

// Deliberately bare: the ceremony owns the full viewport and carries no
// product chrome, so it can be dropped in front of any host application.
@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet],
  template: '<router-outlet />',
})
export class AppComponent {}
