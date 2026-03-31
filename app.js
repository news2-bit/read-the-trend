const PROXY           = 'https://api.allorigins.win/raw?url=';
const TRENDS_RSS      = geo => `https://trends.google.com/trending/rss?geo=${geo}`;
const GEO_API         = 'https://ipapi.co/json/';
const POLLINATIONS_AUTH = 'https://enter.pollinations.ai/authorize';
const POLLINATIONS_API  = 'https://gen.pollinations.ai/v1/chat/completions';
const LS_COUNTRY      = 'trending_country';
const LS_LANG         = 'trending_lang';
const LS_POLLEN_KEY   = 'pollinations_key';
const LANG_NAMES      = { en:'English', de:'German', es:'Spanish', fr:'French', it:'Italian', zh:'Chinese' };

const countrySelect   = document.getElementById('countrySelect');
const langSelect      = document.getElementById('langSelect');
const refreshBtn      = document.getElementById('refreshBtn');
const loader          = document.getElementById('loader');
const errorDiv        = document.getElementById('error');
const trendsGrid      = document.getElementById('trendsGrid');
const meta            = document.getElementById('meta');
const updatedAt       = document.getElementById('updatedAt');
const detectedBadge   = document.getElementById('detectedBadge');
const connectBtn      = document.getElementById('connectBtn');
const connectedBadge  = document.getElementById('connectedBadge');
const disconnectBtn   = document.getElementById('disconnectBtn');

// --- Auth ---

function updateAuthUI() {
  const hasKey = !!localStorage.getItem(LS_POLLEN_KEY);
  connectBtn.hidden    = hasKey;
  connectedBadge.hidden = !hasKey;
}

function handleIncomingKey() {
  const fragment = new URLSearchParams(location.hash.slice(1));
  const key = fragment.get('api_key');
  if (key) {
    localStorage.setItem(LS_POLLEN_KEY, key);
    history.replaceState(null, '', location.pathname);
  }
}

connectBtn.addEventListener('click', () => {
  const params = new URLSearchParams({ redirect_url: location.href });
  window.location.href = `${POLLINATIONS_AUTH}?${params}`;
});

disconnectBtn.addEventListener('click', () => {
  localStorage.removeItem(LS_POLLEN_KEY);
  updateAuthUI();
});

// --- Language ---

langSelect.value = localStorage.getItem(LS_LANG) || 'en';
langSelect.addEventListener('change', () => localStorage.setItem(LS_LANG, langSelect.value));

// --- Trends ---

function showLoader(on) {
  loader.hidden = !on;
  refreshBtn.disabled = on;
  countrySelect.disabled = on;
}

function showError(msg) {
  errorDiv.textContent = msg;
  errorDiv.hidden = false;
}

function clearError() {
  errorDiv.hidden = true;
  errorDiv.textContent = '';
}

async function detectCountry() {
  const saved = localStorage.getItem(LS_COUNTRY);
  if (saved) {
    setCountry(saved, false);
    return;
  }
  try {
    const res = await fetch(GEO_API);
    const data = await res.json();
    const code = data.country_code || 'US';
    setCountry(code, true);
  } catch {
    setCountry('US', false);
  }
}

function setCountry(code, detected) {
  const option = countrySelect.querySelector(`option[value="${code}"]`);
  if (option) {
    countrySelect.value = code;
    detectedBadge.hidden = !detected;
  } else {
    countrySelect.value = 'US';
    detectedBadge.hidden = true;
  }
}

async function fetchTrends(geo) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const url = encodeURIComponent(TRENDS_RSS(geo));
    const res = await fetch(`${PROXY}${url}`, { signal: controller.signal });
    if (!res.ok) throw new Error(`Failed to fetch trends (HTTP ${res.status})`);
    const text = await res.text();
    const parser = new DOMParser();
    const xml = parser.parseFromString(text, 'application/xml');
    const parseErr = xml.querySelector('parsererror');
    if (parseErr) throw new Error('Could not parse trends data.');
    return xml.querySelectorAll('item');
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('Request timed out. Try refreshing.');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function getText(el, tag, ns) {
  const node = ns ? el.getElementsByTagNameNS(ns, tag)[0] : el.querySelector(tag);
  return node ? node.textContent.trim() : '';
}

async function summarizeTrend(trend, card) {
  const key = localStorage.getItem(LS_POLLEN_KEY);
  const btn = card.querySelector('.summarize-btn');
  const summaryEl = card.querySelector('.ai-summary');

  if (!key) {
    summaryEl.textContent = 'Connect Pollinations first (button above).';
    summaryEl.hidden = false;
    return;
  }

  const lang = langSelect.value;
  localStorage.setItem(LS_LANG, lang);
  const langName = LANG_NAMES[lang];
  const context = trend.newsTitle ? `Related news: "${trend.newsTitle}" from ${trend.newsSource}.` : '';
  const prompt = `Write a 2-3 sentence summary in ${langName} explaining why "${trend.name}" is currently trending (approx. ${trend.traffic} searches). ${context} Be informative and neutral.`;

  btn.disabled = true;
  btn.textContent = '⏳ Generating…';

  try {
    const res = await fetch(POLLINATIONS_API, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'perplexity-fast',
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (res.status === 401 || res.status === 403) {
      localStorage.removeItem(LS_POLLEN_KEY);
      updateAuthUI();
      throw new Error('Session expired. Please reconnect.');
    }
    if (!res.ok) throw new Error(`API error ${res.status}`);

    const data = await res.json();
    const text = data.choices?.[0]?.message?.content ?? 'No response.';
    summaryEl.textContent = text;
    summaryEl.hidden = false;
    btn.textContent = '✓ Summarized';
  } catch (err) {
    summaryEl.textContent = err.message || 'Failed. Try again.';
    summaryEl.hidden = false;
    btn.textContent = '✦ Summarize';
    btn.disabled = false;
  }
}

function renderTrends(items) {
  trendsGrid.innerHTML = '';
  if (!items.length) {
    trendsGrid.innerHTML = '<p style="color:rgba(255,255,255,0.3);font-size:.875rem">No trends found for this country.</p>';
    return;
  }

  const NS = 'https://trends.google.com/trending/rss';

  items.forEach((item, i) => {
    const name       = getText(item, 'title');
    const traffic    = getText(item, 'approx_traffic', NS);
    const newsTitle  = getText(item, 'news_item_title', NS);
    const newsUrl    = getText(item, 'news_item_url', NS);
    const newsSource = getText(item, 'news_item_source', NS);
    const picture    = getText(item, 'picture', NS);

    const card = document.createElement('div');
    card.className = 'trend-card';

    const thumb = picture
      ? `<img class="thumb" src="${picture}" alt="" loading="lazy" onerror="this.remove()">`
      : '';

    const newsBlock = newsTitle
      ? `<a class="news-link" href="${newsUrl}" target="_blank" rel="noopener">${newsTitle}</a>
         ${newsSource ? `<div class="news-source">${newsSource}</div>` : ''}`
      : '';

    card.innerHTML = `
      <div class="card-top">
        <span class="rank">#${i + 1}</span>
        <div class="card-title-wrap">
          <div class="trend-name">${name}</div>
          ${traffic ? `<div class="traffic">${traffic} searches</div>` : ''}
        </div>
        ${thumb}
      </div>
      ${newsBlock}
    `;

    const btn = document.createElement('button');
    btn.className = 'summarize-btn';
    btn.textContent = '✦ Summarize';
    const summaryEl = document.createElement('div');
    summaryEl.className = 'ai-summary';
    summaryEl.hidden = true;

    btn.addEventListener('click', () => summarizeTrend({ name, traffic, newsTitle, newsSource }, card));

    card.appendChild(btn);
    card.appendChild(summaryEl);
    trendsGrid.appendChild(card);
  });
}

async function loadTrends() {
  const geo = countrySelect.value;
  localStorage.setItem(LS_COUNTRY, geo);
  clearError();
  trendsGrid.innerHTML = '';
  meta.hidden = true;
  showLoader(true);

  try {
    const items = await fetchTrends(geo);
    renderTrends(Array.from(items));
    updatedAt.textContent = new Date().toLocaleTimeString();
    meta.hidden = false;
  } catch (err) {
    showError(err.message || 'Something went wrong. Please try again.');
  } finally {
    showLoader(false);
  }
}

countrySelect.addEventListener('change', () => {
  detectedBadge.hidden = true;
  loadTrends();
});
refreshBtn.addEventListener('click', loadTrends);

handleIncomingKey();
updateAuthUI();
detectCountry().then(loadTrends);
