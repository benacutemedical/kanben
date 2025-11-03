const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 8000;
const ROOT_DIR = __dirname;
const DATA_DIR = path.join(ROOT_DIR, 'data');
const UPLOADS_DIR = path.join(ROOT_DIR, 'uploads');
const STATE_FILE = path.join(DATA_DIR, 'state.json');

const DEFAULT_STATE = {
  projects: {},
  order: [],
  logoUrl: ''
};

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

async function readState() {
  try {
    const raw = await fsp.readFile(STATE_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') {
      await writeState(DEFAULT_STATE);
      return { ...DEFAULT_STATE };
    }
    console.error('[state] read error:', err);
    throw err;
  }
}

async function writeState(state) {
  const data = JSON.stringify(state, null, 2);
  await fsp.writeFile(STATE_FILE, data, 'utf8');
}

let stateCache = { ...DEFAULT_STATE };

readState()
  .then((data) => {
    stateCache = sanitizeState(data);
    return writeState(stateCache);
  })
  .catch((err) => {
    console.error('Failed to initialize state file:', err);
  });

function sanitizeState(raw) {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_STATE };
  }

  const sanitized = {
    projects: {},
    order: Array.isArray(raw.order) ? raw.order.filter(Boolean) : [],
    logoUrl: typeof raw.logoUrl === 'string' ? raw.logoUrl : ''
  };

  if (raw.projects && typeof raw.projects === 'object') {
    for (const [name, project] of Object.entries(raw.projects)) {
      if (!project || typeof project !== 'object') continue;
      const columns = Array.isArray(project.columns) && project.columns.length
        ? project.columns.map((col, idx) => ({
            id: col && col.id ? String(col.id) : `col-${idx}`,
            name: col && col.name ? String(col.name) : `Column ${idx + 1}`
          }))
        : [
            { id: 'todo', name: 'To Do' },
            { id: 'doing', name: 'Doing' },
            { id: 'done', name: 'Done' }
          ];

      const tasks = project.tasks && typeof project.tasks === 'object' ? project.tasks : {};

      sanitized.projects[name] = {
        name: project.name || name,
        columns,
        tasks,
        color: project.color || '#ffffff',
        collapsed: Boolean(project.collapsed)
      };
    }
  }

  sanitized.order = sanitized.order.filter((name) => sanitized.projects[name]);
  for (const name of Object.keys(sanitized.projects)) {
    if (!sanitized.order.includes(name)) {
      sanitized.order.push(name);
    }
  }

  return sanitized;
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const category = sanitizeSegment(req.query.category || 'attachments');
    const idSegment = req.query.id ? sanitizeSegment(req.query.id) : 'global';
    const dir = path.join(UPLOADS_DIR, category, idSegment);
    fs.mkdir(dir, { recursive: true }, (err) => cb(err, dir));
  },
  filename: (req, file, cb) => {
    const timestamp = Date.now();
    const safeName = sanitizeFilename(file.originalname || 'file');
    cb(null, `${timestamp}-${safeName}`);
  }
});

const upload = multer({ storage });

function sanitizeSegment(segment) {
  return String(segment || '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-');
}

function sanitizeFilename(filename) {
  return String(filename || '')
    .replace(/[^a-zA-Z0-9.\-_/]/g, '_')
    .replace(/_{2,}/g, '_');
}

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use('/uploads', express.static(UPLOADS_DIR));
app.use(express.static(ROOT_DIR));

app.get('/api/health', (req, res) => {
  res.json({ ok: true, updated: stateCache?.updatedAt || null });
});

app.get('/api/state', (req, res) => {
  res.json(stateCache);
});

app.post('/api/state', async (req, res) => {
  try {
    const incoming = sanitizeState(req.body);
    incoming.updatedAt = new Date().toISOString();
    stateCache = incoming;
    await writeState(stateCache);
    res.json({ ok: true });
  } catch (err) {
    console.error('Failed to save state:', err);
    res.status(500).json({ error: 'Failed to save state' });
  }
});

app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file received' });
  }

  const relativePath = path
    .relative(UPLOADS_DIR, req.file.path)
    .split(path.sep)
    .join('/');

  res.json({
    ok: true,
    url: `/uploads/${relativePath}`
  });
});

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Server error' });
});

app.listen(PORT, () => {
  console.log(`Kanben app listening on http://localhost:${PORT}`);
});
