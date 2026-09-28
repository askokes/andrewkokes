# Licensing and Attribution

Status: 2026-09-28. Built on the founder's decisions: the NIV through the YouVersion Platform, the BSB bundled, no AI output in v1, free forever. Licensor pages were blocked during research, so "verify" marks facts from search snippets; confirm them on the linked page. SDK facts were read in YouVersion's source on GitHub.

## Summary

| Source | Owner | How v1 uses it | What we must do |
|---|---|---|---|
| NIV (Bible version 111) | Biblica, delivered by YouVersion | Fetched at runtime through the YouVersion Swift SDK | Stay non-commercial; show "NIV" and the API's copyright string; never bundle, store, index or send it to AI |
| Berean Standard Bible (BSB) | Public domain (CC0) | Bundled: offline fallback, reason analysis, search | Nothing required; credit it on About |
| OpenBible.info cross references | OpenBible.info, CC-BY | Bundled as verse references and votes | Attribution with a change note on About |
| AI output | Not applicable | None in v1 | YouVersion's written approval first; a Biblica AI license if the AI reads NIV text |

## NIV through the YouVersion Platform

YouVersion gives apps free access to its Bible library through an API and a Swift SDK. The NIV is version 111 and "requires a separate accepted license on platform.youversion.com" (confirmed: https://github.com/youversion/platform-skills). The license shows as Approved once accepted (verify: https://partner-support.youversion.com/l/en/article/v9jc7p1ttb-license-management). Apps must be non-commercial: no ads, paywalls or subscriptions, and adding them later removes access (verify: https://help.youversion.com/l/en/article/72ghg45c41-how-to-sign-up-for-platform). We also rule out tips and a paid tier.

### This week

1. Sign up at https://platform.youversion.com, register the app as non-commercial and get an app key.
2. Accept the NIV (111) license in the portal. Save PDFs of the license and the Platform Terms (https://platform.youversion.com/terms) in `docs/licenses/`. Read them for display limits, caching and AI.
3. Email YouVersion Platform Support the questions below. Start now: AI approval has a long lead time.
4. Keep every answer, dated, in `docs/licenses/`.

### What the app must display

- "NIV" with every NIV passage and preview.
- The `copyright` string from the SDK's `BibleVersion` wherever NIV text appears: under the chapter, in the peek sheet and on About. YouVersion asks for the abbreviation plus copyright "somewhere appropriate" (confirmed: platform-skills). `BibleTextView` leaves this to the app; `BibleCardView` shows it itself (confirmed in the SDK source).
- Show what the API returns, not a hard-coded notice. Biblica's standard line, for reference: "Scripture quotations taken from The Holy Bible, New International Version®, NIV®. Copyright © 1973, 1978, 1984, 2011 by Biblica, Inc.™ Used by permission. All rights reserved worldwide." (verify: https://www.biblica.com/resources/bible-faqs/do-i-have-to-notify-biblica-to-use-a-bible-verse-from-the-niv/).
- No required "Powered by YouVersion" label was found (verify in the license).

### What the data design must respect

- References only. Our database holds verse ids, votes and reasons, never NIV words.
- The SDK does all NIV caching, until the server's cache header expires or 7 days by default (confirmed: `CachedBibleContent.swift`). Our code never writes NIV text to disk, SwiftData, logs or crash reports.
- No offline NIV: the SDK reports every version as not downloadable (confirmed, commit of 2026-09-23). The labelled BSB covers offline reading.
- We never index or search NIV text. Search runs over the BSB.
- No NIV text to any AI model. Reasons are computed from the BSB.
- Whole verses only in previews until YouVersion confirms shortening is allowed.
- Keep NIV on screen low: one chapter in the reader plus the peek sheet. A forum post reports the limit as "2 chapters or 25 verses displayed at a time" (unverified, no primary source).
- Chips show references and reasons, so the strip makes no NIV calls. Previews load only on tap. A request cannot span two chapters, so each preview is its own call (confirmed). No rate limits are published (verify: https://developers.youversion.com/api-usage).
- Never add ads, in-app purchases, tips, subscriptions or a paid tier.

### Questions for YouVersion Platform Support

1. AI. We plan AI study notes later. What does written approval involve and how long does it take? Does it apply to notes written only from the public-domain BSB? Is "AI-Assisted" in our name a problem while v1 shows no AI output?
2. Display limits. How many NIV verses may be on screen at once? Does one chapter plus one preview comply?
3. Shortening. May a preview show part of a verse?
4. References. May we ship cross references as verse ids beside NIV text from the SDK?
5. Caching. Is the SDK's cache the only one allowed? Is offline NIV planned?
6. Volume. One call per chapter read plus one per preview: acceptable? What are the rate limits?
7. Territory. Is version 111 licensed worldwide?
8. Privacy. Do you keep the installation id the SDK sends? How should we answer Apple's privacy label?
9. Attribution. Is the `copyright` string enough, or should we credit YouVersion too?

## Biblica direct (later)

Needed only for AI on NIV text, offline NIV, or terms YouVersion cannot give. Not before launch.

- Using Biblica content with "artificial intelligence, machine learning, large language models, chatbots" needs a Biblica license that expressly permits it (verify: https://www.biblica.com/permissions/).
- Full-text licenses go only to a registered legal entity, and not for software still in development. Review takes at least 15 business days, a permission letter 15 or more, a full agreement 4 to 6 weeks (verify, same page).
- The 500-verse gratis allowance cannot cover a full reader.
- Correction to the old brief, which called NIV text "streaming only": that rule on Biblica's page covers its audio recordings, not the text (verify). Offline text is a point to negotiate in a direct license, not a flat ban.

## API.Bible: why not

The free Starter plan allows up to 3 licensed Bibles for non-commercial use at 5,000 calls a month (verify: https://docs.api.bible/your-account/plans-pricing). Our reader makes a call per chapter and per preview, so a few hundred readers would use that up in days. It also requires per-passage usage tracking sent from iOS (verify: https://docs.api.bible/guides/fair-use), and NIV eligibility on Starter is unconfirmed.

## Berean Standard Bible

Dedicated to the public domain (CC0) on April 30, 2023 (https://berean.bible/terms.htm). Bundled as the offline fallback, labelled "BSB" when shown, and the analysis text for reasons (`tools/reasons.py`) and search. Attribution is appreciated, not required. About shows:

> The Holy Bible, Berean Standard Bible, BSB is produced in cooperation with Bible Hub, Discovery Bible, OpenBible.com, and the Berean Bible Translation Committee. This text of God's Word has been dedicated to the public domain.

## OpenBible.info cross references

343,608 references with crowd votes, dataset dated 2016-02-01, under a Creative Commons Attribution license with no version stated (verify: https://www.openbible.info/labs/cross-references/). Our copy comes through https://github.com/scrollmapper/bible_databases (see `tools/sources.py`). We changed the data (4 range ends clamped, 1 edge dropped, our own ranking and reasons), so the credit says so. The text already lives in `data/full/attribution.md` and README.md, and the About screen must show it:

> Cross references from OpenBible.info (https://www.openbible.info/labs/cross-references/), used under a Creative Commons Attribution license. Dataset dated 2016-02-01. Vote counts reflect OpenBible.info user voting. Ranking, range handling and connection reasons are our own.

Add the license link once the version is confirmed. Consider adding "Connection reasons are our own." next time the attribution changes.

## AI

- v1 shows no AI output. Reasons are fixed rules, not AI; About and the review notes say so. Leave any AI line out of About while no AI ships.
- YouVersion Platform Terms: the app "shall not use any AI Technology in a manner that generates output for or to Users without the prior written approval of YouVersion", and may not train on the content (verify: https://platform.youversion.com/terms). This covers the whole app, not only NIV text.
- Biblica: AI use of NIV content needs a license that expressly permits it (see above).
- The data model keeps its AI slots (`ai_context`, spec 2.11, and a reason `source` of "ai"), unused in v1.
- When AI arrives: label every note as AI-written, not Scripture, and possibly wrong; add a report button; if readers can type questions, follow Apple guideline 5.1.2(i) on sharing personal data with third-party AI (verify).

## Naming

- "NIV" is a Biblica trademark: "Use of either trademark for the offering of goods or services requires the prior written consent of Biblica US, Inc." (verify: https://www.biblica.com/terms-of-use/). Keep "NIV" out of the app name, subtitle, keywords and icon.
- Apple guideline 2.3.7 bars trademarked terms in metadata, and 5.2.1 requires permission to use third-party marks (https://developer.apple.com/app-store/review/guidelines/).
- "Study Bible" is descriptive; registrations such as "ESV Study Bible" disclaim it (verify).
- Similar App Store names: "Light - AI Study Bible" (closest), "AI Bible Study", "Bible Copilot - AI Bible Study". No exact "AI-Assisted Study Bible" was found (verify when reserving the name).
- "AI-Assisted" on a v1 with no AI features may draw an App Review question. See the name decision in `docs/IOS_BUILD_PLAN.md`.

## Proof for App Review

Keep ready: a screenshot of the NIV license marked Approved in the YouVersion portal; PDFs of the Platform Terms, the BSB terms page and the OpenBible.info labs page; a screenshot of About; and the review notes in `docs/IOS_BUILD_PLAN.md`.
