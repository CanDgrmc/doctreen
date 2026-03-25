/**
 * example/hono-app.js
 *
 * Hono JS demo for doctreen.
 *
 * NOTE: Hono v4 is ESM-only. Run this file with tsx, which handles ESM
 * imports from CommonJS-style projects without requiring "type":"module".
 *
 * ─── Quick start ──────────────────────────────────────────────────────────────
 * npm run example:hono
 *  → http://localhost:3002/api/docs
 *
 * ─── Curl examples ────────────────────────────────────────────────────────────
 * curl -s 'http://localhost:3002/users?page=1&limit=10' | jq
 * curl -s  http://localhost:3002/users/42 | jq
 * curl -s -X POST http://localhost:3002/users \
 *      -H 'Content-Type: application/json' \
 *      -d '{"name":"Alice","email":"alice@example.com","role":"admin"}' | jq
 * curl -s -X DELETE http://localhost:3002/users/42 | jq
 * curl -s 'http://localhost:3002/products?category=electronics' | jq
 * curl -s -X POST http://localhost:3002/auth/login \
 *      -H 'Content-Type: application/json' \
 *      -d '{"email":"alice@example.com","password":"s3cr3t"}' | jq
 */

import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { honoAdapter, defineRoute, defineSchema, s } from '../src/adapters/hono.js';

const app = new Hono();

// ─────────────────────────────────────────────────────────────────────────────
// Reusable named schemas
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

// JSDoc source — no imports needed
app.get('/users', function listUsers(c) {
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
  const { page = '1', limit = '20', search = '' } = c.req.query();
  return c.json({
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
app.get('/users/:id', defineRoute(
  function getUserById(c) {
    return c.json({
      id:        Number(c.req.param('id')),
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
));

app.post('/users', defineRoute(
  async function createUser(c) {
    const { name, email, role = 'user' } = await c.req.json();
    return c.json({
      id: 101, name, email, role, active: true, createdAt: new Date().toISOString(),
    }, 201);
  },
  {
    description: 'Create a new user account. Role defaults to "user" if omitted.',
    request: {
      body:  s.object({ name: s.string(), email: s.string(), role: s.optional(s.string()) }),
      query: null,
    },
    response: UserSchema,
    headers:  { Authorization: 'Bearer <token>', 'Content-Type': 'application/json' },
    errors: {
      409: 'Email address already in use',
      422: { description: 'Validation failed', schema: s.object({ message: s.string(), field: s.string() }) },
    },
  }
));

app.put('/users/:id', function updateUser(c) {
  /**
   * Replace a user record
   * @param   {string} body.name  - Updated full name
   * @param   {string} body.email - Updated email address
   * @response {number} id
   * @response {string} name
   * @response {string} email
   * @response {string} updatedAt
   * @header  Authorization - Bearer <token>
   * @header  Content-Type  - application/json
   */
  return c.json({
    id:        Number(c.req.param('id')),
    name:      'Alice Johnson',
    email:     'alice.j@example.com',
    updatedAt: new Date().toISOString(),
  });
});

app.delete('/users/:id', defineRoute(
  function deleteUser(c) {
    return c.json({ deleted: true, id: Number(c.req.param('id')) });
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
));

// ─────────────────────────────────────────────────────────────────────────────
// Products resource
// ─────────────────────────────────────────────────────────────────────────────

app.get('/products', function listProducts(c) {
  /**
   * List all products
   * @param   {string}  [query.category] - Filter by category
   * @param   {number}  [query.minPrice] - Minimum price
   * @param   {number}  [query.maxPrice] - Maximum price
   * @response {Product[]} products
   * @response {number}    total
   * @response {object}    filters
   */
  const { category = '', minPrice = '0', maxPrice = '9999' } = c.req.query();
  return c.json({
    products: [
      { id: 1, name: 'Keyboard',   price: 79.99, category: 'electronics', inStock: true,  createdAt: '2024-03-01T08:00:00Z' },
      { id: 2, name: 'Desk Lamp',  price: 34.50, category: 'furniture',   inStock: true,  createdAt: '2024-03-05T10:00:00Z' },
      { id: 3, name: 'Coffee Mug', price:  9.99, category: 'kitchen',     inStock: false, createdAt: '2024-03-10T12:00:00Z' },
    ],
    total:   3,
    filters: { category: String(category), minPrice: Number(minPrice), maxPrice: Number(maxPrice) },
  });
});

app.get('/products/:productId', function getProductById(c) {
  /**
   * Get a product by ID
   * @returns {Product}
   */
  return c.json({
    id:        Number(c.req.param('productId')),
    name:      'Wireless Mouse',
    price:     29.99,
    category:  'electronics',
    inStock:   true,
    createdAt: '2024-03-10T08:30:00Z',
  });
});

app.post('/products', defineRoute(
  async function createProduct(c) {
    const { name, price, category, inStock = true } = await c.req.json();
    return c.json({
      id: 202, name, price: Number(price), category, inStock: Boolean(inStock),
      createdAt: new Date().toISOString(),
    }, 201);
  },
  {
    description: 'Create a new product listing.',
    request: {
      body: s.object({
        name:     s.string(),
        price:    s.number(),
        category: s.string(),
        inStock:  s.optional(s.boolean()),
      }),
      query: null,
    },
    response: s.object({
      id: s.number(), name: s.string(), price: s.number(),
      category: s.string(), inStock: s.boolean(), createdAt: s.string(),
    }),
    headers: { Authorization: 'Bearer <token>', 'Content-Type': 'application/json' },
  }
));

// ─────────────────────────────────────────────────────────────────────────────
// Auth endpoints
// ─────────────────────────────────────────────────────────────────────────────

app.post('/auth/login', defineRoute(
  async function login(c) {
    const { email } = await c.req.json();
    return c.json({
      token:        'eyJhbGciOiJIUzI1NiJ9.example',
      refreshToken: 'rt_abc123xyz',
      expiresIn:    3600,
      user: { id: 1, email, role: 'admin' },
    });
  },
  {
    description: 'Authenticate with email and password. Returns a JWT access token and a refresh token.',
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
      401: { description: 'Invalid email or password',                   schema: s.object({ message: s.string() }) },
      422: { description: 'Validation failed — missing required fields', schema: s.object({ message: s.string(), field: s.string() }) },
    },
  }
));

app.post('/auth/logout', function logout(c) {
  /**
   * Invalidate the current session
   * @param   {string} body.refreshToken - Refresh token to revoke
   * @response {boolean} success
   * @response {string}  message
   * @header  Authorization - Bearer <token>
   */
  return c.json({ success: true, message: 'Logged out successfully' });
});

app.post('/auth/refresh', function refreshToken(c) {
  /**
   * Exchange a refresh token for a new access token
   * @param   {string} body.refreshToken - Valid refresh token
   * @response {string} token
   * @response {number} expiresIn
   * @header  Content-Type - application/json
   */
  return c.json({ token: 'eyJhbGciOiJIUzI1NiJ9.refreshed', expiresIn: 3600 });
});

// ─────────────────────────────────────────────────────────────────────────────
// Hidden endpoints
// ─────────────────────────────────────────────────────────────────────────────

app.get('/health', (c) => c.json({ status: 'ok' }));

// ─────────────────────────────────────────────────────────────────────────────
// Mount docs — can be called before or after routes; reads lazily at request time
// ─────────────────────────────────────────────────────────────────────────────

honoAdapter(app, {
  docsPath: '/api/docs',
  meta: {
    title:       'My Hono API',
    version:     '1.0.0',
    description: 'Demo API built with Hono and DocTreen.',
  },
  exclude: ['/health'],
  liveReload: true,
});

// ─────────────────────────────────────────────────────────────────────────────
// Start
// ─────────────────────────────────────────────────────────────────────────────

const PORT = Number(process.env.PORT) || 3002;

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log('');
  console.log('  Server running  →  http://localhost:' + info.port);
  console.log('  API Docs        →  http://localhost:' + info.port + '/api/docs');
  console.log('');
});
