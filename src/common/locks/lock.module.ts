import { Global, Module } from '@nestjs/common';
import { DistributedLockService } from './distributed-lock.service';

/**
 * Global so any scheduler can inject DistributedLockService without each feature
 * module re-providing it.
 */
@Global()
@Module({
  providers: [DistributedLockService],
  exports: [DistributedLockService],
})
export class LockModule {}
