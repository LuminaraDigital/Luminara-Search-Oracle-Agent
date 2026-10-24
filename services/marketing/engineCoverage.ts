/**
 * What an audit actually measures.
 * Live answers from specific AI products run only on Agency
 * or a caller's own search login. Other plans leave those rows Not measured.
 */

export const LIVE_ANSWER_CHECKS =
  'Live answers from specific AI products stay Not measured unless you are on Agency or you connect your own search login.';

export const SITE_AND_SEARCH_CHECK =
  'Every plan checks your site and live web search for the questions your buyers ask.';

/** Core promise, kept only with the measurement limit in the same sentence group. */
export const HONEST_VISIBILITY_PROMISE =
  `See if AI recommends your business, and fix it. ${SITE_AND_SEARCH_CHECK} ${LIVE_ANSWER_CHECKS}`;
