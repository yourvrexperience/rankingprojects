// js/i18n/LanguageManager.js

export class LanguageManager {
  constructor(resources = {}, options = {}) {
    // resources shape:
    // {
    //   en: { "title": "Welcome", "button.save": "Save" },
    //   es: { "title": "Bienvenido", "button.save": "Guardar" }
    // }
    this.resources = resources || {};
    this.lang = options.defaultLang || "en";
    this.fallbackLang = options.fallbackLang || "en";
    this.onMissingKey = options.onMissingKey || null;

    // optional base path for language files
    this.basePath = options.basePath || "i18n";
    this.fetchOptions = options.fetchOptions || { cache: "no-cache" };

    // cache promises to avoid duplicate fetches
    this._pendingLoads = new Map();
  }

  /* -----------------------------
   * STATIC LOADER (i18n format)
   * ----------------------------- */

  static async load({
    basePath = "i18n",
    lang = "en",
    fallbackLang = "en",
    preload = [lang, fallbackLang],
    onMissingKey = null,
    fetchOptions = { cache: "no-cache" }
  } = {}) {
    const manager = new LanguageManager(
      {},
      { defaultLang: lang, fallbackLang, onMissingKey, basePath, fetchOptions }
    );

    // Preload requested languages (dedup + remove falsy)
    const unique = [...new Set((preload || []).filter(Boolean).map(String))];
    await Promise.all(unique.map(l => manager.loadLang(l)));

    return manager;
  }

  /* -----------------------------
   * LANGUAGE CONTROL
   * ----------------------------- */
  setLanguage(langId) {
    if (!langId) return;
    this.lang = String(langId).trim();
  }

  getLanguage() {
    return this.lang;
  }

  getCurrentLang(){
    return this.lang;
  }

  /**
   * Load a language file: `${basePath}/${lang}.json`
   */
  async loadLang(langId) {
    const lang = String(langId || "").trim();
    if (!lang) return;

    // already loaded
    if (this.resources[lang]) return;

    // already fetching
    if (this._pendingLoads.has(lang)) {
      await this._pendingLoads.get(lang);
      return;
    }

    const p = (async () => {
      const url = `${this.basePath}/${encodeURIComponent(lang)}.json`;
      // const url = `http://127.0.0.1:8080/python/i18n/${encodeURIComponent(lang)}.json`;
      const res = await fetch(url, this.fetchOptions);
      if (!res.ok) {
        throw new Error(`LanguageManager.loadLang: failed to load ${url}`);
      }
      const data = await res.json();
      if (!data || typeof data !== "object") {
        throw new Error(`LanguageManager.loadLang: invalid JSON for ${url}`);
      }
      this.resources[lang] = data;
    })();

    this._pendingLoads.set(lang, p);

    try {
      await p;
    } finally {
      this._pendingLoads.delete(lang);
    }
  }

  /**
   * Translate by key using loaded resources.
   * @param {string} key - e.g. "text.save.project"
   * @param {object} vars - placeholder vars: { name: "John" } for "Hello {name}"
   * @param {string} langOverride - optional lang id
   */
  t(key, vars = {}, langOverride = null) {
    const k = String(key || "").trim();
    const lang = (langOverride || this.lang || "").trim() || this.fallbackLang;

    const langTable = this.resources[lang];
    const fallbackTable = this.resources[this.fallbackLang];

    let text =
      (langTable && langTable[k] != null ? langTable[k] : null) ??
      (fallbackTable && fallbackTable[k] != null ? fallbackTable[k] : null);

    if (text == null) {
      if (typeof this.onMissingKey === "function") {
        this.onMissingKey(k, lang);
      }
      return k; // visible missing signal
    }

    return this.#interpolate(String(text), vars);
  }

  /**
   * Patch in extra translations at runtime:
   * addTranslations("en", { "title": "..." })
   */
  addTranslations(langId, dictionaryPatch = {}) {
    const lang = String(langId || "").trim();
    if (!lang) return;

    if (!this.resources[lang]) this.resources[lang] = {};
    Object.assign(this.resources[lang], dictionaryPatch || {});
  }

  /**
   * Apply translations to the DOM.
   * - data-i18n="some.key" -> sets textContent
   * - data-i18n-attr="placeholder" -> sets an attribute
   * - data-i18n-vars='{"name":"X"}' -> placeholders
   */
  applyToDOM(root = document) {
    const nodes = root.querySelectorAll("[data-i18n]");
    nodes.forEach(el => {
      const key = el.getAttribute("data-i18n");
      const attr = el.getAttribute("data-i18n-attr");
      const varsRaw = el.getAttribute("data-i18n-vars");

      let vars = {};
      if (varsRaw) {
        try { vars = JSON.parse(varsRaw); } catch { vars = {}; }
      }

      const translated = this.t(key, vars);

      if (attr) el.setAttribute(attr, translated);
      else el.textContent = translated;
    });
  }

  #interpolate(template, vars) {
    return template.replace(/\{(\w+)\}/g, (_, name) => {
      const v = vars?.[name];
      return v === undefined || v === null ? `{${name}}` : String(v);
    });
  }
}

/* ---------- SINGLETON EXPORT ---------- */
let _instance = null;

export async function getLanguageManager(options) {
  if (_instance) return _instance;
  _instance = await LanguageManager.load(options);
  return _instance;
}
