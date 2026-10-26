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
  <circle cx="820" cy="250" r="150" fill="none" stroke="#BF953F" stroke-opacity="0.35" stroke-width="8"/>
  <circle cx="820" cy="250" r="96" fill="none" stroke="#BF953F" stroke-width="10"/>
  <polygon points="820,170 840,230 900,250 840,270 820,330 800,270 740,250 800,230" fill="#FCF6BA"/>
  <text x="72" y="135" fill="#FCF6BA" font-family="monospace" font-size="16" font-weight="600" letter-spacing="4">NIGHT FOUNDRY · LIVE SEARCH ORACLE</text>
  <text x="72" y="220" fill="#F1F1F1" font-family="serif" font-size="58" font-weight="400">Luminara Suite</text>
  <text x="72" y="285" fill="#B0ADA5" font-family="sans-serif" font-size="24">Evidence-bound SEO, AEO, and GEO domain audits.</text>
  <text x="72" y="330" fill="#B0ADA5" font-family="sans-serif" font-size="22">Live /llms.txt, /robots.txt, and 10-bot AI crawler verification.</text>
  <rect x="72" y="375" width="320" height="48" rx="24" fill="#BF953F"/>
  <text x="232" y="406" text-anchor="middle" fill="#000000" font-family="sans-serif" font-size="18" font-weight="700">ZERO FABRICATED METRICS</text>
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
    kicker: 'NIGHT FOUNDRY · LIVE CRAWL PROBE',
    title: 'Instant Audit',
    subtitle: 'Inspect /robots.txt, /llms.txt, and /ai.txt in real time.',
    cardTitle: 'VERDICT · luminarasuite.com',
    badge: 'MEASURED',
    badgeColor: '#34D399',
    rows: [
      ['llms.txt present', 'PASS', '#34D399'],
      ['llms.txt markdown structure', 'PASS', '#34D399'],
      ['AI crawler directives in robots.txt', 'PASS', '#34D399'],
      ['Canonical citation links in llms.txt', 'PASS', '#34D399'],
      ['ai.txt policy file', 'PASS', '#34D399'],
    ],
  },
  {
    file: '02-bot-matrix.png',
    kicker: 'AI BOT GOVERNANCE MATRIX',
    title: '10-Bot Crawler Matrix',
    subtitle: 'Verify GPTBot, ClaudeBot, PerplexityBot, and Google-Extended access.',
    cardTitle: 'ROBOTS.TXT DIRECTIVES · 10/10 ALLOWED',
    badge: 'MEASURED',
    badgeColor: '#34D399',
    rows: [
      ['GPTBot', 'ALLOWED', '#34D399'],
      ['OAI-SearchBot', 'ALLOWED', '#34D399'],
      ['ClaudeBot', 'ALLOWED', '#34D399'],
      ['PerplexityBot', 'ALLOWED', '#34D399'],
      ['Google-Extended', 'ALLOWED', '#34D399'],
    ],
  },
  {
    file: '03-ask-oracle.png',
    kicker: 'ORACLE AGENT · EVIDENCE-BOUND AEO &amp; GEO',
    title: 'Ask the Search Oracle',
    subtitle: 'Verdict + one concrete next action + grounded web sources.',
    cardTitle: 'GROQ LPU · GROUNDED VERDICT',
    badge: 'MEASURED',
    badgeColor: '#34D399',
    rows: [
      ['Verdict', 'Publish /llms.txt with canonical URLs', '#FCF6BA'],
      ['Next Action', 'Add H1 + blockquote summary + H2 links', '#F1F1F1'],
      ['Source 1', 'luminarasuite.com/methodology', '#B0ADA5'],
      ['Honesty Gate', 'Unverified metrics marked NOT_MEASURED', '#34D399'],
      ['Safety Control', 'Report AI Output action built in', '#FCF6BA'],
    ],
  },
  {
    file: '04-dashboard-board.png',
    kicker: 'OPERATOR WORKBENCH · OFFLINE-FIRST ROOM 3',
    title: 'Action Board &amp; History',
    subtitle: 'Track weekly SEO/AEO fixes offline and sync to your workspace.',
    cardTitle: 'WEEKLY FINDINGS &amp; DURABLE HISTORY',
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

for (const s of screens) {
  const rowsSvg = s.rows
    .map(
      ([label, status, color], idx) => `
      <g transform="translate(88, ${760 + idx * 140})">
        <rect width="904" height="112" rx="14" fill="#141310" stroke="#BF953F" stroke-opacity="0.28" stroke-width="2"/>
        <text x="36" y="66" fill="#F1F1F1" font-family="sans-serif" font-size="30" font-weight="600">${label}</text>
        <rect x="650" y="30" width="220" height="52" rx="10" fill="#0A0A0A" stroke="${color}" stroke-width="2"/>
        <text x="760" y="64" text-anchor="middle" fill="${color}" font-family="monospace" font-size="22" font-weight="700">${status}</text>
      </g>
    `,
    )
    .join('\n');

  const shotSvg = `
  <svg width="1080" height="1920" viewBox="0 0 1080 1920" xmlns="http://www.w3.org/2000/svg">
    <rect width="1080" height="1920" fill="#000000"/>
    <text x="72" y="140" fill="#FCF6BA" font-family="monospace" font-size="22" font-weight="600" letter-spacing="3">${s.kicker}</text>
    <text x="72" y="230" fill="#F1F1F1" font-family="serif" font-size="68">${s.title}</text>
    <text x="72" y="300" fill="#B0ADA5" font-family="sans-serif" font-size="30">${s.subtitle}</text>

    <rect x="56" y="370" width="968" height="1180" rx="24" fill="#0A0A0A" stroke="#BF953F" stroke-opacity="0.52" stroke-width="3"/>
    <text x="96" y="450" fill="#FCF6BA" font-family="monospace" font-size="24" font-weight="600">${s.cardTitle}</text>
    <rect x="780" y="412" width="200" height="54" rx="12" fill="#141310" stroke="${s.badgeColor}" stroke-width="2"/>
    <text x="880" y="448" text-anchor="middle" fill="${s.badgeColor}" font-family="monospace" font-size="22" font-weight="700">${s.badge}</text>

    <rect x="88" y="510" width="904" height="190" rx="16" fill="#141310" stroke="#BF953F" stroke-opacity="0.35" stroke-width="2"/>
    <text x="124" y="585" fill="#F1F1F1" font-family="sans-serif" font-size="32" font-weight="600">Luminara Night Foundry Workbench</text>
    <text x="124" y="645" fill="#B0ADA5" font-family="sans-serif" font-size="26">Zero fabricated metrics · HTTPS/TLS · Android 16 (API 36)</text>

    ${rowsSvg}

    <rect x="0" y="1740" width="1080" height="180" fill="#0A0A0A" stroke="#BF953F" stroke-opacity="0.28" stroke-width="2"/>
    <text x="160" y="1845" text-anchor="middle" fill="#FCF6BA" font-family="sans-serif" font-size="26" font-weight="600">Instant Audit</text>
    <text x="420" y="1845" text-anchor="middle" fill="#B0ADA5" font-family="sans-serif" font-size="26">Ask</text>
    <text x="670" y="1845" text-anchor="middle" fill="#B0ADA5" font-family="sans-serif" font-size="26">Dashboard</text>
    <text x="920" y="1845" text-anchor="middle" fill="#B0ADA5" font-family="sans-serif" font-size="26">Settings</text>
  </svg>
  `;

  await sharp(Buffer.from(shotSvg))
    .flatten({ background: '#000000' })
    .png({ compressionLevel: 9 })
    .toFile(path.join(shotsDir, s.file));
}

console.log('Generated Play Store assets in', outDir);
