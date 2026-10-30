import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const outDir = path.resolve('docs/play-store/assets');
const shotsDir = path.join(outDir, 'screenshots');

await fs.mkdir(shotsDir, { recursive: true });

// 1. 512x512 Google Play Store Icon (Night Foundry Orbital Beacon, no alpha transparency per Play spec)
const iconSvg = `
<svg width="512" height="512" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
  <rect width="512" height="512" fill="#0A0A0A"/>
  <circle cx="256" cy="256" r="204" fill="none" stroke="#BF953F" stroke-opacity="0.28" stroke-width="3"/>
  <circle cx="256" cy="256" r="144" fill="none" stroke="#BF953F" stroke-width="14"/>
  <polygon points="256,144 282,230 368,256 282,282 256,368 230,282 144,256 230,230" fill="#FCF6BA"/>
  <circle cx="256" cy="256" r="18" fill="#000000"/>
</svg>
`;
await sharp(Buffer.from(iconSvg))
  .flatten({ background: '#0A0A0A' })
  .png({ compressionLevel: 9 })
  .toFile(path.join(outDir, 'play-icon-512.png'));

// 2. 1024x500 Google Play Feature Graphic (Night Foundry Workbench)
const featureSvg = `
<svg width="1024" height="500" viewBox="0 0 1024 500" xmlns="http://www.w3.org/2000/svg">
  <rect width="1024" height="500" fill="#000000"/>
  <rect x="24" y="24" width="976" height="452" rx="18" fill="#0A0A0A" stroke="#BF953F" stroke-opacity="0.45" stroke-width="2"/>
  <circle cx="844" cy="250" r="122" fill="none" stroke="#BF953F" stroke-opacity="0.35" stroke-width="6"/>
  <circle cx="844" cy="250" r="82" fill="none" stroke="#BF953F" stroke-width="9"/>
  <polygon points="844,182 861,233 912,250 861,267 844,318 827,267 776,250 827,233" fill="#FCF6BA"/>
  <circle cx="844" cy="250" r="10" fill="#000000"/>
  <text x="68" y="132" fill="#FCF6BA" font-family="monospace" font-size="15" font-weight="700" letter-spacing="3">NIGHT FOUNDRY · LIVE SEARCH ORACLE</text>
  <text x="68" y="216" fill="#F1F1F1" font-family="serif" font-size="54" font-weight="400">Luminara Suite</text>
  <text x="68" y="278" fill="#B0ADA5" font-family="sans-serif" font-size="21">Evidence-bound SEO, AEO, and GEO domain audits.</text>
  <text x="68" y="318" fill="#B0ADA5" font-family="sans-serif" font-size="21">Live /llms.txt, /robots.txt, and AI bot checks.</text>
  <rect x="68" y="366" width="310" height="48" rx="24" fill="#BF953F"/>
  <text x="223" y="397" text-anchor="middle" fill="#000000" font-family="sans-serif" font-size="17" font-weight="700">ZERO FABRICATED METRICS</text>
</svg>
`;
await sharp(Buffer.from(featureSvg))
  .flatten({ background: '#000000' })
  .png({ compressionLevel: 9 })
  .toFile(path.join(outDir, 'feature-graphic-1024x500.png'));

// 3. Four 1080x1920 (9:16) Google Play Phone Screenshots
const screens = [
  {
    file: '01-instant-audit.png',
    activeTab: 0,
    kicker: 'NIGHT FOUNDRY · LIVE CRAWL PROBE',
    title: 'Instant Audit',
    subtitle: 'Inspect /robots.txt, /llms.txt, and /ai.txt live.',
    cardTitle: 'VERDICT · luminarasuite.com',
    badge: 'MEASURED',
    badgeColor: '#34D399',
    rows: [
      ['llms.txt file present', 'PASS', '#34D399'],
      ['llms.txt markdown structure', 'PASS', '#34D399'],
      ['AI bot rules in robots.txt', 'PASS', '#34D399'],
      ['Citation links in llms.txt', 'PASS', '#34D399'],
      ['ai.txt policy file', 'PASS', '#34D399'],
    ],
  },
  {
    file: '02-bot-matrix.png',
    activeTab: 0,
    kicker: 'AI BOT GOVERNANCE MATRIX',
    title: '10-Bot Matrix',
    subtitle: 'Verify GPTBot, ClaudeBot, and PerplexityBot rules.',
    cardTitle: 'ROBOTS.TXT · 10/10 ALLOWED',
    badge: 'MEASURED',
    badgeColor: '#34D399',
    rows: [
      ['GPTBot (OpenAI)', 'ALLOWED', '#34D399'],
      ['OAI-SearchBot', 'ALLOWED', '#34D399'],
      ['ClaudeBot (Anthropic)', 'ALLOWED', '#34D399'],
      ['PerplexityBot', 'ALLOWED', '#34D399'],
      ['Google-Extended', 'ALLOWED', '#34D399'],
    ],
  },
  {
    file: '03-ask-oracle.png',
    activeTab: 1,
    kicker: 'ORACLE AGENT · AEO &amp; GEO ADVISOR',
    title: 'Ask the Oracle',
    subtitle: 'Verdict, one next action, and cited web sources.',
    cardTitle: 'GROQ LPU · GROUNDED VERDICT',
    badge: 'MEASURED',
    badgeColor: '#34D399',
    rows: [
      ['Verdict: Publish /llms.txt', 'VERIFIED', '#34D399'],
      ['Action: Add H1 &amp; H2 links', 'PRIORITY 1', '#FCF6BA'],
      ['Cited web sources', '4 SOURCES', '#34D399'],
      ['Unverified metrics guard', 'HONEST', '#34D399'],
      ['Report AI Output control', 'BUILT IN', '#FCF6BA'],
    ],
  },
  {
    file: '04-dashboard-board.png',
    activeTab: 2,
    kicker: 'OPERATOR WORKBENCH · ROOM 3 CACHE',
    title: 'Action Board',
    subtitle: 'Track weekly SEO/AEO fixes offline and in cloud.',
    cardTitle: 'FINDINGS &amp; AUDIT HISTORY',
    badge: 'SYNCED',
    badgeColor: '#34D399',
    rows: [
      ['Fix llms.txt present', 'DONE', '#34D399'],
      ['Add FAQPage JSON-LD schema', 'IN_PROGRESS', '#FCF6BA'],
      ['Health Score (unmeasured)', 'NOT_MEASURED', '#B0ADA5'],
      ['BYOK Keystore Vault', 'AES-256-GCM', '#34D399'],
      ['In-App Account Deletion', 'READY', '#34D399'],
    ],
  },
];

const navTabs = [
  { label: 'Instant Audit', x: 165 },
  { label: 'Ask', x: 425 },
  { label: 'Dashboard', x: 675 },
  { label: 'Settings', x: 925 },
];

for (const s of screens) {
  const rowsSvg = s.rows
    .map(
      ([label, status, color], idx) => `
      <g transform="translate(88, ${760 + idx * 140})">
        <rect width="904" height="112" rx="14" fill="#141310" stroke="#BF953F" stroke-opacity="0.28" stroke-width="2"/>
        <text x="34" y="65" fill="#F1F1F1" font-family="sans-serif" font-size="26" font-weight="600">${label}</text>
        <rect x="616" y="28" width="256" height="56" rx="12" fill="#0A0A0A" stroke="${color}" stroke-width="2"/>
        <text x="744" y="64" text-anchor="middle" fill="${color}" font-family="monospace" font-size="20" font-weight="700">${status}</text>
      </g>
    `,
    )
    .join('\n');

  const navSvg = navTabs
    .map((tab, idx) => {
      const active = idx === s.activeTab;
      const pill = active
        ? `<rect x="${tab.x - 110}" y="1778" width="220" height="72" rx="36" fill="#141310" stroke="#BF953F" stroke-opacity="0.55" stroke-width="2"/>`
        : '';
      const fill = active ? '#FCF6BA' : '#B0ADA5';
      const weight = active ? '700' : '400';
      return `${pill}<text x="${tab.x}" y="1823" text-anchor="middle" fill="${fill}" font-family="sans-serif" font-size="24" font-weight="${weight}">${tab.label}</text>`;
    })
    .join('\n');

  const shotSvg = `
  <svg width="1080" height="1920" viewBox="0 0 1080 1920" xmlns="http://www.w3.org/2000/svg">
    <rect width="1080" height="1920" fill="#000000"/>
    <text x="72" y="140" fill="#FCF6BA" font-family="monospace" font-size="21" font-weight="700" letter-spacing="3">${s.kicker}</text>
    <text x="72" y="228" fill="#F1F1F1" font-family="serif" font-size="64">${s.title}</text>
    <text x="72" y="294" fill="#B0ADA5" font-family="sans-serif" font-size="25">${s.subtitle}</text>

    <rect x="56" y="366" width="968" height="1184" rx="24" fill="#0A0A0A" stroke="#BF953F" stroke-opacity="0.52" stroke-width="3"/>
    <text x="92" y="448" fill="#FCF6BA" font-family="monospace" font-size="22" font-weight="700">${s.cardTitle}</text>
    <rect x="764" y="410" width="220" height="54" rx="12" fill="#141310" stroke="${s.badgeColor}" stroke-width="2"/>
    <text x="874" y="445" text-anchor="middle" fill="${s.badgeColor}" font-family="monospace" font-size="20" font-weight="700">${s.badge}</text>

    <rect x="88" y="508" width="904" height="190" rx="16" fill="#141310" stroke="#BF953F" stroke-opacity="0.35" stroke-width="2"/>
    <text x="124" y="582" fill="#F1F1F1" font-family="sans-serif" font-size="30" font-weight="600">Luminara Night Foundry Workbench</text>
    <text x="124" y="642" fill="#B0ADA5" font-family="sans-serif" font-size="24">Zero fabricated metrics · HTTPS/TLS · Android 16 (API 36)</text>

    ${rowsSvg}

    <rect x="0" y="1740" width="1080" height="180" fill="#0A0A0A" stroke="#BF953F" stroke-opacity="0.28" stroke-width="2"/>
    ${navSvg}
  </svg>
  `;

  await sharp(Buffer.from(shotSvg))
    .flatten({ background: '#000000' })
    .png({ compressionLevel: 9 })
    .toFile(path.join(shotsDir, s.file));
}

console.log('Generated Play Store assets in', outDir);
