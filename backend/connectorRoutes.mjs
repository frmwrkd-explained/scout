// Routes for agent connectors and in-app AI. Registered from backend/index.mjs.
//
//   GET  /api/connectors                 what Scout would write for each agent app, and what is there now
//   POST /api/connectors/:id/install     add or refresh Scout's entry in that app's config   (person only)
//   POST /api/connectors/:id/remove      take Scout's entry out again                        (person only)
//   POST /api/ai/ask                     ask the brain about one record — answers and proposals, never a write
//   POST /api/mcp                        the MCP door over HTTP, for agents that connect by address
//
// None of these is an Index line: connecting an agent and asking the in-app AI are things a PERSON
// does on a screen, so they are not tools an agent is handed.

import { DEFAULT_ACTOR } from './actors.mjs';
import { connectorStatus, installConnector, removeConnector } from './connectors.mjs';
import { askAi } from './askAi.mjs';
import { handleHttp } from './mcp.mjs';

export function registerConnectorRoutes(app) {
  const send = (res, error) => res.status(error.status || 400).json({ error: error.message, ...(error.extra || {}) });
  const route = fn => (req, res) => { try { res.json(fn(req)); } catch (error) { send(res, error); } };
  const actorOf = req => (req.body && req.body.actor) || req.query.actor || DEFAULT_ACTOR;

  app.get('/api/connectors', route(() => connectorStatus()));
  app.post('/api/connectors/:id/install', route(req => installConnector(req.params.id, { actor: actorOf(req), hash: req.body && req.body.hash })));
  app.post('/api/connectors/:id/remove', route(req => removeConnector(req.params.id, { actor: actorOf(req) })));

  app.post('/api/ai/ask', async (req, res) => {
    try { res.json(await askAi(req.body || {}, { actor: actorOf(req) })); }
    catch (error) { send(res, error); }
  });

  // GET would open a server-to-client stream, which this server does not offer; the MCP transport
  // spec says to answer 405 in that case.
  app.all('/api/mcp', (req, res) => handleHttp(req, res));
}
