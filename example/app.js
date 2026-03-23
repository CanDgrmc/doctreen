'use strict';

/**
 * example/app.js
 *
 * Demonstrates payload schema detection alongside route discovery.
 *
 * ─── How schema detection works ───────────────────────────────────────────────
 * The middleware wraps each route handler at introspection time (first /docs
 * hit). As real HTTP traffic flows through, the wrappers observe:
 *   • req.body  → request body schema  (POST / PUT / PATCH)
 *   • req.query → query parameter schema (any method)
 *   • res.json  → response payload schema (any method)
 *
 * Schemas are captured from the FIRST non-trivial request to each endpoint
 * and then frozen. Reload /api/docs after making a request to see it appear.
 *
 * ─── Quick start ──────────────────────────────────────────────────────────────
 * 1.  npm run example
 * 2.  Open http://localhost:3000/api/docs  (no schemas yet — routes only)
 * 3.  Run the curl commands in the sections below
 * 4.  Refresh http://localhost:3000/api/docs  (schemas now populated)
 */

const express = require('express');
const { expressAdapter, defineRoute, defineSchema, s } = require('../src/adapters/express');

const app = express();
app.use(express.json());

// ─────────────────────────────────────────────────────────────────────────────
// Reusable schemas — defined once, referenced by name in JSDoc ({User}, {Product})
// or passed directly to defineRoute.
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
//
// curl -s http://localhost:3000/users?page=1&limit=10&search=alice | jq
// curl -s http://localhost:3000/users/42 | jq
// curl -s -X POST http://localhost:3000/users \
//      -H 'Content-Type: application/json' \
//      -d '{"name":"Alice Smith","email":"alice@example.com","role":"admin"}' | jq
// curl -s -X PUT http://localhost:3000/users/42 \
//      -H 'Content-Type: application/json' \
//      -d '{"name":"Alice Johnson","email":"alice.j@example.com"}' | jq
// curl -s -X DELETE http://localhost:3000/users/42 | jq
// ─────────────────────────────────────────────────────────────────────────────

app.get('/users', function listUsers(req, res) {
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
  
  res.json({
    users: [
      { id: 1, name: 'Alice Smith', email: 'alice@example.com', role: 'admin', active: true  },
      { id: 2, name: 'Bob Jones',   email: 'bob@example.com',   role: 'user',  active: false },
    ],
    total: 2,
    page:  Number(page),
    limit: Number(limit),
    search: String(search),
  });
});

app.get('/users/:id', defineRoute(function getUserById(req, res) {
  /**
   * Get a single user by ID
   * @returns {User}
   * @header  Authorization - Bearer <token>
   */
  res.json({
    id:        Number(req.params.id),
    name:      'Alice Smith',
    email:     'alice@example.com',
    role:      'admin',
    active:    true,
    createdAt: '2024-01-15T10:00:00Z',
  });
}, {
  errors: {
    401: 'Missing or invalid Authorization header',
    404: 'User not found',
  },
}));

app.post('/users', defineRoute(function createUser(req, res) {
  /**
   * Create a new user
   * @param   {string} body.name  - Full name
   * @param   {string} body.email - Email address
   * @param   {string} [body.role] - Role: "user" or "admin" (default "user")
   * @returns {User}
   * @header  Authorization  - Bearer <token>
   * @header  Content-Type   - application/json
   */
  const { name, email, role = 'user' } = req.body;
  res.status(201).json({
    id:        101,
    name,
    email,
    role,
    active:    true,
    createdAt: new Date().toISOString(),
  });
}, {
  errors: {
    409: 'Email address already in use',
    422: { description: 'Validation failed', schema: s.object({ message: s.string(), field: s.string() }) },
  },
}));

app.put('/users/:id', function updateUser(req, res) {
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
  const { name, email } = req.body;
  res.json({
    id:        Number(req.params.id),
    name,
    email,
    updatedAt: new Date().toISOString(),
  });
});

app.delete('/users/:id', defineRoute(function deleteUser(req, res) {
  /**
   * Delete a user by ID
   * @response {boolean} deleted
   * @response {number}  id
   * @header  Authorization - Bearer <token>
   */
  res.json({ deleted: true, id: Number(req.params.id) });
}, {
  errors: {
    401: 'Unauthorized',
    403: 'Forbidden — cannot delete another admin account',
    404: 'User not found',
  },
}));

// ─────────────────────────────────────────────────────────────────────────────
// Products resource
//
// curl -s 'http://localhost:3000/products?category=electronics&minPrice=10&maxPrice=500' | jq
// curl -s http://localhost:3000/products/7 | jq
// curl -s -X POST http://localhost:3000/products \
//      -H 'Content-Type: application/json' \
//      -d '{"name":"Wireless Mouse","price":29.99,"category":"electronics","inStock":true}' | jq
// curl -s -X PATCH http://localhost:3000/products/7 \
//      -H 'Content-Type: application/json' \
//      -d '{"price":24.99,"inStock":false}' | jq
// ─────────────────────────────────────────────────────────────────────────────

app.get('/products', function listProducts(req, res) {
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
  res.json({
    products: [
      { id: 1, name: 'Keyboard',      price: 79.99,  category: 'electronics', inStock: true  },
      { id: 2, name: 'Desk Lamp',     price: 34.50,  category: 'furniture',   inStock: true  },
      { id: 3, name: 'Coffee Mug',    price:  9.99,  category: 'kitchen',     inStock: false },
    ],
    total:    3,
    filters:  { category: String(category), minPrice: Number(minPrice), maxPrice: Number(maxPrice) },
  });
});

app.get('/products/:productId', function getProductById(req, res) {
  /**
   * Get a product by ID
   * @returns {Product}
   */
  res.json({
    id:        Number(req.params.productId),
    name:      'Wireless Mouse',
    price:     29.99,
    category:  'electronics',
    inStock:   true,
    createdAt: '2024-03-10T08:30:00Z',
  });
});

app.post('/products', function createProduct(req, res) {
  /**
   * Create a new product
   * @param   {string}  body.name     - Product name
   * @param   {number}  body.price    - Price in USD
   * @param   {string}  body.category - Product category
   * @param   {boolean} [body.inStock] - In-stock flag (default true)
   * @returns {Product}
   * @header  Authorization - Bearer <token>
   * @header  Content-Type  - application/json
   */
  const { name, price, category, inStock = true } = req.body;
  res.status(201).json({
    id:        202,
    name,
    price:     Number(price),
    category,
    inStock:   Boolean(inStock),
    createdAt: new Date().toISOString(),
  });
});

app.patch('/products/:productId', function patchProduct(req, res) {
  /**
   * Partially update a product
   * @param   {number}  [body.price]   - New price
   * @param   {boolean} [body.inStock] - Updated stock flag
   * @response {number}  id
   * @response {number}  price
   * @response {boolean} inStock
   * @response {string}  updatedAt
   * @header  Authorization - Bearer <token>
   * @header  Content-Type  - application/json
   */
  const { price, inStock } = req.body;
  res.json({
    id:        Number(req.params.productId),
    price:     price  !== undefined ? Number(price)   : undefined,
    inStock:   inStock !== undefined ? Boolean(inStock) : undefined,
    updatedAt: new Date().toISOString(),
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Auth endpoints
//
// curl -s -X POST http://localhost:3000/auth/login \
//      -H 'Content-Type: application/json' \
//      -d '{"email":"alice@example.com","password":"s3cr3t"}' | jq
// curl -s -X POST http://localhost:3000/auth/logout \
//      -H 'Content-Type: application/json' \
//      -d '{"refreshToken":"abc123"}' | jq
// curl -s -X POST http://localhost:3000/auth/refresh \
//      -H 'Content-Type: application/json' \
//      -d '{"refreshToken":"abc123"}' | jq
// ─────────────────────────────────────────────────────────────────────────────

app.post('/auth/login', defineRoute(function login(req, res) {
  /**
   * Authenticate and receive a JWT token pair
   * @param   {string} body.email    - User email address
   * @param   {string} body.password - User password
   * @response {string} token
   * @response {string} refreshToken
   * @response {number} expiresIn
   * @response {object} user
   * @header  Content-Type - application/json
   */
  const { email } = req.body;
  res.json({
    token:        'eyJhbGciOiJIUzI1NiJ9.example',
    refreshToken: 'rt_abc123xyz',
    expiresIn:    3600,
    user: { id: 1, email, role: 'admin' },
  });
}, {
  errors: {
    401: { description: 'Invalid email or password', schema: s.object({ message: s.string() }) },
    422: { description: 'Validation failed — missing required fields', schema: s.object({ message: s.string(), field: s.string() }) },
  },
}));

app.post('/auth/logout', function logout(_req, res) {
  /**
   * Invalidate the current session
   * @param   {string} body.refreshToken - Refresh token to revoke
   * @response {boolean} success
   * @response {string}  message
   * @header  Authorization - Bearer <token>
   * @header  Content-Type  - application/json
   */
  res.json({ success: true, message: 'Logged out successfully' });
});

app.post('/auth/refresh', function refreshToken(_req, res) {
  /**
   * Exchange a refresh token for a new access token
   * @param   {string} body.refreshToken - Valid refresh token
   * @response {string} token
   * @response {number} expiresIn
   * @header  Content-Type - application/json
   */
  res.json({
    token:     'eyJhbGciOiJIUzI1NiJ9.refreshed',
    expiresIn: 3600,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Admin — nested router
//
// curl -s http://localhost:3000/admin/stats | jq
// curl -s http://localhost:3000/admin/users | jq
// curl -s -X DELETE http://localhost:3000/admin/users/5 | jq
// ─────────────────────────────────────────────────────────────────────────────

const adminRouter = express.Router();

adminRouter.get('/stats', function getStats(_req, res) {
  /**
   * Platform-wide statistics snapshot
   * @response {number} totalUsers
   * @response {number} activeUsers
   * @response {number} totalProducts
   * @response {number} ordersToday
   * @response {number} revenue
   * @header  Authorization - Bearer <admin-token>
   */
  res.json({
    totalUsers:    1024,
    activeUsers:    876,
    totalProducts:  312,
    ordersToday:     47,
    revenue:      9823.50,
  });
});

adminRouter.get('/users', function adminListUsers(_req, res) {
  /**
   * List all users (admin view)
   * @response {array}   users
   * @response {number}  total
   * @header  Authorization - Bearer <admin-token>
   */
  res.json({
    users: [
      { id: 1, email: 'alice@example.com', role: 'admin', suspended: false },
      { id: 2, email: 'bob@example.com',   role: 'user',  suspended: true  },
    ],
    total: 2,
  });
});

adminRouter.delete('/users/:id', function adminDeleteUser(req, res) {
  /**
   * Permanently delete a user account
   * @response {boolean} deleted
   * @response {number}  userId
   * @response {string}  deletedAt
   * @header  Authorization - Bearer <admin-token>
   */
  res.json({ deleted: true, userId: Number(req.params.id), deletedAt: new Date().toISOString() });
});

app.use('/admin', adminRouter);

// ─────────────────────────────────────────────────────────────────────────────
// Hidden endpoints — excluded from docs
// ─────────────────────────────────────────────────────────────────────────────

app.get('/health',  (_req, res) => res.json({ status: 'ok' }));
app.get('/metrics', (_req, res) => res.json({ uptime: process.uptime() }));

// ─────────────────────────────────────────────────────────────────────────────
// Mount the documentation middleware — AFTER all routes
// ─────────────────────────────────────────────────────────────────────────────

app.use(
  expressAdapter(app, {
    docsPath: '/api/docs',
    meta: {
      title:       'My Awesome API',
      version:     '2.1.0',
      description: 'Internal REST API powering the Awesome platform.',
    },
    exclude: [
      '/health',
      '/metrics',
      /^\/internal\//,
    ],
    liveReload: true, // re-introspect on every /docs hit during development
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// Start
// ─────────────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('');
  console.log('  Server running  →  http://localhost:' + PORT);
  console.log('  API Docs        →  http://localhost:' + PORT + '/api/docs');
  console.log('');
  console.log('  Tip: schemas appear in the docs after you hit each endpoint at least once.');
  console.log('  Run the curl commands in the file comments, then refresh /api/docs.');
  console.log('');
});
