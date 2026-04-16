'use strict';

const http     = require('http');
const fs       = require('fs');
const path     = require('path');
const os       = require('os');
const crypto   = require('crypto');
const { exec, execSync } = require('child_process');

// ── Config ────────────────────────────────────────────────────
const PORT      = process.env.PORT      || 19999;
const DESKTOP   = process.env.PROJECTS_DIR || path.join(os.homedir(), 'Desktop');
const DATA_DIR  = process.env.DATA_DIR  || path.join(os.homedir(), '.config', 'fc-dashboard');
const DATA_FILE = path.join(DATA_DIR, 'data.json');
const PUBLIC    = path.join(__dirname, 'public');

// Claude launcher — auto-detect freeclaude or fallback to plain terminal
const CLAUDE_CMD = (() => {
  try {
    const bins = [
      path.join(os.homedir(), '.local', 'bin', 'freeclaude'),
      '/usr/local/bin/freeclaude',
      '/opt/homebrew/bin/claude',
    ];
    for (const b of bins) if (fs.existsSync(b)) return b;
  } catch {}
  return null;
})();

// ── Data helpers ──────────────────────────────────────────────
function loadData() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch { return { projects: {} }; }
}
function saveData(d) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(d, null, 2));
}

// ── Git info ──────────────────────────────────────────────────
function gitInfo(dir, cb) {
  exec(`git -C "${dir}" rev-parse --abbrev-ref HEAD 2>/dev/null`, (_, branch) => {
    exec(`git -C "${dir}" status --porcelain 2>/dev/null`, (_, status) => {
      exec(`git -C "${dir}" log -1 --format="%ar|%s" 2>/dev/null`, (_, log) => {
        const [when = '', msg = ''] = (log || '').trim().split('|');
        cb({ branch: (branch || '').trim() || null, dirty: (status || '').trim().length > 0, lastCommitWhen: when, lastCommitMsg: msg });
      });
    });
  });
}

// ── Utilities ─────────────────────────────────────────────────
function scanDesktop() {
  try {
    return fs.readdirSync(DESKTOP).filter(f => {
      try { return fs.statSync(path.join(DESKTOP, f)).isDirectory() && !f.startsWith('.'); }
      catch { return false; }
    });
  } catch { return []; }
}

function countFiles(dir) {
  try { return fs.readdirSync(dir).filter(f => !f.startsWith('.')).length; }
  catch { return 0; }
}

function json(res, code, data) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise(resolve => {
    let d = '';
    req.on('data', c => d += c);
    req.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve({}); } });
  });
}

// ── Open helpers ──────────────────────────────────────────────
function openBrowser(url)   { exec(`open "${url}"`); }
function openFinder(dir)    { exec(`open "${dir}"`); }
function openVSCode(dir)    { exec(`code "${dir}" 2>/dev/null || open "${dir}"`); }

// ── GitHub helpers ────────────────────────────────────────────
function ghExec(cmd) {
  // find gh binary
  const ghPaths = ['/opt/homebrew/bin/gh', '/usr/local/bin/gh', 'gh'];
  let ghBin = 'gh';
  for (const p of ghPaths) { try { if (fs.existsSync(p)) { ghBin = p; break; } } catch {} }
  return new Promise((resolve, reject) => {
    exec(`${ghBin} ${cmd}`, { env: { ...process.env, HOME: os.homedir() } }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message));
      else resolve(stdout.trim());
    });
  });
}

async function getGhUser() {
  try { return await ghExec('api user --jq .login'); }
  catch { return null; }
}

async function getRemoteUrl(dir) {
  return new Promise(resolve => {
    exec(`git -C "${dir}" remote get-url origin 2>/dev/null`, (_, out) => resolve((out || '').trim() || null));
  });
}

async function createGithubRepo(dir, repoName, description, isPrivate) {
  const visibility = isPrivate ? '--private' : '--public';
  const desc = description ? `--description "${description.replace(/"/g, '\\"')}"` : '';

  // 1. git init if needed
  const hasGit = fs.existsSync(path.join(dir, '.git'));
  if (!hasGit) {
    await new Promise((res, rej) => exec(`git -C "${dir}" init && git -C "${dir}" checkout -b main`, e => e ? rej(e) : res()));
  }

  // 2. Check existing remote
  const existingRemote = await getRemoteUrl(dir);
  if (existingRemote) throw new Error(`Remote already set: ${existingRemote}`);

  // 3. Create repo on GitHub
  const url = await ghExec(`repo create ${repoName} ${visibility} ${desc} --source "${dir}" --push`);

  // 4. If no commits yet, make initial commit then push
  const hasCommits = await new Promise(res => exec(`git -C "${dir}" log --oneline -1 2>/dev/null`, (_, out) => res(!!(out && out.trim()))));
  if (!hasCommits) {
    await new Promise((res, rej) => exec(
      `git -C "${dir}" add . && git -C "${dir}" commit -m "Initial commit" && git -C "${dir}" push -u origin main`,
      e => e ? rej(e) : res()
    ));
  }

  return url || `https://github.com/${await getGhUser()}/${repoName}`;
}

function openTerminalWithClaude(projectPath) {
  const safePath = projectPath.replace(/'/g, "'\\''");
  const cmd = CLAUDE_CMD ? `'${CLAUDE_CMD}'` : 'echo "freeclaude not found — install FC Dashboard CLI"';
  const tmp = `/tmp/fc-open-${Date.now()}.sh`;
  fs.writeFileSync(tmp, [
    '#!/usr/bin/env bash',
    `export PATH="$HOME/.local/bin:/opt/homebrew/opt/node@22/bin:/opt/homebrew/bin:$PATH"`,
    `cd '${safePath}'`,
    cmd,
  ].join('\n') + '\n');
  fs.chmodSync(tmp, '755');

  // macOS Terminal
  if (process.platform === 'darwin') {
    exec(`osascript -e 'tell application "Terminal" to do script "${tmp}"' -e 'tell application "Terminal" to activate'`);
  } else {
    // Linux fallback
    exec(`x-terminal-emulator -e bash "${tmp}" || xterm -e bash "${tmp}"`);
  }
}

// ── HTTP Server ───────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const url    = new URL(req.url, `http://localhost:${PORT}`);
  const method = req.method.toUpperCase();
  const parts  = url.pathname.split('/').filter(Boolean);

  if (method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,DELETE', 'Access-Control-Allow-Headers': 'Content-Type' });
    return res.end();
  }

  // Static files
  if (method === 'GET' && parts[0] !== 'api') {
    const file = parts.length === 0 ? 'index.html' : parts.join('/');
    try {
      const content = fs.readFileSync(path.join(PUBLIC, file));
      const mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript' }[path.extname(file)] || 'text/plain';
      res.writeHead(200, { 'Content-Type': mime });
      return res.end(content);
    } catch {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end(fs.readFileSync(path.join(PUBLIC, 'index.html')));
    }
  }

  // GET /api/config
  if (method === 'GET' && parts[1] === 'config') {
    return json(res, 200, { hasFreeclaude: !!CLAUDE_CMD, projectsDir: DESKTOP, port: PORT });
  }

  // GET /api/projects
  if (method === 'GET' && parts[1] === 'projects' && parts.length === 2) {
    const data = loadData();
    const folders = scanDesktop();
    const result = await Promise.all(folders.map(name => new Promise(resolve => {
      const dir = path.join(DESKTOP, name);
      const meta = data.projects[name] || { links: [], notes: '', created: null };
      gitInfo(dir, git => resolve({
        id: name, name: meta.displayName || name, path: dir,
        files: countFiles(dir), git,
        links: meta.links || [], notes: meta.notes || '',
        created: meta.created || null, emoji: meta.emoji || '📁',
        color: meta.color || null, status: meta.status || 'none',
      }));
    })));
    return json(res, 200, result);
  }

  // POST /api/projects
  if (method === 'POST' && parts[1] === 'projects' && parts.length === 2) {
    const { name, displayName, emoji } = await readBody(req);
    if (!name) return json(res, 400, { error: 'name required' });
    const dir = path.join(DESKTOP, name);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const data = loadData();
    data.projects[name] = { displayName: displayName || name, links: [], notes: '', created: new Date().toISOString(), emoji: emoji || '📁' };
    saveData(data);
    return json(res, 201, { ok: true, path: dir });
  }

  // GET /api/projects/:id
  if (method === 'GET' && parts[1] === 'projects' && parts.length === 3) {
    const id = decodeURIComponent(parts[2]);
    const dir = path.join(DESKTOP, id);
    const data = loadData();
    const meta = data.projects[id] || { links: [], notes: '' };
    gitInfo(dir, git => {
      let files = [];
      try { files = fs.readdirSync(dir).filter(f => !f.startsWith('.')).slice(0, 50); } catch {}
      json(res, 200, { id, name: meta.displayName || id, path: dir, git, files, links: meta.links || [], notes: meta.notes || '', emoji: meta.emoji || '📁' });
    });
    return;
  }

  // POST /api/projects/:id/links
  if (method === 'POST' && parts[1] === 'projects' && parts[3] === 'links') {
    const id = decodeURIComponent(parts[2]);
    const { url: linkUrl, title } = await readBody(req);
    if (!linkUrl) return json(res, 400, { error: 'url required' });
    const data = loadData();
    if (!data.projects[id]) data.projects[id] = { links: [], notes: '' };
    const link = { id: crypto.randomUUID(), url: linkUrl, title: title || linkUrl, added: new Date().toISOString() };
    data.projects[id].links = [...(data.projects[id].links || []), link];
    saveData(data);
    return json(res, 201, link);
  }

  // DELETE /api/projects/:id/links/:lid
  if (method === 'DELETE' && parts[1] === 'projects' && parts[3] === 'links' && parts[4]) {
    const id = decodeURIComponent(parts[2]);
    const data = loadData();
    if (data.projects[id]) {
      data.projects[id].links = (data.projects[id].links || []).filter(l => l.id !== parts[4]);
      saveData(data);
    }
    return json(res, 200, { ok: true });
  }

  // POST /api/projects/:id/status
  if (method === 'POST' && parts[1] === 'projects' && parts[3] === 'status') {
    const id = decodeURIComponent(parts[2]);
    const { status } = await readBody(req);
    const data = loadData();
    if (!data.projects[id]) data.projects[id] = { links: [], notes: '' };
    data.projects[id].status = status || 'none';
    saveData(data);
    return json(res, 200, { ok: true });
  }

  // POST /api/projects/:id/notes
  if (method === 'POST' && parts[1] === 'projects' && parts[3] === 'notes') {
    const id = decodeURIComponent(parts[2]);
    const { notes } = await readBody(req);
    const data = loadData();
    if (!data.projects[id]) data.projects[id] = { links: [], notes: '' };
    data.projects[id].notes = notes || '';
    saveData(data);
    return json(res, 200, { ok: true });
  }

  // POST /api/open-claude
  if (method === 'POST' && parts[1] === 'open-claude') {
    const { projectPath } = await readBody(req);
    openTerminalWithClaude(projectPath || os.homedir());
    return json(res, 200, { ok: true, hasFreeclaude: !!CLAUDE_CMD });
  }

  // POST /api/open-browser
  if (method === 'POST' && parts[1] === 'open-browser') {
    const { url: u } = await readBody(req);
    if (u) openBrowser(u);
    return json(res, 200, { ok: true });
  }

  // POST /api/open-finder
  if (method === 'POST' && parts[1] === 'open-finder') {
    const { projectPath } = await readBody(req);
    if (projectPath) openFinder(projectPath);
    return json(res, 200, { ok: true });
  }

  // POST /api/open-vscode
  if (method === 'POST' && parts[1] === 'open-vscode') {
    const { projectPath } = await readBody(req);
    if (projectPath) openVSCode(projectPath);
    return json(res, 200, { ok: true });
  }

  // GET /api/github/status
  if (method === 'GET' && parts[1] === 'github' && parts[2] === 'status') {
    try {
      const login = await getGhUser();
      return json(res, 200, { ok: !!login, login });
    } catch { return json(res, 200, { ok: false, login: null }); }
  }

  // GET /api/github/remote?path=...
  if (method === 'GET' && parts[1] === 'github' && parts[2] === 'remote') {
    const dir = url.searchParams.get('path');
    if (!dir) return json(res, 400, { error: 'path required' });
    const remote = await getRemoteUrl(dir);
    const hasGit = fs.existsSync(path.join(dir, '.git'));
    return json(res, 200, { remote, hasGit });
  }

  // POST /api/github/create
  if (method === 'POST' && parts[1] === 'github' && parts[2] === 'create') {
    const { projectPath, repoName, description, isPrivate } = await readBody(req);
    if (!projectPath || !repoName) return json(res, 400, { error: 'projectPath and repoName required' });
    try {
      const repoUrl = await createGithubRepo(projectPath, repoName, description, isPrivate);
      return json(res, 200, { ok: true, url: repoUrl });
    } catch(e) {
      return json(res, 500, { error: e.message });
    }
  }

  // POST /api/github/push
  if (method === 'POST' && parts[1] === 'github' && parts[2] === 'push') {
    const { projectPath, message } = await readBody(req);
    if (!projectPath) return json(res, 400, { error: 'projectPath required' });
    const msg = (message || 'Update from FC Dashboard').replace(/"/g, '\\"');
    try {
      await new Promise((res, rej) => exec(
        `git -C "${projectPath}" add . && git -C "${projectPath}" commit -m "${msg}" --allow-empty && git -C "${projectPath}" push`,
        e => e ? rej(e) : res()
      ));
      return json(res, 200, { ok: true });
    } catch(e) {
      return json(res, 500, { error: e.message });
    }
  }

  json(res, 404, { error: 'not found' });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n  \x1b[1m\x1b[38;5;214m◆ FC Dashboard\x1b[0m`);
  console.log(`  \x1b[32m✔\x1b[0m  Running → \x1b[36mhttp://localhost:${PORT}\x1b[0m`);
  console.log(`  \x1b[2m  Projects dir: ${DESKTOP}\x1b[0m`);
  console.log(`  \x1b[2m  FreeClaude:   ${CLAUDE_CMD || 'not found (optional)'}\x1b[0m\n`);
});
