import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getDataSourceToken, getEntityManagerToken } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { AppModule } from './app.module';
import { DatabaseModule } from './common/database/database.module';

const mockRepo = {
  find: jest.fn(),
  findOne: jest.fn(),
  save: jest.fn(),
  metadata: {
    columns: [],
    relations: [],
  },
};

const mockDataSource = {
  isInitialized: true,
  options: { entities: [] },
  entityMetadatas: [],
  createEntityManager: jest.fn(),
  getRepository: jest.fn().mockReturnValue(mockRepo),
};

@Global()
@Module({
  providers: [
    { provide: DataSource, useValue: mockDataSource },
    { provide: getDataSourceToken(), useValue: mockDataSource },
    { provide: EntityManager, useValue: {} },
    { provide: getEntityManagerToken(), useValue: {} },
  ],
  exports: [DataSource, getDataSourceToken(), EntityManager, getEntityManagerToken()],
})
class MockDatabaseModule {}

describe('AppModule bootstrap', () => {
  it('compiles AppModule and resolves all module dependencies without error', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideModule(DatabaseModule)
      .useModule(MockDatabaseModule)
      .compile();

    expect(moduleRef).toBeDefined();
    await moduleRef.close();
  });
});
