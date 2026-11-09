import { CommonModule } from '@angular/common';
import { Component, ElementRef, Input, computed, inject, signal } from '@angular/core';
import { ControlValueAccessor, NgControl } from '@angular/forms';

import { Ranked, fold, rankOptions } from '../core/search-rank';

export interface ComboOption {
  key: string;
  label: string;
  /** What the closed field shows instead of `label` (e.g. "+57" for a country). */
  display?: string;
  /** Right-aligned text in the list (e.g. the dial code). */
  hint?: string;
  /** CSS classes of a small icon before the label (e.g. a flag). */
  icon?: string;
  /** Extra text the search also matches, never shown. */
  keywords?: string;
  /** Wins ties in the search ranking (higher first). */
  priority?: number;
}

let nextId = 0;

/**
 * Search-as-you-type select for long lists (countries, departments, cities).
 * Typing filters the options and sorts them from most to least likely, ignoring
 * case and accents; the panel has a fixed maximum height (it scrolls) and
 * renders at most `maxVisible` rows, so it never grows with the list.
 *
 * The control holds the option's `key` (or '' when nothing is chosen).
 *
 *   Keyboard: type to search; ArrowUp/ArrowDown move; Enter chooses; Esc closes
 *   and restores the chosen value. On blur the text is kept only if it equals an
 *   option, otherwise the last choice comes back (clearing the box clears it).
 *
 * Put `inputId` here, not on the host: it lands on the real `<input>`.
 */
@Component({
  selector: 'app-combo-field',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './combo-field.component.html',
  styleUrl: './combo-field.component.css',
})
export class ComboFieldComponent implements ControlValueAccessor {
  @Input() inputId = '';
  /**
   * `false` for short lists: the field is not typed into, it just opens the list
   * (a select with the same look as the searchable ones; the OS list of a native
   * <select> cannot be styled). Type-ahead still jumps to a label by its first letter.
   */
  @Input() searchable = true;
  @Input() placeholder = 'Escribe para buscar';
  /** Shown when what was typed matches nothing. */
  @Input() noResultsText = 'Sin resultados. Revisa lo que escribiste.';
  /** Shown when there are no options at all (e.g. no department chosen yet). */
  @Input() noOptionsText = 'No hay opciones disponibles.';
  /** Min width of the list when the field is narrower than its content (e.g. a dial-code box). */
  @Input() panelMinWidth: string | null = null;
  /** Rows rendered at most; the rest is reached by typing more. */
  @Input() set maxVisible(value: number) {
    this.maxRows.set(value);
  }

  @Input() set options(value: readonly ComboOption[] | null) {
    this.opts.set(value ?? []);
  }
  /** Keys listed first while nothing is typed (e.g. Colombia among 196 countries). */
  @Input() set pinned(value: readonly string[] | null) {
    this.pinnedKeys.set(value ?? []);
  }

  private host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  readonly ngControl = inject(NgControl, { self: true, optional: true });

  private opts = signal<readonly ComboOption[]>([]);
  private pinnedKeys = signal<readonly string[]>([]);
  private maxRows = signal(50);

  /** Chosen option key. */
  value = signal('');
  /** What the user is typing; only meaningful while `editing`. */
  text = signal('');
  editing = signal(false);
  open = signal(false);
  active = signal(0);
  disabled = signal(false);
  /** Room to the right of the field, so a panel wider than it can't leave the screen. */
  maxPanelPx = signal<number | null>(null);

  readonly uid = ++nextId;

  readonly selectedOption = computed(() => this.opts().find((o) => o.key === this.value()) ?? null);
  readonly selectedLabel = computed(() => this.selectedOption()?.label ?? '');
  /** The field shows the chosen option (`display` if it has one), or what is being typed. */
  readonly shownText = computed(() =>
    this.editing() ? this.text() : (this.selectedOption()?.display ?? this.selectedLabel()),
  );
  /** Icon of the chosen option, drawn inside the closed field. */
  readonly shownIcon = computed(() => (this.editing() ? null : (this.selectedOption()?.icon ?? null)));

  readonly results = computed<Ranked<ComboOption>[]>(() => {
    const all = this.opts();
    const q = this.editing() ? this.text() : '';
    if (q.trim()) return rankOptions(all, q);
    const pins = this.pinnedKeys();
    const first = pins.map((k) => all.find((o) => o.key === k)).filter((o): o is ComboOption => !!o);
    const rest = all.filter((o) => !pins.includes(o.key));
    return [...first, ...rest].map((item) => ({ item, score: 0, start: 0, end: 0 }));
  });
  readonly visible = computed(() => this.results().slice(0, this.maxRows()));
  readonly hidden = computed(() => this.results().length - this.visible().length);
  readonly hasOptions = computed(() => this.opts().length > 0);

  get listId(): string {
    return this.inputId ? `${this.inputId}-list` : `combo-${this.uid}-list`;
  }

  optionId(key: string): string {
    return `${this.inputId || 'combo-' + this.uid}-opt-${key}`;
  }

  activeId(): string | null {
    const r = this.visible()[this.active()];
    return this.open() && r ? this.optionId(r.item.key) : null;
  }

  private onChange: (v: string) => void = () => undefined;
  private onTouched: () => void = () => undefined;

  constructor() {
    if (this.ngControl) this.ngControl.valueAccessor = this;
  }

  // -------------------------------------------------------------------------
  // ControlValueAccessor
  // -------------------------------------------------------------------------

  writeValue(value: string | null): void {
    this.value.set(value ?? '');
    this.editing.set(false);
    this.text.set('');
  }

  registerOnChange(fn: (v: string) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(disabled: boolean): void {
    this.disabled.set(disabled);
    if (disabled) this.open.set(false);
  }

  showInvalid(): boolean {
    const c = this.ngControl;
    return !!(c?.invalid && (c.touched || c.dirty));
  }

  // -------------------------------------------------------------------------
  // Events
  // -------------------------------------------------------------------------

  /** Select the text so typing replaces the current choice. */
  onFocus(event: FocusEvent): void {
    if (!this.searchable) return;
    const el = event.target as HTMLInputElement;
    setTimeout(() => el.select());
  }

  onInput(event: Event): void {
    this.text.set((event.target as HTMLInputElement).value);
    this.editing.set(true);
    this.active.set(0);
    this.open.set(true);
    this.scrollActiveIntoView();
  }

  /** Searchable: open and let the user type. Not searchable: behave like a select (toggle). */
  onClick(): void {
    if (this.searchable) this.openList();
    else this.toggle();
  }

  openList(): void {
    if (this.disabled() || this.open()) return;
    this.measureRoom();
    this.open.set(true);
    // With nothing typed, start on the chosen option so it is in view.
    const i = this.visible().findIndex((r) => r.item.key === this.value());
    this.active.set(Math.max(i, 0));
    this.scrollActiveIntoView();
  }

  toggle(): void {
    if (this.disabled()) return;
    if (this.open()) {
      this.open.set(false);
    } else {
      this.input()?.focus();
      this.openList();
    }
  }

  onKeydown(event: KeyboardEvent): void {
    if (!this.searchable && this.selectKeys(event)) return;
    const last = this.visible().length - 1;
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        if (!this.open()) this.openList();
        else this.move(Math.min(this.active() + 1, last));
        break;
      case 'ArrowUp':
        event.preventDefault();
        if (!this.open()) this.openList();
        else this.move(Math.max(this.active() - 1, 0));
        break;
      case 'Enter':
        // Never submit the form while choosing.
        if (this.open()) {
          event.preventDefault();
          const r = this.visible()[this.active()];
          if (r) this.choose(r.item);
        }
        break;
      case 'Escape':
        if (this.open()) {
          event.preventDefault();
          event.stopPropagation();
          this.cancel();
        }
        break;
    }
  }

  onBlur(): void {
    this.open.set(false);
    if (this.editing()) {
      const typed = this.text().trim();
      if (!typed) {
        this.commit('');
      } else {
        const exact = this.opts().find((o) => fold(o.label) === fold(typed));
        if (exact) this.commit(exact.key);
        else this.editing.set(false); // back to the last choice
      }
    }
    this.onTouched();
  }

  choose(option: ComboOption): void {
    this.commit(option.key);
    this.open.set(false);
    this.input()?.focus();
  }

  trackKey(_: number, r: Ranked<ComboOption>): string {
    return r.item.key;
  }

  mouseMove(i: number): void {
    if (this.active() !== i) this.active.set(i);
  }

  /** `panelMinWidth`, capped to the space that really exists on screen. */
  panelMinWidthStyle(): string | null {
    if (!this.panelMinWidth) return null;
    const cap = this.maxPanelPx();
    return cap === null ? this.panelMinWidth : `min(${this.panelMinWidth}, ${cap}px)`;
  }

  /** Split a label around the matched part, to highlight it. */
  parts(r: Ranked<ComboOption>): [string, string, string] {
    const label = r.item.label;
    return r.end > r.start && this.editing() ? [label.slice(0, r.start), label.slice(r.start, r.end), label.slice(r.end)] : [label, '', ''];
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /** Space opens/chooses and a letter jumps ahead, like a native select. Returns true if handled. */
  private selectKeys(event: KeyboardEvent): boolean {
    if (event.key === ' ') {
      event.preventDefault();
      if (!this.open()) this.openList();
      else {
        const r = this.visible()[this.active()];
        if (r) this.choose(r.item);
      }
      return true;
    }
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      this.typeAhead(event.key);
      return true;
    }
    return false;
  }

  /** Highlights the next label that starts with `char`, wrapping around. */
  private typeAhead(char: string): void {
    const list = this.visible();
    if (!list.length) return;
    const c = fold(char);
    const from = this.open() ? this.active() : list.findIndex((r) => r.item.key === this.value());
    for (let step = 1; step <= list.length; step++) {
      const i = (from + step + list.length) % list.length;
      if (fold(list[i].item.label).startsWith(c)) {
        if (!this.open()) this.openList();
        this.move(i);
        return;
      }
    }
  }

  private commit(key: string): void {
    const changed = key !== this.value();
    this.value.set(key);
    this.editing.set(false);
    this.text.set('');
    if (changed) this.onChange(key);
  }

  private cancel(): void {
    this.open.set(false);
    this.editing.set(false);
    this.text.set('');
  }

  private move(i: number): void {
    this.active.set(i);
    this.scrollActiveIntoView();
  }

  private measureRoom(): void {
    if (!this.panelMinWidth) return;
    const left = this.host.getBoundingClientRect().left;
    this.maxPanelPx.set(Math.max(Math.floor(document.documentElement.clientWidth - left - 12), 160));
  }

  private input(): HTMLInputElement | null {
    return this.host.querySelector('input');
  }

  private scrollActiveIntoView(): void {
    setTimeout(() => this.host.querySelector('.combo-option.active')?.scrollIntoView({ block: 'nearest' }));
  }
}
