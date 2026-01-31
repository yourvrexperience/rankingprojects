import { Utilities } from "../Utils/Utilities.js";
import { AIProjectPrompting } from "../Utils/AIProjectPrompting.js";

export class ProjectRelationshipsGraph {
  /**
   * @param {HTMLElement} root - container element that includes an element with id="pr-svg-mount"
   * @param {Object} data - { title_selected_project: string, relationships: Array<..> }
   * @param {Object} [opts]
   * @param {number} [opts.width=520]
   * @param {number} [opts.height=420]
   * @param {number} [opts.centerRadius=78]
   * @param {number} [opts.nodeRadius=62]
   * @param {number} [opts.ringRadius=165]
   */
  constructor(root, opts = {}) {
    this.root = root;
    this.nodeMap = new Map(); // title -> <g>
    this.svgMount = this.root.querySelector("#sc-svg-mount");

    // Geometry (tuned to match your mock)
    this.W = opts.width ?? 520;
    this.H = opts.height ?? 520;
    this.cx = this.W / 2;
    this.cy = (this.H / 2) - 20; // move up to leave room for info panel below in layout
    this.centerR = opts.centerRadius ?? 78;
    this.nodeR = opts.nodeRadius ?? 62;
    this.ringR = opts.ringRadius ?? 160;

    this.activeTitle = null;
    this.zoomScale = opts.zoomScale ?? 1.18;     // how much the node grows
    this.nodesLayer = null;                      // set during render()
    this.centerEl = null;                        // keep ref if you want center zoom too

    this.nodeRMin = opts.nodeRMin ?? 24;  // radius when match=0
    this.nodeRMax = opts.nodeRMax ?? 84;  // radius when match=100

    this.maxOuterNodes = opts.maxOuterNodes ?? 7;
  }

  mount() { this.render(); }
  unmount() {
    if (this.svgMount) this.svgMount.innerHTML = "";
    this.nodeMap.clear();
  }
  setData(title, relationships) {
    this.title_selected = title;
    this.relationships = relationships;    
    this.activeTitle = null;
    this.render();
  }

  render() {
    if (!this.svgMount) return;
    this.svgMount.innerHTML = "";
    this.nodeMap.clear();

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "pr-svg");
    svg.setAttribute("viewBox", `0 0 ${this.W} ${this.H}`);
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", window.languageManager.t("cla.project.relationship.chart"));

    // Links behind nodes
    const linksLayer = document.createElementNS("http://www.w3.org/2000/svg", "g");
    linksLayer.setAttribute("class", "pr-links");
    svg.appendChild(linksLayer);

    // Nodes above links (NEW)
    this.nodesLayer = document.createElementNS("http://www.w3.org/2000/svg", "g");
    this.nodesLayer.setAttribute("class", "pr-nodes");
    svg.appendChild(this.nodesLayer);

    // Center node first (so links can reference it; still appears above links)
    this.center = this.renderCenter();
    svg.appendChild(this.center)
    this.nodesLayer.appendChild(this.center);

    // Limit number of rendered outer nodes
    const max = this.maxOuterNodes;

    // Defensive copy + sort by match DESC
    const rels = Array.isArray(this.relationships)
      ? [...this.relationships]
          .sort((a, b) => Number(b.match ?? 0) - Number(a.match ?? 0))
          .slice(0, max)
      : [];

    const n = rels.length;

    if (n > 0) {
      // Distribute nodes around a ring; start angle so one is bottom-right-ish like your mock
      const start = -Math.PI / 2 + Math.PI / 6;

      rels.forEach((related_project, i) => {
        const match = Number(related_project.match ?? 0);
        const r = this.radiusFromMatch(match);
        const extra = (r - this.nodeRMin) * 0.55; 

        const ang = start + (i * (2 * Math.PI / n));
        const rr = this.ringR + extra;
        const x = this.cx + rr * Math.cos(ang);
        const y = this.cy + rr * Math.sin(ang);

        // Link line
        const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
        line.setAttribute("x1", this.cx);
        line.setAttribute("y1", this.cy);
        line.setAttribute("x2", x);
        line.setAttribute("y2", y);
        line.setAttribute("class", "pr-link");
        linksLayer.appendChild(line);

        // Node
        const g = this.createOuterNode(related_project, x, y);
        this.nodesLayer.appendChild(g);
        this.nodeMap.set(String(related_project.title), g);
      });
    }

    this.svgMount.appendChild(svg);

    // Apply any existing active state
    if (this.activeTitle) this.setActiveRelated(this.activeTitle);
  }

  renderCenter() {
    const title = String(this.title_selected || "").trim();

    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    g.setAttribute("class", "pr-center");
    g.setAttribute("role", "button");
    g.setAttribute("tabindex", "0");
    const projectSelected = window.languageManager.t("cla.project.selected");
    const withoutTitle = window.languageManager.t("cla.without.title");
    g.setAttribute("aria-label", `${projectSelected}: ${title || withoutTitle}`);

    const fire = () => {
      document.dispatchEvent(
        new CustomEvent("select-related-project", {
          detail: { selectedTitle: this.title_selected, related: null, total_data: this.relationships }
        })
      );
      this.setActiveRelated(null);
    };

    g.addEventListener("click", fire);
    g.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        fire();
      }
    });

    const c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    c.setAttribute("cx", this.cx);
    c.setAttribute("cy", this.cy);
    c.setAttribute("r", this.centerR);
    c.setAttribute("class", "pr-center-circle");

    const t = document.createElementNS("http://www.w3.org/2000/svg", "text");
    t.setAttribute("x", this.cx);
    t.setAttribute("y", this.cy);
    t.setAttribute("text-anchor", "middle");
    t.setAttribute("class", "pr-center-text");

    // Multi-line: allow wrapping by splitting into short lines
    const lines = Utilities.wrapText(title || window.languageManager.t("cla.project.selected"), 18);
    Utilities.setMultilineText(t, lines, 14);

    g.appendChild(c);
    g.appendChild(t);

    g.dataset.x = String(this.cx);
    g.dataset.y = String(this.cy);

    return g;
  }

  createOuterNode(related_project, x, y) {
    const title = String(related_project.title || "").trim();
    const match = Number(related_project.match ?? 0);
    const r = this.radiusFromMatch(match); 
    const scoreClass = AIProjectPrompting.scoreClass(match);   

    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    g.setAttribute("class", "pr-node");
    g.setAttribute("tabindex", "0");
    g.setAttribute("role", "button");
    g.setAttribute("aria-pressed", "false");
    g.setAttribute("data-title", title);
    g.setAttribute("class", `pr-node ${scoreClass}`);

    const c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    c.setAttribute("cx", x);
    c.setAttribute("cy", y);
    c.setAttribute("r", r);
    c.setAttribute("class", "pr-node-circle");

    const t = document.createElementNS("http://www.w3.org/2000/svg", "text");
    t.setAttribute("x", x);
    t.setAttribute("y", y);
    t.setAttribute("text-anchor", "middle");
    t.setAttribute("class", "pr-node-text");

    // Two blocks:
    // 1) Title (may wrap)
    // 2) Match line
    const maxChars = Math.max(10, Math.round(r / 3.8)); // tune if needed
    const titleLines = Utilities.wrapText(title || window.languageManager.t("cla.other.project"), maxChars);
    const matchLine = `${Math.round(match)}%`;

    // Compose tspans: title lines, then a blank-ish step, then match
    const lineHeight = Math.max(12, Math.round(r / 5));
    Utilities.setMultilineText(t, [...titleLines, matchLine], lineHeight, { boldLast: true });

    // Dispatch outward
    const fire = () => {
      const selectedTitle = String(this.title_selected || "").trim();
      document.dispatchEvent(
        new CustomEvent("select-related-project", {
          detail: { selectedTitle, related: related_project, total_data: null }
        })
      );
      this.setActiveRelated(title);
    };

    g.addEventListener("click", fire);
    g.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        fire();
      }
    });

    g.appendChild(c);
    g.appendChild(t);

    g.dataset.x = String(x);
    g.dataset.y = String(y);
    g.dataset.r = String(r);
    return g;
  }

  /**
   * Highlight an outer node by title (or clear with null).
   * Similar idea to CategoryGraph.setActiveCategory.
   */
  setActiveRelated(titleOrNull) {
    this.activeTitle = titleOrNull ? String(titleOrNull) : null;

    // Center highlight/zoom when nothing selected
    const centerEl = this.root.querySelector(".pr-center");
    if (centerEl) {
      centerEl.classList.toggle("pr-active", !this.activeTitle);
      // Optional: zoom center when active
      this.applyZoomToNode(centerEl, !this.activeTitle);
      // Bring center to front when active
      if (!this.activeTitle && this.nodesLayer) this.nodesLayer.appendChild(centerEl);
    }

    this.nodeMap.forEach((el, title) => {
      const active = !!this.activeTitle && title === this.activeTitle;
      el.classList.toggle("pr-active", active);
      el.setAttribute("aria-pressed", active ? "true" : "false");

      // Zoom / unzoom
      this.applyZoomToNode(el, active);

      // Bring active to front so it doesn't get covered
      if (active && this.nodesLayer) this.nodesLayer.appendChild(el);
    });
  }

  // ---------- text helpers ----------


  applyZoomToNode(g, zoomOn) {
    if (!g) return;

    const x = Number(g.dataset.x);
    const y = Number(g.dataset.y);

    if (!Number.isFinite(x) || !Number.isFinite(y)) return;

    if (!zoomOn) {
      g.removeAttribute("transform");
      return;
    }

    const s = this.zoomScale;
    // scale around (x,y): T(x,y) * S(s) * T(-x,-y)
    // g.setAttribute("transform", `translate(${x} ${y}) scale(${s}) translate(${-x} ${-y})`);
    g.setAttribute("transform", `scale(${s})`);
  }

  clamp01(v) {
    return Math.max(0, Math.min(1, v));
  }

  radiusFromMatch(match) {
    const m = Number(match);
    const t = this.clamp01((Number.isFinite(m) ? m : 0) / 100);

    // Linear mapping (simple & predictable):
    return this.nodeRMin + t * (this.nodeRMax - this.nodeRMin);

    // Optional: make differences more noticeable near the top:
    // const eased = t * t; // or Math.sqrt(t)
    // return this.nodeRMin + eased * (this.nodeRMax - this.nodeRMin);
  }
}
