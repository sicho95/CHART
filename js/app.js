import { dismissBanner, initStore, setInstallPromptAvailable, showBanner, state } from "./store.js";
import { renderApp } from "./ui.js";

const root = document.getElementById("app");
const sprite = document.getElementById("icon-sprite");
document.body.prepend(sprite.content.cloneNode(true));
let deferredInstallPrompt = null;
let controllerRefreshPending = false;
let swRegistration = null;
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
  navigator.serviceWorker.register("./sw.js", { updateViaCache: "none" }).then((registration) => {
    swRegistration = registration;
    monitorServiceWorker(registration);
    requestPwaUpdate();
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (controllerRefreshPending) return;
      controllerRefreshPending = true;
      window.location.reload();
    });
    window.addEventListener("pageshow", requestPwaUpdate);
    window.addEventListener("focus", requestPwaUpdate);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") requestPwaUpdate();
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

function requestPwaUpdate() {
  if (!navigator.onLine || !swRegistration) return;
  swRegistration.update().catch(() => {});
  if (swRegistration.waiting) {
    swRegistration.waiting.postMessage({ type: "SKIP_WAITING" });
  }
}

function monitorServiceWorker(registration) {
  registration.addEventListener("updatefound", () => {
    const worker = registration.installing;
    if (!worker) return;
    worker.addEventListener("statechange", () => {
      if (worker.state === "installed" && navigator.serviceWorker.controller) {
        worker.postMessage({ type: "SKIP_WAITING" });
      }
    });
  });
  if (registration.waiting) {
    registration.waiting.postMessage({ type: "SKIP_WAITING" });
  }
}
