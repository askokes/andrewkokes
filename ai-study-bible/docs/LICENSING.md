# AI Study Bible: Licensing and Attribution Brief

Status: planning document, 2026-09-27. Direct page fetches were blocked during research, so facts below come from licensor pages as quoted in search snippets, or from files in the repo. Anything marked "verify" must be confirmed on the linked page before it goes into a contract, a submission, or the About screen.

## Summary table

| Source | Rights holder | License | Allows | Requires | v1 decision |
|---|---|---|---|---|---|
| NIV text (2011 edition) | Biblica, Inc. | Copyright; licensed use only | Gratis quotation up to 500 verses, except in commercial reference works; online display under license | Written license to a registered legal entity; required notice; online display only, no on-device storage (verify) | Not in v1. Added after launch under a Biblica license |
| Berean Standard Bible (BSB) | None (BSB Publishing dedicated it to the public domain, April 30, 2023) | Public domain (CC0) | Anything, including commercial use and offline bundling | Nothing; attribution appreciated | Ships in v1 as the bundled offline text |
| OpenBible.info cross references (2016-02-01) | OpenBible.info | Creative Commons Attribution (version not stated in snippet; verify) | Redistribution, adaptation, commercial use | Visible attribution to OpenBible.info with a license link | Ships in v1; the graph is built on it |
| CrossReferences.org TSK set (phrase anchors) | CrossReferences.org | CC BY 4.0 | Same, plus phrase-level anchors | Attribution to CrossReferences.org | v2 upgrade |
| AI-generated notes | Us by contract with the API provider; copyright in unedited AI text is uncertain under US law (verify) | Provider terms | Anything we choose | Reader disclosure: AI-written, not scripture | Ships in v1 with disclosure on every note |

Sources: https://www.biblica.com/permissions/ , https://berean.bible/terms.htm , https://www.openbible.info/labs/cross-references/ , https://github.com/CrossReferences-org/bible-cross-references , https://www.copyright.gov/newsnet/2025/1060.html

## NIV

Biblica, Inc. owns the NIV copyright (1973, 1978, 1984, 2011); the current text is the 2011 revision. Four rules shape our plan, all from https://www.biblica.com/permissions/ .

The gratis rule. Anyone may quote up to 500 NIV verses without permission, provided they are not a complete book and are under 25% of the work. This does not help a Bible reader: we display every verse of every book (31,102 in BSB; the NIV pack will have a few fewer, with footnoted gaps). It also excludes us for a second reason: Biblica says any commentary or biblical reference work sold commercially that uses NIV text needs written permission regardless of verse count (https://www.biblica.com/resources/bible-faqs/do-i-have-to-notify-biblica-to-use-a-bible-verse-from-the-niv/). A study Bible with AI notes is a reference work, so even NIV snippets inside notes or chips need the license.

The streaming rule. Biblica's page says Bible text may only be licensed for online display, not unrestricted download; the explicit offline ban in the snippet is about audio in mobile apps (verify that the same limit applies to text in a native app). Plan for online-only NIV: chapters fetched from our backend and held in memory, and ask Biblica whether any on-device caching is allowed. The spec does not yet model this: `bundled: false` means a downloaded pack cached in SQLite (DATA_MODEL.md 2.2 and section 5). Add `delivery: "bundled" | "pack" | "streamed"` to Translation, set the NIV entry to `streamed`, and drop the NIV `packUrl`/`sha256` and the +5 MB SQLite estimate unless the signed license permits on-device storage. Offline reading stays on BSB.

The no-prototype rule. Biblica generally does not license software still in development. When the product is complete, you submit a Permission Request Form describing what makes it unique. So the order is BSB first, NIV second.

The entity rule. Biblica licenses full Bible text only to a registered legal entity, never an individual, and asks for documents verifying the entity (verify wording). Incorporate before applying.

Three doors, one open:

- Biblica direct (or its US/Canada agent). The only path we found that clearly reaches a commercial NIV app license; the API programs exclude it (verify whether API.Bible offers NIV under a negotiated commercial contract). For US and Canada commercial use, Biblica's page points to HarperCollins Christian Publishing (Zondervan), form at https://www.harpercollinschristian.com/sales-and-rights/permissions/ (verify; the snippet frames this as print, and an app request may route back to Biblica). HarperCollins quotes six to eight weeks average turnaround for its form. UK and Europe go through Hodder & Stoughton.
- API.Bible (American Bible Society). Many copyrighted translations can be licensed for commercial use from about $10 per month each, but not the NIV. Commercial means any product that generates revenue or supports a revenue model (their words; a free tier under a paid app counts). The free Starter plan includes up to 3 licensed Bibles for non-commercial use and the NIV is in the catalog (verify NIV is eligible on that tier and whether any client-side caching is allowed). Sources: https://care.api.bible/article/369-understanding-api-bible-licensing , https://care.api.bible/article/409-express-licensing-for-commercial-use , https://api.bible/ , https://docs.api.bible/guides/bibles/ .
- YouVersion Platform. Free API and Swift SDK with about 1,475 versions including the NIV, but the whole platform is non-commercial: a paywall, ads or a paid tier revokes access (https://platform.youversion.com/terms, verify). Text is served from their API; confirm whether the SDK allows on-device caching (verify). Unmonetized beta only; it must come out before v1 pricing goes live.

One catch on both partner doors: Biblica's page limits its no-charge non-commercial route through ministry partners to apps with no monetization and no artificial intelligence or machine learning features (verify). Our notes are an AI feature, so even a free NIV beta may need Biblica's written answer first.

Steps and timeline:

1. Build and ship v1 on BSB.
2. In launch week, write a one-page product description: what the app does, why the ticker and AI notes are new, how the NIV would be streamed, pricing, screenshots. State that NIV verse text goes to our AI vendor as model input for notes and that chips show NIV snippets of up to 110 characters; ask for both uses to be named in the grant. If the license excludes AI input, notes keep reading BSB and the cache key's `translation` stays `bsb`.
3. Submit Biblica's Permission Request Form the week v1 is live; file the HarperCollins form if the response points there.
4. Biblica asks for a minimum of 15 business days for initial review, 15 or more for a permission letter, and about four to six weeks for a full license agreement (verify); HarperCollins averages six to eight weeks. Then negotiation over royalty, territory, streaming terms, AI input and audit rights. Our estimate, not Biblica's: three to five months to signature, the review window plus one or two negotiation rounds.
5. On signature, set the NIV `translations[]` entry to `delivery: "streamed"`, point the text client at the licensed backend, set `copyrightNotice` to the contract's exact text, ship the toggle.

Notice line, standard form:

> Scripture quotations taken from The Holy Bible, New International Version®, NIV®. Copyright © 1973, 1978, 1984, 2011 by Biblica, Inc.™ Used by permission. All rights reserved worldwide.

Source: https://www.biblica.com/resources/bible-faqs/do-i-have-to-notify-biblica-to-use-a-bible-verse-from-the-niv/ . Verify: the license will dictate wording, trademark symbols, and whether the last sentence is required. Use the contract's text, not this draft.

## Berean Standard Bible

Dedicated to the public domain on April 30, 2023 under CC0. Free and commercial use, offline bundling and adaptation are all permitted. Source: https://berean.bible/terms.htm .

Attribution is appreciated, not required. Use this line in Settings > About and in `Translation.copyrightNotice`:

> The Holy Bible, Berean Standard Bible, BSB is produced in cooperation with Bible Hub, Discovery Bible, OpenBible.com, and the Berean Bible Translation Committee. This text of God's Word has been dedicated to the public domain.

Why it is the right placeholder: a modern English translation released in 2020 (verify) and placed in the public domain in 2023, in a register close to the NIV (readable, moderately literal), so snippets, AI notes and the reading feel will carry over when the NIV drops in. The KJV or ASV are also free, but their register would make the prototype feel like a different product. The BSB source has no section headings, which the spec records as `headings: false`.

## OpenBible.info cross references

About 340,000 references, built mainly from the public-domain Treasury of Scripture Knowledge plus other sources, with crowd votes per link, licensed under a Creative Commons Attribution license. Source: https://www.openbible.info/labs/cross-references/ . The dataset file header says "CC-BY" and the page snippet says only "Creative Commons Attribution License", so the data model says "CC-BY" without a version until you confirm it.

Our copy is the 2016-02-01 dump via the `2024` branch of https://github.com/scrollmapper/bible_databases (see `tools/sources.py`). The repo's scripts are MIT; the two data files keep their own terms (BSB public domain, OpenBible CC-BY). File header: "www.openbible.info CC-BY 2016-02-01".

Render in Settings > About:

> Cross references from OpenBible.info (https://www.openbible.info/labs/cross-references/), used under a Creative Commons Attribution license. License: https://creativecommons.org/licenses/by/4.0/ . Dataset dated 2016-02-01. Vote counts reflect OpenBible.info user voting. Ranking and range handling are our own.

Swap the license link once the version is confirmed. The last sentence matters: CC-BY asks us to say we changed the data, and we did (4 range ends clamped to BSB verse numbering, 1 edge dropped, our own ranking). Set `manifest.sources[].attribution` to the same text so the manifest, About screen and `attribution.md` agree.

v2 upgrade: https://github.com/CrossReferences-org/bible-cross-references offers the TSK set with phrase-level anchors for KJV and BSB, JSON and TSV, CC BY 4.0. Phrase anchors let the ticker highlight the words a reference hangs on. The maintainers describe it as curated TSK with cleanup releases, so it is not verbatim (edit share: verify in the repo changelog) and enters the model as a second `sourceId`. Attribution: "Cross-reference data from CrossReferences.org (https://crossreferences.org), CC BY 4.0."

## AI-generated content

Disclose three things wherever a note appears, not only in About: an AI wrote it, it is not scripture or part of the Bible text, and it can be wrong. The spec already carries the long form in `provenance.disclaimer`. Show a short label ("AI study note") on the chip and the long form on tap.

The provenance block covers what a reviewer or reader could ask: `generator`, `model`, `promptId`, `promptVersion`, `schemaVersion`, `inputs`, `inputHash`, `generatedAt`, `backendJob`, `tokens`, `reviewed`, `disclaimer`. `reviewed: false` is the honest default. Amend DATA_MODEL.md 2.11 to add `reportCount` (int) and `hidden` (bool) to AIVerseContext and AIConnection before the pipeline emits `ai/` shards; the iOS plan's Report action writes to them so the app can hide a flagged note and the backend can regenerate it.

Ownership: the US Copyright Office's January 2025 report says prompts alone do not produce a copyrightable work; protection attaches only to human-authored expression, selection or edits (https://www.copyright.gov/newsnet/2025/1060.html, verify). Our rights in raw output come from the API provider's terms: contract, not copyright. Do not claim copyright in unedited notes; `reviewed: true` notes with human edits are the ones we can assert rights in.

App Store: Apple's November 13, 2025 update requires disclosure and consent before personal data goes to third-party AI (guideline 5.1.2(i), verify). Our backend sends verse ids and Bible text, not personal data, so exposure is small; if readers can later type their own questions, add a consent screen that names our AI provider (Anthropic), lists exactly what is sent, and can be revoked in Settings. If the backend ever logs reading history against a device token, treat it as personal data and show that screen from launch. Religious commentary is allowed, but guideline 1.1 covers inflammatory content about a religion, and reviewers expect a way to report bad content. A report button on every note plus "notes are AI-generated" in the app description is cheap insurance. Sources: https://developer.apple.com/app-store/review/guidelines/ , https://www.techrepublic.com/article/news-apple-app-review-guidelines-ai-data-sharing/ (verify).

## App Store intellectual property review (Guideline 5.2)

Guideline 5.2.1: do not use protected third-party material without permission; the submitter must own or have licensed all relevant IP. Reviewers may pause and ask for documentation. Sources: https://developer.apple.com/app-store/review/guidelines/ , https://appreviewready.com/guides/guideline-5-2-legal-rights-review/ .

Proof to prepare, attached in App Store Connect review notes:

- BSB: PDF of https://berean.bible/terms.htm with the dedication highlighted.
- OpenBible.info: PDF of the labs page showing the CC-BY notice, plus the file header line.
- NIV, later: the signed license, commercial terms redacted, and the licensor's contact.
- AI notes: one sentence stating they are generated by our backend under the provider's terms, which assign output rights to us, and that we take responsibility for them.

Also prepare a review-notes paragraph naming every source and license, and a screenshot of the About screen. Do not put "NIV" in the title, subtitle or keywords until the license is signed; that is a 5.2.1 metadata problem on its own.

## Checklist for the founder

1. Confirm the "verify" items on biblica.com/permissions: text-in-app streaming wording, no-development-licenses rule, legal-entity rule, AI exclusion on the non-commercial path, notice wording, US/Canada contact.
2. Save PDFs of berean.bible/terms.htm and the OpenBible.info labs page into `docs/licenses/`.
3. Confirm the CC-BY version for OpenBible.info; set `manifest.sources[].license` and `.attribution` to match the About text.
4. Approve the About screen text: BSB notice, OpenBible attribution with the license link and change note, AI disclosure.
5. Amend DATA_MODEL.md before v1: `delivery` on Translation with the NIV entry set to `streamed`, and `reportCount` plus `hidden` on AI notes.
6. Form or confirm the legal entity and gather formation documents before the Biblica submission.
7. Ship v1 on BSB with no NIV mention in metadata.
8. Write the one-page product description for Biblica during launch week, naming AI input and chip snippets as uses.
9. Submit the Biblica Permission Request Form the week v1 is live; follow up after 15 business days.
10. If routed to HarperCollins Christian, file their online form the same day.
11. On signature, put the contract's notice into `Translation.copyrightNotice`, set the NIV entry to streamed delivery, resubmit with the license in review notes.
12. Reserve a `sourceId` for the CrossReferences.org set and schedule it for v2.
