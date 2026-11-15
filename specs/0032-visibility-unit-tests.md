# 0032: Visibility Unit Tests

## What

An owner with nobody to ask gets short yes/no answers: does AI name the business, get its facts right, point to its website, and can it read the site? Each answer has one plain reason.

Cycle 1 adds three things:

1. **Visibility Unit Tests.** Typed checks in four families (Presence, Accuracy, Citation, Structure), sliced by engine, suburb, service and intent.
2. **Save raw, grade later.** Raw answers and crawl snapshots are kept with their cost, and a better scorer regrades them for free.
3. **Provider scorecard.** Quality, reported cost and refusals per model, on the owner's own keys and own audits.

## Why

A score an owner cannot question is not useful to someone with no help. A yes/no check with a reason says what to do. Today's audit produces a citation rate from search results, and the only model probe keeps 400 characters of each answer and no cost, so a better scorer can never look at old results again.

## Patterns taken

From Omni Parse Bench, a document-parsing benchmark (Apache 2.0). This is an original TypeScript implementation. No code or data was copied.

- A test is one yes/no question. Tags select tests and never change a verdict.
- The headline is the mean of the families, so family size never sets weight.
- Predict and grade are separate stages, and grading calls no system, so it can run again for free.
- A summary states how many sources it rests on. Refusals are reported apart from quality.

## Differences from the bench

- **A third result.** The bench has pass and fail. Luminara must never invent a metric, so `not_measured` exists and is left out of the score.
- **The expected answer is the owner's.** Business DNA has no gold file behind it, so a test is Estimated until the owner confirms the facts.
- **No dataset and no benchmark claim.** Scores describe one business on one day. They do not rank vendors in general.

## Key decisions

- **Keys stay in the browser, so collection does too.** The Worker grades, so grading has one implementation. The evidence is client-reported, which is why it never feeds a signed receipt.
- **Audit-time checks reuse rows already collected.** A non-technical owner with no keys still gets results, at no extra cost, and they read as search results, never as AI. Spending an owner's key takes a button that says so.
- **Own-model checks use OpenRouter only.** One key reaches several models, it has no fallback, and a model answer can never be paid for by Luminara or credited to the wrong model.
- **Presence is graded only on questions that do not name the business.** All three audit searches contain the name, so a model or search engine would pass by repeating it. One unbranded search was added, with a timeout so it cannot hold up an audit, kept out of the citation rate so that number does not move.
- **Business DNA gained two things it lacked:** `keyFacts` and `factsConfirmedAt`. Name and mission cannot be graded yes/no. A phone number can.
- **Raw in R2, verdicts in D1.** Verdicts are queried and replaced, raw is read back only to regrade.
- **Owners see counts, not a percentage.** "4 of 9 checks passed" needs no explanation.

## Alternatives rejected

- **Running the Python benchmark in Workers.** It is a parsing benchmark with a large dependency tree, and it is the patterns that matter here.
- **Extending `ai_answer_captures`.** It stores excerpts and has one `accuracy_vs_dna` label per row. It has no typed verdict and no raw text.
- **Grading on the client and storing the result.** A saved verdict could not be regraded in one place, and old clients would grade differently.
- **Calling hosted models for every owner.** That would spend Luminara's money on a model with no web access and read as a measurement.

## Cycle 2, not built

"Can AI read your documents?" and Business DNA from PDFs, after a parser bake-off run off the Worker. Workers AI `toMarkdown` and own keys first. Paid parsers only with a spending decision. Cycle 1 has no document upload.

## Limits

- Own-model answers come from a plain API call, so they estimate what a model would say and are not what ChatGPT, Perplexity or AI Overviews show.
- An owner with no OpenRouter key sees search results and website checks only, so the scorecard stays empty for them.
- An owner with no service in Business DNA gets no Presence or Citation result, and the card tells them what to add.
- A single-word brand that is a common word can pass on an unrelated mention. Owners should use their full business name.
- Citation favours models that browse. The card says so, and `sonar` citations outside the answer text are not read.
- `statesFact` matches words and digits, so a correct paraphrase can fail. The reason says the answer left the fact out, not that it was wrong.
- Search-row answers are grouped by question, so a single answer here means several results.
- Page text is the audit's scrape, so a fact deeper in a site can read as not found.
