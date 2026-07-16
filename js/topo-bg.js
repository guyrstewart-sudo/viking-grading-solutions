/* ============================================================
   VIKING GRADING SOLUTIONS — topo-bg.js
   Animated topographic-contour background for the hero.

   What it does:
   - Generates rolling terrain with fractal value noise
   - Traces elevation contours with marching squares
   - Drifts the terrain slowly (like a survey scan of live earth)
   - Sweeps one glowing "grade line" (ember) through the elevations —
     the blade pass through the mountain
   - Faint surveyor grid + drifting dust motes

   Behavior contract:
   - Zero dependencies
   - Draws frame 0 synchronously (so a static frame always shows,
     even if requestAnimationFrame never ticks)
   - Full animation only on wide screens with no reduced-motion
     preference; otherwise a single static render
   - Pauses when the tab is hidden or the hero is scrolled away
   ============================================================ */
(function () {
  "use strict";

  var canvas = document.getElementById("topo-canvas");
  if (!canvas) return;
  var ctx = canvas.getContext("2d");

  /* ----- config ----- */
  var CELL = 18;          // marching-squares cell size (px)
  var LEVELS = 10;        // contour count
  var NOISE_SCALE = 0.0021;
  var DRIFT_X = 0.000016; // terrain drift per ms
  var DRIFT_Y = 0.000007;
  var DPR_CAP = 1.5;
  var DUST_N = 36;

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  // Animation runs on ALL viewports (client call, 2026-07-16: the mobile/iPad
  // hero should be alive too). This is affordable now because the loop is
  // capped at ~30fps, allocates nothing per frame, and pauses offscreen —
  // a phone-sized grid is ~1/8 the desktop cell count. Reduced-motion users
  // still get the static frame; that gate is non-negotiable.
  var animate = !reduceMotion;

  var W = 0, H = 0, dpr = 1;
  var cols = 0, rows = 0;
  var field = null;       // Float32Array of noise samples, (cols+1)*(rows+1)
  var dust = [];
  var running = false, rafId = 0, last = 0, t = 0;

  /* ----- "grading" state -----
     entrance: terrain relief rises from flat on load (the survey developing).
     flatten:  scroll progress levels the terrain toward the mean — the
               mountain being graded. Static renders always use full relief. */
  var entranceRaw = animate ? 0 : 1;
  var flatten = 0;
  function heroH() { return H || 1; }
  window.addEventListener("scroll", function () {
    var f = window.scrollY / heroH();
    flatten = f < 0 ? 0 : f > 1 ? 1 : f;
  }, { passive: true });

  /* ----- deterministic value noise ----- */
  function hash(ix, iy) {
    // Math.imul keeps every multiply in true 32-bit space — plain `*` here
    // silently overflows Float64 precision and biases the distribution.
    var h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h = h ^ (h >>> 16);
    return (h >>> 0) / 4294967296;
  }
  function smooth(a) { return a * a * (3 - 2 * a); }
  function noise2(x, y) {
    var ix = Math.floor(x), iy = Math.floor(y);
    var fx = smooth(x - ix), fy = smooth(y - iy);
    var a = hash(ix, iy), b = hash(ix + 1, iy);
    var c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  }
  /* 3 octaves of fractal noise — enough ridge character, still cheap */
  function terrain(x, y) {
    return noise2(x, y) * 0.62 +
           noise2(x * 2.13 + 40.7, y * 2.13 + 11.2) * 0.26 +
           noise2(x * 4.41 + 97.3, y * 4.41 + 63.9) * 0.12;
  }

  /* ----- sizing ----- */
  function resize() {
    var rect = canvas.parentElement.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP);
    W = Math.max(1, Math.round(rect.width));
    H = Math.max(1, Math.round(rect.height));
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cols = Math.ceil(W / CELL);
    rows = Math.ceil(H / CELL);
    field = new Float32Array((cols + 1) * (rows + 1));
    seedDust();
  }

  function seedDust() {
    dust.length = 0;
    for (var i = 0; i < DUST_N; i++) {
      dust.push({
        x: hash(i, 7) * W,
        y: hash(i, 13) * H,
        r: 0.6 + hash(i, 29) * 1.6,
        vx: 0.02 + hash(i, 31) * 0.05,   // drift up-right, like site dust
        vy: -(0.015 + hash(i, 37) * 0.04),
        a: 0.04 + hash(i, 41) * 0.09
      });
    }
  }

  /* ----- sample the terrain into the grid (once per frame) -----
     amp scales relief around the mean: entrance eases 0->1 on load,
     scroll-flatten pulls it back toward level (never fully zero, so a
     little texture always survives the grade). */
  function sampleField(time) {
    var e = entranceRaw >= 1 ? 1 : 1 - Math.pow(1 - entranceRaw, 3); /* ease-out cubic */
    var amp = e * (1 - 0.85 * flatten);
    var ox = time * DRIFT_X, oy = time * DRIFT_Y;
    var i = 0;
    for (var gy = 0; gy <= rows; gy++) {
      var ny = gy * CELL * NOISE_SCALE + oy;
      for (var gx = 0; gx <= cols; gx++) {
        field[i++] = 0.5 + (terrain(gx * CELL * NOISE_SCALE + ox, ny) - 0.5) * amp;
      }
    }
  }

  /* ----- marching squares: stroke every contour at threshold `iso` -----
     Edge points are written into preallocated scratch arrays — the old
     per-crossing [x,y] allocations were measurable GC churn at 60fps. */
  var PT_T = [0, 0], PT_R = [0, 0], PT_B = [0, 0], PT_L = [0, 0];
  function lerpInto(out, ax, ay, av, bx, by, bv, iso) {
    var d = (iso - av) / (bv - av || 1e-9);
    out[0] = ax + (bx - ax) * d;
    out[1] = ay + (by - ay) * d;
  }
  function traceContour(iso) {
    ctx.beginPath();
    var w1 = cols + 1;
    for (var gy = 0; gy < rows; gy++) {
      var y0 = gy * CELL, y1 = y0 + CELL;
      for (var gx = 0; gx < cols; gx++) {
        var x0 = gx * CELL, x1 = x0 + CELL;
        var tl = field[gy * w1 + gx],       tr = field[gy * w1 + gx + 1];
        var bl = field[(gy + 1) * w1 + gx], br = field[(gy + 1) * w1 + gx + 1];
        var idx = (tl > iso ? 8 : 0) | (tr > iso ? 4 : 0) |
                  (br > iso ? 2 : 0) | (bl > iso ? 1 : 0);
        if (idx === 0 || idx === 15) continue;

        /* interpolated edge crossings: top, right, bottom, left */
        lerpInto(PT_T, x0, y0, tl, x1, y0, tr, iso); var T = PT_T;
        lerpInto(PT_R, x1, y0, tr, x1, y1, br, iso); var R = PT_R;
        lerpInto(PT_B, x0, y1, bl, x1, y1, br, iso); var B = PT_B;
        lerpInto(PT_L, x0, y0, tl, x0, y1, bl, iso); var L = PT_L;

        /* segment table (ambiguous cases 5/10 resolved simply) */
        switch (idx) {
          case 1:  seg(L, B); break;
          case 2:  seg(B, R); break;
          case 3:  seg(L, R); break;
          case 4:  seg(T, R); break;
          case 5:  seg(T, R); seg(L, B); break;
          case 6:  seg(T, B); break;
          case 7:  seg(L, T); break;
          case 8:  seg(L, T); break;
          case 9:  seg(T, B); break;
          case 10: seg(L, T); seg(B, R); break;
          case 11: seg(T, R); break;
          case 12: seg(L, R); break;
          case 13: seg(B, R); break;
          case 14: seg(L, B); break;
        }
      }
    }
    ctx.stroke();
  }
  function seg(a, b) { ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); }

  /* ----- one full frame ----- */
  function draw(time) {
    sampleField(time);
    ctx.clearRect(0, 0, W, H);

    /* surveyor grid — barely-there engineering paper */
    ctx.strokeStyle = "rgba(237,230,218,0.030)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (var x = 0; x <= W; x += 80) { ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, H); }
    for (var y = 0; y <= H; y += 80) { ctx.moveTo(0, y + 0.5); ctx.lineTo(W, y + 0.5); }
    ctx.stroke();

    /* contour stack — every 5th level is an "index contour", drawn brighter */
    for (var l = 1; l <= LEVELS; l++) {
      var iso = l / (LEVELS + 1);
      var isIndex = (l % 5 === 0);
      ctx.strokeStyle = isIndex ? "rgba(237,230,218,0.14)" : "rgba(122,139,153,0.10)";
      ctx.lineWidth = isIndex ? 1.4 : 1;
      traceContour(iso);
    }

    /* the grade line — one ember contour sweeping through elevations,
       like the blade finding its level. As scroll flattens the terrain the
       sweep converges on the mean and brightens: finished grade. */
    var sweep = 0.5 + 0.30 * Math.sin(time * 0.00013) * (1 - flatten);
    var crisp = 0.55 + 0.30 * flatten;
    ctx.strokeStyle = "rgba(232,135,30,0.10)"; /* halo pass */
    ctx.lineWidth = 5;
    traceContour(sweep);
    ctx.strokeStyle = "rgba(232,135,30," + crisp.toFixed(2) + ")"; /* crisp pass */
    ctx.lineWidth = 1.6;
    traceContour(sweep);

    /* dust motes */
    ctx.fillStyle = "#EDE6DA";
    for (var i = 0; i < dust.length; i++) {
      var p = dust[i];
      ctx.globalAlpha = p.a;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, 6.2832);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function stepDust(dt) {
    for (var i = 0; i < dust.length; i++) {
      var p = dust[i];
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.x > W + 4) p.x = -4;
      if (p.y < -4) p.y = H + 4;
    }
  }

  /* ----- animation loop with visibility gating -----
     Capped at ~30fps regardless of display refresh (the drift is slow;
     120Hz panels were paying 4x the CPU for invisible smoothness). */
  var FRAME_MS = 33;
  function frame(now) {
    if (!running) return;
    rafId = requestAnimationFrame(frame);
    if (last && now - last < FRAME_MS) return;
    var dt = last ? Math.min(now - last, 50) : 16;
    last = now;
    t += dt;
    if (entranceRaw < 1) entranceRaw = Math.min(1, entranceRaw + dt / 1200);
    stepDust(dt);
    draw(t);
  }
  function start() {
    if (running || !animate) return;
    running = true; last = 0;
    rafId = requestAnimationFrame(frame);
  }
  function stop() {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
  }

  /* pause offscreen (hero scrolled away) and on hidden tab */
  if ("IntersectionObserver" in window) {
    new IntersectionObserver(function (entries) {
      entries[0].isIntersecting ? start() : stop();
    }, { threshold: 0.02 }).observe(canvas);
  }
  document.addEventListener("visibilitychange", function () {
    document.hidden ? stop() : start();
  });

  var resizeTimer;
  function remeasure() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () { resize(); draw(t); }, 120);
  }
  window.addEventListener("resize", remeasure);

  /* The hero can measure 0-wide if scripts run before layout settles
     (slow stylesheet, embedded webviews). Watch the container itself and
     re-verify after load so the canvas always ends up full-bleed. */
  if ("ResizeObserver" in window) {
    new ResizeObserver(remeasure).observe(canvas.parentElement);
  }
  window.addEventListener("load", function () { resize(); draw(t); });
  /* Bounded retry loop: the old one-shot 800ms check could fire while the
     container still measured 1px (embedded webviews) and never recover.
     Poll until the canvas has a sane width, up to ~2.5s. */
  var bootTries = 0;
  (function watchBoot() {
    if (canvas.width >= 100 || ++bootTries > 8) return;
    resize(); draw(t);
    setTimeout(watchBoot, 300);
  })();
  /* Belt-and-suspenders: first real scroll re-checks too (covers the
     "hero won't paint until a scroll nudge" failure family). */
  window.addEventListener("scroll", function onFirstScroll() {
    window.removeEventListener("scroll", onFirstScroll);
    if (canvas.width < 100) { resize(); draw(t); }
  }, { passive: true });

  /* ----- boot: always render frame 0 synchronously ----- */
  resize();
  draw(0);
  start();
  /* If rAF never ticks (some embedded webviews), the entrance ease would
     leave the terrain flat forever — force full relief and paint once. */
  setTimeout(function () {
    if (entranceRaw < 0.5) { entranceRaw = 1; draw(t); }
  }, 1600);
})();
