import { AsyncLocalStorage } from 'node:async_hooks';
import { Global, Injectable, Module } from '@nestjs/common';
import type { RuntimeConfig } from '@modules/runtime-config/interfaces/runtime-config.interface';

export interface RequestState {
  runtime?: RuntimeConfig | null;
  routing?: { adminSchema: string; userSchema: string };
  schema?: string;
}

@Injectable()
export class RequestContext extends AsyncLocalStorage<RequestState> {
  require(): RequestState {
    const state = this.getStore();
    if (!state) throw new Error('Missing request database context');
    return state;
  }
}

@Global()
@Module({ providers: [RequestContext], exports: [RequestContext] })
export class RequestContextModule {}
