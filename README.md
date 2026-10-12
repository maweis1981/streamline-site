# Doubo (都播) website

Source for the official website of **Doubo (都播)**, a native IPTV player for iPhone, iPad, and Mac.

**Live site:** https://doubo.tv/ — 简体中文 (`/`), English (`/en/`), Bahasa Melayu (`/ms/`), Bahasa Indonesia (`/id/`), Tiếng Việt (`/vi/`), ไทย (`/th/`)

It's a Jekyll site in six languages (Simplified Chinese by default, plus English, Malay, Indonesian, Vietnamese, and Thai): home, guide, roadmap, support, and privacy policy. The support and privacy pages serve as the App Store Connect *Support URL* and *Privacy Policy URL*.

## Deployment

Every push to `main` runs `.github/workflows/deploy.yml`, which builds the site and publishes it to the `gh-pages` branch. GitHub Pages serves that branch (Settings → Pages → *Deploy from a branch* → `gh-pages` / `/ (root)`). Pull requests only build the site.

### Repository variables (all optional)

Set these under Settings → Secrets and variables → Actions → **Variables**:

| Variable | Example | Effect |
|---|---|---|
| `GTM_ID` | `GTM-ABC1234` | Loads Google Tag Manager |
| `GA_MEASUREMENT_ID` | `G-ABCDE12345` | Loads GA4 directly through gtag.js |
| `APP_STORE_URL` | `https://apps.apple.com/app/id6821588266` | Download buttons link to the App Store |
| `TESTFLIGHT_URL` | `https://testflight.apple.com/join/…` | Used when there's no App Store URL yet |
| `SUPPORT_EMAIL` | `support@example.com` | Shows an email card on the Support page |

After changing a variable, re-run the workflow from the Actions tab.

## Analytics

The GTM container `GTM-MJDCLXML` is set in `_config.yml`, and GA4 (`G-3TGF00MYWL`) runs inside that container. `analytics/gtm-container-doubo.json` is an importable GTM container (Admin → Import Container → Merge) with the GA4 Google tag, event tags for the events below, their triggers, and Data Layer Variables. Keep `ga_measurement_id` empty so GA4 isn't loaded twice. A `GTM_ID` repository variable, if set, overrides the container ID.

Analytics tags only render in production builds when an ID is set, so local previews never send data.

**Avoid double counting:** use GTM only (set `GTM_ID`, and add a GA4 *Google tag* inside GTM), *or* set `GA_MEASUREMENT_ID` and don't add a GA4 tag for the same ID in GTM.

**Consent Mode v2** is configured before any tag loads. Ad storage is always denied. With `analytics.consent: eea` (the default in `_config.yml`), analytics starts denied in the EEA, UK, and Switzerland and granted elsewhere; set it to `strict` to require opt-in everywhere. A banner stores the visitor's choice in `localStorage` (`sl-consent`), and the footer's "Cookie settings" link reopens it.

**Events pushed to `dataLayer`** (also sent with `gtag('event')` when GA4 is loaded directly):

| Event | Parameters | When |
|---|---|---|
| `cta_click` | `target` (`app_store`, `testflight`, `roadmap`, `github_issues`, `feature_request`, `email`, `download_anchor`), `location`, `link_url` | CTA clicks |
| `language_switch` | `to` (`zh` or `en`), `link_url` | Language toggle |
| `faq_open` | `faq_index`, `faq_question` | An FAQ item is expanded |
| `consent_update` | `analytics_consent` | The visitor accepts or declines |
| `playlist_copy` | `scope` (`all`, `country`, `category`, `language`, `channel_country`), `link_url` | A playlist link is copied in the channel directory |
| `web_play` | `channel_group`, `source` (`free` or `own`) | A channel is opened in the web player |
| `web_play_unavailable` | — | No route of the opened channel plays in the browser (the app is suggested) |
| `web_playlist_add` | `source` (`url`, `file`, `text`), `channels` | A playlist is added in the web player |
| `tool_m3u_analyze` | `entries` | A playlist is analyzed in the M3U tool |
| `tool_m3u_download` | `entries` | A cleaned playlist is downloaded from the M3U tool |

Every page also pushes `page_language` and `page_section`, and GA4 receives `content_group` = page section. Register `target`, `location`, and `page_section` as GA4 custom dimensions, and mark `cta_click` with `target = app_store` and `web_play` as key events. Set GA4 data retention to **14 months** to match the privacy policy.

To track another element, add `data-track="event_name"` plus `data-track-<param>="value"` attributes.

## Editing content

- Copy: one file per language in `_data/locales/` (features, roadmap, FAQ, buttons). Keep them structurally identical, and update `roadmap.updated_date` in each when the roadmap changes.
- Privacy policy: `privacy/index.md` (zh) and `<lang>/privacy/index.md`. Translations state that the English version prevails.
- Adding a language: add its code to `languages` in `_config.yml`, create `_data/locales/<code>.yml`, and copy the page stubs from an existing language folder (`index.html`, `roadmap/`, `support/`, `privacy/`), changing `lang`.
- Styles: `assets/css/main.css`. Tracking, consent, and mobile nav: `assets/js/main.js`.

## Local preview

```sh
bundle install
bundle exec jekyll serve --baseurl ""
# open http://localhost:4000
```

## Custom domain

The site is served at `doubo.tv`. The `CNAME` file in this repo is copied into every build, so the domain survives each deploy to `gh-pages`, and `_config.yml` has `url: "https://doubo.tv"` and `baseurl: ""`.

DNS records at the domain registrar:

| Type | Host | Value |
|---|---|---|
| A | `@` | `185.199.108.153` |
| A | `@` | `185.199.109.153` |
| A | `@` | `185.199.110.153` |
| A | `@` | `185.199.111.153` |
| AAAA | `@` | `2606:50c0:8000::153` |
| AAAA | `@` | `2606:50c0:8001::153` |
| AAAA | `@` | `2606:50c0:8002::153` |
| AAAA | `@` | `2606:50c0:8003::153` |
| CNAME | `www` | `maweis1981.github.io` |

Once DNS resolves, check **Enforce HTTPS** under Settings → Pages. To prevent domain takeover, verify `doubo.tv` under your GitHub account's Settings → Pages → *Verified domains*.

To move to a different domain, update `CNAME` and `url`. To go back to `maweis1981.github.io/streamline-site/`, delete `CNAME` and set `baseurl: "/streamline-site"`.

## Web player and tools

`/web/` (and `/<lang>/web/`) is a browser version of Doubo; `/tools/m3u/` is a free M3U analyzer and cleaner. Both are built from `web-app/` (TypeScript + Vite, with hls.js bundled, so there are no external CDNs).

- `web-app/src/model.ts` holds the domain model (playlist, channel, route), `m3u.ts` the parser, `preview.ts` the muted preview wall, `player.ts` playback, `main.ts` the web player and `tool.ts` the analyzer.
- The web player opens on a wall of free channels from the directory. Only tiles on screen play, muted, a few at a time; clicking one opens it with sound and stops the rest. Channels that cannot play in a browser are never shown:
  - `scripts/web_playable.py` runs at deploy time, checks every directory stream the way a browser on doubo.tv would (HTTPS, CORS on playlist and segment, no HEVC, real media) and writes `web/playable.json` with FNV-1a hashes of the playable URLs, so the site itself carries no stream links;
  - routes a browser cannot open (http on an https page, custom headers) are filtered out;
  - a tile whose preview does not start is removed and remembered for 12 hours.
- Visitors can add their own playlists (link, file or paste); they are stored in the browser (IndexedDB) and never uploaded.
- UI strings live in the `web:` and `tools:` blocks of each `_data/locales/<lang>.yml` and reach the scripts as `window.DOUBO_WEB`.
- Directory country pages link to `/web/?country=<code>`.

The deploy workflow runs `npm ci`, `npm test` and `npm run build` in `web-app/` before Jekyll, writing `assets/web/`. Locally:

```sh
cd web-app && npm install && npm test && npm run build && cd ..
bundle exec jekyll serve
```

## SEO

- Every language has its own URL, with `hreflang` alternates, a canonical link, and sitemap entries (`sitemap.xml`, `robots.txt`).
- Titles and descriptions target local search terms ("IPTV / M3U player" plus device names) in each language.
- JSON-LD (`_includes/structured-data.html`): WebSite, SoftwareApplication, and FAQPage on the home page; BreadcrumbList on inner pages; FAQPage on Support; HowTo on the Guide.
- Share card: `assets/img/og-card.png` (1200×630, `summary_large_image`).
- `llms.txt` summarizes the product and links for AI search engines.
- `app_store_id` in `_config.yml` turns on Safari's smart app banner once the app is live.
- After deploying, submit `https://doubo.tv/sitemap.xml` in Google Search Console and Bing Webmaster Tools.
