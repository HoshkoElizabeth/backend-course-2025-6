const http = require('http');
const { Command } = require('commander');
const fs = require('fs');
const path = require('path');

const express = require('express');
const multer = require('multer');

// ---------- 1. Парсимо аргументи командного рядка ----------

const program = new Command();

program
  .requiredOption('-h, --host <host>', 'Server host address')
  .requiredOption('-p, --port <port>', 'Server port')
  .requiredOption('-c, --cache <path>', 'Cache directory path')
  .parse();

const options = program.opts();

// ---------- 2. Підготовка кеш-директорії ----------

if (!fs.existsSync(options.cache)) {
  fs.mkdirSync(options.cache, { recursive: true });
  console.log(`Cache directory created: ${options.cache}`);
}

const INVENTORY_FILE = path.join(options.cache, 'inventory.json');

// ---------- 3. "База даних" у файлі inventory.json ----------

function loadInventory() {
  if (!fs.existsSync(INVENTORY_FILE)) {
    return [];
  }
  try {
    const raw = fs.readFileSync(INVENTORY_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    console.error('Error reading inventory file:', err);
    return [];
  }
}

function saveInventory(data) {
  fs.writeFileSync(INVENTORY_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

let inventory = loadInventory();
let nextId =
  inventory.length > 0
    ? inventory.reduce((max, item) => Math.max(max, item.id), 0) + 1
    : 1;

function findItem(id) {
  return inventory.find((item) => item.id === id);
}

function itemToDTO(req, item) {
  const baseUrl = `${req.protocol}://${req.headers.host}`;
  return {
    id: item.id,
    inventory_name: item.inventory_name,
    description: item.description,
    photo_url: item.photoFilename
      ? `${baseUrl}/inventory/${item.id}/photo`
      : null,
  };
}

// ---------- 4. Налаштування Express ----------

const app = express();

// Для JSON (PUT /inventory/:id)
app.use(express.json());

// Для x-www-form-urlencoded (POST /search)
app.use(express.urlencoded({ extended: false }));

// Видача статичних HTML файлів викладача (форми)
app.get('/RegisterForm.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'RegisterForm.html'));
});

app.get('/SearchForm.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'SearchForm.html'));
});

// ---------- 5. Multer для завантаження фото ----------

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, options.cache); // фото в кеш-директорію
  },
  filename: (req, file, cb) => {
    const uniqueName = `photo_${Date.now()}_${file.originalname}`;
    cb(null, uniqueName);
  },
});

const upload = multer({ storage });

// ---------- 6. Ендпоінти WebAPI (усе в JSON, крім фото) ----------

// POST /register — реєстрація нової речі (multipart/form-data)
app.post('/register', upload.single('photo'), (req, res) => {
  const { inventory_name, description } = req.body;

  if (!inventory_name || inventory_name.trim() === '') {
    return res.status(400).json({ error: 'inventory_name is required' });
  }

  const newItem = {
    id: nextId++,
    inventory_name: inventory_name.trim(),
    description: description || '',
    photoFilename: req.file ? req.file.filename : null,
  };

  inventory.push(newItem);
  saveInventory(inventory);

  return res.status(201).json(itemToDTO(req, newItem));
});

// 405 для інших методів на /register
app.all('/register', (req, res, next) => {
  if (req.method === 'POST') return next();
  return res.status(405).json({ error: 'Method Not Allowed' });
});

// GET /inventory — список усіх речей
app.get('/inventory', (req, res) => {
  const data = inventory.map((item) => itemToDTO(req, item));
  return res.status(200).json(data);
});

// 405 для інших методів на /inventory
app.all('/inventory', (req, res, next) => {
  if (req.method === 'GET') return next();
  return res.status(405).json({ error: 'Method Not Allowed' });
});

// GET /inventory/:id — інформація про конкретну річ
app.get('/inventory/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const item = findItem(id);

  if (!item) {
    return res.status(404).json({ error: 'Item not found' });
  }

  return res.status(200).json(itemToDTO(req, item));
});

// PUT /inventory/:id — оновлення ім'я/опису (JSON body)
app.put('/inventory/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const item = findItem(id);

  if (!item) {
    return res.status(404).json({ error: 'Item not found' });
  }

  const { inventory_name, description } = req.body;

  if (inventory_name !== undefined) {
    item.inventory_name = inventory_name;
  }
  if (description !== undefined) {
    item.description = description;
  }

  saveInventory(inventory);
  return res.status(200).json(itemToDTO(req, item));
});

// DELETE /inventory/:id — видалення речі
app.delete('/inventory/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const index = inventory.findIndex((item) => item.id === id);

  if (index === -1) {
    return res.status(404).json({ error: 'Item not found' });
  }

  const [removed] = inventory.splice(index, 1);
  saveInventory(inventory);

  // опційно: видаляємо фото з диска
  if (removed.photoFilename) {
    const photoPath = path.join(options.cache, removed.photoFilename);
    if (fs.existsSync(photoPath)) {
      fs.unlinkSync(photoPath);
    }
  }

  return res.status(200).json({ message: 'Item deleted' });
});

// 405 для інших методів на /inventory/:id
app.all('/inventory/:id', (req, res, next) => {
  if (['GET', 'PUT', 'DELETE'].includes(req.method)) return next();
  return res.status(405).json({ error: 'Method Not Allowed' });
});

// GET /inventory/:id/photo — віддати зображення (image/jpeg)
app.get('/inventory/:id/photo', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const item = findItem(id);

  if (!item || !item.photoFilename) {
    return res.status(404).json({ error: 'Photo not found' });
  }

  const photoPath = path.join(options.cache, item.photoFilename);

  if (!fs.existsSync(photoPath)) {
    return res.status(404).json({ error: 'Photo file not found' });
  }

  res.set('Content-Type', 'image/jpeg');
  return res.status(200).sendFile(photoPath);
});

// PUT /inventory/:id/photo — оновити фото (multipart/form-data)
app.put('/inventory/:id/photo', upload.single('photo'), (req, res) => {
  const id = parseInt(req.params.id, 10);
  const item = findItem(id);

  if (!item) {
    return res.status(404).json({ error: 'Item not found' });
  }

  if (!req.file) {
    return res.status(400).json({ error: 'photo is required' });
  }

  item.photoFilename = req.file.filename;
  saveInventory(inventory);

  return res.status(200).json(itemToDTO(req, item));
});

// 405 для інших методів на /inventory/:id/photo
app.all('/inventory/:id/photo', (req, res, next) => {
  if (['GET', 'PUT'].includes(req.method)) return next();
  return res.status(405).json({ error: 'Method Not Allowed' });
});

// POST /search — пошук за ID (x-www-form-urlencoded), ВІДПОВІДЬ У JSON
app.post('/search', (req, res) => {
  const id = parseInt(req.body.id, 10);
  if (Number.isNaN(id)) {
    return res.status(400).json({ error: 'Invalid id' });
  }

  const item = findItem(id);
  if (!item) {
    return res.status(404).json({ error: 'Item not found' });
  }

  const baseUrl = `${req.protocol}://${req.headers.host}`;
  const includePhoto = req.body.has_photo === 'on';

  return res.status(200).json({
    id: item.id,
    inventory_name: item.inventory_name,
    description: item.description,
    has_photo: !!item.photoFilename,
    photo_url:
      includePhoto && item.photoFilename
        ? `${baseUrl}/inventory/${item.id}/photo`
        : null,
  });
});

// 405 для інших методів на /search
app.all('/search', (req, res, next) => {
  if (req.method === 'POST') return next();
  return res.status(405).json({ error: 'Method Not Allowed' });
});

// Глобальний 404 для всіх інших маршрутів
app.use((req, res) => {
  return res.status(404).json({ error: 'Not Found' });
});

// ---------- 7. Створюємо HTTP сервер і запускаємо ----------

const server = http.createServer(app);

server.listen(options.port, options.host, () => {
  console.log(`Server running at http://${options.host}:${options.port}`);
  console.log(`Cache directory: ${options.cache}`);
});
