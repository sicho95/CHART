import {
  addAttachments,
  addEvent,
  closeIncident,
  createIncident,
  deleteAttachment,
  deleteContact,
  dismissBanner,
  downloadExport,
  ensureIncidentReport,
  lastExportAt,
  replaceFromImport,
  reopenIncident,
  resetWorkspace,
  saveCheckpoint,
  saveContact,
  saveEvent,
  saveProject,
  selectIncident,
  selectProject,
  setFilter,
  setRoute,
  setSearch,
  setTheme,
  state
} from "./store.js";
import {
  DEFAULT_GROUPS,
  DEFAULT_SEVERITIES,
  DEFAULT_STATUSES,
  DEFAULT_TYPES,
  escapeHtml,
  formatDate,
  formatDuration,
  labelStatus,
  msToReadable,
  severityClass,
  statusClass,
  timelineStats
} from "./domain.js";

let toastTimer;
let bannerTimers = {};

export function renderApp(root) {
  root.innerHTML = `
    <div class="layout">
      <header class="topbar">
        <div class="brand">
          <div class="brand-title"><span class="brand-mark">C</span><span>CHART</span></div>
          <div class="brand-subtitle">Chronology & History of Alerts, Reporting and Tracking</div>
        </div>
        <div class="top-actions">
          <button class="btn icon" data-action="theme" title="Basculer le thème">${icon("i-settings")}</button>
          <button class="btn incident" data-action="new-incident">${icon("i-plus")}<span>Incident</span></button>
        </div>
      </header>
      <aside class="rail">${navMarkup("nav")}</aside>
      <main class="main">
        ${bannerMarkup()}
        ${routeMarkup()}
      </main>
      ${navMarkup("bottom-nav")}
    </div>
  `;
  bindEvents(root);
  scheduleBannerAutoDismiss();
}

function bannerMarkup() {
  const banners = [];
  if (!state.online && !state.dismissedBanners.offline) {
    banners.push(`<div class="notice offline"><span>Vous êtes hors ligne, les données restent disponibles localement.</span><button class="notice-close" data-action="dismiss-banner" data-banner="offline" aria-label="Fermer">${icon("i-x")}</button></div>`);
  }
  if (state.persistentStorage === false && !state.dismissedBanners.storage) {
    banners.push(`<div class="notice storage-note"><span>Le navigateur ne garantit pas encore le stockage persistant. Pensez à exporter régulièrement.</span><button class="notice-close" data-action="dismiss-banner" data-banner="storage" aria-label="Fermer">${icon("i-x")}</button></div>`);
  }
  if (state.installPromptAvailable && !state.dismissedBanners.install) {
    banners.push(`<div class="notice install-note"><span>Installer CHART comme application sur cet appareil.</span><div class="notice-actions"><button class="btn primary" data-action="install-pwa">Installer</button><button class="btn ghost" data-action="dismiss-banner" data-banner="install">Non merci</button></div></div>`);
  }
  return banners.join("");
}

function scheduleBannerAutoDismiss() {
  clearTimeout(bannerTimers.offline);
  clearTimeout(bannerTimers.storage);
  if (!state.online && !state.dismissedBanners.offline) {
    bannerTimers.offline = setTimeout(() => dismissBanner("offline"), 15000);
  }
  if (state.persistentStorage === false && !state.dismissedBanners.storage) {
    bannerTimers.storage = setTimeout(() => dismissBanner("storage"), 15000);
  }
}

function navMarkup(className) {
  const items = [
    ["incidents", "i-alert", "Incidents"],
    ["timeline", "i-clock", "Timeline"],
    ["projects", "i-folder", "Projets"],
    ["export", "i-export", "Export"]
  ];
  return `<nav class="${className}" aria-label="Navigation principale">
    ${items.map(([route, iconId, label]) => `<button class="nav-button ${state.route === route ? "active" : ""}" data-route="${route}">${icon(iconId)}<span>${label}</span></button>`).join("")}
  </nav>`;
}

function routeMarkup() {
  if (state.route === "timeline") return timelinePage();
  if (state.route === "projects") return projectsPage();
  if (state.route === "export") return exportPage();
  return incidentsPage();
}

function incidentsPage() {
  const incidents = filteredIncidents();
  const selected = state.incidents.find((incident) => incident.id === state.selectedIncidentId) || incidents[0];
  return `<div class="workspace workspace-incidents">
    <section class="panel incident-sidebar">
      <div class="panel-pad incident-sidebar-shell">
        ${incidentToolbar()}
        <div class="cards incident-list">
          ${incidents.length ? incidents.map((incident) => incidentCard(incident, selected?.id)).join("") : empty("Aucun incident ne correspond aux filtres.")}
        </div>
      </div>
    </section>
    <section class="panel incident-detail-panel">${selected ? incidentDetail(selected) : `<div class="detail-empty">Créez un premier incident pour commencer.</div>`}</section>
  </div>`;
}

function incidentToolbar() {
  return `<div class="toolbar incident-toolbar">
    <div class="search-box">${icon("i-search")}<input class="input" data-input="search" value="${escapeHtml(state.search)}" placeholder="Rechercher titre, déclarant, owner, résumé"></div>
    <div class="filter-row">
      ${selectFilter("projectId", "Projet", "Tous", state.projects.map((project) => [project.id, project.name]))}
      ${selectFilter("severity", "Gravité", "Toutes", DEFAULT_SEVERITIES.map((item) => [item, item]))}
      ${selectFilter("status", "Statut", "Tous", DEFAULT_STATUSES.map((item) => [item, labelStatus(item)]))}
      ${selectFilter("type", "Type", "Tous", DEFAULT_TYPES.map((item) => [item, item]))}
    </div>
  </div>`;
}

function incidentCard(incident, selectedId) {
  const project = projectById(incident.projectId);
  const owner = contactById(incident.ownerContactId);
  return `<button class="incident-card ${selectedId === incident.id ? "active" : ""}" data-select-incident="${incident.id}">
    <div class="card-top">
      <div>
        <div class="card-title">${escapeHtml(incident.title)}</div>
        <div class="card-meta">${escapeHtml(project?.name || "Projet")} · ${escapeHtml(owner?.fullName || "Pilote non renseigné")}</div>
      </div>
      <span class="badge ${severityClass(incident.severity)}">${escapeHtml(incident.severity)}</span>
    </div>
    <div class="badges">
      <span class="badge ${statusClass(incident.status)}">${escapeHtml(labelStatus(incident.status))}</span>
      <span class="badge">${formatDuration(incident.declaredAt, incident.closedAt || undefined)}</span>
    </div>
    <div class="card-meta">Déclaré ${formatDate(incident.declaredAt)} · prochain point ${formatDate(incident.nextCheckpointAt)}</div>
    <div class="line-clamp">${escapeHtml(incident.currentSummary || incident.businessImpact)}</div>
  </button>`;
}

function incidentDetail(incident) {
  const project = projectById(incident.projectId);
  const owner = contactById(incident.ownerContactId);
  const events = state.events.filter((event) => event.incidentId === incident.id);
  const checkpoints = state.checkpoints.filter((checkpoint) => checkpoint.incidentId === incident.id);
  const timelineEntries = incidentTimelineEntries(incident, events, checkpoints);
  const closure = state.closures.find((item) => item.id === incident.closureId);
  const attachments = incidentLevelAttachments(incident);
  const frozenPoints = checkpoints.filter((item) => item.status === "frozen");
  const draftPoints = checkpoints.filter((item) => item.status === "draft");
  const isClosed = incident.status === "clos";

  return `
    <div class="incident-detail-shell" style="--timeline-accent:${severityColor(incident.severity)}">
      <div class="detail-header incident-detail-header">
        <h1 class="detail-title">${escapeHtml(incident.title)}</h1>
        <div class="badges">
          <span class="badge">${escapeHtml(project?.name || "")}</span>
          <span class="badge ${severityClass(incident.severity)}">${escapeHtml(incident.severity)}</span>
          <span class="badge ${statusClass(incident.status)}">${escapeHtml(labelStatus(incident.status))}</span>
          <span class="badge">${escapeHtml(owner?.fullName || "Pilote non renseigné")}</span>
        </div>
        <div class="detail-actions">
          <button class="btn" data-action="event" data-incident="${incident.id}" ${isClosed ? "disabled" : ""}>Ajouter événement</button>
          <button class="btn" data-action="checkpoint" data-incident="${incident.id}" ${isClosed ? "disabled" : ""}>Préparer point</button>
          <button class="btn" data-action="notify" data-incident="${incident.id}" ${isClosed ? "disabled" : ""}>Marquer avertis</button>
          <label class="btn ${isClosed ? "disabled-label" : ""}"><input type="file" hidden multiple data-file-attachments="${incident.id}" ${isClosed ? "disabled" : ""}>Ajouter fichier</label>
          ${isClosed ? `<button class="btn primary" data-action="reopen" data-incident="${incident.id}">Réouvrir</button>` : `<button class="btn success" data-action="close" data-incident="${incident.id}">Clôturer</button>`}
          <button class="btn" data-action="show-report" data-incident="${incident.id}">Voir rapport</button>
        </div>
      </div>
      <div class="incident-detail-top panel-pad">
        <section class="kpis">
          <div class="kpi"><span class="kpi-value">${formatDuration(incident.declaredAt, incident.closedAt || undefined)}</span><span class="kpi-label">Durée</span></div>
          <div class="kpi"><span class="kpi-value">${formatDate(incident.nextCheckpointAt)}</span><span class="kpi-label">Prochain point</span></div>
          <div class="kpi"><span class="kpi-value">${timelineEntries.length}</span><span class="kpi-label">Entrées timeline</span></div>
          <div class="kpi"><span class="kpi-value">${frozenPoints.length}</span><span class="kpi-label">Points figés</span></div>
        </section>
        <section>
          <h2 class="panel-title">Résumé actuel</h2>
          <p>${escapeHtml(incident.currentSummary)}</p>
          <p class="muted">${escapeHtml(incident.businessImpact)}</p>
          ${closure ? `<p class="muted">Clos le ${formatDate(closure.closedAt)}</p>` : ""}
        </section>
      </div>
      <section class="incident-timeline-region panel-pad">
        <div class="card-top compact-heading"><h2 class="panel-title">Timeline :</h2><span class="card-meta">${timelineEntries.length} entrée(s)</span></div>
        <div class="timeline incident-timeline-scroll">${timelineEntries.map(timelineEntryItem).join("") || empty("Aucun événement.")}</div>
      </section>
      <div class="incident-bottom-grid panel-pad">
        <section class="incident-subpanel">
          <div class="card-top compact-heading"><h2 class="panel-title">Points intermédiaires :</h2><span class="card-meta">${draftPoints.length} brouillon(s)</span></div>
          <div class="cards incident-subpanel-scroll">
            ${draftPoints.length ? draftPoints.map((checkpoint) => checkpointCard(incident, checkpoint)).join("") : empty("Aucun brouillon.")}
          </div>
        </section>
        <section class="incident-subpanel">
          <div class="card-top compact-heading"><h2 class="panel-title">Pièces jointes :</h2><span class="card-meta">${attachments.length} fichier(s)</span></div>
          <div class="cards incident-subpanel-scroll">
            ${attachments.length ? attachments.map(attachmentCard).join("") : empty("Aucune pièce jointe.")}
          </div>
        </section>
      </div>
    </div>`;
}

function timelineEntryItem(entry) {
  if (entry.type === "checkpoint") return checkpointTimelineItem(entry.checkpoint);
  return timelineItem(entry.event);
}

function timelineItem(event) {
  const attachments = state.attachments.filter((attachment) => attachment.ownerId === event.id);
  const incident = state.incidents.find((item) => item.id === event.incidentId);
  const canEdit = incident?.status !== "clos" && ["update", "notification", "attachment"].includes(event.kind);
  return `<article class="timeline-item">
    <div class="card-top">
      <strong>${escapeHtml(kindLabel(event.kind))}</strong>
      <div class="timeline-meta-actions">
        <span class="card-meta">${formatDate(event.createdAt)}</span>
        ${canEdit ? `<button class="inline-edit inline-edit-top" data-action="event-edit" data-incident="${event.incidentId}" data-event="${event.id}" title="Modifier le jalon">✎</button>` : ""}
      </div>
    </div>
    <div>${escapeHtml(event.message)}</div>
    <div class="card-meta">${escapeHtml(event.author || "CHART")}${event.modifiedAt ? ` · <em>modifié le ${formatDate(event.modifiedAt)} par ${escapeHtml(event.modifiedBy || event.author || "CHART")}</em>` : ""}</div>
    ${attachments.length ? `<div class="context-attachments">${attachments.map(contextAttachmentChip).join("")}</div>` : ""}
  </article>`;
}

function checkpointTimelineItem(checkpoint) {
  const attachments = state.attachments.filter((attachment) => attachment.ownerId === checkpoint.id);
  const incident = state.incidents.find((item) => item.id === checkpoint.incidentId);
  const canEdit = incident?.status !== "clos";
  return `<article class="timeline-item checkpoint-timeline-item">
    <div class="card-top">
      <strong>Point figé</strong>
      <div class="timeline-meta-actions">
        <span class="card-meta">${formatDate(checkpoint.heldAt || checkpoint.scheduledAt)}</span>
        ${canEdit ? `<button class="inline-edit inline-edit-top" data-action="checkpoint-edit" data-incident="${checkpoint.incidentId}" data-checkpoint="${checkpoint.id}" title="Modifier le point">✎</button>` : ""}
      </div>
    </div>
    <div>${escapeHtml(checkpoint.situationSummary || "Point sans synthèse")}</div>
    <div class="card-meta">${escapeHtml(checkpoint.mode || "Point")}${checkpoint.author ? ` · ${escapeHtml(checkpoint.author)}` : ""}${checkpoint.modifiedAt ? ` · <em>modifié le ${formatDate(checkpoint.modifiedAt)} par ${escapeHtml(checkpoint.modifiedBy || checkpoint.author || "CHART")}</em>` : ""}</div>
    ${attachments.length ? `<div class="context-attachments">${attachments.map(contextAttachmentChip).join("")}</div>` : ""}
  </article>`;
}

function checkpointCard(incident, checkpoint) {
  const checkpointAttachments = state.attachments.filter((attachment) => attachment.ownerId === checkpoint.id);
  return `<article class="incident-card">
    <div class="card-top">
      <strong>${checkpoint.status === "frozen" ? "Point figé" : "Brouillon"}</strong>
      <span class="badge">${formatDate(checkpoint.heldAt || checkpoint.scheduledAt)}</span>
    </div>
    <div>${escapeHtml(checkpoint.situationSummary || "Point sans synthèse")}</div>
    <div class="card-meta">Reste à faire: ${escapeHtml(checkpoint.remainingActions || "Non renseigné")}</div>
    ${checkpointAttachments.length ? `<div class="context-attachments">${checkpointAttachments.map(contextAttachmentChip).join("")}</div>` : `<div class="card-meta">Sans fichier</div>`}
    ${incident.status !== "clos" ? `<div class="detail-actions">
      <button class="btn" data-action="checkpoint-edit" data-incident="${incident.id}" data-checkpoint="${checkpoint.id}">Modifier</button>
    </div>` : ""}
  </article>`;
}

function attachmentCard(attachment) {
  return `<article class="incident-card">
    ${attachmentPreview(attachment)}
    <div class="card-top">
      <strong>${escapeHtml(attachment.filename)}</strong>
      <span class="card-meta">${Math.round(attachment.size / 1024)} Ko</span>
    </div>
    <div class="card-meta">${attachmentScopeLabel(attachment.scope)} · ${formatDate(attachment.createdAt)}</div>
    <div class="detail-actions">
      <button class="btn" data-action="download-attachment" data-attachment="${attachment.id}">Télécharger</button>
      <button class="btn danger" data-action="delete-attachment" data-attachment="${attachment.id}">Supprimer</button>
    </div>
  </article>`;
}

function timelinePage() {
  const filters = state.filters;
  const stats = timelineStats(state.incidents, state.checkpoints, filters);
  const max = Math.max(...stats.bySeverity.map((item) => item.count), 1);
  return `<div class="page-grid">
    <section class="panel panel-pad">
      <div class="toolbar">
        <div class="filter-row">
          ${selectFilter("projectId", "Projet", "Tous les projets", state.projects.map((project) => [project.id, project.name]))}
          <input class="input" type="datetime-local" step="60" data-filter="from" value="${escapeHtml(filters.from)}">
          <input class="input" type="datetime-local" step="60" data-filter="to" value="${escapeHtml(filters.to)}">
          ${selectFilter("severity", "Gravité", "Toutes les gravités", DEFAULT_SEVERITIES.map((item) => [item, item]))}
          ${selectFilter("status", "Statut", "Tous les statuts", DEFAULT_STATUSES.map((item) => [item, labelStatus(item)]))}
        </div>
      </div>
      <div class="kpis">
        <div class="kpi"><span class="kpi-value">${stats.total}</span><span class="kpi-label">Incidents</span></div>
        <div class="kpi"><span class="kpi-value">${stats.open}</span><span class="kpi-label">Ouverts</span></div>
        <div class="kpi"><span class="kpi-value">${msToReadable(stats.averageDuration)}</span><span class="kpi-label">Durée moyenne</span></div>
        <div class="kpi"><span class="kpi-value">${msToReadable(stats.averageFirstCheckpoint)}</span><span class="kpi-label">Premier point moyen</span></div>
      </div>
    </section>
    <section class="panel panel-pad">
      <h2 class="panel-title">Répartition par gravité</h2>
      <div class="timeline-bars">${stats.bySeverity.map((item) => `<div class="bar-row"><div class="card-meta">${item.severity} · ${item.count}</div><div class="bar-track"><div class="bar-fill" style="width:${Math.max(4, item.count / max * 100)}%"></div></div></div>`).join("")}</div>
    </section>
    <section class="panel panel-pad">
      <h2 class="panel-title">Frise chronologique</h2>
      <div class="timeline">${stats.incidents.map((incident) => `<button class="timeline-item" data-select-route-incident="${incident.id}">
        <div class="card-top"><strong>${escapeHtml(incident.title)}</strong><span class="badge ${severityClass(incident.severity)}">${escapeHtml(incident.severity)}</span></div>
        <div>${formatDate(incident.declaredAt)} · ${formatDuration(incident.declaredAt, incident.closedAt || undefined)} · ${escapeHtml(labelStatus(incident.status))}</div>
        <div class="card-meta">${escapeHtml(incident.currentSummary)}</div>
      </button>`).join("") || empty("Aucun incident sur cette période.")}</div>
    </section>
  </div>`;
}

function projectsPage() {
  const selected = state.projects.find((project) => project.id === state.selectedProjectId) || state.projects[0];
  const contacts = contactsForProject(selected?.id, false);
  return `<div class="split">
    <section class="panel">
      <div class="panel-header"><div><h1 class="panel-title">Projets</h1><div class="panel-subtitle">${state.projects.length} configuration(s)</div></div><button class="btn primary" data-action="project">${icon("i-plus")}Projet</button></div>
      <div class="panel-pad cards">${state.projects.map((project) => `<button class="project-card ${project.id === selected?.id ? "active" : ""}" data-select-project="${project.id}">
        <strong>${escapeHtml(project.name)}</strong><span class="card-meta">${escapeHtml(project.environment)} · ${project.incidentTypes.length} types · ${contactsForProject(project.id).length} contacts actifs</span>
      </button>`).join("")}</div>
    </section>
    <section class="panel">${selected ? `
      <div class="panel-header"><div><h2 class="panel-title">${escapeHtml(selected.name)}</h2><div class="panel-subtitle">${escapeHtml(selected.description || "Configuration projet")}</div></div><button class="btn" data-action="project" data-project="${selected.id}">Modifier</button></div>
      <div class="panel-pad page-grid">
        <section><h3 class="panel-title">Référentiels</h3><p class="muted">Types: ${selected.incidentTypes.join(", ")}</p><p class="muted">Gravités: ${selected.severityLevels.join(", ")}</p><p class="muted">Statuts: ${selected.statusOptions.map(labelStatus).join(", ")}</p></section>
        <section><div class="card-top contacts-head"><h3 class="panel-title">Contacts</h3><button class="btn" data-action="contact" data-project="${selected.id}">${icon("i-plus")}Contact</button></div><div class="cards">${contacts.filter((contact) => contact.isActive !== false).map(contactCard).join("") || empty("Aucun contact projet.")}</div></section>
      </div>` : `<div class="detail-empty">Créez un premier projet pour commencer.</div>`}</section>
  </div>`;
}

function contactCard(contact) {
  return `<article class="incident-card">
    <div class="card-top"><strong>${escapeHtml(contact.fullName)}</strong><span class="badge">${escapeHtml(contact.isDefaultAuthor ? "auteur par défaut" : (contact.group || "groupe"))}</span></div>
    <div class="card-meta">${escapeHtml(contact.roleLabel)} · ${escapeHtml(contact.organization)}</div>
    <div class="card-meta">${escapeHtml(contact.email)} ${escapeHtml(contact.phone)}</div>
    <div class="detail-actions">
      <button class="btn" data-action="contact-edit" data-contact="${contact.id}">Éditer</button>
      <button class="btn danger" data-action="contact-delete" data-contact="${contact.id}">Supprimer</button>
    </div>
  </article>`;
}

function exportPage() {
  const quota = state.quota?.quota ? `${Math.round((state.quota.usage || 0) / 1024 / 1024)} Mo utilisés sur ${Math.round(state.quota.quota / 1024 / 1024)} Mo` : "Quota non disponible";
  return `<div class="page-grid">
    <section class="panel panel-pad">
      <h1 class="panel-title">Export / Import</h1>
      <p class="muted">Export JSON complet des projets, référentiels, incidents, timeline, points, clôtures, rapports et pièces jointes locales.</p>
      <div class="kpis">
        <div class="kpi"><span class="kpi-value">${state.projects.length}</span><span class="kpi-label">Projets</span></div>
        <div class="kpi"><span class="kpi-value">${state.incidents.length}</span><span class="kpi-label">Incidents</span></div>
        <div class="kpi"><span class="kpi-value">${state.events.length}</span><span class="kpi-label">Événements</span></div>
        <div class="kpi"><span class="kpi-value">${state.attachments.length}</span><span class="kpi-label">Pièces jointes</span></div>
      </div>
      <p class="muted">Dernier export: ${lastExportAt() ? formatDate(lastExportAt()) : "jamais"} · ${quota}</p>
      <div class="detail-actions"><button class="btn primary" data-action="export-json">Exporter JSON</button><label class="btn danger"><input type="file" hidden accept="application/json" data-import-json>Importer et remplacer</label><button class="btn" data-action="reset-workspace">Réinitialiser</button></div>
    </section>
    <section class="panel panel-pad">
      <h2 class="panel-title">Avertissement import</h2>
      <p>L'import écrase toutes les données locales CHART. Une double confirmation sera demandée avant purge d'IndexedDB et remplacement complet.</p>
    </section>
  </div>`;
}

function bindEvents(root) {
  root.querySelectorAll("[data-route]").forEach((button) => button.addEventListener("click", () => setRoute(button.dataset.route)));
  root.querySelectorAll("[data-select-incident]").forEach((button) => button.addEventListener("click", () => selectIncident(button.dataset.selectIncident)));
  root.querySelectorAll("[data-select-route-incident]").forEach((button) => button.addEventListener("click", () => {
    selectIncident(button.dataset.selectRouteIncident);
    setRoute("incidents");
  }));
  root.querySelectorAll("[data-select-project]").forEach((button) => button.addEventListener("click", () => selectProject(button.dataset.selectProject)));
  root.querySelectorAll("[data-filter]").forEach((input) => input.addEventListener("input", () => {
    setFilter(input.dataset.filter, input.value === "__all" ? "" : input.value);
  }));
  root.querySelector("[data-input='search']")?.addEventListener("input", (event) => setSearch(event.target.value));
  root.querySelectorAll("[data-action]").forEach((button) => button.addEventListener("click", () => handleAction(button)));
  root.querySelectorAll("[data-file-attachments]").forEach((input) => input.addEventListener("change", async () => {
    if (!input.files?.length) return;
    await addAttachments("incident", input.dataset.fileAttachments, [...input.files]);
    input.value = "";
    showToast("Fichier ajouté.");
  }));
  root.querySelector("[data-import-json]")?.addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    if (!confirm("L'import va remplacer toutes les données locales CHART. Continuer ?")) return;
    if (!confirm("Confirmation finale: purger IndexedDB et importer ce fichier ?")) return;
    await replaceFromImport(file);
    showToast("Import terminé. Les données locales ont été remplacées.");
  });
}

function handleAction(button) {
  const action = button.dataset.action;
  if (action === "theme") return setTheme(state.theme === "dark" ? "light" : "dark");
  if (action === "new-incident") return openIncidentModal();
  if (action === "event") return openEventModal(button.dataset.incident);
  if (action === "event-edit") return openEventModal(button.dataset.incident, button.dataset.event);
  if (action === "checkpoint") return openCheckpointModal(button.dataset.incident);
  if (action === "checkpoint-edit") return openCheckpointModal(button.dataset.incident, button.dataset.checkpoint);
  if (action === "notify") return openNotifyModal(button.dataset.incident);
  if (action === "close") return openClosureModal(button.dataset.incident);
  if (action === "reopen") return openReopenModal(button.dataset.incident);
  if (action === "project") return openProjectModal(button.dataset.project);
  if (action === "contact") return openContactModal(button.dataset.project);
  if (action === "contact-edit") return openContactModal(contactById(button.dataset.contact)?.projectId, button.dataset.contact);
  if (action === "contact-delete" && confirm("Supprimer ce contact de la liste active ?")) return deleteContact(button.dataset.contact).then(() => showToast("Contact supprimé."));
  if (action === "export-json") return downloadExport().then(() => showToast("Export JSON généré."));
  if (action === "reset-workspace" && confirm("Réinitialiser complètement CHART et effacer toutes les données locales ?")) return resetWorkspace().then(() => showToast("Base locale réinitialisée."));
  if (action === "show-report") return openReportModal(button.dataset.incident);
  if (action === "dismiss-banner") return dismissBanner(button.dataset.banner);
  if (action === "install-pwa") return window.dispatchEvent(new CustomEvent("chart-install-request"));
  if (action === "download-attachment") return downloadAttachment(button.dataset.attachment);
  if (action === "delete-attachment" && confirm("Supprimer cette pièce jointe ?")) return deleteAttachment(button.dataset.attachment).then(() => showToast("Pièce jointe supprimée."));
}

function openIncidentModal() {
  const project = state.projects.find((item) => item.id === state.selectedProjectId) || state.projects[0];
  openModal("Nouvel incident", incidentForm(project), async (form, modal) => {
    await createIncident(values(form), [...form.querySelector("[name='attachments']").files]);
    closeModal(modal);
    showToast("Incident créé.");
  });
}

function incidentForm(project) {
  const people = knownProjectPeople(project?.id);
  return `<form class="form-grid">
    ${field("projectId", "Projet", selectOptions(state.projects.map((item) => [item.id, item.name]), project?.id), "select")}
    ${field("title", "Titre", "", "text", true)}
    ${autocompleteField("declaredBy", "Déclarant", defaultAuthorNameForProject(project?.id), people, true)}
    ${field("declaredAt", "Date / heure", localDateValue(new Date()), "datetime-local", true)}
    ${field("type", "Type", selectOptions((project?.incidentTypes || DEFAULT_TYPES).map((item) => [item, item])), "select")}
    ${field("severity", "Gravité", selectOptions((project?.severityLevels || DEFAULT_SEVERITIES).map((item) => [item, item])), "select")}
    ${field("ownerContactId", "Pilote", selectOptions(contactsForProject(project?.id).map((item) => [item.id, item.fullName])), "select")}
    ${field("status", "Statut", selectOptions((project?.statusOptions || DEFAULT_STATUSES).map((item) => [item, labelStatus(item)]), "en_cours"), "select")}
    ${field("businessImpact", "Impact métier", "", "textarea", true, "wide")}
    <details class="form-section wide">
      <summary class="section-label">Champs secondaires</summary>
      <div class="form-grid">
        ${field("location", "Lieu / environnement")}
        ${field("technicalImpact", "Impact technique", "", "textarea", false, "wide")}
        ${field("nextCheckpointAt", "Prochain point", "", "datetime-local")}
        ${field("currentSummary", "Résumé actuel", "", "textarea", false, "wide")}
        <div class="field wide"><label>Personnes averties</label>${checks("notifiedContacts", contactsForProject(project?.id).map((item) => [item.id, item.fullName]))}</div>
        <div class="field wide"><label>Pièces jointes</label><input class="input" type="file" name="attachments" multiple></div>
      </div>
    </details>
  </form>`;
}

function openEventModal(incidentId, eventId = "") {
  const incident = state.incidents.find((item) => item.id === incidentId);
  const event = eventId ? state.events.find((item) => item.id === eventId) : null;
  const people = knownProjectPeople(incident?.projectId);
  openModal(event ? "Modifier le jalon" : "Ajouter un événement", `<form class="form-grid">
    <input type="hidden" name="id" value="${event?.id || ""}">
    <input type="hidden" name="incidentId" value="${incidentId}">
    ${autocompleteField("author", "Auteur", event?.author || defaultAuthorNameForProject(incident?.projectId) || incident?.declaredBy || "CHART", people, true)}
    ${field("kind", "Type", selectOptions([["update", "Mise à jour"], ["notification", "Notification"], ["attachment", "Pièce jointe"]], event?.kind || "update"), "select")}
    ${field("createdAt", "Date / heure", localDateValue(event?.createdAt || new Date()), "datetime-local")}
    ${field("message", "Message", event?.message || "", "textarea", true, "wide")}
    <div class="field wide"><label>Pièces jointes</label><input class="input" type="file" name="attachments" multiple></div>
  </form>`, async (form, modal) => {
    await saveEvent(values(form), [...form.querySelector("[name='attachments']").files]);
    closeModal(modal);
    showToast(event ? "Jalon modifié." : "Événement ajouté.");
  });
}

function openCheckpointModal(incidentId, checkpointId = "") {
  const incident = state.incidents.find((item) => item.id === incidentId);
  const checkpoint = checkpointId ? state.checkpoints.find((item) => item.id === checkpointId) : null;
  const contacts = contactsForProject(incident?.projectId);
  const suggestions = knownProjectPeople(incident?.projectId);
  const isFrozen = checkpoint?.status === "frozen";
  openModal(checkpoint ? "Modifier le point" : "Point intermédiaire", `<form class="form-grid">
    <input type="hidden" name="id" value="${checkpoint?.id || ""}">
    <input type="hidden" name="incidentId" value="${incidentId}">
    ${field("scheduledAt", "Date prévue", localDateValue(checkpoint?.scheduledAt || new Date()), "datetime-local")}
    ${field("heldAt", "Date tenue", localDateValue(checkpoint?.heldAt || ""), "datetime-local")}
    ${field("mode", "Modalité", selectOptions([["visio", "Visio"], ["téléphone", "Téléphone"], ["présentiel", "Présentiel"]], checkpoint?.mode || "visio"), "select")}
    ${autocompleteField("author", "Auteur", checkpoint?.author || defaultAuthorNameForProject(incident?.projectId) || incident?.declaredBy || "CHART", suggestions, true, "wide")}
    <div class="field wide">
      <label>Invités projet</label>
      ${checks("invitedContactIds", contacts.map((item) => [item.id, item.fullName]), checkpoint?.invitedContactIds || [])}
      ${tokenField("invitedExternal", "Autres invités", checkpoint?.invitedExternal || [], suggestions)}
    </div>
    <div class="field wide">
      <label>Présents projet</label>
      ${checks("presentContactIds", contacts.map((item) => [item.id, item.fullName]), checkpoint?.presentContactIds || [])}
      ${tokenField("presentExternal", "Autres présents", checkpoint?.presentExternal || [], suggestions)}
    </div>
    ${field("situationSummary", "Situation", checkpoint?.situationSummary || "", "textarea", true, "wide")}
    ${field("doneSinceLastCheckpoint", "Fait depuis le dernier point", checkpoint?.doneSinceLastCheckpoint || "", "textarea", false, "wide")}
    ${field("remainingActions", "Reste à faire", checkpoint?.remainingActions || "", "textarea", false, "wide")}
    ${field("blockersRisks", "Blocages / risques", checkpoint?.blockersRisks || "", "textarea", false, "wide")}
    ${field("decisionsTaken", "Décisions prises", rowsToText(checkpoint?.decisionsTaken, "text"), "textarea", false, "wide")}
    ${field("decisionsToTake", "Décisions à prendre", rowsToText(checkpoint?.decisionsToTake, "text"), "textarea", false, "wide")}
    ${field("actions", "Actions", rowsToText(checkpoint?.actions, "label"), "textarea", false, "wide")}
    ${field("nextCheckpointAt", "Prochain point", localDateValue(checkpoint?.nextCheckpointAt || ""), "datetime-local")}
    <div class="field wide"><label>Personnes averties</label>${checks("notifiedContacts", contacts.map((item) => [item.id, item.fullName]), checkpoint?.notifiedContacts || [])}</div>
    <div class="field wide"><label>Fichiers du point</label><input class="input" type="file" name="attachments" multiple></div>
  </form>`, async (form, modal, submitter) => {
    await saveCheckpoint(values(form), submitter?.dataset.freeze === "true", [...form.querySelector("[name='attachments']").files]);
    closeModal(modal);
    showToast(submitter?.dataset.freeze === "true" ? "Le point a été figé et ajouté à la timeline." : "Brouillon enregistré.");
  }, isFrozen
    ? [{ label: "Enregistrer", variant: "primary", attrs: "data-freeze='true'" }]
    : [{ label: "Enregistrer brouillon", variant: "", attrs: "data-freeze='false'" }, { label: "Figer le point", variant: "primary", attrs: "data-freeze='true'" }]
  );
}

function openNotifyModal(incidentId) {
  const incident = state.incidents.find((item) => item.id === incidentId);
  const contacts = contactsForProject(incident?.projectId);
  const people = knownProjectPeople(incident?.projectId);
  openModal("Marquer avertis", `<form class="form-grid">
    <input type="hidden" name="incidentId" value="${incidentId}">
    <input type="hidden" name="kind" value="notification">
    ${autocompleteField("author", "Auteur", defaultAuthorNameForProject(incident?.projectId) || incident?.declaredBy || "CHART", people, true)}
    <div class="field wide"><label>Personnes averties</label>${checks("contacts", contacts.map((item) => [item.id, item.fullName]))}</div>
    ${field("message", "Message", "Parties prenantes averties.", "textarea", true, "wide")}
  </form>`, async (form, modal) => {
    const data = values(form);
    await addEvent({ ...data, message: `${data.message} ${toContactNames(data.contacts).join(", ")}`.trim() });
    closeModal(modal);
    showToast("Notification ajoutée à la timeline.");
  });
}

function openClosureModal(incidentId) {
  openModal("Clôture d'incident", `<form class="form-grid">
    <input type="hidden" name="incidentId" value="${incidentId}">
    ${field("closedAt", "Date / heure de fin", localDateValue(new Date()), "datetime-local")}
    ${field("resolutionSummary", "Résolution", "", "textarea", true, "wide")}
    <label class="check-item wide"><input type="checkbox" name="rootCauseKnown"> Cause connue</label>
    ${field("rootCauseSummary", "Cause", "", "textarea", false, "wide")}
    ${field("correctiveActions", "Actions correctives", "", "textarea", false, "wide")}
    <label class="check-item wide"><input type="checkbox" name="postIncidentReviewRequired"> Revue post-incident requise</label>
    ${field("finalSummary", "Synthèse finale", "", "textarea", false, "wide")}
  </form>`, async (form, modal) => {
    await closeIncident(values(form));
    closeModal(modal);
    showToast("Incident clos et rapport généré.");
  });
}

function openReopenModal(incidentId) {
  const incident = state.incidents.find((item) => item.id === incidentId);
  openModal("Réouvrir l'incident", `<form class="form-grid">
    <input type="hidden" name="incidentId" value="${incidentId}">
    ${autocompleteField("author", "Auteur", defaultAuthorNameForProject(incident?.projectId) || incident?.declaredBy || "CHART", knownProjectPeople(incident?.projectId), true)}
    ${field("reason", "Motif de réouverture", "", "textarea", true, "wide")}
  </form>`, async (form, modal) => {
    await reopenIncident(values(form));
    closeModal(modal);
    showToast("Incident réouvert.");
  });
}

function openProjectModal(projectId) {
  const project = state.projects.find((item) => item.id === projectId);
  openModal(project ? "Modifier projet" : "Nouveau projet", `<form class="form-grid">
    <input type="hidden" name="id" value="${project?.id || ""}">
    ${field("name", "Nom", project?.name || "", "text", true)}
    ${field("slug", "Slug", project?.slug || "")}
    ${field("environment", "Environnement", project?.environment || "production")}
    ${field("description", "Description", project?.description || "", "textarea", false, "wide")}
    ${field("incidentTypes", "Types", (project?.incidentTypes || DEFAULT_TYPES).join(", "), "textarea", false, "wide")}
    ${field("severityLevels", "Gravités", (project?.severityLevels || DEFAULT_SEVERITIES).join(", "), "textarea", false, "wide")}
    ${field("statusOptions", "Statuts", (project?.statusOptions || DEFAULT_STATUSES).join(", "), "textarea", false, "wide")}
    ${field("defaultStakeholderGroups", "Groupes", (project?.defaultStakeholderGroups || DEFAULT_GROUPS).join(", "), "textarea", false, "wide")}
    ${colorField(project?.color || "#2b85e4")}
  </form>`, async (form, modal) => {
    await saveProject(values(form));
    closeModal(modal);
    showToast("Projet enregistré.");
  });
}

function openContactModal(projectId, contactId = "") {
  const contact = contactId ? contactById(contactId) : null;
  const people = knownProjectPeople(projectId);
  openModal(contact ? "Modifier contact" : "Nouveau contact", `<form class="form-grid">
    <input type="hidden" name="id" value="${contact?.id || ""}">
    <input type="hidden" name="projectId" value="${projectId}">
    ${autocompleteField("fullName", "Nom complet", contact?.fullName || "", people, true)}
    ${field("roleLabel", "Rôle", contact?.roleLabel || "")}
    ${field("group", "Groupe", contact?.group || "")}
    ${field("organization", "Organisation", contact?.organization || "")}
    ${field("email", "Email", contact?.email || "", "email")}
    ${field("phone", "Téléphone", contact?.phone || "")}
    <label class="check-item"><input type="checkbox" name="isFavorite" ${contact?.isFavorite ? "checked" : ""}> Favori</label>
    <label class="check-item"><input type="checkbox" name="isDefaultAuthor" ${contact?.isDefaultAuthor ? "checked" : ""}> Auteur par défaut</label>
    <label class="check-item"><input type="checkbox" name="isActive" ${contact?.isActive !== false ? "checked" : ""}> Actif</label>
    ${field("notes", "Notes", contact?.notes || "", "textarea", false, "wide")}
  </form>`, async (form, modal) => {
    await saveContact(values(form));
    closeModal(modal);
    showToast(contact ? "Contact mis à jour." : "Contact ajouté.");
  });
}

async function openReportModal(incidentId) {
  const report = await ensureIncidentReport(incidentId);
  openModal(report?.title || "Rapport", `<div class="report-preview">${report?.html || ""}</div>`, null, [
    { label: "Imprimer", variant: "primary", attrs: `data-report-print="${report?.id || ""}"` }
  ], "modal-report");
}

function openModal(title, content, onSubmit, buttons, extraClass = "") {
  const modal = document.createElement("div");
  modal.className = "modal-backdrop";
  modal.innerHTML = `<div class="modal ${extraClass}" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}">
    <div class="panel-header"><h2 class="panel-title">${escapeHtml(title)}</h2><button class="btn icon" data-close>${icon("i-x")}</button></div>
    <div class="panel-pad">${content}</div>
    <div class="modal-actions">
      <button class="btn" data-close>Annuler</button>
      ${(buttons || [{ label: "Enregistrer", variant: "primary", attrs: "" }]).map((button) => `<button class="btn ${button.variant}" type="submit" ${button.attrs || ""}>${button.label}</button>`).join("")}
    </div>
  </div>`;
  document.body.appendChild(modal);
  modal.querySelectorAll("[data-close]").forEach((button) => button.addEventListener("click", () => closeModal(modal)));
  modal.addEventListener("click", (event) => { if (event.target === modal) closeModal(modal); });
  activateAutocompleteFields(modal);
  activateTokenFields(modal);
  activateColorFields(modal);
  modal.querySelectorAll("[type='submit']").forEach((button) => button.addEventListener("click", async () => {
    if (button.dataset.reportPrint) return printReport(button.dataset.reportPrint);
    const form = modal.querySelector("form");
    if (form && !form.reportValidity()) return;
    if (onSubmit) await onSubmit(form, modal, button);
    else closeModal(modal);
  }));
}

function closeModal(modal) {
  modal.remove();
}

function filteredIncidents() {
  const query = state.search.trim().toLowerCase();
  return [...state.incidents]
    .filter((incident) => {
      if (state.filters.projectId && incident.projectId !== state.filters.projectId) return false;
      if (state.filters.severity && incident.severity !== state.filters.severity) return false;
      if (state.filters.status && incident.status !== state.filters.status) return false;
      if (state.filters.type && incident.type !== state.filters.type) return false;
      if (!query) return true;
      const owner = contactById(incident.ownerContactId)?.fullName || "";
      const project = projectById(incident.projectId)?.name || "";
      return [incident.title, project, incident.declaredBy, owner, incident.currentSummary, incident.type].join(" ").toLowerCase().includes(query);
    })
    .sort((a, b) => new Date(b.declaredAt) - new Date(a.declaredAt));
}

function incidentTimelineEntries(incident, events, checkpoints) {
  const eventEntries = events
    .filter((event) => event.kind !== "checkpoint_frozen")
    .map((event) => ({
      type: "event",
      event,
      at: event.createdAt
    }));
  const checkpointEntries = checkpoints
    .filter((checkpoint) => checkpoint.status === "frozen")
    .map((checkpoint) => ({
      type: "checkpoint",
      checkpoint,
      at: checkpoint.heldAt || checkpoint.scheduledAt || checkpoint.updatedAt
    }));
  return [...eventEntries, ...checkpointEntries]
    .filter((entry) => entry.at)
    .sort((a, b) => new Date(a.at) - new Date(b.at));
}

function selectFilter(name, placeholder, allLabel, options) {
  const active = Boolean(state.filters[name]);
  return `<div class="select-shell ${active ? "filter-active" : ""}">
    <select class="select" data-filter="${name}">
      <option value="" disabled hidden ${!active ? "selected" : ""}>${escapeHtml(placeholder)}</option>
      <option value="__all">${escapeHtml(allLabel)}</option>
      ${options.map(([value, label]) => `<option value="${escapeHtml(value)}" ${state.filters[name] === value ? "selected" : ""}>${escapeHtml(label)}</option>`).join("")}
    </select>
  </div>`;
}

function autocompleteField(name, label, value = "", suggestions = [], required = false, extraClass = "") {
  return `<div class="field ${extraClass}">
    <label for="${name}">${label}</label>
    <div class="autocomplete-shell" data-autocomplete-values="${escapeHtml(JSON.stringify(suggestions || []))}">
      <input class="input" id="${name}" name="${name}" type="text" value="${escapeHtml(value)}" ${required ? "required" : ""} autocomplete="off" data-autocomplete-input>
      <div class="autocomplete-menu" data-autocomplete-menu hidden></div>
    </div>
  </div>`;
}

function field(name, label, value = "", type = "text", required = false, extraClass = "") {
  if (type === "textarea") return `<div class="field ${extraClass}"><label for="${name}">${label}</label><textarea class="textarea" id="${name}" name="${name}" ${required ? "required" : ""}>${escapeHtml(value)}</textarea></div>`;
  if (type === "select") return `<div class="field ${extraClass}"><label for="${name}">${label}</label><select class="select" id="${name}" name="${name}" ${required ? "required" : ""}>${value}</select></div>`;
  const step = type === "datetime-local" ? ` step="60"` : "";
  return `<div class="field ${extraClass}"><label for="${name}">${label}</label><input class="input" id="${name}" name="${name}" type="${type}" value="${escapeHtml(value)}" ${required ? "required" : ""}${step}></div>`;
}

function colorField(value) {
  return `<div class="field wide">
    <label>Couleur</label>
    <div class="color-row" data-color-row>
      <input class="input color-input" type="color" name="color" value="${escapeHtml(normalizeColor(value))}">
      <input class="input" type="text" name="colorHex" value="${escapeHtml(normalizeColor(value))}" placeholder="#2b85e4">
    </div>
  </div>`;
}

function tokenField(name, label, values, suggestions) {
  return `<div class="token-field" data-token-field>
    <span class="token-label">${escapeHtml(label)}</span>
    <div class="token-box" data-token-box>
      <div class="token-list" data-token-list></div>
      <div class="autocomplete-shell token-autocomplete-shell" data-autocomplete-values="${escapeHtml(JSON.stringify(suggestions || []))}" data-token-autocomplete="true">
        <input class="token-input" type="text" data-token-input data-autocomplete-input autocomplete="off" placeholder="Ajouter puis Entrée">
        <div class="autocomplete-menu" data-autocomplete-menu hidden></div>
      </div>
    </div>
    <input type="hidden" name="${name}" value="${escapeHtml((values || []).join(", "))}">
  </div>`;
}

function selectOptions(options, selected = "") {
  return options.map(([value, label]) => `<option value="${escapeHtml(value)}" ${selected === value ? "selected" : ""}>${escapeHtml(label)}</option>`).join("");
}

function checks(name, options, selected = []) {
  return `<div class="check-grid">${options.map(([value, label]) => `<label class="check-item"><input type="checkbox" name="${name}" value="${escapeHtml(value)}" ${selected.includes(value) ? "checked" : ""}> ${escapeHtml(label)}</label>`).join("") || `<span class="muted">Aucun contact disponible.</span>`}</div>`;
}

function values(form) {
  const data = {};
  new FormData(form).forEach((value, key) => {
    if (data[key]) data[key] = Array.isArray(data[key]) ? [...data[key], value] : [data[key], value];
    else data[key] = value;
  });
  form.querySelectorAll("input[type='checkbox']").forEach((input) => {
    if (!input.value || input.value === "on") data[input.name] = input.checked;
  });
  return data;
}

function activateTokenFields(container) {
  container.querySelectorAll("[data-token-field]").forEach((fieldNode) => {
    const input = fieldNode.querySelector("[data-token-input]");
    const listNode = fieldNode.querySelector("[data-token-list]");
    const hidden = fieldNode.querySelector("input[type='hidden']");
    const tokens = splitCsv(hidden.value);

    const renderTokens = () => {
      listNode.innerHTML = tokens.map((token) => `<button type="button" class="token-chip" data-token-remove="${escapeHtml(token)}">${escapeHtml(token)}<span>×</span></button>`).join("");
      hidden.value = tokens.join(", ");
      listNode.querySelectorAll("[data-token-remove]").forEach((button) => button.addEventListener("click", () => {
        const value = button.dataset.tokenRemove;
        const index = tokens.indexOf(value);
        if (index >= 0) tokens.splice(index, 1);
        renderTokens();
      }));
    };

    const pushToken = (nextValue = input.value.trim()) => {
      const value = nextValue.trim();
      if (!value || tokens.includes(value)) return;
      tokens.push(value);
      input.value = "";
      renderTokens();
    };

    input.addEventListener("autocomplete-select", (event) => {
      pushToken(event.detail.value);
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === ",") {
        event.preventDefault();
        pushToken();
      }
      if (event.key === "Backspace" && !input.value && tokens.length) {
        tokens.pop();
        renderTokens();
      }
    });
    input.addEventListener("blur", pushToken);
    renderTokens();
  });
}

function activateAutocompleteFields(container) {
  container.querySelectorAll("[data-autocomplete-input]").forEach((input) => {
    const shell = input.closest(".autocomplete-shell");
    const menu = shell?.querySelector("[data-autocomplete-menu]");
    if (!shell || !menu) return;
    const rawValues = JSON.parse(shell.dataset.autocompleteValues || "[]");
    const getPool = () => {
      const used = shell.dataset.tokenAutocomplete === "true"
        ? new Set(splitCsv(shell.closest("[data-token-field]")?.querySelector("input[type='hidden']")?.value))
        : new Set();
      return [...new Set(rawValues)].filter((value) => value && !used.has(value));
    };
    let matches = [];
    let activeIndex = -1;

    const closeMenu = () => {
      menu.hidden = true;
      menu.innerHTML = "";
      matches = [];
      activeIndex = -1;
    };

    const chooseValue = (value) => {
      input.value = value;
      if (shell.dataset.tokenAutocomplete === "true") {
        input.dispatchEvent(new CustomEvent("autocomplete-select", { detail: { value } }));
      }
      closeMenu();
    };

    const renderMenu = () => {
      const query = input.value.trim().toLowerCase();
      matches = getPool()
        .filter((value) => !query || value.toLowerCase().includes(query))
        .slice(0, 7);
      if (!matches.length) return closeMenu();
      menu.hidden = false;
      menu.innerHTML = matches.map((value, index) => `<button type="button" class="autocomplete-option ${index === activeIndex ? "active" : ""}" data-autocomplete-option="${escapeHtml(value)}">${escapeHtml(value)}</button>`).join("");
      menu.querySelectorAll("[data-autocomplete-option]").forEach((button, index) => {
        button.addEventListener("mousedown", (event) => {
          event.preventDefault();
          activeIndex = index;
          chooseValue(button.dataset.autocompleteOption);
        });
      });
    };

    input.addEventListener("focus", renderMenu);
    input.addEventListener("input", () => {
      activeIndex = -1;
      renderMenu();
    });
    input.addEventListener("keydown", (event) => {
      if (!matches.length && !["ArrowDown", "ArrowUp"].includes(event.key)) return;
      if (event.key === "ArrowDown") {
        event.preventDefault();
        activeIndex = Math.min(activeIndex + 1, matches.length - 1);
        renderMenu();
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        activeIndex = Math.max(activeIndex - 1, 0);
        renderMenu();
      }
      if (event.key === "Enter" || event.key === "Tab") {
        if (matches.length === 1 || activeIndex >= 0) {
          event.preventDefault();
          chooseValue(matches[activeIndex >= 0 ? activeIndex : 0]);
        }
      }
      if (event.key === "Escape") closeMenu();
    });
    input.addEventListener("blur", () => setTimeout(closeMenu, 120));
  });
}

function activateColorFields(container) {
  container.querySelectorAll("[data-color-row]").forEach((row) => {
    const colorInput = row.querySelector("input[type='color']");
    const hexInput = row.querySelector("input[name='colorHex']");
    colorInput.addEventListener("input", () => { hexInput.value = colorInput.value; });
    hexInput.addEventListener("input", () => {
      if (/^#[0-9a-fA-F]{6}$/.test(hexInput.value)) colorInput.value = hexInput.value;
    });
  });
}

function localDateValue(dateLike) {
  if (!dateLike) return "";
  const date = dateLike instanceof Date ? dateLike : new Date(dateLike);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function projectById(idValue) {
  return state.projects.find((project) => project.id === idValue);
}

function contactById(idValue) {
  return state.contacts.find((contact) => contact.id === idValue);
}

function contactsForProject(projectId, activeOnly = true) {
  return state.contacts.filter((contact) => contact.projectId === projectId && (!activeOnly || contact.isActive !== false));
}

function toContactNames(values) {
  const ids = Array.isArray(values) ? values : [values].filter(Boolean);
  return ids.map((idValue) => contactById(idValue)?.fullName).filter(Boolean);
}

function kindLabel(kind) {
  return {
    create: "Création",
    update: "Mise à jour",
    notification: "Notification",
    checkpoint_frozen: "Point figé",
    closure: "Clôture",
    attachment: "Pièce jointe",
    reopen: "Réouverture"
  }[kind] || kind;
}

function severityColor(severity) {
  return {
    critique: "var(--danger)",
    majeur: "var(--danger)",
    significatif: "var(--warning)",
    mineur: "var(--info)"
  }[severity] || "var(--primary)";
}

function incidentLevelAttachments(incident) {
  const ownerIds = new Set([incident.id].filter(Boolean));
  return state.attachments
    .filter((attachment) => ownerIds.has(attachment.ownerId))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function contextAttachmentChip(attachment) {
  return `<article class="attachment-chip">
    ${attachmentPreview(attachment, "attachment-preview-small")}
    <div class="attachment-chip-meta">
      <strong>${escapeHtml(attachment.filename)}</strong>
      <span>${Math.round(attachment.size / 1024)} Ko</span>
    </div>
  </article>`;
}

function attachmentScopeLabel(scope) {
  return {
    incident: "Incident",
    event: "Événement",
    checkpoint: "Point",
    closure: "Clôture"
  }[scope] || "Fichier";
}

function attachmentPreview(attachment, className = "attachment-preview") {
  if (!attachment?.mimeType?.startsWith("image/") || !attachment.blob) return "";
  const src = URL.createObjectURL(attachment.blob);
  return `<img class="${className}" src="${src}" alt="${escapeHtml(attachment.filename)}">`;
}

function normalizeColor(value) {
  return /^#[0-9a-fA-F]{6}$/.test(value || "") ? value : "#2b85e4";
}

function splitCsv(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function rowsToText(rows, key) {
  return (rows || []).map((item) => item[key]).filter(Boolean).join("\n");
}

function projectExternalParticipants(projectId) {
  return [...new Set(
    state.checkpoints
      .filter((checkpoint) => checkpoint.projectId === projectId)
      .flatMap((checkpoint) => [...(checkpoint.invitedExternal || []), ...(checkpoint.presentExternal || [])])
      .filter(Boolean)
  )].sort((a, b) => a.localeCompare(b));
}

function defaultAuthorNameForProject(projectId) {
  return contactsForProject(projectId).find((contact) => contact.isDefaultAuthor)?.fullName || "";
}

function knownProjectPeople(projectId) {
  const names = new Set();
  contactsForProject(projectId, false).forEach((contact) => {
    if (contact.fullName) names.add(contact.fullName);
  });
  state.incidents
    .filter((incident) => incident.projectId === projectId)
    .forEach((incident) => {
      if (incident.declaredBy) names.add(incident.declaredBy);
    });
  state.events
    .filter((event) => event.projectId === projectId)
    .forEach((event) => {
      if (event.author) names.add(event.author);
      if (event.modifiedBy) names.add(event.modifiedBy);
    });
  state.checkpoints
    .filter((checkpoint) => checkpoint.projectId === projectId)
    .forEach((checkpoint) => {
      if (checkpoint.author) names.add(checkpoint.author);
      if (checkpoint.modifiedBy) names.add(checkpoint.modifiedBy);
      [...(checkpoint.invitedExternal || []), ...(checkpoint.presentExternal || [])].forEach((name) => name && names.add(name));
      (checkpoint.decisionsTaken || []).forEach((item) => item.owner && names.add(item.owner));
      (checkpoint.decisionsToTake || []).forEach((item) => item.owner && names.add(item.owner));
      (checkpoint.actions || []).forEach((item) => item.owner && names.add(item.owner));
    });
  return [...names].sort((a, b) => a.localeCompare(b));
}

function empty(text) {
  return `<div class="empty">${escapeHtml(text)}</div>`;
}

function icon(idValue) {
  return `<svg aria-hidden="true"><use href="#${idValue}"></use></svg>`;
}

function showToast(message) {
  clearTimeout(toastTimer);
  document.querySelector(".toast")?.remove();
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  document.body.appendChild(toast);
  toastTimer = setTimeout(() => toast.remove(), 3200);
}

function downloadAttachment(attachmentId) {
  const attachment = state.attachments.find((item) => item.id === attachmentId);
  if (!attachment?.blob) return;
  const url = URL.createObjectURL(attachment.blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = attachment.filename;
  link.click();
  URL.revokeObjectURL(url);
}

function printReport(reportId) {
  const report = state.reports.find((item) => item.id === reportId);
  if (!report) return;
  const frame = document.createElement("iframe");
  frame.className = "print-frame";
  frame.setAttribute("aria-hidden", "true");
  document.body.appendChild(frame);
  frame.srcdoc = `
    <!doctype html>
    <html lang="fr">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>${escapeHtml(report.title)}</title>
        <style>${reportPrintCss()}</style>
      </head>
      <body>
        ${report.html}
      </body>
    </html>
  `;
  frame.onload = () => {
    const win = frame.contentWindow;
    if (!win) {
      frame.remove();
      return;
    }
    const cleanup = () => setTimeout(() => frame.remove(), 400);
    win.addEventListener("afterprint", cleanup, { once: true });
    win.focus();
    setTimeout(() => {
      try {
        win.print();
      } catch {
        cleanup();
        showToast("L'impression n'a pas pu être lancée.");
      }
    }, 180);
  };
}

function reportPrintCss() {
  return `
    @page { size: A4; margin: 12mm; }
    html, body { margin: 0; background: #ffffff; color: #102033; font: 14px/1.5 "Segoe UI", Arial, sans-serif; }
    .report { display: grid; gap: 0; }
    .report-page { break-after: page; max-width: 100%; }
    .report-page:last-child { break-after: auto; }
    .report-page-dashboard { display: grid; gap: 18px; }
    .report-page-timeline { display: grid; gap: 16px; page-break-before: always; }
    .report-hero {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 16px;
      align-items: start;
      padding: 18px 20px;
      border-radius: 18px;
      background:
        radial-gradient(circle at top right, rgba(87, 168, 255, 0.16), transparent 34%),
        linear-gradient(135deg, #edf4fb 0%, #f7fbff 55%, #ffffff 100%);
      border: 1px solid #d4e2f0;
    }
    .report-eyebrow {
      margin: 0 0 8px;
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: .14em;
      color: #527091;
    }
    .report-hero h1 {
      margin: 0;
      font-size: 26px;
      line-height: 1.1;
    }
    .report-summary {
      margin: 10px 0 0;
      font-size: 15px;
      color: #334a63;
      max-width: 46em;
    }
    .report-severity {
      padding: 8px 12px;
      border-radius: 999px;
      font-size: 10px;
      font-weight: 700;
      letter-spacing: .12em;
    }
    .report-dashboard {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 10px;
    }
    .report-stat {
      padding: 14px;
      border-radius: 14px;
      background: linear-gradient(180deg, #f5f9fd 0%, #ffffff 100%);
      border: 1px solid #d9e5f0;
      display: grid;
      gap: 4px;
    }
    .report-stat-label {
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: .12em;
      color: #617a95;
    }
    .report-stat strong {
      font-size: 18px;
      line-height: 1.1;
    }
    .report-grid, .report-dual, .report-checkpoints {
      display: grid;
      gap: 10px;
    }
    .report-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); }
    .report-grid > div, .report-dual article, .report-note, .report-checkpoint {
      padding: 14px;
      border-radius: 14px;
      border: 1px solid #dbe6f0;
      background: linear-gradient(180deg, #ffffff 0%, #fbfdff 100%);
    }
    .report-section {
      display: grid;
      gap: 10px;
      break-inside: avoid;
    }
    .report-section h2 {
      margin: 0;
      font-size: 17px;
      padding-bottom: 6px;
      border-bottom: 2px solid #e6eef7;
    }
    .report-dual { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .report-dual h3 {
      margin: 0 0 6px;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: .08em;
      color: #617a95;
    }
    .report-note p, .report-dual p, .report-checkpoint p { margin: 0; }
    .report-timeline {
      position: relative;
      display: grid;
      gap: 10px;
      padding-left: 18px;
    }
    .report-timeline::before {
      content: "";
      position: absolute;
      left: 7px;
      top: 4px;
      bottom: 4px;
      width: 3px;
      border-radius: 999px;
      background: linear-gradient(180deg, #2b85e4 0%, #8ec0ff 62%, #d9e6f4 100%);
    }
    .report-timeline-item {
      display: grid;
      grid-template-columns: 145px 1fr;
      gap: 14px;
      align-items: start;
      break-inside: avoid;
    }
    .report-timeline-time {
      font-weight: 700;
      color: #21496d;
      padding-top: 6px;
      font-size: 12px;
    }
    .report-timeline-body {
      position: relative;
      padding: 14px 16px;
      border-radius: 14px;
      border: 1px solid #d8e4ef;
      background: linear-gradient(180deg, #ffffff 0%, #f8fbff 100%);
    }
    .report-timeline-body::before {
      content: "";
      position: absolute;
      left: -18px;
      top: 18px;
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: #2b85e4;
      box-shadow: 0 0 0 4px #eef5fd;
    }
    .report-timeline-body p { margin: 6px 0 5px; }
    .report-timeline-body span { color: #617a95; font-size: 11px; }
    .report-checkpoints { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .report-checkpoint {
      background:
        linear-gradient(180deg, #ffffff 0%, #f9fbfe 100%);
      box-shadow: inset 0 0 0 1px rgba(255,255,255,0.5);
    }
    .report-checkpoint-top {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 8px;
      font-size: 12px;
      color: #375372;
    }
    .report-attachment-chips {
      display: grid;
      gap: 8px;
      margin-top: 10px;
    }
    .report-attachment-chip {
      display: grid;
      grid-template-columns: 68px 1fr;
      gap: 10px;
      align-items: center;
      padding: 8px;
      border-radius: 12px;
      background: #f5f9fd;
      border: 1px solid #dbe6f0;
    }
    .report-attachment-thumb {
      width: 68px;
      height: 68px;
      object-fit: cover;
      border-radius: 10px;
      border: 1px solid #dbe6f0;
      display: block;
    }
    .report-attachment-chip-meta strong,
    .report-attachment-chip-meta span {
      display: block;
    }
    .report-attachment-chip-meta span {
      color: #617a95;
      font-size: 11px;
    }
    .report-attachments-cover { page-break-before: always; }
    .report-attachment-page { page-break-before: always; min-height: calc(297mm - 24mm); display: grid; }
    .report-attachment-sheet {
      min-height: calc(297mm - 24mm);
      display: grid;
      grid-template-rows: 1fr auto;
      gap: 10px;
    }
    .report-attachment-visual {
      min-height: 0;
      border: 1px solid #dbe6f0;
      border-radius: 16px;
      display: grid;
      place-items: center;
      overflow: hidden;
      background: #f8fbff;
    }
    .report-attachment-image {
      width: 100%;
      height: calc(297mm - 66mm);
      object-fit: contain;
      display: block;
      background: #ffffff;
    }
    .report-attachment-fallback {
      min-height: 68px;
      display: grid;
      place-items: center;
      padding: 12px;
      border-radius: 10px;
      background: #eef5fd;
      color: #375372;
      font-weight: 700;
      text-align: center;
    }
    .report-attachment-fallback-large {
      width: 100%;
      height: calc(297mm - 66mm);
      border-radius: 0;
      font-size: 20px;
    }
    .report-attachment-caption {
      font-size: 12px;
      color: #617a95;
      text-align: center;
    }
    @media print {
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .report-timeline-item, .report-checkpoint, .report-dual article, .report-stat, .report-grid > div, .report-attachment-sheet { break-inside: avoid; }
    }
  `;
}
