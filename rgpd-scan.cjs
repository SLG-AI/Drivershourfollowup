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
process.exit(0); // ne bloque jamais
