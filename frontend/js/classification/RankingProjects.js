import { ConversationProject } from "./ConversationProject.js";
import { LikesProject } from "./LikesProject.js";
import { Utilities } from "../Utils/Utilities.js";
import { AIProjectPrompting } from "../Utils/AIProjectPrompting.js";

export class RankingProjects {
  constructor(root, categories) {
    this.root = root;
    this.categories = categories || [];
    this.projectIndex = new Map();

    // Right panel elements
    this.panelTitle = this.root.querySelector("#sc-panel-title");
    this.panelCount = this.root.querySelector("#sc-panel-count");
    this.traitsEl = this.root.querySelector("#sc-traits");
    this.projectsEl = this.root.querySelector("#sc-projects");
    this.rubricEl = this.root.querySelector("#sc-rubric");

    // Overlay
    this.overlay = this.root.querySelector("#sc-overlay");
    this.overlayBody = this.root.querySelector("#sc-overlay-body");

    this.sortMode = sessionStorage.getItem("sc_sortMode") || "score";
    this.currentCategoryId = null;   
  }

  async init() {
    this.indexProjects();
    this.wireOverlays();
    this.wireRankingToggles();
  }

  indexProjects() {
    this.projectIndex = new Map();
    this.categories.forEach(cat => {
      (cat.projects || []).forEach(p => {
        const key = p.id ?? p.title;
        this.projectIndex.set(String(key), { project: p, category: cat });
      });
    });
  }

  wireRankingToggles() {
    // Event delegation: pills are created dynamically per render.
    this.root.addEventListener("click", (e) => {
      const likesPill = e.target.closest(".sc-likes-pill");
      const scorePill = e.target.closest(".sc-score-pill");

      // If click is not on either pill, ignore
      if (!likesPill && !scorePill) return;

      // Prevent triggering the card expand/collapse (your card button click handler)
      e.preventDefault();
      e.stopPropagation();

      const nextMode = likesPill ? "likes" : "score";
      if (this.sortMode === nextMode) return;
      
      this.sortMode = nextMode;
      sessionStorage.setItem("sc_sortMode", this.sortMode);

      // Re-render the currently active category
      if (this.currentCategoryId) {
        this.renderCategory(this.currentCategoryId);
      }
    }, true);
  }

  wireOverlays() {
    const overlayClose = this.root.querySelector("#sc-overlay-close");
    const overlayBackdrop = this.root.querySelector(".sc-overlay-backdrop");

    [overlayClose, overlayBackdrop].forEach(el => {
      if (!el) return;
      el.addEventListener("click", () => this.hideOverlay());
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") this.hideOverlay();
    });

    // Eval overlay close
    const closeEvalOverlay = document.getElementById("closeEvalOverlay");
    if (closeEvalOverlay) {
      closeEvalOverlay.addEventListener("click", () => this.closeOverlays());
    }
    const btnEvalCancel = document.getElementById("btnEvalCancel");
    if (btnEvalCancel) {
      btnEvalCancel.addEventListener("click", () => this.closeOverlays());
    }
  }

  closeOverlays(dispath_event = true) {
    const evalOverlay = document.getElementById("evalOverlay");
    if (evalOverlay) evalOverlay.style.display = "none";
    this.hideOverlay(dispath_event);
  }

  showOverlay(title, html) {
    const titleEl = this.root.querySelector("#sc-overlay-title");
  
    if (titleEl) {
      titleEl.textContent = title || window.languageManager.t("word.information");
    }
  
    this.overlayBody.innerHTML = html;
    this.overlay.classList.add("sc-show");
    this.overlay.setAttribute("aria-hidden", "false");

    document.body.classList.add("sc-modal-open");   // ✅ lock background scroll
  }

  hideOverlay(dispath_event = true) {
    if (!this.overlay) return;
    this.overlay.classList.remove("sc-show");
    this.overlay.setAttribute("aria-hidden", "true");
    if (dispath_event) document.dispatchEvent(new CustomEvent("overlay-closed"));
    document.body.classList.remove("sc-modal-open"); // ✅ unlock
  }

  renderCategory(categoryId) {
    this.closeOverlays();
    this.currentCategoryId = categoryId; 
    console.log(window.languageManager.t("cla.rendering.category"), this.currentCategoryId);

    const cat = this.categories.find(c => c.id === categoryId) || this.categories[0];
    if (!cat) return;

    // Title & count
    if (this.panelTitle) this.panelTitle.textContent = cat.labelLong || "";
    const proposalS = window.languageManager.t("cla.proposal(s)");
    if (this.panelCount) this.panelCount.textContent = `${(cat.projects || []).length} ${proposalS}`;

    // Rubric link overlay    
    if (this.rubricEl) 
    {
      if (this.currentCategoryId != "GLOBAL")
      {
          this.rubricEl.innerHTML = "";
          const rubricUrl = String(cat.rubric || "").trim();
          if (rubricUrl) {
            const a = document.createElement("a");
            a.href = rubricUrl;
            a.target = "_blank";
            a.rel = "noopener noreferrer";
            a.textContent = window.languageManager.t("cla.see.rubric.category");
            this.rubricEl.appendChild(a);

            a.addEventListener("click", (e) => {
              e.preventDefault();
              const html = `<iframe src="${rubricUrl}" width="100%" height="500" frameborder="0"></iframe>
                            <br>
                            <div class="evaluation-sub-form">
                            <button onclick="window.open('${rubricUrl}', '_blank')" style="margin-top:10px;">
                              ${window.languageManager.t("cla.open.in.new.tab")}
                            </button></div>`;
              this.showOverlay(window.languageManager.t("word.rubric"), html);
            });
          }
      }    
      else
      {  
        this.rubricEl.innerHTML = ""; 
      }
    }

    // Traits

    if (this.traitsEl) {
      if (this.currentCategoryId != "GLOBAL")
      {
        this.traitsEl.innerHTML = "";        
        (cat.traits || []).forEach(tr => {
          const li = document.createElement("li");
          li.textContent = tr;
          this.traitsEl.appendChild(li);
        });
      }
      else
      {
        this.traitsEl.innerHTML = ""; 
      }
    }

    // Projects list
    if (!this.projectsEl) return;
    this.projectsEl.innerHTML = "";

    if (this.currentCategoryId != "GLOBAL")
    {
      if (!cat.projects || cat.projects.length === 0) {
        const empty = document.createElement("div");
        empty.className = "sc-empty";
        empty.textContent = window.languageManager.t("cla.no.proposal.for.category.yet");
        this.projectsEl.appendChild(empty);
        return;
      }

      const projectsSorted = this.sortProjects(cat.projects);
      projectsSorted.forEach((p, idx) => this.projectsEl.appendChild(this.renderProjectCard(p, cat, idx, false)));
    }    
    else
    {
      // All categories
      const allProjects = [];
      this.categories.forEach(c => {
        (c.projects || []).forEach(p => {
          allProjects.push({ project: p, category: c });
        });
      });

      if (this.panelTitle) this.panelTitle.textContent = window.languageManager.t("cla.all.the.categories");
      const proposalSA = window.languageManager.t("cla.proposal(s)");
      if (this.panelCount) this.panelCount.textContent = `${allProjects.length} ${proposalSA}`;

      const projectsSorted = this.sortProjects(allProjects.map(ap => ap.project));
      projectsSorted.forEach((p, idx) => {
        const hit = this.projectIndex.get(String(p.id ?? p.title));
        const catOfProject = hit ? hit.category : null;
        this.projectsEl.appendChild(this.renderProjectCard(p, catOfProject, idx, true));
      });
    }
  }

  sortProjects(projects) {
    if (this.sortMode === "likes") return this.sortProjectsByLikes(projects);
    return this.sortProjectsByScore(projects);
  }

  sortProjectsByScore(projects) {
    return [...projects].sort((a, b) => {
      const sa = Number.isInteger(a.score) ? a.score : -1;
      const sb = Number.isInteger(b.score) ? b.score : -1;
      return sb - sa;
    });
  }

  getLikesCount(p) {
    if (Array.isArray(p.likes)) return p.likes.length;
    if (Number.isInteger(p.likes)) return p.likes; // if backend ever returns a count
    if (Number.isInteger(p.likeCount)) return p.likeCount;
    return 0;
  }

  sortProjectsByLikes(projects) {
    return [...projects].sort((a, b) => {
      const la = this.getLikesCount(a);
      const lb = this.getLikesCount(b);

      // primary: likes desc
      if (lb !== la) return lb - la;

      // tie-breaker: score desc
      const sa = Number.isInteger(a.score) ? a.score : -1;
      const sb = Number.isInteger(b.score) ? b.score : -1;
      if (sb !== sa) return sb - sa;

      // final: title asc (stable-ish)
      return String(a.title || "").localeCompare(String(b.title || ""));
    });
  }

  renderProjectCard(p, cat, idx, is_global) {
    const card = document.createElement("div");
    card.className = "sc-card";

    const title = Utilities.escapeHtml(p.title);
    const description = Utilities.escapeHtml(p.description);
    const authors = Utilities.escapeHtml(p.authors);
    const link = String(p.link || "").trim();
    const detail = String(p.detail || p.desc || "").trim();
    const resources = p.resources || {};

    const score = Number.isInteger(p.score) ? p.score : null;
    const evaluationText = String(p.evaluation || "").trim();
    const localComparison = String(p.local || "").trim();
    const globalComparison = String(p.global || "").trim();
    let likeCounter = 0;
    if (p.likes && Array.isArray(p.likes)) {
        likeCounter = p.likes.length;
        // Iterate through each like
        /*
        p.likes.forEach((like, index) => {
          console.log(`Like ${index + 1}:`);
          console.log('  User ID:', like.user);
          console.log('  Name:', like.name);
        });*/
      }
    const hasEvaluation = evaluationText.length > 0;
    let hasComparison = false;
    if (is_global)
    {
      hasComparison = globalComparison.length > 0;
    }
    else
    {
      hasComparison = localComparison.length > 0;
    }

    const rankPosition = (idx + 1);

    const seeEvalution = window.languageManager.t("word.see.evaluation");
    const withoutEvaluation = window.languageManager.t("word.without.evaluation");    

    const seeGlobalComparison = window.languageManager.t("cla.see.global.comparison");
    const seeLocalComparison = window.languageManager.t("cla.see.local.comparison");    
    const withoutComparison = window.languageManager.t("cla.without.comparison");    
    const wordFeedback = window.languageManager.t("word.feedback");    
    const wordLikes = window.languageManager.t("word.likes");    
    const wordAuthor = window.languageManager.t("word.author");    
    const wordLink = window.languageManager.t("word.link");   
    const wordResources = window.languageManager.t("word.resources");
    const wordDetails = window.languageManager.t("word.details");
    const seeMoreInformation = window.languageManager.t("cla.see.more.information");
    const evaluateWithRubric = window.languageManager.t("cla.evaluate.with.rubric");
    const compareWithProjects = window.languageManager.t("cla.compare.projects");

    const wordPitch = window.languageManager.t("word.pitch");
    const wordCanvas = window.languageManager.t("word.canvas");
    const wordSummary = window.languageManager.t("word.summary");
 
    card.innerHTML = `
      <span class="sc-rank">#${rankPosition}</span>
      <button class="sc-card-btn" type="button" aria-expanded="false">
        <table class="sc-card-header">
          <tr>
            <td class="sc-td-title"><h5>${title}</h5></td>
            <td class="sc-td-score">
              <span class="sc-score-pill">${score !== null ? `${score}/100` : "—/100"}</span>
            </td>
            <td class="sc-td-action">
              <button class="sc-eval-link-btn" type="button"
                title="${hasEvaluation ? `${seeEvalution}` : `${withoutEvaluation}`}"
                ${hasEvaluation ? "" : "disabled"}
                data-action="view-evaluation"
                data-project-id="${Utilities.escapeHtml(String(p.id ?? p.title))}">
                🧠
              </button>
              <button class="sc-project-comparison-btn" type="button"
                title="${hasComparison ? `${is_global ? `${seeGlobalComparison}` : `${seeLocalComparison}`}` :`${withoutComparison}`}"
                ${hasComparison ? "" : "disabled"}
                data-action="view-comparison"
                data-project-id="${Utilities.escapeHtml(String(p.id ?? p.title))}">
                👬
              </button>
            </td>
            <td class="sc-td-score">
              <span class="sc-feedback-pill" data-project-id="${Utilities.escapeHtml(String(p.id ?? p.title))}">${wordFeedback}</span>
            </td>
            <td class="sc-td-action">
              <button class="sc-conversation-link-btn" type="button"
                title="Conversation"
                data-action="view-conversation"
                data-project-id="${Utilities.escapeHtml(String(p.id ?? p.title))}">
                💬
              </button>
            </td>
            <td class="sc-td-score">
              <span class="sc-likes-pill">${wordLikes} ${likeCounter !== null ? `${likeCounter}` : "—"}</span>
            </td>              
            <td class="sc-td-action">
              <button class="sc-likes-link-btn" type="button"
                title="Likes"
                data-action="view-likes"
                data-project-id="${Utilities.escapeHtml(String(p.id ?? p.title))}">
                👍
              </button>
            </td>
          </tr>
        </table>

        <p>${description}</p>

        <div class="sc-meta">
          <div><strong>${wordAuthor}:</strong> ${authors || "—"}</div>
          <div><strong>${wordLink}:</strong> ${
            link
              ? `<a class="sc-link" href="${Utilities.escapeHtml(link)}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()">Abrir</a>`
              : "—"
          }</div>

          <div class="sc-resources">
            <strong>${wordResources}:</strong>
            ${resources.pitch ? `<a href="${resources.pitch}" target="_blank" type="pitch-pdf" onclick="event.stopPropagation()">${wordPitch}</a>` : ""}
            ${resources.canvas ? `<a href="${resources.canvas}" target="_blank" type="canvas-pdf" onclick="event.stopPropagation()">${wordCanvas}</a>` : ""}
            ${resources.summary ? `<a href="${resources.summary}" target="_blank" type="summary-pdf" onclick="event.stopPropagation()">${wordSummary}</a>` : ""}
          </div>

          <div><strong>${wordDetails}:</strong>${seeMoreInformation}</div>
        </div>
          <table style="margin: 0 auto;">
            <tr>
              <td>
                <button class="sc-eval-btn" type="button">${evaluateWithRubric}</button>
              </td>
              <td>
                <button class="sc-relations-btn" type="button">${compareWithProjects}</button>
              </td>
            </tr>
          </table>
        
      </button>

      <div class="sc-expand" aria-hidden="true">
        <div class="sc-expand-inner">
          <div class="sc-detail">${detail}</div>
        </div>
      </div>
    `;

    // Expand / collapse
    const btn = card.querySelector(".sc-card-btn");
    const expand = card.querySelector(".sc-expand");
    btn.addEventListener("click", () => {
      const isOpen = card.classList.toggle("sc-open");
      btn.setAttribute("aria-expanded", isOpen ? "true" : "false");
      expand.setAttribute("aria-hidden", isOpen ? "false" : "true");
      // Update “Detalles” label
      const metaDetails = btn.querySelector(".sc-meta div:last-of-type");
        const wordDetails = window.languageManager.t("word.details");
        const seeMoreInfo = window.languageManager.t("cla.see.more.information");
        const seeLessInfo = window.languageManager.t("cla.see.less.information");
      if (metaDetails) metaDetails.innerHTML = `<strong>${wordDetails}:</strong> ${isOpen ? `${seeLessInfo}` : `${seeMoreInfo}`}`;
    });

    // View evaluation overlay
    const evalLinkBtn = card.querySelector(".sc-eval-link-btn");
    if (evalLinkBtn) {
      evalLinkBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const projectId = evalLinkBtn.getAttribute("data-project-id");
        const hit = this.projectIndex.get(String(projectId));
        if (!hit) return;

        const { project } = hit;
        this.showOverlay(window.languageManager.t("word.evaluation"), AIProjectPrompting.renderEvaluationHTML(String(project.evaluation || "").trim(), false));
        document.dispatchEvent(new CustomEvent("select-graph", { detail: { graph: "categories" } }));
      });
    }

    // View evaluation overlay
    const projectComparisonBtn = card.querySelector(".sc-project-comparison-btn");
    if (projectComparisonBtn) {
      projectComparisonBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const projectId = projectComparisonBtn.getAttribute("data-project-id");
        const hit = this.projectIndex.get(String(projectId));
        if (!hit) return;

        const { project } = hit;
        let finalComparison = "";
        if (is_global)
        {
          finalComparison = project.global;
        }
        else
        {
          finalComparison = project.local;
        }
        const html = AIProjectPrompting.renderComparisonHTML(finalComparison, {
          title: window.languageManager.t("cla.comparison.results"),
          subtitle: window.languageManager.t("cla.matches.vs.other.projects")
        });
        this.showOverlay(window.languageManager.t("word.comparison"), html);
        document.dispatchEvent(new CustomEvent("select-graph", { detail: { graph: "relationships", title: project.title, relationships: finalComparison } }));
      });
    }

    // View conversation overlay
    const openConversation = async (e) => {
      e.stopPropagation();

      const projectId =
        e.currentTarget.getAttribute("data-project-id") ||
        e.currentTarget.closest("[data-project-id]")?.getAttribute("data-project-id");

      const hit = this.projectIndex.get(String(projectId));
      if (!hit) return;

      const { project } = hit;

      const projectConversation = new ConversationProject({
        baseUrl: window.languageManager.t("url.base"),
        getToken: () => sessionStorage.getItem("auth_token"),
        getContext: () => ({
          projectId: project?.id || null,
          projecttitle: project?.title || null,
          projectconversation: project?.conversation || null
        })
      });

      const html = await projectConversation.renderConversationHTML();
      this.showOverlay(window.languageManager.t("word.feedback"), html);
      projectConversation.setupEvents();
    };

    // Attach to BOTH: button + pill
    const conversationLinkBtn = card.querySelector(".sc-conversation-link-btn");
    if (conversationLinkBtn) conversationLinkBtn.addEventListener("click", openConversation);

    const feedbackPill = card.querySelector(".sc-feedback-pill");
    if (feedbackPill) feedbackPill.addEventListener("click", openConversation);
    
    // View likes overlay
    const likesLinkBtn = card.querySelector(".sc-likes-link-btn");
    if (likesLinkBtn) {
      likesLinkBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const projectId = likesLinkBtn.getAttribute("data-project-id");
        const hit = this.projectIndex.get(String(projectId));
        if (!hit) return;

        const { project } = hit;

        const projectLikes = new LikesProject({
          baseUrl: window.languageManager.t("url.base"),
          getToken: () => sessionStorage.getItem("auth_token"),
          getContext: () => ({
            projectId: project?.id || null,
            projecttitle: project?.title || null,
            projectlikes: project?.likes || null
          })
        });

        const html = await projectLikes.renderLikesHTML();
        this.showOverlay(window.languageManager.t("word.likes"), html);
        projectLikes.setupEvents();
      });
    }

    // Evaluate with rubric -> dispatch event (ClassificationLayout listens)
    const evalBtn = card.querySelector(".sc-eval-btn");
    if (evalBtn) {
      evalBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        document.dispatchEvent(new CustomEvent("evaluate-project", {
          detail: { project: p, category: cat }
        }));
      });
    }

    // Evaluate with rubric -> dispatch event (ClassificationLayout listens)
    const relationsBtn = card.querySelector(".sc-relations-btn");
    if (relationsBtn) {
      relationsBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        document.dispatchEvent(new CustomEvent("relations-project", {
          detail: { project: p, category: cat }
        }));
      });
    }

    // Resource links open in overlay (same logic you had)
    const resourceLinks = card.querySelectorAll(".sc-resources a");
    resourceLinks.forEach(a => {
      a.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();

        const url = a.href;
        const type = a.getAttribute("type");
        let html = "";

        if (type === "pitch-pdf") {
          const youTubeURL = Utilities.formatVideoUrl(url);
          html = `<iframe src="${youTubeURL}" width="100%" height="400" frameborder="0" allowfullscreen></iframe>`;
        } else if (type === "canvas-pdf" || type === "summary-pdf") {
          html = `<iframe src="${url}" width="100%" height="600" frameborder="0"></iframe>`;
        }

        const openInNewTab = window.languageManager.t("cla.open.in.new.tab");
        html += `<br><div class="evaluation-sub-form"><button class="primary" onclick="window.open('${url}', '_blank')" style="margin-top:10px;">${openInNewTab}</button></div>`;
        this.showOverlay(window.languageManager.t("word.resources"),html);
      });
    });

    return card;
  }

  renderRelatedProject(related_project, total_data)
  {
    this.closeOverlays(false);
    let formatted_project = "[" + JSON.stringify(related_project) + "]";
    if (related_project == null)
    {
      formatted_project = JSON.stringify(total_data);
    }
    else
    {
      formatted_project = "[" + JSON.stringify(related_project) + "]";
    }
    const final_format_related_project = AIProjectPrompting.renderComparisonHTML(formatted_project, {
          title: window.languageManager.t("cla.comparison.results"),
          subtitle: window.languageManager.t("word.matches")
        });
    this.showOverlay(window.languageManager.t("word.comparison"), final_format_related_project);    
  }
}
