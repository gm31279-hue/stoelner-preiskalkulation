'use strict';

// Einfacher Server-Sent-Events-Hub: Clients abonnieren, bei Datenänderung
// erhalten alle einen "refresh"-Ping und laden neu.

const clients = new Set();

function addClient(res) {
  clients.add(res);
  res.on('close', () => clients.delete(res));
}

function broadcast(type, payload = {}) {
  const data = `data: ${JSON.stringify({ type, ...payload, ts: Date.now() })}\n\n`;
  for (const res of clients) {
    try { res.write(data); } catch { clients.delete(res); }
  }
}

function clientCount() {
  return clients.size;
}

module.exports = { addClient, broadcast, clientCount };
