// The asset-kind folder vocabulary — WHICH folders are production assets, and which kind each is.
//
// This used to live in `frontend/AssetBoards.jsx`, which made it unreachable from the backend: a
// .jsx module drags JSX and browser globals into anything that imports it, and `backend/board.mjs`
// needs the same answer to group a board by cast / location / wardrobe / props. Moving it here is
// the same move `shared/chatTools.mjs` and `shared/integrations.mjs` made, and for the same reason:
// read on both sides, so it must never fork into two drifting copies.
//
// AssetBoards.jsx now RE-EXPORTS these. It is a facade, not a second declaration — do not
// re-declare the table there, and do not add a rival one anywhere else.

// Matched case-insensitively against real folder names, so a filmmaker's `Characters/` and
// `cast/` land on the same board without anyone configuring anything.
export const ASSET_KIND_FOLDERS = [
  { id: 'cast', label: 'Cast', match: /^(cast|talent|characters?|people|actors?)$/i },
  { id: 'locations', label: 'Locations', match: /^(locations?|places?|sets?|environments?)$/i },
  { id: 'wardrobe', label: 'Wardrobe', match: /^(wardrobe|costumes?|outfits?)$/i },
  { id: 'props', label: 'Props', match: /^(props?|objects?)$/i }
];

export const assetKindIds = ASSET_KIND_FOLDERS.map(k => k.id);
export const assetKindDef = id => ASSET_KIND_FOLDERS.find(k => k.id === id) || null;

// folder name → kind id, or '' when the folder is a reference board rather than a production one.
// `overrides` is the per-folder classification the user set by hand (context/_folders.md via
// backend/memory.mjs) and it wins, exactly as it does on the Assets tab.
export function assetKindOf(folder, overrides = {}) {
  const name = String(folder || '');
  if (overrides[name] === 'reference') return '';
  const hit = ASSET_KIND_FOLDERS.find(k => k.match.test(name));
  if (hit) return hit.id;
  // an explicit 'asset' override on an unrecognised folder is a real production board with a name
  // we have no token for — group it under its own folder name rather than dropping it
  return overrides[name] === 'asset' ? name.toLowerCase() : '';
}

// The References/Assets split. `folderKind` keeps its original name and contract because
// AssetBoards.jsx and References.jsx both call it.
export function folderKind(name, overrides = {}) {
  if (overrides[name] === 'asset' || overrides[name] === 'reference') return overrides[name];
  return ASSET_KIND_FOLDERS.some(k => k.match.test(name)) ? 'asset' : 'reference';
}
export const assetFoldersOf = (folders, ov = {}) => folders.filter(f => folderKind(f, ov) === 'asset');
export const refFoldersOf = (folders, ov = {}) => folders.filter(f => folderKind(f, ov) === 'reference');
