import { Utilities } from "../Utils/Utilities.js";

export class LikesProject {
  constructor(options) {
    this.baseUrl = options.baseUrl;
    this.getToken = options.getToken;
    this.getContext = options.getContext;
  }

  async renderLikesHTML(should_reload = false) {
    const context = this.getContext?.() || {};
    const projectId = context.projectId;
    const projecttitle = context.projecttitle || "";
    const projectlikes = context.projectlikes || "";

    const noProjectSelected = window.languageManager.t("cla.no.project.selected");
    if (!projectId) return `<p>${noProjectSelected}</p>`;

    let likes = projectlikes;
    if (should_reload)
    {
      likes = await this.fetchLikes(projectId);
    }

    this.totalLikes = likes.length;

    const userId = this.getUserId();
    const alreadyLiked = userId != null && likes.some(l => String(l.user ?? l.user_id ?? l.id) === String(userId));

    let html = `
      <div class="likes-form">
        <h3>Likes for Project ${Utilities.escapeHtml(projecttitle)}</h3>
        <p><strong>${likes.length}</strong> like(s)</p>
    `;

    const noLikesYet = window.languageManager.t("cla.no.likes.yet");
    const addLike = window.languageManager.t("cla.add.a.like");
    const removeLike = window.languageManager.t("cla.remove.a.like");
    
    if (!likes.length) {
      html += `<p>${noLikesYet}</p>`;
    } else {
      html += `<div class="likes-list">`;
      likes.forEach(entry => {
        const name =
          entry.name ||
          entry.username ||
          entry.email ||
          entry.user_name ||
          `User ${entry.user ?? entry.user_id ?? "?"}`;

        html += `
          <div class="like-entry">
            <strong>👍 ${Utilities.escapeHtml(name)}</strong>
          </div>
        `;
      });
      html += `</div>`;
    }

    html += `
        <div class="evaluation-sub-form" style="margin-top:12px; display:flex; gap:10px; flex-wrap:wrap;">
          <button id="button-add-like-project" ${alreadyLiked ? "disabled" : ""}>${addLike}</button>
          <button id="button-remove-like-project" ${(!alreadyLiked) ? "disabled" : ""}>${removeLike}</button>
			<div id="likes-processing" style="display:none; font-weight:700; color:#374151;">
				  ${window.languageManager.t("word.processing") || "Processing...."}
			</div>		  
        </div>
      </div>
    `;

    return html;
  }

  /**
   * Must be called AFTER you inject renderLikesHTML() into #sc-overlay-body
   */
  setupEvents() {
    const btnAdd = document.querySelector("#button-add-like-project");
    const btnRemove = document.querySelector("#button-remove-like-project");

    if (btnAdd) {
      btnAdd.addEventListener("click", async (e) => {
        e.preventDefault();

		this.setLikesBusy(true);

        const context = this.getContext?.() || {};
        const user = this.getUserId();
        if (!user) {
          alert(window.languageManager.t("cla.logged.in.to.add.like"));
		  this.setLikesBusy(false);
          return;
        }

        const ok = await this.addLike(user, context.projectId);
        if (ok) await this.refreshOverlay();
        else alert(window.languageManager.t("cla.failed.to.add.like"));
		this.setLikesBusy(false);
      });
    }

    if (btnRemove) {
      btnRemove.addEventListener("click", async (e) => {
        e.preventDefault();

		this.setLikesBusy(true);

        const context = this.getContext?.() || {};
        const user = this.getUserId();
        if (!user) {
          alert(window.languageManager.t("cla.logged.in.to.remove.like"));
		  this.setLikesBusy(false);
          return;
        }

        const ok = await this.removeLike(user, context.projectId);
        if (ok) await this.refreshOverlay();
        else alert(window.languageManager.t("cla.failed.to.remove.like"));
		this.setLikesBusy(false);
      });
    }
  }

	setLikesBusy(isBusy) {
	  const btnAdd = document.querySelector("#button-add-like-project");
	  const btnRemove = document.querySelector("#button-remove-like-project");
	  const busy = document.querySelector("#likes-processing");

	  if (btnAdd) btnAdd.style.display = isBusy ? "none" : "";
	  if (btnRemove) btnRemove.style.display = isBusy ? "none" : "";
	  if (busy) busy.style.display = isBusy ? "block" : "none";
	}

  async refreshOverlay() {
    const overlayBody = document.querySelector("#sc-overlay-body");
    if (!overlayBody) return;

    overlayBody.innerHTML = await this.renderLikesHTML(true);
    this.setupEvents(); // Re-attach events after DOM replacement
  }

  getUserId() {
    const token = this.getToken?.();
    if (!token) return null;

    try {
      const payload = token.split(".")[1];
      const decoded = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
      return decoded.sub ?? decoded.user_id ?? decoded.id ?? null;
    } catch {
      return null;
    }
  }

  async fetchLikes(projectId) {
    try {
      const response = await fetch(`${this.baseUrl}/getlikes?project=${encodeURIComponent(projectId)}`);
      if (!response.ok) throw new Error("Failed to fetch likes");
      const data = await response.json();
      return Array.isArray(data) ? data : [];
    } catch (error) {
      console.error("Error fetching likes:", error);
      return [];
    }
  }

  async addLike(user, project) {
    try {
      const response = await fetch(`${this.baseUrl}/addlike`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user, project })
      });
      if (!response.ok) throw new Error("Failed to add like");

      // Accept either {success:true} or a raw boolean true or any truthy response
      const data = await response.json().catch(() => true);
      document.dispatchEvent(new CustomEvent("likes-updated"));
      return data === true || data?.success === true || data?.ok === true;      
    } catch (error) {
      console.error("Error adding like:", error);
      return false;
    }
  }

  async removeLike(user, project) {
    try {
      const response = await fetch(`${this.baseUrl}/removelike`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user, project })
      });
      if (!response.ok) throw new Error("Failed to remove like");

      const data = await response.json().catch(() => true);
      document.dispatchEvent(new CustomEvent("likes-updated"));
      return data === true || data?.success === true || data?.ok === true;
    } catch (error) {
      console.error("Error removing like:", error);
      return false;
    }
  }
}
