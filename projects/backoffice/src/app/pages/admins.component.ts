import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';

import { Admin, AdminAuthService } from '../core/admin-auth.service';
import { friendlyAdminError } from '../core/admin-errors';
import { initials } from '../core/labels';
import { ShellComponent } from './shell.component';

/** Same rules as the backend (`password_too_short` / `_needs_letter` / `_needs_digit`). */
export function passwordChecks(password: string): { length: boolean; letter: boolean; digit: boolean } {
  return {
    length: password.length >= 10,
    letter: /[A-Za-z]/.test(password),
    digit: /\d/.test(password),
  };
}

function strongPassword(control: { value: string }): { weak: true } | null {
  const c = passwordChecks(control.value ?? '');
  return c.length && c.letter && c.digit ? null : { weak: true };
}

/** A random password that satisfies the rules (letters + digits, no look-alikes). */
export function generatePassword(length = 14): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint32Array(length));
  let out = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
  // Guarantee at least one letter and one digit.
  if (!/\d/.test(out)) out = '7' + out.slice(1);
  if (!/[A-Za-z]/.test(out)) out = 'K' + out.slice(1);
  return out;
}

/**
 * Creates administrators (`POST /admin-auth/register`). The service exposes no
 * list or delete endpoint yet, so this page only creates; the ones created in
 * this session are listed for reference (the password is never kept).
 */
@Component({
  selector: 'app-admins',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, ShellComponent],
  templateUrl: './admins.component.html',
})
export class AdminsComponent {
  private fb = inject(FormBuilder);
  private auth = inject(AdminAuthService);

  form = this.fb.nonNullable.group({
    full_name: ['', [Validators.required, Validators.pattern(/\S/)]],
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, strongPassword]],
  });

  loading = signal(false);
  showPassword = signal(false);
  error = signal<string | null>(null);
  created = signal<Admin[]>([]);
  /** The just-created admin, with the password typed (so it can be handed over). */
  lastCreated = signal<{ admin: Admin; password: string } | null>(null);
  copied = signal(false);

  private password = signal('');
  readonly checks = computed(() => passwordChecks(this.password()));
  readonly initials = initials;

  constructor() {
    this.form.controls.password.valueChanges.subscribe((v) => this.password.set(v ?? ''));
  }

  generate(): void {
    this.form.controls.password.setValue(generatePassword());
    this.form.controls.password.markAsDirty();
    this.showPassword.set(true);
  }

  submit(): void {
    if (this.form.invalid || this.loading()) return;
    this.loading.set(true);
    this.error.set(null);
    this.lastCreated.set(null);
    this.copied.set(false);
    const { full_name, email, password } = this.form.getRawValue();

    this.auth.registerAdmin(email, full_name, password).subscribe({
      next: ({ admin }) => {
        this.created.update((list) => [admin, ...list]);
        this.lastCreated.set({ admin, password });
        this.form.reset({ full_name: '', email: '', password: '' });
        this.showPassword.set(false);
        this.loading.set(false);
      },
      error: (err: HttpErrorResponse) => {
        this.error.set(friendlyAdminError(err.error?.error, err.status));
        this.loading.set(false);
      },
    });
  }

  async copyPassword(): Promise<void> {
    const last = this.lastCreated();
    if (!last) return;
    try {
      await navigator.clipboard.writeText(last.password);
      this.copied.set(true);
    } catch {
      this.copied.set(false);
    }
  }

  dismissLast(): void {
    this.lastCreated.set(null);
  }
}
