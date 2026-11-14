import React from 'react';
import { DEFAULT_INDUSTRY_ID, INDUSTRY_PROFILES } from '../../services/industries/industryProfiles';

export function IndustrySelect({
  id,
  value,
  onChange,
  className = 'w-full rounded-xl bg-transparent px-4 py-3.5 text-base text-ink outline-none',
}: {
  id: string;
  value: string;
  onChange: (industryId: string) => void;
  className?: string;
}) {
  return (
    <select
      id={id}
      value={value || DEFAULT_INDUSTRY_ID}
      onChange={(event) => onChange(event.target.value)}
      className={className}
    >
      {INDUSTRY_PROFILES.map((profile) => (
        <option key={profile.id} value={profile.id}>
          {profile.label}
        </option>
      ))}
    </select>
  );
}
