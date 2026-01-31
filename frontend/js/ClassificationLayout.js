import { getLanguageManager } from "./Utils/LanguageManager.js";
import { UserManager } from "./Utils/UserManager.js";
import { CategoryGraph } from "./classification/CategoryGraph.js";
import { ProjectRelationshipsGraph } from "./classification/ProjectRelationshipsGraph.js";
import { RankingProjects } from "./classification/RankingProjects.js";
import { AIProjectPrompting } from "./Utils/AIProjectPrompting.js";

export class ClassificationLayout {
  constructor(rootId = "startup-classifier", { userManager } = {}) {
    this.root = document.getElementById(rootId);
    if (!this.root) throw new Error(`Root #${rootId} not found`);
    this.userManager = userManager || window.userManager || null;

    // Sections
    this.left = this.root.querySelector(".sc-left");
    this.right = this.root.querySelector(".sc-right");
    this.title_graph = document.getElementById("sc-title-graph");
	  this.subtitle_graph = document.getElementById("sc-sub-title-graph");

    // Modules
    this.graphs = new Map();
    this.activeGraphKey = null;
    this.activeGraph = null;
    this.ranking = null;

    // State
    this.DATA = null;
    this.categories = [];
    this.selectedCategoryId = sessionStorage.getItem("sc_selectedCategoryId") || "GLOBAL";    

    // Bind
    this.onSelectGraph = this.onSelectGraph.bind(this);
    this.onSelectCategory = this.onSelectCategory.bind(this);
    this.onSelectedRelatedProject = this.onSelectedRelatedProject.bind(this);
    this.onOperationInProgress = this.onOperationInProgress.bind(this);
    this.onEvaluateProject = this.onEvaluateProject.bind(this);
    this.onRelationsProject = this.onRelationsProject.bind(this);
    this.onEvaluatedProject = this.onEvaluatedProject.bind(this);
    this.onComparedProject = this.onComparedProject.bind(this);
    this.onLikesUpdated = this.onLikesUpdated.bind(this);
    this.onOverlayClosed = this.onOverlayClosed.bind(this);
  }
  
    // ===== Overlay helpers (moved from HTML) =====
  static showLoadingOverlay(message) {
    const overlay = document.getElementById("sc-overlay");
    const body = document.getElementById("sc-overlay-body");
    const title = document.getElementById("sc-overlay-title");
    if (!overlay || !body || !title) return;

    title.textContent = message || "Loading...";
    body.innerHTML = `
      <div style="display:flex; align-items:center; gap:12px;">
        <div style="
          width:22px; height:22px; border-radius:50%;
          border:3px solid #e5e7eb; border-top-color:#111827;
          animation: scspin 1s linear infinite;"></div>
        <div style="font-weight:700;">${message || "Loading..."}</div>
      </div>
      <style>@keyframes scspin { to { transform: rotate(360deg); } }</style>
    `;

    overlay.classList.add("sc-show");
    overlay.setAttribute("aria-hidden", "false");
  }

  // ===== Bootstrap =====
  static async bootstrap(rootId = "startup-classifier") {
    const langManager = await getLanguageManager({
      basePath: "/i18n",
      lang: localStorage.getItem("app_lang") || "en",
      fallbackLang: "en",
      preload: ["es", "en", "ca"]
    });

    window.languageManager = langManager;
    langManager.applyToDOM();

    const userManager = new UserManager({ langManager });
    window.userManager = userManager;

    // (Optional, but recommended) require auth like administration
    // if (userManager.requireAuth?.({ redirectTo: "login.html" }) === false) return;

    const loadingMsg = window.languageManager?.t?.("word.loading") || "Loading...";
    ClassificationLayout.showLoadingOverlay(loadingMsg);

    // close button should hide overlay
    document.getElementById("sc-overlay-close")?.addEventListener("click", () => {
      ClassificationLayout.hideOverlay();
    });

    try {
      const layout = new ClassificationLayout(rootId, userManager);
      await layout.init();
      ClassificationLayout.hideOverlay();
    } catch (err) {
      console.error("Classification init error::", err);
      ClassificationLayout.showErrorOverlay("Failed to load data. Please try again.");
    }
  }

  static hideOverlay() {
    const overlay = document.getElementById("sc-overlay");
    if (!overlay) return;
    overlay.classList.remove("sc-show");
    overlay.setAttribute("aria-hidden", "true");
  }

  static showErrorOverlay(message) {
    const overlay = document.getElementById("sc-overlay");
    const body = document.getElementById("sc-overlay-body");
    const title = document.getElementById("sc-overlay-title");
    if (!overlay || !body || !title) return;

    title.textContent = "Error";
    body.innerHTML = `<div style="font-weight:700; color:#b91c1c;">${message}</div>`;
    overlay.classList.add("sc-show");
    overlay.setAttribute("aria-hidden", "false");
  }

  onSelectGraph(e) {    
    const key = e?.detail?.graph;
    if (!key || !this.graphs.has(key)) return;

    if (this.activeGraphKey === key) return;

    // Unmount old
    if (this.activeGraph?.unmount) this.activeGraph.unmount();

    // Mount new
    this.activeGraphKey = key;
    this.activeGraph = this.graphs.get(key);

    if (this.activeGraph?.mount)
    {
      if (this.selectedCategoryId != null && this.activeGraph?.setActiveCategory)
      {
        this.extendedGraphInformation = false;
        this.activeGraph.mount();
        this.activeGraph.setActiveCategory(this.selectedCategoryId);
        this.title_graph.textContent = window.languageManager.t("cla.proposal.classification");
        this.subtitle_graph.textContent = window.languageManager.t("cla.click.on.a.category");
      }
      else
      {
        this.extendedGraphInformation = true;
        const title_selected = e?.detail?.title;
        const relationships = e?.detail?.relationships;
        this.activeGraph.setData(title_selected, relationships);
        this.title_graph.textContent = window.languageManager.t("cla.proposal.relationships");
        this.subtitle_graph.textContent = window.languageManager.t("cla.select.node.for.relationships");
      }
    }
  }

  async init() {
    this.initTopbar();
    this.installEventListeners();

    // Load data + build DATA
    const DATA = await this.loadDataFromBackend();
    this.DATA = DATA;
    this.categories = DATA.categories || [];

    // Create modules
    this.ranking = new RankingProjects(this.root, this.categories);

    // Render Ranking
    this.ranking.init();

    this.likesUpdated = false;
    this.evaluationPerformed = false;
    this.comparisonPerformed = false;
    this.operationInProgress = false;
    this.extendedGraphInformation = false;

    // Select initial category
    const savedCat = sessionStorage.getItem("sc_selectedCategoryId");    
    let initialCat = (savedCat && this.categories.some(c => c.id === savedCat))
      ? savedCat
      : (this.categories[0]?.id || null);
    if (savedCat == "GLOBAL")      
    {
      initialCat = "GLOBAL";
    }    

    // Create graph instances once
    this.graphs.set("categories", new CategoryGraph(this.root, this.categories));
    this.graphs.set("relationships", new ProjectRelationshipsGraph(this.root));

    // Listen
    document.addEventListener("select-graph", this.onSelectGraph);
    document.addEventListener("select-category", this.onSelectCategory);
    document.addEventListener("select-related-project", this.onSelectedRelatedProject); 

    // Default graph
    document.dispatchEvent(new CustomEvent("select-graph", { detail: { graph: "categories" } }));

    // Default category selection (optional)
    if (initialCat != null) {
      document.dispatchEvent(new CustomEvent("select-category", { detail: { category: initialCat } }));
    }
  }

  installEventListeners() {
    document.addEventListener("select-category", this.onSelectCategory);
    document.addEventListener("operation-in-progress", this.onOperationInProgress);    
    document.addEventListener("evaluate-project", this.onEvaluateProject);
    document.addEventListener("relations-project", this.onRelationsProject);    
    document.addEventListener("evaluated-project", this.onEvaluatedProject);
    document.addEventListener("compared-project", this.onComparedProject);    
    document.addEventListener("likes-updated", this.onLikesUpdated);
    document.addEventListener("overlay-closed", this.onOverlayClosed);    
  }

  onSelectCategory(e) {
    if (this.operationInProgress)
    {
      alert(window.languageManager.t("cla.wait.until.ai.request.finishes"));
    }
    else
    {
      const categoryId = e?.detail?.category;
      if (categoryId == null) return;

      this.selectedCategoryId = categoryId;
      sessionStorage.setItem("sc_selectedCategoryId", categoryId);    

      // Update whichever graph is active (if it supports it)
      if (this.activeGraph?.setActiveCategory) {
        this.activeGraph.setActiveCategory(categoryId);
      }

      // Update right panel (unchanged)
      this.ranking?.renderCategory(categoryId);
    }
  }

  onSelectedRelatedProject(e)
  {
      const { selectedTitle, related, total_data } = e.detail;
      // Update right panel (unchanged)
      this.ranking?.renderRelatedProject(related, total_data);
  }

  onOperationInProgress(e){
    this.operationInProgress = true;
  }

  onLikesUpdated(e) {
    this.likesUpdated = true;
  }

  onEvaluatedProject(e) {
    this.evaluationPerformed = true;
    this.operationInProgress = false;
  }

  onComparedProject(e) {
    this.comparisonPerformed = true;
    this.operationInProgress = false;
  }

  onOverlayClosed(e) {
    if (this.likesUpdated || this.evaluationPerformed || this.comparisonPerformed)
    {
      this.likesUpdated = false;
      this.evaluationPerformed = false;
      this.comparisonPerformed = false;
      this.operationInProgress = false;
      location.href = "classification.html";
    }
    if (this.extendedGraphInformation)
    {
      this.extendedGraphInformation = false;
      document.dispatchEvent(new CustomEvent("select-graph", { detail: { graph: "categories" } }));
    }
  }

  onRelationsProject(e) { 
    const { project, category } = e?.detail || {};
    if (!project || !category) return;

    const savedCat = sessionStorage.getItem("sc_selectedCategoryId"); 

    let is_global = false;
    let projectToRelate = null;
    if (savedCat == "GLOBAL")
    {      
      is_global = true;
      const allProjects = [];
      this.categories.forEach(c => {
        (c.projects || []).forEach(p => {
          allProjects.push(p);
        });
      });
      projectToRelate = allProjects.filter(p => p.id !== project.id);
    }
    else
    {
      is_global = false;
      projectToRelate = category.projects.filter(p => p.id !== project.id);
    }

    const promptingRelationshipsProject = new AIProjectPrompting({
      baseUrl: window.languageManager.t("url.base"),
      userManager: this.userManager,
      getContext: () => ({
        category,
        rubric: category?.rubric || "",
        title: project.title || "",
        canvas: project.resources?.canvas || "",
        summary: project.resources?.summary || "",
        script: project.resources?.pitchscript || "",
        projectId: project?.id || null,
        otherProjects: projectToRelate
      })
    });

    const missing = promptingRelationshipsProject.getMissingResources();
    if (missing.length) {
      this.ranking?.showOverlay("Missing Resources", promptingRelationshipsProject.renderMissingResourcesRelationship(missing));
      return;
    }

    const preview = promptingRelationshipsProject.buildRelationshipsPromptPreview();
    const realPrompt = promptingRelationshipsProject.buildRelationshipsPromptReal();
    const canConfirm = this.userManager?.canConfirmProjectOwner?.(project.email) ?? false;
    
    const messageButton = canConfirm ? `${window.languageManager.t("cla.confirm.and.compare")}` : `${window.languageManager.t("cla.copy.to.clipboard")}`;
    promptingRelationshipsProject.openEvalOverlay(
      document,
      preview,
      window.languageManager.t("adm.ai.evaluation"),
      window.languageManager.t("cla.review.comparator.prompt"),
      messageButton,
      async () => {
        const msg = document.getElementById("evalOverlayMsg");
        if (msg) { msg.className = "msg"; msg.textContent = window.languageManager.t("cla.comparing.to.other.projects"); }

        if (canConfirm) {
          document.dispatchEvent(new CustomEvent("operation-in-progress"));
          const result = await promptingRelationshipsProject.compareProjects({ projectId: project.id, title: project.title, is_global: is_global, prompt: realPrompt });
          this.ranking?.closeOverlays();
          if (result?.ok === false && result.error === "DAILY_LIMIT") {            
            const q = result.quota;
            const wordDailyReached = window.languageManager.t("word.daily.limit.reached");
            const wordTryTomorrow = window.languageManager.t("word.try.again.tomorrow");
            alert(`${wordDailyReached} (${q.used}/${q.limit}). ${wordTryTomorrow}`);
            return;
          }          
          document.dispatchEvent(new CustomEvent("compared-project"));
          const html = AIProjectPrompting.renderComparisonHTML(result, {
            title: window.languageManager.t("cla.comparison.results"),
            subtitle: window.languageManager.t("cla.matches.vs.other.projects")
          });
          this.ranking?.showOverlay("Comparison", html);
          document.dispatchEvent(new CustomEvent("select-graph", { detail: { graph: "relationships", title: project.title, relationships: result } }));
        } else {
          try {
            await navigator.clipboard.writeText(preview);
            this.ranking?.closeOverlays();
            this.ranking?.showOverlay(window.languageManager.t("cla.prompt.copied"), window.languageManager.t("cla.prompt.copied.to.clipboard"));
          } catch (err) {
            if (msg) { msg.className = "msg error"; msg.textContent = window.languageManager.t("cla.failed.to.copy"); }
          }
        }
      }
    );

  }

  async onEvaluateProject(e) {
    // If you prefer evaluate to live inside RankingProjects, you can remove this handler
    // and keep it inside RankingProjects instead. But this keeps it centralized.
    const { project, category } = e?.detail || {};
    if (!project || !category) return;

    const promptingEvaluateProject = new AIProjectPrompting({
      baseUrl: window.languageManager.t("url.base"),
      userManager: window.userManager,
      getContext: () => ({
        category,
        rubric: category?.rubric || "",
        title: project.title || "",
        canvas: project.resources?.canvas || "",
        summary: project.resources?.summary || "",
        script: project.resources?.pitchscript || "",
        projectId: project?.id || null
      })
    });

    const missing = promptingEvaluateProject.getMissingResources();
    if (missing.length) {
      this.ranking?.showOverlay(window.languageManager.t("word.missing.resources"), promptingEvaluateProject.renderMissingResourcesApplyRubric(missing));
      return;
    }

    const preview = promptingEvaluateProject.buildEvaluationPromptPreview();
    const realPrompt = promptingEvaluateProject.buildEvaluationPromptReal();
    const canConfirm = this.userManager?.canConfirmProjectOwner?.(project.email) ?? false;

    const messageButton = canConfirm ? window.languageManager.t("adm.confirm.and.evaluate") : window.languageManager.t("cla.copy.to.clipboard");

    promptingEvaluateProject.openEvalOverlay(
      document,
      preview,
      window.languageManager.t("adm.ai.evaluation"),
      window.languageManager.t("adm.review.evaluation.prompt"),
      messageButton,
      async () => {
        const msg = document.getElementById("evalOverlayMsg");
        if (msg) { msg.className = "msg"; msg.textContent = window.languageManager.t("cla.evaluating.may.take.few.seconds"); }

        if (canConfirm) {
          document.dispatchEvent(new CustomEvent("operation-in-progress"));
          const result = await promptingEvaluateProject.evaluateProject({ projectId: project.id, prompt: realPrompt });
          this.ranking?.closeOverlays();
          if (result?.ok === false && result.error === "DAILY_LIMIT") {            
            const q = result.quota;
            const wordDailyReached = window.languageManager.t("word.daily.limit.reached");
            const wordTryTomorrow = window.languageManager.t("word.try.again.tomorrow");
            alert(`${wordDailyReached} (${q.used}/${q.limit}). ${wordTryTomorrow}`);
            return;
          }
          document.dispatchEvent(new CustomEvent("evaluated-project"));
          this.ranking?.showOverlay(window.languageManager.t("cla.evaluation.result"), AIProjectPrompting.renderEvaluationHTML(result, false));
        } else {
          try {
            await navigator.clipboard.writeText(preview);
            this.ranking?.closeOverlays();
            this.ranking?.showOverlay(window.languageManager.t("cla.prompt.copied"), window.languageManager.t("cla.prompt.fully.copied.to.clipboard"));
          } catch (err) {
            if (msg) { msg.className = "msg error"; msg.textContent = window.languageManager.t("cla.failed.to.copy.to.clipboard"); }
          }
        }
      }
    );
  }

  initTopbar() {
    const email = (this.userManager?.getSession?.().email || "").trim();
    const userLine = document.getElementById("userLine");
    const loggedInAs = window.languageManager.t("adm.logged.in.as");
    const loggedIn = window.languageManager.t("adm.logged.success.in");    
    if (userLine) userLine.textContent = email ? `${loggedInAs} ${email}` : loggedIn;

    const btnGoAdmin = document.getElementById("btnGoAdmin");
    if (btnGoAdmin) btnGoAdmin.addEventListener("click", () => {
      location.href = "administration.html";
    });
  }

  getLoggedEmail() {
    return String(this.userManager?.getSession?.().email || "").trim().toLowerCase();
  }

  getProjectOwnerEmail(project) {
    return String(project?.email || "").trim().toLowerCase();
  }

  async loadDataFromBackend() {
    const [categoriesRes, projectsRes] = await Promise.all([
      fetch(window.languageManager.t("url.base") + "/categories"),
      fetch(window.languageManager.t("url.base") + "/projects")
    ]);

    const categories = await categoriesRes.json();
    const projects = await projectsRes.json();
    return this.buildDATA(categories, projects);
  }

  buildDATA(categoriesRaw, projectsRaw) {
    const categoryMap = new Map();

    categoriesRaw.forEach(cat => {
      console.log("")
      categoryMap.set(cat.id, {
        uid: cat.uid,
        id: cat.id,
        color: cat.color,
        labelShort: cat.labelShort,
        labelActiveShort: cat.labelActiveShort,
        labelLong: cat.labelLong,
        rubric: cat.rubric,
        traits: this.parseTraits(cat.traits),
        projects: []
      });
    });

    projectsRaw.forEach(p => {
      const cat = categoryMap.get(p.category_id);
      if (!cat) return;

      const singleProject = {
        id: p.id,
        email: p.email,
        title: p.title,
        description: p.description,
        authors: p.authors,
        link: p.link,
        detail: p.detail,
        videoembed: p.videoembed,
        resources: {
          pitch: p.pitch,
          canvas: p.canvas,
          summary: p.summary,
          pitchscript: p.script
        },
        score: p.score,
        evaluation: p.evaluation,
        conversation: p.conversation,
        likes: p.likes,
        local: p.local,
        global: p.global,
      }
      cat.projects.push(singleProject);
    });

    return { categories: Array.from(categoryMap.values()) };
  }

  parseTraits(traits) {
    if (!traits) return [];
    if (Array.isArray(traits)) return traits;
    try { 
      const arrayTraits = traits
            .replace(/[{}]/g, '')   // remove { }
            .split(',')             // split by commas
            .map(s => s.trim().replace(/^"|"$/g, '')); // clean quotes
      return arrayTraits; 
    } catch { return []; }
  }

}

