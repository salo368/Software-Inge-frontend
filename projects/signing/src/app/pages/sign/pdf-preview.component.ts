import { CommonModule } from '@angular/common';
import {
  AfterViewInit,
  ChangeDetectorRef,
  Component,
  ElementRef,
  Input,
  OnDestroy,
  QueryList,
  ViewChild,
  ViewChildren,
  inject,
  signal,
} from '@angular/core';
import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';

import { SignLocation } from '../../core/signatures.service';

// Copied into assets by the pdfjs globs in angular.json.
pdfjs.GlobalWorkerOptions.workerSrc = 'assets/pdf.worker.min.mjs';
const STANDARD_FONTS_URL = 'assets/standard_fonts/';

/** Default width of a signature box when the template omits it (backend default). */
const DEFAULT_WIDTH_PCT = 25;

/** Zoom steps over "fit to width". */
const ZOOMS = [1, 1.25, 1.5, 2, 2.5, 3];
/** Initial zoom (index into ZOOMS) on phones: 150%. */
const PHONE_ZOOM_INDEX = 2;

/** Never rasterise below 2x, even on 1x screens: text stays crisp when zoomed or scaled. */
const MIN_PIXEL_RATIO = 2;
/** Upper bound for one canvas side, to stay inside browser/memory limits. */
const MAX_CANVAS_PX = 4096;

interface PageInfo {
  n: number;
  /** height / width of the page. */
  ratio: number;
}

/**
 * Document viewer for the review step. Shows EVERY page (scrollable, fit to
 * width) rendered at high resolution, with zoom, and overlays the signature
 * box on the page that carries it. Coordinates are percentages from the
 * top-left corner, the same the backend uses.
 */
@Component({
  selector: 'app-pdf-preview',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div *ngIf="!ready() && !failed()" class="text-center py-5">
      <div class="spinner-border text-primary" role="status"></div>
    </div>
    <div *ngIf="failed()" class="text-center py-5 text-body-secondary small">
      No pudimos cargar la vista previa.
      <a [href]="pdfUrl" target="_blank" rel="noopener" class="d-block mt-2">Abrir el documento en otra pestana</a>
    </div>

    <div *ngIf="ready()" class="pdf-toolbar" id="signing-pdf-toolbar">
      <span class="small text-body-secondary">
        {{ pages().length }} {{ pages().length === 1 ? 'pagina' : 'paginas' }}
        <ng-container *ngIf="box"> &middot; tu firma va en la pagina {{ boxPage() }}</ng-container>
      </span>
      <div class="d-flex align-items-center gap-1">
        <button id="signing-pdf-zoom-out" type="button" class="btn btn-sm btn-outline-secondary"
          [disabled]="zoomIndex() === 0" (click)="zoom(-1)" aria-label="Alejar">
          <i class="bi bi-zoom-out"></i>
        </button>
        <span id="signing-pdf-zoom-level" class="small fw-semibold text-center" style="min-width: 3.2rem">
          {{ zoomPct() }}%
        </span>
        <button id="signing-pdf-zoom-in" type="button" class="btn btn-sm btn-outline-secondary"
          [disabled]="zoomIndex() === ZOOMS.length - 1" (click)="zoom(1)" aria-label="Acercar">
          <i class="bi bi-zoom-in"></i>
        </button>
        <a [href]="pdfUrl" target="_blank" rel="noopener" class="btn btn-sm btn-outline-secondary ms-1"
          title="Abrir el documento en otra pestana" aria-label="Abrir en otra pestana">
          <i class="bi bi-box-arrow-up-right"></i>
        </a>
      </div>
    </div>

    <div #scroll class="pdf-scroll" [hidden]="!ready()" id="signing-pdf-scroll">
      <div class="pdf-pages" [style.width.%]="zoomPct()">
        <div
          *ngFor="let p of pages(); trackBy: trackPage"
          class="pdf-page"
          [attr.data-page]="p.n"
          [style.aspect-ratio]="1 / p.ratio"
        >
          <canvas #canvas></canvas>
          <div
            *ngIf="box && p.n === boxPage()"
            class="sig-box"
            [style.left.%]="box.x_pct"
            [style.top.%]="box.y_pct"
            [style.width.%]="box.width_pct ?? DEFAULT_WIDTH_PCT"
            [style.height.%]="box.height_pct ?? null"
          >
            <i class="bi bi-vector-pen"></i> Tu firma ira aqui
          </div>
        </div>
      </div>
    </div>
  `,
})
export class PdfPreviewComponent implements AfterViewInit, OnDestroy {
  @Input({ required: true }) pdfUrl!: string;
  @Input() box: SignLocation | null = null;

  @ViewChild('scroll') scrollRef!: ElementRef<HTMLDivElement>;
  @ViewChildren('canvas') canvasRefs!: QueryList<ElementRef<HTMLCanvasElement>>;

  private cdr = inject(ChangeDetectorRef);
  private doc: PDFDocumentProxy | null = null;
  private tasks: RenderTask[] = [];
  private generation = 0;
  private resizeObserver: ResizeObserver | null = null;
  private redrawTimer: number | null = null;
  private lastWidth = 0;
  private destroyed = false;

  readonly DEFAULT_WIDTH_PCT = DEFAULT_WIDTH_PCT;
  readonly ZOOMS = ZOOMS;

  ready = signal(false);
  failed = signal(false);
  pages = signal<PageInfo[]>([]);
  zoomIndex = signal(0);

  zoomPct(): number {
    return Math.round(ZOOMS[this.zoomIndex()] * 100);
  }

  boxPage(): number {
    const count = this.pages().length || 1;
    return Math.min(Math.max(this.box?.page ?? 1, 1), count);
  }

  trackPage = (_: number, p: PageInfo) => p.n;

  async ngAfterViewInit(): Promise<void> {
    try {
      this.doc = await pdfjs.getDocument({
        url: this.pdfUrl,
        standardFontDataUrl: STANDARD_FONTS_URL,
      }).promise;
      if (this.destroyed) return;

      const infos: PageInfo[] = [];
      for (let n = 1; n <= this.doc.numPages; n++) {
        const v = (await this.doc.getPage(n)).getViewport({ scale: 1 });
        infos.push({ n, ratio: v.height / v.width });
      }
      this.pages.set(infos);
      // Phones start zoomed in: a full page squeezed into ~330px is unreadable.
      if (window.innerWidth < 576) this.zoomIndex.set(PHONE_ZOOM_INDEX);
      this.ready.set(true);
      this.cdr.detectChanges(); // creates the canvases

      this.lastWidth = this.scrollRef.nativeElement.clientWidth;
      await this.renderAll();
      this.watchResize();

      // Bring the signature box into view (page + horizontal position when zoomed).
      if (this.box) {
        this.scrollRef.nativeElement
          .querySelector('.sig-box')
          ?.scrollIntoView({ block: 'center', inline: 'center' });
      }
    } catch {
      if (!this.destroyed) this.failed.set(true);
    }
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.generation++;
    this.tasks.forEach((t) => t.cancel());
    this.resizeObserver?.disconnect();
    if (this.redrawTimer !== null) window.clearTimeout(this.redrawTimer);
    void this.doc?.destroy();
  }

  zoom(delta: number): void {
    const next = Math.min(Math.max(this.zoomIndex() + delta, 0), ZOOMS.length - 1);
    if (next === this.zoomIndex()) return;
    this.zoomIndex.set(next);
    this.scheduleRedraw();
  }

  private watchResize(): void {
    if (typeof ResizeObserver === 'undefined') return;
    this.resizeObserver = new ResizeObserver(() => {
      const w = this.scrollRef.nativeElement.clientWidth;
      if (Math.abs(w - this.lastWidth) < 2) return;
      this.lastWidth = w;
      this.scheduleRedraw();
    });
    this.resizeObserver.observe(this.scrollRef.nativeElement);
  }

  private scheduleRedraw(): void {
    if (this.redrawTimer !== null) window.clearTimeout(this.redrawTimer);
    this.redrawTimer = window.setTimeout(() => {
      this.redrawTimer = null;
      void this.renderAll();
    }, 150);
  }

  /** Renders every page at the current on-screen width, always at >= 2x density. */
  private async renderAll(): Promise<void> {
    const doc = this.doc;
    if (!doc) return;
    const run = ++this.generation;
    this.tasks.forEach((t) => t.cancel());
    this.tasks = [];

    const canvases = this.canvasRefs.toArray();
    const cssWidth = canvases[0]?.nativeElement.clientWidth || this.scrollRef.nativeElement.clientWidth;
    const density = Math.max(window.devicePixelRatio || 1, MIN_PIXEL_RATIO);

    for (let i = 0; i < canvases.length; i++) {
      if (run !== this.generation || this.destroyed) return;
      const page = await doc.getPage(i + 1);
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min((cssWidth / base.width) * density, MAX_CANVAS_PX / base.width);
      const viewport = page.getViewport({ scale });
      const canvas = canvases[i].nativeElement;
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const task = page.render({ canvasContext: canvas.getContext('2d')!, viewport });
      this.tasks.push(task);
      try {
        await task.promise;
      } catch {
        // Cancelled by a newer render pass.
        return;
      }
    }
  }
}
