import { Utilities } from "./Utilities.js";

export class AIProjectPrompting {
  constructor({  baseUrl = "http://127.0.0.1:5000", userManager = null, getToken, getContext }) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.userManager = userManager;

    // Prefer userManager if provided, fallback to getToken
    this.getToken =
      userManager?.getSession
        ? () => userManager.getSession().token
        : (typeof getToken === "function" ? getToken : () => null);
        
    this.getContext = getContext;
  }

  getOtherProjects(){
    const ctx = this.getContext();
    console.log("Other projects:", ctx.otherProjects.length);
    ctx.otherProjects.forEach(element => {
      console.log(element.title + " - " + element.resources.canvas + " - " + element.resources.summary);
    });
    return ctx.otherProjects || [];
  }

  // ---------- small helpers ----------
  getMissingResources(includeCategory = true){
    const ctx = this.getContext();
    const cat = ctx.category;
    const rubric = cat?.rubric || "";
    const missing = [];
    if (includeCategory)
    {
      if (!ctx.projectId) missing.push(window.languageManager.t("prompt.save.project.first"));
      if (rubric.length == 0) missing.push(window.languageManager.t("word.rubric"));
    }
    if (ctx.title.length == 0) missing.push(window.languageManager.t("adm.input.project.title"));
    if (ctx.canvas.length == 0) missing.push(window.languageManager.t("word.canvas"));
    if (ctx.summary.length == 0) missing.push(window.languageManager.t("word.summary"));
    if (ctx.script.length == 0) missing.push(window.languageManager.t("word.pitch.script"));

    return missing;
  }

  renderMissingResourcesFindOutCategory(missingResources)
  {
    const missingDocs = window.languageManager.t("prompt.to.find.category.documents.are.missing");
    const fillDocs = window.languageManager.t("prompt.fill.data.try.again");
    return `
          <div style="margin-top:6px">
            ${missingDocs}
            <ul style="margin:6px 0 0 18px;">
              ${missingResources.map(m => `<li>${Utilities.escapeHtml(m)}</li>`).join("")}
            </ul>
          </div>
          <div style="margin-top:8px; color:#374151">
            ${fillDocs}
          </div>
        `;
  }

  renderMissingResourcesApplyRubric(missingResources)
  {
    const missingDocs = window.languageManager.t("prompt.to.apply.rubric.documents.are.missing");
    const fillData = window.languageManager.t("prompt.fill.data.try.again");
    return `
          <div style="margin-top:6px">
            ${missingDocs}
            <ul style="margin:6px 0 0 18px;">
              ${missingResources.map(m => `<li>${Utilities.escapeHtml(m)}</li>`).join("")}
            </ul>
          </div>
          <div style="margin-top:8px; color:#374151">
            ${fillData}
          </div>
        `;
  }

  renderMissingResourcesRelationship(missingResources)
  {
    const missingDocs = window.languageManager.t("prompt.to.apply.comparison.documents.are.missing");
    const fillData = window.languageManager.t("prompt.fill.data.try.again");
    return `
          <div style="margin-top:6px">
            ${missingDocs}
            <ul style="margin:6px 0 0 18px;">
            ${missingResources.map(m => `<li>${Utilities.escapeHtml(m)}</li>`).join("")}
            </ul>
          </div>
          <div style="margin-top:8px; color:#374151">
            ${fillData}
          </div>
        `;
  }

  // ---------- prompt builders (ADMIN-style context from form fields) ----------
  buildEvaluationPromptPreview() {
    const ctx = this.getContext();
    const pitch = (ctx.script || "").trim();

    const pitchScript = window.languageManager.t("prompt.pitch.script.internal");

    const pitchBlock = pitch
      ? `\n\n${pitchScript}:\n${Utilities.clampText(pitch, 3500)}`
      : "";

    const notAvailable = window.languageManager.t("word.not.available");
    const promptRubric1 = window.languageManager.t("prompt.rubric.expert.prompt.1");
    const promptRubric2 = window.languageManager.t("prompt.rubric.expert.prompt.2");
    const promptRubric3 = window.languageManager.t("prompt.rubric.expert.prompt.3");
    const promptRubric4 = window.languageManager.t("prompt.rubric.expert.prompt.4");
    const promptRubric5 = window.languageManager.t("prompt.rubric.expert.prompt.5");
    const promptRubric6 = window.languageManager.t("prompt.rubric.expert.prompt.6");
    const promptRubric7 = window.languageManager.t("prompt.rubric.expert.prompt.7");
    const promptRubric8 = window.languageManager.t("prompt.rubric.expert.prompt.8");
    const promptRubric9 = window.languageManager.t("prompt.rubric.expert.prompt.9");

    return `${promptRubric1}
${promptRubric2} ${ctx.title}
${promptRubric3} ${ctx.category?.labelLong || ctx.category?.labelShort || ""}

${promptRubric4}
${promptRubric5} ${(ctx.rubric || "").trim() || notAvailable}
${promptRubric6} ${ctx.canvas || notAvailable}
${promptRubric7} ${ctx.summary || notAvailable}${pitchBlock}

${promptRubric8}

${promptRubric9}
    `.trim();
  }

  buildEvaluationPromptReal() {
    const ctx = this.getContext();
    const promptRubric1 = window.languageManager.t("prompt.rubric.expert.prompt.1");
    const promptRubric2 = window.languageManager.t("prompt.rubric.expert.prompt.2");
    const promptRubric3 = window.languageManager.t("prompt.rubric.expert.prompt.3");
    return `
${promptRubric1}
${promptRubric2} ${ctx.title}
${promptRubric3} ${ctx.category?.labelLong || ctx.category?.labelShort || ""}
    `.trim();
  }

  buildFindCategoryPromptPreview(categories) {
    const ctx = this.getContext();
    const pitch = (ctx.script || "").trim();

    const categoriesAvailable = (Array.isArray(categories) ? categories : [])
      .map(c => `{ category_id:${c.uid}, category_name:${c.id}, category_description:${c.labelLong} }`)
      .join("\n");

    const notAvailable = window.languageManager.t("word.not.available");
    const pitchScriptInternal = window.languageManager.t("prompt.pitch.script.internal");
    const promptFindOutCategory1 = window.languageManager.t("prompt.find.out.category.prompt.1");
    const promptFindOutCategory2 = window.languageManager.t("prompt.find.out.category.prompt.2");
    const promptFindOutCategory3 = window.languageManager.t("prompt.rubric.expert.prompt.2");
    const promptFindOutCategory4 = window.languageManager.t("prompt.rubric.expert.prompt.4");
    const promptFindOutCategory5 = window.languageManager.t("prompt.rubric.expert.prompt.6");
    const promptFindOutCategory6 = window.languageManager.t("prompt.rubric.expert.prompt.7");
    const promptFindOutCategory7 = window.languageManager.t("prompt.find.out.category.prompt.3");
    

    const pitchBlock = pitch
      ? `\n\n${pitchScriptInternal}:\n${Utilities.clampText(pitch, 3500)}`
      : "";

    return `
${promptFindOutCategory1}

${categoriesAvailable}

${promptFindOutCategory2}
${promptFindOutCategory3} ${ctx.title}

${promptFindOutCategory4}
${promptFindOutCategory5} ${ctx.canvas || notAvailable}
${promptFindOutCategory6} ${ctx.summary || notAvailable}${pitchBlock}

${promptFindOutCategory7}
    `.trim();
  }

  buildFindCategoryPromptReal(categories) {
    const ctx = this.getContext();

    const categoriesAvailable = (Array.isArray(categories) ? categories : [])
      .map(c => `{ category_id:${c.uid}, category_name:${c.id}, category_description:${c.labelLong} }`)
      .join("\n");
      
    const promptFindOutCategory1 = window.languageManager.t("prompt.find.out.category.prompt.1");
    const promptFindOutCategory2 = window.languageManager.t("prompt.find.out.category.prompt.2");
    const promptFindOutCategory3 = window.languageManager.t("prompt.rubric.expert.prompt.2");
    
    return `
${promptFindOutCategory1}

${categoriesAvailable}

${promptFindOutCategory2}
${promptFindOutCategory3} ${ctx.title}
    `.trim();
  }

  buildRelationshipsPromptPreview() {
    const ctx = this.getContext();

    const notAvailable = window.languageManager.t("word.not.available");
    const promptCompareToProjects1 = window.languageManager.t("prompt.compare.with.other.projects.1");
    const promptCompareToProjects2 = window.languageManager.t("prompt.compare.with.other.projects.2");
    const promptCompareToProjects3 = window.languageManager.t("prompt.compare.with.other.projects.3");
    const promptCompareToProjects4 = window.languageManager.t("prompt.rubric.expert.prompt.6");
    const promptCompareToProjects5 = window.languageManager.t("prompt.rubric.expert.prompt.7");
    const promptCompareToProjects6 = window.languageManager.t("prompt.compare.with.other.projects.4");
    const promptCompareToProjects7 = window.languageManager.t("prompt.compare.with.other.projects.5");
    const promptCompareToProjects8 = window.languageManager.t("prompt.compare.with.other.projects.6");
    const promptCompareToProjects9 = window.languageManager.t("prompt.compare.with.other.projects.7");
    
    let dataRequest = `
${promptCompareToProjects1} ${ctx.title} ${promptCompareToProjects2}

${promptCompareToProjects3} ${ctx.title}:
${promptCompareToProjects4} ${ctx.canvas || notAvailable}
${promptCompareToProjects5} ${ctx.summary || notAvailable}

${promptCompareToProjects6}
`;
    ctx.otherProjects.forEach(entry => {
        dataRequest += `${promptCompareToProjects7} ${entry.title}: ${entry.resources.canvas || notAvailable}
${promptCompareToProjects8} ${entry.title}: ${entry.resources.summary || notAvailable}
`;
    });
    
    dataRequest += `
${promptCompareToProjects9}
[{
  "title": "Project title 1",
  "match": number,
  "similarities": string,
  "differences": [string],
  "collaboration": [string]
},
{
  "title": "Project title 2",
  "match": number,
  "similarities": string,
  "differences": [string],
  "collaboration": [string]
},
{
  "title": "Project title 3",
  "match": number,
  "similarities": string,
  "differences": [string],
  "collaboration": [string]
}]`;

    return dataRequest.trim();
}

  buildRelationshipsPromptReal() {
    const ctx = this.getContext();
    const promptCompareToProjects1 = window.languageManager.t("prompt.compare.with.other.projects.1");
    const promptCompareToProjects2 = window.languageManager.t("prompt.compare.with.other.projects.2");

    return `${promptCompareToProjects1} ${ctx.title} ${promptCompareToProjects2}`.trim();
  }

  // ---------- evaluation normalization + rendering ----------
  static normalizeEvaluation(result) {
    let obj = null;
    if (!result) obj = null;
    else if (typeof result === "string") {
      try { obj = JSON.parse(result); } catch { obj = null; }
    } else obj = result;

    const score = Number.isFinite(obj?.score)
      ? Math.max(0, Math.min(100, Math.round(obj.score)))
      : null;

    return {
      raw: obj,
      score,
      evaluation: String(obj?.evaluation || "").trim(),
      strengths: Array.isArray(obj?.strengths) ? obj.strengths : [],
      weaknesses: Array.isArray(obj?.weaknesses) ? obj.weaknesses : [],
      recommendations: Array.isArray(obj?.recommendations) ? obj.recommendations : []
    };
  }

  static scoreClass(score) {
    if (score === null || score === undefined) return "sc-score-na";
    if (score >= 75) return "sc-score-good";
    if (score >= 50) return "sc-score-mid";
    return "sc-score-low";
  }

  static renderList(items) {
    const arr = Array.isArray(items) ? items : [];
    if (!arr.length) return `<div class="sc-empty">—</div>`;
    return `<ul class="sc-eval-list">${arr.map(i => `<li>${Utilities.escapeHtml(i)}</li>`).join("")}</ul>`;
  }

  // Returns ONLY the HTML body. Pages decide where to mount it.
  static renderEvaluationHTML(result, showbutton, { title = "Evaluation result", subtitle = "Stored AI evaluation (rubric + docs)." } = {}) {
    const n = AIProjectPrompting.normalizeEvaluation(result);

    if (!n.raw) {
      return `<div class="sc-empty" style="margin-bottom:10px;">No evaluation stored yet.</div>`;
    }

    const evaluationTitle = window.languageManager.t("word.evaluation");
    const noEvaluationText = window.languageManager.t("word.no.evaluation.text");
    const wordStrengths = window.languageManager.t("word.strengths");
    const wordWeaknesses = window.languageManager.t("word.weaknesses");
    const wordRecommendations = window.languageManager.t("word.recommendations");
    const wordReEvaluate = window.languageManager.t("word.re.evaluate.project");    
    
    return `
<div class="sc-eval">
  <div class="sc-eval-header">
    <div class="sc-eval-score ${AIProjectPrompting.scoreClass(n.score)}">
      <div class="sc-eval-score-num">${n.score !== null ? n.score : "—"}</div>
      <div class="sc-eval-score-den">/100</div>
    </div>
    <div class="sc-eval-meta">
      <div class="sc-eval-title">${Utilities.escapeHtml(title)}</div>
      <div class="sc-eval-sub">${Utilities.escapeHtml(subtitle)}</div>
    </div>
  </div>

  <div class="sc-eval-section">
    <div class="sc-eval-h">${evaluationTitle}</div>
    ${n.evaluation
      ? `<div class="sc-eval-text">${Utilities.escapeHtml(n.evaluation)}</div>`
      : `<div class="sc-empty">${noEvaluationText}</div>`}
  </div>

  <div class="sc-eval-grid">
    <div class="sc-eval-card">
      <div class="sc-eval-h">${wordStrengths}</div>
      ${AIProjectPrompting.renderList(n.strengths)}
    </div>
    <div class="sc-eval-card">
      <div class="sc-eval-h">${wordWeaknesses}</div>
      ${AIProjectPrompting.renderList(n.weaknesses)}
    </div>
  </div>

  <div class="sc-eval-section">
    <div class="sc-eval-h">${wordRecommendations}</div>
    ${AIProjectPrompting.renderList(n.recommendations)}
  </div>
    ${showbutton
    ? `<div class="btnrow" style="justify-content:flex-start; margin-top:12px;"><button class="primary" id="btnEvaluateProject" type="button">${wordReEvaluate}</button></div>`
    : ``}
    <p>
    `.trim();
  }

  static normalizeComparison(result) {
    let arr = null;

    if (!result) arr = null;
    else if (typeof result === "string") {
      try { arr = JSON.parse(result); } catch { arr = null; }
    } else {
      arr = result;
    }

    if (!Array.isArray(arr)) return { raw: null, items: [] };

    const items = arr.map((x) => {
      const matchRaw = Number(x?.match);
      const match = Number.isFinite(matchRaw)
        ? Math.max(0, Math.min(100, Math.round(matchRaw)))
        : null;

      return {
        title: String(x?.title || "").trim() || "—",
        match,
        similarities: String(x?.similarities || "").trim(),
        differences: Array.isArray(x?.differences) ? x.differences : [],
        collaboration: Array.isArray(x?.collaboration) ? x.collaboration : []
      };
    });

    return { raw: arr, items };
  }

  static renderComparisonHTML(result, {
    title = window.languageManager.t("word.project.comparison"),
    subtitle = window.languageManager.t("word.similarity.score")
  } = {}) {
    const n = AIProjectPrompting.normalizeComparison(result);

    if (!n.raw || !n.items.length) {
      return `<div class="sc-empty" style="margin-bottom:10px;">No comparison stored yet.</div>`;
    }

    // Sort by match desc (optional)
    const sorted = [...n.items].sort((a, b) => (b.match ?? -1) - (a.match ?? -1));

    const wordSimilarityMatch = window.languageManager.t("word.similarity.match");
    const wordSimilarities = window.languageManager.t("word.similarities");
    const wordDifferences = window.languageManager.t("word.differences");
    const wordCollaboration = window.languageManager.t("word.collaboration");

    const rows = sorted.map(item => `
      <div class="sc-eval-section" style="margin-top:12px;">
        <div class="sc-eval-header" style="margin-bottom:10px;">
          <div class="sc-eval-score ${AIProjectPrompting.scoreClass(item.match)}">
            <div class="sc-eval-score-num">${item.match !== null ? item.match : "—"}</div>
            <div class="sc-eval-score-den">/100</div>
          </div>
          <div class="sc-eval-meta">
            <div class="sc-eval-title">${Utilities.escapeHtml(item.title)}</div>
            <div class="sc-eval-sub">${wordSimilarityMatch}</div>
          </div>
        </div>

        <div class="sc-eval-card" style="margin-bottom:10px;">
          <div class="sc-eval-h">${wordSimilarities}</div>
          ${item.similarities
            ? `<div class="sc-eval-text">${Utilities.escapeHtml(item.similarities)}</div>`
            : `<div class="sc-empty">—</div>`}
        </div>

        <div class="sc-eval-grid">
          <div class="sc-eval-card">
            <div class="sc-eval-h">${wordDifferences}</div>
            ${AIProjectPrompting.renderList(item.differences)}
          </div>

          <div class="sc-eval-card">
            <div class="sc-eval-h">${wordCollaboration}</div>
            ${AIProjectPrompting.renderList(item.collaboration)}
          </div>
        </div>
      </div>
    `).join("");

    return `
      <div class="sc-eval">
        <div class="sc-eval-header">
          <div class="sc-eval-meta">
            <div class="sc-eval-title">${Utilities.escapeHtml(title)}</div>
            <div class="sc-eval-sub">${Utilities.escapeHtml(subtitle)}</div>
          </div>
        </div>
        ${rows}
      </div>
    `.trim();
  }

  async postJson(path, payload) {
    // require userManager
    if (!this.userManager?.consumePromptRequest) {
      throw new Error("AIProjectPrompting: userManager is required for quota enforcement");
    }

    const quota = this.userManager.consumePromptRequest();
    if (!quota.ok) {
      return {
        ok: false,
        error: "DAILY_LIMIT",
        quota: quota.status
      };
    }
        
    try {
      const token = this.getToken();
      const res = await fetch(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { "Authorization": `Bearer ${token}` } : {})
        },
        body: JSON.stringify(payload)
      });

      let data = null;
      try { data = await res.json(); } catch { data = null; }

      if (!res.ok) {
        const msg = (data && (data.error || data.message))
          ? (data.error || data.message)
          : `HTTP ${res.status}`;
        throw new Error(msg);
      }
      return data;
    } catch (e) {
        // network / fetch exception: refund
        this.userManager.refundPromptRequest();
        throw e;
      }      
  }

  async evaluateProject({ projectId, prompt}) {
    if (!projectId) throw new Error("Missing project id.");
    const ctx = this.getContext();
    const cat = ctx.category;
    const rubric = cat?.rubric || "";
    const canvas = ctx.canvas;
    const summary = ctx.summary;
    const script = ctx.script;
    const lang = window.languageManager?.getCurrentLang?.() || "en";
    return this.postJson("/evaluate", { project: projectId, prompt, rubric, canvas, summary, script, lang: lang });
  }

  async compareProjects({ projectId, title, is_global, prompt}) {
    if (!projectId) throw new Error("Missing project id.");
    const ctx = this.getContext();
    const canvas = ctx.canvas;
    const summary = ctx.summary;
    const notAvailable = window.languageManager.t("word.not.available");
    const projectsData = ctx.otherProjects.map(entry => ({
      title: entry.title,
      canvas: entry.resources.canvas || notAvailable,
      summary: entry.resources.summary || notAvailable
    }));    
    const lang = window.languageManager?.getCurrentLang?.() || "en";
    return this.postJson("/compareprojects", { project: projectId, title, is_global, prompt, canvas, summary, other_projects: projectsData, lang: lang });
  }

  async findOutCategory({ prompt}) {    
    const ctx = this.getContext();
    const canvas = ctx.canvas;
    const summary = ctx.summary;
    const script = ctx.script;
    const lang = window.languageManager?.getCurrentLang?.() || "en";
    return this.postJson("/findoutcategory", { prompt, canvas, summary, script, lang: lang });
  }

  openEvalOverlay(document, previewPrompt, headerText, subheaderText, confirmButtonText, onConfirm){
    const overlay = document.getElementById("evalOverlay");
    const ta = document.getElementById("evalPromptPreview");
    const msg = document.getElementById("evalOverlayMsg");
    if(!overlay || !ta) return;

    // Set dynamic content
    const h3 = overlay.querySelector("h3");
    if(h3) h3.textContent = headerText || window.languageManager.t("adm.ai.prompt.engineering");

    const sub = overlay.querySelector(".sub");
    if(sub) sub.textContent = subheaderText || window.languageManager.t("adm.confirm.to.send.prompt");

    const btnConfirm = document.getElementById("btnEvalConfirm");
    if(btnConfirm) btnConfirm.textContent = confirmButtonText || window.languageManager.t("adm.confirm.and.evaluate");

    ta.value = previewPrompt || "";
    if(msg) msg.textContent = "";

    overlay.style.display = "block";

    const close = () => {
      overlay.style.display = "none";
    };

    const btnX = document.getElementById("closeEvalOverlay");
    const btnCancel = document.getElementById("btnEvalCancel");

    let clonedCancel, clonedConfirm;

    // clear previous listeners by cloning
    if(btnX){
      const b = btnX.cloneNode(true);
      btnX.parentNode.replaceChild(b, btnX);
      b.addEventListener("click", close);
    }
    if(btnCancel){
      clonedCancel = btnCancel.cloneNode(true);
      btnCancel.parentNode.replaceChild(clonedCancel, btnCancel);
      clonedCancel.addEventListener("click", close);
    }
    if(btnConfirm){
      clonedConfirm = btnConfirm.cloneNode(true);
      btnConfirm.parentNode.replaceChild(clonedConfirm, btnConfirm);
      clonedConfirm.addEventListener("click", async () => {
        clonedCancel.disabled = true;
        clonedConfirm.disabled = true;
        try{
          if(msg){ msg.className = "msg"; msg.textContent = window.languageManager.t("cla.evaluating.may.take.few.seconds"); }
          await onConfirm?.();
        }catch(err){
          console.error(err);
          if(msg){ msg.className = "msg err"; msg.textContent = window.languageManager.t("cla.error.while.evaluating"); }
        } finally {
          clonedCancel.disabled = false;
          clonedConfirm.disabled = false;
        }
      });
    }

    // click outside closes
    overlay.addEventListener("click", (e) => {
      if(e.target === overlay) close();
    });

    return { close };
  }

}
