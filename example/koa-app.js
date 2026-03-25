/**
 * example/koa-app.js
 *
 * JavaScript demo for doctreen Koa adapter.
 *
 * Demonstrates two schema sources:
 *   1. defineRoute  — explicit schemas; highest priority
 *   2. JSDoc block comments — zero-import fallback
 *
 * ─── How to run ───────────────────────────────────────────────────────────────
 * npm run example:koa
 *  → http://localhost:3003/api/docs
 *
 * ─── Curl examples ────────────────────────────────────────────────────────────
 * curl -s 'http://localhost:3003/users?page=1&limit=10' | node -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(d))"
 * curl -s  http://localhost:3003/users/42
 * curl -s -X POST http://localhost:3003/users \
 *      -H 'Content-Type: application/json' \
 *      -d '{"name":"Alice","email":"alice@example.com"}'
 */

'use strict';

const Koa    = require('koa');
const Router = require('@koa/router');
const { bodyParser } = require('@koa/bodyparser');
const { koaAdapter, defineRoute, defineSchema, s } = require('../src/adapters/koa');

const app    = new Koa();
const router = new Router();

// ─── Body parsing ─────────────────────────────────────────────────────────────

app.use(bodyParser());

// ─── Reusable schema fragments ────────────────────────────────────────────────

const userSchema = s.object({
  id:        s.number(),
  name:      s.string(),
  email:     s.string(),
  role:      s.string(),
  active:    s.boolean(),
  createdAt: s.string(),
});

defineSchema('User', userSchema);

const productSchema = s.object({
  id:        s.number(),
  name:      s.string(),
  price:     s.number(),
  category:  s.string(),
  inStock:   s.boolean(),
  createdAt: s.string(),
});

defineSchema('Product', productSchema);

// ─────────────────────────────────────────────────────────────────────────────
// Users resource
// ─────────────────────────────────────────────────────────────────────────────

// JSDoc source — plain named function
router.get('/users', function listUsers(ctx) {
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
  const { page = '1', limit = '20', search = '' } = ctx.query;
  ctx.body = {
    users: [
      { id: 1, name: 'Alice Smith', email: 'alice@example.com', role: 'admin', active: true,  createdAt: '2024-01-15T10:00:00Z' },
      { id: 2, name: 'Bob Jones',   email: 'bob@example.com',   role: 'user',  active: false, createdAt: '2024-02-20T09:30:00Z' },
    ],
    total:  2,
    page:   Number(page),
    limit:  Number(limit),
    search: String(search),
  };
});

// defineRoute — explicit schema, no traffic or JSDoc needed
router.get('/users/:id', defineRoute(
  async (ctx) => {
    ctx.body = {
      id:        Number(ctx.params.id),
      name:      'Alice Smith',
      email:     'alice@example.com',
      role:      'admin',
      active:    true,
      createdAt: '2024-01-15T10:00:00Z',
    };
  },
  {
    description: 'Fetch a single user by their numeric ID.',
    response:    userSchema,
    headers:     { Authorization: 'Bearer <token>' },
    errors: {
      401: 'Missing or invalid Authorization header',
      404: 'User not found',
    },
  }
));

router.post('/users', defineRoute(
  async (ctx) => {
    const { name, email, role = 'user' } = ctx.request.body;
    ctx.status = 201;
    ctx.body = {
      id: 101, name, email, role, active: true, createdAt: new Date().toISOString(),
    };
  },
  {
    description: 'Create a new user account. Role defaults to "user" if omitted.',
    headers:     { Authorization: 'Bearer <token>', 'Content-Type': 'application/json' },
    request: {
      body:  s.object({ name: s.string(), email: s.string(), role: s.optional(s.string()) }),
      query: null,
    },
    response: userSchema,
    errors: {
      409: 'Email address already in use',
      422: { description: 'Validation failed', schema: s.object({ message: s.string(), field: s.string() }) },
    },
  }
));

router.put('/users/:id', defineRoute(
  async (ctx) => {
    const { name, email } = ctx.request.body;
    ctx.body = {
      id:        Number(ctx.params.id),
      name,
      email,
      updatedAt: new Date().toISOString(),
    };
  },
  {
    description: 'Replace a user\'s name and email (full update).',
    headers:     { Authorization: 'Bearer <token>', 'Content-Type': 'application/json' },
    request: {
      body:  s.object({ name: s.string(), email: s.string() }),
      query: null,
    },
    response: s.object({ id: s.number(), name: s.string(), email: s.string(), updatedAt: s.string() }),
  }
));

router.delete('/users/:id', defineRoute(
  async (ctx) => {
    ctx.body = { deleted: true, id: Number(ctx.params.id) };
  },
  {
    description: 'Permanently delete a user by ID.',
    response:    s.object({ deleted: s.boolean(), id: s.number() }),
    headers:     { Authorization: 'Bearer <token>' },
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

router.get('/products', defineRoute(
  async (ctx) => {
    const { category = '', minPrice = '0', maxPrice = '9999' } = ctx.query;
    ctx.body = {
      products: [
        { id: 1, name: 'Keyboard',   price: 79.99, category: 'electronics', inStock: true,  createdAt: '2024-03-01T08:00:00Z' },
        { id: 2, name: 'Desk Lamp',  price: 34.50, category: 'furniture',   inStock: true,  createdAt: '2024-03-05T10:00:00Z' },
        { id: 3, name: 'Coffee Mug', price:  9.99, category: 'kitchen',     inStock: false, createdAt: '2024-03-10T12:00:00Z' },
      ],
      total:   3,
      filters: { category: String(category), minPrice: Number(minPrice), maxPrice: Number(maxPrice) },
    };
  },
  {
    description: 'List products with optional filtering by category and price range.',
    request: {
      body:  null,
      query: s.object({ category: s.optional(s.string()), minPrice: s.optional(s.number()), maxPrice: s.optional(s.number()) }),
    },
    response: s.object({
      products: s.array(productSchema),
      total:    s.number(),
      filters:  s.object({ category: s.string(), minPrice: s.number(), maxPrice: s.number() }),
    }),
  }
));

router.get('/products/:productId', function getProductById(ctx) {
  /**
   * Get a product by ID
   * @returns {Product}
   */
  ctx.body = {
    id:        Number(ctx.params.productId),
    name:      'Wireless Mouse',
    price:     29.99,
    category:  'electronics',
    inStock:   true,
    createdAt: '2024-03-10T08:30:00Z',
  };
});

router.post('/products', defineRoute(
  async (ctx) => {
    const { name, price, category, inStock = true } = ctx.request.body;
    ctx.status = 201;
    ctx.body = {
      id: 202, name, price: Number(price), category, inStock: Boolean(inStock),
      createdAt: new Date().toISOString(),
    };
  },
  {
    description: 'Create a new product listing. inStock defaults to true.',
    headers:     { Authorization: 'Bearer <token>', 'Content-Type': 'application/json' },
    request: {
      body:  s.object({ name: s.string(), price: s.number(), category: s.string(), inStock: s.optional(s.boolean()) }),
      query: null,
    },
    response: productSchema,
  }
));

// ─────────────────────────────────────────────────────────────────────────────
// Auth endpoints
// ─────────────────────────────────────────────────────────────────────────────

router.post('/auth/login', defineRoute(
  async (ctx) => {
    const { email } = ctx.request.body;
    ctx.body = {
      token:        'eyJhbGciOiJIUzI1NiJ9.example',
      refreshToken: 'rt_abc123xyz',
      expiresIn:    3600,
      user:         { id: 1, email, role: 'admin' },
    };
  },
  {
    description: 'Authenticate with email and password. Returns a JWT access token and a refresh token.',
    headers:     { 'Content-Type': 'application/json' },
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
    errors: {
      401: { description: 'Invalid email or password',                   schema: s.object({ message: s.string() }) },
      422: { description: 'Validation failed — missing required fields', schema: s.object({ message: s.string(), field: s.string() }) },
    },
  }
));

router.post('/auth/logout', defineRoute(
  async (ctx) => {
    ctx.body = { success: true, message: 'Logged out successfully' };
  },
  {
    description: 'Invalidate the provided refresh token, ending the session.',
    headers:     { Authorization: 'Bearer <token>', 'Content-Type': 'application/json' },
    request:     { body: s.object({ refreshToken: s.string() }), query: null },
    response:    s.object({ success: s.boolean(), message: s.string() }),
  }
));

router.post('/auth/refresh', defineRoute(
  async (ctx) => {
    ctx.body = { token: 'eyJhbGciOiJIUzI1NiJ9.refreshed', expiresIn: 3600 };
  },
  {
    description: 'Exchange a valid refresh token for a new access token.',
    headers:     { 'Content-Type': 'application/json' },
    request:     { body: s.object({ refreshToken: s.string() }), query: null },
    response:    s.object({ token: s.string(), expiresIn: s.number() }),
  }
));

// ─────────────────────────────────────────────────────────────────────────────
// Hidden / utility endpoints
// ─────────────────────────────────────────────────────────────────────────────

router.get('/health', (ctx) => { ctx.body = { status: 'ok' }; });

// ─────────────────────────────────────────────────────────────────────────────
// Mount docs adapter — reads router.stack lazily at first request
// ─────────────────────────────────────────────────────────────────────────────

koaAdapter(router, {
  docsPath: '/api/docs',
  meta: {
    title:       'My Koa API',
    version:     '1.0.0',
    description: 'Demo Koa API powered by DocTreen. All schemas resolved at startup — no curl needed.',
  },
  groups: {
    users:    { description: 'Manage user accounts, profiles, and roles.' },
    products: { description: 'Browse and manage the product catalog.' },
    auth:     { description: 'Authentication, session management, and token refresh.' },
  },
  exclude: ['/health'],
  liveReload: true,
});

// ─────────────────────────────────────────────────────────────────────────────
// Mount router and start server
// ─────────────────────────────────────────────────────────────────────────────

app.use(router.routes());
app.use(router.allowedMethods());

const PORT = Number(process.env.PORT) || 3003;

app.listen(PORT, () => {
  console.log('');
  console.log('  Server running  →  http://localhost:' + PORT);
  console.log('  API Docs        →  http://localhost:' + PORT + '/api/docs');
  console.log('');
  console.log('  All schemas fully resolved at startup — no curl needed to populate docs.');
  console.log('');
});
