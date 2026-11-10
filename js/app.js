/* Decision Roulette controller: the spin animation (requestAnimationFrame), the entry matrix, presets,
   history, the result dialog and the sound. All data changes go through the command dispatcher.
   Runs on load. */
(function () {
  "use strict";
  var E = window.DREngine;
  var W = window.DRWheel;
  var CFG = window.DR.config;

  function $(id) { return document.getElementById(id); }

  // ---------- Storage and the dispatcher ----------
  function usableStorage() {
    try {
      var s = window.localStorage;
      var probe = "__dr_probe__";
      s.setItem(probe, "1");
      s.removeItem(probe);
      return s;
    } catch (e) {
      return null; // blocked: the app keeps working for this visit
    }
  }

  var disp = E.createDispatcher({
    vault: E.createVault({ storage: usableStorage() }),
    rand01: Math.random,
    now: Date.now
  });

  // Runs a command and returns { ok, value } or { ok: false, error }. Nothing throws into the UI.
  function cmd(name, payload) {
    try {
      return { ok: true, value: disp.dispatch(name, payload) };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  // ---------- Small helpers ----------
  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function setMsg(el, text, isError) {
    el.textContent = text;
    el.className = isError ? "error" : "ok";
  }

  function setGlobal(text, isError) {
    var g = $("global-msg");
    g.textContent = text;
    g.className = "status" + (isError ? " is-error" : "");
  }

  var reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---------- Wheel ----------
  var svg = $("wheel-svg");
  var group = null;
  var rotation = 0;     // total degrees the wheel has turned, clockwise
  var spinning = false;
  var lastSlice = -1;

  function drawWheel() {
    var st = disp.state();
    var slices = E.sliceAngles(st.entries);
    if (!slices.length) {
      svg.innerHTML = "";
      group = null;
      return;
    }
    group = W.render(svg, slices);
    W.setRotation(group, rotation);
  }

  // ---------- Sound (Web Audio, no files) ----------
  var audioCtx = null;
  function ctxOrNull() {
    if (!disp.state().settings.sound) return null;
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      if (!audioCtx) audioCtx = new AC();
      if (audioCtx.state === "suspended") audioCtx.resume();
      return audioCtx;
    } catch (e) {
      return null;
    }
  }

  function blip(freq, dur, vol, delay, type) {
    var c = ctxOrNull();
    if (!c) return;
    var t0 = c.currentTime + (delay || 0);
    var o = c.createOscillator();
    var g = c.createGain();
    o.type = type || "square";
    o.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g);
    g.connect(c.destination);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }

  var FX = {
    tick: function () { blip(1400, 0.03, 0.05, 0, "square"); },
    win: function () {
      [659, 784, 988, 1319].forEach(function (f, i) { blip(f, 0.22, 0.12, i * 0.09, "triangle"); });
    }
  };

  // ---------- Spin ----------
  function spin() {
    if (spinning) return;
    var st = disp.state();
    if (st.entries.length < 2) {
      setGlobal("Add at least two options to spin.", true);
      return;
    }
    var r = cmd("wheel.spin", { rotation: rotation, duration: reduced ? CFG.reducedMs : CFG.spinMs });
    if (!r.ok) {
      setGlobal(r.error, true);
      return;
    }
    var plan = r.value.plan;
    var result = r.value;
    spinning = true;
    setGlobal("", false);
    $("spin-btn").disabled = true;
    $("spin-hint").textContent = "Spinning…";
    lastSlice = E.winnerAt(st.entries, rotation);
    ctxOrNull(); // unlock audio inside the click

    var t0 = null;
    function frame(ts) {
      if (t0 === null) t0 = ts;
      var elapsed = ts - t0;
      var angle = E.rotationAt(plan, elapsed);
      if (group) W.setRotation(group, angle);
      // Tick each time the pointer crosses into a new slice.
      var now = E.winnerAt(st.entries, angle);
      if (now !== lastSlice) {
        lastSlice = now;
        FX.tick();
      }
      if (elapsed < plan.duration) {
        window.requestAnimationFrame(frame);
      } else {
        finish(plan, result);
      }
    }
    window.requestAnimationFrame(frame);
  }

  function finish(plan, result) {
    rotation = plan.R0 + plan.D;
    if (group) W.setRotation(group, rotation);

    var st = disp.state();
    var landed = E.winnerAt(st.entries, rotation);
    var label = st.entries[landed] ? st.entries[landed].label : result.winnerLabel;
    var color = st.entries[landed] ? st.entries[landed].color : result.winnerColor;

    spinning = false;
    $("spin-btn").disabled = false;
    $("spin-hint").textContent = "Result saved to history.";
    cmd("logs.add", { winner: label });
    renderHistory();
    showResult(label, color);
    FX.win();
  }

  function showResult(label, color) {
    $("result-title").textContent = label;
    $("result-swatch").style.setProperty("--swatch", color);
    var d = $("result");
    if (typeof d.showModal === "function") d.showModal(); else d.setAttribute("open", "");
  }

  function closeResult() {
    var d = $("result");
    if (typeof d.close === "function") d.close(); else d.removeAttribute("open");
  }

  // ---------- Entry matrix ----------
  function renderEntries() {
    var st = disp.state();
    var list = $("entries");
    $("entry-count").textContent = st.entries.length + " of " + E.LIMITS.maxEntries;
    if (!st.entries.length) {
      list.innerHTML = '<li class="muted">No options yet. Add one above.</li>';
      return;
    }
    list.innerHTML = st.entries.map(function (e, i) {
      var opts = "";
      for (var w = E.LIMITS.minWeight; w <= E.LIMITS.maxWeight; w++) {
        opts += '<option value="' + w + '"' + (w === e.weight ? " selected" : "") + ">" + w + "</option>";
      }
      return '<li class="entry" style="--swatch:' + esc(e.color) + '" data-id="' + esc(e.id) + '">' +
        '<input class="swatch-input" type="color" value="' + esc(e.color) + '" aria-label="Colour for ' + esc(e.label) + '" data-act="color">' +
        '<input class="label-input" type="text" maxlength="30" value="' + esc(e.label) + '" aria-label="Option ' + (i + 1) + ' label" data-act="label">' +
        '<select class="weight-select" aria-label="Weight for ' + esc(e.label) + '" data-act="weight">' + opts + "</select>" +
        '<button type="button" class="del" data-act="delete" aria-label="Delete ' + esc(e.label) + '">×</button>' +
        '<span class="pos">#' + (i + 1) + "</span>" +
        "</li>";
    }).join("");
  }

  function applyChange(act, id, el) {
    if (spinning) {
      setGlobal("Wait for the wheel to stop before changing options.", true);
      renderEntries();
      return;
    }
    var r;
    if (act === "label") r = cmd("choices.update", { id: id, label: el.value });
    if (act === "weight") r = cmd("choices.update", { id: id, weight: Number(el.value) });
    if (act === "color") r = cmd("choices.update", { id: id, color: el.value });
    if (act === "delete") r = cmd("choices.remove", { id: id });
    if (!r) return;
    if (!r.ok) {
      setGlobal(r.error, true);
      renderEntries(); // restore the saved value in the field
      return;
    }
    setGlobal("", false);
    refreshAll();
  }

  $("entries").addEventListener("change", function (e) {
    var el = e.target;
    var act = el.getAttribute("data-act");
    if (!act || act === "delete") return;
    var id = el.closest("[data-id]").getAttribute("data-id");
    applyChange(act, id, el);
  });

  $("entries").addEventListener("click", function (e) {
    var btn = e.target.closest("[data-act='delete']");
    if (!btn) return;
    var id = btn.closest("[data-id]").getAttribute("data-id");
    applyChange("delete", id, btn);
  });

  // Next colour the add form should suggest: the first palette colour not already used.
  function suggestColor() {
    var used = disp.state().entries.map(function (x) { return x.color; });
    var pick = E.PALETTE.filter(function (c) { return used.indexOf(c) < 0; })[0] || E.PALETTE[0];
    $("add-color").value = pick;
  }

  $("add-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var label = $("add-label").value;
    var weight = Number($("add-weight").value);
    var color = $("add-color").value;
    var r = cmd("choices.add", { label: label, weight: weight, color: color });
    if (!r.ok) {
      setMsg($("add-msg"), r.error, true);
      return;
    }
    setMsg($("add-msg"), "Added \"" + r.value.label + "\".", false);
    $("add-label").value = "";
    suggestColor();
    refreshAll();
    $("add-label").focus();
  });

  function populateWeights() {
    var opts = "";
    for (var w = E.LIMITS.minWeight; w <= E.LIMITS.maxWeight; w++) {
      opts += '<option value="' + w + '"' + (w === 1 ? " selected" : "") + ">" + w + "</option>";
    }
    $("add-weight").innerHTML = opts;
  }

  // ---------- Presets ----------
  function renderPresets() {
    var st = disp.state();
    var sel = $("preset-select");
    var prev = sel.value;
    if (!st.presets.length) {
      sel.innerHTML = '<option value="">No presets yet</option>';
      sel.disabled = true;
    } else {
      sel.disabled = false;
      sel.innerHTML = st.presets.map(function (p) {
        return '<option value="' + esc(p.name) + '">' + esc(p.name) + " (" + p.entries.length + ")</option>";
      }).join("");
      if (prev && st.presets.some(function (p) { return p.name === prev; })) sel.value = prev;
    }
  }

  $("preset-save").addEventListener("click", function () {
    var r = cmd("choices.savePreset", { name: $("preset-name").value });
    if (!r.ok) { setMsg($("preset-msg"), r.error, true); return; }
    setMsg($("preset-msg"), "Saved preset \"" + r.value.name + "\" with " + r.value.count + " options.", false);
    $("preset-name").value = "";
    renderPresets();
  });

  $("preset-load").addEventListener("click", function () {
    var name = $("preset-select").value;
    if (!name) { setMsg($("preset-msg"), "Choose a preset first.", true); return; }
    if (spinning) return;
    var r = cmd("choices.loadPreset", { name: name });
    if (!r.ok) { setMsg($("preset-msg"), r.error, true); return; }
    setMsg($("preset-msg"), "Loaded \"" + name + "\".", false);
    refreshAll();
  });

  $("preset-delete").addEventListener("click", function () {
    var name = $("preset-select").value;
    if (!name) return;
    if (!window.confirm("Delete the preset \"" + name + "\"?")) return;
    cmd("choices.deletePreset", { name: name });
    setMsg($("preset-msg"), "Deleted \"" + name + "\".", false);
    renderPresets();
  });

  // ---------- History ----------
  function renderHistory() {
    var st = disp.state();
    var list = $("logs");
    if (!st.logs.length) {
      list.innerHTML = '<li class="muted">No results yet. Spin the wheel to start a log.</li>';
      return;
    }
    list.innerHTML = st.logs.map(function (l) {
      return '<li class="log-item"><strong>' + esc(l.winner) + "</strong><span class=\"muted\">" + l.count +
        " options</span><span class=\"when\">" + esc(new Date(l.at).toLocaleString()) + "</span></li>";
    }).join("");
  }

  $("clear-logs").addEventListener("click", function () {
    if (!window.confirm("Clear all history logs?")) return;
    cmd("logs.clear");
    renderHistory();
  });

  // ---------- Sound toggle ----------
  function renderSound() {
    var on = !!disp.state().settings.sound;
    var b = $("sound-btn");
    b.textContent = on ? "Sound on" : "Sound off";
    b.setAttribute("aria-pressed", String(on));
  }

  $("sound-btn").addEventListener("click", function () {
    var on = !disp.state().settings.sound;
    cmd("settings.set", { key: "sound", value: on });
    renderSound();
  });

  // ---------- Spin button and dialog ----------
  $("spin-btn").addEventListener("click", spin);
  $("result-close").addEventListener("click", closeResult);
  $("result-again").addEventListener("click", function () {
    closeResult();
    spin();
  });

  document.addEventListener("keydown", function (e) {
    if (e.code !== "Space" || e.repeat) return;
    var tag = (e.target && e.target.tagName) || "";
    if (/INPUT|SELECT|TEXTAREA|BUTTON/.test(tag)) return; // don't hijack typing or buttons
    if (!$("result").open) {
      e.preventDefault();
      spin();
    }
  });

  // ---------- Tabs (phones) and split-screen (laptops) ----------
  var state = { section: "wheel" };
  var mqDesktop = window.matchMedia("(min-width: 1024px)");
  var doc = document.documentElement;

  function applyLayout() {
    doc.dataset.layout = mqDesktop.matches ? "desktop" : "mobile";
  }

  function applySection() {
    document.querySelectorAll("[data-section]").forEach(function (el) {
      el.classList.toggle("is-active", el.getAttribute("data-section") === state.section);
    });
    document.querySelectorAll(".tabbar [data-target]").forEach(function (btn) {
      var on = btn.getAttribute("data-target") === state.section;
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-selected", String(on));
    });
  }

  document.querySelectorAll(".tabbar [data-target]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      state.section = btn.getAttribute("data-target");
      applySection();
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  });

  mqDesktop.addEventListener("change", applyLayout);

  // ---------- Start ----------
  function refreshAll() {
    renderEntries();
    drawWheel();
    renderPresets();
    renderSound();
    var n = disp.state().entries.length;
    $("spin-btn").disabled = spinning || n < 2;
    $("spin-hint").textContent = n < 2 ? "Add at least two options to spin." : "Each option's slice is sized by its weight.";
  }

  populateWeights();
  suggestColor();
  applyLayout();
  applySection();
  renderHistory();
  refreshAll();
})();
