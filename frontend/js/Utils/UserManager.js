// js/UserManager.js
export class UserManager {
  /**
   * @param {object} opts
   * @param {any} opts.langManager - LanguageManager instance (must have .t())
   */
  constructor({ langManager }) {
    if (!langManager?.t) throw new Error("UserManager: langManager with .t() is required");
    this.lang = langManager;
  }

  // ---------- public API ----------

  /**
   * Register a new user
   * @returns {Promise<{ok:true} | {ok:false, error:string}>}
   */
  async register({ email, password, password2 }) {
    const normalizedEmail = this.#normalizeEmail(email);

    // validations (keeps your current behavior)
    if (!normalizedEmail || !password) {
      return { ok: false, error: this.lang.t("rgt.email.password.required") };
    }
    if (password.length < 8) {
      return { ok: false, error: this.lang.t("rgt.password.least.required") };
    }
    if (password !== password2) {
      return { ok: false, error: this.lang.t("rgt.password.dont.match") };
    }

    // request
    const result = await this.#postJson("/auth/register", {
      email: normalizedEmail,
      password
    });

    if (!result.ok) {
      return { ok: false, error: result.error || this.lang.t("rgt.registration.failed") };
    }

    return { ok: true };
  }

  /**
   * Login
   * @returns {Promise<{ok:true, token:string, email?:string, name?:string} | {ok:false, error:string}>}
   */
  async login({ email, password }) {
    const normalizedEmail = this.#normalizeEmail(email);

    if (!normalizedEmail || !password) {
      return { ok: false, error: this.lang.t("lgn.email.password.required") };
    }

    const result = await this.#postJson("/auth/login", {
      email: normalizedEmail,
      password
    });

    if (!result.ok) {
      return { ok: false, error: result.error || this.lang.t("lgn.login.failed") };
    }

    // store session exactly like your current login.html
    this.setSession({
      token: result.token,
      email: result.email,
      name: result.name
    });

	// Hydrate local prompt quota from backend session (best-effort)
    try {
      const sessRes = await this.getBackendSession();
      if (sessRes.ok) {
        const pq = sessRes.session?.promptQuota;
        if (pq && typeof pq.date === "string" && typeof pq.count === "number") {
          const key = this.getPromptQuotaStorageKey();
          localStorage.setItem(key, JSON.stringify({ date: pq.date, count: pq.count }));
        }
      }
    } catch (e) {
      console.warn("Session hydrate failed", e);
    }
	
    return { ok: true, token: result.token, email: result.email, name: result.name };
  }

  setSession({ token, email, name }) {
    if (token) sessionStorage.setItem("auth_token", token);
    if (email) sessionStorage.setItem("auth_email", email);
    if (name) sessionStorage.setItem("auth_name", name);
  }

  clearSession() {
    sessionStorage.removeItem("auth_token");
    sessionStorage.removeItem("auth_email");
    sessionStorage.removeItem("auth_name");
  }

  getSession() {
    return {
      token: sessionStorage.getItem("auth_token"),
      email: sessionStorage.getItem("auth_email"),
      name: sessionStorage.getItem("auth_name")
    };
  }

   isLoggedIn() {
    return Boolean(this.getSession().token);
  }

  // ---------- private helpers ----------

  #normalizeEmail(email) {
    return String(email ?? "").trim().toLowerCase();
  }

  async #postJson(path, payload) {
    const base = this.lang.t("url.base");
    const url = `${base}${path}`;

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      // If server sometimes returns non-JSON on error, this avoids crashing:
      const text = await res.text();
      let data = {};
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        data = {};
      }

      // Your server already returns { ok: boolean, ... }
      return data;
    } catch (err) {
      console.error(err);
      return { ok: false, error: "NETWORK_ERROR" };
    }
  }

  /**
   * Redirect away if not logged in.
   */
  requireAuth({ redirectTo = "login.html" } = {}) {
    if (!this.isLoggedIn()) {
      location.href = redirectTo;
      return false;
    }
    return true;
  }

  logout({ redirectTo = "login.html" } = {}) {
    this.clearSession();
    location.href = redirectTo;
  }

  // ---- authenticated requests (used by admin page) ----
  async authedFetch(path, { method = "GET", body = null } = {}) {
    const { token } = this.getSession();
    if (!token) return { res: null, data: null, error: "NO_TOKEN" };

    const res = await fetch(`${this.lang.t("url.base")}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: body ? JSON.stringify(body) : null
    });

    const data = await res.json().catch(() => ({}));
    return { res, data, error: null };
  }

  async updateDisplayName(name) {
    const next = String(name ?? "").trim();
    if (next.length < 2) {
      return { ok: false, error: this.lang.t("adm.name.at.least.two.characters") };
    }

    const { res, data, error } = await this.authedFetch("/me/name", {
      method: "PUT",
      body: { name: next }
    });

    if (error === "NO_TOKEN") return { ok: false, error: "NO_TOKEN" };
    if (!res?.ok) return { ok: false, error: data?.error || this.lang.t("adm.failed.to.update.name") };

    sessionStorage.setItem("auth_name", next);
    return { ok: true, name: next };
  }

  async deleteMe() {
    const { res, data, error } = await this.authedFetch("/me", { method: "DELETE" });
    if (error === "NO_TOKEN") return { ok: false, error: "NO_TOKEN" };
    if (!res?.ok) return { ok: false, error: data?.error || this.lang.t("adm.delete.user.failed") };

    this.clearSession();
    return { ok: true };
  }
  
  // ---- Prompt quota settings ----
  getPromptDailyLimit() {
    return 6;
  }

  /**
   * @returns {string} date in YYYY-MM-DD using Europe/Madrid
   */
  getTodayKey() {
    const tz = "Europe/Madrid";
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date());

    const y = parts.find(p => p.type === "year")?.value;
    const m = parts.find(p => p.type === "month")?.value;
    const d = parts.find(p => p.type === "day")?.value;
    return `${y}-${m}-${d}`;
  }

  getPromptQuotaStorageKey() {
    // tie quota to the logged-in user
    const email = (this.getSession().email || "anonymous").toLowerCase();
    return `prompt_quota_v1:${email}`;
  }

  getPromptQuotaStatus() {
    const key = this.getPromptQuotaStorageKey();
    const today = this.getTodayKey();
    const limit = this.getPromptDailyLimit();

    let data = null;
    try {
      data = JSON.parse(localStorage.getItem(key) || "null");
    } catch {
      data = null;
    }

    // reset if missing or different day
    if (!data || data.date !== today || typeof data.count !== "number") {
      data = { date: today, count: 0 };
      localStorage.setItem(key, JSON.stringify(data));
    }

    return {
      date: data.date,
      used: data.count,
      remaining: Math.max(0, limit - data.count),
      limit,
    };
  }

  canUsePromptRequest() {
    const { remaining } = this.getPromptQuotaStatus();
    return remaining > 0;
  }

  /**
   * Call this RIGHT BEFORE you send the request
   * @returns {{ok:true, status:object} | {ok:false, status:object}}
   */
  consumePromptRequest() {
    const key = this.getPromptQuotaStorageKey();
    const today = this.getTodayKey();
    const limit = this.getPromptDailyLimit();

    const status = this.getPromptQuotaStatus();
    if (status.used >= limit) {
      return { ok: false, status };
    }

    const next = { date: today, count: status.used + 1 };
    localStorage.setItem(key, JSON.stringify(next));
	
	// best-effort sync to backend
    this.#syncPromptQuotaToBackend().catch(() => {});

    return { ok: true, status: this.getPromptQuotaStatus() };
  }

  /**
   * Optional: if request fails (network/500), you can “refund” the count.
   */
  refundPromptRequest() {
    const key = this.getPromptQuotaStorageKey();
    const today = this.getTodayKey();
    const status = this.getPromptQuotaStatus();

    if (status.date !== today) return;

    const nextCount = Math.max(0, status.used - 1);
    localStorage.setItem(key, JSON.stringify({ date: today, count: nextCount }));
	this.#syncPromptQuotaToBackend().catch(() => {});
  }

  
  canConfirmProjectOwner(projectEmail) {
    const loggedEmail = String(this.getSession().email || "").trim().toLowerCase();
    const ownerEmail = String(projectEmail || "").trim().toLowerCase();
    return !!loggedEmail && !!ownerEmail && loggedEmail === ownerEmail;
  }
  
  // ---- backend session (users.session) ----
  async getBackendSession() {
    const { res, data, error } = await this.authedFetch("/me/session", { method: "GET" });
    if (error === "NO_TOKEN") return { ok: false, error: "NO_TOKEN" };
    if (!res?.ok) return { ok: false, error: data?.error || "FAILED_TO_GET_SESSION" };
    return { ok: true, session: data?.session || {} };
  }

  async putBackendSession(sessionObj) {
    const { res, data, error } = await this.authedFetch("/me/session", {
      method: "PUT",
      body: { session: sessionObj || {} },
    });
    if (error === "NO_TOKEN") return { ok: false, error: "NO_TOKEN" };
    if (!res?.ok) return { ok: false, error: data?.error || "FAILED_TO_SAVE_SESSION" };
    return { ok: true, session: data?.session || {} };
  }

  async #syncPromptQuotaToBackend() {
    if (!this.isLoggedIn()) return;

    const key = this.getPromptQuotaStorageKey();
    let local = null;
    try {
      local = JSON.parse(localStorage.getItem(key) || "null");
    } catch {
      local = null;
    }
    if (!local || typeof local.date !== "string" || typeof local.count !== "number") return;

    // Get current backend session, merge promptQuota, then PUT
    const sessRes = await this.getBackendSession();
    if (!sessRes.ok) return;

    const nextSession = { ...(sessRes.session || {}) };
    nextSession.promptQuota = { date: local.date, count: local.count };

    await this.putBackendSession(nextSession);
  }

}
