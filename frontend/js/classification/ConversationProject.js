import { Utilities } from "../Utils/Utilities.js";

export class ConversationProject {
  constructor(options) {
    this.baseUrl = options.baseUrl;
    this.getToken = options.getToken;
    this.getContext = options.getContext;
  }

  async renderConversationHTML(should_reload = false) {
    const context = this.getContext();
    const projectId = context.projectId;
    const projecttitle = context.projecttitle;
    const projectConversation = context.projectconversation;
    if (!projectId) return "<p>No project selected.</p>";

    // Fetch conversation
    let conversation = projectConversation;
    if (should_reload)
    {
      conversation = await this.fetchConversation(projectId);
    }     

    // Build HTML
    const feedbackForProject = window.languageManager.t("cla.feedback.for.project");
    let html = `<h3>${feedbackForProject} ${projecttitle}</h3>`;
    html += '<div class="conversation-list">';
    conversation.forEach(entry => {
      html += `<div class="conversation-entry">
        <strong>User ${entry.name}</strong><br>
        ${Utilities.escapeHtml(entry.text)}
      </div>`;
    });
    html += '</div>';

    // Add form
    const submitAddComment = window.languageManager.t("cla.submit.a.comment");
    const addAComment = window.languageManager.t("cla.add.a.comment");
    
    html += `
    <form class="conversation-form">
      <textarea id="conversation-text" placeholder="${addAComment}" required></textarea><br><br>
      <div class="evaluation-sub-form">
      <button id="button-add-comment" type="submit">${submitAddComment}</button>
		<div id="comment-processing" style="display:none; font-weight:700; color:#374151;">
			  ${window.languageManager.t("word.processing") || "Processing..."}
		</div>	  
      </div>
    </form>
    `;

    return html;
  }


  getUserId() {
    const token = this.getToken();
    if (!token) return null;
    try {
      const payload = token.split('.')[1];
      const decoded = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
      return decoded.sub;
    } catch {
      return null;
    }
  }

  setupEvents() {
    const form = document.querySelector('.conversation-form');
    if (form) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
		
        const context = this.getContext?.() || {};
        const user = this.getUserId();
        if (!user) {
          alert(window.languageManager.t("cla.logged.in.to.add.comment"));
		      this.setCommentBusy(false);
          return;
        }

		    this.setCommentBusy(true);
        const text = document.getElementById('conversation-text').value.trim();
        if (!text)
        {
          this.setCommentBusy(false);
          return;
        }

        const success = await this.addEntry(user, context.projectId, text);
        if (success) {
          // Refresh the conversation
          const newHtml = await this.renderConversationHTML(true);
          const overlayBody = document.querySelector('#sc-overlay-body');
          if (overlayBody) {
            overlayBody.innerHTML = newHtml;
            this.setupEvents(); // Re-attach events
          }
        } else {
          alert('Failed to add comment.');
        }
		this.setCommentBusy(false);
      });
    }
  }

	setCommentBusy(isBusy) {
	  const btnAdd = document.querySelector("#button-add-comment");
	  const busy = document.querySelector("#comment-processing");

	  if (btnAdd) btnAdd.style.display = isBusy ? "none" : "";
	  if (busy) busy.style.display = isBusy ? "block" : "none";
	}


  async fetchConversation(projectId) {
    try {
      const response = await fetch(`${this.baseUrl}/getconversation?project=${projectId}`);
      if (!response.ok) throw new Error('Failed to fetch conversation');
      return await response.json();
    } catch (error) {
      console.error('Error fetching conversation:', error);
      return [];
    }
  }

  async addEntry(user, project, text) {
    try {
      const response = await fetch(`${this.baseUrl}/addconversationentry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user, project, text })
      });
      document.dispatchEvent(new CustomEvent("likes-updated"));
      if (!response.ok) throw new Error('Failed to add entry');
      return await response.json();
    } catch (error) {
      console.error('Error adding entry:', error);
      return false;
    }
  }
}