/* Decision Roulette engine: pure logic, no DOM. Works in the browser (window.DREngine) and in Node.

   - Entries: label, integer weight 1-10, colour. Validated on every change.
   - Slices: angle = weight / total weight x 360, measured clockwise from the top (the pointer).
   - Winner first: the winning slice is chosen with a fair random source, and the spin is planned so it
     stops inside that slice. The result never depends on where an animation happens to end.
   - Spin profile: velocity v(s) = smoothstep(0, 0.15, s) x (1 - s)^2. It starts from rest, speeds up
     quickly, cruises, then slows with quadratic friction to rest. Position is the integral of v,
     normalised so it runs from 0 to 1. Integrating a non-negative velocity keeps the wheel from
     reversing.
   - Command dispatcher and namespaced vault (prefix dr_vault_v1_). Each command validates its input. */
(function (root, factory) {
  var api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    root.DREngine = api;
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var LIMITS = {
    maxEntries: 40, maxLabel: 30, minWeight: 1, maxWeight: 10,
    maxPresets: 20, maxPresetName: 30, maxLogs: 200, minSpinEntries: 2
  };

  var PALETTE = [
    "#ff3d8b", "#00f5a0", "#00d4ff", "#b76cff", "#ffe14d", "#ff7a18",
    "#3dffa2", "#ff5fa2", "#4cc9f0", "#f72585", "#7bff00", "#ffb703"
  ];

  var PREFIX = "dr_vault_v1_";

  // ---------- Validation ----------

  function sanitizeLabel(text) {
    var t = String(text == null ? "" : text).replace(/[\u0000-\u001f\u007f]/g, "").trim();
    if (!t) throw new Error("Label cannot be empty");
    if (t.length > LIMITS.maxLabel) throw new Error("Label must be " + LIMITS.maxLabel + " characters or fewer");
    return t;
  }

  function sanitizeWeight(w) {
    var n = Number(w);
    if (!Number.isInteger(n) || n < LIMITS.minWeight || n > LIMITS.maxWeight) {
      throw new Error("Weight must be a whole number from " + LIMITS.minWeight + " to " + LIMITS.maxWeight);
    }
    return n;
  }

  function sanitizeColor(c) {
    var s = String(c == null ? "" : c).trim();
    if (!/^#[0-9a-fA-F]{6}$/.test(s)) throw new Error("Colour must look like #a1b2c3");
    return s.toLowerCase();
  }

  // Next palette colour not already used, so new entries are visually distinct.
  function nextColor(entries) {
    var used = entries.map(function (e) { return e.color; });
    for (var i = 0; i < PALETTE.length; i++) {
      if (used.indexOf(PALETTE[i]) < 0) return PALETTE[i];
    }
    return PALETTE[entries.length % PALETTE.length];
  }

  // Validates a stored or incoming entry list. Throws on the first problem.
  function validateEntries(list) {
    if (!Array.isArray(list)) throw new Error("Entries must be a list");
    if (list.length > LIMITS.maxEntries) throw new Error("At most " + LIMITS.maxEntries + " entries");
    var seen = {};
    return list.map(function (e) {
      if (!e || typeof e.id !== "string" || !e.id) throw new Error("Entry is missing an id");
      if (seen[e.id]) throw new Error("Duplicate entry id");
      seen[e.id] = true;
      return {
        id: e.id,
        label: sanitizeLabel(e.label),
        weight: sanitizeWeight(e.weight),
        color: sanitizeColor(e.color)
      };
    });
  }

  // ---------- Geometry ----------

  function mod360(x) {
    return ((x % 360) + 360) % 360;
  }

  // [{ id, label, color, start, end, mid, span }], angles clockwise from the top.
  function sliceAngles(entries) {
    var total = entries.reduce(function (a, e) { return a + e.weight; }, 0);
    var cum = 0;
    return entries.map(function (e) {
      var span = total ? (e.weight / total) * 360 : 0;
      var s = { id: e.id, label: e.label, color: e.color, start: cum, end: cum + span, mid: cum + span / 2, span: span };
      cum += span;
      return s;
    });
  }

  // Which entry sits under the pointer after the wheel has turned by `rotation` degrees (clockwise).
  function winnerAt(entries, rotation) {
    var slices = sliceAngles(entries);
    var x = mod360(-rotation);
    for (var i = 0; i < slices.length; i++) {
      if (x >= slices[i].start && x < slices[i].end) return i;
    }
    return slices.length - 1;
  }

  // ---------- Fair choice and spin plan ----------

  // Picks an index with probability proportional to its weight. rand01 returns a number in [0, 1).
  function chooseWinnerIndex(entries, rand01) {
    var total = entries.reduce(function (a, e) { return a + e.weight; }, 0);
    var r = rand01() * total;
    var cum = 0;
    for (var i = 0; i < entries.length; i++) {
      cum += entries[i].weight;
      if (r < cum) return i;
    }
    return entries.length - 1;
  }

  // Plans one spin. The winner is chosen first; the wheel then turns enough full laps to land on a point
  // inside that winner's slice. Keeps a margin from the slice edges so a result never sits on a boundary.
  function planSpin(opts) {
    var entries = opts.entries;
    if (entries.length < LIMITS.minSpinEntries) throw new Error("Add at least two entries to spin");
    var rand01 = opts.rand01;
    var R0 = Number(opts.currentRotation) || 0;
    var slices = sliceAngles(entries);
    var idx = chooseWinnerIndex(entries, rand01);
    var s = slices[idx];
    var margin = Math.min(s.span * 0.2, 4);
    var offset = s.span > 2 * margin
      ? s.start + margin + rand01() * (s.span - 2 * margin)
      : s.mid;
    // Final rotation R must satisfy mod360(-R) = offset.
    var targetMod = mod360(-offset - R0);
    var turns = (opts.minTurns || 5) + Math.floor(rand01() * 3);
    var D = turns * 360 + targetMod;
    return { winnerIndex: idx, winnerId: s.id, offset: offset, R0: R0, D: D, duration: opts.duration };
  }

  // ---------- Spin profile ----------

  function smoothstep(a, b, x) {
    var t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  }

  // Velocity shape: zero at the start, peaks early, zero at the end.
  function velocityShape(s) {
    return smoothstep(0, 0.15, s) * (1 - s) * (1 - s);
  }

  var TABLE_N = 1024;
  var TABLE = (function () {
    var v = [];
    for (var i = 0; i <= TABLE_N; i++) v.push(velocityShape(i / TABLE_N));
    var cum = [0];
    for (var k = 1; k <= TABLE_N; k++) {
      cum.push(cum[k - 1] + (v[k - 1] + v[k]) / 2 / TABLE_N); // trapezoid rule
    }
    var total = cum[TABLE_N];
    return cum.map(function (c) { return c / total; });
  })();

  // Fraction of the total spin completed at progress u in [0, 1]. Runs 0 -> 1, non-decreasing.
  function easeSpin(u) {
    if (u <= 0) return 0;
    if (u >= 1) return 1;
    var x = u * TABLE_N;
    var i = Math.floor(x);
    var f = x - i;
    return TABLE[i] + (TABLE[i + 1] - TABLE[i]) * f;
  }

  function rotationAt(plan, elapsedMs) {
    var u = plan.duration ? elapsedMs / plan.duration : 1;
    return plan.R0 + plan.D * easeSpin(u);
  }

  // ---------- Vault: namespaced localStorage with an in-memory fallback ----------

  function createVault(opts) {
    var storage = opts && opts.storage;
    var prefix = (opts && opts.prefix) || PREFIX;
    var mem = {};

    function read(key, fallback) {
      if (!storage) return key in mem ? mem[key] : fallback;
      try {
        var raw = storage.getItem(prefix + key);
        return raw === null ? fallback : JSON.parse(raw);
      } catch (e) {
        return key in mem ? mem[key] : fallback;
      }
    }

    function write(key, value) {
      mem[key] = value;
      if (!storage) return true;
      try {
        storage.setItem(prefix + key, JSON.stringify(value));
        return true;
      } catch (e) {
        return false;
      }
    }

    return { read: read, write: write, prefix: prefix };
  }

  // ---------- Command dispatcher ----------

  // opts: { vault, rand01, now }
  function createDispatcher(opts) {
    var vault = opts.vault;
    var rand01 = opts.rand01;
    var now = opts.now || Date.now;
    var counter = 0;

    function newId() {
      counter++;
      return "e" + now().toString(36) + counter.toString(36) + Math.floor(rand01() * 1e6).toString(36);
    }

    function defaults() {
      var base = [{ id: newId(), label: "Option 1", weight: 1, color: PALETTE[0] },
        { id: newId(), label: "Option 2", weight: 1, color: PALETTE[1] },
        { id: newId(), label: "Option 3", weight: 1, color: PALETTE[2] }];
      return base;
    }

    var entries;
    try {
      var storedEntries = vault.read("choices", null);
      entries = storedEntries === null ? defaults() : validateEntries(storedEntries);
    } catch (e) {
      entries = defaults();
    }
    var presets = vault.read("presets", []);
    if (!Array.isArray(presets)) presets = [];
    var logs = vault.read("logs", []);
    if (!Array.isArray(logs)) logs = [];
    var settings = vault.read("settings", { sound: true });

    function persistChoices() { vault.write("choices", entries); }
    function persistPresets() { vault.write("presets", presets); }
    function persistLogs() { vault.write("logs", logs); }
    function persistSettings() { vault.write("settings", settings); }

    function copy(o) { return JSON.parse(JSON.stringify(o)); }

    function findEntry(id) {
      for (var i = 0; i < entries.length; i++) if (entries[i].id === id) return entries[i];
      throw new Error("Entry not found");
    }

    var handlers = {
      "choices.add": function (p) {
        if (entries.length >= LIMITS.maxEntries) throw new Error("At most " + LIMITS.maxEntries + " entries");
        var e = {
          id: newId(),
          label: sanitizeLabel(p.label),
          weight: p.weight === undefined ? 1 : sanitizeWeight(p.weight),
          color: p.color === undefined ? nextColor(entries) : sanitizeColor(p.color)
        };
        entries.push(e);
        persistChoices();
        return copy(e);
      },

      "choices.update": function (p) {
        var e = findEntry(p.id);
        if (p.label !== undefined) e.label = sanitizeLabel(p.label);
        if (p.weight !== undefined) e.weight = sanitizeWeight(p.weight);
        if (p.color !== undefined) e.color = sanitizeColor(p.color);
        persistChoices();
        return copy(e);
      },

      "choices.remove": function (p) {
        findEntry(p.id);
        entries = entries.filter(function (e) { return e.id !== p.id; });
        persistChoices();
        return { ok: true };
      },

      "choices.savePreset": function (p) {
        var name = sanitizeLabel(p.name);
        var snapshot = entries.map(function (e) { return { label: e.label, weight: e.weight, color: e.color }; });
        presets = presets.filter(function (x) { return x.name !== name; });
        if (presets.length >= LIMITS.maxPresets) throw new Error("At most " + LIMITS.maxPresets + " presets");
        presets.push({ name: name, entries: snapshot, savedAt: now() });
        persistPresets();
        return { name: name, count: snapshot.length };
      },

      "choices.loadPreset": function (p) {
        var preset = presets.filter(function (x) { return x.name === p.name; })[0];
        if (!preset) throw new Error("Preset not found");
        entries = preset.entries.map(function (x) {
          return { id: newId(), label: sanitizeLabel(x.label), weight: sanitizeWeight(x.weight), color: sanitizeColor(x.color) };
        });
        persistChoices();
        return { count: entries.length };
      },

      "choices.deletePreset": function (p) {
        presets = presets.filter(function (x) { return x.name !== p.name; });
        persistPresets();
        return { ok: true };
      },

      "wheel.spin": function (p) {
        var plan = planSpin({
          entries: entries, currentRotation: p.rotation, rand01: rand01,
          minTurns: 5, duration: p.duration
        });
        var winner = entries[plan.winnerIndex];
        return { plan: plan, winnerId: winner.id, winnerLabel: winner.label, winnerColor: winner.color };
      },

      "logs.add": function (p) {
        logs.unshift({ id: newId(), winner: sanitizeLabel(p.winner), count: entries.length, at: now() });
        if (logs.length > LIMITS.maxLogs) logs.length = LIMITS.maxLogs;
        persistLogs();
        return { count: logs.length };
      },

      "logs.clear": function () {
        logs = [];
        persistLogs();
        return { ok: true };
      },

      "settings.set": function (p) {
        if (p.key !== "sound") throw new Error("Unknown setting");
        settings.sound = !!p.value;
        persistSettings();
        return { sound: settings.sound };
      }
    };

    // Runs a command. Commands that change data return a copy of the result, never a live reference.
    function dispatch(name, payload) {
      var h = handlers[name];
      if (!h) throw new Error("Unknown command: " + name);
      return h(payload || {});
    }

    function state() {
      return copy({ entries: entries, presets: presets, logs: logs, settings: settings });
    }

    return { dispatch: dispatch, state: state, commands: Object.keys(handlers) };
  }

  return {
    LIMITS: LIMITS,
    PALETTE: PALETTE,
    PREFIX: PREFIX,
    sanitizeLabel: sanitizeLabel,
    sanitizeWeight: sanitizeWeight,
    sanitizeColor: sanitizeColor,
    validateEntries: validateEntries,
    sliceAngles: sliceAngles,
    winnerAt: winnerAt,
    chooseWinnerIndex: chooseWinnerIndex,
    planSpin: planSpin,
    easeSpin: easeSpin,
    rotationAt: rotationAt,
    createVault: createVault,
    createDispatcher: createDispatcher,
    mod360: mod360
  };
});
