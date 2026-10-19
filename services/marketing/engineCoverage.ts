/**
 * What an audit actually measures.
 * Live ChatGPT, Perplexity and AI Overviews answers run only for Agency
 * or a caller's own DataForSEO login. Other plans leave those rows Not measured.
 */

export const LIVE_ANSWER_CHECKS =
  'Live ChatGPT, Perplexity and AI Overviews answers are measured on Agency, or with your own DataForSEO login. Other plans show those as Not measured.';

export const SITE_AND_SEARCH_CHECK =
  'Every plan checks your site and live web search for the questions your buyers ask.';

/** Core promise, kept only with the measurement limit in the same sentence group. */
export const HONEST_VISIBILITY_PROMISE =
  `See if AI recommends your business, and fix it. ${SITE_AND_SEARCH_CHECK} ${LIVE_ANSWER_CHECKS}`;
