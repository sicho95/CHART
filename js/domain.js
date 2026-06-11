export const DEFAULT_TYPES = ["applicatif", "infrastructure", "données", "sécurité", "fonctionnel"];
export const DEFAULT_SEVERITIES = ["mineur", "significatif", "majeur", "critique"];
export const DEFAULT_STATUSES = ["ouvert", "en_cours", "surveillance", "résolu", "clos"];
export const DEFAULT_GROUPS = ["hiérarchie", "chefs", "moa", "industriel", "exploitation"];

export function id(prefix) {
  return `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
}

export function nowIso() {
  return new Date().toISOString();
}

export function slugify(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "") || "projet";
}

export function formatDate(value, withTime = true) {
  if (!value) return "Non renseigné";
  const date = new Date(value);
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "short",
    timeStyle: withTime ? "short" : undefined
  }).format(date);
}

export function formatDuration(start, end = new Date().toISOString()) {
  if (!start) return "n/a";
  const delta = Math.max(0, new Date(end) - new Date(start));
  const minutes = Math.round(delta / 60000);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours < 24) return rest ? `${hours} h ${rest}` : `${hours} h`;
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours ? `${days} j ${remHours} h` : `${days} j`;
}

export function severityClass(value) {
  return `sev-${String(value || "").toLowerCase()}`;
}

export function statusClass(value) {
  return `status-${String(value || "").toLowerCase()}`;
}

export function labelStatus(value) {
  return String(value || "").replace("_", " ");
}

export function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function timelineStats(incidents, checkpoints, filters = {}) {
  const filtered = incidents.filter((incident) => {
    if (filters.projectId && incident.projectId !== filters.projectId) return false;
    if (filters.severity && incident.severity !== filters.severity) return false;
    if (filters.status && incident.status !== filters.status) return false;
    if (filters.type && incident.type !== filters.type) return false;
    const declared = new Date(incident.declaredAt);
    if (filters.from && declared < new Date(filters.from)) return false;
    if (filters.to && declared > new Date(`${filters.to}T23:59:59`)) return false;
    return true;
  });
  const durations = filtered
    .filter((incident) => incident.declaredAt && incident.closedAt)
    .map((incident) => new Date(incident.closedAt) - new Date(incident.declaredAt));
  const firstCheckpointDelays = filtered
    .map((incident) => {
      const first = checkpoints
        .filter((checkpoint) => checkpoint.incidentId === incident.id && checkpoint.status === "frozen")
        .sort((a, b) => new Date(a.heldAt || a.updatedAt) - new Date(b.heldAt || b.updatedAt))[0];
      return first ? new Date(first.heldAt || first.updatedAt) - new Date(incident.declaredAt) : null;
    })
    .filter((value) => value !== null);

  return {
    incidents: filtered,
    total: filtered.length,
    open: filtered.filter((incident) => incident.status !== "clos").length,
    closed: filtered.filter((incident) => incident.status === "clos").length,
    bySeverity: DEFAULT_SEVERITIES.map((severity) => ({
      severity,
      count: filtered.filter((incident) => incident.severity === severity).length
    })),
    averageDuration: durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : 0,
    medianDuration: median(durations),
    averageFirstCheckpoint: firstCheckpointDelays.length ? firstCheckpointDelays.reduce((a, b) => a + b, 0) / firstCheckpointDelays.length : 0
  };
}

export function msToReadable(ms) {
  if (!ms) return "n/a";
  const minutes = Math.round(ms / 60000);
  return formatDuration(new Date(0).toISOString(), new Date(minutes * 60000).toISOString());
}

export function makeSeedData() {
  const createdAt = "2026-06-11T08:00:00.000Z";
  const project = {
    id: "proj_alpha",
    name: "Alpha Terminal",
    slug: "alpha-terminal",
    description: "Application métier critique de suivi opérationnel",
    environment: "production",
    createdAt,
    updatedAt: createdAt,
    incidentTypes: DEFAULT_TYPES,
    severityLevels: DEFAULT_SEVERITIES,
    statusOptions: DEFAULT_STATUSES,
    contacts: ["contact_moa", "contact_ops", "contact_indus"],
    defaultStakeholderGroups: DEFAULT_GROUPS,
    color: "teal",
    archived: false
  };
  const contacts = [
    { id: "contact_moa", projectId: project.id, fullName: "Claire Martin", roleLabel: "Responsable MOA", group: "moa", organization: "Direction métier", email: "claire.martin@example.fr", phone: "+33600000001", isFavorite: true, isActive: true, notes: "Point de contact métier" },
    { id: "contact_ops", projectId: project.id, fullName: "Nicolas Bernard", roleLabel: "Pilote exploitation", group: "exploitation", organization: "Opérations", email: "nicolas.bernard@example.fr", phone: "+33600000002", isFavorite: true, isActive: true, notes: "" },
    { id: "contact_indus", projectId: project.id, fullName: "Sarah Lopez", roleLabel: "Référente industriel", group: "industriel", organization: "Prestataire", email: "sarah.lopez@example.fr", phone: "+33600000003", isFavorite: false, isActive: true, notes: "" }
  ];
  const incident = {
    id: "inc_sso_001",
    projectId: project.id,
    title: "Dégradation partielle de l'authentification",
    declaredBy: "Nicolas Bernard",
    declaredAt: "2026-06-11T08:15:00.000Z",
    location: "PROD",
    type: "applicatif",
    severity: "majeur",
    businessImpact: "Connexion intermittente pour une partie des utilisateurs métier.",
    technicalImpact: "Temps de réponse élevés côté fournisseur d'identité.",
    status: "surveillance",
    ownerContactId: "contact_ops",
    nextCheckpointAt: "2026-06-11T10:30:00.000Z",
    notifiedContacts: ["contact_moa", "contact_indus"],
    currentSummary: "Correctif fournisseur appliqué, surveillance renforcée en cours.",
    attachmentIds: [],
    timelineEventIds: ["evt_create", "evt_update", "evt_checkpoint"],
    checkpointIds: ["chk_001"],
    closureId: null,
    createdAt: "2026-06-11T08:15:00.000Z",
    updatedAt: "2026-06-11T10:05:00.000Z"
  };
  const events = [
    { id: "evt_create", incidentId: incident.id, projectId: project.id, createdAt: "2026-06-11T08:15:00.000Z", author: "Nicolas Bernard", kind: "create", message: "Incident déclaré et cellule de suivi ouverte.", attachmentIds: [] },
    { id: "evt_update", incidentId: incident.id, projectId: project.id, createdAt: "2026-06-11T08:42:00.000Z", author: "Sarah Lopez", kind: "update", message: "Analyse fournisseur engagée, hypothèse de saturation confirmée.", attachmentIds: [] },
    { id: "evt_checkpoint", incidentId: incident.id, projectId: project.id, createdAt: "2026-06-11T09:30:00.000Z", author: "Claire Martin", kind: "checkpoint_frozen", message: "Point figé: périmètre stabilisé, retour progressif observé, maintien sous surveillance.", attachmentIds: [] }
  ];
  const checkpoints = [
    {
      id: "chk_001",
      incidentId: incident.id,
      projectId: project.id,
      status: "frozen",
      scheduledAt: "2026-06-11T09:30:00.000Z",
      heldAt: "2026-06-11T09:32:00.000Z",
      mode: "visio",
      invitedContactIds: ["contact_moa", "contact_ops", "contact_indus"],
      invitedExternal: [],
      presentContactIds: ["contact_moa", "contact_ops", "contact_indus"],
      presentExternal: ["Support fournisseur"],
      situationSummary: "Incident toujours suivi, impact utilisateur en baisse.",
      doneSinceLastCheckpoint: "Logs consolidés, correctif fournisseur préparé.",
      remainingActions: "Confirmer la stabilité sur une fenêtre de surveillance.",
      blockersRisks: "Risque de récidive si saturation fournisseur.",
      decisionsTaken: [{ id: "dec_001", text: "Maintenir une surveillance rapprochée pendant deux heures.", owner: "Claire Martin" }],
      decisionsToTake: [{ id: "dec_002", text: "Clôture si aucune récidive après surveillance.", owner: "Nicolas Bernard" }],
      actions: [{ id: "act_001", label: "Contrôler les métriques SSO toutes les 30 minutes", owner: "Nicolas Bernard", dueAt: "2026-06-11T10:30:00.000Z", status: "open" }],
      nextCheckpointAt: "2026-06-11T10:30:00.000Z",
      notifiedContacts: ["contact_moa"],
      createdAt: "2026-06-11T09:00:00.000Z",
      updatedAt: "2026-06-11T09:32:00.000Z"
    }
  ];
  return { projects: [project], contacts, incidents: [incident], events, checkpoints, closures: [], reports: [], attachments: [], syncQueue: [] };
}

export function buildClosureReport({ incident, project, contacts, events, checkpoints, closure }) {
  const owner = contacts.find((contact) => contact.id === incident.ownerContactId);
  const frozen = checkpoints.filter((checkpoint) => checkpoint.status === "frozen");
  return {
    id: id("rep"),
    incidentId: incident.id,
    projectId: incident.projectId,
    createdAt: nowIso(),
    title: `Rapport de clôture - ${incident.title}`,
    html: `
      <article class="report">
        <header>
          <h1>Rapport de clôture incident</h1>
          <p>CHART - Chronology & History of Alerts, Reporting and Tracking</p>
        </header>
        <section class="report-grid">
          <div><strong>Projet</strong><br>${escapeHtml(project?.name)}</div>
          <div><strong>Incident</strong><br>${escapeHtml(incident.title)}</div>
          <div><strong>Gravité</strong><br>${escapeHtml(incident.severity)}</div>
          <div><strong>Durée</strong><br>${formatDuration(incident.declaredAt, closure.closedAt)}</div>
          <div><strong>Déclaré par</strong><br>${escapeHtml(incident.declaredBy)}</div>
          <div><strong>Pilote</strong><br>${escapeHtml(owner?.fullName || "Non renseigné")}</div>
        </section>
        <section><h2>Impacts</h2><p><strong>Métier:</strong> ${escapeHtml(incident.businessImpact)}</p><p><strong>Technique:</strong> ${escapeHtml(incident.technicalImpact || "Non renseigné")}</p></section>
        <section><h2>Résolution</h2><p>${escapeHtml(closure.resolutionSummary)}</p><p><strong>Cause connue:</strong> ${closure.rootCauseKnown ? "Oui" : "Non"}</p><p>${escapeHtml(closure.rootCauseSummary || "")}</p></section>
        <section><h2>Timeline</h2>${events.map((event) => `<p><strong>${formatDate(event.createdAt)}</strong> - ${escapeHtml(event.message)}</p>`).join("")}</section>
        <section><h2>Points intermédiaires figés</h2>${frozen.map((checkpoint) => `<p><strong>${formatDate(checkpoint.heldAt || checkpoint.updatedAt)}</strong> - ${escapeHtml(checkpoint.situationSummary)}</p>`).join("") || "<p>Aucun point figé.</p>"}</section>
        <section><h2>Actions correctives</h2><p>${escapeHtml(closure.correctiveActions || "Non renseigné")}</p></section>
        <section><h2>Synthèse finale</h2><p>${escapeHtml(closure.finalSummary)}</p></section>
      </article>
    `
  };
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
