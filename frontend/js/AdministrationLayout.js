// js/AdministrationLayout.js
import { getLanguageManager } from "./Utils/LanguageManager.js";
import { AIProjectPrompting } from "./Utils/AIProjectPrompting.js";
import { UserManager } from "./Utils/UserManager.js";
import { Utilities } from "./Utils/Utilities.js";
import { ConversationProject } from "./classification/ConversationProject.js";

export class AdministrationLayout {
  constructor({ documentRef = document, windowRef = window } = {}) {
    this.document = documentRef;
    this.window = windowRef;

    // === state that was previously "let ..." ===
    this.CURRENT_PROJECT = null;
    this.conversationProject = null;
    this.CATEGORIES = [];
    this.projectSaved = false;

    // will be set during init()
    this.langManager = null;
    this.userManager = null;
  }

  // ---- session helpers (previously getToken/getEmail/getName) ----
  getToken() { return sessionStorage.getItem("auth_token"); }
  getEmail() { return sessionStorage.getItem("auth_email"); }
  getName()  { return sessionStorage.getItem("auth_name"); }

  // ---- tiny DOM helpers ----
  el(id) { return this.document.getElementById(id); }

  setMsg(text, kind) {
    const el = this.el("msg");
    if (!el) return;
    el.textContent = text || "";
    el.className = "msg" + (kind ? (" " + kind) : "");
  }

  // ===== public entry point =====
  async init() {
    this.showLoadingOverlay("Loading data...");

    this.langManager = await getLanguageManager({
      basePath: "/i18n",
      lang: localStorage.getItem("app_lang") || "en",
      fallbackLang: "en",
      preload: ["es", "en", "ca"]
    });

    // Keep your existing globals if other modules rely on them
    this.window.languageManager = this.langManager;

    this.langManager.applyToDOM();

    this.userManager = new UserManager({ langManager: this.langManager });
    this.window.userManager = this.userManager;

    // enforce login
    if (!this.userManager.requireAuth({ redirectTo: "login.html" })) return;

    // show session info
    const { email, name } = this.userManager.getSession();
    const loggedInAs = this.langManager.t("adm.logged.in.as");
    const loggedSuccess = this.langManager.t("adm.logged.success.in");
    this.el("userLine").textContent = email ? `${loggedInAs} ${email}` : loggedSuccess;
    this.el("userName").textContent = name ? `👤 ${name}` : `👤 ${this.langManager.t("adm.no.name")}`;

    // Custom event (kept as-is)
    this.document.addEventListener("overlay-closed", () => {
      if (this.projectSaved) {
        this.projectSaved = false;
        location.href = "administration.html";
      }
    });

    // Wire everything
    this.wireStaticEvents();

    try {
      await this.loadCategories();
      await this.loadProject();
    } catch (err) {
      console.error(err);
      this.showOverlayHTML(`<div style="padding:16px;font-family:system-ui">
        <b>Error</b><br/>Failed to load data.
      </div>`);
    } finally {
      this.hideLoadingOverlay();
    }

    // wiring that depends on categories/project
    this.wireFindOutCategoryButton();
    this.wireTemplateButtons();

    this.initLanguageDropdown({
      selectId: "langSelect",
      supported: ["en", "es", "ca"],
    });
  }


  /**
   * Initialize a language dropdown for any page.
   * Assumes window.languageManager is already set.
   */
  initLanguageDropdown({
    selectId = "langSelect",
    supported = ["en", "es", "ca"],
    labels = { en: "English", es: "Español", ca: "Català" },
    storageKey = "app_lang",
  } = {}) {
    const select = document.getElementById(selectId);
    const lm = window.languageManager;
    if (!select || !lm) return;

    // Build options
    select.innerHTML = "";
    supported.forEach(code => {
      const opt = document.createElement("option");
      opt.value = code;
      opt.textContent = labels[code] || code;
      select.appendChild(opt);
    });

    // Set current value
    const current = localStorage.getItem(storageKey) || lm.lang || "en";
    select.value = supported.includes(current) ? current : supported[0];

    // On change
    select.addEventListener("change", async () => {
      const next = select.value;

      // Persist preference
      localStorage.setItem(storageKey, next);

      // Update language manager
      // (use whichever API your LanguageManager provides)
      if (typeof lm.setLang === "function") {
        await lm.setLang(next);
      } else {
        // fallback: if your manager expects direct assignment + reload of dictionaries
        lm.lang = next;
        if (typeof lm.load === "function") await lm.load(next);
      }

      // Apply translations immediately
      if (typeof lm.applyToDOM === "function") lm.applyToDOM();

      // Optional: if some texts are set by JS (not via data-i18n)
      // you might want to dispatch a global event so pages can refresh dynamic labels
      document.dispatchEvent(new CustomEvent("language-changed", { detail: { lang: next } }));
    });
  }

  // ===============================
  // Wiring
  // ===============================
  wireStaticEvents() {
    // Preview triggers
    ["videopitch", "canvas", "summary"].forEach(id => {
      const input = this.el(id);
      if (!input) return;
      input.addEventListener("input", () => this.loadPreviews());
      input.addEventListener("change", () => this.loadPreviews());
      input.addEventListener("blur", () => this.loadPreviews());
    });

    this.el("btnPreviewDetail")?.addEventListener("click", () => this.previewDetail());
    this.el("closeDetailOverlay")?.addEventListener("click", () => this.hideOverlay());

    this.el("btnGo")?.addEventListener("click", () => { location.href = "classification.html"; });

    this.el("btnSave")?.addEventListener("click", () => this.saveProject());
    this.el("btnDeleteProject")?.addEventListener("click", () => this.deleteProject());
    this.el("btnDeleteUser")?.addEventListener("click", () => this.deleteUserAndProjects());

    this.el("btnEditUserName")?.addEventListener("click", () => this.changeUserName());
    this.el("btnLogout")?.addEventListener("click", () => {
      this.userManager.logout({ redirectTo: "login.html" });
    });

    this.el("btnConversation")?.addEventListener("click", async () => {
      const overlay = this.el("conversationOverlay");
      const body = this.el("sc-overlay-body");
      if (!overlay || !body || !this.conversationProject) return;

      overlay.style.display = "block";
      const html = await this.conversationProject.renderConversationHTML(true);
      body.innerHTML = html;
      this.conversationProject.setupEvents();
    });

    this.el("closeConversationOverlay")?.addEventListener("click", () => {
      const overlay = this.el("conversationOverlay");
      if (overlay) overlay.style.display = "none";
    });
  }

  // ===============================
  // Categories
  // ===============================
  async loadCategories() {
    const res = await fetch(`${this.window.languageManager.t("url.base")}/categories`);
    const cats = await res.json();
    this.CATEGORIES = Array.isArray(cats) ? cats : [];

    const sel = this.el("category_id");
    if (!sel) return;
    sel.innerHTML = "";

    const opt0 = this.document.createElement("option");
    opt0.value = "";
    opt0.textContent = this.window.languageManager.t("adm.select.a.category");
    sel.appendChild(opt0);

    this.CATEGORIES.forEach(c => {
      const opt = this.document.createElement("option");
      opt.value = c.id;
      opt.textContent = (c.labelLong || c.labelShort || c.id);
      sel.appendChild(opt);
    });
  }

  setSelectedCategory(catId) {
    const sel = this.el("category_id");
    if (!sel) return;
    const v = (catId ?? "").toString();
    const exists = Array.from(sel.options).some(o => o.value === v);
    sel.value = exists ? v : "";
  }

  getSelectedCategoryObj() {
    const id = (this.el("category_id")?.value || "").toString();
    return this.CATEGORIES.find(c => (c.id ?? "").toString() === id) || null;
  }

  // ===============================
  // Template buttons
  // ===============================
  wireTemplateButtons() {
    this.document.querySelectorAll(".template-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const url = btn.getAttribute("data-template-url");
        this.showPdfTemplateInOverlay(url);
      });
    });
  }

  // ===============================
  // Find out category
  // ===============================
  wireFindOutCategoryButton() {
    const btn = this.el("btnFindOutCategoryOfProject");
    if (!btn) return;

    btn.addEventListener("click", () => {
      const promptingFindOutCategory = new AIProjectPrompting({
        baseUrl: this.window.languageManager.t("url.base"),
        userManager: this.window.userManager,
        getContext: () => {
          const category = this.getSelectedCategoryObj();
          return {
            category,
            rubric: category?.rubric || "",
            title: (this.el("title")?.value || "").trim(),
            canvas: (this.el("canvas")?.value || "").trim(),
            summary: (this.el("summary")?.value || "").trim(),
            script: (this.el("script")?.value || "").trim(),
            projectId: this.CURRENT_PROJECT?.id || null
          };
        }
      });

      const missing = promptingFindOutCategory.getMissingResources(false);
      if (missing.length) {
        this.showOverlayHTML(promptingFindOutCategory.renderMissingResourcesFindOutCategory(missing));
        return;
      }

      const preview = promptingFindOutCategory.buildFindCategoryPromptPreview(this.CATEGORIES);
      const realPrompt = promptingFindOutCategory.buildFindCategoryPromptReal(this.CATEGORIES);

      promptingFindOutCategory.openEvalOverlay(
        this.document,
        preview,
        this.window.languageManager.t("adm.find.category"),
        this.window.languageManager.t("adm.review.prompt"),
        this.window.languageManager.t("adm.confirm.and.find"),
        async () => {
          const msg = this.el("evalOverlayMsg");
          if (msg) { msg.className = "msg"; msg.textContent = this.window.languageManager.t("adm.finding.category"); }

          const result = await promptingFindOutCategory.findOutCategory({ prompt: realPrompt });
          if (result?.ok === false && result.error === "DAILY_LIMIT") {
            const q = result.quota;
            alert(`${this.window.languageManager.t("word.daily.limit.reached")} (${q.used}/${q.limit}). ${this.window.languageManager.t("word.try.again.tomorrow")}`);
            return;
          }

          this.setSelectedCategory(result?.category_name);
          this.el("description").value = result?.project_short_description || "";

          let messageResult = `<h3>${this.window.languageManager.t("adm.recomended.category")}<strong>${Utilities.escapeHtml(result?.category_description || "—")}</strong>`;
          messageResult += result?.project_short_description
            ? `<br/><br/>${this.window.languageManager.t("adm.project.summary")} ${Utilities.escapeHtml(result.project_short_description)}`
            : "</h3>";

          this.showOverlayHTML(messageResult);

          setTimeout(() => { this.closeGlobalOverlay(); }, 250);
        }
      );
    });
  }

  // ===============================
  // Project load/save/delete
  // ===============================
  async apiFetch(path, { method = "GET", body = null } = {}) {
    const token = this.getToken();
    if (!token) {
      location.href = "login.html";
      return;
    }

    const res = await fetch(`${this.window.languageManager.t("url.base")}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: body ? JSON.stringify(body) : null
    });

    const data = await res.json().catch(() => ({}));
    return { res, data };
  }

  async loadProject() {
    this.setMsg("", "");
    const { res, data, error } = await this.userManager.authedFetch("/my/project");
    if (error === "NO_TOKEN") return this.userManager.logout({ redirectTo: "login.html" });
    if (!res) return;

    if (!res.ok) {
      this.setMsg(data?.error || this.window.languageManager.t("adm.failed.to.load.project"), "err");
      this.renderEvaluation(null);
      return;
    }

    this.CURRENT_PROJECT = data;

    // Fill fields
    this.el("title").value = data.title || "";
    this.el("description").value = data.description || "";
    this.el("authors").value = data.authors || "";
    this.el("link").value = data.link || "";
    this.el("script").value = data.script || "";
    this.el("videopitch").value = data.pitch || "";
    this.el("canvas").value = data.canvas || "";
    this.el("summary").value = data.summary || "";
    this.el("detail").value = data.detail || "";
    this.el("score").value = (data.score === null || data.score === undefined) ? "—" : String(data.score);

    this.setSelectedCategory(data.category_id);

    this.renderEvaluation(data.evaluation || null);
    this.loadPreviews();

    this.conversationProject = new ConversationProject({
      baseUrl: this.window.languageManager.t("url.base"),
      getToken: () => this.getToken(),
      getContext: () => ({
        projectId: this.CURRENT_PROJECT?.id,
        projecttitle: this.CURRENT_PROJECT?.title,
        projectconversation: this.CURRENT_PROJECT?.conversation || []
      })
    });
  }

  async saveProject() {
    this.setMsg("", "");
    this.showOverlayMessage(this.window.languageManager.t("adm.saving.progress"));

    const payload = {
      category_id: this.el("category_id").value,
      title: this.el("title").value.trim(),
      description: this.el("description").value.trim(),
      authors: this.el("authors").value.trim(),
      link: this.el("link").value.trim(),
      pitch: this.el("videopitch").value.trim(),
      canvas: this.el("canvas").value.trim(),
      summary: this.el("summary").value.trim(),
      script: this.el("script").value.trim(),
      detail: this.el("detail").value
    };

    const { res, data } = await this.apiFetch("/my/project", { method: "PUT", body: payload });
    if (!res) { this.hideOverlay(); return; }

    if (!res.ok) {
      this.setMsg(data?.error || this.window.languageManager.t("adm.save.failed"), "err");
      this.hideOverlay();
      return;
    }

    this.projectSaved = true;
    this.showOverlayMessage(this.window.languageManager.t("adm.saved.project.completed"));
    this.setMsg(this.window.languageManager.t("adm.saved.project.successfully"), "ok");

    if (data?.project) {
      this.el("score").value = (data.project.score ?? "—");
      this.renderEvaluation(data.project.evaluation || null);
    }
  }

  async deleteProject() {
    if (!confirm(this.window.languageManager.t("adm.delete.your.project.cannot.be.undone"))) return;

    const { res, data } = await this.apiFetch("/my/project", { method: "DELETE" });
    if (!res) return;

    if (!res.ok) {
      this.setMsg(data?.error || this.window.languageManager.t("adm.delete.failed"), "err");
      return;
    }

    this.setMsg(this.window.languageManager.t("adm.project.deleted"), "ok");
    ["title","description","authors","link","script","videopitch","canvas","summary","detail","score"].forEach(id => {
      this.el(id).value = "";
    });
    this.renderEvaluation(null);
    this.loadPreviews();
  }

  async deleteUserAndProjects() {
    if (!confirm(this.window.languageManager.t("adm.delete.everything.cannot.be.undone"))) return;

    const result = await this.userManager.deleteMe();
    if (!result.ok) {
      this.setMsg(result.error, "err");
      return;
    }

    location.href = "register.html";
  }

  // ===============================
  // Preview / overlay / evaluation
  // ===============================
  setIframe(iframeId, url) {
    const f = this.el(iframeId);
    if (!f) return;
    f.src = (url || "").trim();
  }

  loadPreviews() {
    const embeddedVideo = Utilities.formatVideoUrl(this.el("videopitch").value);
    this.setIframe("videoFrame", embeddedVideo);
    this.setIframe("canvasFrame", this.el("canvas").value);
    this.setIframe("summaryFrame", this.el("summary").value);
  }

  previewDetail() {
    const detail = this.el("detail").value;
    this.showOverlayHTML(detail);
  }

  showOverlayHTML(htmlData) {
    const frame = this.el("overlayDetailFrame");
    frame.srcdoc = htmlData;
    this.el("detailOverlay").style.display = "block";
  }

  hideOverlay() {
    this.el("detailOverlay").style.display = "none";
    this.el("overlayDetailFrame").style.display = "block";
    this.el("overlayMessage").style.display = "none";
    this.document.dispatchEvent(new CustomEvent("overlay-closed"));
  }

  showOverlayMessage(text) {
    this.el("overlayDetailFrame").style.display = "none";
    this.el("overlayMessage").style.display = "block";
    this.el("overlayMessageText").textContent = text;
    this.el("detailOverlay").style.display = "block";
  }

  closeGlobalOverlay() {
    this.el("evalOverlay").style.display = "none";
  }

  renderEvaluation(result) {
    const mount = this.el("evaluationMount");
    const totalEvaluation = AIProjectPrompting.renderEvaluationHTML(result, true);
    mount.innerHTML = totalEvaluation;

    if (totalEvaluation.length < 200) {
      mount.innerHTML = `
        <div class="sc-empty" style="margin-bottom:10px;">${this.window.languageManager.t("adm.no.evaluation.stored.yet")}</div>
        <div class="btnrow" style="justify-content:flex-start;">
          <button class="primary" id="btnEvaluateProject" type="button">${this.window.languageManager.t("adm.proceed.evaluate.project")}</button>
        </div>
      `;
    }
    this.wireEvaluateButton();
  }

  wireEvaluateButton() {
    const btn = this.el("btnEvaluateProject");
    if (!btn) return;

    btn.addEventListener("click", () => {
      const promptingEvaluateProject = new AIProjectPrompting({
        baseUrl: this.window.languageManager.t("url.base"),
        userManager: this.window.userManager,
        getContext: () => {
          const category = this.getSelectedCategoryObj();
          return {
            category,
            rubric: category?.rubric || "",
            title: (this.el("title")?.value || "").trim(),
            canvas: (this.el("canvas")?.value || "").trim(),
            summary: (this.el("summary")?.value || "").trim(),
            script: (this.el("script")?.value || "").trim(),
            projectId: this.CURRENT_PROJECT?.id || null
          };
        }
      });

      const missing = promptingEvaluateProject.getMissingResources();
      if (missing.length) {
        this.showOverlayHTML(promptingEvaluateProject.renderMissingResourcesApplyRubric(missing));
        return;
      }

      const preview = promptingEvaluateProject.buildEvaluationPromptPreview();
      const realPrompt = promptingEvaluateProject.buildEvaluationPromptReal();

      promptingEvaluateProject.openEvalOverlay(
        this.document,
        preview,
        this.window.languageManager.t("adm.ai.evaluation"),
        this.window.languageManager.t("adm.review.evaluation.prompt"),
        this.window.languageManager.t("adm.confirm.and.evaluate"),
        async () => {
          const msg = this.el("evalOverlayMsg");
          if (msg) { msg.className = "msg"; msg.textContent = this.window.languageManager.t("adm.evaluation.few.seconds"); }

          const result = await promptingEvaluateProject.evaluateProject({ projectId: this.CURRENT_PROJECT.id, prompt: realPrompt });
          if (result?.ok === false && result.error === "DAILY_LIMIT") {
            const q = result.quota;
            this.closeGlobalOverlay();
            alert(`${this.window.languageManager.t("word.daily.limit.reached")} (${q.used}/${q.limit}). ${this.window.languageManager.t("word.try.again.tomorrow")}`);
            return;
          }

          if (Number.isFinite(result?.score)) {
            this.el("score").value = String(Math.round(result.score));
          }
          this.renderEvaluation(result);

          if (msg) { msg.className = "msg"; msg.textContent = this.window.languageManager.t("adm.evaluation.updated"); }
          setTimeout(() => { this.closeGlobalOverlay(); }, 250);
        }
      );
    }, { once: true }); // optional: prevents multiple handlers if you rerender
  }

  async changeUserName() {
    const current = this.userManager.getSession().name || "";
    const next = prompt(this.window.languageManager.t("adm.enter.your.display.name"), current);
    if (!next) return;

    const result = await this.userManager.updateDisplayName(next);
    if (!result.ok) {
      alert(result.error);
      return;
    }
    this.el("userName").textContent = `👤 ${result.name}`;
  }

  showPdfTemplateInOverlay(pdfUrl, title = "Template Document") {
    if (!pdfUrl) { alert("Template URL not configured."); return; }

    const detailEl = this.el("detail");
    const detailText = detailEl ? detailEl.innerText.trim() : "";

    const escHTML = s => String(s)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");

    const escAttr = s => String(s)
      .replaceAll("&", "&amp;")
      .replaceAll('"', "&quot;")
      .replaceAll("<", "%3C")
      .replaceAll(">", "%3E");

    const safeTitle = escHTML(title);
    const safeUrl = escAttr(pdfUrl);

    const html = `
<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${safeTitle}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    body{ margin:0; font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; background:#fff; }
    header{ display:flex; justify-content:space-between; align-items:center; gap:8px; padding:10px 12px; border-bottom:1px solid #e5e7eb; background:#f9fafb; }
    .title{ font-weight:600; font-size:14px; }
    .btnrow{ display:flex; gap:8px; }
    button{ padding:6px 10px; border-radius:8px; border:1px solid #d1d5db; background:#fff; cursor:pointer; font-size:13px; white-space:nowrap; }
    button:hover{ background:#f3f4f6; }
    .wrap{ height: calc(100vh - 52px); }
    iframe{ width:100%; height:100%; border:0; }
    a{ color:inherit; text-decoration:none; }
  </style>
</head>
<body>
<header>
  <div class="title">${safeTitle}</div>
  <div class="btnrow">
    <button><a href="${safeUrl}" target="_blank" rel="noopener">Open PDF in new Tab</a></button>
  </div>
</header>
<div class="wrap">
  <iframe src="${safeUrl}" title="${safeTitle}"></iframe>
</div>
</body>
</html>
`;
    this.showOverlayHTML(html);
  }

  showLoadingOverlay(message = "Loading...") {
    const safeMsg = String(message)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");

    const html = `
<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    body{ margin:0; font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; background:#fff; }
    .wrap{ height:100vh; display:flex; align-items:center; justify-content:center; padding:24px; }
    .card{ width:min(520px, 92vw); border:1px solid #e5e7eb; border-radius:14px; padding:18px 16px; box-shadow: 0 10px 30px rgba(0,0,0,.08); background:#fff; text-align:center; }
    .spinner{ width:34px; height:34px; border-radius:50%; border:4px solid #e5e7eb; border-top-color:#111827; margin:0 auto 12px auto; animation: spin 1s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .msg{ font-size:14px; color:#111827; font-weight:600; }
    .sub{ margin-top:6px; font-size:12px; color:#6b7280; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <div class="spinner"></div>
      <div class="msg">${safeMsg}</div>
      <div class="sub">Please wait…</div>
    </div>
  </div>
</body>
</html>`;
    this.showOverlayHTML(html);
  }

  hideLoadingOverlay() {
    const overlay = this.el("detailOverlay");
    if (!overlay) return;
    overlay.style.display = "none";
    const frame = this.el("overlayDetailFrame");
    if (frame) frame.srcdoc = "";
  }
}
