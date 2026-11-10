/* Configuration for Decision Roulette. Exposes window.DR.config.
   Limits and the palette live in engine.js so the logic and its tests share them. */
(function () {
  "use strict";
  window.DR = window.DR || {};
  window.DR.config = {
    spinMs: 5200,          // full spin, from click to stop
    reducedMs: 900,        // spin length when the device asks for reduced motion
    sound: true,           // default for the tick sound; users can mute, and the choice is saved
    storageNote: "Saved in this browser only (localStorage key prefix dr_vault_v1_)."
  };
})();
