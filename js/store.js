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
    isActive: form.isActive !== false,
    notes: form.notes || ""
  };
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

export async function addEvent(form, files = []) {
  const incident = state.incidents.find((item) => item.id === form.incidentId);
  if (!incident) return null;
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
  const existing = form.id ? state.checkpoints.find((item) => item.id === form.id) : null;
  const checkpoint = {
    id: existing?.id || id("chk"),
    incidentId: incident.id,
    projectId: incident.projectId,
    status: freeze ? "frozen" : "draft",
    scheduledAt: form.scheduledAt ? new Date(form.scheduledAt).toISOString() : nowIso(),
    heldAt: freeze ? (form.heldAt ? new Date(form.heldAt).toISOString() : nowIso()) : (form.heldAt ? new Date(form.heldAt).toISOString() : null),
    mode: form.mode || "visio",
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
    updatedAt: nowIso()
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
  if (freeze) {
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
