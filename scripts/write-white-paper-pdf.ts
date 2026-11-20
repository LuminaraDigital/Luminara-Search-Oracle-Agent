import { writeFileSync } from 'node:fs';
import { whitePaperPdfBytes } from '../services/marketing/whitePaperPdf';

const bytes = whitePaperPdfBytes();
writeFileSync('public/white-paper.pdf', bytes);
console.log(`wrote public/white-paper.pdf (${bytes.length} bytes)`);
