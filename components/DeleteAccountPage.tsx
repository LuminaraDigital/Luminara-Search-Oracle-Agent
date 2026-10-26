import React from 'react';
import {
  DELETE_ACCOUNT_INTRO,
  DELETE_ACCOUNT_RETENTION,
  DELETE_ACCOUNT_STEPS,
} from '../services/legal/deleteAccountCopy';
import { PlaySafeDocument } from './legal/PlaySafeDocument';

/** Account deletion steps for Play Console. No prices and no checkout. */
export const DeleteAccountPage: React.FC = () => (
  <PlaySafeDocument title="Delete account" lede={DELETE_ACCOUNT_INTRO}>
    <div className="mx-auto mt-16 max-w-2xl space-y-10 text-[15px] leading-relaxed">
      {DELETE_ACCOUNT_STEPS.map((step) => (
        <section key={step.title} className="border-t pt-8 lx-hairline">
          <h2 className="font-serif text-2xl text-[var(--color-ink)]">{step.title}</h2>
          {step.paragraphs.map((paragraph) => (
            <p key={paragraph} className="mt-3">{paragraph}</p>
          ))}
        </section>
      ))}
      <p>{DELETE_ACCOUNT_RETENTION}</p>
    </div>
  </PlaySafeDocument>
);
