(() => {
  const canvas = document.getElementById("c");
  const ctx = canvas.getContext("2d", { alpha: false });
  const tagsEl = document.getElementById("tags");
  const popup = document.getElementById("termPopup");
  const popupTitle = popup.querySelector(".term-popup-title");
  const popupBody = popup.querySelector(".term-popup-body");
  const controlsEl = document.getElementById("controls");
  const controlsToggle = document.getElementById("controlsToggle");

  controlsToggle.addEventListener("click", () => {
    const collapsed = controlsEl.classList.toggle("collapsed");
    controlsToggle.setAttribute("aria-expanded", String(!collapsed));
    controlsToggle.title = collapsed ? "Show controls" : "Hide controls";
  });

  const tagsToggle = document.getElementById("tagsToggle");
  function syncTagsVisibility() {
    tagsEl.classList.toggle("hidden", !tagsToggle.checked);
  }
  tagsToggle.addEventListener("change", syncTagsVisibility);
  syncTagsVisibility();

  const TERMS = window.NEURO_TERMS || [];
  const MAX_TAGS = 4;

  const controls = {
    birth: document.getElementById("birth"),
    life: document.getElementById("life"),
    speed: document.getElementById("speed"),
    trail: document.getElementById("trail"),
    path: document.getElementById("path"),
  };
  const outs = {
    birth: document.getElementById("birthOut"),
    life: document.getElementById("lifeOut"),
    speed: document.getElementById("speedOut"),
    trail: document.getElementById("trailOut"),
    path: document.getElementById("pathOut"),
  };

  let dpr = 1;
  let w = 0;
  let h = 0;
  let cx = 0;
  let cy = 0;
  let sourceReady = false;
  const particles = [];
  let spawnAcc = 0;
  let last = performance.now();
  let dragging = false;
  let popupTimer = 0;
  let termCursor = 0;

  // Golden angle — Vogel / fractal disc packing
  const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
  let spawnIndex = 0;
  let pathSmoothed = Number(controls.path.value);
  let pathSmoothPrev = pathSmoothed;

  function smoothstep(e0, e1, x) {
    const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
  }

  function lerpAngle(a, b, t) {
    let d = b - a;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return a + d * t;
  }

  function pathLabel(v) {
    if (v < 0.05) return "straight";
    if (v < 0.3) return "slight";
    if (v < 0.5) return "random";
    if (v < 0.62) return "very random";
    if (v < 0.85) return "→ fractal";
    return "fractal";
  }

  // Continuum: 0–0.55 straight→random (peak), 0.6–1 random→fractal packing
  function pathMix(v) {
    const randomUp = smoothstep(0, 0.48, v);
    const randomDown = 1 - smoothstep(0.58, 0.92, v);
    const random = randomUp * randomDown;
    const fractal = smoothstep(0.6, 1, v);
    return { random, fractal };
  }

  function syncLabels() {
    outs.birth.textContent = `${controls.birth.value} /s`;
    outs.life.textContent = `${Number(controls.life.value).toFixed(1)} s`;
    outs.speed.textContent = `${Number(controls.speed.value).toFixed(2)}×`;
    outs.trail.textContent = controls.trail.value;
    outs.path.textContent = pathLabel(Number(controls.path.value));
  }

  function clearAllHistories() {
    for (const p of particles) p.history.length = 0;
  }

  for (const el of Object.values(controls)) {
    el.addEventListener("input", syncLabels);
  }
  controls.path.addEventListener("input", () => {
    const target = Number(controls.path.value);
    // Big Path jumps would bolt through old trail points — drop histories
    if (Math.abs(target - pathSmoothed) > 0.06) clearAllHistories();
  });
  syncLabels();

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = window.innerWidth;
    h = window.innerHeight;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!sourceReady) {
      cx = w * 0.5;
      cy = h * 0.5;
      sourceReady = true;
    } else {
      cx = Math.min(Math.max(cx, 0), w);
      cy = Math.min(Math.max(cy, 0), h);
    }
  }

  window.addEventListener("resize", resize);
  resize();

  function setSourceFromEvent(e) {
    const rect = canvas.getBoundingClientRect();
    const point = e.touches ? e.touches[0] : e;
    if (!point) return;
    cx = Math.min(Math.max(point.clientX - rect.left, 0), w);
    cy = Math.min(Math.max(point.clientY - rect.top, 0), h);
  }

  function onPointerDown(e) {
    if (e.target !== canvas) return;
    dragging = true;
    setSourceFromEvent(e);
    e.preventDefault();
  }

  function onPointerMove(e) {
    if (!dragging) return;
    setSourceFromEvent(e);
    e.preventDefault();
  }

  function onPointerUp() {
    dragging = false;
  }

  canvas.addEventListener("mousedown", onPointerDown);
  window.addEventListener("mousemove", onPointerMove);
  window.addEventListener("mouseup", onPointerUp);
  canvas.addEventListener("touchstart", onPointerDown, { passive: false });
  window.addEventListener("touchmove", onPointerMove, { passive: false });
  window.addEventListener("touchend", onPointerUp);
  window.addEventListener("touchcancel", onPointerUp);

  function activeTagCount() {
    let n = 0;
    for (const p of particles) if (p.term) n++;
    return n;
  }

  function usedTerms() {
    const set = new Set();
    for (const p of particles) if (p.term) set.add(p.term.term);
    return set;
  }

  function pickTerm() {
    if (!TERMS.length) return null;
    const used = usedTerms();
    for (let i = 0; i < TERMS.length; i++) {
      const t = TERMS[(termCursor + i) % TERMS.length];
      if (!used.has(t.term)) {
        termCursor = (termCursor + i + 1) % TERMS.length;
        return t;
      }
    }
    return null;
  }

  function showTermPopup(entry) {
    popupTitle.textContent = entry.term;
    popupBody.textContent = entry.blurb;
    popup.hidden = false;
    popup.classList.add("visible");
    clearTimeout(popupTimer);
    popupTimer = setTimeout(() => {
      popup.classList.remove("visible");
      popup.hidden = true;
    }, 5000);
  }

  function spawn() {
    const life = Number(controls.life.value);
    const speedMul = Number(controls.speed.value);
    // Base outward speed is independent of life so longer life = farther travel
    const baseSpeed = Math.hypot(w, h) * 0.65;
    const speed = baseSpeed * speedMul;

    let term = null;
    // Keep up to 4 tagged words; bias toward tagging when slots are free
    if (activeTagCount() < MAX_TAGS && Math.random() < 0.22) {
      term = pickTerm();
    }

    const n = spawnIndex++;
    const chirality = n % 2 === 0 ? 1 : -1;
    const p = {
      ox: cx,
      oy: cy,
      angle: Math.random() * Math.PI * 2,
      chirality,
      vogelAngle: n * GOLDEN_ANGLE * chirality,
      vogelIndex: n,
      speed,
      age: 0,
      maxLife: life * (0.85 + Math.random() * 0.4),
      seed: Math.random() * 1000,
      freq: 1.2 + Math.random() * 2.4,
      freq2: 0.4 + Math.random() * 1.1,
      amp: 0.6 + Math.random() * 0.8,
      history: [],
      term,
      tagEl: null,
    };

    if (term) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "tag";
      btn.textContent = term.term;
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        showTermPopup(term);
      });
      tagsEl.appendChild(btn);
      p.tagEl = btn;
    }

    particles.push(p);
  }

  function positionAt(p, age, pathVal) {
    const r = p.speed * age;
    const { random, fractal } = pathMix(pathVal);

    // Rays morph toward golden-angle packing; chirality flips spiral direction
    const twist = p.chirality * 0.1 * Math.sqrt(Math.max(r, 0)) * fractal;
    const targetAng = p.vogelAngle + twist;
    const ang = lerpAngle(p.angle, targetAng, smoothstep(0, 1, fractal));

    const wobbleAmp = random * (1 - fractal * 0.92) * p.amp * r * 0.22;
    const wobble =
      (Math.sin(age * p.freq + p.seed) * 0.65 +
        Math.sin(age * p.freq2 * 2.3 + p.seed * 1.7) * 0.35) *
      wobbleAmp;
    const drift =
      Math.sin(age * 0.35 + p.seed) * random * (1 - fractal) * r * 0.04;

    const px = Math.cos(ang);
    const py = Math.sin(ang);
    const nx = -py;
    const ny = px;
    return {
      x: p.ox + px * (r + drift) + nx * wobble,
      y: p.oy + py * (r + drift) + ny * wobble,
    };
  }

  function releaseTag(p) {
    if (p.tagEl) {
      p.tagEl.remove();
      p.tagEl = null;
    }
    p.term = null;
  }

  function update(dt) {
    const birth = Number(controls.birth.value);
    const trailLen = Math.max(2, Number(controls.trail.value) | 0);
    const pathTarget = Number(controls.path.value);
    // Ease Path so fractal morphs don't snap mid-trail
    const follow = 1 - Math.exp(-dt * 4.5);
    pathSmoothed += (pathTarget - pathSmoothed) * follow;
    if (Math.abs(pathSmoothed - pathSmoothPrev) > 0.035) {
      clearAllHistories();
    }
    pathSmoothPrev = pathSmoothed;

    spawnAcc += birth * dt;
    while (spawnAcc >= 1) {
      spawn();
      spawnAcc -= 1;
    }

    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.age += dt;
      if (p.age >= p.maxLife) {
        releaseTag(p);
        particles.splice(i, 1);
        continue;
      }
      const pos = positionAt(p, p.age, pathSmoothed);
      p.history.push(pos);
      if (p.history.length > trailLen) {
        p.history.splice(0, p.history.length - trailLen);
      }
      p.head = pos;

      if (p.tagEl) {
        // Hide tags that drift off-screen; keep slot free visually
        const on =
          pos.x > 8 && pos.x < w - 8 && pos.y > 8 && pos.y < h - 8;
        p.tagEl.style.display = on ? "block" : "none";
        if (on) {
          p.tagEl.style.transform = `translate(${pos.x}px, ${pos.y}px) translate(-50%, -120%)`;
        }
      }
    }

    const maxParticles = 4000;
    if (particles.length > maxParticles) {
      const drop = particles.length - maxParticles;
      for (let i = 0; i < drop; i++) releaseTag(particles[i]);
      particles.splice(0, drop);
    }
  }

  function drawParticles(targetCtx, scale = 1) {
    targetCtx.lineWidth = Math.max(1, scale);
    targetCtx.lineJoin = "round";
    targetCtx.lineCap = "round";

    for (const p of particles) {
      const hist = p.history;
      if (hist.length < 2) continue;

      const lifeT = p.age / p.maxLife;
      const fade = 1 - lifeT;

      targetCtx.beginPath();
      targetCtx.moveTo(hist[0].x * scale, hist[0].y * scale);
      for (let i = 1; i < hist.length; i++) {
        targetCtx.lineTo(hist[i].x * scale, hist[i].y * scale);
      }
      targetCtx.strokeStyle = `rgba(245, 242, 235, ${0.16 + fade * 0.55})`;
      targetCtx.stroke();

      const head = hist[hist.length - 1];
      const size = (p.term ? 2.4 + fade * 1.8 : 1.4 + fade * 1.6) * scale;
      targetCtx.beginPath();
      targetCtx.fillStyle = p.term
        ? `rgba(201, 162, 39, ${0.55 + fade * 0.4})`
        : `rgba(245, 242, 235, ${0.45 + fade * 0.5})`;
      targetCtx.arc(head.x * scale, head.y * scale, size, 0, Math.PI * 2);
      targetCtx.fill();
    }
  }

  function draw() {
    ctx.fillStyle = "#5a5c58";
    ctx.fillRect(0, 0, w, h);
    drawParticles(ctx, 1);
  }

  const BG = "#5a5c58";
  const exportToast = document.getElementById("exportToast");
  let toastTimer = 0;
  let exportBusy = false;

  function showExportToast(msg) {
    if (!exportToast) return;
    exportToast.hidden = false;
    exportToast.textContent = msg;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      exportToast.hidden = true;
    }, 1500);
  }

  // S = JPG with stage background; E = transparent PNG. High-res, particles only.
  function exportArtwork(format) {
    if (exportBusy || !w || !h) return;
    exportBusy = true;
    showExportToast("Downloading…");

    const longEdge = 4096;
    const scale = longEdge / Math.max(w, h);
    const ew = Math.round(w * scale);
    const eh = Math.round(h * scale);
    const off = document.createElement("canvas");
    off.width = ew;
    off.height = eh;
    const transparent = format === "png";
    const octx = off.getContext("2d", { alpha: transparent });
    if (transparent) {
      octx.clearRect(0, 0, ew, eh);
    } else {
      octx.fillStyle = BG;
      octx.fillRect(0, 0, ew, eh);
    }
    drawParticles(octx, scale);

    const mime = transparent ? "image/png" : "image/jpeg";
    const quality = transparent ? undefined : 0.92;
    const ext = transparent ? "png" : "jpg";

    off.toBlob(
      (blob) => {
        exportBusy = false;
        if (!blob) {
          showExportToast("Export failed");
          return;
        }
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `neuro-spatial-${Date.now()}.${ext}`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        // Delay revoke so the browser can finish the download
        setTimeout(() => URL.revokeObjectURL(url), 2000);
        showExportToast("Saved");
      },
      mime,
      quality
    );
  }

  window.addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const key = e.key.toLowerCase();
    if (key !== "e" && key !== "s") return;
    // Allow while sliders focused; skip real text fields only
    const el = e.target;
    if (el && (el.tagName === "TEXTAREA" || (el.tagName === "INPUT" && el.type === "text"))) {
      return;
    }
    e.preventDefault();
    exportArtwork(key === "e" ? "png" : "jpg");
  });

  // Mobile: double-tap canvas → JPG (same as S)
  let lastTap = { t: 0, x: 0, y: 0 };
  canvas.addEventListener(
    "touchend",
    (e) => {
      if (e.changedTouches.length !== 1) return;
      const touch = e.changedTouches[0];
      const now = performance.now();
      const dx = touch.clientX - lastTap.x;
      const dy = touch.clientY - lastTap.y;
      if (now - lastTap.t < 320 && Math.hypot(dx, dy) < 28) {
        e.preventDefault();
        exportArtwork("jpg");
        lastTap.t = 0;
      } else {
        lastTap = { t: now, x: touch.clientX, y: touch.clientY };
      }
    },
    { passive: false }
  );

  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    update(dt);
    draw();
    requestAnimationFrame(frame);
  }

  for (let i = 0; i < 80; i++) spawn();
  // Guarantee a few tags at start
  let guard = 0;
  while (activeTagCount() < Math.min(3, MAX_TAGS) && guard++ < 40) {
    const p = particles[particles.length - 1];
    if (!p || p.term) {
      spawn();
      continue;
    }
    // force-tag empty particle
    const term = pickTerm();
    if (!term) break;
    p.term = term;
    p.maxLife = Math.max(p.maxLife, 3.2);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "tag";
    btn.textContent = term.term;
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      showTermPopup(term);
    });
    tagsEl.appendChild(btn);
    p.tagEl = btn;
  }

  requestAnimationFrame(frame);
})();
