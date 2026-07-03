const state = {
  rows: [],
  sortKey: "name",
  sortDir: "asc",
};

const EXPIRED_LABEL = "Expired, Pending to deprovision";

const metaEl = document.getElementById("meta");
const summaryEl = document.getElementById("summary");
const tableBody = document.getElementById("table-body");
const searchInput = document.getElementById("search");
const ownershipFilter = document.getElementById("ownership-filter");
const footerText = document.getElementById("footer-text");

const MANTICORE_NAMES = [
  "demo organization testoncoursedemo",
  "monitoring-hub",
];

const PREFIX_RE = /^demo organization\s+/i;

function computeOwnership(name) {
  const value = (name || "").trim();
  const lower = value.toLowerCase();

  // Manticore: specific exact names.
  if (MANTICORE_NAMES.includes(lower)) return "Manticore";

  // The identifier is what remains after the "Demo Organization" prefix.
  const hasPrefix = PREFIX_RE.test(value);
  const id = value.replace(PREFIX_RE, "").trim();

  // Oncourse: identifier like r192753-o1 (r followed by a number).
  if (/^r\d/i.test(id)) return "Oncourse";

  // HOL: event-style names (e.g. FTDSLAQ3-01, Beau2).
  if (hasPrefix) return "HOL";

  return "Bugbounty";
}

function isExpired(row) {
  if (!row.expiryDate) return false;
  const date = new Date(row.expiryDate);
  if (Number.isNaN(date.getTime())) return false;
  return date.getTime() < Date.now();
}

function daysToExpire(expiryDate) {
  if (!expiryDate) return null;
  const expiry = new Date(expiryDate);
  if (Number.isNaN(expiry.getTime())) return null;
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.ceil((expiry.getTime() - Date.now()) / msPerDay);
}

function daysCell(row, expired) {
  const days = row.daysToExpire;
  if (days === null || days === undefined) {
    return expired ? EXPIRED_LABEL : "—";
  }
  if (days < 0) return "Expired";
  if (days === 0) return "Today";
  return `${days} day${days === 1 ? "" : "s"}`;
}

function formatDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function textCell(value, expired) {
  if (value !== null && value !== undefined && value !== "") return value;
  return expired ? EXPIRED_LABEL : "—";
}

function dateCell(value, expired) {
  const formatted = formatDate(value);
  if (formatted) return formatted;
  return expired ? EXPIRED_LABEL : "—";
}

function renderSummary() {
  const counts = { Oncourse: 0, HOL: 0, Manticore: 0, Bugbounty: 0 };
  state.rows.forEach((row) => {
    counts[row.ownership] = (counts[row.ownership] || 0) + 1;
  });

  summaryEl.hidden = false;
  summaryEl.innerHTML = `
    <article class="summary-card">
      <strong>${state.rows.length}</strong>
      <span>Total organizations</span>
    </article>
    <article class="summary-card">
      <strong>${counts.Oncourse}</strong>
      <span>Oncourse</span>
    </article>
    <article class="summary-card">
      <strong>${counts.HOL}</strong>
      <span>HOL</span>
    </article>
    <article class="summary-card">
      <strong>${counts.Manticore}</strong>
      <span>Manticore</span>
    </article>
    <article class="summary-card">
      <strong>${counts.Bugbounty}</strong>
      <span>Bugbounty</span>
    </article>
  `;
}

function compareValues(a, b) {
  if (a == null) return 1;
  if (b == null) return -1;
  if (typeof a === "boolean" || typeof b === "boolean") {
    return Number(Boolean(a)) - Number(Boolean(b));
  }
  return String(a).localeCompare(String(b), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function getFilteredRows() {
  const query = searchInput.value.trim().toLowerCase();
  const ownership = ownershipFilter.value;

  return state.rows
    .filter((row) => {
      if (ownership !== "all" && row.ownership !== ownership) return false;
      if (!query) return true;

      const haystack = [
        row.name,
        row.tenant,
        row.ownerEmail,
        row.contractNumber,
        row.ownership,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return haystack.includes(query);
    })
    .sort((left, right) => {
      const result = compareValues(left[state.sortKey], right[state.sortKey]);
      return state.sortDir === "asc" ? result : -result;
    });
}

function renderTable() {
  const rows = getFilteredRows();

  if (!rows.length) {
    tableBody.innerHTML =
      '<tr><td colspan="8" class="empty">No results for the current filters.</td></tr>';
    return;
  }

  tableBody.innerHTML = rows
    .map((row) => {
      const expired = isExpired(row);
      return `
        <tr>
          <td>${textCell(row.name, expired)}</td>
          <td class="mono">${textCell(row.tenant, expired)}</td>
          <td>${textCell(row.ownerEmail, expired)}</td>
          <td>${textCell(row.contractNumber, expired)}</td>
          <td>${dateCell(row.effectiveDate, expired)}</td>
          <td>${dateCell(row.expiryDate, expired)}</td>
          <td>${daysCell(row, expired)}</td>
          <td><span class="pill ${row.ownership.toLowerCase()}">${row.ownership}</span></td>
        </tr>
      `;
    })
    .join("");
}

function bindSorting() {
  document.querySelectorAll("th[data-sort]").forEach((header) => {
    header.addEventListener("click", () => {
      const key = header.dataset.sort;
      if (state.sortKey === key) {
        state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
      } else {
        state.sortKey = key;
        state.sortDir = "asc";
      }
      renderTable();
    });
  });
}

async function getPayload() {
  // Prefer the embedded data script (works on private GitHub Pages, where
  // fetch/XHR of subresources can hang behind the auth flow).
  if (window.__ORGS__) {
    return window.__ORGS__;
  }

  const response = await fetch("./data/orgs.json", { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json();
}

async function loadData() {
  try {
    const payload = await getPayload();
    state.rows = (payload.organizations || []).map((row) => ({
      ...row,
      ownership: computeOwnership(row.name),
      daysToExpire: daysToExpire(row.expiryDate),
    }));

    const generatedAt = payload.generatedAt
      ? new Date(payload.generatedAt).toLocaleString("en-US")
      : "unknown";

    metaEl.innerHTML = `
      <span class="badge">Environment: ${payload.environment || "demo"}</span>
      <span class="badge">Updated: ${generatedAt} UTC</span>
    `;

    renderSummary();

    footerText.textContent = `Showing ${state.rows.length} organizations · Rockwell Automation CloudOps`;
    renderTable();
  } catch (error) {
    metaEl.innerHTML = '<span class="badge">Failed to load data</span>';
    tableBody.innerHTML = `<tr><td colspan="8" class="error">Could not load the listing. ${error.message}</td></tr>`;
  }
}

searchInput.addEventListener("input", renderTable);
ownershipFilter.addEventListener("change", renderTable);
bindSorting();
loadData();
