import { CommonModule } from '@angular/common';
import {
  AfterViewInit,
  Component,
  ElementRef,
  Input,
  ViewChild,
  signal,
} from '@angular/core';
import * as pdfjs from 'pdfjs-dist';

import { SignLocation } from '../../core/signatures.service';

// Copied into assets by the `pdfjs-worker` glob in angular.json.
pdfjs.GlobalWorkerOptions.workerSrc = 'assets/pdf.worker.min.mjs';

/** Default width of a signature box when the template omits it (backend default). */
const DEFAULT_WIDTH_PCT = 25;

/**
 * Renders the page that carries the signature box and overlays the box, so
 * the signer sees where the drawing will be stamped. Coordinates are
 * percentages from the top-left corner, the same the backend uses.
 */
@Component({
  selector: 'app-pdf-preview',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div #wrap class="pdf-wrap">
      <div *ngIf="!ready() && !failed()" class="text-center py-5">
        <div class="spinner-border text-primary" role="status"></div>
      </div>
      <div *ngIf="failed()" class="text-center py-5 text-body-secondary small">
        No pudimos cargar la vista previa.
        <a [href]="pdfUrl" target="_blank" rel="noopener" class="d-block mt-2">Abrir el documento en otra pestana</a>
      </div>
      <canvas #canvas [hidden]="!ready()"></canvas>
      <div
        *ngIf="ready() && box"
        class="sig-box"
        [style.left.%]="box.x_pct"
        [style.top.%]="box.y_pct"
        [style.width.%]="box.width_pct ?? DEFAULT_WIDTH_PCT"
        [style.height.%]="box.height_pct ?? null"
      >
        <i class="bi bi-vector-pen"></i> Tu firma ira aqui
      </div>
    </div>
    <div *ngIf="ready()" class="d-flex justify-content-between align-items-center mt-2 small text-body-secondary">
      <span>Pagina {{ box?.page ?? 1 }} de {{ pages() }}</span>
      <a [href]="pdfUrl" target="_blank" rel="noopener" class="text-decoration-none">
        <i class="bi bi-box-arrow-up-right me-1"></i>Ver documento completo
      </a>
    </div>
  `,
})
export class PdfPreviewComponent implements AfterViewInit {
  @Input({ required: true }) pdfUrl!: string;
  @Input() box: SignLocation | null = null;

  @ViewChild('wrap') wrapRef!: ElementRef<HTMLDivElement>;
  @ViewChild('canvas') canvasRef!: ElementRef<HTMLCanvasElement>;

  readonly DEFAULT_WIDTH_PCT = DEFAULT_WIDTH_PCT;

  ready = signal(false);
  failed = signal(false);
  pages = signal(1);

  async ngAfterViewInit(): Promise<void> {
    try {
      const doc = await pdfjs.getDocument(this.pdfUrl).promise;
      this.pages.set(doc.numPages);
      const pageNo = Math.min(Math.max(this.box?.page ?? 1, 1), doc.numPages);
      const page = await doc.getPage(pageNo);
      const containerW = this.wrapRef.nativeElement.clientWidth;
      const base = page.getViewport({ scale: 1 });
      const scale = (containerW / base.width) * (window.devicePixelRatio || 1);
      const viewport = page.getViewport({ scale });
      const canvas = this.canvasRef.nativeElement;
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await page.render({ canvasContext: canvas.getContext('2d')!, viewport }).promise;
      this.ready.set(true);
    } catch {
      this.failed.set(true);
    }
  }
}
