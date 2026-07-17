import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { TestAppModule } from './test-app.module';
import { PrismaService } from '../src/common/services/prisma.service';
import { cleanupTestData } from './helpers/cleanup.helper';
import { JwtAuthGuard } from '../src/auth/guards/jwt-auth.guard';
import { MockJwtAuthGuard } from './mocks/auth.mock';

describe('Catalog E2E Tests', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let _authToken: string;
  let productId: string;
  let _priceId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [TestAppModule],
    })
      .overrideGuard(JwtAuthGuard)
      .useClass(MockJwtAuthGuard)
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );

    await app.init();
    prisma = app.get<PrismaService>(PrismaService);

    _authToken = `Bearer mock-token-${MockJwtAuthGuard.testUserId}`;

    // Create test products and prices
    const product1 = await prisma.product.create({
      data: {
        code: 'test-product-1',
        name: 'Test Product 1',
        moduleScope: 'test',
        type: 'one_time',
        isActive: true,
      },
    });
    productId = product1.id;

    const product2 = await prisma.product.create({
      data: {
        code: 'test-product-2',
        name: 'Test Product 2',
        moduleScope: 'test',
        type: 'subscription',
        isActive: true,
      },
    });

    const price1 = await prisma.price.create({
      data: {
        productId: product1.id,
        code: 'test-price-1',
        currency: 'USD',
        amount: 99.99,
        isActive: true,
      },
    });
    _priceId = price1.id;

    await prisma.price.create({
      data: {
        productId: product1.id,
        code: 'test-price-1-eur',
        currency: 'EUR',
        amount: 89.99,
        isActive: true,
      },
    });

    await prisma.price.create({
      data: {
        productId: product2.id,
        code: 'test-price-2',
        currency: 'USD',
        amount: 29.99,
        interval: 'month',
        isActive: true,
      },
    });
  });

  afterAll(async () => {
    await cleanupTestData(prisma);
    await app.close();
    await prisma.$disconnect();
    await new Promise((resolve) => setTimeout(resolve, 200));
  });

  describe('GET /v1/products', () => {
    it('should return all active products', async () => {
      const response = await request(app.getHttpServer()).get('/v1/products').expect(200);

      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBeGreaterThan(0);

      const product = response.body.find((p: any) => p.code === 'test-product-1');
      expect(product).toBeDefined();
      expect(product.name).toBe('Test Product 1');
      expect(product.isActive).toBe(true);
    });

    it('should not return inactive products', async () => {
      // Create inactive product
      await prisma.product.create({
        data: {
          code: 'inactive-product',
          name: 'Inactive Product',
          moduleScope: 'test',
          type: 'one_time',
          isActive: false,
        },
      });

      const response = await request(app.getHttpServer()).get('/v1/products').expect(200);

      const inactive = response.body.find((p: any) => p.code === 'inactive-product');
      expect(inactive).toBeUndefined();

      // Cleanup
      await prisma.product.delete({ where: { code: 'inactive-product' } });
    });
  });

  describe('GET /v1/products/prices', () => {
    it('should return all prices', async () => {
      const response = await request(app.getHttpServer()).get('/v1/products/prices').expect(200);

      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBeGreaterThan(0);
    });

    it('should filter prices by product code', async () => {
      const response = await request(app.getHttpServer())
        .get('/v1/products/prices')
        .query({ product_code: 'test-product-1' })
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBe(2); // USD and EUR prices

      response.body.forEach((price: any) => {
        expect(price.productId).toBe(productId);
      });
    });

    it('should return 404 for non-existent product', async () => {
      await request(app.getHttpServer())
        .get('/v1/products/prices')
        .query({ product_code: 'non-existent' })
        .expect(404);
    });
  });
});
