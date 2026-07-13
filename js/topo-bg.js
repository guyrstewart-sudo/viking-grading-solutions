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
  var isNarrow = window.matchMedia("(max-width: 820px)").matches;
  var animate = !(reduceMotion || isNarrow);

  var W = 0, H = 0, dpr = 1;
  var cols = 0, rows = 0;
  var field = null;       // Float32Array of noise samples, (cols+1)*(rows+1)
  var dust = [];
  var running = false, rafId = 0, last = 0, t = 0;

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

  /* ----- sample the terrain into the grid (once per frame) ----- */
  function sampleField(time) {
    var ox = time * DRIFT_X, oy = time * DRIFT_Y;
    var i = 0;
    for (var gy = 0; gy <= rows; gy++) {
      var ny = gy * CELL * NOISE_SCALE + oy;
      for (var gx = 0; gx <= cols; gx++) {
        field[i++] = terrain(gx * CELL * NOISE_SCALE + ox, ny);
      }
    }
  }

  /* ----- marching squares: stroke every contour at threshold `iso` ----- */
  function lerpPt(ax, ay, av, bx, by, bv, iso) {
    var d = (iso - av) / (bv - av || 1e-9);
    return [ax + (bx - ax) * d, ay + (by - ay) * d];
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
        var T = lerpPt(x0, y0, tl, x1, y0, tr, iso);
        var R = lerpPt(x1, y0, tr, x1, y1, br, iso);
        var B = lerpPt(x0, y1, bl, x1, y1, br, iso);
        var L = lerpPt(x0, y0, tl, x0, y1, bl, iso);

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
       like the blade finding its level */
    var sweep = 0.5 + 0.30 * Math.sin(time * 0.00013);
    ctx.strokeStyle = "rgba(232,135,30,0.10)"; /* halo pass */
    ctx.lineWidth = 5;
    traceContour(sweep);
    ctx.strokeStyle = "rgba(232,135,30,0.55)"; /* crisp pass */
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

  /* ----- animation loop with visibility gating ----- */
  function frame(now) {
    if (!running) return;
    var dt = last ? Math.min(now - last, 50) : 16;
    last = now;
    t += dt;
    stepDust(dt);
    draw(t);
    rafId = requestAnimationFrame(frame);
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
  setTimeout(function () {
    if (canvas.width < 100) { resize(); draw(t); }
  }, 800);

  /* ----- boot: always render frame 0 synchronously ----- */
  resize();
  draw(0);
  start();
})();
