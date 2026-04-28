# Privacy Policy — Alt Cloud Browser Extension

_Last updated: 28 April 2026_

The Alt Cloud browser extension is built and maintained by Datum Technology, Inc. as part of the [awesome-alt-clouds](https://github.com/datum-cloud/awesome-alt-clouds) project. This document describes — exhaustively — what the extension does and does not do with data.

## What the extension collects

**Nothing.**

The extension does not collect, store, transmit, or share any personal data, browsing history, page content, or telemetry. There is no analytics SDK, no remote configuration, no error reporting, no usage metrics, no user identifier, and no account.

## What the extension reads locally

To function, the extension reads the following from your browser, on-device only:

- The **hostname** of the current tab (e.g. `example.com`), to match it against the Alt Cloud directory and display the correct toolbar icon state.
- When you open the popup on a site that is not yet listed, three pieces of **page metadata**: the page title (`document.title`), Open Graph meta tags (`<meta property="og:*">`), and the favicon URL. These are used only to pre-fill the "Suggest this site" form so you don't have to type them.

None of this information is stored after the popup closes. None of it is transmitted off your device.

## What the extension stores on your device

The extension uses `chrome.storage.local` to cache one thing: a copy of the public Alt Cloud directory (`clouds.json`), refreshed at most once per day or on manual request. This cache contains no information about you.

## Network requests

The extension makes exactly two kinds of outbound requests, both of which you can verify in your browser's network inspector:

1. **Fetching the directory** at `https://www.alt-cloud.org/clouds.json`, no more than once every 24 hours (or on manual refresh from the popup). This request contains no information about you beyond what your browser sends with any HTTP request.
2. **Opening a GitHub issue URL** in a new tab, only when you explicitly click "Suggest this site" or "Report a correction." This is a normal navigation in your browser; the extension does not submit anything on your behalf.

That's the entire network footprint.

## What the extension does not do

For the avoidance of doubt, the extension does not:

- Track which sites you visit
- Read or transmit the content of any page
- Use cookies, fingerprinting, or any form of user identification
- Send analytics or telemetry to Datum, Anthropic, Google, or anyone else
- Sell, transfer, or share any data with third parties
- Use any data for advertising, profiling, creditworthiness, or lending
- Load remote JavaScript, Wasm, or executable code

## Permissions, explained

Chrome requires the extension to declare the following permissions:

- **`activeTab`** — Read the URL hostname of the active tab when you click the extension icon.
- **`tabs`** — Detect URL changes so the toolbar icon stays in sync as you browse.
- **`storage`** — Cache the public directory locally.
- **`scripting`** — Read three meta tags from the active tab when you open the popup on an unlisted site, to pre-fill the suggestion form.
- **Host permissions** (`<all_urls>`) — Required because the extension must check the current page's hostname against the directory on every site you visit. Only the hostname is matched; page content is not accessed except as described under `scripting`.

## Open source

The extension's complete source code is available at [github.com/datum-cloud/awesome-alt-clouds-browser-extension](https://github.com/datum-cloud/awesome-alt-clouds-browser-extension) under the CC0-1.0 license. If anything in this policy doesn't match the code, the code is the bug — please open an issue.

## Contact

Questions, concerns, or corrections: open an issue at [github.com/datum-cloud/awesome-alt-clouds-browser-extension/issues](https://github.com/datum-cloud/awesome-alt-clouds-browser-extension/issues), or email privacy@datum.net.

## Changes

If this policy ever changes in a way that affects what the extension collects or transmits, the change will be announced in the extension's changelog and reflected in the next published version. The current version of this policy is always the one in the `main` branch of the source repository.
