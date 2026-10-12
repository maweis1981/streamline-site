(function () {
  'use strict';

  var analytics = window.SL_ANALYTICS || null;
  window.dataLayer = window.dataLayer || [];

  // GTM picks up the dataLayer event; GA4 (when loaded directly) gets a gtag event.
  function track(name, params) {
    params = params || {};
    if (!analytics) return;
    var payload = { event: name };
    for (var key in params) payload[key] = params[key];
    window.dataLayer.push(payload);
    if (analytics.ga && typeof window.gtag === 'function') window.gtag('event', name, params);
  }
  window.slTrack = track;

  // Elements opt in with data-track="event_name" and data-track-* parameters.
  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-track]');
    if (!el) return;
    var params = {};
    for (var key in el.dataset) {
      if (key.indexOf('track') === 0 && key !== 'track') {
        var param = key.slice(5).replace(/[A-Z]/g, function (c) { return '_' + c.toLowerCase(); }).replace(/^_/, '');
        params[param] = el.dataset[key];
      }
    }
    if (el.href) params.link_url = el.href;
    track(el.dataset.track, params);
  });

  document.querySelectorAll('details[data-track-faq]').forEach(function (d) {
    d.addEventListener('toggle', function () {
      if (!d.open) return;
      var summary = d.querySelector('summary');
      track('faq_open', { faq_index: d.dataset.trackFaq, faq_question: summary ? summary.textContent.trim() : '' });
    });
  });

  // Mobile navigation
  var toggle = document.querySelector('.nav-toggle');
  var nav = document.getElementById('site-nav');
  if (toggle && nav) {
    toggle.addEventListener('click', function () {
      var open = nav.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', String(open));
    });
    nav.addEventListener('click', function (e) {
      if (e.target.closest('a')) {
        nav.classList.remove('is-open');
        toggle.setAttribute('aria-expanded', 'false');
      }
    });
  }

  // Consent banner (only rendered when analytics is configured)
  var banner = document.getElementById('consent');
  if (!banner || !analytics) return;

  var STORAGE_KEY = 'sl-consent';
  function readChoice() {
    try { return localStorage.getItem(STORAGE_KEY); } catch (e) { return null; }
  }
  function saveChoice(choice) {
    try { localStorage.setItem(STORAGE_KEY, choice); } catch (e) {}
    if (typeof window.gtag === 'function') window.gtag('consent', 'update', { analytics_storage: choice });
    window.dataLayer.push({ event: 'consent_update', analytics_consent: choice });
    banner.hidden = true;
  }

  if (!readChoice()) banner.hidden = false;
  banner.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-consent]');
    if (btn) saveChoice(btn.getAttribute('data-consent'));
  });

  document.querySelectorAll('[data-consent-open]').forEach(function (btn) {
    btn.hidden = false;
    btn.addEventListener('click', function () { banner.hidden = false; });
  });
})();
