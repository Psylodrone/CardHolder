const STORAGE_KEY = "cardholder.cards";

const FORMAT_MAP = {
  EAN_13: "EAN13",
  EAN_8: "EAN8",
  UPC_A: "UPC",
  UPC_E: "UPCE",
  CODE_128: "CODE128",
  CODE_39: "CODE39",
  CODABAR: "codabar",
  ITF: "ITF",
};

// Guess a likely format from the code so the picker starts on a sane default
function guessFormat(code) {
  if (/^\d{13}$/.test(code)) return "EAN_13";
  if (/^\d{12}$/.test(code)) return "UPC_A";
  if (/^\d{8}$/.test(code)) return "EAN_8";
  return "CODE_128";
}

const views = ["view-home", "view-scan", "view-detail", "view-edit"];
const headerTitle = document.getElementById("header-title");
const backBtn = document.getElementById("back-btn");
const addBtn = document.getElementById("add-btn");
const readerEl = document.getElementById("reader");
const scanResultEl = document.getElementById("scan-result");
const cardNameInput = document.getElementById("card-name-input");
const cardDomainInput = document.getElementById("card-domain-input");
const domainDropdown = document.getElementById("domain-dropdown");
const cardCodeInput = document.getElementById("card-code-input");
const manualBtn = document.getElementById("manual-btn");
const photoBtn = document.getElementById("photo-btn");
const photoInput = document.getElementById("photo-input");
const previewField = document.getElementById("preview-field");
const previewEl = document.getElementById("manual-preview");
const formatLabelEl = document.getElementById("format-label");

let selectedCardId = null;

function loadCards() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch {
    return [];
  }
}

function saveCards(cards) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cards));
}

function makeId() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return "id-" + Date.now() + "-" + Math.random().toString(16).slice(2);
}

function normalizeDomain(value) {
  return value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0];
}

// icon.horse parses a site's HTML for its declared icon, so it finds logos
// at non-standard paths that the conventions below miss. It's also
// CORS-enabled, which lets us read its pixels for color extraction.
function iconHorseUrl(domain) {
  return "https://icon.horse/icon/" + encodeURIComponent(domain);
}

// Logo sources, in priority order. loadBestLogo probes them all at once
// and shows the highest-priority real result. DuckDuckGo is deliberately
// NOT here: for unknown sites it serves a 48x48 generic placeholder that
// is indistinguishable from a real favicon (unlike Google's 16px globe,
// which the size check rejects), so it can mask better sources.
function logoCandidates(domain) {
  const d = encodeURIComponent(domain);
  return [
    "https://" + domain + "/apple-touch-icon.png", // site's own high-res icon
    "https://www.google.com/s2/favicons?domain=" + d + "&sz=128",
    iconHorseUrl(domain), // parses HTML for non-standard icon paths
  ];
}

function isIconHorse(src) {
  return src.indexOf("https://icon.horse/") === 0;
}

// icon.horse serves a generated gray letter tile (HTTP 200) instead of
// failing when it has no real icon — undetectable by size. It is CORS-
// readable though, so reject its results that are fully grayscale.
function looksLikeLetterTile(img) {
  try {
    const s = 16;
    const cv = document.createElement("canvas");
    cv.width = cv.height = s;
    const ctx = cv.getContext("2d");
    ctx.drawImage(img, 0, 0, s, s);
    const d = ctx.getImageData(0, 0, s, s).data;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 50) continue;
      const r = d[i], g = d[i + 1], b = d[i + 2];
      if (Math.max(Math.abs(r - g), Math.abs(r - b), Math.abs(g - b)) > 14) {
        return false; // found a colored pixel — looks like a real logo
      }
    }
    return true; // fully grayscale — assume generated placeholder
  } catch (e) {
    // Pixels unreadable (tainted canvas from a cached non-CORS response):
    // we can't rule the placeholder out, so don't trust it
    return true;
  }
}

// Probe every candidate in parallel and display the highest-priority one
// that yields a real image (decodes and is >16px, so placeholder globes
// are rejected). Falls through past a candidate as soon as it errors,
// times out, or returns a placeholder — so one blocked/hung source can't
// hold up the others. Calls onFail when nothing usable loads; if a slow
// source finishes successfully AFTER that, onLateSuccess(probe, src) lets
// the caller swap the late-arriving logo in over the fallback. onShown
// fires whenever a logo is committed, with the element and original URL.
function loadBestLogo(img, candidates, onFail, onLateSuccess, onShown) {
  const n = candidates.length;
  if (!n) {
    onFail();
    return;
  }
  const status = new Array(n).fill("pending"); // "pending" | "ok" | "fail"
  let committed = false;
  let failedAll = false;

  const probes = new Array(n);

  const decide = () => {
    if (committed) return;
    for (let k = 0; k < n; k++) {
      if (status[k] === "pending") return; // wait for a higher priority result
      if (status[k] === "ok") {
        committed = true;
        // Swap the already-decoded probe in instead of re-requesting the
        // URL — flaky hosts can fail a second fetch, leaving a broken icon
        probes[k].className = img.className;
        probes[k].alt = "";
        if (img.parentNode) img.replaceWith(probes[k]);
        if (onShown) onShown(probes[k], candidates[k]);
        return;
      }
    }
    committed = true;
    failedAll = true;
    onFail();
    // Second chance: flaky services (icon.horse 504s) can fail one moment
    // and succeed the next — re-probe once and upgrade if anything loads
    if (onLateSuccess) {
      setTimeout(() => {
        candidates.forEach((origSrc) => {
          let src = origSrc;
          const retry = new Image();
          if (isIconHorse(src)) {
            retry.crossOrigin = "anonymous";
            src = src + (src.includes("?") ? "&" : "?") + "cors=1";
          }
          retry.onload = () => {
            if (probeLooksReal(retry, src) && failedAll) {
              failedAll = false;
              onLateSuccess(retry, origSrc);
            }
          };
          retry.src = src;
        });
      }, 5000);
    }
  };

  const probeLooksReal = (probe, src) => {
    if (probe.naturalWidth <= 16) return false; // placeholder globe
    if (isIconHorse(src) && looksLikeLetterTile(probe)) return false;
    return true;
  };

  candidates.forEach((src, k) => {
    const probe = new Image();
    if (isIconHorse(src)) {
      probe.crossOrigin = "anonymous"; // enables the pixel check
      // Own cache key: a cached non-CORS copy of the same URL would load
      // tainted and make the pixel check impossible
      src = src + (src.includes("?") ? "&" : "?") + "cors=1";
    }
    probes[k] = probe;
    let settled = false;
    const mark = (s) => {
      if (settled || committed) return;
      settled = true;
      status[k] = s;
      decide();
    };
    probe.onload = () => {
      const ok = probeLooksReal(probe, src);
      // Slow networks: the timeout may have given up already — if this
      // image turns out fine, upgrade the fallback instead of wasting it
      if ((settled || committed) && ok && failedAll && onLateSuccess) {
        failedAll = false;
        onLateSuccess(probe, candidates[k]);
        return;
      }
      mark(ok ? "ok" : "fail");
    };
    probe.onerror = () => mark("fail");
    setTimeout(() => mark("fail"), 8000); // give slow hosts a real chance
    probe.src = src;
  });
}

// Last-resort automatic lookup: ask Wikidata if a brand with this exact
// official website has a registered logo (P154, hosted on Commons).
// Covers brands whose sites expose no usable icon at all.
const wdLogoCache = new Map(); // domain -> Promise<string|null>
function wikidataLogoForDomain(domain) {
  if (wdLogoCache.has(domain)) return wdLogoCache.get(domain);
  const variants = [];
  ["http://", "https://"].forEach((p) => {
    ["", "www."].forEach((w) => {
      variants.push("<" + p + w + domain + ">", "<" + p + w + domain + "/>");
    });
  });
  const q =
    "SELECT ?logo WHERE { VALUES ?site { " + variants.join(" ") + " } " +
    "?e wdt:P856 ?site . ?e wdt:P154 ?logo } LIMIT 1";
  const promise = fetch(
    "https://query.wikidata.org/sparql?format=json&query=" + encodeURIComponent(q)
  )
    .then((r) => r.json())
    .then((d) => {
      const b = d.results.bindings;
      if (!b.length) return null;
      // Commons FilePath URL; ask for a reasonably sized thumbnail
      return b[0].logo.value.replace(/^http:/, "https:") + "?width=256";
    })
    .catch(() => null);
  wdLogoCache.set(domain, promise);
  return promise;
}

// Save an auto-discovered logo on the card so future loads are instant
function persistCardLogo(id, logo) {
  const cards = loadCards();
  const card = cards.find((c) => c.id === id);
  if (card && !card.logo) {
    card.logo = logo;
    saveCards(cards);
  }
}

// Once a logo is confirmed on a card, snapshot it into a small data URL
// stored with the card — future loads need no network at all. Only
// possible when the host permits pixel access (icon.horse, Wikimedia
// Commons, picked photos); otherwise the URL keeps being used.
function snapshotToCard(cardId, probe, src) {
  if (!src || src.indexOf("data:") === 0) return;

  const save = (dataUrl) => {
    const cards = loadCards();
    const c = cards.find((x) => x.id === cardId);
    // never overwrite an existing local image
    if (c && (!c.logo || c.logo.indexOf("data:") !== 0)) {
      c.logo = dataUrl;
      saveCards(cards);
    }
  };

  const snapshot = (imgEl) => {
    const max = 128;
    const w = imgEl.naturalWidth, h = imgEl.naturalHeight;
    const scale = Math.min(1, max / Math.max(w, h));
    const cv = document.createElement("canvas");
    cv.width = Math.max(1, Math.round(w * scale));
    cv.height = Math.max(1, Math.round(h * scale));
    cv.getContext("2d").drawImage(imgEl, 0, 0, cv.width, cv.height);
    return cv.toDataURL("image/png"); // throws if the canvas is tainted
  };

  const retryWith = (url) => {
    const retry = new Image();
    retry.crossOrigin = "anonymous";
    retry.onload = () => {
      try {
        save(snapshot(retry));
      } catch (e) {
        // host doesn't permit pixel access — keep using the URL
      }
    };
    retry.src = url;
  };

  try {
    save(snapshot(probe));
  } catch (e) {
    // Probe was loaded without CORS — retry once as a CORS request.
    // Commons FilePath URLs redirect without CORS headers, so resolve
    // the direct file URL via the Commons API first.
    if (src.includes("Special:FilePath")) {
      commonsDirectUrl(src).then((u) => {
        if (u) retryWith(u);
      });
    } else {
      // own cache key so it can't collide with the non-CORS cached copy
      retryWith(src + (src.includes("?") ? "&" : "?") + "snap=1");
    }
  }
}

// Resolve a Commons Special:FilePath URL to its direct thumb URL — the
// FilePath redirect chain lacks CORS headers, so CORS loads fail on it
function commonsDirectUrl(src) {
  const m = src.match(/Special:FilePath\/([^?]+)/);
  if (!m) return Promise.resolve(null);
  const api =
    "https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*" +
    "&prop=imageinfo&iiprop=url&iiurlwidth=256&titles=File:" + m[1];
  return fetch(api)
    .then((r) => r.json())
    .then((d) => {
      const page = d.query.pages[Object.keys(d.query.pages)[0]];
      return page.imageinfo[0].thumburl || page.imageinfo[0].url;
    })
    .catch(() => null);
}

// --- Logo diagnostics (debug) ---

// Probe one URL and report exactly what happened, the way an <img> sees it
function probeLogoUrl(url) {
  return new Promise((resolve) => {
    const img = new Image();
    const t0 = Date.now();
    let done = false;
    const finish = (status) => {
      if (done) return;
      done = true;
      resolve({ url, status, ms: Date.now() - t0 });
    };
    img.onload = () =>
      finish(
        img.naturalWidth > 16
          ? "OK " + img.naturalWidth + "x" + img.naturalHeight
          : "TOO SMALL " + img.naturalWidth + "x" + img.naturalHeight + " (rejected as placeholder)"
      );
    img.onerror = () => finish("FAILED (blocked / 404 / not an image)");
    setTimeout(() => finish("TIMEOUT (no response in 6s — likely blocked or hung)"), 6000);
    img.src = url;
  });
}

async function diagnoseLogo(card) {
  const domain = card.domain;
  const labelled = [];
  if (card.logo) labelled.push(["logo override", card.logo]);
  if (domain) {
    const names = ["apple-touch-icon", "google-favicon", "icon.horse"];
    logoCandidates(domain).forEach((u, i) => labelled.push([names[i] || "source", u]));
  }

  const head = [
    "CardHolder logo debug — " +
      (document.getElementById("app-version") || {}).textContent,
    "online: " + navigator.onLine +
      "  |  serviceWorker: " +
      (navigator.serviceWorker && navigator.serviceWorker.controller ? "active" : "none"),
    "card name: " + card.name,
    "domain: " + (domain || "(none)"),
    "override: " +
      (card.logo
        ? card.logo.indexOf("data:") === 0
          ? "(local image, " + card.logo.length + " chars)"
          : card.logo
        : "(none)"),
    "candidates: " + labelled.length,
    "",
  ];

  const results = await Promise.all(
    labelled.map(([label, url]) =>
      probeLogoUrl(url).then((r) => ({ label, ...r }))
    )
  );

  const body = [];
  results.forEach((r) => {
    body.push("[" + r.label + "] " + r.status + "  (" + r.ms + "ms)");
    const shown = r.url.indexOf("data:") === 0 ? "(local image data)" : r.url;
    body.push("    " + shown);
  });

  return head.concat(body).join("\n");
}

function hslToRgb(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
  };
}

// Stable fallback brand color derived from the name
function fallbackColor(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 360;
  return hslToRgb(h, 0.55, 0.45);
}

function rgbStr(c) {
  return "rgb(" + c.r + "," + c.g + "," + c.b + ")";
}

// Pick black or white text for readability against a background color
function textColorFor(c) {
  const lum = (0.299 * c.r + 0.587 * c.g + 0.114 * c.b) / 255;
  return lum > 0.6 ? "#1c1c1e" : "#ffffff";
}

// Best-effort: read a logo's dominant color. Only works when the image
// host sends CORS headers; otherwise the canvas is tainted and we return
// null so the caller keeps the stable fallback color.
function extractLogoColor(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const size = 24;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, size, size);
        const data = ctx.getImageData(0, 0, size, size).data;
        let r = 0, g = 0, b = 0, n = 0;
        for (let i = 0; i < data.length; i += 4) {
          const alpha = data[i + 3];
          if (alpha < 200) continue; // skip transparent areas
          const cr = data[i], cg = data[i + 1], cb = data[i + 2];
          // skip near-white and near-black pixels (usually background)
          const max = Math.max(cr, cg, cb), min = Math.min(cr, cg, cb);
          if (max > 240 && min > 240) continue;
          if (max < 25) continue;
          r += cr; g += cg; b += cb; n++;
        }
        if (n === 0) return resolve(null);
        const avg = { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n) };
        // A gray result is likely a placeholder image (e.g. icon.horse's
        // letter tile), not a brand color — better to use the fallback
        const spread = Math.max(avg.r, avg.g, avg.b) - Math.min(avg.r, avg.g, avg.b);
        if (spread < 12) return resolve(null);
        resolve(avg);
      } catch (e) {
        resolve(null); // tainted canvas
      }
    };
    img.onerror = () => resolve(null);
    // Distinct cache key so this crossOrigin probe never shares a cache
    // entry with the plain <img> that displays the same logo. (Data URLs
    // are local and self-contained — never append to them.)
    img.src =
      src.indexOf("data:") === 0
        ? src
        : src + (src.includes("?") ? "&" : "?") + "ch_color=1";
  });
}

// Persist a computed color on the card so it's not recomputed each load
function persistCardColor(id, color) {
  const cards = loadCards();
  const card = cards.find((c) => c.id === id);
  if (card) {
    card.bg = color;
    saveCards(cards);
  }
}

// Read an image file and return a downscaled (max 128px) PNG data URL,
// so a user-picked logo is small enough to store in localStorage and
// displays with no network (works even when favicon services are blocked).
function fileToLogoDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const max = 128;
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        canvas.getContext("2d").drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/png"));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

const CAMERA_SVG =
  '<svg class="logo-box-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
  'stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M3 8.5A1.5 1.5 0 0 1 4.5 7H7l1.2-1.8h7.6L17 7h2.5A1.5 1.5 0 0 1 21 8.5V18a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18z"/>' +
  '<circle cx="12" cy="13" r="3.3"/></svg><span class="logo-box-plus">+</span>';

const PENCIL_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
  'stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>';

// A clickable logo box: shows a camera+ when empty, the logo when one is
// found (from a chosen image/URL or the card's domain), or a letter +
// edit badge when a domain is set but no logo loads. Clicking it calls
// openChooser. getName/getDomain are read live so it reflects the form;
// setDomain writes a domain back to the form's company field (used when
// the chooser is given a website URL rather than an image).
function createLogoBox(boxEl, getName, getDomain, setDomain, openChooser) {
  let custom = null; // user-chosen image (URL or data URL), overrides domain

  function reset(cls) {
    boxEl.className = "logo-box" + (cls ? " " + cls : "");
    boxEl.innerHTML = "";
  }

  function badge() {
    const b = document.createElement("span");
    b.className = "logo-box-edit";
    b.innerHTML = PENCIL_SVG;
    boxEl.appendChild(b);
  }

  function showEmpty() {
    reset("is-empty");
    boxEl.innerHTML = CAMERA_SVG;
  }

  function showLetter() {
    reset("is-letter");
    const name = (getName() || "").trim();
    boxEl.style.setProperty("--logo-bg", rgbStr(fallbackColor(name || "?")));
    const span = document.createElement("span");
    span.className = "logo-box-letter";
    span.textContent = initialsFor(name);
    boxEl.appendChild(span);
    badge();
  }

  function showCommitted(probeImg) {
    reset("has-image");
    probeImg.alt = "";
    boxEl.appendChild(probeImg);
    badge();
  }

  function showImage(candidates, onFail) {
    reset("has-image");
    const img = document.createElement("img");
    img.alt = "";
    boxEl.appendChild(img);
    badge();
    // If a slow source succeeds after we've fallen back to the letter,
    // upgrade to the real logo instead of discarding it
    loadBestLogo(img, candidates, onFail, showCommitted);
  }

  function render() {
    if (custom) {
      showImage([custom], showLetter);
    } else if (getDomain()) {
      showImage(logoCandidates(getDomain()), showLetter);
    } else {
      showEmpty();
    }
  }

  boxEl.addEventListener("click", () => openChooser(api));
  boxEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openChooser(api);
    }
  });

  const api = {
    refresh: render,
    setDomain,
    getDomain,
    getValue() {
      return custom;
    },
    setValue(v) {
      custom = v || null;
      render();
    },
  };
  return api;
}

// "Grand Petrol" -> "GP", "Tesco" -> "T" (first letter of up to two words)
function initialsFor(name) {
  const words = (name || "").trim().split(/\s+/).filter(Boolean);
  const letters = words.slice(0, 2).map((w) => w[0].toUpperCase());
  return letters.join("") || "?";
}

function makeThumb(card) {
  const wrap = document.createElement("div");
  wrap.className = "card-thumb";

  const showAvatar = () => {
    wrap.innerHTML = "";
    const av = document.createElement("div");
    av.className = "card-avatar";
    av.style.background = rgbStr(card.bg || fallbackColor(card.name));
    av.textContent = initialsFor(card.name);
    wrap.appendChild(av);
  };

  const showLateLogo = (probeImg) => {
    wrap.innerHTML = "";
    probeImg.className = "card-logo";
    probeImg.alt = "";
    wrap.appendChild(probeImg);
  };

  const domain = card.domain;

  // When every source fails, fall back to letters — then quietly ask
  // Wikidata whether this brand has a registered logo; if so, swap it in
  // and save it on the card so future loads are instant.
  const onAllFailed = () => {
    showAvatar();
    if (domain && !card.logo) {
      wikidataLogoForDomain(domain).then((logo) => {
        if (!logo) return;
        // Plain load for display (FilePath redirects reject CORS loads);
        // snapshotToCard resolves the direct URL for the local copy
        const img = new Image();
        img.onload = () => {
          if (img.naturalWidth > 16) {
            showLateLogo(img);
            persistCardLogo(card.id, logo);
            snapshotToCard(card.id, img, logo);
          }
        };
        img.src = logo;
      });
    }
  };

  // An explicit logo URL (user override) is tried before the auto sources
  const candidates = [];
  if (card.logo) candidates.push(card.logo);
  if (domain) candidates.push(...logoCandidates(domain));

  if (candidates.length) {
    // Warm the Wikidata lookup in parallel — if all sources fail, the
    // answer is already in hand instead of starting a fresh round-trip
    if (domain && !card.logo) wikidataLogoForDomain(domain);
    const img = document.createElement("img");
    img.className = "card-logo";
    img.alt = "";
    loadBestLogo(
      img,
      candidates,
      onAllFailed,
      (probe, src) => {
        showLateLogo(probe);
        snapshotToCard(card.id, probe, src);
      },
      (probe, src) => snapshotToCard(card.id, probe, src)
    );
    wrap.appendChild(img);
  } else {
    showAvatar();
  }
  return wrap;
}

function showView(id, title) {
  views.forEach((v) =>
    document.getElementById(v).classList.toggle("active", v === id)
  );
  headerTitle.textContent = title;
  backBtn.hidden = id === "view-home";
  addBtn.hidden = id !== "view-home";

  if (id !== "view-scan") {
    Scanner.stop();
    scanResultEl.hidden = true;
  }
}

function renderCardList() {
  const cards = loadCards();
  const list = document.getElementById("card-list");
  const empty = document.getElementById("empty-state");
  list.innerHTML = "";

  if (cards.length === 0) {
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  cards.forEach((card) => {
    const li = document.createElement("li");
    li.className = "card-item";

    li.appendChild(makeThumb(card));

    const nameEl = document.createElement("div");
    nameEl.className = "card-name";
    nameEl.textContent = card.name;
    li.appendChild(nameEl);

    // Colored strip below the logo, with text that adapts for contrast
    const applyColor = (color) => {
      nameEl.style.background = rgbStr(color);
      nameEl.style.color = textColorFor(color);
    };
    applyColor(card.bg || fallbackColor(card.name));

    // If we haven't already cached a color, derive it from the logo.
    // icon.horse is CORS-enabled, so its pixels are readable (unlike the
    // apple-touch-icon / Google favicon sources).
    // Prefer the card's own logo for color (it's what's displayed; data
    // URLs and Wikimedia Commons are readable). icon.horse is only the
    // fallback when there's nothing else — its placeholder tiles are
    // rejected by the grayscale check in extractLogoColor.
    const domain = card.domain;
    const colorSrc = card.logo || (domain && iconHorseUrl(domain));
    if (!card.bg && colorSrc) {
      extractLogoColor(colorSrc).then((color) => {
        if (color) {
          applyColor(color);
          persistCardColor(card.id, color);
        }
      });
    }

    li.addEventListener("click", () => openDetail(card.id));
    list.appendChild(li);
  });
}

function mapFormat(format) {
  return FORMAT_MAP[format] || "CODE128";
}

function renderBarcode(container, code, format) {
  container.innerHTML = "";

  if (format === "QR_CODE") {
    const canvas = document.createElement("canvas");
    container.appendChild(canvas);
    QRCode.toCanvas(canvas, code, { width: 220 }, (err) => {
      if (err) console.error(err);
    });
    return;
  }

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  container.appendChild(svg);
  try {
    JsBarcode(svg, code, {
      format: mapFormat(format),
      displayValue: false,
      margin: 10,
    });
  } catch (e) {
    console.warn("Barcode render fallback to CODE128", e);
    JsBarcode(svg, code, { format: "CODE128", displayValue: false, margin: 10 });
  }
}

function startScan() {
  scanResultEl.hidden = true;
  manualBtn.hidden = false;
  photoBtn.hidden = false;
  readerEl.hidden = false;
  readerEl.innerHTML = "";
  Scanner.start((decodedText, formatName) => {
    Scanner.stop();
    cardCodeInput.value = decodedText;
    cardNameInput.value = "";
    resetDomainField();
    scanResultEl.hidden = false;
    addFormatSwiper.setKnown(formatName);
    cardDomainInput.focus();
  }).catch((err) => {
    alert("Camera error: " + err);
  });
}

function startManualEntry() {
  Scanner.stop();
  readerEl.hidden = true;
  manualBtn.hidden = true;
  photoBtn.hidden = true;
  cardNameInput.value = "";
  resetDomainField();
  cardCodeInput.value = "";
  scanResultEl.hidden = false;
  addFormatSwiper.reset("CODE_128");
  cardDomainInput.focus();
}

const FORMAT_OPTIONS = [
  "CODE_128", "EAN_13", "EAN_8", "UPC_A", "ITF", "CODE_39", "CODABAR", "QR_CODE",
];
const FORMAT_LABELS = {
  CODE_128: "Code 128",
  EAN_13: "EAN-13",
  EAN_8: "EAN-8",
  UPC_A: "UPC-A",
  ITF: "ITF",
  CODE_39: "Code 39",
  CODABAR: "Codabar",
  QR_CODE: "QR code",
};

function renderPreviewBarcode(container, code, format) {
  const showError = () => {
    container.innerHTML =
      '<p class="preview-error">This code isn\'t valid for the ' +
      (FORMAT_LABELS[format] || format) + " barcode type</p>";
  };

  if (format === "QR_CODE") {
    try {
      container.innerHTML = "";
      const canvas = document.createElement("canvas");
      container.appendChild(canvas);
      QRCode.toCanvas(canvas, code, { width: 140 }, (err) => {
        if (err) showError();
      });
    } catch (e) {
      showError(); // e.g. the QR library failed to load
    }
    return;
  }

  container.innerHTML = "";
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  container.appendChild(svg);
  try {
    JsBarcode(svg, code, {
      format: mapFormat(format),
      displayValue: false,
      margin: 10,
    });
    if (!svg.querySelector("rect")) showError(); // rendered nothing — treat as invalid
  } catch (e) {
    showError();
  }
}

// Formats this code can actually be rendered as — swiping skips the rest
function validFormatsFor(code) {
  return FORMAT_OPTIONS.filter((f) => {
    // QR encodes any text, but only if its library actually loaded
    if (f === "QR_CODE") return typeof QRCode !== "undefined";
    try {
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      JsBarcode(svg, code, { format: mapFormat(f), displayValue: false });
      return !!svg.querySelector("rect"); // must have produced actual bars
    } catch (e) {
      return false;
    }
  });
}

// Swipeable barcode preview: shows the code in the current format with a
// small type label below; swipe left/right on the barcode (or tap the
// label) to cycle through the types valid for this code — replaces the
// old dropdown.
function wireFormatSwiper(fieldEl, wrapEl, labelEl, getCode) {
  let format = "CODE_128";
  let guessing = true; // until the user swipes, typing re-guesses the type

  function render() {
    const code = getCode().trim();
    if (!code) {
      fieldEl.hidden = true;
      return;
    }
    fieldEl.hidden = false;
    renderPreviewBarcode(wrapEl, code, format);
    const name = FORMAT_LABELS[format] || format;
    const swipeable = validFormatsFor(code).length > 1;
    labelEl.textContent = swipeable ? name + "  ‹ swipe to change ›" : name;
  }

  function cycle(dir) {
    const code = getCode().trim();
    if (!code) return;
    guessing = false;
    const list = validFormatsFor(code);
    const i = list.indexOf(format);
    // if the current format isn't in the valid list, start from its edge
    const next = i === -1 ? (dir > 0 ? 0 : list.length - 1) : (i + dir + list.length) % list.length;
    format = list[next];
    render();
  }

  let x0 = null;
  wrapEl.addEventListener("pointerdown", (e) => {
    x0 = e.clientX;
  });
  wrapEl.addEventListener("pointerup", (e) => {
    if (x0 === null) return;
    const dx = e.clientX - x0;
    x0 = null;
    if (Math.abs(dx) > 30) cycle(dx < 0 ? 1 : -1);
  });
  wrapEl.addEventListener("pointercancel", () => {
    x0 = null;
  });
  labelEl.addEventListener("click", () => cycle(1)); // tap fallback

  return {
    get() {
      return format;
    },
    // Format known for sure (scan result / saved card) — stop guessing
    setKnown(f) {
      format = f || "CODE_128";
      guessing = false;
      render();
    },
    // Start fresh with a guess; typing keeps re-guessing until a swipe
    reset(f) {
      format = f || "CODE_128";
      guessing = true;
      render();
    },
    onCodeInput() {
      if (guessing) {
        const code = getCode().trim();
        const list = validFormatsFor(code);
        const guess = guessFormat(code);
        format = list.includes(guess) ? guess : list[0] || "CODE_128";
      }
      render();
    },
    refresh: render,
  };
}

const addFormatSwiper = wireFormatSwiper(
  previewField, previewEl, formatLabelEl, () => cardCodeInput.value
);

cardCodeInput.addEventListener("input", () => addFormatSwiper.onCodeInput());

// --- Company search dropdown (reusable for add and edit forms) ---

function wireCompanySearch(input, dropdown, nameInput, onChange) {
  let manualMode = false;
  let debounce = null;
  let ctrl = null;
  // onChange(match) — match is present when a company was picked from the
  // list (it may carry the brand's own logo URL from Wikidata)
  const notify = (match) => onChange && onChange(match);

  function hide() {
    dropdown.hidden = true;
    dropdown.innerHTML = "";
  }

  function render(matches, q) {
    dropdown.innerHTML = "";

    // If they typed something domain-like (e.g. "grand-petrol.com.ua"),
    // offer to use it directly as the website — the reliable way to set a
    // brand the search database doesn't know.
    const typedDomain = q && q.includes(".") ? normalizeDomain(q) : null;
    if (typedDomain) {
      const useItem = document.createElement("div");
      useItem.className = "dropdown-item";
      const img = document.createElement("img");
      img.alt = "";
      loadBestLogo(img, logoCandidates(typedDomain), () => img.remove());
      useItem.appendChild(img);
      const text = document.createElement("div");
      const nameEl = document.createElement("div");
      nameEl.className = "dd-name";
      nameEl.textContent = "Use “" + typedDomain + "”";
      const subEl = document.createElement("div");
      subEl.className = "dd-domain";
      subEl.textContent = "as this card's website";
      text.appendChild(nameEl);
      text.appendChild(subEl);
      useItem.appendChild(text);
      useItem.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        input.value = typedDomain;
        hide();
        notify();
      });
      dropdown.appendChild(useItem);
    }

    matches.slice(0, 5).forEach((m) => {
      const item = document.createElement("div");
      item.className = "dropdown-item";

      const img = document.createElement("img");
      img.alt = "";
      const preview = m.logo
        ? [m.logo].concat(logoCandidates(m.domain))
        : logoCandidates(m.domain);
      loadBestLogo(img, preview, () => img.remove());
      item.appendChild(img);

      const text = document.createElement("div");
      const nameEl = document.createElement("div");
      nameEl.className = "dd-name";
      nameEl.textContent = m.name;
      const domainEl = document.createElement("div");
      domainEl.className = "dd-domain";
      domainEl.textContent = m.domain;
      text.appendChild(nameEl);
      text.appendChild(domainEl);
      item.appendChild(text);

      // pointerdown fires before the input's blur, so the tap registers
      item.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        input.value = m.domain;
        // Auto-fill the card name from the company, unless one's already set
        if (nameInput && !nameInput.value.trim()) nameInput.value = m.name;
        hide();
        notify(m);
      });
      dropdown.appendChild(item);
    });

    const manual = document.createElement("div");
    manual.className = "dropdown-item dropdown-manual";
    manual.textContent = "Type domain manually…";
    manual.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      manualMode = true;
      input.value = "";
      input.placeholder = "e.g. tesco.com";
      hide();
      input.focus();
      notify();
    });
    dropdown.appendChild(manual);

    dropdown.hidden = false;
  }

  input.addEventListener("input", () => {
    const q = input.value.trim();
    notify(); // keep the logo box in sync as the domain is typed
    if (q === "") manualMode = false;
    if (manualMode || q.length < 2) {
      hide();
      return;
    }
    clearTimeout(debounce);
    debounce = setTimeout(async () => {
      try {
        if (ctrl) ctrl.abort();
        ctrl = new AbortController();
        const matches = await fetchCompanySuggestions(q, ctrl.signal);
        render(matches, q);
      } catch (e) {
        // aborted or offline — leave the dropdown closed
      }
    }, 300);
  });

  input.addEventListener("blur", () => setTimeout(hide, 150));

  return {
    reset() {
      manualMode = false;
      input.value = "";
      input.placeholder = "Search company…";
      hide();
    },
  };
}

function hasCyrillic(s) {
  return /[Ѐ-ӿ]/.test(s);
}

// Source 1: Clearbit — strong for Western brands
async function searchClearbit(q, signal) {
  try {
    const res = await fetch(
      "https://autocomplete.clearbit.com/v1/companies/suggest?query=" + encodeURIComponent(q),
      { signal }
    );
    const arr = await res.json();
    return arr.map((c) => ({ name: c.name, domain: c.domain }));
  } catch (e) {
    return [];
  }
}

// Source 2: Wikidata — multilingual (incl. Ukrainian), resolves a brand
// to its official website (property P856)
async function searchWikidata(q, signal) {
  try {
    const lang = hasCyrillic(q) ? "uk" : "en";
    const sres = await fetch(
      "https://www.wikidata.org/w/api.php?action=wbsearchentities&format=json&origin=*" +
        "&limit=7&language=" + lang + "&uselang=" + lang +
        "&search=" + encodeURIComponent(q),
      { signal }
    );
    const hits = (await sres.json()).search || [];
    if (!hits.length) return [];

    const ids = hits.map((h) => h.id).join("|");
    const eres = await fetch(
      "https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&origin=*" +
        "&props=claims&ids=" + ids,
      { signal }
    );
    const entities = (await eres.json()).entities || {};

    const out = [];
    for (const h of hits) {
      const claims = (entities[h.id] && entities[h.id].claims) || {};
      const site = claims.P856;
      if (!site || !site.length) continue;
      let url;
      try {
        url = site[0].mainsnak.datavalue.value;
      } catch (e) {
        continue;
      }
      const domain = normalizeDomain(url);
      if (!domain || !domain.includes(".")) continue;

      // P154 = the brand's actual logo image, hosted on Wikimedia Commons
      let logo = null;
      try {
        const file = claims.P154[0].mainsnak.datavalue.value;
        logo =
          "https://commons.wikimedia.org/wiki/Special:FilePath/" +
          encodeURIComponent(file) + "?width=256";
      } catch (e) {
        // no logo on record — domain-based lookup will be used instead
      }

      out.push({ name: h.label || (h.match && h.match.text) || q, domain, logo });
    }
    return out;
  } catch (e) {
    return [];
  }
}

// Run both sources in parallel, merge and dedupe by domain
async function fetchCompanySuggestions(q, signal) {
  const [clearbit, wikidata] = await Promise.all([
    searchClearbit(q, signal),
    searchWikidata(q, signal),
  ]);
  const seen = new Set();
  const merged = [];
  for (const item of [...clearbit, ...wikidata]) {
    if (!item.domain) continue;
    const key = item.domain.toLowerCase();
    if (seen.has(key)) continue;
    // Exclude Russian-registered domains from suggestions
    if (/\.(ru|su|рф)$/.test(key)) continue;
    seen.add(key);
    merged.push(item);
  }
  return merged;
}

// --- Shared logo chooser sheet ---

const logoModal = document.getElementById("logo-modal");
const lmFile = document.getElementById("lm-file");
const lmUrl = document.getElementById("lm-url");
let activeLogoBox = null;

function domainFromInput(input) {
  const t = normalizeDomain(input.value);
  return t.includes(".") ? t : null;
}

function openLogoChooser(box) {
  activeLogoBox = box;
  const v = box.getValue();
  if (v && v.indexOf("data:") !== 0) {
    lmUrl.value = v; // direct image URL currently in use
  } else if (!v && box.getDomain()) {
    lmUrl.value = box.getDomain(); // logo comes from the company website
  } else {
    lmUrl.value = ""; // picked photo (data URL) or nothing set
  }
  logoModal.hidden = false;
}

function closeLogoChooser() {
  logoModal.hidden = true;
  activeLogoBox = null;
}

document.getElementById("lm-photo").addEventListener("click", () => lmFile.click());

lmFile.addEventListener("change", async () => {
  const file = lmFile.files[0];
  lmFile.value = "";
  if (!file || !activeLogoBox) return;
  try {
    activeLogoBox.setValue(await fileToLogoDataUrl(file));
    closeLogoChooser();
  } catch (e) {
    alert("Couldn't read that image.");
  }
});

document.getElementById("lm-use-url").addEventListener("click", () => {
  if (!activeLogoBox) return closeLogoChooser();
  const raw = lmUrl.value.trim();
  if (!raw) {
    activeLogoBox.setValue(null);
    return closeLogoChooser();
  }
  // A URL with a path (e.g. site.com/images/logo.png) is a direct image;
  // a bare domain or site root (megamarket.ua, https://megamarket.ua/) is
  // the company's website — set it as the domain and let the logo chain run.
  const noProto = raw.replace(/^[a-z]+:\/\//i, "");
  const slash = noProto.indexOf("/");
  const hasPath = slash !== -1 && noProto.slice(slash + 1).length > 0;
  if (raw.indexOf("data:") === 0 || hasPath) {
    activeLogoBox.setValue(raw);
  } else {
    activeLogoBox.setDomain(normalizeDomain(raw));
    activeLogoBox.setValue(null); // clear custom so the domain chain is used
  }
  closeLogoChooser();
});

document.getElementById("lm-remove").addEventListener("click", () => {
  if (activeLogoBox) activeLogoBox.setValue(null);
  closeLogoChooser();
});

document.getElementById("lm-cancel").addEventListener("click", closeLogoChooser);
logoModal.addEventListener("click", (e) => {
  if (e.target === logoModal) closeLogoChooser();
});

const addLogoBox = createLogoBox(
  document.getElementById("add-logo-box"),
  () => cardNameInput.value,
  () => domainFromInput(cardDomainInput),
  (d) => {
    cardDomainInput.value = d;
  },
  openLogoChooser
);

const addSearch = wireCompanySearch(
  cardDomainInput,
  domainDropdown,
  cardNameInput,
  (match) => {
    if (match && match.logo) addLogoBox.setValue(match.logo);
    else addLogoBox.refresh();
  }
);

function resetDomainField() {
  addSearch.reset();
  addLogoBox.setValue(null);
}

photoBtn.addEventListener("click", () => photoInput.click());

photoInput.addEventListener("change", () => {
  const file = photoInput.files[0];
  photoInput.value = "";
  if (!file) return;

  Scanner.scanFile(file)
    .then(({ text, format }) => {
      readerEl.hidden = true;
      manualBtn.hidden = true;
      photoBtn.hidden = true;
      cardCodeInput.value = text;
      cardNameInput.value = "";
      resetDomainField();
      scanResultEl.hidden = false;
      if (format === "UNKNOWN") addFormatSwiper.reset(guessFormat(text));
      else addFormatSwiper.setKnown(format);
      cardDomainInput.focus();
    })
    .catch(() => {
      alert("No barcode found in that photo. Try getting closer or improving lighting.");
      startScan();
    });
});

function openDetail(id) {
  const cards = loadCards();
  const card = cards.find((c) => c.id === id);
  if (!card) return;
  selectedCardId = id;

  document.getElementById("detail-name").textContent = card.name;
  document.getElementById("detail-value").textContent = card.code;
  renderBarcode(document.getElementById("detail-barcode"), card.code, card.format);

  showView("view-detail", card.name);
}

addBtn.addEventListener("click", () => {
  showView("view-scan", "Scan card");
  startScan();
});

// The first-launch hint works like the + button
document.getElementById("empty-state").addEventListener("click", () => {
  showView("view-scan", "Scan card");
  startScan();
});

// Debug tools are hidden by default; triple-tap the version label to toggle
const DEBUG_KEY = "cardholder.debug";
const diagBtn = document.getElementById("edit-diag-btn");

function applyDebugVisibility() {
  diagBtn.hidden = localStorage.getItem(DEBUG_KEY) !== "1";
}
applyDebugVisibility();

let versionTaps = [];
document.getElementById("app-version").addEventListener("click", () => {
  const now = Date.now();
  versionTaps = versionTaps.filter((t) => now - t < 1500);
  versionTaps.push(now);
  if (versionTaps.length >= 3) {
    versionTaps = [];
    const on = localStorage.getItem(DEBUG_KEY) === "1";
    localStorage.setItem(DEBUG_KEY, on ? "0" : "1");
    applyDebugVisibility();
    const label = document.getElementById("app-version");
    const original = label.textContent;
    label.textContent = on ? "debug off" : "debug on";
    setTimeout(() => {
      label.textContent = original;
    }, 1200);
  }
});

backBtn.addEventListener("click", () => {
  showView("view-home", "CardHolder");
  renderCardList();
});

document.getElementById("rescan-btn").addEventListener("click", startScan);

document.getElementById("add-cancel-btn").addEventListener("click", () => {
  showView("view-home", "CardHolder");
  renderCardList();
});

manualBtn.addEventListener("click", startManualEntry);

document.getElementById("save-card-btn").addEventListener("click", () => {
  const code = cardCodeInput.value.trim();
  if (!code) {
    alert("Card code can't be empty.");
    return;
  }
  const format = addFormatSwiper.get();
  const name = cardNameInput.value.trim() || "Untitled card";
  // Only treat the field as a domain if it actually looks like one (has a
  // dot). Free-text left over from searching falls back to the name guess.
  const typed = normalizeDomain(cardDomainInput.value);
  const domain = typed.includes(".") ? typed : null;
  const logo = addLogoBox.getValue();

  const cards = loadCards();
  cards.push({ id: makeId(), name, code, format, domain, logo });
  saveCards(cards);

  showView("view-home", "CardHolder");
  renderCardList();
});

document.getElementById("delete-card-btn").addEventListener("click", () => {
  if (!selectedCardId) return;
  if (!confirm("Delete this card?")) return;

  let cards = loadCards();
  cards = cards.filter((c) => c.id !== selectedCardId);
  saveCards(cards);
  selectedCardId = null;

  showView("view-home", "CardHolder");
  renderCardList();
});

// --- Edit card ---

const editDomainInput = document.getElementById("edit-domain-input");
const editDropdown = document.getElementById("edit-dropdown");
const editNameInput = document.getElementById("edit-name-input");
const editCodeInput = document.getElementById("edit-code-input");
const editPreviewField = document.getElementById("edit-preview-field");
const editPreviewEl = document.getElementById("edit-preview");
const editFormatLabelEl = document.getElementById("edit-format-label");

const editFormatSwiper = wireFormatSwiper(
  editPreviewField, editPreviewEl, editFormatLabelEl, () => editCodeInput.value
);

const editLogoBox = createLogoBox(
  document.getElementById("edit-logo-box"),
  () => editNameInput.value,
  () => domainFromInput(editDomainInput),
  (d) => {
    editDomainInput.value = d;
  },
  openLogoChooser
);

const editSearch = wireCompanySearch(
  editDomainInput,
  editDropdown,
  editNameInput,
  (match) => {
    if (match && match.logo) editLogoBox.setValue(match.logo);
    else editLogoBox.refresh();
  }
);

const editDiagBtn = document.getElementById("edit-diag-btn");
const editDiagOutput = document.getElementById("edit-diag-output");

editDiagBtn.addEventListener("click", async () => {
  const card = loadCards().find((c) => c.id === selectedCardId);
  if (!card) return;
  editDiagOutput.hidden = false;
  editDiagOutput.value = "Testing each logo source…";
  // Reflect any unsaved edits to domain/logo in the test
  const probe = {
    name: editNameInput.value || card.name,
    domain: domainFromInput(editDomainInput),
    logo: editLogoBox.getValue(),
  };
  editDiagOutput.value = await diagnoseLogo(probe);
});

editCodeInput.addEventListener("input", () => editFormatSwiper.refresh());

function openEdit(id) {
  const card = loadCards().find((c) => c.id === id);
  if (!card) return;
  selectedCardId = id;

  editSearch.reset();
  editDomainInput.value = card.domain || "";
  editNameInput.value = card.name;
  editLogoBox.setValue(card.logo || null);
  editCodeInput.value = card.code;
  editDropdown.hidden = true;
  editFormatSwiper.setKnown(card.format);

  showView("view-edit", "Edit card");
}

document.getElementById("edit-card-btn").addEventListener("click", () => {
  if (selectedCardId) openEdit(selectedCardId);
});

// Discard changes and return to the card (fields repopulate on next open)
document.getElementById("edit-cancel-btn").addEventListener("click", () => {
  if (selectedCardId) openDetail(selectedCardId);
  else showView("view-home", "CardHolder");
});

document.getElementById("edit-save-btn").addEventListener("click", () => {
  const code = editCodeInput.value.trim();
  if (!code) {
    alert("Card code can't be empty.");
    return;
  }
  const cards = loadCards();
  const card = cards.find((c) => c.id === selectedCardId);
  if (!card) return;

  const typed = normalizeDomain(editDomainInput.value);
  const newDomain = typed.includes(".") ? typed : null;
  const newLogo = editLogoBox.getValue();

  // If the logo source changed, drop the cached color so it recomputes
  if (newDomain !== card.domain || newLogo !== card.logo) delete card.bg;

  card.name = editNameInput.value.trim() || "Untitled card";
  card.domain = newDomain;
  card.logo = newLogo;
  card.code = code;
  card.format = editFormatSwiper.get();
  saveCards(cards);

  showView("view-home", "CardHolder");
  renderCardList();
});

renderCardList();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("service-worker.js", { updateViaCache: "none" })
      .then((reg) => reg.update())
      .catch((err) => console.warn("SW registration failed", err));
  });
}
