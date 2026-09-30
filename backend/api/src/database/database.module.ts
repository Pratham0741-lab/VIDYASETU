import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ActorTransactionInterceptor } from './actor-transaction.interceptor';
import { ActorTransactionRunner } from './actor-transaction.runner';
import { DbContext } from './db-context';

@Global()
@Module({
  providers: [
    DbContext,
    ActorTransactionRunner,
    { provide: APP_INTERCEPTOR, useClass: ActorTransactionInterceptor },
  ],
  exports: [DbContext, ActorTransactionRunner],
})
export class DatabaseModule {}
