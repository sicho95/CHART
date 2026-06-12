import { clearAll, exportData, getAll, importData, put, putMany, remove } from "./db.js";
import {
  buildClosureReport,
  DEFAULT_GROUPS,
  DEFAULT_SEVERITIES,
  DEFAULT_STATUSES,
  DEFAULT_TYPES,
  id,
  makeSeedData,
  nowIso,
  slugify
} from "./domain.js";

const HOT_PREFIX = "chart:";
const bannerState = JSON.parse(sessionStorage.getItem(`${HOT_PREFIX}banners`) || "{}");

export const state = {
  route: localStorage.getItem(`${HOT_PREFIX}route`) || "incidents",
  selectedIncidentId: localStorage.getItem(`${HOT_PREFIX}selectedIncidentId`) || null,
  selectedProjectId: localStorage.getItem(`${HOT_PREFIX}selectedProjectId`) || null,
  search: "",
  filters: {
    projectId: localStorage.getItem(`${HOT_PREFIX}filterProject`) || "",
    severity: "",
    status: "",
    type: "",
    from: "",
    to: ""
  },
  theme: localStorage.getItem(`${HOT_PREFIX}theme`) || "light",
  online: navigator.onLine,
  persistentStorage: null,
  quota: null,
  installPromptAvailable: false,
  dismissedBanners: {
    offline: Boolean(bannerState.offline),
    storage: Boolean(bannerState.storage),
    install: Boolean(bannerState.install)
  },
  projects: [],
  contacts: [],
  incidents: [],
  events: [],
  checkpoints: [],
  closures: [],
  reports: [],
  attachments: []
};

const listeners = new Set();

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function emit() {
  document.documentElement.dataset.theme = state.theme;
  listeners.forEach((listener) => listener(state));
}

export async function initStore() {
  await loadAll();
  if (!state.projects.length) {
    const seed = makeSeedData();
    await Promise.all(Object.entries(seed).map(([storeName, values]) => putMany(storeName, values)));
    await loadAll();
  }
  state.selectedProjectId ||= state.projects[0]?.id || null;
  state.selectedIncidentId ||= state.incidents[0]?.id || null;
  localStorage.setItem(`${HOT_PREFIX}selectedProjectId`, state.selectedProjectId || "");
  localStorage.setItem(`${HOT_PREFIX}selectedIncidentId`, state.selectedIncidentId || "");
  await inspectStorage();
  emit();
}

export async function loadAll() {
  const [projects, contacts, incidents, events, checkpoints, closures, reports, attachments] = await Promise.all([
    getAll("projects"),
    getAll("contacts"),
    getAll("incidents"),
    getAll("events"),
    getAll("checkpoints"),
    getAll("closures"),
    getAll("reports"),
    getAll("attachments")
  ]);
  Object.assign(state, {
    projects: projects.sort((a, b) => a.name.localeCompare(b.name)),
    contacts: contacts.sort((a, b) => a.fullName.localeCompare(b.fullName)),
    incidents: incidents.sort((a, b) => new Date(b.declaredAt) - new Date(a.declaredAt)),
    events: events.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)),
    checkpoints: checkpoints.sort((a, b) => new Date(a.scheduledAt || a.createdAt) - new Date(b.scheduledAt || b.createdAt)),
    closures,
    reports,
    attachments
  });
}

async function inspectStorage() {
  if (navigator.storage?.persist) {
    state.persistentStorage = await navigator.storage.persist();
  }
  if (navigator.storage?.estimate) {
    state.quota = await navigator.storage.estimate();
  }
}

export function setRoute(route) {
  state.route = route;
  localStorage.setItem(`${HOT_PREFIX}route`, route);
  emit();
}

export function setTheme(theme) {
  state.theme = theme;
  localStorage.setItem(`${HOT_PREFIX}theme`, theme);
  emit();
}

export function setInstallPromptAvailable(value) {
  state.installPromptAvailable = Boolean(value);
  emit();
}

export function dismissBanner(name) {
  state.dismissedBanners[name] = true;
  sessionStorage.setItem(`${HOT_PREFIX}banners`, JSON.stringify(state.dismissedBanners));
  emit();
}

export function showBanner(name) {
  state.dismissedBanners[name] = false;
  sessionStorage.setItem(`${HOT_PREFIX}banners`, JSON.stringify(state.dismissedBanners));
  emit();
}

export function setSearch(search) {
  state.search = search;
  emit();
}

export function setFilter(name, value) {
  state.filters[name] = value;
  if (name === "projectId") localStorage.setItem(`${HOT_PREFIX}filterProject`, value);
  emit();
}

export function selectIncident(idValue) {
  state.selectedIncidentId = idValue;
  localStorage.setItem(`${HOT_PREFIX}selectedIncidentId`, idValue || "");
  emit();
}

export function selectProject(idValue) {
  state.selectedProjectId = idValue;
  state.filters.projectId = idValue || "";
  localStorage.setItem(`${HOT_PREFIX}selectedProjectId`, idValue || "");
  localStorage.setItem(`${HOT_PREFIX}filterProject`, idValue || "");
  emit();
}

export async function saveProject(form) {
  const existing = form.id ? state.projects.find((project) => project.id === form.id) : null;
  const project = {
    id: existing?.id || id("proj"),
    name: form.name,
    slug: slugify(form.slug || form.name),
    description: form.description || "",
    environment: form.environment || "production",
    createdAt: existing?.createdAt || nowIso(),
    updatedAt: nowIso(),
    incidentTypes: splitList(form.incidentTypes, DEFAULT_TYPES),
    severityLevels: splitList(form.severityLevels, DEFAULT_SEVERITIES),
    statusOptions: splitList(form.statusOptions, DEFAULT_STATUSES),
    contacts: existing?.contacts || [],
    defaultStakeholderGroups: splitList(form.defaultStakeholderGroups, DEFAULT_GROUPS),
    color: form.colorHex || form.color || existing?.color || "#2b85e4",
    archived: false
  };
  await put("projects", project);
  await loadAll();
  state.selectedProjectId = project.id;
  emit();
  return project;
}

export async function saveContact(form) {
  const existing = form.id ? state.contacts.find((contact) => contact.id === form.id) : null;
  const contact = {
    id: existing?.id || id("contact"),
    projectId: form.projectId,
    fullName: form.fullName,
    roleLabel: form.roleLabel || "",
    group: form.group || "",
    organization: form.organization || "",
    email: form.email || "",
    phone: form.phone || "",
    isFavorite: Boolean(form.isFavorite),
    isDefaultAuthor: Boolean(form.isDefaultAuthor),
    isActive: form.isActive !== false,
    notes: form.notes || ""
  };
  if (contact.isDefaultAuthor) {
    const siblings = state.contacts.filter((item) => item.projectId === contact.projectId && item.id !== contact.id && item.isDefaultAuthor);
    await Promise.all(siblings.map((item) => put("contacts", { ...item, isDefaultAuthor: false })));
  }
  await put("contacts", contact);
  const project = state.projects.find((item) => item.id === contact.projectId);
  if (project && !project.contacts.includes(contact.id)) {
    project.contacts = [...project.contacts, contact.id];
    project.updatedAt = nowIso();
    await put("projects", project);
  }
  await loadAll();
  emit();
  return contact;
}

export async function deleteContact(contactId) {
  const contact = state.contacts.find((item) => item.id === contactId);
  if (!contact) return null;
  contact.isActive = false;
  await put("contacts", contact);
  await loadAll();
  emit();
  return contact;
}

export async function createIncident(form, files = []) {
  const timestamp = nowIso();
  const incident = {
    id: id("inc"),
    projectId: form.projectId,
    title: form.title,
    declaredBy: form.declaredBy,
    declaredAt: form.declaredAt ? new Date(form.declaredAt).toISOString() : timestamp,
    location: form.location || "",
    type: form.type,
    severity: form.severity,
    businessImpact: form.businessImpact,
    technicalImpact: form.technicalImpact || "",
    status: form.status,
    ownerContactId: form.ownerContactId,
    nextCheckpointAt: form.nextCheckpointAt ? new Date(form.nextCheckpointAt).toISOString() : "",
    notifiedContacts: toArray(form.notifiedContacts),
    currentSummary: form.currentSummary || form.businessImpact,
    attachmentIds: [],
    timelineEventIds: [],
    checkpointIds: [],
    closureId: null,
    createdAt: timestamp,
    updatedAt: timestamp
  };
  const event = {
    id: id("evt"),
    incidentId: incident.id,
    projectId: incident.projectId,
    createdAt: timestamp,
    author: incident.declaredBy,
    kind: "create",
    message: `Incident déclaré: ${incident.currentSummary}`,
    attachmentIds: []
  };
  incident.timelineEventIds.push(event.id);
  await put("incidents", incident);
  await put("events", event);
  if (files.length) await addAttachments("incident", incident.id, files);
  await loadAll();
  selectIncident(incident.id);
  return incident;
}

export async function updateIncidentStatus(incidentId, status) {
  const incident = state.incidents.find((item) => item.id === incidentId);
  if (!incident) return null;
  incident.status = status;
  incident.updatedAt = nowIso();
  await put("incidents", incident);
  await addEvent({ incidentId, kind: "update", author: "CHART", message: `Statut mis à jour: ${status.replace("_", " ")}` });
  return incident;
}

export async function saveEvent(form, files = []) {
  const incident = state.incidents.find((item) => item.id === form.incidentId);
  if (!incident) return null;
  const existing = form.id ? state.events.find((item) => item.id === form.id) : null;
  if (existing) {
    if (incident.status === "clos") return null;
    if (!["update", "notification", "attachment"].includes(existing.kind)) return null;
    const kind = form.kind || existing.kind;
    if (!["update", "notification", "attachment"].includes(kind)) return null;
    const author = form.author || existing.author || incident.declaredBy || "CHART";
    const createdAt = form.createdAt ? new Date(form.createdAt).toISOString() : existing.createdAt;
    const changed = eventChanged(existing, form, author, createdAt, kind);
    const event = {
      ...existing,
      author,
      kind,
      createdAt,
      message: form.message || existing.message,
      modifiedAt: changed ? nowIso() : existing.modifiedAt || null,
      modifiedBy: changed ? defaultModifierName(incident.projectId, author) : existing.modifiedBy || ""
    };
    await put("events", event);
    if (files.length) {
      const attachments = await addAttachments("event", event.id, files);
      event.attachmentIds = [...new Set([...(existing.attachmentIds || []), ...attachments.map((attachment) => attachment.id)])];
      await put("events", event);
    }
    await loadAll();
    emit();
    return event;
  }
  return addEvent(form, files);
}

export async function addEvent(form, files = []) {
  const incident = state.incidents.find((item) => item.id === form.incidentId);
  if (!incident) return null;
  if (incident.status === "clos" && !["closure", "reopen"].includes(form.kind)) return null;
  const event = {
    id: id("evt"),
    incidentId: incident.id,
    projectId: incident.projectId,
    createdAt: form.createdAt ? new Date(form.createdAt).toISOString() : nowIso(),
    author: form.author || incident.declaredBy,
    kind: form.kind || "update",
    message: form.message,
    attachmentIds: []
  };
  incident.currentSummary = form.message;
  incident.timelineEventIds = [...new Set([...(incident.timelineEventIds || []), event.id])];
  incident.updatedAt = nowIso();
  await put("events", event);
  await put("incidents", incident);
  if (files.length) {
    const attachments = await addAttachments("event", event.id, files);
    event.attachmentIds = attachments.map((attachment) => attachment.id);
    await put("events", event);
  }
  await loadAll();
  emit();
  return event;
}

export async function saveCheckpoint(form, freeze = false, files = []) {
  const incident = state.incidents.find((item) => item.id === form.incidentId);
  if (!incident) return null;
  if (incident.status === "clos") return null;
  const existing = form.id ? state.checkpoints.find((item) => item.id === form.id) : null;
  const nextScheduledAt = form.scheduledAt ? new Date(form.scheduledAt).toISOString() : nowIso();
  const nextHeldAt = freeze ? (form.heldAt ? new Date(form.heldAt).toISOString() : (existing?.heldAt || nowIso())) : (form.heldAt ? new Date(form.heldAt).toISOString() : null);
  const changed = existing ? checkpointChanged(existing, form, freeze, nextScheduledAt, nextHeldAt) : false;
  const checkpoint = {
    id: existing?.id || id("chk"),
    incidentId: incident.id,
    projectId: incident.projectId,
    status: freeze ? "frozen" : "draft",
    scheduledAt: nextScheduledAt,
    heldAt: nextHeldAt,
    mode: form.mode || "visio",
    author: form.author || existing?.author || incident.declaredBy || "CHART",
    invitedContactIds: toArray(form.invitedContactIds),
    invitedExternal: splitList(form.invitedExternal, []),
    presentContactIds: toArray(form.presentContactIds),
    presentExternal: splitList(form.presentExternal, []),
    situationSummary: form.situationSummary || "",
    doneSinceLastCheckpoint: form.doneSinceLastCheckpoint || "",
    remainingActions: form.remainingActions || "",
    blockersRisks: form.blockersRisks || "",
    decisionsTaken: rowsFromTextarea(form.decisionsTaken, "dec"),
    decisionsToTake: rowsFromTextarea(form.decisionsToTake, "dec"),
    actions: actionRows(form.actions),
    nextCheckpointAt: form.nextCheckpointAt ? new Date(form.nextCheckpointAt).toISOString() : "",
    notifiedContacts: toArray(form.notifiedContacts),
    createdAt: existing?.createdAt || nowIso(),
    updatedAt: nowIso(),
    modifiedAt: changed ? nowIso() : existing?.modifiedAt || null,
    modifiedBy: changed ? defaultModifierName(incident.projectId, form.author || existing?.author || incident.declaredBy || "CHART") : existing?.modifiedBy || ""
  };
  incident.checkpointIds = [...new Set([...(incident.checkpointIds || []), checkpoint.id])];
  incident.nextCheckpointAt = checkpoint.nextCheckpointAt || incident.nextCheckpointAt;
  incident.currentSummary = checkpoint.situationSummary || incident.currentSummary;
  incident.updatedAt = nowIso();
  await put("checkpoints", checkpoint);
  await put("incidents", incident);
  if (files.length) {
    await addAttachments("checkpoint", checkpoint.id, files);
  }
  if (freeze && existing?.status !== "frozen") {
    await addEvent({
      incidentId: incident.id,
      kind: "checkpoint_frozen",
      author: "CHART",
      message: `Point figé: ${checkpoint.situationSummary || "point intermédiaire ajouté à la timeline"}`
    });
  } else {
    await loadAll();
    emit();
  }
  return checkpoint;
}

export async function closeIncident(form) {
  const incident = state.incidents.find((item) => item.id === form.incidentId);
  if (!incident) return null;
  if (incident.status === "clos") return null;
  const finalSummary = form.finalSummary || form.resolutionSummary || "Incident clos.";
  const closure = {
    id: id("cls"),
    incidentId: incident.id,
    projectId: incident.projectId,
    closedAt: form.closedAt ? new Date(form.closedAt).toISOString() : nowIso(),
    resolutionSummary: form.resolutionSummary,
    rootCauseKnown: Boolean(form.rootCauseKnown),
    rootCauseSummary: form.rootCauseSummary || "",
    correctiveActions: form.correctiveActions || "",
    postIncidentReviewRequired: Boolean(form.postIncidentReviewRequired),
    finalSummary,
    generatedReportId: null,
    createdAt: nowIso()
  };
  const report = buildClosureReport({
    incident,
    project: state.projects.find((project) => project.id === incident.projectId),
    contacts: state.contacts,
    events: state.events.filter((event) => event.incidentId === incident.id),
    checkpoints: state.checkpoints.filter((checkpoint) => checkpoint.incidentId === incident.id),
    closure
  });
  closure.generatedReportId = report.id;
  incident.status = "clos";
  incident.closedAt = closure.closedAt;
  incident.closureId = closure.id;
  incident.currentSummary = closure.finalSummary;
  incident.updatedAt = nowIso();
  await put("closures", closure);
  await put("reports", report);
  await put("incidents", incident);
  await addEvent({ incidentId: incident.id, kind: "closure", author: "CHART", message: `Incident clos: ${closure.finalSummary}` });
  return closure;
}

export async function reopenIncident(form) {
  const incident = state.incidents.find((item) => item.id === form.incidentId);
  if (!incident || incident.status !== "clos") return null;
  const reason = String(form.reason || "").trim();
  if (!reason) throw new Error("Le motif de réouverture est obligatoire.");
  incident.status = "en_cours";
  incident.closedAt = "";
  incident.currentSummary = `Réouverture: ${reason}`;
  incident.updatedAt = nowIso();
  await put("incidents", incident);
  await addEvent({
    incidentId: incident.id,
    kind: "reopen",
    author: form.author || "CHART",
    message: `Incident réouvert: ${reason}`
  });
  return incident;
}

export async function addAttachments(scope, ownerId, files) {
  const created = [];
  for (const file of files) {
    const attachment = {
      id: id("att"),
      scope,
      ownerId,
      filename: file.name,
      mimeType: file.type || "application/octet-stream",
      size: file.size,
      blob: file,
      createdAt: nowIso()
    };
    await put("attachments", attachment);
    created.push(attachment);
  }
  if (scope === "incident") {
    const incident = state.incidents.find((item) => item.id === ownerId);
    if (incident) {
      incident.attachmentIds = [...new Set([...(incident.attachmentIds || []), ...created.map((item) => item.id)])];
      incident.updatedAt = nowIso();
      await put("incidents", incident);
    }
  }
  await loadAll();
  emit();
  return created;
}

export async function deleteAttachment(attachmentId) {
  await remove("attachments", attachmentId);
  await loadAll();
  emit();
}

export async function downloadExport() {
  const payload = await exportData();
  localStorage.setItem(`${HOT_PREFIX}lastExportAt`, payload.exportedAt);
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `chart-export-${payload.exportedAt.slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
  emit();
}

export async function replaceFromImport(file) {
  const text = await file.text();
  await importData(JSON.parse(text));
  Object.keys(localStorage)
    .filter((key) => key.startsWith(HOT_PREFIX))
    .forEach((key) => localStorage.removeItem(key));
  await loadAll();
  state.route = "incidents";
  state.selectedProjectId = state.projects[0]?.id || null;
  state.selectedIncidentId = state.incidents[0]?.id || null;
  emit();
}

export async function resetWithSeed() {
  await clearAll();
  const seed = makeSeedData();
  await Promise.all(Object.entries(seed).map(([storeName, values]) => putMany(storeName, values)));
  await loadAll();
  state.selectedProjectId = state.projects[0]?.id || null;
  state.selectedIncidentId = state.incidents[0]?.id || null;
  emit();
}

export async function resetWorkspace() {
  await clearAll();
  Object.keys(localStorage)
    .filter((key) => key.startsWith(HOT_PREFIX))
    .forEach((key) => localStorage.removeItem(key));
  sessionStorage.removeItem(`${HOT_PREFIX}banners`);
  await loadAll();
  state.route = "incidents";
  state.selectedProjectId = null;
  state.selectedIncidentId = null;
  state.search = "";
  state.filters = { projectId: "", severity: "", status: "", type: "", from: "", to: "" };
  emit();
}

export async function ensureIncidentReport(incidentId) {
  const incident = state.incidents.find((item) => item.id === incidentId);
  if (!incident) return null;
  const closure = state.closures.find((item) => item.id === incident.closureId) || {
    id: incident.closureId || "",
    incidentId: incident.id,
    projectId: incident.projectId,
    closedAt: incident.closedAt || "",
    resolutionSummary: incident.currentSummary || "",
    rootCauseKnown: false,
    rootCauseSummary: "",
    correctiveActions: "",
    postIncidentReviewRequired: false,
    finalSummary: incident.currentSummary || incident.businessImpact || "",
    generatedReportId: null,
    createdAt: incident.createdAt
  };
  const existing = state.reports.find((item) => item.id === closure.generatedReportId) || state.reports.find((item) => item.incidentId === incident.id);
  const report = buildClosureReport({
    incident,
    project: state.projects.find((project) => project.id === incident.projectId),
    contacts: state.contacts,
    events: state.events.filter((event) => event.incidentId === incident.id),
    checkpoints: state.checkpoints.filter((checkpoint) => checkpoint.incidentId === incident.id),
    closure,
    attachments: state.attachments.filter((attachment) =>
      attachment.ownerId === incident.id
      || state.events.some((event) => event.incidentId === incident.id && event.id === attachment.ownerId)
      || state.checkpoints.some((checkpoint) => checkpoint.incidentId === incident.id && checkpoint.id === attachment.ownerId)
    ),
    reportId: existing?.id
  });
  await put("reports", report);
  if (incident.closureId) {
    const storedClosure = state.closures.find((item) => item.id === incident.closureId);
    if (storedClosure && storedClosure.generatedReportId !== report.id) {
      storedClosure.generatedReportId = report.id;
      await put("closures", storedClosure);
    }
  }
  await loadAll();
  emit();
  return state.reports.find((item) => item.id === report.id) || report;
}

export function lastExportAt() {
  return localStorage.getItem(`${HOT_PREFIX}lastExportAt`);
}

function splitList(value, fallback) {
  if (Array.isArray(value)) return value;
  const items = String(value || "")
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length ? items : fallback;
}

function toArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value.filter(Boolean) : [value].filter(Boolean);
}

function rowsFromTextarea(value, prefix) {
  return splitList(value, []).map((text) => ({ id: id(prefix), text, owner: "" }));
}

function actionRows(value) {
  return splitList(value, []).map((label) => ({ id: id("act"), label, owner: "", dueAt: "", status: "open" }));
}

function checkpointChanged(existing, form, freeze, nextScheduledAt, nextHeldAt) {
  return [
    existing.status !== (freeze ? "frozen" : "draft"),
    existing.scheduledAt !== nextScheduledAt,
    (existing.heldAt || null) !== (nextHeldAt || null),
    existing.mode !== (form.mode || "visio"),
    (existing.author || form.author || "") !== (form.author || existing.author || ""),
    existing.situationSummary !== (form.situationSummary || ""),
    existing.doneSinceLastCheckpoint !== (form.doneSinceLastCheckpoint || ""),
    existing.remainingActions !== (form.remainingActions || ""),
    existing.blockersRisks !== (form.blockersRisks || "")
  ].some(Boolean);
}

function eventChanged(existing, form, author, createdAt, kind) {
  return [
    existing.author !== author,
    existing.createdAt !== createdAt,
    existing.kind !== kind,
    existing.message !== (form.message || existing.message)
  ].some(Boolean);
}

function defaultModifierName(projectId, fallback) {
  return state.contacts.find((contact) => contact.projectId === projectId && contact.isDefaultAuthor)?.fullName || fallback || "CHART";
}
