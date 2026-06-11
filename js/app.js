import { initStore, state } from "./store.js";
import { renderApp } from "./ui.js";

const root = document.getElementById("app");
const sprite = document.getElementById("icon-sprite");
document.body.prepend(sprite.content.cloneNode(true));

window.addEventListener("online", () => {
  state.online = true;
  renderApp(root);
});

window.addEventListener("offline", () => {
  state.online = false;
  renderApp(root);
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}

await initStore();
renderApp(root);

import("./store.js").then(({ subscribe }) => subscribe(() => renderApp(root)));
