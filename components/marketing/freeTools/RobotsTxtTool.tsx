import React, { useState } from 'react';
import {
  AI_BOTS,
  BOT_PURPOSE_LABEL,
  buildRobotsTxt,
  matchingPreset,
  presetBlocks,
  ROBOTS_PRESETS,
} from '../../../services/freeTools/robotsTxt';
import { ToolField, ToolOutput, ToolSegmented } from './toolFields';

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
          <ToolSegmented
            label="Start from"
            showLabel
            options={ROBOTS_PRESETS}
            value={preset}
            onChange={(next) => setBlocked(presetBlocks(next))}
          />
          {presetNote && <p className="mt-2 text-xs text-[var(--color-ink-2)]">{presetNote}</p>}
        </div>

        <fieldset>
          <legend className="text-sm font-medium text-[var(--color-ink)]">AI crawlers</legend>
          <ul className="mt-3 divide-y divide-[rgb(252_246_186_/_0.08)] list-none m-0 p-0">
            {AI_BOTS.map((bot) => {
              const allowed = !blocked[bot.agent];
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
                    role="switch"
                    aria-checked={allowed}
                    aria-label={`Allow ${bot.agent}`}
                    onClick={() => setBlocked((prev) => ({ ...prev, [bot.agent]: !prev[bot.agent] }))}
                    className="lx-chip shrink-0"
                  >
                    {allowed ? 'Allowed' : 'Blocked'}
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
          hint="Every crawler is asked to skip these. A path of / on its own is left out, because it would block the whole site."
        />
        <ToolField label="Sitemap URL" value={sitemap} onChange={setSitemap} inputMode="url" />
      </div>

      <div className="space-y-4">
        <ToolOutput label="robots.txt" text={output} onCopied={onCopied} />
        <p className="text-xs text-[var(--color-ink-2)]">
          It lives at /robots.txt on your site. If you already have one, add these lines to it instead of replacing
          it. Not sure how? Send it to whoever manages your website.
        </p>
      </div>
    </div>
  );
};
