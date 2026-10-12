# Streamline website

Source for the official website of **Streamline**, a native IPTV player for iPhone, iPad, and Mac.

**Live site:** https://maweis1981.github.io/streamline-site/ (English: `/en/`)

It's a Jekyll site with Simplified Chinese (default) and English pages: home, roadmap, support, and privacy policy. The support and privacy pages serve as the App Store Connect *Support URL* and *Privacy Policy URL*.

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

The GTM container `GTM-MJDCLXML` is set in `_config.yml`. GA4 should be configured inside that container. A `GTM_ID` repository variable, if set, overrides it.

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

Every page also pushes `page_language` and `page_section`, and GA4 receives `content_group` = page section. Register `target`, `location`, and `page_section` as GA4 custom dimensions, and mark `cta_click` with `target = app_store` as a key event. Set GA4 data retention to **14 months** to match the privacy policy.

To track another element, add `data-track="event_name"` plus `data-track-<param>="value"` attributes.

## Editing content

- Copy for both languages: `_data/locales/zh.yml` and `en.yml` (features, roadmap, FAQ, buttons). Keep the two files structurally identical, and update `roadmap.updated_date` when the roadmap changes.
- Privacy policy: `privacy/index.md` and `en/privacy/index.md`.
- Styles: `assets/css/main.css`. Tracking, consent, and mobile nav: `assets/js/main.js`.

## Local preview

```sh
bundle install
bundle exec jekyll serve --baseurl ""
# open http://localhost:4000
```

## Custom domain

Add the domain under Settings → Pages → Custom domain, then in `_config.yml` set `url` to `https://your-domain` and `baseurl` to `""`.
