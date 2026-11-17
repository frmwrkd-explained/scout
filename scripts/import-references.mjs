#!/usr/bin/env node
// scripts/import-references.mjs — an Airtable snapshot → the `references` collection of ONE workspace.
//
//   node scripts/import-references.mjs --snapshot <file.json> --workspace <folder> --dry-run
//   node scripts/import-references.mjs --snapshot <file.json> --workspace <folder>
//
// --snapshot    { records: [{ id, fields }] } as Airtable's API or its connector returns it
//               (optionally with `base` and `table` ids, which become provenance on every record).
// --workspace   the Scout workspace folder to import into. REQUIRED, and never guessed: this
//               script will not fall back to the repo's own workspace/ or to a config.md pointer.
// --dry-run     reads and maps everything, writes nothing, downloads nothing.
// --limit N     import at most N records this run (the rest stay for the next run).
// --report F    also write the full report as JSON to F.
//
// Safe to run twice: a record is recognised by its Airtable id and left alone; only a missing
// image is filled in. It never writes to Airtable — it has no token and no client.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function arg(name, fallback = null) {
  const at = process.argv.indexOf('--' + name);
  if (at < 0) return fallback;
  const value = process.argv[at + 1];
  return !value || value.startsWith('--') ? true : value;
}

const snapshotFile = arg('snapshot');
const workspace = arg('workspace');
const dryRun = !!arg('dry-run', false);
const limit = arg('limit') ? Number(arg('limit')) : null;
const reportFile = arg('report');

if (typeof snapshotFile !== 'string' || typeof workspace !== 'string') {
  console.error('usage: node scripts/import-references.mjs --snapshot <file.json> --workspace <folder> [--dry-run] [--limit N] [--report file.json]');
  process.exit(2);
}
const root = path.resolve(workspace);
if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
  console.error('No such workspace folder: ' + root + '\nCreate it first (an empty folder is a valid new workspace) — this script does not invent one.');
  process.exit(2);
}

// The store resolves its root when it is first imported, and a `config.md` pointer beats the env
// var. Point both at exactly what was asked for BEFORE the backend loads, so nothing on this
// machine can redirect the import into a different workspace.
process.env.SCOUT_DATA = root;
process.env.SCOUT_CONFIG = path.join(os.tmpdir(), 'scout-import-no-pointer-' + process.pid + '.md');
process.env.SCOUT_NO_LISTEN = '1';

const { previewReferences, importReferences, FIELD_MAP } = await import('../backend/referenceImport.mjs');
const { getStorageRoot } = await import('../backend/store.mjs');
if (path.resolve(getStorageRoot()) !== root) {
  console.error('Refusing to run: the store resolved ' + getStorageRoot() + ', not ' + root);
  process.exit(1);
}

const snapshot = JSON.parse(fs.readFileSync(path.resolve(snapshotFile), 'utf8'));
const preview = previewReferences({ snapshot });
const c = preview.counts;
const mb = bytes => (bytes / 1024 / 1024).toFixed(1) + ' MB';

console.log('Workspace   ' + preview.workspace);
console.log('Source      Airtable base ' + (preview.source.base || '?') + ' · table ' + (preview.source.table || '?'));
console.log('');
console.log('Field mapping');
for (const [from, to, note] of FIELD_MAP) console.log('  ' + from.padEnd(34).slice(0, 34) + ' → ' + to.padEnd(17) + note);
console.log('');
console.log('Records     ' + c.records + ' in the snapshot · ' + c.importable + ' importable · ' + c.rejected + ' rejected');
console.log('            ' + c.already_imported + ' already in this workspace · ' + c.to_repair + ' of those missing an image');
console.log('With image  ' + c.with_image + ' (' + mb(c.image_bytes) + ' incl. ' + c.with_generated_image + ' generated images)');
console.log('With prompt ' + c.with_prompt);
console.log('By category ' + Object.entries(c.by_category).sort((a, b) => b[1] - a[1]).map(([k, n]) => k + ' ' + n).join(' · '));
for (const r of preview.rejected) console.log('  rejected  ' + (r.id || r.airtable_id) + ' — ' + r.reason);

if (dryRun) {
  console.log('\nSample records');
  const step = Math.max(1, Math.floor(preview.items.length / 10));
  for (const item of preview.items.filter((_, i) => i % step === 0).slice(0, 10)) {
    const f = item.fields;
    console.log('  ' + item.id + '  ' + (f.category || '(none)').padEnd(18) + ' ' + f.name);
    console.log('           tags: ' + (f.tags || []).join(', ') + ' · image: ' + (item.attachments.image ? item.attachments.image.type + ' ' + Math.round(item.attachments.image.size / 1024) + ' KB' : 'none')
      + ' · prompt: ' + (f.prompt ? f.prompt.length + ' chars' : 'none'));
  }
  if (reportFile) fs.writeFileSync(path.resolve(reportFile), JSON.stringify({ ...preview, items: preview.items.map(({ attachments, ...item }) => ({ ...item, attachments: Object.keys(attachments) })) }, null, 2));
  console.log('\nDry run — nothing was written and nothing was downloaded.');
  process.exit(0);
}

let lastTick = 0;
const report = await importReferences({ snapshot, previewHash: preview.hash, limit }, {
  onProgress: (done, total) => {
    if (done === total || Date.now() - lastTick > 2000) { lastTick = Date.now(); process.stdout.write('\r  downloading ' + done + ' / ' + total + '   '); }
  },
});
process.stdout.write('\n');
console.log('Imported    ' + report.created + ' new · ' + report.repaired + ' repaired · ' + report.skipped + ' skipped (already here)');
console.log('Files       ' + mb(report.files.written_bytes) + ' written to ' + path.join(root, report.files.dir) + ' · ' + report.files.reused + ' already present');
console.log('Records     ' + path.join(root, report.records_dir));
if (report.remaining) console.log('Remaining   ' + report.remaining + ' (run again without --limit)');
for (const f of report.failed_downloads) console.log('  download failed  ' + f.id + ' ' + f.field + ' — ' + f.error);
for (const r of report.refused) console.log('  refused  ' + r.id + ' — ' + r.error);
if (reportFile) fs.writeFileSync(path.resolve(reportFile), JSON.stringify(report, null, 2));
process.exit(report.failed_downloads.length || report.refused.length ? 1 : 0);
