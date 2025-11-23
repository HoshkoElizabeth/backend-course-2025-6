const http = require('http');
const { Command } = require('commander');
const fs = require('fs');
const path = require('path');

// Парсинг аргументів командного рядка
const program = new Command();
program
  .requiredOption('-h, --host <host>', 'Server host address')
  .requiredOption('-p, --port <port>', 'Server port')
  .requiredOption('-c, --cache <path>', 'Cache directory path')
  .parse();

const options = program.opts();

// Створення директорії кешу якщо не існує
if (!fs.existsSync(options.cache)) {
  fs.mkdirSync(options.cache, { recursive: true });
  console.log(`Cache directory created: ${options.cache}`);
}

// Створення HTTP сервера
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Inventory Server is running!');
});

// Запуск сервера з використанням http.Server.listen()
server.listen(options.port, options.host, () => {
  console.log(`Server running at http://${options.host}:${options.port}`);
  console.log(`Cache directory: ${options.cache}`);
});