/* SVG wheel renderer. Draws the slices from the entries' weights, with labels and a glowing hub.
   Every label is set with textContent and every shape with setAttribute, so user text is never parsed as HTML.
   Exposes window.DRWheel. */
(function () {
  "use strict";
  var NS = "http://www.w3.org/2000/svg";
  var CX = 200, CY = 200, R = 190;

  function el(name, attrs, parent) {
    var node = document.createElementNS(NS, name);
    Object.keys(attrs || {}).forEach(function (k) { node.setAttribute(k, String(attrs[k])); });
    if (parent) parent.appendChild(node);
    return node;
  }

  // Angle measured clockwise from the top (12 o'clock).
  function point(r, deg) {
    var a = deg * Math.PI / 180;
    return [CX + r * Math.sin(a), CY - r * Math.cos(a)];
  }

  function slicePath(start, end) {
    var p0 = point(R, start), p1 = point(R, end);
    var large = end - start > 180 ? 1 : 0;
    return "M" + CX + " " + CY + " L" + p0[0].toFixed(2) + " " + p0[1].toFixed(2) +
      " A" + R + " " + R + " 0 " + large + " 1 " + p1[0].toFixed(2) + " " + p1[1].toFixed(2) + " Z";
  }

  function shorten(label, maxChars) {
    return label.length > maxChars ? label.slice(0, Math.max(1, maxChars - 1)) + "…" : label;
  }

  // slices: output of DREngine.sliceAngles. Returns the rotating group.
  function render(svg, slices) {
    while (svg.firstChild) svg.removeChild(svg.firstChild);

    var defs = el("defs", {}, svg);
    var hubGrad = el("radialGradient", { id: "dr-hub" }, defs);
    el("stop", { offset: "0", "stop-color": "#ffffff" }, hubGrad);
    el("stop", { offset: "1", "stop-color": "#b76cff" }, hubGrad);
    var glow = el("filter", { id: "dr-glow", x: "-20%", y: "-20%", width: "140%", height: "140%" }, defs);
    el("feGaussianBlur", { stdDeviation: "6", result: "b" }, glow);
    var merge = el("feMerge", {}, glow);
    el("feMergeNode", { in: "b" }, merge);
    el("feMergeNode", { in: "SourceGraphic" }, merge);

    // Neon outer ring.
    el("circle", { cx: CX, cy: CY, r: R + 8, fill: "none", stroke: "#00d4ff", "stroke-width": "4", opacity: "0.8", filter: "url(#dr-glow)" }, svg);

    var group = el("g", { class: "wheel-group" }, svg);
    var n = slices.length;
    var fs = Math.max(9, Math.min(18, 22 - n * 0.5));

    slices.forEach(function (s) {
      if (n === 1) {
        el("circle", { cx: CX, cy: CY, r: R, fill: s.color }, group);
      } else {
        el("path", { d: slicePath(s.start, s.end), fill: s.color, stroke: "#0b0b16", "stroke-width": "1.5" }, group);
      }
    });

    slices.forEach(function (s) {
      // Labels on the lower half are turned 180 degrees and moved to the other side, so they always read outward and upright.
      var flip = s.mid > 90 && s.mid < 270;
      var angle = flip ? s.mid + 180 : s.mid;
      var radial = flip ? CY + R * 0.66 : CY - R * 0.66;
      var g = el("g", { transform: "rotate(" + angle.toFixed(3) + " " + CX + " " + CY + ")" }, group);
      var maxChars = Math.max(4, Math.round(24 * Math.min(1, s.span / 90)));
      var t = el("text", {
        x: CX, y: radial, "text-anchor": "middle", "dominant-baseline": "middle",
        "font-size": fs.toFixed(1), "font-weight": "800", fill: "#0b0b16",
        "font-family": "system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
      }, g);
      t.textContent = shorten(s.label, maxChars);
    });

    el("circle", { cx: CX, cy: CY, r: 34, fill: "url(#dr-hub)", stroke: "#0b0b16", "stroke-width": "4" }, svg);
    el("circle", { cx: CX, cy: CY, r: 10, fill: "#0b0b16" }, svg);

    // Pointer at the top, above the wheel.
    el("path", { d: "M" + CX + " 6 L" + (CX - 16) + " -22 L" + (CX + 16) + " -22 Z", fill: "#ffe14d", stroke: "#0b0b16", "stroke-width": "2", filter: "url(#dr-glow)" }, svg);

    return group;
  }

  function setRotation(group, deg) {
    group.setAttribute("transform", "rotate(" + deg.toFixed(3) + " " + CX + " " + CY + ")");
  }

  window.DRWheel = { render: render, setRotation: setRotation };
})();
