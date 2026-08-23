import { BROWSER_MSG_SOURCE } from './browser-msg.ts'

/**
 * Runs inside the preview iframe via the existing `eval` channel.
 * Works even when the host process is still serving an older inspect script
 * that does not know `probe` / `net` / `app` / `css` / `files`.
 */
export const BROWSER_DUMP_EVAL = `(function () {
  var SOURCE = ${JSON.stringify(BROWSER_MSG_SOURCE)};
  function post(payload) {
    payload.source = SOURCE;
    try { parent.postMessage(payload, '*'); } catch (e) {}
  }
  function clipUrl(u) {
    u = String(u || '');
    if (u.length > 1500) u = u.slice(0, 1500);
    return u;
  }
  function kindFrom(t, url) {
    t = String(t || '').toLowerCase();
    if (t === 'xmlhttprequest' || t === 'xhr') return 'xhr';
    if (t === 'fetch') return 'fetch';
    if (t === 'script') return 'script';
    if (t === 'link' || t === 'css' || t === 'stylesheet') return 'stylesheet';
    if (t === 'img' || t === 'image' || t === 'icon' || t === 'cssimage') return 'image';
    if (t === 'font') return 'font';
    if (t === 'video' || t === 'audio' || t === 'media') return 'media';
    if (t === 'websocket') return 'websocket';
    if (t === 'navigation' || t === 'iframe' || t === 'document') return 'document';
    var path = String(url || '').split('?')[0].toLowerCase();
    if (/\\.(m?js|cjs)(\\.map)?$/.test(path)) return 'script';
    if (/\\.css$/.test(path)) return 'stylesheet';
    if (/\\.(png|jpe?g|gif|svg|webp|ico|avif|bmp)$/.test(path)) return 'image';
    if (/\\.(woff2?|ttf|otf|eot)$/.test(path)) return 'font';
    if (/\\.(mp4|webm|mp3|wav|ogg)$/.test(path)) return 'media';
    return 'other';
  }
  function pageUrl() {
    var base = document.querySelector('base');
    if (base && base.href) return base.href;
    try {
      var u = new URL(location.href);
      var orig = u.searchParams.get('u');
      if (orig) return orig;
    } catch (e) {}
    return location.href;
  }
  function rowsFromStorage(store) {
    var rows = [];
    if (!store) return rows;
    var n = 0;
    try { n = store.length; } catch (e) { return rows; }
    for (var i = 0; i < n && rows.length < 80; i++) {
      var key = '';
      try { key = store.key(i) || ''; } catch (e2) { continue; }
      var val = '';
      var truncated = false;
      try {
        val = String(store.getItem(key) || '');
        if (val.length > 500) { val = val.slice(0, 500); truncated = true; }
      } catch (e3) {}
      rows.push({ name: String(key), value: val, truncated: truncated });
    }
    return rows;
  }
  function parseCookies() {
    var rows = [];
    var raw = '';
    try { raw = document.cookie || ''; } catch (e) { return rows; }
    var parts = raw.split(';');
    for (var i = 0; i < parts.length && rows.length < 80; i++) {
      var p = String(parts[i] || '').replace(/^\\s+/, '');
      if (!p) continue;
      var eq = p.indexOf('=');
      var name = eq === -1 ? p : p.slice(0, eq);
      var value = eq === -1 ? '' : p.slice(eq + 1);
      var truncated = false;
      if (value.length > 500) { value = value.slice(0, 500); truncated = true; }
      if (name) rows.push({ name: name, value: value, truncated: truncated });
    }
    return rows;
  }
  function dumpApp() {
    var payload = { type: 'app', cookies: parseCookies(), localStorage: [], sessionStorage: [], databases: [] };
    try { payload.localStorage = rowsFromStorage(window.localStorage); } catch (e) {}
    try { payload.sessionStorage = rowsFromStorage(window.sessionStorage); } catch (e2) {}
    try {
      if (window.indexedDB && indexedDB.databases) {
        indexedDB.databases().then(function (list) {
          var dbs = [];
          if (list) {
            for (var i = 0; i < list.length && dbs.length < 80; i++) {
              var n = list[i] && list[i].name;
              if (n) dbs.push(String(n));
            }
          }
          payload.databases = dbs;
          post(payload);
        }).catch(function () { post(payload); });
        return;
      }
    } catch (e3) {}
    post(payload);
  }
  function dumpCss() {
    var sheets = [];
    var vars = [];
    try {
      var list = document.styleSheets;
      for (var i = 0; i < list.length && sheets.length < 80; i++) {
        var s = list[i];
        var href = '', title = '', disabled = false, ruleCount = null, blocked = false;
        try { href = s.href || ''; } catch (e) {}
        try { title = s.title || ''; } catch (e2) {}
        try { disabled = !!s.disabled; } catch (e3) {}
        try {
          var rules = s.cssRules || s.rules;
          ruleCount = rules ? rules.length : 0;
        } catch (e4) { blocked = true; }
        sheets.push({ href: clipUrl(href), title: title, disabled: disabled, ruleCount: ruleCount, blocked: blocked });
      }
    } catch (e5) {}
    try {
      var root = document.documentElement;
      if (root && window.getComputedStyle) {
        var cs = window.getComputedStyle(root);
        for (var j = 0; j < cs.length && vars.length < 80; j++) {
          var name = cs[j];
          if (name && name.indexOf('--') === 0) {
            vars.push({ name: name, value: String(cs.getPropertyValue(name) || '').slice(0, 300) });
          }
        }
      }
    } catch (e6) {}
    post({ type: 'css', sheets: sheets, vars: vars });
  }
  function dumpFiles() {
    var out = [];
    var seen = {};
    function add(url, kind, size, duration) {
      url = clipUrl(url);
      if (!url || seen[url]) return;
      seen[url] = 1;
      out.push({ url: url, kind: kind, size: size || 0, durationMs: duration || 0 });
    }
    add(pageUrl(), 'document', 0, 0);
    try {
      var scripts = document.scripts;
      for (var i = 0; i < scripts.length; i++) {
        if (scripts[i].src) add(scripts[i].src, 'script', 0, 0);
      }
    } catch (e) {}
    try {
      var links = document.querySelectorAll('link[rel~="stylesheet"],link[rel="preload"][as="style"]');
      for (var li = 0; li < links.length; li++) {
        if (links[li].href) add(links[li].href, 'stylesheet', 0, 0);
      }
    } catch (e2) {}
    try {
      var imgs = document.images;
      for (var im = 0; im < imgs.length; im++) {
        if (imgs[im].currentSrc || imgs[im].src) add(imgs[im].currentSrc || imgs[im].src, 'image', 0, 0);
      }
    } catch (e3) {}
    try {
      var entries = performance.getEntriesByType('resource');
      for (var p = 0; p < entries.length && out.length < 200; p++) {
        var en = entries[p];
        var size = 0;
        try { size = Math.round(en.transferSize || en.encodedBodySize || 0); } catch (e4) {}
        add(en.name, kindFrom(en.initiatorType, en.name), size, Math.round(en.duration || 0));
      }
    } catch (e5) {}
    post({ type: 'files', files: out.slice(0, 200) });
  }
  function dumpNet() {
    var batch = [];
    try {
      var entries = performance.getEntriesByType('resource');
      for (var i = 0; i < entries.length && batch.length < 200; i++) {
        var en = entries[i];
        var url = clipUrl(en.name);
        if (!url) continue;
        var kind = kindFrom(en.initiatorType, url);
        var status = 0, size = 0;
        try { status = en.responseStatus || 0; } catch (e) {}
        try { size = Math.round(en.transferSize || en.encodedBodySize || 0); } catch (e2) {}
        batch.push({
          id: 1000000 + i,
          method: kind === 'xhr' || kind === 'fetch' ? 'GET' : 'GET',
          url: url,
          resourceType: kind,
          status: status,
          durationMs: Math.round(en.duration || 0),
          size: size,
          pending: false,
          failed: false,
          startAt: Date.now(),
        });
      }
    } catch (e3) {}
    if (batch.length) post({ type: 'net', entries: batch });
  }
  dumpApp();
  dumpCss();
  dumpFiles();
  if (window.__DSH_NET_HOOKS__) return 'ok';
  window.__DSH_NET_HOOKS__ = true;
  dumpNet();
  var netSeq = 2000000;
  function postNet(entry) { post({ type: 'net', entries: [entry] }); }
  try {
    if (!XMLHttpRequest.prototype.open.__dshNet) {
      var XO = XMLHttpRequest.prototype.open;
      var XS = XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.open = function (method, url) {
        this.__dsh = { method: String(method || 'GET').toUpperCase(), url: clipUrl(url), start: Date.now() };
        return XO.apply(this, arguments);
      };
      XMLHttpRequest.prototype.open.__dshNet = true;
      XMLHttpRequest.prototype.send = function () {
        var self = this;
        var meta = self.__dsh || { method: 'GET', url: '', start: Date.now() };
        var id = ++netSeq;
        postNet({ id: id, method: meta.method, url: meta.url, resourceType: 'xhr', status: 0, durationMs: 0, size: 0, pending: true, failed: false, startAt: meta.start });
        self.addEventListener('loadend', function () {
          postNet({
            id: id, method: meta.method, url: clipUrl(self.responseURL || meta.url), resourceType: 'xhr',
            status: self.status || 0, durationMs: Date.now() - meta.start, size: 0, pending: false,
            failed: self.status === 0, startAt: meta.start,
          });
        });
        return XS.apply(this, arguments);
      };
    }
  } catch (xhrErr) {}
  try {
    if (typeof window.fetch === 'function' && !window.fetch.__dshNet) {
      var origFetch = window.fetch.bind(window);
      window.fetch = function (input, init) {
        var method = 'GET', url = '';
        try {
          if (typeof input === 'string') url = input;
          else if (input && input.url) url = input.url;
          if (init && init.method) method = String(init.method);
          else if (input && input.method) method = String(input.method);
        } catch (e) {}
        method = String(method || 'GET').toUpperCase();
        url = clipUrl(url);
        var id = ++netSeq;
        var start = Date.now();
        postNet({ id: id, method: method, url: url, resourceType: 'fetch', status: 0, durationMs: 0, size: 0, pending: true, failed: false, startAt: start });
        return origFetch.apply(this, arguments).then(function (res) {
          postNet({
            id: id, method: method, url: clipUrl((res && res.url) || url), resourceType: 'fetch',
            status: (res && res.status) || 0, durationMs: Date.now() - start, size: 0, pending: false, failed: false, startAt: start,
          });
          return res;
        }, function (err) {
          postNet({ id: id, method: method, url: url, resourceType: 'fetch', status: 0, durationMs: Date.now() - start, size: 0, pending: false, failed: true, startAt: start });
          throw err;
        });
      };
      window.fetch.__dshNet = true;
    }
  } catch (fetchErr) {}
  return 'ok';
})()`
