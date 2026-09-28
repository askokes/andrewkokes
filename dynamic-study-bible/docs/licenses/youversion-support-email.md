# Draft: email to YouVersion Platform Support

Send after you have registered the app and accepted the NIV (version 111) license, so you can fill in the app key and date. Save their reply, dated, in this folder. The questions match "Questions for YouVersion Platform Support" in `docs/LICENSING.md`, reordered so the one that blocks the build comes first.

---

Subject: Free iPhone study Bible on the NIV (version 111): a few questions before I build

Hi YouVersion Platform team,

I'm building Dynamic Study Bible, a free iPhone app on your Swift SDK. It's registered as non-commercial (app key [from the portal]) and I accepted the NIV license on [date]. No ads, purchases, subscriptions or accounts, now or later.

How it works: you read a chapter in the NIV. As you scroll, a strip under the text shows up to 12 cross references for the verse you're on, each labelled as a direct quote, the same story or the same topic. Tap one to read the whole verse, tap Go to jump there. The cross references are verse ids from OpenBible.info. I never store, index or copy NIV text. The SDK does all the caching. The labels come from fixed rules run over the public-domain Berean Standard Bible, not the NIV, and no AI is involved.

A few questions so I build this the right way:

1. Partial verses. Can each item in the strip show the first few words of the connected verse in the NIV, up to 12 at a time, with the whole verse on tap? If not, I'll show the reference only.
2. Display limits. How much NIV text can be on screen at once? The reader shows one chapter, plus one tapped verse in a pop-up sheet.
3. Volume. Each chapter read is one call, and each tapped verse is one more since a request can't span chapters. If the strip can show NIV words, moving to a new verse could add up to 12 chapter calls, with repeats served from the SDK cache. Is that acceptable, and are there rate limits?
4. Cross references. Is it fine to ship cross references as verse ids next to NIV text from the SDK?
5. Caching. Is the SDK cache the only one allowed? Any plans for offline NIV?
6. Countries. Is version 111 licensed worldwide? I plan to launch in the US first.
7. Privacy. The SDK sends an installation id with each request. Do you keep it? Your answer decides how I fill in Apple's privacy label.
8. Credit. Is "NIV" plus the copyright string from the API enough, or should I credit YouVersion as well?
9. AI, later. I may add AI-written study notes generated only from the public-domain BSB, never from the NIV. What does your written approval involve and how long does it take? Nothing AI ships until I hear from you.

Thanks. Happy to share a TestFlight build whenever it's useful.

Andrew Kokes
[email] | [phone]
