/**
 * RMAS Costing — Google Apps Script API
 * Front end: index.html on GitHub Pages (calls this script with fetch, like VS-REQUEST-FORM)
 * Database: this Google Sheet (tabs: Receipts, Budgets, Team, Audit, Settings)
 * Receipt files: Google Drive folder "RMAS Costing Receipts"
 * Access: each of the 7 users has a personal access key (Team tab). Their link is index.html?key=THEIR_KEY
 *
 * First-time setup: choose the function "setup" and click Run. Then Deploy > New deployment > Web app
 *   Execute as: Me   ·   Who has access: Anyone
 */

const APP = {
  REGIONS: ["NCR", "North Luzon", "Central Luzon", "South Luzon", "Visayas", "Mindanao"],
  BUS: ["AV", "HA", "AC"],
  CE_GIVEN: { AV: 0.48642, HA: 0.40320, AC: 0.11035 }, // CE split, scaled to 100% in shares_()
  LATE_DAYS: 7,        // uploaded more than 7 days after the receipt date = Late
  ALLOWANCE: 0.10,     // next month's request = projected spend this month + 10%
  SEND_HOUR: 8,        // approval email at 8 AM (Asia/Manila)
  REMINDER_AFTER: 2,   // reminder 2 days after the email if next month's budget is still missing
  FOLDER_NAME: "RMAS Costing Receipts",
  TZ: "Asia/Manila",
  // Put your GitHub Pages address here so emails and personal links point to it
  SITE_URL: "https://rmas-ce.github.io/RMAS-COSTING/",
};

const SHEETS = {
  Receipts: ["ID", "Receipt date", "Uploaded at", "Uploaded by", "Region", "BU", "Category",
             "Vendor", "Outlet", "OR no.", "Amount", "AV share", "HA share", "AC share", "Purpose",
             "Late", "Possible duplicate", "File ID", "File URL", "File type"],
  Budgets:  ["Month", "Region", "BU", "Amount", "Approved by", "Date approved", "Saved by", "Saved at"],
  Team:     ["#", "Name", "Role", "Region", "Email", "Access key"],
  Audit:    ["Timestamp", "User", "Action", "Details", "Receipt ID"],
  Settings: ["Key", "Value"],
};
const R = {}; SHEETS.Receipts.forEach((h, i) => R[h] = i);

// ============================================================ HTTP API

function doGet(e) {
  return respond_(() => {
    const p = (e && e.parameter) || {};
    const action = p.action || "bootstrap";
    if (action === "version") { userByKey_(p.key); return { version: getVersion_() }; }
    if (action === "bootstrap") { const u = userByKey_(p.key); return bootstrap_(u); }
    throw new Error("Unknown action: " + action);
  });
}

function doPost(e) {
  return respond_(() => {
    const body = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    const u = userByKey_(body.key);
    switch (body.action) {
      case "upload":        return uploadReceipt_(u, body);
      case "saveBudget":    return saveBudget_(u, body);
      case "saveTeam":      return saveTeam_(u, body.team);
      case "newKey":        return newKey_(u, Number(body.index));
      case "logExport":     audit_(u, "Exported report", `${body.kind} · ${body.filename}`, ""); bump_(); return { ok: true };
      case "sendTestEmail": requireHead_(u); sendApprovalEmail_({ testTo: u.email }); return { sentTo: u.email };
      default: throw new Error("Unknown action: " + body.action);
    }
  });
}

function respond_(fn) {
  let out;
  try { out = Object.assign({ success: true }, fn()); }
  catch (err) { out = { success: false, error: String(err && err.message || err) }; }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

// ============================================================ actions

function bootstrap_(u) {
  return Object.assign(readAll_(u), { me: u.idx });
}

function uploadReceipt_(u, p) {
  const isHead = u.user.role === "RMAS Head";
  const region = isHead ? p.region : u.user.region; // regional users always upload for their own region
  const amt = Math.round(Number(p.amt) * 100) / 100;
  if (APP.REGIONS.indexOf(region) < 0) throw new Error("Pick a valid region.");
  if (APP.BUS.concat(["CE"]).indexOf(p.bu) < 0) throw new Error("Pick a valid BU.");
  if (!(amt > 0)) throw new Error("Enter the amount on the receipt.");
  if (!p.date) throw new Error("Pick the date on the receipt.");
  if (!p.vendor || !p.outlet) throw new Error("Vendor and outlet are required.");
  if (!p.purpose || String(p.purpose).trim().length < 15) throw new Error("Describe what the budget was used for (at least 15 characters).");
  if (!p.file || !p.file.data) throw new Error("Attach the receipt photo or PDF.");
  if (["image/jpeg", "image/png", "application/pdf"].indexOf(p.file.type) < 0) throw new Error("Upload a JPG, PNG or PDF.");

  const today = todayDate_();
  const date = parseD_(p.date);
  if (date > today) throw new Error("The receipt date can't be in the future.");

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sh = sheet_("Receipts");
    const n = Math.max(sh.getLastRow() - 1, 0);
    const rows = n ? sh.getRange(2, 1, n, SHEETS.Receipts.length).getValues() : [];

    let dupIdx = -1;
    const or = String(p.or || "").trim();
    if (or) {
      dupIdx = rows.findIndex(r => String(r[R["OR no."]]).trim().toLowerCase() === or.toLowerCase() &&
                                   String(r[R["Vendor"]]).trim().toLowerCase() === String(p.vendor).trim().toLowerCase());
      if (dupIdx >= 0 && !p.confirmDup) {
        const d = rows[dupIdx];
        return { dup: { vendor: d[R["Vendor"]], or: String(d[R["OR no."]]), amt: d[R["Amount"]], date: fmtD_(d[R["Receipt date"]]), by: d[R["Uploaded by"]] } };
      }
      if (dupIdx >= 0) sh.getRange(dupIdx + 2, R["Possible duplicate"] + 1).setValue(true);
    }

    const id = rows.reduce((m, r) => Math.max(m, Number(r[R["ID"]]) || 0), 0) + 1;
    const folder = DriveApp.getFolderById(getSetting_("folderId"));
    const ext = p.file.type === "application/pdf" ? "pdf" : (p.file.type === "image/png" ? "png" : "jpg");
    const name = `${fmtD_(date)}_${region}_${p.bu}_${String(p.vendor).replace(/[^\w\- ]/g, "").slice(0, 30)}_${id}.${ext}`;
    const file = folder.createFile(Utilities.newBlob(Utilities.base64Decode(p.file.data), p.file.type, name));
    // viewable by link so the gallery can show it; the file ID is long and only shown inside the app
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    const s = shares_(p.bu, amt);
    const late = daysBetween_(date, today) > APP.LATE_DAYS;
    sh.appendRow([id, date, new Date(), u.user.name, region, p.bu, p.cat, String(p.vendor).trim(), String(p.outlet).trim(), or,
                  amt, s.AV || 0, s.HA || 0, s.AC || 0, String(p.purpose).trim(), late, dupIdx >= 0, file.getId(), file.getUrl(), p.file.type]);
    audit_(u, "Uploaded receipt", `${p.vendor} · OR ${or || "—"} · ${p.bu} · PHP ${amt.toFixed(2)}${late ? " · LATE" : ""}${dupIdx >= 0 ? " · possible duplicate" : ""}`, id);
    bump_();
  } finally {
    lock.releaseLock();
  }
  return { ok: true, data: bootstrap_(u) };
}

function saveBudget_(u, p) {
  requireHead_(u);
  if (!/^\d{4}-\d{2}$/.test(p.month)) throw new Error("Pick the budget month.");
  if (!p.approvedBy) throw new Error("Enter who approved the budget.");
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sh = sheet_("Budgets");
    const n = Math.max(sh.getLastRow() - 1, 0);
    const keep = n ? sh.getRange(2, 1, n, SHEETS.Budgets.length).getValues().filter(r => monthKey_(r[0]) !== p.month) : [];
    const had = n - keep.length > 0;
    const now = new Date(), approvedOn = parseD_(p.dateApproved || fmtD_(now));
    let total = 0;
    APP.REGIONS.forEach(rg => APP.BUS.forEach(bu => {
      const a = Math.max(0, Number(((p.amounts || {})[rg] || {})[bu]) || 0);
      total += a;
      keep.push([p.month, rg, bu, a, p.approvedBy, approvedOn, u.user.name, now]);
    }));
    if (n) sh.getRange(2, 1, n, SHEETS.Budgets.length).clearContent();
    sh.getRange(2, 1, keep.length, 1).setNumberFormat("@");
    sh.getRange(2, 1, keep.length, SHEETS.Budgets.length).setValues(keep);
    audit_(u, "Saved approved budget", `${p.month} · PHP ${total.toLocaleString()} · approved by ${p.approvedBy}${had ? " (updated)" : ""}`, "");
    bump_();
  } finally {
    lock.releaseLock();
  }
  return { data: bootstrap_(u) };
}

/** Save names, regions and emails. Keys are kept; new users get a key. RMAS Head only. */
function saveTeam_(u, list) {
  requireHead_(u);
  if (!Array.isArray(list) || !list.length) throw new Error("The team list is empty.");
  const old = readTeam_();
  const rows = list.map((t, i) => [i + 1, String(t.name || "").trim() || `User ${i + 1}`, i === 0 ? "RMAS Head" : "RMAS Team",
                                   i === 0 ? "All regions" : String(t.region || ""), String(t.email || "").trim().toLowerCase(),
                                   (old[i] && old[i].key) || makeKey_()]);
  writeTeam_(rows);
  audit_(u, "Updated team", rows.map(r => `${r[1]} (${r[3]})`).join(", "), "");
  bump_();
  return { data: bootstrap_(userByKey_(u.user.key)) };
}

/** Replace one user's access key (their old link stops working). RMAS Head only. */
function newKey_(u, index) {
  requireHead_(u);
  const team = readTeam_();
  if (!team[index]) throw new Error("User not found.");
  const sh = sheet_("Team");
  const key = makeKey_();
  sh.getRange(index + 2, 6).setValue(key);
  audit_(u, "Updated team", `New access key for ${team[index].name}`, "");
  bump_();
  return { data: bootstrap_(userByKey_(index === u.idx ? key : u.user.key)) };
}

// ============================================================ scheduled email

/** Runs daily at 8 AM: request 7 days before month end, reminder 2 days later if still no budget. */
function dailyJob() {
  const today = todayDate_();
  const last = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  const sendDay = last - 7;
  const d = today.getDate();
  const nextKey = Utilities.formatDate(new Date(today.getFullYear(), today.getMonth() + 1, 1), APP.TZ, "yyyy-MM");
  if (d === sendDay) sendApprovalEmail_({});
  else if (d === sendDay + APP.REMINDER_AFTER && !readBudgets_().some(b => b.month === nextKey)) sendApprovalEmail_({ reminder: true });
}

function sendApprovalEmail_(opt) {
  const team = readTeam_();
  const head = team[0];
  if (!opt.testTo && !head.email) { console.warn("No RMAS Head email on the Team tab; email not sent."); return; }
  if (opt.testTo === "") throw new Error("Add your email on the Team page first.");

  const today = todayDate_();
  const y = today.getFullYear(), m = today.getMonth();
  const dim = new Date(y, m + 1, 0).getDate(), el = today.getDate();
  const next = new Date(y, m + 1, 1);
  const monthName = Utilities.formatDate(today, APP.TZ, "MMMM");
  const nextName = Utilities.formatDate(next, APP.TZ, "MMMM yyyy");
  const P = proposal_(readReceipts_(), y, m, dim, el);

  const peso = v => "₱" + Math.round(v).toLocaleString("en-US");
  const table = (label, rows) => {
    const T = k => rows.reduce((a, r) => a + r[k], 0);
    const td = "padding:6px 10px;border-bottom:1px solid #e3e6ec;";
    return `<table style="border-collapse:collapse;font:14px Arial,sans-serif;margin:6px 0 16px">
      <tr style="background:#f3f5f9"><th style="${td}text-align:left">${label}</th><th style="${td}text-align:right">Spent MTD</th><th style="${td}text-align:right">Projected ${monthName}</th><th style="${td}text-align:right">Needed (+10%)</th></tr>
      ${rows.map(r => `<tr><td style="${td}">${r.k}</td><td style="${td}text-align:right">${peso(r.s)}</td><td style="${td}text-align:right">${peso(r.proj)}</td><td style="${td}text-align:right"><b>${peso(r.prop)}</b></td></tr>`).join("")}
      <tr><td style="${td}"><b>Total</b></td><td style="${td}text-align:right"><b>${peso(T("s"))}</b></td><td style="${td}text-align:right"><b>${peso(T("proj"))}</b></td><td style="${td}text-align:right"><b>${peso(T("prop"))}</b></td></tr></table>`;
  };
  const html = `<div style="font:14px Arial,sans-serif;color:#111827;max-width:680px">
    ${opt.reminder ? `<p style="background:#fef3c7;padding:8px 12px;border-radius:6px"><b>Reminder:</b> the ${nextName} budget has not been entered yet.</p>` : ""}
    <p>Hi ${head.name},</p>
    <p>Here is the merchandising spend for ${monthName} as of ${Utilities.formatDate(today, APP.TZ, "MMM d")} and the budget needed for ${nextName}. The request is this month's projected spend plus a 10% allowance per BU for unexpected expenses. Please approve or send back with comments before ${Utilities.formatDate(new Date(y, m, dim), APP.TZ, "MMM d")}.</p>
    <p><b>Budget needed per BU</b></p>${table("BU", P.bus)}
    <p><b>Breakdown per region</b></p>${table("Region", P.regs)}
    <p style="color:#6b7280;font-size:12px">Projected = spend as of day ${el} ÷ ${el} × ${dim} days. AV, HA and AC include their share of CE expenses. Rounded up to the nearest ₱1,000. The receipt list is attached.</p>
    <p><a href="${APP.SITE_URL}" style="background:#2557d6;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none;font-weight:bold">Open RMAS Costing</a></p>
    <p style="color:#6b7280;font-size:12px">After approving, enter the approved amounts on the Approved budget page.</p></div>`;

  const to = opt.testTo || head.email;
  const cc = opt.testTo ? "" : team.slice(1).map(t => t.email).filter(Boolean).join(",");
  const subject = `${opt.testTo ? "[TEST] " : ""}${opt.reminder ? "[Reminder] " : ""}[RMAS] Budget approval request: ${nextName} merchandising`;
  const attachment = monthReceiptsXlsx_(y, m);
  MailApp.sendEmail({ to, cc, subject, htmlBody: html, attachments: attachment ? [attachment] : [], name: "RMAS Costing" });
}

function monthReceiptsXlsx_(y, m) {
  try {
    const rows = sheet_("Receipts").getDataRange().getValues();
    const head = rows.shift();
    const mine = rows.filter(r => r[1] instanceof Date && r[1].getFullYear() === y && r[1].getMonth() === m);
    const tmp = SpreadsheetApp.create(`RMAS receipts ${y}-${String(m + 1).padStart(2, "0")}`);
    tmp.getSheets()[0].getRange(1, 1, mine.length + 1, head.length).setValues([head].concat(mine));
    SpreadsheetApp.flush();
    const res = UrlFetchApp.fetch(`https://docs.google.com/spreadsheets/d/${tmp.getId()}/export?format=xlsx`,
      { headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken() } });
    DriveApp.getFileById(tmp.getId()).setTrashed(true);
    return res.getBlob().setName(`RMAS-Receipts_${y}-${String(m + 1).padStart(2, "0")}.xlsx`);
  } catch (e) {
    console.warn("Attachment skipped: " + e);
    return null;
  }
}

// ============================================================ setup

/** Run once from the editor. Creates tabs, receipt folder, the 7 users with access keys, and the daily trigger. */
function setup() {
  const ss = SpreadsheetApp.getActive();
  ss.setSpreadsheetTimeZone(APP.TZ);
  Object.keys(SHEETS).forEach(name => {
    let sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    if (sh.getLastRow() === 0) {
      sh.appendRow(SHEETS[name]);
      sh.setFrozenRows(1);
      sh.getRange(1, 1, 1, SHEETS[name].length).setFontWeight("bold").setBackground("#e8efff");
    }
  });
  ["Sheet1", "Sheet 1"].forEach(nm => { const s = ss.getSheetByName(nm); if (s && s.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(s); });

  const rec = sheet_("Receipts");
  rec.getRange("B:B").setNumberFormat("yyyy-mm-dd");
  rec.getRange("C:C").setNumberFormat("yyyy-mm-dd hh:mm");
  rec.getRange("K:N").setNumberFormat("#,##0.00");
  sheet_("Budgets").getRange("A:A").setNumberFormat("@");
  sheet_("Budgets").getRange("D:D").setNumberFormat("#,##0");

  if (sheet_("Team").getLastRow() === 1) {
    const rows = [[1, "RMAS Head", "RMAS Head", "All regions", Session.getEffectiveUser().getEmail(), makeKey_()]];
    APP.REGIONS.forEach((r, i) => rows.push([i + 2, `${r} RMAS`, "RMAS Team", r, "", makeKey_()]));
    writeTeam_(rows);
  }

  if (!getSetting_("folderId")) {
    const folder = DriveApp.createFolder(APP.FOLDER_NAME);
    const parents = DriveApp.getFileById(ss.getId()).getParents();
    if (parents.hasNext()) folder.moveTo(parents.next());
    setSetting_("folderId", folder.getId());
  }
  bump_();
  installTriggers();
  const head = readTeam_()[0];
  console.log("Setup done.\nRMAS Head link (after you deploy and set APPS_SCRIPT_URL in index.html):\n" + APP.SITE_URL + "?key=" + head.key);
}

function installTriggers() {
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === "dailyJob").forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger("dailyJob").timeBased().everyDays(1).atHour(APP.SEND_HOUR).inTimezone(APP.TZ).create();
}

// ============================================================ read helpers

function readAll_(u) {
  const isHead = u.user.role === "RMAS Head";
  return {
    // only the RMAS Head receives everyone's access keys (to share personal links)
    team: readTeam_().map((t, i) => ({ name: t.name, role: t.role, region: t.region, email: t.email, key: (isHead || i === u.idx) ? t.key : "" })),
    receipts: readReceipts_().map(r => Object.assign({}, r, { date: fmtD_(r.date), uploadedOn: fmtDT_(r.uploadedOn) })),
    budgets: readBudgets_(),
    audit: readAudit_(800),
    version: getVersion_(),
    config: { today: fmtD_(todayDate_()), siteUrl: APP.SITE_URL },
  };
}

function readTeam_() {
  const sh = sheet_("Team");
  const n = Math.max(sh.getLastRow() - 1, 0);
  if (!n) return [];
  return sh.getRange(2, 1, n, 6).getValues().filter(r => r[1]).map(r => ({
    name: String(r[1]), role: String(r[2]), region: r[2] === "RMAS Head" ? "" : String(r[3]),
    email: String(r[4] || "").trim().toLowerCase(), key: String(r[5] || "").trim(),
  }));
}

function writeTeam_(rows) {
  const sh = sheet_("Team");
  const n = Math.max(sh.getLastRow() - 1, 0);
  if (n) sh.getRange(2, 1, n, 6).clearContent();
  sh.getRange(2, 1, rows.length, 6).setValues(rows);
}

function readReceipts_() {
  const sh = sheet_("Receipts");
  const n = Math.max(sh.getLastRow() - 1, 0);
  if (!n) return [];
  return sh.getRange(2, 1, n, SHEETS.Receipts.length).getValues().filter(r => r[0] !== "").map(r => ({
    id: Number(r[R["ID"]]), date: asDate_(r[R["Receipt date"]]), uploadedOn: asDate_(r[R["Uploaded at"]]),
    by: String(r[R["Uploaded by"]]), region: String(r[R["Region"]]), bu: String(r[R["BU"]]), cat: String(r[R["Category"]]),
    vendor: String(r[R["Vendor"]]), outlet: String(r[R["Outlet"]]), or: String(r[R["OR no."]]), amt: Number(r[R["Amount"]]) || 0,
    purpose: String(r[R["Purpose"]]), late: r[R["Late"]] === true, dup: r[R["Possible duplicate"]] === true,
    fileId: String(r[R["File ID"]]), fileUrl: String(r[R["File URL"]]), fileType: String(r[R["File type"]]),
  }));
}

function readBudgets_() {
  const sh = sheet_("Budgets");
  const n = Math.max(sh.getLastRow() - 1, 0);
  if (!n) return [];
  return sh.getRange(2, 1, n, SHEETS.Budgets.length).getValues().filter(r => r[0] !== "").map(r => ({
    month: monthKey_(r[0]), region: String(r[1]), bu: String(r[2]), amount: Number(r[3]) || 0,
    approvedBy: String(r[4]), dateApproved: fmtD_(asDate_(r[5])),
  }));
}

function readAudit_(limit) {
  const sh = sheet_("Audit");
  const last = sh.getLastRow();
  if (last < 2) return [];
  const start = Math.max(2, last - limit + 1);
  return sh.getRange(start, 1, last - start + 1, 5).getValues().map(r => ({
    at: fmtDT_(asDate_(r[0])), who: String(r[1]), action: String(r[2]), detail: String(r[3]), rid: r[4] === "" ? null : Number(r[4]),
  }));
}

// ============================================================ calculations (same rules as the page)

function shares_(bu, amt) {
  if (bu !== "CE") { const o = {}; o[bu] = amt; return o; }
  const sum = APP.CE_GIVEN.AV + APP.CE_GIVEN.HA + APP.CE_GIVEN.AC;
  const av = Math.round(amt * APP.CE_GIVEN.AV / sum * 100) / 100;
  const ha = Math.round(amt * APP.CE_GIVEN.HA / sum * 100) / 100;
  return { AV: av, HA: ha, AC: Math.round((amt - av - ha) * 100) / 100 };
}

function proposal_(receipts, y, m, dim, el) {
  const val = (r, bu) => shares_(r.bu, r.amt)[bu] || 0;
  const inMonth = receipts.filter(r => r.date && r.date.getFullYear() === y && r.date.getMonth() === m);
  const cell = {}, cs = {};
  APP.REGIONS.forEach(rg => {
    cell[rg] = {}; cs[rg] = {};
    APP.BUS.forEach(bu => {
      const s = inMonth.filter(r => r.region === rg).reduce((a, r) => a + val(r, bu), 0);
      cs[rg][bu] = s;
      cell[rg][bu] = s > 0 ? Math.ceil(s / el * dim * (1 + APP.ALLOWANCE) / 1000) * 1000 : 0;
    });
  });
  const sum = (f, o) => APP.REGIONS.reduce((a, rg) => a + APP.BUS.reduce((b, bu) => b + (f(rg, bu) ? o[rg][bu] : 0), 0), 0);
  return {
    regs: APP.REGIONS.map(rg => ({ k: rg, s: sum(r => r === rg, cs), proj: sum(r => r === rg, cs) / el * dim, prop: sum(r => r === rg, cell) })),
    bus: APP.BUS.map(bu => ({ k: bu, s: sum((r, b) => b === bu, cs), proj: sum((r, b) => b === bu, cs) / el * dim, prop: sum((r, b) => b === bu, cell) })),
  };
}

// ============================================================ users / access keys

function userByKey_(key) {
  key = String(key || "").trim();
  if (!key) throw new Error("Missing access key. Open RMAS Costing using your personal link.");
  const team = readTeam_();
  const idx = team.findIndex(t => t.key && t.key === key);
  if (idx < 0) throw new Error("Invalid access key. Ask the RMAS Head for your personal link.");
  return { idx, user: team[idx], email: team[idx].email };
}

function requireHead_(u) {
  if (u.user.role !== "RMAS Head") throw new Error("Only the RMAS Head can do this.");
}

function makeKey_() {
  return Utilities.getUuid().replace(/-/g, "").slice(0, 16);
}

// ============================================================ small utilities

function sheet_(name) {
  const sh = SpreadsheetApp.getActive().getSheetByName(name);
  if (!sh) throw new Error(`The "${name}" tab is missing. Run setup() from the Apps Script editor.`);
  return sh;
}

function audit_(u, action, detail, rid) {
  sheet_("Audit").appendRow([new Date(), u.user.name, action, detail, rid === "" ? "" : rid]);
}

function getSetting_(key) {
  const sh = SpreadsheetApp.getActive().getSheetByName("Settings");
  if (!sh || sh.getLastRow() < 2) return null;
  const row = sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues().find(r => r[0] === key);
  return row ? row[1] : null;
}

function setSetting_(key, value) {
  const sh = sheet_("Settings");
  const n = Math.max(sh.getLastRow() - 1, 0);
  const vals = n ? sh.getRange(2, 1, n, 1).getValues() : [];
  const i = vals.findIndex(r => r[0] === key);
  if (i >= 0) sh.getRange(i + 2, 2).setValue(value);
  else sh.appendRow([key, value]);
}

function getVersion_() { return String(getSetting_("version") || ""); }
function bump_() { setSetting_("version", String(Date.now())); }

function todayDate_() {
  const s = Utilities.formatDate(new Date(), APP.TZ, "yyyy-MM-dd").split("-").map(Number);
  return new Date(s[0], s[1] - 1, s[2]);
}
function parseD_(s) { const p = String(s).split("-").map(Number); return new Date(p[0], p[1] - 1, p[2]); }
function asDate_(v) { return v instanceof Date ? v : (v ? new Date(v) : null); }
function fmtD_(d) { return d ? Utilities.formatDate(d, APP.TZ, "yyyy-MM-dd") : ""; }
function fmtDT_(d) { return d ? Utilities.formatDate(d, APP.TZ, "yyyy-MM-dd'T'HH:mm:ss") : ""; }
function monthKey_(v) { return v instanceof Date ? Utilities.formatDate(v, APP.TZ, "yyyy-MM") : String(v); }
function daysBetween_(a, b) { return Math.round((b - a) / 864e5); }
