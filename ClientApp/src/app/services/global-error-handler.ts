// src/app/services/global-error-handler.ts

import { ErrorHandler, Injectable, Injector } from '@angular/core';
import { LoggerService } from './logger.service';

@Injectable()
export class GlobalErrorHandler implements ErrorHandler {
  constructor(private injector: Injector) {}

  handleError(error: any): void {
    const logger = this.injector.get(LoggerService);
    
    console.error('Global error caught:', error);
    
    logger.logError(
      error.message || 'Unknown error',
      'Global',
      {
        stack: error.stack,
        name: error.name
      }
    );
  }
}