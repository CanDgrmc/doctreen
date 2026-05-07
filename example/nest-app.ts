/**
 * NestJS example for doctreen.
 *
 * Run:  npm run example:nest
 *       npx tsx example/nest-app.ts
 *
 * Then open http://localhost:3001/docs
 *
 * Requirements (already in devDependencies after npm install):
 *   @nestjs/common  @nestjs/core  @nestjs/platform-express
 *   reflect-metadata  rxjs  zod
 */
import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import {
  Module,
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  Query,
} from '@nestjs/common';
import { z } from 'zod';

import {
  nestAdapter,
  DocRoute,
  DocDescription,
  DocRequest,
  DocResponse,
  DocErrors,
  DocHeaders,
  s,
} from '../src/adapters/nest';

// ─── Zod schemas ──────────────────────────────────────────────────────────────

const CreateUserSchema = z.object({
  name: z.string(),
  email: z.string().email(),
  role: z.enum(['admin', 'user', 'guest']).optional(),
});

const UserResponseSchema = z.object({
  id: z.number(),
  name: z.string(),
  email: z.string(),
  role: z.string().optional(),
  createdAt: z.string(),
});

const UpdateUserSchema = z.object({
  name: z.string().optional(),
  role: z.enum(['admin', 'user', 'guest']).optional(),
});

const UserListQuerySchema = z.object({
  page: z.number().optional(),
  limit: z.number().optional(),
  role: z.string().optional(),
});

const ImportProductsSchema = z.object({
  products: z.array(
    z.object({
      sku: z.string(),
      name: z.string(),
      price: z.number(),
      stock: z.number(),
    })
  ),
  overwrite: z.boolean().optional(),
});

const ImportResultSchema = z.object({
  imported: z.number(),
  skipped: z.number(),
  errors: z.array(z.object({ sku: z.string(), reason: z.string() })),
});

// ─── Controllers ──────────────────────────────────────────────────────────────

@Controller('users')
class UsersController {
  @Get()
  @DocDescription('List all users with optional filters')
  @DocRequest({ query: UserListQuerySchema })
  @DocResponse(z.array(UserResponseSchema))
  getUsers(@Query() query: z.infer<typeof UserListQuerySchema>) {
    return [];
  }

  @Get(':id')
  @DocRoute({
    description: 'Get a single user by ID',
    response: UserResponseSchema,
    errors: {
      404: 'User not found',
    },
  })
  getUser(@Param('id') id: string) {
    return { id: Number(id), name: 'Alice', email: 'alice@example.com', createdAt: new Date().toISOString() };
  }

  @Post()
  @DocRoute({
    description: 'Create a new user',
    request: { body: CreateUserSchema },
    response: UserResponseSchema,
    errors: {
      409: 'Email already in use',
      422: { description: 'Validation failed', schema: s.object({ message: s.string() }) },
    },
  })
  createUser(@Body() body: z.infer<typeof CreateUserSchema>) {
    return { id: 1, ...body, createdAt: new Date().toISOString() };
  }

  @Put(':id')
  @DocRoute({
    description: 'Update an existing user',
    request: { body: UpdateUserSchema },
    response: UserResponseSchema,
    errors: {
      404: 'User not found',
      409: 'Email already in use',
    },
  })
  updateUser(@Param('id') id: string, @Body() body: z.infer<typeof UpdateUserSchema>) {
    return { id: Number(id), name: body.name ?? 'Alice', email: 'alice@example.com', createdAt: new Date().toISOString() };
  }

  @Delete(':id')
  @DocDescription('Delete a user by ID')
  @DocErrors({ 404: 'User not found', 403: 'Insufficient permissions' })
  deleteUser(@Param('id') id: string) {
    return { success: true };
  }
}

@Controller('products')
class ProductsController {
  @Post('import')
  @DocRoute({
    description: 'Bulk import partner inventory',
    headers: {
      'x-partner-api-key': 'Partner API key',
      'Content-Type': 'application/json',
    },
    request: { body: ImportProductsSchema },
    response: ImportResultSchema,
    errors: {
      400: 'Validation failed',
      401: 'Missing or invalid API key',
      429: 'Rate limit exceeded',
    },
  })
  importProducts(@Body() body: z.infer<typeof ImportProductsSchema>) {
    return { imported: body.products.length, skipped: 0, errors: [] };
  }

  @Get()
  @DocDescription('List all products')
  @DocRequest({ query: z.object({ category: z.string().optional(), inStock: z.boolean().optional() }) })
  @DocResponse(z.array(z.object({ id: z.number(), sku: z.string(), name: z.string(), price: z.number() })))
  @DocHeaders({ 'x-partner-api-key': 'Partner API key' })
  getProducts() {
    return [];
  }
}

@Controller('health')
class HealthController {
  @Get()
  @DocDescription('Service health check')
  @DocResponse(s.object({ status: s.string(), uptime: s.number() }))
  check() {
    return { status: 'ok', uptime: process.uptime() };
  }
}

// ─── App module ───────────────────────────────────────────────────────────────

@Module({
  controllers: [UsersController, ProductsController, HealthController],
})
class AppModule {}

// ─── Bootstrap ────────────────────────────────────────────────────────────────

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { logger: false });

  nestAdapter(app, {
    docsPath: '/docs',
    meta: {
      title: 'NestJS Example API',
      version: '1.0.0',
      description: 'A NestJS app documented with doctreen — Zod schemas and @DocRoute decorators.',
    },
  });

  await app.listen(3001);
  console.log('NestJS app running at  http://localhost:3001');
  console.log('Docs available at      http://localhost:3001/docs');
}

bootstrap().catch(console.error);
