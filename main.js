'use strict';
/*
 * Sidebar Modes v1.0.0 – plain JavaScript Obsidian plugin (no build step).
 *
 * ONE panel, THREE modes (buttons at the top):
 *   School  – every subfolder of SCHOOL_FOLDER is a subject (tab). Inside: chapters (cards, only one
 *             open at a time) with sub-notes. "+ New sub-note" creates e.g. "03.8 Title".
 *   Other   – a small file manager for everything that is not school (Inbox, Music, Personal, …).
 *   System  – the same file manager, rooted in SYSTEM_FOLDER (Templates, Archive, Attachments).
 *
 * HOW A PLUGIN WORKS:  Obsidian calls `onload()` once → we register a View (the panel), commands and
 * vault events. The View has `contentEl` (a normal HTML element); `render()` empties it and builds the
 * DOM again from the current state. Data comes from `app.vault` (files/folders).
 *
 * WHERE TO TWEAK: the constants right below. After editing: Cmd+P → "Reload app without saving".
 */
const {
  Plugin, ItemView, MarkdownRenderer, Modal, FuzzySuggestModal, Menu, Notice, TFile, TFolder, Keymap,
  setIcon, normalizePath, debounce, PluginSettingTab, Setting,
} = require('obsidian');
const { AbstractInputSuggest, getIconIds } = require('obsidian');   // newer API: optional, the settings page works without it

const VIEW_TYPE = 'sidebar-modes-view';
const OVERVIEW_HEADING = '## Sub-notes';       // list of sub-notes in every chapter overview
const OVERVIEW_HEADINGS = [OVERVIEW_HEADING];


// ---- 1) CONFIG ----------------------------------------------------------------------------
/* These are the DEFAULTS. Everything in this block can be changed in Settings > Sidebar Modes
 * (no code editing needed). applySettings() below copies the saved values into these variables. */
const DEFAULT_SETTINGS = {
  schoolFolder: 'School',            // subfolders of this = subjects (tabs)
  otherFolder: 'Personal',          // the "Other" mode starts here (its sub-folders become the big tiles)
  systemFolder: 'System',            // shown in the "System" mode
  archiveFolder: 'System/Archive',   // where "Archive" sends things
  maxRows: 200,                        // a folder with more items (Attachments!) is cut off after this
  modeSchool: 'School', modeOther: 'Other', modeSystem: 'System',   // labels of the 3 mode buttons
  cs1Name: 'LaTeX Cheat Sheet',    cs1Title: 'LaTeX',    cs1Icon: 'sigma',   // pop-up note buttons (empty name = no button)
  cs2Name: 'Markdown Cheat Sheet', cs2Title: 'Markdown', cs2Icon: 'hash',
  cs3Name: 'Hotkeys Cheat Sheet',  cs3Title: 'Hotkeys',  cs3Icon: 'keyboard',
  autoOverviews: true,                 // create/refresh the "Overview" note of every chapter
  openOnStart: true,                   // open the panel in the sidebar when Obsidian starts
  // --- general
  startMode: 'last',                   // 'last' | 'skola' | 'ostatni' | 'system'
  showSearch: true,                    // the search field under the mode buttons
  density: 'comfortable',              // 'comfortable' | 'compact'
  animations: 'system',                // 'system' (follow OS) | 'on' | 'off'
  confirmDelete: true,                 // ask before moving things to the trash
  // --- modes (name = modeSchool/modeOther/modeSystem above)
  modeSchoolIcon: 'graduation-cap', modeSchoolColor: '#6188ff', modeSchoolShow: true,
  modeOtherIcon: 'folder-open',     modeOtherColor: '#c4a7ff',  modeOtherShow: true,
  modeSystemIcon: 'settings',       modeSystemColor: '#8e9aaf', modeSystemShow: true,
  // --- school mode
  showHero: true, showHeroStats: true, showChapterCounts: true, showPinned: true,
  overviewLabel: 'Overview',           // label of the overview row inside a chapter
  allowManyOpen: false,                // several chapters open at once
  autoOpenActive: false,               // unfold the chapter of the note you open
  rememberLastNote: true,              // switching subject reopens the last note there
  autoNumber: true,                    // new notes in a chapter get the next number
  // --- other / system
  bigTiles: true, showTimes: true, showOtherFiles: true,
};
let SCHOOL_FOLDER, SYSTEM_FOLDER, ARCHIVE_FOLDER, OTHER_FOLDER, PROTECTED, MAX_ROWS, CHEATSHEETS;
let CFG = DEFAULT_SETTINGS;   // the live settings object (set by applySettings)

const MODES = [
  { id: 'skola',   name: 'School',  icon: 'graduation-cap', color: '#6188ff' },
  { id: 'ostatni', name: 'Other',   icon: 'folder-open',    color: '#c4a7ff' },
  { id: 'system',  name: 'System',  icon: 'settings',       color: '#8e9aaf' },
];

// icon + colour by folder name (number prefix ignored). Unknown folders get a fallback colour.
// Icons are Lucide names – browse them at https://lucide.dev
const STYLES = {
  'Inbox':           { icon: 'inbox',    color: '#9aa0a6' },
  'Physics':         { icon: 'atom',     color: '#6188ff' },
  'Mathematics':     { icon: 'sigma',    color: '#ffb454' },
  'Networks':        { icon: 'network',  color: '#9be37a' },
  'Cybersecurity':   { icon: 'shield',   color: '#ff6b6b' },
  'Literature':      { icon: 'book-a',   color: '#ffdd94' },
  'Economics':       { icon: 'coins',    color: '#5fd7c0' },
  'Music':           { icon: 'music',    color: '#f28bf9' },
  'Personal':        { icon: 'heart',    color: '#ff7a93' },
  'Projects':        { icon: 'rocket',   color: '#5fd7c0' },
};
// choices offered in the "Icon and colour" dialog (any other Lucide name can be typed in too)
const SWATCHES = ['#ff6b6b', '#ff9f5a', '#ffd166', '#9be37a', '#5fd7c0', '#6188ff', '#bb9af7', '#f28bf9', '#ff7a93', '#9aa0a6'];
const ICON_CHOICES = [
  'file-text', 'book-open', 'book', 'bookmark', 'star', 'flame', 'zap', 'lightbulb', 'target', 'flag', 'pin', 'heart',
  'atom', 'sigma', 'calculator', 'ruler', 'flask-conical', 'microscope', 'telescope', 'rocket', 'orbit', 'satellite',
  'brain', 'cpu', 'code', 'terminal', 'database', 'network', 'shield', 'lock', 'key', 'globe', 'map', 'music',
  'headphones', 'mic', 'camera', 'image', 'film', 'gamepad-2', 'trophy', 'graduation-cap', 'pencil', 'clipboard-list',
  'list-checks', 'calendar', 'clock', 'bell', 'mail', 'folder', 'archive', 'inbox', 'settings', 'wrench', 'sun', 'moon',
  'cloud', 'leaf', 'coins', 'shopping-cart', 'gift', 'smile', 'car', 'plane',
  // physics & math
  'magnet', 'battery-charging', 'plug', 'plug-zap', 'waves', 'activity', 'radio', 'radiation', 'thermometer', 'gauge',
  'compass', 'triangle', 'square', 'circle', 'pi', 'percent', 'infinity', 'function-square', 'variable', 'binary',
  'chart-line', 'chart-bar', 'chart-pie', 'scale', 'move-3d', 'axis-3d', 'rotate-3d', 'drafting-compass', 'ruler-dimension-line', 'lamp',
  // school
  'school', 'library', 'notebook', 'notebook-pen', 'file-pen', 'highlighter', 'eraser', 'languages', 'book-a', 'book-marked',
  'scroll-text', 'file-question', 'circle-help', 'award', 'medal', 'brain-circuit', 'puzzle', 'dices', 'hourglass', 'timer',
  // IT & networking
  'server', 'router', 'wifi', 'cable', 'hard-drive', 'monitor', 'laptop', 'smartphone', 'bug', 'git-branch',
  'braces', 'file-code', 'folder-code', 'shield-check', 'fingerprint', 'scan-eye', 'cloud-cog', 'bot', 'sparkles', 'wand-sparkles',
  // music & media
  'guitar', 'piano', 'drum', 'disc-3', 'audio-lines', 'volume-2', 'play', 'video', 'clapperboard', 'palette',
  // life & places
  'house', 'building-2', 'map-pin', 'bike', 'bus', 'train-front', 'utensils', 'coffee', 'pizza', 'dumbbell',
  'heart-pulse', 'baby', 'users', 'user', 'message-circle', 'phone', 'plane-takeoff', 'tent', 'mountain', 'snowflake',
  'umbrella', 'wallet', 'receipt', 'piggy-bank', 'tag', 'tags', 'link', 'paperclip', 'hash', 'at-sign',
];
const FALLBACK_COLORS = ['#7aa2f7', '#e0af68', '#9ece6a', '#bb9af7', '#f7768e', '#7dcfff'];

/** Copy saved settings into the module variables the rest of the code reads. Safe to call again any time. */
function applySettings(st) {
  const folder = (v, d) => normalizePath((v || '').trim() || d).replace(/^\/+|\/+$/g, '') || d;
  SCHOOL_FOLDER  = folder(st.schoolFolder,  DEFAULT_SETTINGS.schoolFolder);
  OTHER_FOLDER   = folder(st.otherFolder,   DEFAULT_SETTINGS.otherFolder);
  SYSTEM_FOLDER  = folder(st.systemFolder,  DEFAULT_SETTINGS.systemFolder);
  ARCHIVE_FOLDER = folder(st.archiveFolder, DEFAULT_SETTINGS.archiveFolder);
  PROTECTED = new Set([SCHOOL_FOLDER, SYSTEM_FOLDER, OTHER_FOLDER]);   // no rename/move/delete for these
  MAX_ROWS = Math.max(20, +st.maxRows || DEFAULT_SETTINGS.maxRows);
  CFG = st;
  for (const [m, K] of [[MODES[0], 'School'], [MODES[1], 'Other'], [MODES[2], 'System']]) {
    m.name  = (st['mode' + K] || '').trim() || DEFAULT_SETTINGS['mode' + K];
    m.icon  = (st['mode' + K + 'Icon'] || '').trim() || DEFAULT_SETTINGS['mode' + K + 'Icon'];
    m.color = /^#[0-9a-f]{6}$/i.test(st['mode' + K + 'Color'] || '') ? st['mode' + K + 'Color'] : DEFAULT_SETTINGS['mode' + K + 'Color'];
    m.show  = st['mode' + K + 'Show'] !== false;
  }
  CHEATSHEETS = [1, 2, 3]
    .map((i) => ({ name: (st[`cs${i}Name`] || '').trim(), title: (st[`cs${i}Title`] || '').trim() || (st[`cs${i}Name`] || '').trim(), icon: (st[`cs${i}Icon`] || '').trim() || 'file-text' }))
    .filter((c) => c.name);
}
applySettings(DEFAULT_SETTINGS);   // sensible values until the saved ones are loaded in onload()

/** The modes that are switched on in Settings (at least one is always left). */
const visibleModes = () => { const v = MODES.filter((m) => m.show !== false); return v.length ? v : [MODES[0]]; };
/** True when animations should be skipped (setting, or the system asks for reduced motion). */
const motionOff = () => CFG.animations === 'off' || (CFG.animations !== 'on' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

// ---- 2) SMALL HELPERS (pure functions, no Obsidian needed) ---------------------------------
/** Sort by name, numbers compared as numbers ("2" before "10"). */
const byName = (a, b) =>
  (a.basename ?? a.name).localeCompare(b.basename ?? b.name, 'en', { numeric: true });

/** "03 Magnetic Field" -> "Magnetic Field" (the number only exists for sorting). */
const cleanName = (name) => name.replace(/^\d+\s+/, '');

const styleFor = (name, i = 0) =>
  STYLES[cleanName(name)] ?? { icon: 'folder', color: FALLBACK_COLORS[i % FALLBACK_COLORS.length] };

/** All markdown notes inside a folder, including sub-folders (recursion). */
function collectNotes(folder) {
  let out = [];
  for (const child of folder.children) {
    if (child instanceof TFolder) out = out.concat(collectNotes(child));
    else if (child.extension === 'md') out.push(child);
  }
  return out;
}

/** Number of files of any type inside a folder (recursive). */
function countFiles(folder) {
  let n = 0;
  for (const child of folder.children) n += child instanceof TFolder ? countFiles(child) : 1;
  return n;
}

const plural = (n, one, many) => (n === 1 ? one : many);

/** "5 min ago", "yesterday" … */
function ago(ms) {
  const min = Math.floor((Date.now() - ms) / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  if (d === 1) return 'yesterday';
  if (d < 30) return `${d} days ago`;
  const mo = Math.floor(d / 30);
  return mo < 12 ? `${mo} mo ago` : 'over a year ago';
}

const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'heic', 'bmp'];
function fileIcon(file) {
  if (file.extension === 'md') return 'file-text';
  if (IMAGE_EXT.includes(file.extension.toLowerCase())) return 'image';
  return 'file';
}

/** Remove characters Obsidian does not allow in file names. */
const cleanTitle = (t) => t.trim().replace(/[\\/:*?"<>|#^\[\]]/g, '');

/**
 * Prefix for a new note.
 *  chapter=true : folder "03 Magnetic Field" -> next "03.8" (highest existing "03.x" + 1)
 *  chapter=false: notes directly in a subject -> next "04" (highest existing "NN " + 1)
 * Returns '' when nothing is numbered, so un-numbered folders stay un-numbered.
 */
function nextPrefix(folder, chapter) {
  const notes = folder.children.filter((c) => c instanceof TFile && c.extension === 'md');
  if (chapter) {
    const m = folder.name.match(/^(\d+)\s/);
    if (!m) return '';
    const re = new RegExp(`^${m[1]}\\.(\\d+)\\s`);
    let max = 0;
    for (const n of notes) { const x = n.basename.match(re); if (x) max = Math.max(max, +x[1]); }
    return `${m[1]}.${max + 1}`;
  }
  let max = 0, any = false;
  for (const n of notes) { const x = n.basename.match(/^(\d+)\s/); if (x) { any = true; max = Math.max(max, +x[1]); } }
  return any ? String(max + 1).padStart(2, '0') : '';
}

// ---- 3) THE PANEL --------------------------------------------------------------------------
class SubjectView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.openTopics = new Set();            // paths of the open chapter cards (one, or several when allowed in Settings)
    this.lastAutoPath = null;               // note whose chapter was last unfolded automatically
    this.browse = { ostatni: null, system: null }; // current folder in each file-manager mode
    this.editing = false;                   // true while an inline "new…" input is on screen
    this.query = '';                        // text in the search field
    this.searchFocus = false;               // true while the search field has focus (blocks re-render so typing isn't interrupted)
    this.dragPath = null;                   // path of the note/folder being dragged
  }
  getViewType() { return VIEW_TYPE; }
  getDisplayText() { return 'Sidebar Modes'; }
  getIcon() { return 'layout-grid'; }
  async onOpen() { this.render(); }

  /** Rebuild the whole panel. Cheap enough to do on every change. */
  render() {
    if (this.editing || this.searchFocus) return;   // never wipe an input the user is typing in
    const el = this.contentEl;
    const scroll = el.scrollTop;
    el.addClass('ss-root');
    el.toggleClass('ss-compact', CFG.density === 'compact');
    el.toggleClass('ss-no-motion', motionOff());
    const mode = this.plugin.mode();
    // Direction of travel, so the content can slide the way you moved:
    //   position = (mode index, then subject index / folder depth); bigger than before -> enters from the right.
    let inner = 0;
    if (mode.id === 'skola') {
      const sr = this.app.vault.getAbstractFileByPath(SCHOOL_FOLDER);
      const names = sr instanceof TFolder ? sr.children.filter((c) => c instanceof TFolder).sort(byName).map((f) => f.name) : [];
      inner = Math.max(0, names.indexOf(this.plugin.data.current));
    } else {
      inner = (this.browse[mode.id] || '').split('/').filter(Boolean).length;
    }
    const pos = MODES.findIndex((m) => m.id === mode.id) * 1000 + inner;
    const dir = this.lastPos == null || pos === this.lastPos ? '' : pos > this.lastPos ? 'ss-from-right' : 'ss-from-left';
    this.lastPos = pos;

    // "Carousel": before the panel is rebuilt, keep a picture (clone) of the OLD content (everything below the
    // tab bar / breadcrumb row). After the rebuild it slides out while the new content slides in.
    let ghostNodes = null, ghostTop = 0;
    if (dir && !motionOff()) {
      const kids = [...el.children];
      let ai = -1;
      kids.forEach((c, i) => { if (c.matches('.ss-pills, .ss-crumbs')) ai = i; });
      if (ai < 0) kids.forEach((c, i) => { if (c.matches('.ss-search')) ai = i; });
      const old = kids.slice(ai + 1).filter((c) => !c.matches('.ss-results'));
      if (ai >= 0 && old.length) { ghostTop = old[0].offsetTop; ghostNodes = old.map((c) => c.cloneNode(true)); }
    }

    el.empty();
    el.removeClass('ss-from-right'); el.removeClass('ss-from-left');
    if (dir) el.addClass(dir);
    el.style.setProperty('--ss-accent', mode.color);
    this.renderModes(el, mode);
    if (CFG.showSearch) this.renderSearch(el);
    if (mode.id === 'skola') this.renderSchool(el);
    else this.renderBrowser(el, mode);
    el.scrollTop = scroll;

    if (ghostNodes) {                                      // the old content glides out the opposite way
      const ghost = el.createDiv('ss-ghost');
      ghost.style.top = ghostTop + 'px';
      ghostNodes.forEach((n) => ghost.appendChild(n));
      const out = dir === 'ss-from-right' ? '-22px' : '22px';
      ghost.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: `translateX(${out})` }],
        { duration: 160, easing: 'cubic-bezier(.4,0,.6,1)', fill: 'forwards' }).onfinish = () => ghost.remove();
    }
  }

  // ---------- search: a small field under the mode buttons ----------
  renderSearch(el) {
    const wrap = el.createDiv('ss-search');
    setIcon(wrap.createSpan('ss-search-icon'), 'search');
    const input = wrap.createEl('input', { type: 'text', cls: 'ss-search-input', attr: { placeholder: 'Search…', spellcheck: 'false' } });
    input.value = this.query;
    const results = el.createDiv('ss-results');
    const run = () => { this.query = input.value; this.fillResults(el, results); };
    input.addEventListener('input', run);
    input.addEventListener('focus', () => { this.searchFocus = true; });
    input.addEventListener('blur', () => { this.searchFocus = false; });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { input.value = ''; run(); input.blur(); }
      else if (e.key === 'Enter' && this.firstResult) this.plugin.openNote(this.firstResult, e);
    });
    if (this.query) this.fillResults(el, results);
  }

  /** Notes of the current mode whose NAME contains the text (ignores case and diacritics). */
  fillResults(root, results) {
    results.empty();
    this.firstResult = null;
    const norm = (t) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const q = norm(this.query.trim());
    root.toggleClass('ss-searching', !!q);
    if (!q) return;
    const mode = this.plugin.mode();
    const base = mode.id === 'skola' ? SCHOOL_FOLDER : mode.id === 'system' ? SYSTEM_FOLDER : OTHER_FOLDER;
    const inBase = (f) => !base || base === '/' || f.path.startsWith(base + '/');
    const hits = this.app.vault.getMarkdownFiles()
      .filter((f) => inBase(f) && norm(f.basename).includes(q))
      .sort((a, b) => b.stat.mtime - a.stat.mtime)
      .slice(0, 30);
    if (!hits.length) { results.createDiv({ cls: 'ss-empty', text: 'No results found.' }); return; }
    this.firstResult = hits[0];
    const activePath = this.app.workspace.getActiveFile()?.path;
    const list = results.createDiv('ss-list');
    for (const f of hits) {
      const row = this.noteRow(list, f, f.basename, activePath, null, true);
      row.createSpan({ cls: 'ss-time', text: cleanName(f.parent.name) });
    }
  }

  // ---------- drag & drop: drag a note/folder onto a folder, chapter, subject or breadcrumb ----------
  dragSource(el, file) {
    el.setAttr('draggable', 'true');
    el.addEventListener('dragstart', (e) => {
      this.dragPath = file.path;
      e.dataTransfer.setData('application/x-ss-path', file.path);   // custom type: dropping into a note won't paste text
      e.dataTransfer.effectAllowed = 'move';
      el.addClass('is-dragging');
    });
    el.addEventListener('dragend', () => {
      this.dragPath = null;
      el.removeClass('is-dragging');
      this.contentEl.querySelectorAll('.ss-drop').forEach((x) => x.removeClass('ss-drop'));
    });
  }

  dropTarget(el, folder) {
    const source = () => {
      const src = this.dragPath && this.app.vault.getAbstractFileByPath(this.dragPath);
      if (!src || src.parent === folder) return null;                                   // already there
      if (src instanceof TFolder && (folder.path === src.path || folder.path.startsWith(src.path + '/'))) return null;   // folder into itself
      return src;
    };
    el.addEventListener('dragover', (e) => { if (!source()) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; el.addClass('ss-drop'); });
    el.addEventListener('dragleave', (e) => { if (!el.contains(e.relatedTarget)) el.removeClass('ss-drop'); });
    el.addEventListener('drop', async (e) => {
      const src = source();
      el.removeClass('ss-drop');
      if (!src) return;
      e.preventDefault();
      e.stopPropagation();
      await this.plugin.moveTo(src, folder);
    });
  }

  // ---------- top: the three mode buttons ----------
  renderModes(el, mode) {
    const bar = el.createDiv('ss-modes');
    for (const m of visibleModes()) {
      const b = bar.createDiv({ cls: 'ss-mode' + (m.id === mode.id ? ' is-active' : '') });
      b.style.setProperty('--ss-m', m.color);
      setIcon(b.createSpan('ss-mode-icon'), m.icon);
      b.createSpan({ text: m.name });
      b.addEventListener('click', () => this.plugin.setMode(m.id));
    }
  }

  /** "Pinned": pinned notes that belong to the current mode, always right under the mode buttons. */
  renderPinned(el, mode, scope) {
    if (!CFG.showPinned) return;
    // a pin belongs to the folder the note lives in: shown only while you are in that folder (or, in School, in that subject)
    const here = (f) => scope.folder ? f.parent === scope.folder : f.path.startsWith(scope.prefix);
    const files = this.plugin.data.pinned
      .map((path) => this.app.vault.getAbstractFileByPath(path))
      .filter((f) => f instanceof TFile && this.plugin.modeOfPath(f.path) === mode.id && here(f));
    if (!files.length) return;
    const title = el.createDiv({ cls: ['ss-section-title', 'ss-pinned-title'] });
    setIcon(title.createSpan('ss-pin'), 'pin');
    title.createSpan({ text: 'Pinned' });
    const list = el.createDiv({ cls: ['ss-list', 'ss-pinned'] });
    const activePath = this.app.workspace.getActiveFile()?.path;
    for (const f of files) {
      const row = this.noteRow(list, f, f.basename, activePath, null, true);
      if (scope.prefix && !PROTECTED.has(f.parent.path)) row.createSpan({ cls: 'ss-time', text: cleanName(f.parent.name) });   // where the note lives (skipped when it is just the mode's root folder)
    }
  }

  // ======================= MODE: SCHOOL =======================
  renderSchool(el) {
    const root = this.app.vault.getAbstractFileByPath(SCHOOL_FOLDER);
    const subjects = root instanceof TFolder ? root.children.filter((c) => c instanceof TFolder).sort(byName) : [];
    if (!subjects.length) {
      el.createDiv({ cls: 'ss-empty', text: `There are no subjects in the folder "${SCHOOL_FOLDER}".` });
      return;
    }
    const subj = subjects.find((f) => f.name === this.plugin.data.current) ?? subjects[0];
    const st = { ...styleFor(subj.name, subjects.indexOf(subj)), ...this.plugin.custom(subj.path) };
    el.style.setProperty('--ss-accent', st.color);

    // subject tabs. The bar is built ONCE and then only updated in place: rebuilding it on every click
    // made the tabs blink. Changing the active tab = move the highlight + shrink the old tab (animated).
    const styles = subjects.map((f, i) => ({ ...styleFor(f.name, i), ...this.plugin.custom(f.path) }));
    const key = subjects.map((f, i) => f.path + '|' + styles[i].color + '|' + styles[i].icon).join(';');
    const ease = 'cubic-bezier(.22,.61,.36,1)';
    const reduce = motionOff();
    let bar = this.pillBar;
    if (bar && this.pillKey === key) {
      el.appendChild(bar);                                              // reuse the existing bar
      this.roIgnoreUntil = performance.now() + 150;                     // re-attaching makes the size observer fire: ignore that
      const pills = [...bar.querySelectorAll('.ss-pill')];
      const before = pills.map((p) => p.offsetWidth);
      pills.forEach((p, i) => {
        const active = subjects[i] === subj;
        p.toggleClass('is-active', active);
        const label = p.querySelector('.ss-pill-label');
        if (active && !label) {
          const l = p.createSpan({ cls: 'ss-pill-label', text: cleanName(subjects[i].name) });
          if (!reduce) l.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, delay: 60, easing: ease, fill: 'backwards' });
        }
        if (!active && label) label.remove();
      });
      const ind = bar.querySelector('.ss-pill-ind');
      const act = bar.querySelector('.ss-pill.is-active');
      if (ind && act) {                                                 // CSS transition glides it to the new tab
        ind.style.left = act.offsetLeft + 'px'; ind.style.width = act.offsetWidth + 'px';
        ind.style.backgroundColor = `color-mix(in srgb, ${styles[subjects.indexOf(subj)].color} 20%, transparent)`;
      }
      pills.forEach((p, i) => {                                         // the tab that lost its label shrinks smoothly
        const w = p.offsetWidth;
        if (!reduce && before[i] - w > 2) p.animate([{ width: before[i] + 'px' }, { width: w + 'px' }], { duration: 220, easing: ease });
      });
    } else {
      bar = el.createDiv('ss-pills');
      subjects.forEach((f, i) => {
        const active = f === subj;
        const pill = bar.createDiv({ cls: 'ss-pill' + (active ? ' is-active' : ''), attr: { 'aria-label': cleanName(f.name) } });
        pill.style.setProperty('--ss-c', styles[i].color);
        setIcon(pill.createSpan('ss-pill-icon'), styles[i].icon);
        if (active) pill.createSpan({ cls: 'ss-pill-label', text: cleanName(f.name) });
        pill.addEventListener('click', () => this.plugin.setSubject(f.name));
        this.ctx(pill, f);
        this.dropTarget(pill, f);
      });
      const ind = bar.createDiv('ss-pill-ind');
      const act = bar.querySelector('.ss-pill.is-active');
      if (act) {
        ind.style.left = act.offsetLeft + 'px'; ind.style.width = act.offsetWidth + 'px';
        ind.style.backgroundColor = `color-mix(in srgb, ${styles[subjects.indexOf(subj)].color} 20%, transparent)`;
      }
      // if the bar gets narrower/wider (scrollbar, resizing the sidebar), snap the highlight without animating
      let first = true;
      new ResizeObserver(() => {
        if (first) { first = false; return; }
        if (performance.now() < (this.roIgnoreUntil || 0)) return;
        const a = bar.querySelector('.ss-pill.is-active');
        if (!a) return;
        ind.style.transition = 'none';
        ind.style.left = a.offsetLeft + 'px'; ind.style.width = a.offsetWidth + 'px';
        void ind.offsetWidth;
        ind.style.transition = '';
      }).observe(bar);
      this.pillBar = bar; this.pillKey = key;
    }

    const notes = collectNotes(subj);
    const recent = [...notes].sort((a, b) => b.stat.mtime - a.stat.mtime);
    if (CFG.showHero) this.renderHero(el, subj, st, notes, recent);
    this.renderPinned(el, this.plugin.mode(), { prefix: subj.path + '/' });   // pins of the open subject, right under its header
    this.renderTopics(el, subj);
  }

  /** Big card: icon, name and note count. */
  renderHero(el, subj, st, notes, recent) {
    const hero = el.createDiv('ss-hero');
    const top = hero.createDiv('ss-hero-top');
    setIcon(top.createDiv('ss-hero-icon'), st.icon);
    const text = top.createDiv();
    text.createDiv({ cls: 'ss-hero-title', text: cleanName(subj.name) });
    const sub = notes.length
      ? `${notes.length} ${plural(notes.length, 'note', 'notes')} · ${ago(recent[0].stat.mtime)}`
      : 'nothing here yet';
    if (CFG.showHeroStats) text.createDiv({ cls: 'ss-hero-sub', text: sub });
  }

  /** Chapters = sub-folders of the subject (cards). Loose notes go in one last card. */
  renderTopics(el, subj) {
    el.createDiv({ cls: 'ss-section-title', text: 'Chapters' });
    const activePath = this.app.workspace.getActiveFile()?.path;
    const children = subj.children.filter((c) => c instanceof TFolder || c.extension === 'md').sort(byName);
    if (CFG.autoOpenActive && activePath && this.lastAutoPath !== activePath) {      // unfold the chapter of the note you just opened
      this.lastAutoPath = activePath;
      const ch = children.find((c) => c instanceof TFolder && activePath.startsWith(c.path + '/'));
      if (ch) { if (!CFG.allowManyOpen) this.openTopics.clear(); this.openTopics.add(ch.path); }
    }
    const loose = [];
    for (const child of children) {
      if (child instanceof TFile) { loose.push(child); continue; }
      this.topicCard(el, child, collectNotes(child).sort(byName), activePath);
    }
    // loose notes of the subject (e.g. Mathematics: "01 Combinatorics") + a button for a new one
    const body = el.createDiv('ss-topic').createDiv('ss-topic-body');
    this.dropTarget(body, subj);
    for (const f of this.plugin.pinFirst(loose)) this.noteRow(body, f, f.basename, activePath);
    this.newRow(body, {
      label: 'New note', icon: 'plus',
      onCreate: (title) => this.plugin.createNote(subj, title, 'loose'),
    });
  }

  /** One card per chapter. Only ONE card can be open: opening another one folds the previous. */
  topicCard(el, folder, notes, activePath) {
    const open = this.openTopics.has(folder.path);
    const card = el.createDiv({ cls: 'ss-topic' + (open ? ' is-open' : '') });
    const cs = this.plugin.custom(folder.path);
    if (cs.color) card.style.setProperty('--ss-accent', cs.color);
    const head = card.createDiv('ss-topic-head');
    const m = folder.name.match(/^(\d+)\s+(.*)$/);      // "03 Magnetic Field" -> ["03", "Magnetic Field"]
    const badge = head.createDiv({ cls: 'ss-topic-num', text: cs.icon ? '' : m ? m[1] : '•' });
    if (cs.icon) setIcon(badge, cs.icon);
    head.createDiv({ cls: 'ss-topic-title', text: m ? m[2] : folder.name });
    if (CFG.showChapterCounts) head.createSpan({ cls: 'ss-badge', text: String(notes.length) });
    setIcon(head.createSpan('ss-chevron'), 'chevron-right');
    head.addEventListener('click', () => {
      if (open) this.openTopics.delete(folder.path);
      else { if (!CFG.allowManyOpen) this.openTopics.clear(); this.openTopics.add(folder.path); }
      this.justOpened = open ? null : folder.path;     // remember which card to animate (the panel is rebuilt on every click)
      this.render();
      this.justOpened = null;
    });
    this.ctx(head, folder);
    this.dropTarget(card, folder);
    if (!open) return;

    // the note named like the folder is the overview -> show it first as "Overview"
    const overview = notes.find((n) => n.basename === folder.name);
    const body = card.createDiv('ss-topic-body');
    if (overview) this.noteRow(body, overview, CFG.overviewLabel || 'Overview', activePath, 'layout-list');
    for (const n of this.plugin.pinFirst(notes.filter((x) => x !== overview))) this.noteRow(body, n, n.basename, activePath);
    this.newRow(body, {
      label: 'New sub-note', icon: 'plus',
      onCreate: (title) => this.plugin.createNote(folder, title, 'chapter'),
    });

    // opening animation (only for the card you just clicked): the body grows from 0 to its real height,
    // so the cards below it are pushed down smoothly; the chevron turns at the same time.
    if (this.justOpened === folder.path && !motionOff()) {
      const h = body.offsetHeight;
      const opt = { duration: 200, easing: 'cubic-bezier(.22,.61,.36,1)' };
      body.style.overflow = 'hidden';
      body.animate([{ height: '0px', opacity: 0 }, { height: h + 'px', opacity: 1 }], opt)
        .onfinish = () => { body.style.overflow = ''; };
      const chev = head.querySelector('.ss-chevron svg');
      if (chev) chev.animate([{ transform: 'rotate(0deg)' }, { transform: 'rotate(90deg)' }], opt);
    }
  }

  // ======================= MODES: OTHER + SYSTEM (file manager) =======================
  renderBrowser(el, mode) {
    const vault = this.app.vault;
    const isSys = mode.id === 'system';
    const rootPath = isSys ? SYSTEM_FOLDER : OTHER_FOLDER;
    const rootFolder = vault.getAbstractFileByPath(rootPath);
    if (!(rootFolder instanceof TFolder)) {
      el.createDiv({ cls: 'ss-empty', text: `The folder "${rootPath}" does not exist.` });
      return;
    }
    const inside = (f) => rootFolder.isRoot() || f.path === rootFolder.path || f.path.startsWith(rootFolder.path + '/');
    let cur = this.browse[mode.id] ? vault.getAbstractFileByPath(this.browse[mode.id]) : rootFolder;
    if (!(cur instanceof TFolder) || !inside(cur)) cur = rootFolder;
    const atTop = cur.path === rootFolder.path;

    // accent colour = colour of the top-level folder you are in (Hudba pink, Projekty teal …)
    const topName = !isSys && !atTop ? cur.path.slice(rootFolder.path.length + 1).split('/')[0] : null;
    el.style.setProperty('--ss-accent', topName ? styleFor(topName).color : mode.color);

    // the sort toggle (and, inside a folder, the back button) live in one row with the search field
    const byNew = this.plugin.data.sort === 'new';
    // the sort toggle: small icon button, placed in the crumbs bar (inside a folder) or next to the "Notes" heading (top level)
    const addSortBtn = (parent) => {
      const btn = parent.createSpan({ cls: 'ss-sort', attr: { 'aria-label': byNew ? 'Sort: newest' : 'Sort: by name' } });
      setIcon(btn, byNew ? 'clock' : 'arrow-up-down');
      btn.addEventListener('click', () => this.plugin.toggleSort());
    };
    // at the top level there is no bar at all: the mode button above already says where you are
    if (!atTop) {
      const crumbs = el.createDiv('ss-crumbs');
      // no path any more: just a back button (one level up). Dropping a note on it moves the note up one level.
      const parent = cur.parent && inside(cur.parent) ? cur.parent : rootFolder;
      const back = crumbs.createDiv({ cls: 'ss-back', attr: { 'aria-label': 'Back' } });
      setIcon(back.createSpan('ss-back-icon'), 'chevron-left');
      back.addEventListener('click', () => { this.browse[mode.id] = parent.path; this.render(); });
      this.dropTarget(back, parent);
      // inside a folder ONE row:  [back]  [search field]  [sort]   (the search field is moved up into this row)
      const sw = el.querySelector(':scope > .ss-search');
      if (sw) { crumbs.appendChild(sw); const res = el.querySelector(':scope > .ss-results'); if (res) crumbs.after(res); }
      addSortBtn(crumbs);
    }

    // listing: folders first (by name), then files (by name or newest first)
    const folders = cur.children.filter((c) => c instanceof TFolder).sort(byName);
    let files = cur.children.filter((c) => c instanceof TFile && (CFG.showOtherFiles || c.extension === 'md'));
    files.sort(byNew ? (a, b) => b.stat.mtime - a.stat.mtime : byName);
    files = this.plugin.pinFirst(files);              // pinned notes always first

    // "Other" at the top: the folders become BIG TILES (Music, Projects …), notes go below them
    const bigTiles = atTop && !isSys && CFG.bigTiles && folders.length > 0;
    if (bigTiles) {
      const grid = el.createDiv('ss-tiles');
      folders.forEach((f, i) => {
        const st = { ...styleFor(f.name, i), ...this.plugin.custom(f.path) };
        const n = countFiles(f);
        const tile = grid.createDiv('ss-tile');
        tile.style.setProperty('--ss-c', st.color || mode.color);
        setIcon(tile.createDiv('ss-tile-icon'), st.icon);
        tile.createDiv({ cls: 'ss-tile-title', text: cleanName(f.name) });
        tile.createDiv({ cls: 'ss-tile-sub', text: `${n} ${plural(n, 'file', 'files')}` });
        tile.addEventListener('click', () => { this.browse[mode.id] = f.path; this.render(); });
        this.ctx(tile, f);
        this.dragSource(tile, f);
        this.dropTarget(tile, f);
      });
    }

    const activePath = this.app.workspace.getActiveFile()?.path;

    // 1) folders: already shown as big tiles at the top, otherwise as rows
    const folderRows = bigTiles ? [] : folders;
    if (folderRows.length) {
      const flist = el.createDiv('ss-list');
      folderRows.forEach((item, i) => {
        const st = { ...(atTop && !isSys ? styleFor(item.name, i) : { icon: 'folder', color: null }), ...this.plugin.custom(item.path) };
        const row = flist.createDiv('ss-row');
        const ic = row.createSpan({ cls: ['ss-row-icon', 'is-folder'] });
        setIcon(ic, st.icon);
        if (st.color) ic.style.color = st.color;
        row.createSpan({ cls: 'ss-row-title', text: cleanName(item.name) });
        row.createSpan({ cls: 'ss-badge', text: String(countFiles(item)) });
        row.addEventListener('click', () => { this.browse[mode.id] = item.path; this.render(); });
        this.ctx(row, item);
        this.dragSource(row, item);
        this.dropTarget(row, item);
      });
    }

    // 2) pinned notes, under the folders (only at the top level, not inside every sub-folder)
    this.renderPinned(el, mode, { folder: cur });

    // 3) the notes of this folder
    if (files.length && (atTop || bigTiles || folderRows.length)) {
      const title = el.createDiv({ cls: ['ss-section-title', 'ss-notes-title'], text: 'Notes' });
      if (atTop) addSortBtn(title);
    }
    if (!files.length && !folderRows.length && !bigTiles) el.createDiv({ cls: 'ss-empty', text: 'This folder is empty.' });
    const list = el.createDiv('ss-list');
    for (const item of files.slice(0, MAX_ROWS)) {
      const row = list.createDiv({ cls: 'ss-row' + (item.path === activePath ? ' is-active' : '') });
      const cs = this.plugin.custom(item.path);
      const fic = row.createSpan('ss-row-icon');
      setIcon(fic, cs.icon || fileIcon(item));
      if (cs.color) fic.style.color = cs.color;
      row.createSpan({ cls: 'ss-row-title', text: item.extension === 'md' ? item.basename : item.name });
      if (CFG.showTimes) row.createSpan({ cls: 'ss-time', text: ago(item.stat.mtime) });
      row.addEventListener('click', (e) => this.plugin.openNote(item, e));
      this.ctx(row, item);
      this.dragSource(row, item);
    }
    if (files.length > MAX_ROWS) {
      list.createDiv({ cls: 'ss-empty', text: `… and ${files.length - MAX_ROWS} more (showing the first ${MAX_ROWS})` });
    }

    // 4) creating things at the very bottom (only in "Other"; system folders are browse-only)
    if (!isSys) {
      const tools = el.createDiv('ss-tools');
      this.newRow(tools, {
        label: 'New note', icon: 'file-plus',
        onCreate: (title) => this.plugin.createNote(cur, title, 'plain'),
      });
      this.newRow(tools, {
        label: 'New folder', icon: 'folder-plus',
        onCreate: (title) => this.plugin.createFolder(cur, title),
      });
    }
  }

  // ======================= shared building blocks =======================
  /** One clickable row that opens a note (Cmd/Ctrl-click = new tab). "03.1 Basics" -> faint "03.1" + "Basics". */
  noteRow(parent, file, title, activePath, icon, hidePin) {
    const cs = this.plugin.custom(file.path);               // custom icon/colour set by the user (or {})
    const row = parent.createDiv({ cls: 'ss-row' + (file.path === activePath ? ' is-active' : '') });
    const m = !icon && !cs.icon && title.match(/^(\d+(?:\.\d+)?)\s+(.*)$/);
    if (m) {
      const num = row.createSpan({ cls: 'ss-num', text: m[1] });
      if (cs.color) num.style.color = cs.color;
    } else {
      const ic = row.createSpan('ss-row-icon');
      setIcon(ic, cs.icon || icon || 'file-text');
      if (cs.color) ic.style.color = cs.color;
    }
    row.createSpan({ cls: 'ss-row-title', text: m ? m[2] : title });
    row.addEventListener('click', (e) => this.plugin.openNote(file, e));
    if (!hidePin && this.plugin.isPinned(file.path)) setIcon(row.createSpan('ss-pin'), 'pin');
    this.ctx(row, file);
    this.dragSource(row, file);
    return row;
  }

  /** Right-click on `el` opens the file menu for `file` (a TFile or TFolder). */
  ctx(el, file) {
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.plugin.showMenu(e, file);
    });
  }

  /**
   * A "+ New …" row. Click it -> it turns into a text input. Enter creates, Esc/click away cancels.
   * `this.editing` blocks render() while the input exists, otherwise a background refresh would delete it.
   */
  newRow(parent, opts) {
    const row = parent.createDiv({ cls: ['ss-row', 'ss-new'] });
    setIcon(row.createSpan('ss-row-icon'), opts.icon);
    row.createSpan({ cls: 'ss-row-title', text: opts.label });
    row.addEventListener('click', () => {
      if (this.editing) return;
      this.editing = true;
      row.empty();
      row.addClass('is-editing');
      const input = row.createEl('input', { type: 'text', cls: 'ss-input', attr: { placeholder: opts.label + '…' } });
      let done = false;
      const finish = async (commit) => {
        if (done) return;
        done = true;
        this.editing = false;
        const value = input.value.trim();
        if (commit && value) await opts.onCreate(value);
        this.render();
      };
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') finish(true);
        else if (e.key === 'Escape') finish(false);
      });
      input.addEventListener('blur', () => finish(false));
      input.focus();
    });
  }
}

// ---- 3b) SMALL DIALOGS (used by the right-click menu) ---------------------------------------
/** Text input dialog: used for rename / new note / new folder. */
class PromptModal extends Modal {
  constructor(app, opts, onSubmit) { super(app); this.opts = opts; this.onSubmit = onSubmit; }
  onOpen() {
    const { contentEl, opts } = this;
    contentEl.createEl('h3', { text: opts.title });
    const input = contentEl.createEl('input', { type: 'text', cls: 'ss-prompt-input' });
    input.value = opts.value ?? '';
    const go = () => { const v = input.value.trim(); this.close(); if (v) this.onSubmit(v); };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    contentEl.createEl('button', { cls: 'mod-cta', text: opts.cta }).addEventListener('click', go);
    input.focus();
    input.select();
  }
  onClose() { this.contentEl.empty(); }
}

/** "Are you sure?" dialog for deleting. */
class ConfirmModal extends Modal {
  constructor(app, opts, onConfirm) { super(app); this.opts = opts; this.onConfirm = onConfirm; }
  onOpen() {
    const { contentEl, opts } = this;
    contentEl.createEl('h3', { text: opts.title });
    contentEl.createEl('p', { text: opts.text });
    const row = contentEl.createDiv('ss-confirm-buttons');
    row.createEl('button', { text: 'Cancel' }).addEventListener('click', () => this.close());
    row.createEl('button', { cls: 'mod-warning', text: opts.cta }).addEventListener('click', () => {
      this.close();
      this.onConfirm();
    });
  }
  onClose() { this.contentEl.empty(); }
}

/** Pick an icon + colour. onSave gets {icon, color} (either may be null) or null for "reset to default". */
class StyleModal extends Modal {
  constructor(app, title, current, defaults, onSave) {
    super(app);
    this.title = title;
    this.icon = current.icon ?? null;
    this.color = current.color ?? null;
    this.defaults = defaults;
    this.onSave = onSave;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.addClass('ss-style-modal');
    contentEl.createEl('h3', { text: 'Icon and colour' });

    const preview = contentEl.createDiv('ss-style-preview');
    const pIcon = preview.createSpan('ss-row-icon');
    preview.createSpan({ text: this.title });
    const paint = () => {
      pIcon.empty();
      setIcon(pIcon, this.icon || this.defaults.icon);
      pIcon.style.color = this.color || this.defaults.color || '';
    };

    // colours: native picker + hex field + ready-made swatches + your own saved colours
    const colors = contentEl.createDiv('ss-style-colors');
    const picker = colors.createEl('input', { type: 'color', attr: { 'aria-label': 'Custom colour' } });
    picker.value = this.color || this.defaults.color || '#6188ff';
    const hex = colors.createEl('input', { type: 'text', cls: 'ss-hex', attr: { placeholder: '#hex', maxlength: '7' } });
    hex.value = picker.value;
    // one place that applies a colour everywhere (preview, picker, hex field)
    const setColor = (c) => { this.color = c; picker.value = c; hex.value = c; paint(); };
    picker.addEventListener('input', () => setColor(picker.value));
    hex.addEventListener('input', () => {
      let v = hex.value.trim();
      if (v && !v.startsWith('#')) v = '#' + v;
      if (/^#[0-9a-f]{6}$/i.test(v)) setColor(v.toLowerCase());   // only accept a complete #rrggbb
    });
    for (const c of SWATCHES) {
      const sw = colors.createDiv('ss-swatch');
      sw.style.background = c;
      sw.addEventListener('click', () => setColor(c));
    }
    // custom colours you saved before (kept in the browser storage of this vault; max 10)
    const SAVED_KEY = 'sidebar-modes-colors';
    const loadSaved = () => { try { return JSON.parse(window.localStorage.getItem(SAVED_KEY) || '[]'); } catch (e) { return []; } };
    const savedRow = contentEl.createDiv('ss-style-colors ss-saved-colors');
    const drawSaved = () => {
      savedRow.empty();
      const list = loadSaved();
      if (!list.length) return;
      savedRow.createSpan({ cls: 'ss-saved-label', text: 'Saved:' });
      for (const c of list) {
        const sw = savedRow.createDiv({ cls: 'ss-swatch', attr: { 'aria-label': c } });
        sw.style.background = c;
        sw.addEventListener('click', () => setColor(c));
      }
    };
    colors.createEl('button', { cls: 'ss-save-color', text: '+ Save', attr: { 'aria-label': 'Save this colour to my colours' } })
      .addEventListener('click', () => {
        if (!this.color) return;
        const list = loadSaved().filter((c) => c !== this.color);
        list.unshift(this.color);
        try { window.localStorage.setItem(SAVED_KEY, JSON.stringify(list.slice(0, 10))); } catch (e) { /* storage unavailable */ }
        drawSaved();
      });
    drawSaved();

    // icons: filter the grid, or type any Lucide name (lucide.dev) and press Enter
    const filter = contentEl.createEl('input', {
      type: 'text', cls: 'ss-prompt-input',
      attr: { placeholder: 'Search icons, or type a name from lucide.dev and press Enter…' },
    });
    const grid = contentEl.createDiv('ss-icon-grid');
    const drawGrid = () => {
      grid.empty();
      const q = filter.value.trim().toLowerCase();
      for (const name of ICON_CHOICES.filter((n) => n.includes(q))) {
        const b = grid.createDiv({ cls: 'ss-icon-btn' + (name === this.icon ? ' is-selected' : ''), attr: { 'aria-label': name } });
        setIcon(b, name);
        b.addEventListener('click', () => { this.icon = name; paint(); drawGrid(); });
      }
    };
    filter.addEventListener('input', drawGrid);
    filter.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && filter.value.trim()) { this.icon = filter.value.trim(); paint(); drawGrid(); }
    });

    const buttons = contentEl.createDiv('ss-confirm-buttons');
    buttons.createEl('button', { text: 'Default look' }).addEventListener('click', () => { this.close(); this.onSave(null); });
    buttons.createEl('button', { cls: 'mod-cta', text: 'Save' }).addEventListener('click', () => {
      this.close();
      this.onSave({ icon: this.icon, color: this.color });
    });
    paint();
    drawGrid();
  }
  onClose() { this.contentEl.empty(); }
}

/** Shows a note, rendered like in reading mode, in a big pop-up. */
class CheatSheetModal extends Modal {
  constructor(app, file, title) { super(app); this.file = file; this.title = title; }
  async onOpen() {
    const { contentEl, modalEl } = this;
    modalEl.addClass('ss-cheat-modal');
    const head = contentEl.createDiv('ss-cheat-head');
    head.createEl('button', { text: 'Open as a note' }).addEventListener('click', () => {
      this.close();
      this.app.workspace.getLeaf('tab').openFile(this.file);
    });
    const body = contentEl.createDiv('ss-cheat-body markdown-rendered');
    const text = await this.app.vault.cachedRead(this.file);
    // MarkdownRenderer turns markdown text into real HTML (math, tables, callouts, images …)
    await MarkdownRenderer.render(this.app, text, body, this.file.path, this);

    // Links in a pop-up are not handled by Obsidian automatically, so do it here:
    //  [[#Heading]]  -> scroll to that heading inside the pop-up
    //  [[Other note]] -> another cheat sheet opens in a pop-up, any other note opens in a tab
    body.addEventListener('click', (evt) => {
      const a = evt.target instanceof Element ? evt.target.closest('a.internal-link') : null;
      if (!a) return;
      evt.preventDefault();
      const href = a.getAttribute('data-href') || a.getAttribute('href') || '';
      const [linkpath, ...rest] = href.split('#');
      const heading = rest.join('#').trim();
      const scrollToHeading = (root) => {
        if (!heading) { root.scrollTop = 0; return; }
        const norm = (t) => t.replace(/\s+/g, ' ').trim().toLowerCase();
        const target = Array.from(root.querySelectorAll('h1,h2,h3,h4,h5,h6'))
          .find(h => norm(h.getAttribute('data-heading') || h.textContent) === norm(heading));
        if (!target) return;
        // jump instantly (smooth scrolling gets cut short while math/tables finish laying out), then correct once more
        const jump = () => { root.scrollTop += target.getBoundingClientRect().top - root.getBoundingClientRect().top - 4; };
        jump(); requestAnimationFrame(jump); setTimeout(jump, 120);
      };
      if (!linkpath) { scrollToHeading(body); return; }          // link inside this same note
      const dest = this.app.metadataCache.getFirstLinkpathDest(linkpath, this.file.path);
      if (!dest) { new Notice('Note not found: ' + linkpath); return; }
      if (dest.path === this.file.path) { scrollToHeading(body); return; }
      this.close();
      const slot = CHEATSHEETS.find(c => this.app.metadataCache.getFirstLinkpathDest(c.name, '')?.path === dest.path);
      if (slot) new CheatSheetModal(this.app, dest, slot.title).open();
      else this.app.workspace.getLeaf('tab').openFile(dest);
    });
  }
  onClose() { this.contentEl.empty(); }
}

/** Searchable list of folders: used for "Move to…". */
class FolderSuggest extends FuzzySuggestModal {
  constructor(app, folders, onChoose) {
    super(app);
    this.folders = folders;
    this.onChoose = onChoose;
    this.setPlaceholder('Move to folder…');
  }
  getItems() { return this.folders; }
  getItemText(f) { return f.isRoot() ? '/ (vault root)' : f.path; }
  onChooseItem(f) { this.onChoose(f); }
}

// ---- 4) THE PLUGIN ITSELF --------------------------------------------------------------------
/** Autocomplete under a text field (Obsidian's own suggest popup). Falls back to a plain field on old versions. */
const makeSuggest = (getItems, getText) => (AbstractInputSuggest ? class extends AbstractInputSuggest {
  constructor(app, inputEl, onPick) { super(app, inputEl); this.inputEl = inputEl; this.onPick = onPick; }
  getSuggestions(q) {
    const n = (q || '').toLowerCase();
    return getItems(this.app).filter((x) => getText(x).toLowerCase().includes(n)).slice(0, 40);
  }
  renderSuggestion(x, el) { el.setText(getText(x)); }
  selectSuggestion(x) { this.inputEl.value = getText(x); this.inputEl.dispatchEvent(new Event('input')); this.onPick(getText(x)); this.close(); }
} : null);
const FolderSuggest2 = makeSuggest(
  (app) => app.vault.getAllLoadedFiles().filter((f) => f instanceof TFolder && !f.isRoot() && !f.path.startsWith('.')).sort((a, b) => a.path.localeCompare(b.path)),
  (f) => f.path);
const NoteSuggest = makeSuggest(
  (app) => app.vault.getMarkdownFiles().sort((a, b) => b.stat.mtime - a.stat.mtime),
  (f) => f.basename);

/** Names of the settings that belong to each tab (used by the per-tab "Reset" button). */
const TAB_KEYS = {
  general: ['startMode', 'openOnStart', 'showSearch', 'density', 'animations', 'confirmDelete'],
  modes: ['modeSchool', 'modeSchoolIcon', 'modeSchoolColor', 'modeSchoolShow', 'modeOther', 'modeOtherIcon', 'modeOtherColor', 'modeOtherShow',
          'modeSystem', 'modeSystemIcon', 'modeSystemColor', 'modeSystemShow'],
  school: ['schoolFolder', 'showHero', 'showHeroStats', 'showChapterCounts', 'showPinned', 'overviewLabel', 'allowManyOpen', 'autoOpenActive',
           'rememberLastNote', 'autoOverviews', 'autoNumber'],
  other: ['otherFolder', 'systemFolder', 'archiveFolder', 'bigTiles', 'showTimes', 'showOtherFiles', 'maxRows'],
  popups: ['cs1Name', 'cs1Title', 'cs1Icon', 'cs2Name', 'cs2Title', 'cs2Icon', 'cs3Name', 'cs3Title', 'cs3Icon'],
};
const TABS = [['general', 'General'], ['modes', 'Modes'], ['school', 'School'], ['other', 'Other & System'], ['popups', 'Pop-up notes']];

/** Settings > Sidebar Modes. Every change: save -> applySettings (updates the variables) -> redraw the panel. */
class SubjectSwitcherSettings extends PluginSettingTab {
  constructor(app, plugin) { super(app, plugin); this.plugin = plugin; this.tab = 'general'; }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass('ss-settings');
    const st = this.plugin.data.settings;
    const save = async () => { await this.plugin.save(); applySettings(st); this.plugin.refreshViews(); };

    // ---- tab bar ----
    const bar = containerEl.createDiv('ss-settings-tabs');
    for (const [id, label] of TABS) {
      const b = bar.createDiv({ cls: 'ss-settings-tab' + (id === this.tab ? ' is-active' : ''), text: label });
      b.addEventListener('click', () => { this.tab = id; this.display(); });
    }
    const body = containerEl.createDiv('ss-settings-body');
    const hint = (text) => body.createEl('p', { cls: 'setting-item-description ss-settings-hint', text });
    const heading = (text) => new Setting(body).setName(text).setHeading();

    // ---- building blocks ----
    const toggle = (name, desc, key, after) => new Setting(body).setName(name).setDesc(desc)
      .addToggle((t) => t.setValue(st[key] !== undefined ? !!st[key] : !!DEFAULT_SETTINGS[key])
        .onChange(async (v) => { st[key] = v; await save(); if (after) after(v); }));
    const dropdown = (name, desc, key, options, after) => new Setting(body).setName(name).setDesc(desc)
      .addDropdown((d) => {
        for (const [v, l] of options) d.addOption(v, l);
        d.setValue(st[key] ?? DEFAULT_SETTINGS[key]).onChange(async (v) => { st[key] = v; await save(); if (after) after(v); });
      });
    const textField = (name, desc, key, { placeholder } = {}) => new Setting(body).setName(name).setDesc(desc)
      .addText((t) => {
        t.setPlaceholder(placeholder ?? String(DEFAULT_SETTINGS[key] ?? '')).setValue(st[key] ?? '');
        t.onChange(async (v) => { st[key] = v.trim(); await save(); });
      });
    // folder: text field with autocomplete + a warning (and a "create" button) when the folder does not exist
    const folderField = (name, desc, key) => {
      const s = new Setting(body).setName(name).setDesc(desc);
      let createBtn = null;
      const effective = () => normalizePath((st[key] || '').trim() || DEFAULT_SETTINGS[key]).replace(/^\/+|\/+$/g, '');
      const check = () => {
        const ok = this.app.vault.getAbstractFileByPath(effective()) instanceof TFolder;
        s.descEl.toggleClass('mod-warning', !ok);
        if (createBtn) createBtn.extraSettingsEl.style.display = ok ? 'none' : '';
        s.settingEl.toggleClass('ss-missing', !ok);
      };
      s.addText((t) => {
        t.setPlaceholder(DEFAULT_SETTINGS[key]).setValue(st[key] ?? '');
        const commit = async (v) => { st[key] = (v || '').trim().replace(/^\/+|\/+$/g, ''); await save(); check(); };
        t.onChange(commit);
        if (FolderSuggest2) new FolderSuggest2(this.app, t.inputEl, commit);
      });
      s.addExtraButton((b) => { createBtn = b; b.setIcon('folder-plus').setTooltip('Create this folder').onClick(async () => {
        await this.app.vault.createFolder(effective()); check(); this.plugin.refreshViews();
      }); });
      check();
      return s;
    };
    // icon: text field + live preview; warns when the name is not a known icon
    const iconField = (name, desc, key, after) => {
      const s = new Setting(body).setName(name).setDesc(desc);
      let prev;
      const known = (n) => { try { const ids = getIconIds ? getIconIds() : null; return !ids || ids.includes(n) || ids.includes('lucide-' + n); } catch (e) { return true; } };
      const paint = () => {
        const n = (st[key] || '').trim() || DEFAULT_SETTINGS[key];
        prev.empty(); setIcon(prev, n);
        prev.toggleClass('is-invalid', !known(n));
        prev.setAttr('aria-label', known(n) ? n : `"${n}" is not a known icon`);
      };
      s.addText((t) => {
        prev = t.inputEl.parentElement.createSpan('ss-set-preview');
        t.inputEl.parentElement.insertBefore(prev, t.inputEl);
        t.setPlaceholder(DEFAULT_SETTINGS[key]).setValue(st[key] ?? '');
        t.onChange(async (v) => { st[key] = v.trim(); await save(); paint(); if (after) after(); });
      });
      paint();
      return s;
    };
    const colorField = (name, desc, key) => new Setting(body).setName(name).setDesc(desc)
      .addColorPicker((c) => c.setValue(/^#[0-9a-f]{6}$/i.test(st[key]) ? st[key] : DEFAULT_SETTINGS[key])
        .onChange(async (v) => { st[key] = v; await save(); }))
      .addExtraButton((b) => b.setIcon('rotate-ccw').setTooltip('Back to the default colour').onClick(async () => {
        st[key] = DEFAULT_SETTINGS[key]; await save(); this.display();
      }));
    const resetTab = (id) => new Setting(body).setName('Reset this tab')
      .setDesc('Puts every setting on this tab back to its default. Your notes, pins, icons and colours of folders are not touched.')
      .addButton((b) => b.setButtonText('Reset').setWarning().onClick(async () => {
        for (const k of TAB_KEYS[id]) st[k] = DEFAULT_SETTINGS[k];
        await save(); this.display();
      }));

    // ======================= tabs =======================
    if (this.tab === 'general') {
      hint('Changes apply immediately. Every tab has its own Reset button at the bottom.');
      heading('Start');
      dropdown('Mode on startup', 'Which mode the panel shows when Obsidian opens.', 'startMode',
        [['last', 'The one I used last'], ...MODES.map((m) => [m.id, m.name])]);
      toggle('Open the panel on startup', 'If the panel is not in the sidebar, open it when Obsidian starts.', 'openOnStart');
      heading('Panel');
      toggle('Search field', 'Show the search field under the mode buttons.', 'showSearch');
      dropdown('Density', 'Compact makes rows and cards smaller, so more fits on the screen.', 'density',
        [['comfortable', 'Comfortable'], ['compact', 'Compact']]);
      dropdown('Animations', 'The panel slides and folds. "Follow system" turns them off when your operating system asks for reduced motion.', 'animations',
        [['system', 'Follow system'], ['on', 'Always on'], ['off', 'Off']]);
      new Setting(body).setName('Sort in file lists').setDesc('Sorting in Other and System. You can also click the sort icon in the panel.')
        .addDropdown((d) => d.addOption('name', 'By name').addOption('new', 'Newest first').setValue(this.plugin.data.sort === 'new' ? 'new' : 'name')
          .onChange(async (v) => { this.plugin.data.sort = v; await save(); }));
      heading('Safety');
      toggle('Confirm before deleting', 'Ask "Are you sure?" before a note or folder goes to the trash (it can always be restored from there).', 'confirmDelete');
      resetTab('general');
    } else if (this.tab === 'modes') {
      hint('The three buttons at the top of the panel. Rename them, change their icon and colour, or hide the ones you do not use.');
      for (const [id, K, label] of [['skola', 'School', 'School'], ['ostatni', 'Other', 'Other'], ['system', 'System', 'System']]) {
        heading(`${label} mode`);
        textField('Name', 'Text on the button.', 'mode' + K);
        iconField('Icon', 'Icon name from lucide.dev, e.g. "graduation-cap", "folder-open", "settings".', `mode${K}Icon`);
        colorField('Colour', 'Accent colour of this mode.', `mode${K}Color`);
        toggle('Show this mode', 'Hide it if you never use it. At least one mode always stays visible.', `mode${K}Show`, async (v) => {
          if (!v && MODES.every((m) => m.show === false)) { st[`mode${K}Show`] = true; await save(); this.display(); }   // never hide the last one
        });
      }
      resetTab('modes');
    } else if (this.tab === 'school') {
      hint('How the School mode looks and behaves. School mode treats every subfolder of the school folder as a subject.');
      heading('Folder');
      folderField('School folder', 'Each subfolder is one subject (a tab). Start typing to pick an existing folder.', 'schoolFolder');
      heading('What is shown');
      toggle('Subject card', 'The big card with the icon, name and number of notes.', 'showHero');
      toggle('Note count and last edit', 'The line under the subject name.', 'showHeroStats');
      toggle('Counts on chapters', 'The small number badge on every chapter card.', 'showChapterCounts');
      toggle('Pinned notes', 'Show pinned notes in their own box at the top. When off, pinned notes stay in the normal lists.', 'showPinned');
      textField('Name of the overview row', 'The first row in an open chapter (the note named like the chapter folder).', 'overviewLabel');
      heading('Chapters');
      toggle('Allow several chapters open', 'Off: opening a chapter folds the previous one.', 'allowManyOpen');
      toggle('Open the chapter of the current note', 'When you open a note, its chapter unfolds in the panel.', 'autoOpenActive');
      toggle('Continue where I left off', 'Switching to a subject reopens the note you had open there last time.', 'rememberLastNote');
      heading('New notes');
      toggle('Number new notes', 'New notes in a chapter get the next number ("03.8 Title"). Off: the name is used exactly as typed.', 'autoNumber');
      toggle('Automatic chapter overviews', 'Create an overview note for every chapter and keep its list of sub-notes up to date.', 'autoOverviews', (v) => { if (v) this.plugin.ensureOverviews(); });
      resetTab('school');
    } else if (this.tab === 'other') {
      hint('Other and System are small file managers. Other starts in the "Other" folder, System in the system folder.');
      heading('Folders');
      folderField('Other folder', 'Where the Other mode starts. Its subfolders become the big tiles.', 'otherFolder');
      folderField('System folder', 'Where the System mode starts (attachments, templates, archive…).', 'systemFolder');
      folderField('Archive folder', 'Where "Move to archive" in the right-click menu sends things.', 'archiveFolder');
      heading('What is shown');
      toggle('Big tiles', 'Show the top-level folders of Other as big tiles. Off: show them as a normal list.', 'bigTiles');
      toggle('Show "x days ago"', 'The time of the last change on every note.', 'showTimes');
      toggle('Show files that are not notes', 'Images, PDFs and other attachments in the file lists.', 'showOtherFiles');
      new Setting(body).setName('Rows per folder').setDesc('A big folder (e.g. Attachments) is cut off after this many items so the panel stays fast.')
        .addSlider((sl) => sl.setLimits(50, 1000, 50).setValue(st.maxRows).setDynamicTooltip().onChange(async (v) => { st.maxRows = v; await save(); }));
      resetTab('other');
    } else if (this.tab === 'popups') {
      hint('Up to three notes (for example cheat sheets) get a button next to the window controls and open as a pop-up. The note is found by its NAME, so you can move it around freely. Leave the note empty for no button.');
      for (const i of [1, 2, 3]) {
        heading(`Pop-up ${i}`);
        const s = new Setting(body).setName('Note').setDesc('Start typing a note name and pick it from the list.');
        s.addText((t) => {
          t.setPlaceholder('e.g. LaTeX Cheat Sheet').setValue(st[`cs${i}Name`] ?? '');
          const commit = async (v) => { st[`cs${i}Name`] = (v || '').trim(); await save(); this.plugin.reinstallTitlebarButtons(); };
          t.onChange(commit);
          if (NoteSuggest) new NoteSuggest(this.app, t.inputEl, commit);
        });
        s.addExtraButton((b) => b.setIcon('x').setTooltip('Remove this pop-up').onClick(async () => {
          st[`cs${i}Name`] = ''; st[`cs${i}Title`] = ''; await save(); this.plugin.reinstallTitlebarButtons(); this.display();
        }));
        textField('Label', 'Short title in the pop-up header (defaults to the note name).', `cs${i}Title`, { placeholder: st[`cs${i}Name`] || 'Label' });
        iconField('Icon', 'Icon name from lucide.dev, e.g. "sigma", "hash", "keyboard".', `cs${i}Icon`, () => this.plugin.reinstallTitlebarButtons());
      }
      resetTab('popups');
    }
  }
}

module.exports = class SubjectSwitcher extends Plugin {
  async onload() {
    // loadData/saveData keep a small JSON next to the plugin (remembers mode, subject, sorting).
    this.data = Object.assign({ mode: 'skola', current: null, sort: 'name', styles: {}, pinned: [], lastNote: {} }, await this.loadData());
    this.data.settings = Object.assign({}, DEFAULT_SETTINGS, this.data.settings);
    applySettings(this.data.settings);
    if (this.data.settings.startMode && this.data.settings.startMode !== 'last') this.data.mode = this.data.settings.startMode;
    this.addSettingTab(new SubjectSwitcherSettings(this.app, this));

    this.titlebarEl = null;    // our two cheat-sheet buttons in the top-left bar (removed again in onunload)
    this.registerView(VIEW_TYPE, (leaf) => new SubjectView(leaf, this));
    this.addRibbonIcon('layout-grid', 'Sidebar Modes', () => this.activateView());

    this.addCommand({ id: 'open', name: 'Open Sidebar Modes', callback: () => this.activateView() });
    for (const m of MODES) {
      this.addCommand({ id: `mode-${m.id}`, name: `Mode: ${m.name}`, callback: () => this.setMode(m.id, true) });
    }
    for (const i of [0, 1, 2]) {   // three slots; the callback looks the slot up when run, so Settings changes apply at once
      this.addCommand({ id: `cheat-${i + 1}`, name: `Show pop-up note ${i + 1}`, callback: () => CHEATSHEETS[i] && this.showCheatSheet(CHEATSHEETS[i]) });
    }
    this.addCommand({ id: 'next-subject', name: 'Next school subject', callback: () => this.nextSubject() });

    // Re-render when files change. debounce = wait until things calm down, then run once.
    const refresh = debounce(() => this.refreshViews(), 800, true);
    for (const ev of ['create', 'delete', 'rename', 'modify']) this.registerEvent(this.app.vault.on(ev, refresh));
    this.registerEvent(this.app.workspace.on('file-open', refresh));
    // remember the last note opened in each subject, so switching back to it continues where you were
    this.registerEvent(this.app.workspace.on('file-open', (f) => {
      if (!f || !f.path.startsWith(SCHOOL_FOLDER + '/')) return;
      const subject = f.path.split('/')[1];
      if (this.data.lastNote[subject] === f.path) return;
      this.data.lastNote[subject] = f.path;
      this.save();
    }));
    this.registerEvent(this.app.vault.on('rename', (f, oldPath) => {         // keep the memory valid when a note is moved/renamed
      for (const [k, v] of Object.entries(this.data.lastNote)) if (v === oldPath) this.data.lastNote[k] = f.path;
    }));
    // Keep chapter overviews ("Overview") in sync when notes are created / renamed / deleted
    const syncOverviews = debounce(() => this.ensureOverviews(), 1500, true);
    for (const ev of ['create', 'delete', 'rename']) this.registerEvent(this.app.vault.on(ev, syncOverviews));
    // custom icons/colours are stored by path -> follow renames/moves, forget deleted things
    this.registerEvent(this.app.vault.on('rename', (f, oldPath) => { this.migrateStyles(oldPath, f.path); this.migratePins(oldPath, f.path); }));
    this.registerEvent(this.app.vault.on('delete', (f) => { this.migrateStyles(f.path, null); this.migratePins(f.path, null); }));

    // Cheat-sheet buttons next to the window buttons (re-added whenever the layout is rebuilt)
    this.registerEvent(this.app.workspace.on('layout-change', () => this.installTitlebarButtons()));

    // First run: open the panel in the left sidebar. (Afterwards Obsidian remembers its place.)
    this.app.workspace.onLayoutReady(() => {
      this.installTitlebarButtons();
      if (this.data.settings.openOnStart && !this.app.workspace.getLeavesOfType(VIEW_TYPE).length) this.activateView();
      this.ensureOverviews();   // create missing chapter overviews at startup
    });
  }

  onunload() { this.titlebarEl?.remove(); }

  /** Rebuild the pop-up buttons in the top bar (after Settings changed them). */
  reinstallTitlebarButtons() {
    this.titlebarEl?.remove();
    document.querySelectorAll('.ss-titlebar-actions').forEach((e) => e.remove());
    this.installTitlebarButtons();
  }

  /**
   * Put the cheat-sheet buttons into the top bar of the LEFT sidebar - the row that also holds the
   * macOS window buttons (red/yellow/green). We append a small <div> with two icon buttons to it.
   * It is plain DOM work, so we check on every layout change that our div is still there.
   */
  installTitlebarButtons() {
    const bar = this.app.workspace.leftSplit?.containerEl?.querySelector('.workspace-tab-header-container');
    if (!bar || bar.querySelector('.ss-titlebar-actions')) return;
    if (!CHEATSHEETS.length) return;   // no pop-up notes configured -> no buttons
    const box = bar.createDiv('ss-titlebar-actions');
    for (const c of CHEATSHEETS) {
      const btn = box.createDiv({ cls: ['clickable-icon', 'ss-titlebar-btn'], attr: { 'aria-label': `${c.title} cheat sheet` } });
      setIcon(btn, c.icon);
      btn.addEventListener('click', () => this.showCheatSheet(c));
    }
    this.titlebarEl = box;
  }

  showCheatSheet(c) {
    const file = this.app.metadataCache.getFirstLinkpathDest(c.name, '');
    if (!file) return new Notice(`Note "${c.name}" was not found.`);
    new CheatSheetModal(this.app, file, c.title).open();
  }

  // ---------- pinned notes ----------
  isPinned(path) { return this.data.pinned.includes(path); }

  /** Pinned notes live in the "Pinned" box at the top, so they are left out of the normal lists
   *  (otherwise every pinned note would show up twice). Name kept so the callers stay unchanged. */
  pinFirst(files) {
    return CFG.showPinned ? files.filter((f) => !this.isPinned(f.path)) : files;
  }

  /** Which mode (tab group) a path belongs to - decides where its "Pinned" row shows up. */
  modeOfPath(path) {
    if (path.startsWith(SCHOOL_FOLDER + '/')) return 'skola';
    if (path.startsWith(SYSTEM_FOLDER + '/')) return 'system';
    return 'ostatni';
  }

  async togglePin(file) {
    const i = this.data.pinned.indexOf(file.path);
    if (i >= 0) this.data.pinned.splice(i, 1); else this.data.pinned.push(file.path);
    await this.save();
    this.refreshViews();
  }

  /** Keep pins pointing at the right file after a rename/move (newPath null = deleted). */
  migratePins(oldPath, newPath) {
    let changed = false;
    this.data.pinned = this.data.pinned.flatMap((p) => {
      if (p !== oldPath && !p.startsWith(oldPath + '/')) return [p];
      changed = true;
      return newPath ? [newPath + p.slice(oldPath.length)] : [];
    });
    if (changed) { this.save(); this.refreshViews(); }
  }

  /** The user's custom {icon, color} for a path, or {} when none was set. */
  custom(path) { return this.data.styles[path] ?? {}; }

  mode() { const v = visibleModes(); return v.find((m) => m.id === this.data.mode) ?? v[0]; }

  async save() { await this.saveData(this.data); }

  async setMode(id, reveal) {
    this.data.mode = id;
    await this.save();
    if (reveal) await this.activateView();
    this.refreshViews();
  }

  async setSubject(folderName) {
    const changed = this.data.current !== folderName;
    this.data.current = folderName;
    await this.save();
    this.refreshViews();
    if (!changed) return;
    // continue where you left off: open the note you last had open in that subject
    const last = this.app.vault.getAbstractFileByPath(this.data.lastNote[folderName] ?? '');
    const active = this.app.workspace.getActiveFile();
    const alreadyThere = active && active.path.startsWith(SCHOOL_FOLDER + '/' + folderName + '/');
    if (CFG.rememberLastNote && last instanceof TFile && !alreadyThere) this.openNote(last);
  }

  async toggleSort() {
    this.data.sort = this.data.sort === 'new' ? 'name' : 'new';
    await this.save();
    this.refreshViews();
  }

  async nextSubject() {
    const root = this.app.vault.getAbstractFileByPath(SCHOOL_FOLDER);
    if (!(root instanceof TFolder)) return;
    const names = root.children.filter((c) => c instanceof TFolder).sort(byName).map((f) => f.name);
    if (!names.length) return;
    const i = names.indexOf(this.data.current);
    this.data.mode = 'skola';
    await this.setSubject(names[(i + 1) % names.length]);
    await this.activateView();
  }

  refreshViews() {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
      if (leaf.view instanceof SubjectView) leaf.view.render();
    }
  }

  async activateView() {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) {
      leaf = workspace.getLeftLeaf(false);
      if (!leaf) return;
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
    }
    workspace.revealLeaf(leaf);
  }

  openNote(file, evt) {
    const where = evt ? Keymap.isModEvent(evt) : false; // false = this tab, 'tab' = new tab
    this.app.workspace.getLeaf(where).openFile(file);
  }

  /**
   * Create a note in `folder` and open it.
   *  kind 'chapter': "03.8 Title" in a chapter folder + the link is added to the chapter's overview note
   *  kind 'loose'  : "04 Title" directly in a subject (number only if the other notes are numbered)
   *  kind 'plain'  : "Title" exactly as typed
   */
  async createNote(folder, title, kind) {
    const clean = cleanTitle(title);
    if (!clean) return new Notice('Enter a note title.');
    const prefix = kind === 'plain' || !CFG.autoNumber ? '' : nextPrefix(folder, kind === 'chapter');
    const base = prefix ? `${prefix} ${clean}` : clean;
    const path = normalizePath(`${folder.path}/${base}.md`);
    if (this.app.vault.getAbstractFileByPath(path)) return new Notice('A note with that name already exists.');

    const file = await this.app.vault.create(path, `# ${clean}\n\n`);
    if (kind === 'chapter') await this.linkFromOverview(folder, base);
    await this.app.workspace.getLeaf(false).openFile(file);
  }

  /**
   * Automatic "Overview": every chapter folder (School / subject / chapter) gets an overview note
   * named like the folder. If it is missing it is created; if it exists, links to sub-notes that
   * are not listed yet are added to its "## Sub-notes" list. Safe to run repeatedly: when
   * nothing is missing, nothing is written (so it can't trigger itself in a loop).
   */
  async ensureOverviews() {
    if (!this.data.settings.autoOverviews) return;   // switched off in Settings
    if (this._ensuring) return;          // already running -> skip (re-entrancy guard)
    this._ensuring = true;
    try {
      const school = this.app.vault.getAbstractFileByPath(SCHOOL_FOLDER);
      if (!(school instanceof TFolder)) return;
      for (const subject of school.children.filter((c) => c instanceof TFolder)) {
        for (const chapter of subject.children.filter((c) => c instanceof TFolder)) {
          const notes = chapter.children
            .filter((c) => c instanceof TFile && c.extension === 'md' && c.basename !== chapter.name)
            .sort((a, b) => a.basename.localeCompare(b.basename, 'en', { numeric: true }));
          let overview = chapter.children.find((c) => c instanceof TFile && c.basename === chapter.name);
          if (!overview) {
            if (!notes.length) continue;   // empty folder -> nothing to summarise yet
            const title = chapter.name.replace(/^\d+\s+/, '');   // "04 Alternating Current" -> "Alternating Current"
            const links = notes.map((n) => `- [[${n.basename}]]`).join('\n');
            await this.app.vault.create(
              normalizePath(`${chapter.path}/${chapter.name}.md`),
              `# ${title}\n> Overview of the topic. Details are in the sub-notes below.\n\n${OVERVIEW_HEADING}\n${links}\n`
            );
            continue;
          }
          // overview exists -> only append links that are missing
          const text = await this.app.vault.cachedRead(overview);
          if (!OVERVIEW_HEADINGS.some((h) => text.includes(h))) continue;
          const missing = notes.filter((n) => !text.includes(`[[${n.basename}]]`));
          for (const n of missing) await this.linkFromOverview(chapter, n.basename);
        }
      }
    } finally { this._ensuring = false; }
  }

  /** Add "- [[base]]" at the end of the "## Sub-notes" list in the chapter's overview note. */
  async linkFromOverview(folder, base) {
    const overview = folder.children.find((c) => c instanceof TFile && c.basename === folder.name);
    if (!overview) return;
    await this.app.vault.process(overview, (text) => {
      const lines = text.split('\n');
      const h = lines.findIndex((l) => OVERVIEW_HEADINGS.includes(l.trim()));
      if (h < 0) return text;
      let last = h;
      for (let i = h + 1; i < lines.length && (lines[i].startsWith('- [[') || lines[i].trim() === ''); i++) {
        if (lines[i].startsWith('- [[')) last = i;
      }
      lines.splice(last + 1, 0, `- [[${base}]]`);
      return lines.join('\n');
    });
  }

  /** Move (or drop, when newPath is null) every stored style at/below oldPath. */
  migrateStyles(oldPath, newPath) {
    let changed = false;
    for (const key of Object.keys(this.data.styles)) {
      if (key !== oldPath && !key.startsWith(oldPath + '/')) continue;
      const style = this.data.styles[key];
      delete this.data.styles[key];
      if (newPath) this.data.styles[newPath + key.slice(oldPath.length)] = style;
      changed = true;
    }
    if (changed) { this.save(); this.refreshViews(); }
  }

  /** Open the icon/colour dialog for a file or folder. */
  editStyle(file) {
    const isFolder = file instanceof TFolder;
    const defaults = isFolder ? styleFor(file.name) : { icon: fileIcon(file), color: null };
    const title = isFolder ? cleanName(file.name) : file.basename;
    new StyleModal(this.app, title, this.custom(file.path), defaults, async (style) => {
      if (!style || (!style.icon && !style.color)) delete this.data.styles[file.path];
      else {
        const entry = {};
        if (style.icon) entry.icon = style.icon;
        if (style.color) entry.color = style.color;
        this.data.styles[file.path] = entry;
      }
      await this.save();
      this.refreshViews();
    }).open();
  }

  // ---------- right-click menu ----------
  /** Build and show the context menu for a file or folder. */
  showMenu(evt, file) {
    const isFolder = file instanceof TFolder;
    const locked = PROTECTED.has(file.path);
    const menu = new Menu();

    if (isFolder) {
      menu.addItem((i) => i.setTitle('New note here').setIcon('file-plus').onClick(() => this.promptNewNote(file)));
      menu.addItem((i) => i.setTitle('New folder here').setIcon('folder-plus').onClick(() => this.promptNewFolder(file)));
    } else {
      menu.addItem((i) => i.setTitle('Open').setIcon('file-text').onClick(() => this.openNote(file)));
      menu.addItem((i) => i.setTitle('Open in new tab').setIcon('file-plus-2').onClick(() => this.app.workspace.getLeaf('tab').openFile(file)));
      const pinned = this.isPinned(file.path);
      menu.addItem((i) => i.setTitle(pinned ? 'Unpin' : 'Pin to top').setIcon(pinned ? 'pin-off' : 'pin').onClick(() => this.togglePin(file)));
    }
    menu.addItem((i) => i.setTitle('Icon and colour…').setIcon('palette').onClick(() => this.editStyle(file)));
    if (!locked) {
      menu.addSeparator();
      menu.addItem((i) => i.setTitle('Rename').setIcon('pencil').onClick(() => this.renameItem(file)));
      menu.addItem((i) => i.setTitle('Move to…').setIcon('folder-input').onClick(() => this.moveItem(file)));
      if (!file.path.startsWith(ARCHIVE_FOLDER + '/'))   // nothing to archive that is already in the archive
        menu.addItem((i) => i.setTitle('Move to archive').setIcon('archive').onClick(() => this.archiveItem(file)));
      if (!isFolder) menu.addItem((i) => i.setTitle('Duplicate').setIcon('copy').onClick(() => this.duplicateItem(file)));
    }
    if (typeof this.app.showInFolder === 'function') {   // desktop only
      menu.addSeparator();
      menu.addItem((i) => i.setTitle('Show in Finder').setIcon('external-link').onClick(() => this.app.showInFolder(file.path)));
    }
    if (!locked) {
      menu.addSeparator();
      menu.addItem((i) => i.setTitle('Delete').setIcon('trash-2').setWarning(true).onClick(() => this.deleteItem(file)));
    }
    menu.showAtMouseEvent(evt);
  }

  /** "New note here": numbering depends on where the folder is (subject / chapter / elsewhere). */
  promptNewNote(folder) {
    const parentPath = folder.parent?.path;
    const kind = parentPath === SCHOOL_FOLDER ? 'loose'
      : folder.parent?.parent?.path === SCHOOL_FOLDER ? 'chapter' : 'plain';
    new PromptModal(this.app, { title: 'New note', cta: 'Create' }, (v) => this.createNote(folder, v, kind)).open();
  }

  promptNewFolder(parent) {
    new PromptModal(this.app, { title: 'New folder', cta: 'Create' }, (v) => this.createFolder(parent, v)).open();
  }

  /** Rename keeps links working (fileManager.renameFile rewrites them). A chapter's overview note is renamed too. */
  renameItem(file) {
    const isFolder = file instanceof TFolder;
    const current = isFolder ? file.name : file.basename;
    new PromptModal(this.app, { title: 'Rename', value: current, cta: 'Rename' }, async (v) => {
      const clean = cleanTitle(v);
      if (!clean || clean === current) return;
      const parent = file.parent.isRoot() ? '' : file.parent.path;
      const newPath = normalizePath(`${parent}/${clean}${isFolder ? '' : '.' + file.extension}`);
      if (this.app.vault.getAbstractFileByPath(newPath)) return new Notice('That name already exists.');
      const oldPath = file.path;
      const overview = isFolder ? file.children.find((c) => c instanceof TFile && c.basename === file.name) : null;
      await this.app.fileManager.renameFile(file, newPath);
      if (overview) await this.app.fileManager.renameFile(overview, normalizePath(`${file.path}/${clean}.md`));
      this.afterMove(oldPath, file.path, current, file.name);
    }).open();
  }

  /** Keep the panel's remembered state pointing at the renamed/moved thing. */
  afterMove(oldPath, newPath, oldName, newName) {
    if (this.data.current === oldName && oldPath.split('/').length === 2) { this.data.current = newName; this.save(); }
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
      const v = leaf.view;
      if (!(v instanceof SubjectView)) continue;
      if (v.openTopics.delete(oldPath)) v.openTopics.add(newPath);
      for (const k of Object.keys(v.browse)) if (v.browse[k] === oldPath) v.browse[k] = newPath;
    }
    this.refreshViews();
  }

  moveItem(file) {
    const isFolder = file instanceof TFolder;
    const folders = this.app.vault.getAllLoadedFiles().filter((f) =>
      f instanceof TFolder && f !== file.parent && !f.path.startsWith('.')
      && !(isFolder && (f.path === file.path || f.path.startsWith(file.path + '/'))));
    new FolderSuggest(this.app, folders, async (dest) => {
      const newPath = normalizePath(`${dest.isRoot() ? '' : dest.path}/${file.name}`);
      if (this.app.vault.getAbstractFileByPath(newPath)) return new Notice('The destination folder already has an item with that name.');
      const oldPath = file.path;
      await this.app.fileManager.renameFile(file, newPath);
      this.afterMove(oldPath, file.path, file.name, file.name);
    }).open();
  }

  /** Move a note/folder into `dest` (used by drag & drop). Links are rewritten by renameFile. */
  async moveTo(file, dest) {
    const newPath = normalizePath(`${dest.isRoot() ? '' : dest.path}/${file.name}`);
    if (this.app.vault.getAbstractFileByPath(newPath)) return new Notice('The destination folder already has an item with that name.');
    const oldPath = file.path;
    await this.app.fileManager.renameFile(file, newPath);
    this.afterMove(oldPath, file.path, file.name, file.name);
    new Notice(`Moved "${file.name}" to "${dest.isRoot() ? '/' : cleanName(dest.name)}".`);
  }

  /** Move a note/folder into the archive folder. Links keep working because renameFile rewrites them. */
  async archiveItem(file) {
    if (!this.app.vault.getAbstractFileByPath(ARCHIVE_FOLDER)) await this.app.vault.createFolder(ARCHIVE_FOLDER);
    // if the name is taken in the archive, add " (2)", " (3)" ... before the extension
    const isFolder = file instanceof TFolder;
    const stem = isFolder ? file.name : file.basename;
    const ext = isFolder ? '' : '.' + file.extension;
    let target = normalizePath(`${ARCHIVE_FOLDER}/${stem}${ext}`);
    for (let n = 2; this.app.vault.getAbstractFileByPath(target); n++) target = normalizePath(`${ARCHIVE_FOLDER}/${stem} (${n})${ext}`);
    const oldPath = file.path;
    await this.app.fileManager.renameFile(file, target);
    this.afterMove(oldPath, file.path, stem, stem);
    new Notice(`"${stem}" is now in the archive.`);
  }

  async duplicateItem(file) {
    const parent = file.parent.isRoot() ? '' : file.parent.path;
    let path, n = 1;
    do {
      path = normalizePath(`${parent}/${file.basename} copy${n > 1 ? ' ' + n : ''}.${file.extension}`);
      n++;
    } while (this.app.vault.getAbstractFileByPath(path));
    await this.app.vault.copy(file, path);
  }

  /** Delete = move to the trash (recoverable), after a confirmation. */
  deleteItem(file) {
    if (PROTECTED.has(file.path)) return;
    const isFolder = file instanceof TFolder;
    const n = isFolder ? countFiles(file) : 0;
    const text = isFolder
      ? `The folder "${file.name}" and its contents (${n} ${plural(n, 'file', 'files')}) will go to the trash.`
      : `"${file.name}" will go to the trash.`;
    const doDelete = async () => { await this.app.fileManager.trashFile(file); this.refreshViews(); };
    if (!CFG.confirmDelete) { doDelete(); return; }
    new ConfirmModal(this.app, { title: 'Delete?', text, cta: 'Delete' }, doDelete).open();
  }

  async createFolder(parent, title) {
    const clean = cleanTitle(title);
    if (!clean) return;
    const path = normalizePath(`${parent.path}/${clean}`);
    if (this.app.vault.getAbstractFileByPath(path)) return new Notice('A folder with that name already exists.');
    await this.app.vault.createFolder(path);
  }
};
