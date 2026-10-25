import { mkdir } from 'node:fs/promises';
import { expect, test, type Locator, type Page } from '@playwright/test';

const WIDTHS = [1024, 1280, 1440] as const;
const VENDOR = /groq|nvidia|ollama|openrouter|tavily|perplexity|standby/i;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('luminara_advanced_ui', '0');
  });
});

async function noOverlap(header: Locator): Promise<string[]> {
  return header.evaluate((root) => {
    const boxes = [...root.querySelectorAll('[data-header-item]')].flatMap((node) => {
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      if (rect.width < 1 || rect.height < 1 || style.display === 'none' || style.visibility === 'hidden') return [];
      return [{ name: node.getAttribute('data-header-item') || 'item', rect }];
    });
    const hits: string[] = [];
    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        const a = boxes[i].rect;
        const b = boxes[j].rect;
        const contains = (outer: DOMRect, inner: DOMRect) =>
          outer.left <= inner.left + 1 && outer.top <= inner.top + 1
          && outer.right >= inner.right - 1 && outer.bottom >= inner.bottom - 1;
        if (contains(a, b) || contains(b, a)) continue;
        const overlapWidth = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const overlapHeight = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (overlapWidth > 1 && overlapHeight > 1) hits.push(`${boxes[i].name} x ${boxes[j].name}`);
      }
    }
    return hits;
  });
}

async function pillFullyVisible(pill: Locator): Promise<void> {
  await expect(pill).toBeVisible();
  await expect(pill).toHaveText(/add my business/i);
  expect(await pill.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  expect(await pill.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    return [2, rect.width / 2, Math.max(2, rect.width - 2)].every((dx) => {
      const hit = document.elementFromPoint(rect.left + dx, rect.top + rect.height / 2);
      return hit === el || (hit != null && el.contains(hit));
    });
  })).toBe(true);
}

async function openAudit(page: Page, width: number): Promise<Locator> {
  await page.setViewportSize({ width, height: 800 });
  await page.goto('/#INSTANT_AUDIT');
  await expect(page.getByRole('heading', { name: 'Will AI mention your brand?' })).toBeVisible();
  const header = page.getByTestId('app-header');
  await expect(header).not.toContainText(VENDOR);
  await expect(page.getByTestId('provider-status')).toHaveCount(0);
  return header;
}

test.describe('header does not overlap from 1024 to 1440', () => {
  for (const width of WIDTHS) {
    test(`business pill stays fully visible at ${width}px`, async ({ page }) => {
      const header = await openAudit(page, width);
      await pillFullyVisible(page.getByTestId('add-business-pill'));
      expect(await noOverlap(header)).toEqual([]);
      await mkdir('/opt/cursor/artifacts/screenshots', { recursive: true });
      await header.screenshot({ path: `/opt/cursor/artifacts/screenshots/header-${width}.png` });
    });
  }
});

test.describe('header with the free daily quota badge', () => {
  for (const width of WIDTHS) {
    test(`quota, pill, and search sit apart at ${width}px`, async ({ page }) => {
      const header = await openAudit(page, width);
      await page.evaluate(() => {
        window.dispatchEvent(new CustomEvent('luminara-quota-preview', {
          detail: { limit: 3, remaining: 3 },
        }));
      });
      const quota = page.getByTestId('quota-badge');
      const pill = page.getByTestId('add-business-pill');
      const search = page.getByTestId('header-search');
      await expect(quota).toBeVisible();
      await expect(quota).toContainText('3 of 3 left today');
      await expect(quota).toContainText(/upgrade/i);
      expect(await quota.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
      await pillFullyVisible(pill);
      await expect(search).toBeVisible();
      expect(await noOverlap(header)).toEqual([]);
      await mkdir('/opt/cursor/artifacts/screenshots', { recursive: true });
      await header.screenshot({ path: `/opt/cursor/artifacts/screenshots/header-quota-${width}.png` });
    });
  }
});
