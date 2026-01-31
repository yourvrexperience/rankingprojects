export class CategoryGraph {
  constructor(root, categories) {
    this.root = root;
    this.categories = categories || [];
    this.nodeMap = new Map();

    this.svgMount = this.root.querySelector("#sc-svg-mount");
    this.legend = this.root.querySelector("#sc-legend");

    this.W = 440;
    this.H = 440;
    this.cx = this.W / 2;
    this.cy = (this.H / 2) + 10;
    this.ringR = 145;
  }

  mount() { this.render(); }   // alias
  unmount() {
    if (this.svgMount) this.svgMount.innerHTML = "";
    if (this.legend) this.legend.innerHTML = "";
  }

  render() {
    if (!this.svgMount) return;
    this.svgMount.innerHTML = "";
    if (this.legend) this.legend.innerHTML = "";

    const n = this.categories.length;

    const svg = document.createElementNS("http://www.w3.org/2000/svg","svg");
    svg.setAttribute("class","sc-svg");
    svg.setAttribute("viewBox", `0 0 ${this.W} ${this.H}`);
    svg.setAttribute("role","img");
    svg.setAttribute("aria-label",window.languageManager.t("cla.pie.chart.of.categories"));

    const ring = document.createElementNS("http://www.w3.org/2000/svg","circle");
    ring.setAttribute("class","sc-ring");
    ring.setAttribute("cx", this.cx);
    ring.setAttribute("cy", this.cy);
    ring.setAttribute("r", this.ringR);
    svg.appendChild(ring);

    // Center
    svg.appendChild(this.renderCenter());

    // Nodes + legend
    this.categories.forEach((cat, i) => {
      const ang = (-Math.PI / 2) + (i * (2 * Math.PI / n));
      const x = this.cx + this.ringR * Math.cos(ang);
      const y = this.cy + this.ringR * Math.sin(ang);

      const g = this.createNode(cat, x, y);
      svg.appendChild(g);
      this.nodeMap.set(cat.id, g);

      if (this.legend) {
        const pill = document.createElement("div");
        pill.className = "sc-pill";
        pill.textContent = String(cat.labelShort || "").replace(/^\d+\.\s?/, "");
        this.legend.appendChild(pill);
      }
    });

    this.svgMount.appendChild(svg);
  }

  renderCenter() {
    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    
    // Make center selectable like a node
    g.setAttribute("class", "sc-center");
    g.setAttribute("role", "button");
    g.setAttribute("aria-label", window.languageManager.t("cla.show.all.categories"));
  
    const fire = () => {
      document.dispatchEvent(
        new CustomEvent("select-category", { detail: { category: "GLOBAL" } })
      );
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
    c.setAttribute("r", 78);
    c.setAttribute("fill", "#fff");
    c.setAttribute("stroke", "#111827");
    c.setAttribute("stroke-width", "3.5");
    c.style.cursor = "pointer"; // helps indicate it’s clickable
  
    const t1 = document.createElementNS("http://www.w3.org/2000/svg", "text");
    t1.setAttribute("x", this.cx);
    t1.setAttribute("y", this.cy - 6);
    t1.setAttribute("text-anchor", "middle");
    t1.setAttribute("font-size", "12");
    t1.setAttribute("font-weight", "800");
    t1.style.cursor = "pointer";
    t1.textContent = window.languageManager.t("word.categories");
  
    const t2 = document.createElementNS("http://www.w3.org/2000/svg", "text");
    t2.setAttribute("x", this.cx);
    t2.setAttribute("y", this.cy + 14);
    t2.setAttribute("text-anchor", "middle");
    t2.setAttribute("font-size", "11");
    t2.setAttribute("font-weight", "600");
    t2.setAttribute("fill", "#6b7280");
    t2.style.cursor = "pointer";
    t2.innerHTML = window.languageManager.t("cla.click.to.view.all.categories");
  
    const t3 = document.createElementNS("http://www.w3.org/2000/svg", "text");
    t3.setAttribute("x", this.cx);
    t3.setAttribute("y", this.cy + 44);
    t3.setAttribute("text-anchor", "middle");
    t3.setAttribute("font-size", "11");
    t3.setAttribute("font-weight", "600");
    t3.setAttribute("fill", "#6b7280");
    t3.style.cursor = "pointer";
    t3.textContent = window.languageManager.t("cla.project.total.number") + ": " + this.countTotalProjects();
  
    g.appendChild(c);
    g.appendChild(t1);
    g.appendChild(t2);
    g.appendChild(t3);
    return g;
  }

  createNode(cat, x, y) {
    const g = document.createElementNS("http://www.w3.org/2000/svg","g");
    g.setAttribute("class","sc-node");
    g.setAttribute("tabindex","0");
    g.setAttribute("role","button");
    g.setAttribute("aria-pressed","false");
    g.setAttribute("data-id", cat.id);

    g.dataset.short = cat.labelShort;
    g.dataset.active = cat.labelActiveShort || cat.labelLong || cat.labelShort;

    const c = document.createElementNS("http://www.w3.org/2000/svg","circle");
    c.setAttribute("cx", x);
    c.setAttribute("cy", y);
    c.setAttribute("r", 46);

    const t = document.createElementNS("http://www.w3.org/2000/svg","text");
    t.setAttribute("x", x);
    t.setAttribute("y", y);
    t.setAttribute("data-short", cat.labelShort);
    t.setAttribute("data-active", cat.labelActiveShort || cat.labelLong || cat.labelShort);

    // default tspans (same as your original)
    const t1 = document.createElementNS("http://www.w3.org/2000/svg","tspan");
    t1.setAttribute("x", x);
    t1.setAttribute("dy", "-2");
    t1.textContent = cat.labelShort;

    const t2 = document.createElementNS("http://www.w3.org/2000/svg","tspan");
    t2.setAttribute("x", x);
    t2.setAttribute("dy", "14");
    t2.textContent = "";

    t.appendChild(t1);
    t.appendChild(t2);

    g.appendChild(c);
    g.appendChild(t);

    // Dispatch event outward
    const fire = () => {
      document.dispatchEvent(new CustomEvent("select-category", { detail: { category: cat.id }}));
    };

    g.addEventListener("click", fire);
    g.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        fire();
      }
    });

    return g;
  }

  setActiveCategory(categoryId) {
    // Highlight center when category === -1
    const centerEl = this.root.querySelector(".sc-center");
    if (centerEl) {
      centerEl.classList.toggle("sc-active", categoryId === "GLOBAL");
    }
    
    const cat = this.categories.find(c => c.id === categoryId);
    if (cat)
    {
      this.root.style.setProperty("--active-color", cat.color || "#f3f4f6");
    }
  
    this.categories.forEach(catItem => {
      const el = this.nodeMap.get(catItem.id);
      if (!el) return;
  
      const active = catItem.id === categoryId;
      el.classList.toggle("sc-active", active);
      el.setAttribute("aria-pressed", active ? "true" : "false");
  
      const textEl = el.querySelector("text");
      if (!textEl) return;
  
      const totalProjects = Array.isArray(catItem.projects) ? catItem.projects.length : 0;
      const lines = active ? this.toLines(el.dataset.active) : [el.dataset.short];
      this.setMultilineText(textEl, lines, totalProjects);
    });

    // If center selected, don’t activate any node
    if (categoryId == "GLOBAL") {
      this.root.style.setProperty("--active-color", "#bfbfbf");
    
      this.nodeMap.forEach(el => {
        el.classList.remove("sc-active");
        el.setAttribute("aria-pressed", "false");
      });
    }
  }

  toLines(label) {
    return String(label || "")
      .split(/\n|\\n/g)
      .map(s => s.trim())
      .filter(Boolean);
  }

  setMultilineText(textEl, lines, totalProjects, lineHeight = 13) {
    while (textEl.firstChild) textEl.removeChild(textEl.firstChild);

    const x = textEl.getAttribute("x");
    const total = lines.length;
    const startOffset = -((total - 1) * lineHeight) / 2;

    lines.forEach((line, i) => {
      const tspan = document.createElementNS("http://www.w3.org/2000/svg","tspan");
      tspan.setAttribute("x", x);
      tspan.setAttribute("dy", i === 0 ? startOffset : lineHeight);
      tspan.textContent = line;
      textEl.appendChild(tspan);
    });

    const tspanN = document.createElementNS("http://www.w3.org/2000/svg","tspan");
    tspanN.setAttribute("x", x);
    tspanN.setAttribute("dy", lines.length === 0 ? startOffset : lineHeight);
    const titleTotalProjects = window.languageManager.t("word.projects");
    tspanN.textContent = `(${totalProjects} ${titleTotalProjects})`;
    textEl.appendChild(tspanN);
  }

  countTotalProjects() {
    return (this.categories || []).reduce((acc, c) => acc + (Array.isArray(c.projects) ? c.projects.length : 0), 0);
  }
}

