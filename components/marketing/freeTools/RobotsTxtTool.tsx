import React, { useState } from 'react';
import {
  AI_BOTS,
  BOT_PURPOSE_LABEL,
  buildRobotsTxt,
  presetBlocks,
  ROBOTS_PRESETS,
  type RobotsPreset,
} from '../../../services/freeTools/robotsTxt';
import { ToolField, ToolOutput, ToolSegmented } from './toolFields';

/** The preset the switches currently match, or null once a single crawler was flipped. */
function matchingPreset(blocked: Record<string, boolean>): RobotsPreset | null {
  const match = ROBOTS_PRESETS.find((p) => {
    const want = presetBlocks(p.id);
    return AI_BOTS.every((bot) => Boolean(blocked[bot.agent]) === want[bot.agent]);
  });
  return match?.id ?? null;
}

export const RobotsTxtTool: React.FC<{ onCopied: () => void }> = ({ onCopied }) => {
  const [blocked, setBlocked] = useState<Record<string, boolean>>(() => presetBlocks('allow_all'));
  const [paths, setPaths] = useState('/admin/');
  const [sitemap, setSitemap] = useState('https://www.example.com.au/sitemap.xml');

  const preset = matchingPreset(blocked);
  const output = buildRobotsTxt({ blocked, disallowPaths: paths.split('\n'), sitemapUrl: sitemap });
  const presetNote = preset ? ROBOTS_PRESETS.find((p) => p.id === preset)?.note : 'Custom: you changed single crawlers.';

  return (
    <div className="grid gap-8 lg:grid-cols-2">
      <div className="space-y-6">
        <div>
          <p className="text-sm font-medium text-[var(--color-ink)]">Start from</p>
          <div className="mt-3">
            <ToolSegmented
              label="Start from"
              options={ROBOTS_PRESETS}
              value={preset}
              onChange={(next) => setBlocked(presetBlocks(next))}
            />
          </div>
          {presetNote && <p className="mt-2 text-xs text-[var(--color-ink-2)]">{presetNote}</p>}
        </div>

        <fieldset>
          <legend className="text-sm font-medium text-[var(--color-ink)]">AI crawlers</legend>
          <ul className="mt-3 divide-y divide-[rgb(252_246_186_/_0.08)] list-none m-0 p-0">
            {AI_BOTS.map((bot) => {
              const isBlocked = Boolean(blocked[bot.agent]);
              return (
                <li key={bot.agent} className="flex items-center justify-between gap-4 py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm text-[var(--color-ink)]">{bot.agent}</p>
                    <p className="text-xs text-[var(--color-ink-2)]">
                      {bot.operator} · {BOT_PURPOSE_LABEL[bot.purpose]}
                    </p>
                  </div>
                  <button
                    type="button"
                    aria-pressed={!isBlocked}
                    aria-label={`${bot.agent}: ${isBlocked ? 'blocked' : 'allowed'}`}
                    onClick={() => setBlocked((prev) => ({ ...prev, [bot.agent]: !isBlocked }))}
                    className="lx-chip shrink-0"
                  >
                    {isBlocked ? 'Blocked' : 'Allowed'}
                  </button>
                </li>
              );
            })}
          </ul>
        </fieldset>

        <ToolField
          label="Private paths, one per line"
          value={paths}
          onChange={setPaths}
          multiline
          hint="Every crawler is asked to skip these."
        />
        <ToolField label="Sitemap URL" value={sitemap} onChange={setSitemap} inputMode="url" />
      </div>

      <div className="space-y-4">
        <ToolOutput label="robots.txt" text={output} onCopied={onCopied} />
        <p className="text-xs text-[var(--color-ink-2)]">
          Save it as robots.txt at the root of your site, so it opens at /robots.txt.
        </p>
      </div>
    </div>
  );
};
