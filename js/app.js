// The app's script. Render data with textContent (never innerHTML); no eval; no third-party requests.
"use strict";

document.addEventListener("DOMContentLoaded", () => {
  const status = document.getElementById("status");
  if (status) status.textContent = "Ready";
});
