#!/usr/bin/env node
/*
 * Scan RGPD (informatif) — sans dépendance, NE BLOQUE JAMAIS (exit 0).
 *   node rgpd-scan.cjs
 *
 * But : informer le développeur de ce qui est en place et de CE QU'IL DOIT METTRE
 * EN PLACE, avec une action concrète par point manquant. Aucun jugement définitif :
 * ce qui n'est ni détecté ni déclaré dans rgpd.config.json est « à confirmer ».
 *
 * Pour le document DPO complet + le statut détaillé : outil `rgpd-audit`.
 */
const fs = require("fs"); const path = require("path"); const cp = require("child_process");
const repo = process.cwd();
const read = (p) => { try { return fs.readFileSync(p, "utf8"); } catch { return ""; } };
const json = (p) => { try { return JSON.parse(read(p)); } catch { return null; } };
const IGNORE = new Set(["node_modules", ".git", ".next", "dist", "build", ".vercel", "coverage", "out"]);
function walk(d, o = [], k = 0) { if (k > 8) return o; let e; try { e = fs.readdirSync(d, { withFileTypes: true }); } catch { return o; } for (const x of e) { if (IGNORE.has(x.name)) continue; const f = path.join(d, x.name); x.isDirectory() ? walk(f, o, k + 1) : o.push(f); } return o; }

const files = walk(repo);
const sql = files.filter((f) => f.endsWith(".sql")).map(read).join("\n").toLowerCase();
let src = "", b = 3_000_000; for (const f of files) { if (/\.(ts|tsx|js|jsx|cjs|mjs|sql)$/.test(f)) { const t = read(f); src += "\n" + t.toLowerCase(); if ((b -= t.length) < 0) break; } }
const gitignore = read(path.join(repo, ".gitignore"));
const vercel = json(path.join(repo, "vercel.json"));
const cfg = json(path.join(repo, "rgpd.config.json")) || {};
let tracked = ""; try { tracked = cp.execSync("git ls-files", { cwd: repo, stdio: ["ignore", "pipe", "ignore"] }).toString(); } catch {}
const has = (re) => re.test(sql) || re.test(src);
const EU = ["fra1", "cdg1", "dub1", "arn1"];

const ok = [], todo = [], confirm = [];
const push = (arr, label, msg) => arr.push({ label, msg });

// ── Technique (avec action si manquant) ──
const regions = (vercel && vercel.regions) || [];
regions.length && regions.every((r) => EU.includes(r))
  ? push(ok, "Résidence UE (compute)", `Vercel ${regions.join(", ")}`)
  : push(todo, "Résidence UE (compute)", 'Fixer la région en UE : ajouter "regions":["fra1"] à vercel.json.');

const rls = (sql.match(/enable row level security/g) || []).length;
sql ? (rls ? push(ok, "RLS (accès aux données)", `${rls} table(s) protégée(s)`) : push(todo, "RLS (accès aux données)", "Activer Row-Level Security + policies sur les tables contenant des données personnelles."))
    : push(confirm, "RLS (accès aux données)", "Pas de migrations SQL détectées — vérifier le contrôle d'accès au stockage.");

const secretFiles = tracked.split("\n").filter((l) => /(^|\/)\.env/.test(l) && !/\.env\.(example|sample|template)/.test(l));
!/(^|\n)\s*!?\.env/.test(gitignore) || secretFiles.length
  ? push(todo, "Secrets", secretFiles.length ? `Retirer du dépôt : ${secretFiles.join(", ")} + ajouter .env* à .gitignore.` : "Ajouter .env* à .gitignore.")
  : push(ok, "Secrets", ".env* ignoré, aucun secret suivi");

has(/audit[_-]?log/) ? push(ok, "Journal d'audit", "table/journal détecté") : push(todo, "Journal d'audit", "Ajouter un journal (audit_log) des écritures sur les données sensibles.");
has(/anonymiz|effacement|portabilit|erasure/) ? push(ok, "Droits Art. 17/20", "effacement/portabilité détectés") : push(todo, "Droits Art. 17/20", "Ajouter les fonctions d'effacement (anonymisation) et d'export des données personnelles.");
has(/rate[_-]?limit/) ? push(ok, "Rate-limiting", "détecté") : push(todo, "Rate-limiting", "Ajouter une limitation de débit sur les points sensibles.");
fs.existsSync(path.join(repo, "rgpd.config.json")) ? push(ok, "Déclaration RGPD", "rgpd.config.json présent") : push(todo, "Déclaration RGPD", "Créer rgpd.config.json (voir le template) et déclarer région, DPA, backups, DPO…");

// ── Compte / juridique (déclaré ou à confirmer) ──
const a = cfg.account || {}, l = cfg.legal || {};
a.backups ? push(ok, "Sauvegardes", `${a.backups} (déclaré)`) : push(confirm, "Sauvegardes", "Vérifier/activer les backups (dashboard) et le déclarer dans rgpd.config.json.");
a.mfaEnforced ? push(ok, "MFA compte", "imposée (déclaré)") : push(confirm, "MFA compte", "Activer la MFA sur le compte d'hébergement et le déclarer.");
l.dpaSigned && l.dpaSigned.length ? push(ok, "DPA sous-traitant(s)", l.dpaSigned.join(", ")) : push(confirm, "DPA sous-traitant(s)", "Signer un DPA avec chaque sous-traitant (Supabase, Vercel, cloud…) et le déclarer.");
const geo = /geoloc|latitude|longitude|\bgps\b|webfleet|tacho|telematic/i.test(src), emp = /salari|employe|conducteur|\bdriver\b|matricule/i.test(src);
l.dpiaReference ? push(ok, "AIPD", l.dpiaReference) : (geo || emp) ? push(todo, "AIPD (Art. 35)", "Risque élevé détecté (géoloc / données salariés) → réaliser une AIPD, probablement obligatoire.") : push(confirm, "AIPD (Art. 35)", "Évaluer la nécessité d'une AIPD avec le DPO.");
l.dpo ? push(ok, "DPO", l.dpo) : push(confirm, "DPO", "Désigner/confirmer le DPO et le déclarer.");

// ── Rendu ──
const C = { g: "\x1b[32m", y: "\x1b[33m", c: "\x1b[36m", z: "\x1b[0m", b: "\x1b[1m" };
console.log(`\n${C.b}Scan RGPD — ${cfg.appName || path.basename(repo)}${C.z}  (informatif, non bloquant)\n`);
if (ok.length) { console.log(`${C.g}${C.b}En place${C.z}`); ok.forEach((x) => console.log(`  ${C.g}✓${C.z} ${x.label} — ${x.msg}`)); }
if (todo.length) { console.log(`\n${C.y}${C.b}À mettre en place${C.z}`); todo.forEach((x) => console.log(`  ${C.y}○${C.z} ${x.label} — ${x.msg}`)); }
if (confirm.length) { console.log(`\n${C.c}${C.b}À confirmer / déclarer${C.z}`); confirm.forEach((x) => console.log(`  ${C.c}?${C.z} ${x.label} — ${x.msg}`)); }
console.log(`\n  ${ok.length} en place · ${todo.length} à mettre en place · ${confirm.length} à confirmer`);
console.log(`  Document DPO complet : \x1b[4mnpx rgpd-audit\x1b[0m (ou l'outil interne rgpd-audit).\n`);

// Résumé GitHub Actions (visible sur chaque run, non bloquant)
if (process.env.GITHUB_STEP_SUMMARY) {
  const row = (x, s) => `| ${s} | ${x.label} | ${x.msg} |`;
  const md = [`## 🛡️ Scan RGPD — ${cfg.appName || path.basename(repo)}`, "", "_Informatif — ne bloque pas le build._", "",
    "| | Point | Détail / action |", "|---|---|---|",
    ...ok.map((x) => row(x, "✅")), ...todo.map((x) => row(x, "🟠 à faire")), ...confirm.map((x) => row(x, "❔ à confirmer")),
    "", `**${ok.length}** en place · **${todo.length}** à mettre en place · **${confirm.length}** à confirmer.`].join("\n");
  try { fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + "\n"); } catch {}
}
// Rapport HTML autonome (généré en CI en fin de dev → artifact téléchargeable ;
// en local seulement avec --report, pour ne pas encombrer l'arbre de travail).
if (process.env.GITHUB_ACTIONS || process.argv.includes("--report")) {
  try {
    const date = new Date().toISOString().slice(0, 10);
    const esc = (s) => String(s).replace(/[&<>]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[ch]));
    const sec = (title, arr, sym, col) => arr.length
      ? `<h2 style="color:${col}">${sym} ${title} <span class="n">${arr.length}</span></h2><table>${arr.map((x) => `<tr><td class="l">${esc(x.label)}</td><td class="m">${esc(x.msg)}</td></tr>`).join("")}</table>` : "";
    const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Rapport RGPD — ${esc(cfg.appName || path.basename(repo))}</title>
<style>:root{--ink:#182231;--mut:#5a6675;--line:#e2e7ef;--ok:#1f7a54;--todo:#a56a10;--confirm:#227a8c}
body{font:15px/1.55 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:var(--ink);max-width:820px;margin:32px auto;padding:0 18px;background:#f7f9fb}
.card{background:#fff;border:1px solid var(--line);border-radius:12px;padding:24px 26px}
h1{font-size:25px;margin:0 0 4px}.sub{color:var(--mut);margin:0 0 6px}.meta{color:#8592a2;font-size:13px;font-family:ui-monospace,Menlo,monospace}
.note{background:#fbf1de;border:1px solid #efd9ab;color:#6f4d10;border-radius:8px;padding:10px 14px;font-size:13px;margin:16px 0}
h2{font-size:16px;margin:22px 0 8px;padding-bottom:6px;border-bottom:1px solid var(--line)}.n{font-size:12px;color:#8592a2;font-weight:400}
table{width:100%;border-collapse:collapse}td{padding:7px 4px;border-bottom:1px solid var(--line);vertical-align:top;font-size:14px}
td.l{font-weight:600;width:38%}td.m{color:var(--mut)}.sum{margin-top:18px;font-weight:600}
footer{color:#8592a2;font-size:12px;margin-top:20px;text-align:center}</style></head>
<body><div class="card"><h1>Rapport RGPD — ${esc(cfg.appName || path.basename(repo))}</h1>
<p class="sub">Scan de préparation — informatif</p><p class="meta">${date} · généré automatiquement (rgpd-scan)</p>
<div class="note"><b>Portée.</b> Scan technique + faits déclarés. Pas un avis juridique ni une certification. Les points « à confirmer » relèvent du DPO.</div>
${sec("En place", ok, "✓", "var(--ok)")}${sec("À mettre en place", todo, "○", "var(--todo)")}${sec("À confirmer / déclarer", confirm, "?", "var(--confirm)")}
<p class="sum">${ok.length} en place · ${todo.length} à mettre en place · ${confirm.length} à confirmer</p>
<footer>Document DPO complet : outil rgpd-audit · ${esc(cfg.appName || path.basename(repo))} · ${date}</footer></div></body></html>`;
    fs.writeFileSync(path.join(repo, "rgpd-report.html"), html);
    console.log("  Rapport écrit : rgpd-report.html");
  } catch {}
}

process.exit(0); // ne bloque jamais
