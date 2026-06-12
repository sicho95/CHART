import { dismissBanner, initStore, setInstallPromptAvailable, showBanner, state } from "./store.js";
import { renderApp } from "./ui.js";

const root = document.getElementById("app");
const sprite = document.getElementById("icon-sprite");
document.body.prepend(sprite.content.cloneNode(true));
let deferredInstallPrompt = null;
let controllerRefreshPending = false;
const isIosSafari = /iphone|ipad|ipod/i.test(navigator.userAgent) && /safari/i.test(navigator.userAgent) && !/crios|fxios|edgios/i.test(navigator.userAgent);
const isStandalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;

window.addEventListener("online", () => {
  state.online = true;
  dismissBanner("offline");
  renderApp(root);
});

window.addEventListener("offline", () => {
  state.online = false;
  showBanner("offline");
  renderApp(root);
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").then((registration) => {
    registration.update().catch(() => {});
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (controllerRefreshPending) return;
      controllerRefreshPending = true;
      window.location.reload();
    });
  }).catch(() => {});
}

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  setInstallPromptAvailable(true);
});

window.addEventListener("chart-install-request", async () => {
  if (deferredInstallPrompt) {
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice.catch(() => null);
    deferredInstallPrompt = null;
    setInstallPromptAvailable(false);
    return;
  }
  if (isIosSafari && !isStandalone) {
    alert("Pour installer CHART sur iPhone ou iPad : ouvrez le menu Partager de Safari, puis choisissez 'Sur l’écran d’accueil'.");
  }
});

await initStore();
if (isIosSafari && !isStandalone) {
  setInstallPromptAvailable(true);
}
renderApp(root);

import("./store.js").then(({ subscribe }) => subscribe(() => renderApp(root)));
