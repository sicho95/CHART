import {
  addAttachments,
  addEvent,
  closeIncident,
  createIncident,
  deleteAttachment,
  deleteContact,
  downloadExport,
  lastExportAt,
  replaceFromImport,
  resetWithSeed,
  saveCheckpoint,
  saveContact,
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
        ${state.online ? "" : `<div class="offline">Vous êtes hors ligne, les données restent disponibles localement.</div>`}
        ${state.persistentStorage === false ? `<div class="storage-note">Le navigateur ne garantit pas encore le stockage persistant. Pensez à exporter régulièrement.</div>` : ""}
        ${routeMarkup()}
      </main>
      ${navMarkup("bottom-nav")}
    </div>
  `;
  bindEvents(root);
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
      ${selectFilter("projectId", "Tous projets", state.projects.map((project) => [project.id, project.name]))}
      ${selectFilter("severity", "Gravité", DEFAULT_SEVERITIES.map((item) => [item, item]))}
      ${selectFilter("status", "Statut", DEFAULT_STATUSES.map((item) => [item, labelStatus(item)]))}
      ${selectFilter("type", "Type", DEFAULT_TYPES.map((item) => [item, item]))}
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
  const closure = state.closures.find((item) => item.id === incident.closureId);
  const report = state.reports.find((item) => item.id === closure?.generatedReportId);
  const attachments = relatedAttachments(incident);
  const frozenPoints = checkpoints.filter((item) => item.status === "frozen");
  const draftPoints = checkpoints.filter((item) => item.status === "draft");

  return `
    <div class="incident-detail-shell">
      <div class="detail-header incident-detail-header">
        <h1 class="detail-title">${escapeHtml(incident.title)}</h1>
        <div class="badges">
          <span class="badge">${escapeHtml(project?.name || "")}</span>
          <span class="badge ${severityClass(incident.severity)}">${escapeHtml(incident.severity)}</span>
          <span class="badge ${statusClass(incident.status)}">${escapeHtml(labelStatus(incident.status))}</span>
          <span class="badge">${escapeHtml(owner?.fullName || "Pilote non renseigné")}</span>
        </div>
        <div class="detail-actions">
          <button class="btn" data-action="event" data-incident="${incident.id}">Ajouter événement</button>
          <button class="btn" data-action="checkpoint" data-incident="${incident.id}">Préparer point</button>
          <button class="btn" data-action="notify" data-incident="${incident.id}">Marquer avertis</button>
          <label class="btn"><input type="file" hidden multiple data-file-attachments="${incident.id}">Ajouter fichier</label>
          <button class="btn success" data-action="close" data-incident="${incident.id}" ${incident.status === "clos" ? "disabled" : ""}>Clôturer</button>
          ${report ? `<button class="btn" data-action="show-report" data-report="${report.id}">Voir rapport</button>` : ""}
        </div>
      </div>
      <div class="incident-detail-top panel-pad">
        <section class="kpis">
          <div class="kpi"><span class="kpi-value">${formatDuration(incident.declaredAt, incident.closedAt || undefined)}</span><span class="kpi-label">Durée</span></div>
          <div class="kpi"><span class="kpi-value">${formatDate(incident.nextCheckpointAt)}</span><span class="kpi-label">Prochain point</span></div>
          <div class="kpi"><span class="kpi-value">${events.length}</span><span class="kpi-label">Entrées timeline</span></div>
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
        <div class="card-top"><h2 class="panel-title">Timeline</h2><span class="card-meta">${events.length} entrée(s)</span></div>
        <div class="timeline incident-timeline-scroll">${events.map(timelineItem).join("") || empty("Aucun événement.")}</div>
      </section>
      <div class="incident-bottom-grid panel-pad">
        <section class="incident-subpanel">
          <div class="card-top"><h2 class="panel-title">Points intermédiaires</h2><span class="card-meta">${draftPoints.length} brouillon(s) · ${frozenPoints.length} figé(s)</span></div>
          <div class="cards incident-subpanel-scroll">
            ${checkpoints.length ? checkpoints.map((checkpoint) => checkpointCard(incident, checkpoint)).join("") : empty("Aucun point préparé.")}
          </div>
        </section>
        <section class="incident-subpanel">
          <div class="card-top"><h2 class="panel-title">Pièces jointes</h2><span class="card-meta">${attachments.length} fichier(s)</span></div>
          <div class="cards incident-subpanel-scroll">
            ${attachments.length ? attachments.map(attachmentCard).join("") : empty("Aucune pièce jointe.")}
          </div>
        </section>
      </div>
    </div>`;
}

function timelineItem(event) {
  return `<article class="timeline-item">
    <div class="card-top"><strong>${escapeHtml(kindLabel(event.kind))}</strong><span class="card-meta">${formatDate(event.createdAt)}</span></div>
    <div>${escapeHtml(event.message)}</div>
    <div class="card-meta">${escapeHtml(event.author || "CHART")}</div>
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
    <div class="card-meta">${checkpointAttachments.length ? `${checkpointAttachments.length} fichier(s)` : "Sans fichier"}</div>
    <div class="detail-actions">
      <button class="btn" data-action="checkpoint-edit" data-incident="${incident.id}" data-checkpoint="${checkpoint.id}">${checkpoint.status === "draft" ? "Modifier" : "Consulter"}</button>
    </div>
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
          ${selectFilter("projectId", "Tous projets", state.projects.map((project) => [project.id, project.name]))}
          <input class="input" type="datetime-local" step="60" data-filter="from" value="${escapeHtml(filters.from)}">
          <input class="input" type="datetime-local" step="60" data-filter="to" value="${escapeHtml(filters.to)}">
          ${selectFilter("severity", "Gravité", DEFAULT_SEVERITIES.map((item) => [item, item]))}
          ${selectFilter("status", "Statut", DEFAULT_STATUSES.map((item) => [item, labelStatus(item)]))}
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
        <section><div class="card-top"><h3 class="panel-title">Contacts</h3><button class="btn" data-action="contact" data-project="${selected.id}">${icon("i-plus")}Contact</button></div><div class="cards">${contacts.filter((contact) => contact.isActive !== false).map(contactCard).join("") || empty("Aucun contact projet.")}</div></section>
      </div>` : `<div class="detail-empty">Créez un premier projet pour commencer.</div>`}</section>
  </div>`;
}

function contactCard(contact) {
  return `<article class="incident-card">
    <div class="card-top"><strong>${escapeHtml(contact.fullName)}</strong><span class="badge">${escapeHtml(contact.group || "groupe")}</span></div>
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
      <div class="detail-actions"><button class="btn primary" data-action="export-json">Exporter JSON</button><label class="btn danger"><input type="file" hidden accept="application/json" data-import-json>Importer et remplacer</label><button class="btn" data-action="reset-seed">Réinitialiser exemple</button></div>
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
  root.querySelectorAll("[data-filter]").forEach((input) => input.addEventListener("input", () => setFilter(input.dataset.filter, input.value)));
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
  if (action === "checkpoint") return openCheckpointModal(button.dataset.incident);
  if (action === "checkpoint-edit") return openCheckpointModal(button.dataset.incident, button.dataset.checkpoint);
  if (action === "notify") return openNotifyModal(button.dataset.incident);
  if (action === "close") return openClosureModal(button.dataset.incident);
  if (action === "project") return openProjectModal(button.dataset.project);
  if (action === "contact") return openContactModal(button.dataset.project);
  if (action === "contact-edit") return openContactModal(contactById(button.dataset.contact)?.projectId, button.dataset.contact);
  if (action === "contact-delete" && confirm("Supprimer ce contact de la liste active ?")) return deleteContact(button.dataset.contact).then(() => showToast("Contact supprimé."));
  if (action === "export-json") return downloadExport().then(() => showToast("Export JSON généré."));
  if (action === "reset-seed" && confirm("Réinitialiser avec l'exemple et effacer les données locales ?")) return resetWithSeed().then(() => showToast("Exemple restauré."));
  if (action === "show-report") return openReportModal(button.dataset.report);
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
  return `<form class="form-grid">
    ${field("projectId", "Projet", selectOptions(state.projects.map((item) => [item.id, item.name]), project?.id), "select")}
    ${field("title", "Titre", "", "text", true)}
    ${field("declaredBy", "Déclarant", "", "text", true)}
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

function openEventModal(incidentId) {
  const incident = state.incidents.find((item) => item.id === incidentId);
  openModal("Ajouter un événement", `<form class="form-grid">
    <input type="hidden" name="incidentId" value="${incidentId}">
    ${field("author", "Auteur", incident?.declaredBy || "CHART")}
    ${field("kind", "Type", selectOptions([["update", "Mise à jour"], ["notification", "Notification"], ["attachment", "Pièce jointe"]]), "select")}
    ${field("createdAt", "Date / heure", localDateValue(new Date()), "datetime-local")}
    ${field("message", "Message", "", "textarea", true, "wide")}
    <div class="field wide"><label>Pièces jointes</label><input class="input" type="file" name="attachments" multiple></div>
  </form>`, async (form, modal) => {
    await addEvent(values(form), [...form.querySelector("[name='attachments']").files]);
    closeModal(modal);
    showToast("Événement ajouté.");
  });
}

function openCheckpointModal(incidentId, checkpointId = "") {
  const incident = state.incidents.find((item) => item.id === incidentId);
  const checkpoint = checkpointId ? state.checkpoints.find((item) => item.id === checkpointId) : null;
  const contacts = contactsForProject(incident?.projectId);
  const suggestions = projectExternalParticipants(incident?.projectId);
  openModal(checkpoint ? "Modifier le point" : "Point intermédiaire", `<form class="form-grid">
    <input type="hidden" name="id" value="${checkpoint?.id || ""}">
    <input type="hidden" name="incidentId" value="${incidentId}">
    ${field("scheduledAt", "Date prévue", localDateValue(checkpoint?.scheduledAt || new Date()), "datetime-local")}
    ${field("heldAt", "Date tenue", localDateValue(checkpoint?.heldAt || ""), "datetime-local")}
    ${field("mode", "Modalité", selectOptions([["visio", "Visio"], ["téléphone", "Téléphone"], ["présentiel", "Présentiel"]], checkpoint?.mode || "visio"), "select")}
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
  }, [{ label: "Enregistrer brouillon", variant: "", attrs: "data-freeze='false'" }, { label: "Figer le point", variant: "primary", attrs: "data-freeze='true'" }]);
}

function openNotifyModal(incidentId) {
  const incident = state.incidents.find((item) => item.id === incidentId);
  const contacts = contactsForProject(incident?.projectId);
  openModal("Marquer avertis", `<form class="form-grid">
    <input type="hidden" name="incidentId" value="${incidentId}">
    <input type="hidden" name="kind" value="notification">
    ${field("author", "Auteur", "CHART")}
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
  openModal(contact ? "Modifier contact" : "Nouveau contact", `<form class="form-grid">
    <input type="hidden" name="id" value="${contact?.id || ""}">
    <input type="hidden" name="projectId" value="${projectId}">
    ${field("fullName", "Nom complet", contact?.fullName || "", "text", true)}
    ${field("roleLabel", "Rôle", contact?.roleLabel || "")}
    ${field("group", "Groupe", contact?.group || "")}
    ${field("organization", "Organisation", contact?.organization || "")}
    ${field("email", "Email", contact?.email || "", "email")}
    ${field("phone", "Téléphone", contact?.phone || "")}
    <label class="check-item"><input type="checkbox" name="isFavorite" ${contact?.isFavorite ? "checked" : ""}> Favori</label>
    <label class="check-item"><input type="checkbox" name="isActive" ${contact?.isActive !== false ? "checked" : ""}> Actif</label>
    ${field("notes", "Notes", contact?.notes || "", "textarea", false, "wide")}
  </form>`, async (form, modal) => {
    await saveContact(values(form));
    closeModal(modal);
    showToast(contact ? "Contact mis à jour." : "Contact ajouté.");
  });
}

function openReportModal(reportId) {
  const report = state.reports.find((item) => item.id === reportId);
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

function selectFilter(name, placeholder, options) {
  return `<select class="select" data-filter="${name}"><option value="">${placeholder}</option>${options.map(([value, label]) => `<option value="${escapeHtml(value)}" ${state.filters[name] === value ? "selected" : ""}>${escapeHtml(label)}</option>`).join("")}</select>`;
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
  const listId = `${name}_${Math.random().toString(36).slice(2, 8)}`;
  return `<div class="token-field" data-token-field>
    <span class="token-label">${escapeHtml(label)}</span>
    <div class="token-box" data-token-box>
      <div class="token-list" data-token-list></div>
      <input class="token-input" type="text" data-token-input list="${listId}" placeholder="Ajouter puis Entrée">
    </div>
    <input type="hidden" name="${name}" value="${escapeHtml((values || []).join(", "))}">
    <datalist id="${listId}">${(suggestions || []).map((item) => `<option value="${escapeHtml(item)}"></option>`).join("")}</datalist>
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

    const pushToken = () => {
      const value = input.value.trim();
      if (!value || tokens.includes(value)) return;
      tokens.push(value);
      input.value = "";
      renderTokens();
    };

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
    attachment: "Pièce jointe"
  }[kind] || kind;
}

function relatedAttachments(incident) {
  const eventIds = state.events.filter((event) => event.incidentId === incident.id).map((event) => event.id);
  const checkpointIds = state.checkpoints.filter((checkpoint) => checkpoint.incidentId === incident.id).map((checkpoint) => checkpoint.id);
  const ownerIds = new Set([incident.id, incident.closureId, ...eventIds, ...checkpointIds].filter(Boolean));
  return state.attachments
    .filter((attachment) => ownerIds.has(attachment.ownerId))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function attachmentScopeLabel(scope) {
  return {
    incident: "Incident",
    event: "Événement",
    checkpoint: "Point",
    closure: "Clôture"
  }[scope] || "Fichier";
}

function attachmentPreview(attachment) {
  if (!attachment?.mimeType?.startsWith("image/") || !attachment.blob) return "";
  const src = URL.createObjectURL(attachment.blob);
  return `<img class="attachment-preview" src="${src}" alt="${escapeHtml(attachment.filename)}">`;
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
  const printWindow = window.open("", "_blank", "noopener,noreferrer");
  if (!printWindow) {
    showToast("Le navigateur bloque la fenêtre d'impression.");
    return;
  }
  printWindow.document.write(`
    <!doctype html>
    <html lang="fr">
      <head>
        <meta charset="utf-8">
        <title>${escapeHtml(report.title)}</title>
        <style>${reportPrintCss()}</style>
      </head>
      <body>
        ${report.html}
      </body>
    </html>
  `);
  printWindow.document.close();
  printWindow.focus();
  setTimeout(() => printWindow.print(), 250);
}

function reportPrintCss() {
  return `
    @page { size: A4; margin: 12mm; }
    html, body { margin: 0; background: #ffffff; color: #102033; font: 14px/1.5 "Segoe UI", Arial, sans-serif; }
    body::before {
      content: "";
      position: fixed;
      inset: 0 0 auto 0;
      height: 12mm;
      background: linear-gradient(90deg, #0f2743 0%, #245f9d 52%, #57a8ff 100%);
    }
    .report {
      max-width: 100%;
      margin: 0 auto;
      padding: 18mm 8mm 12mm;
      display: grid;
      gap: 18px;
      position: relative;
    }
    .report::after {
      content: "CHART";
      position: absolute;
      top: 0;
      right: 8mm;
      color: #ffffff;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: .16em;
      transform: translateY(-8.7mm);
    }
    .report-hero {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 16px;
      align-items: start;
      padding: 18px 20px;
      border-radius: 18px;
      background: linear-gradient(135deg, #eef5fd 0%, #f7fbff 55%, #ffffff 100%);
      border: 1px solid #d9e6f4;
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
      background: #102033;
      color: #fff;
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
      background: #f5f9fd;
      border: 1px solid #dfe8f2;
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
      border: 1px solid #dfe8f2;
      background: #ffffff;
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
      padding-left: 16px;
    }
    .report-timeline::before {
      content: "";
      position: absolute;
      left: 6px;
      top: 4px;
      bottom: 4px;
      width: 2px;
      background: linear-gradient(180deg, #5ca4f4 0%, #d9e6f4 100%);
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
      border: 1px solid #dfe8f2;
      background: #fbfdff;
    }
    .report-timeline-body::before {
      content: "";
      position: absolute;
      left: -17px;
      top: 18px;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #2b85e4;
      box-shadow: 0 0 0 4px #eef5fd;
    }
    .report-timeline-body p { margin: 6px 0 5px; }
    .report-timeline-body span { color: #617a95; font-size: 11px; }
    .report-checkpoints { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .report-checkpoint {
      background: linear-gradient(180deg, #ffffff 0%, #f9fbfe 100%);
    }
    .report-checkpoint-top {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 8px;
      font-size: 12px;
      color: #375372;
    }
    @media print {
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .report-timeline-item, .report-checkpoint, .report-dual article, .report-stat, .report-grid > div { break-inside: avoid; }
    }
  `;
}
