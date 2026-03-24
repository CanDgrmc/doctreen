'use strict';

/**
 * example/fastify-app.js
 *
 * Demonstrates doctreen's Fastify adapter with three schema sources:
 *   1. defineRoute  — explicit schemas; shown in docs immediately
 *   2. Fastify-native JSON Schema (the `schema` option on a route)
 *   3. JSDoc block comments — zero-import fallback
 *
 * ─── Quick start ──────────────────────────────────────────────────────────────
 * 1.  npm run example:fastify
 * 2.  Open http://localhost:3001/api/docs
 *
 * ─── Curl examples ────────────────────────────────────────────────────────────
 * curl -s 'http://localhost:3001/users?page=1&limit=10' | jq
 * curl -s  http://localhost:3001/users/42 | jq
 * curl -s -X POST http://localhost:3001/users \
 *      -H 'Content-Type: application/json' \
 *      -d '{"name":"Alice","email":"alice@example.com","role":"admin"}' | jq
 * curl -s -X PUT http://localhost:3001/users/42 \
 *      -H 'Content-Type: application/json' \
 *      -d '{"name":"Alice Johnson","email":"alice.j@example.com"}' | jq
 * curl -s -X DELETE http://localhost:3001/users/42 | jq
 *
 * curl -s 'http://localhost:3001/products?category=electronics' | jq
 * curl -s  http://localhost:3001/products/7 | jq
 * curl -s -X POST http://localhost:3001/products \
 *      -H 'Content-Type: application/json' \
 *      -d '{"name":"Keyboard","price":79.99,"category":"electronics","inStock":true}' | jq
 *
 * curl -s -X POST http://localhost:3001/auth/login \
 *      -H 'Content-Type: application/json' \
 *      -d '{"email":"alice@example.com","password":"s3cr3t"}' | jq
 */

const fastify = require('fastify')({ logger: false });
const { fastifyAdapter, defineRoute, defineSchema, s } = require('../src/adapters/fastify');

// ─────────────────────────────────────────────────────────────────────────────
// Step 1 — Call fastifyAdapter BEFORE registering routes
// ─────────────────────────────────────────────────────────────────────────────

fastifyAdapter(fastify, {
  docsPath: '/api/docs',
  meta: {
    title:       'My Fastify API',
    version:     '1.0.0',
    description: 'Demo API built with Fastify and DocTreen.',
  },
  exclude: ['/health'],
  liveReload: true,
});

// ─────────────────────────────────────────────────────────────────────────────
// Step 2 — Define reusable named schemas
// ─────────────────────────────────────────────────────────────────────────────

const UserSchema = defineSchema('User', s.object({
  id:        s.number(),
  name:      s.string(),
  email:     s.string(),
  role:      s.string(),
  active:    s.boolean(),
  createdAt: s.string(),
}));

defineSchema('Product', s.object({
  id:        s.number(),
  name:      s.string(),
  price:     s.number(),
  category:  s.string(),
  inStock:   s.boolean(),
  createdAt: s.string(),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Users resource
// ─────────────────────────────────────────────────────────────────────────────

// JSDoc source — no imports needed in the handler file
fastify.get('/users', function listUsers(req, reply) {
  /**
   * List all users
   * @param   {number}  [query.page]   - Page number (default 1)
   * @param   {number}  [query.limit]  - Results per page (default 20)
   * @param   {string}  [query.search] - Full-text search term
   * @response {User[]} users
   * @response {number} total
   * @response {number} page
   * @response {number} limit
   * @header  Authorization - Bearer <token>
   */
  const { page = 1, limit = 20, search = '' } = req.query;
  reply.send({
    users: [
      { id: 1, name: 'Alice Smith', email: 'alice@example.com', role: 'admin', active: true,  createdAt: '2024-01-15T10:00:00Z' },
      { id: 2, name: 'Bob Jones',   email: 'bob@example.com',   role: 'user',  active: false, createdAt: '2024-02-20T09:30:00Z' },
    ],
    total:  2,
    page:   Number(page),
    limit:  Number(limit),
    search: String(search),
  });
});

// defineRoute — explicit schemas + error responses
fastify.get('/users/:id', {
  handler: defineRoute(
    async function getUserById(req, reply) {
      reply.send({
        id:        Number(req.params.id),
        name:      'Alice Smith',
        email:     'alice@example.com',
        role:      'admin',
        active:    true,
        createdAt: '2024-01-15T10:00:00Z',
      });
    },
    {
      response: UserSchema,
      headers:  { Authorization: 'Bearer <token>' },
      errors: {
        401: 'Missing or invalid Authorization header',
        404: 'User not found',
      },
    }
  ),
});

// defineRoute with full request + response schemas
fastify.post('/users', {
  handler: defineRoute(
    async function createUser(req, reply) {
      const { name, email, role = 'user' } = req.body;
      reply.status(201).send({
        id:        101,
        name,
        email,
        role,
        active:    true,
        createdAt: new Date().toISOString(),
      });
    },
    {
      request: {
        body: s.object({
          name:  s.string(),
          email: s.string(),
          role:  s.optional(s.string()),
        }),
        query: null,
      },
      response: UserSchema,
      headers: {
        Authorization:  'Bearer <token>',
        'Content-Type': 'application/json',
      },
      errors: {
        409: 'Email address already in use',
        422: { description: 'Validation failed', schema: s.object({ message: s.string(), field: s.string() }) },
      },
    }
  ),
});

// Fastify native JSON Schema — doctreen reads it automatically
fastify.put('/users/:id', {
  schema: {
    description: 'Replace a user record',
    body: {
      type: 'object',
      required: ['name', 'email'],
      properties: {
        name:  { type: 'string' },
        email: { type: 'string' },
      },
    },
    response: {
      200: {
        type: 'object',
        properties: {
          id:        { type: 'number' },
          name:      { type: 'string' },
          email:     { type: 'string' },
          updatedAt: { type: 'string' },
        },
      },
    },
  },
  handler: async function updateUser(req, reply) {
    const { name, email } = req.body;
    reply.send({
      id:        Number(req.params.id),
      name,
      email,
      updatedAt: new Date().toISOString(),
    });
  },
});

fastify.delete('/users/:id', {
  handler: defineRoute(
    async function deleteUser(req, reply) {
      reply.send({ deleted: true, id: Number(req.params.id) });
    },
    {
      response: s.object({ deleted: s.boolean(), id: s.number() }),
      headers:  { Authorization: 'Bearer <token>' },
      errors: {
        401: 'Unauthorized',
        403: 'Forbidden — cannot delete another admin account',
        404: 'User not found',
      },
    }
  ),
});

// ─────────────────────────────────────────────────────────────────────────────
// Products resource
// ─────────────────────────────────────────────────────────────────────────────

fastify.get('/products', function listProducts(req, reply) {
  /**
   * List all products
   * @param   {string}  [query.category] - Filter by category
   * @param   {number}  [query.minPrice] - Minimum price
   * @param   {number}  [query.maxPrice] - Maximum price
   * @response {Product[]} products
   * @response {number}    total
   * @response {object}    filters
   */
  const { category = '', minPrice = 0, maxPrice = 9999 } = req.query;
  reply.send({
    products: [
      { id: 1, name: 'Keyboard',   price: 79.99, category: 'electronics', inStock: true,  createdAt: '2024-03-01T08:00:00Z' },
      { id: 2, name: 'Desk Lamp',  price: 34.50, category: 'furniture',   inStock: true,  createdAt: '2024-03-05T10:00:00Z' },
      { id: 3, name: 'Coffee Mug', price:  9.99, category: 'kitchen',     inStock: false, createdAt: '2024-03-10T12:00:00Z' },
    ],
    total:   3,
    filters: { category: String(category), minPrice: Number(minPrice), maxPrice: Number(maxPrice) },
  });
});

// Fastify native JSON Schema
fastify.get('/products/:productId', {
  schema: {
    description: 'Get a product by ID',
    response: {
      200: {
        type: 'object',
        properties: {
          id:        { type: 'number' },
          name:      { type: 'string' },
          price:     { type: 'number' },
          category:  { type: 'string' },
          inStock:   { type: 'boolean' },
          createdAt: { type: 'string' },
        },
      },
    },
  },
  handler: async function getProductById(req, reply) {
    reply.send({
      id:        Number(req.params.productId),
      name:      'Wireless Mouse',
      price:     29.99,
      category:  'electronics',
      inStock:   true,
      createdAt: '2024-03-10T08:30:00Z',
    });
  },
});

fastify.post('/products', {
  handler: defineRoute(
    async function createProduct(req, reply) {
      const { name, price, category, inStock = true } = req.body;
      reply.status(201).send({
        id:        202,
        name,
        price:     Number(price),
        category,
        inStock:   Boolean(inStock),
        createdAt: new Date().toISOString(),
      });
    },
    {
      request: {
        body: s.object({
          name:     s.string(),
          price:    s.number(),
          category: s.string(),
          inStock:  s.optional(s.boolean()),
        }),
        query: null,
      },
      response: /** @type {import('../src/index').SchemaNode} */ (/** @type {unknown} */ (defineSchema('Product', s.object({
        id:        s.number(),
        name:      s.string(),
        price:     s.number(),
        category:  s.string(),
        inStock:   s.boolean(),
        createdAt: s.string(),
      })))),
      headers: {
        Authorization:  'Bearer <token>',
        'Content-Type': 'application/json',
      },
    }
  ),
});

// ─────────────────────────────────────────────────────────────────────────────
// Auth endpoints
// ─────────────────────────────────────────────────────────────────────────────

fastify.post('/auth/login', {
  handler: defineRoute(
    async function login(req, reply) {
      const { email } = req.body;
      reply.send({
        token:        'eyJhbGciOiJIUzI1NiJ9.example',
        refreshToken: 'rt_abc123xyz',
        expiresIn:    3600,
        user: { id: 1, email, role: 'admin' },
      });
    },
    {
      request: {
        body:  s.object({ email: s.string(), password: s.string() }),
        query: null,
      },
      response: s.object({
        token:        s.string(),
        refreshToken: s.string(),
        expiresIn:    s.number(),
        user:         s.object({ id: s.number(), email: s.string(), role: s.string() }),
      }),
      headers: { 'Content-Type': 'application/json' },
      errors: {
        401: { description: 'Invalid email or password',                          schema: s.object({ message: s.string() }) },
        422: { description: 'Validation failed — missing required fields',        schema: s.object({ message: s.string(), field: s.string() }) },
      },
    }
  ),
});

fastify.post('/auth/logout', function logout(_req, reply) {
  /**
   * Invalidate the current session
   * @param   {string} body.refreshToken - Refresh token to revoke
   * @response {boolean} success
   * @response {string}  message
   * @header  Authorization - Bearer <token>
   * @header  Content-Type  - application/json
   */
  reply.send({ success: true, message: 'Logged out successfully' });
});

fastify.post('/auth/refresh', function refreshToken(_req, reply) {
  /**
   * Exchange a refresh token for a new access token
   * @param   {string} body.refreshToken - Valid refresh token
   * @response {string} token
   * @response {number} expiresIn
   * @header  Content-Type - application/json
   */
  reply.send({
    token:     'eyJhbGciOiJIUzI1NiJ9.refreshed',
    expiresIn: 3600,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Hidden / utility endpoints
// ─────────────────────────────────────────────────────────────────────────────

fastify.get('/health', (_req, reply) => reply.send({ status: 'ok' }));

// ─────────────────────────────────────────────────────────────────────────────
// Start
// ─────────────────────────────────────────────────────────────────────────────

const PORT = Number(process.env.PORT) || 3001;

fastify.listen({ port: PORT, host: '0.0.0.0' }, function (err) {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log('');
  console.log('  Server running  →  http://localhost:' + PORT);
  console.log('  API Docs        →  http://localhost:' + PORT + '/api/docs');
  console.log('');
});
