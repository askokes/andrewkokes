# AI Study Bible: Licensing and Attribution Brief

Status: planning document, 2026-09-27. Direct page fetches were blocked during research, so facts below come from licensor pages as quoted in search snippets, or from files in the repo. Anything marked "verify" must be confirmed on the linked page before it goes into a contract, a submission, or the About screen.

## Summary table

| Source | Rights holder | License | Allows | Requires | v1 decision |
|---|---|---|---|---|---|
| NIV text (2011 edition) | Biblica, Inc. | Copyright; licensed use only | Gratis quotation up to 500 verses; streaming in apps under license | Written license; required notice; streaming only, no offline pack (verify) | Not in v1. Added after launch under a Biblica license |
| Berean Standard Bible (BSB) | Dedicated to the public domain by BSB Publishing, 2023 | Public domain (CC0) | Anything, including commercial use and offline bundling | Nothing; attribution appreciated | Ships in v1 as the bundled offline text |
| OpenBible.info cross references (2016-02-01) | OpenBible.info | Creative Commons Attribution (version not stated in snippet; verify) | Redistribution, adaptation, commercial use | Visible attribution to OpenBible.info | Ships in v1; the graph is built on it |
| CrossReferences.org TSK set (phrase anchors) | CrossReferences.org | CC BY 4.0 | Same, plus phrase-level anchors | Attribution to CrossReferences.org | v2 upgrade |
| AI-generated notes | Us (the publisher) | Our own generated content | Anything we choose | Reader disclosure: AI-written, not scripture | Ships in v1 with disclosure on every note |

Sources: https://www.biblica.com/permissions/ , https://berean.bible/terms.htm , https://www.openbible.info/labs/cross-references/ , https://github.com/CrossReferences-org/bible-cross-references

## NIV

Biblica, Inc. owns the NIV copyright (1973, 1978, 1984, 2011); the current text is the 2011 revision. Three rules shape our plan, all from https://www.biblica.com/permissions/ .

The gratis rule. Anyone may quote up to 500 NIV verses without permission, provided they are not a complete book and are under 25% of the work. This does not help a Bible reader: we display all 31,102 verses, every book complete. The rule covers devotionals and sermon notes.

The streaming rule. NIV text is not licensed for offline or downloadable use in mobile apps; streaming through websites or apps is permitted (verify wording). A licensed NIV would be fetched chapter by chapter from our backend while online, with a short-lived cache. The spec already assumes this: the NIV pack is `bundled: false`, served by URL, never committed. Offline reading stays on BSB. Biblica's own app offering offline downloads says nothing about what a third party gets.

The no-prototype rule. Biblica generally does not license software still in development. When the product is complete, you submit a Permission Request Form describing what makes it unique. So the order is BSB first, NIV second. There is nothing to apply for until the app is finished.

Three doors, one open:

- Biblica direct. The only path to a commercial NIV app license. For US and Canada commercial use, Biblica's page points to HarperCollins Christian Publishing, Permissions Department, P.O. Box 141000, Nashville, TN 37214, online form at https://www.harpercollinschristian.com/sales-and-rights/permissions/ (verify; the snippet frames this as print, and an app request may route back to Biblica). Quoted turnaround is six to eight weeks (verify). UK and Europe go through Hodder & Stoughton.
- API.Bible (American Bible Society). Many copyrighted translations can be licensed for commercial use from about $10 per month each, but NIV commercial use is not available. Commercial means any monetization, including freemium. Sources: https://care.api.bible/article/369-understanding-api-bible-licensing , https://care.api.bible/article/409-express-licensing-for-commercial-use . A free, unmonetized beta might use a non-commercial NIV tier (verify one exists).
- YouVersion Platform. Free APIs and a Swift SDK with fast-track access to 1,475 versions including the NIV, but NIV commercial use is excluded and the text stays on their servers. Source: https://platform.youversion.com/ (verify). Beta only.

Steps and timeline:

1. Build and ship v1 on BSB.
2. In launch week, write a one-page product description: what the app does, why the ticker and AI notes are new, how the NIV would be streamed, pricing, screenshots.
3. Submit Biblica's Permission Request Form the week v1 is live; file the HarperCollins form if the response points there.
4. Expect six to eight weeks for a first answer, then negotiation over royalty, territory, streaming terms and audit rights. Budget three to five months to signature.
5. On signature, load the NIV pack behind the existing `translations[]` entry, set `copyrightNotice` to the contract's exact text, ship the toggle.

Notice line, standard form:

> Scripture quotations taken from The Holy Bible, New International Version®, NIV®. Copyright © 1973, 1978, 1984, 2011 by Biblica, Inc.™ Used by permission. All rights reserved worldwide.

Sources: https://www.blueletterbible.org/versions.cfm , https://support.sermonary.com/article/67-bible-translation-copyright-and-permission-notices . Verify: the license will dictate wording, trademark symbols, and whether the last sentence is required. Use the contract's text, not this draft.

## Berean Standard Bible

Dedicated to the public domain on April 30, 2023 under CC0. Free and commercial use, offline bundling and adaptation are all permitted. Source: https://berean.bible/terms.htm .

Attribution is appreciated, not required. Use this line in Settings > About and in `Translation.copyrightNotice`:

> The Holy Bible, Berean Standard Bible, BSB is produced in cooperation with Bible Hub, Discovery Bible, OpenBible.com, and the Berean Bible Translation Committee. This text of God's Word has been dedicated to the public domain.

Why it is the right placeholder: a modern English translation finished in the 2020s, in a register close to the NIV (readable, moderately literal), so snippets, AI notes and the reading feel will carry over when the NIV drops in. The KJV or ASV are also free, but their register would make the prototype feel like a different product. The BSB source has no section headings, which the spec records as `headings: false`.

## OpenBible.info cross references

About 340,000 references, built mainly from the public-domain Treasury of Scripture Knowledge plus other sources, with crowd votes per link, licensed under a Creative Commons Attribution license. Source: https://www.openbible.info/labs/cross-references/ . The dataset file header says "CC-BY" and the page snippet says only "Creative Commons Attribution License", so the model and the About text say "CC-BY" without a version until you confirm it.

Our copy is the 2016-02-01 dump via the `2024` branch of https://github.com/scrollmapper/bible_databases (see `tools/sources.py`). The repo's code is MIT (verify); the data keeps its CC-BY terms. File header: "www.openbible.info CC-BY 2016-02-01".

Render in Settings > About:

> Cross references from OpenBible.info (https://www.openbible.info/labs/cross-references/), used under a Creative Commons Attribution license. Dataset dated 2016-02-01. Vote counts reflect OpenBible.info user voting. Ranking and range handling are our own.

The last sentence matters: CC-BY asks us to say we changed the data, and we did (4 range targets clamped to BSB verse numbering, 1 edge dropped, our own ranking).

v2 upgrade: https://github.com/CrossReferences-org/bible-cross-references offers the TSK set with phrase-level anchors for KJV and BSB, JSON and TSV, CC BY 4.0. Phrase anchors let the ticker highlight the words a reference hangs on. It is not verbatim TSK (under 1% edited), so it enters the model as a second `sourceId`. Attribution: "Cross-reference data from CrossReferences.org (https://crossreferences.org), CC BY 4.0."

## AI-generated content

Disclose three things wherever a note appears, not only in About: an AI wrote it, it is not scripture or part of the Bible text, and it can be wrong. The spec already carries the long form in `provenance.disclaimer`. Show a short label ("AI study note") on the chip and the long form on tap.

The provenance block covers what a reviewer or reader could ask: `generator`, `model`, `promptId`, `promptVersion`, `schemaVersion`, `inputs`, `inputHash`, `generatedAt`, `backendJob`, `tokens`, `reviewed`, `disclaimer`. `reviewed: false` is the honest default. Add a report action and a `reportCount` so the app can hide a flagged note and the backend can regenerate it.

App Store: Apple's November 13, 2025 update requires disclosure and consent before personal data goes to third-party AI (guideline 5.1.2(i), verify). Our backend sends verse ids and Bible text, not personal data, so exposure is small; if readers can later type their own questions, add the disclosure step. Religious commentary is allowed, but guideline 1.1 covers inflammatory content about a religion, and reviewers expect a way to report bad content. A report button on every note plus "notes are AI-generated" in the app description is cheap insurance. Sources: https://developer.apple.com/app-store/review/guidelines/ , https://www.techrepublic.com/article/news-apple-app-review-guidelines-ai-data-sharing/ (verify).

## App Store intellectual property review (Guideline 5.2)

Guideline 5.2.1: do not use protected third-party material without permission; the submitter must own or have licensed all relevant IP. Reviewers may pause and ask for documentation. Sources: https://developer.apple.com/app-store/review/guidelines/ , https://appreviewready.com/guides/guideline-5-2-legal-rights-review/ .

Proof to prepare, attached in App Store Connect review notes:

- BSB: PDF of https://berean.bible/terms.htm with the dedication highlighted.
- OpenBible.info: PDF of the labs page showing the CC-BY notice, plus the file header line.
- NIV, later: the signed license, commercial terms redacted, and the licensor's contact.
- AI notes: one sentence stating they are generated by our backend and owned by us.

Also prepare a review-notes paragraph naming every source and license, and a screenshot of the About screen. Do not put "NIV" in the title, subtitle or keywords until the license is signed; that is a 5.2.1 metadata problem on its own.

## Checklist for the founder

1. Confirm the "verify" items on biblica.com/permissions: streaming-only wording, no-development-licenses rule, notice wording, US/Canada commercial contact.
2. Save PDFs of berean.bible/terms.htm and the OpenBible.info labs page into `docs/licenses/`.
3. Confirm the CC-BY version for OpenBible.info and set `manifest.sources[].license` to match.
4. Approve the About screen text: BSB notice, OpenBible attribution with the change note, AI disclosure.
5. Add the report action and `reportCount` to AI notes before v1.
6. Ship v1 on BSB with no NIV mention in metadata.
7. Write the one-page product description for Biblica during launch week.
8. Submit the Biblica Permission Request Form the week v1 is live; follow up at eight weeks.
9. If routed to HarperCollins Christian, file their online form the same day.
10. On signature, put the contract's notice into `Translation.copyrightNotice`, load the NIV pack, resubmit with the license in review notes.
11. Reserve a `sourceId` for the CrossReferences.org set and schedule it for v2.
