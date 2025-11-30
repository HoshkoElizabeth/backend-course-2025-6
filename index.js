const http = require('http');
const { Command } = require('commander');
const fs = require('fs');
const path = require('path');

const express = require('express');
const multer = require('multer');
const swaggerUi = require('swagger-ui-express');
const swaggerJsdoc = require('swagger-jsdoc');

// ---------- 1. Парсимо аргументи командного рядка ----------

const program = new Command();

program
  .requiredOption('-h, --host <host>', 'Server host address')
  .requiredOption('-p, --port <port>', 'Server port')
  .requiredOption('-c, --cache <path>', 'Cache directory path')
  .parse();

const options = program.opts();

// ---------- 2. Swagger конфіг ----------

const swaggerDefinition = {
  openapi: '3.0.0',
  info: {
    title: 'Inventory Service API',
    version: '1.0.0',
    description: 'Сервіс інвентаризації для лабораторної роботи №6',
  },
  servers: [
    {
      url: `http://${options.host}:${options.port}`,
    },
  ],
};

const swaggerOptions = {
  swaggerDefinition,
  apis: [__filename], // шукати JSDoc-коментарі в цьому файлі
};

const swaggerSpec = swaggerJsdoc(swaggerOptions);

// ---------- 3. Підготовка кеш-директорії та "бази" ----------

if (!fs.existsSync(options.cache)) {
  fs.mkdirSync(options.cache, { recursive: true });
  console.log(`Cache directory created: ${options.cache}`);
}

const INVENTORY_FILE = path.join(options.cache, 'inventory.json');

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

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Віддаємо HTML-форми (викладацькі файли)
app.get('/RegisterForm.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'RegisterForm.html'));
});

app.get('/SearchForm.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'SearchForm.html'));
});

// Swagger UI
app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// ---------- 5. Multer для завантаження фото ----------

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, options.cache);
  },
  filename: (req, file, cb) => {
    const uniqueName = `photo_${Date.now()}_${file.originalname}`;
    cb(null, uniqueName);
  },
});

const upload = multer({ storage });

// ---------- 6. Swagger-схеми та ендпоінти ----------

/**
 * @swagger
 * components:
 *   schemas:
 *     InventoryItem:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *           description: Унікальний ідентифікатор інвентарної речі
 *         inventory_name:
 *           type: string
 *           description: Назва речі
 *         description:
 *           type: string
 *           description: Опис речі
 *         photo_url:
 *           type: string
 *           nullable: true
 *           description: URL для отримання фото речі
 */

/**
 * @swagger
 * /register:
 *   post:
 *     summary: Реєстрація нової інвентарної речі
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               inventory_name:
 *                 type: string
 *                 description: Назва речі (обов'язково)
 *               description:
 *                 type: string
 *                 description: Опис речі
 *               photo:
 *                 type: string
 *                 format: binary
 *                 description: Фото речі
 *     responses:
 *       201:
 *         description: Річ успішно зареєстрована
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/InventoryItem'
 *       400:
 *         description: Некоректні дані (немає назви)
 */
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

/**
 * @swagger
 * /inventory:
 *   get:
 *     summary: Отримати список усіх інвентарних речей
 *     responses:
 *       200:
 *         description: Список інвентарю
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/InventoryItem'
 */
app.get('/inventory', (req, res) => {
  const data = inventory.map((item) => itemToDTO(req, item));
  return res.status(200).json(data);
});

// 405 для інших методів на /inventory
app.all('/inventory', (req, res, next) => {
  if (req.method === 'GET') return next();
  return res.status(405).json({ error: 'Method Not Allowed' });
});

/**
 * @swagger
 * /inventory/{id}:
 *   get:
 *     summary: Отримати інформацію про конкретну річ
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID інвентарної речі
 *     responses:
 *       200:
 *         description: Знайдена річ
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/InventoryItem'
 *       404:
 *         description: Річ не знайдена
 */
app.get('/inventory/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const item = findItem(id);

  if (!item) {
    return res.status(404).json({ error: 'Item not found' });
  }

  return res.status(200).json(itemToDTO(req, item));
});

/**
 * @swagger
 * /inventory/{id}:
 *   put:
 *     summary: Оновити ім'я або опис речі
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               inventory_name:
 *                 type: string
 *               description:
 *                 type: string
 *     responses:
 *       200:
 *         description: Річ оновлено
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/InventoryItem'
 *       404:
 *         description: Річ не знайдена
 */
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

/**
 * @swagger
 * /inventory/{id}:
 *   delete:
 *     summary: Видалити інвентарну річ
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Річ видалено
 *       404:
 *         description: Річ не знайдена
 */
app.delete('/inventory/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const index = inventory.findIndex((item) => item.id === id);

  if (index === -1) {
    return res.status(404).json({ error: 'Item not found' });
  }

  const [removed] = inventory.splice(index, 1);
  saveInventory(inventory);

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

/**
 * @swagger
 * /inventory/{id}/photo:
 *   get:
 *     summary: Отримати фото речі
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Фото успішно повернуто
 *         content:
 *           image/jpeg:
 *             schema:
 *               type: string
 *               format: binary
 *       404:
 *         description: Фото або річ не знайдені
 */
app.get('/inventory/:id/photo', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const item = findItem(id);

  if (!item || !item.photoFilename) {
    return res.status(404).json({ error: 'Photo not found' });
  }

 const photoPath = path.resolve(options.cache, item.photoFilename);


  if (!fs.existsSync(photoPath)) {
    return res.status(404).json({ error: 'Photo file not found' });
  }

  res.set('Content-Type', 'image/jpeg');
  return res.status(200).sendFile(photoPath);
});

/**
 * @swagger
 * /inventory/{id}/photo:
 *   put:
 *     summary: Оновити фото речі
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               photo:
 *                 type: string
 *                 format: binary
 *     responses:
 *       200:
 *         description: Фото оновлено
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/InventoryItem'
 *       400:
 *         description: Фото не передано
 *       404:
 *         description: Річ не знайдена
 */
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

/**
 * @swagger
 * /search:
 *   post:
 *     summary: Пошук інвентарної речі за ID (через веб-форму)
 *     requestBody:
 *       required: true
 *       content:
 *         application/x-www-form-urlencoded:
 *           schema:
 *             type: object
 *             properties:
 *               id:
 *                 type: integer
 *               has_photo:
 *                 type: string
 *                 description: прапорець "on", якщо потрібно включити посилання на фото
 *     responses:
 *       200:
 *         description: Річ знайдена
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: integer
 *                 inventory_name:
 *                   type: string
 *                 description:
 *                   type: string
 *                 has_photo:
 *                   type: boolean
 *                 photo_url:
 *                   type: string
 *                   nullable: true
 *       400:
 *         description: Некоректний ID
 *       404:
 *         description: Річ не знайдена
 */
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

// Глобальний 404
app.use((req, res) => {
  return res.status(404).json({ error: 'Not Found' });
});

// ---------- 7. Створюємо HTTP-сервер і запускаємо ----------

const server = http.createServer(app);

server.listen(options.port, options.host, () => {
  console.log(`Server running at http://${options.host}:${options.port}`);
  console.log(`Cache directory: ${options.cache}`);
  console.log(`Swagger docs: http://${options.host}:${options.port}/docs`);
});
