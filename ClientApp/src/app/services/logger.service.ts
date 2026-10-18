// src/app/services/logger.service.ts

import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class LoggerService {
  private readonly logUrl = `${environment.apiUrl}/api/log/frontend`;
  private queue: any[] = [];
  private isSending = false;

  constructor(private http: HttpClient) {}

  public logInfo(message: string, context: string = 'General') {
    this.sendLog('INFO', message, context);
  }

  public logWarning(message: string, context: string = 'General') {
    this.sendLog('WARNING', message, context);
  }

  public logError(message: string, context: string = 'General', error?: any) {
    const errorDetails = error ? ` | Error: ${JSON.stringify(error)}` : '';
    this.sendLog('ERROR', message + errorDetails, context);
  }

  private sendLog(level: string, message: string, chatContext: string) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      level: level,
      message: message,
      chatContext: chatContext
    };

    // Додаємо в чергу
    this.queue.push(logEntry);

    // Відправляємо, якщо не відправляємо зараз
    if (!this.isSending) {
      this.processQueue();
    }
  }

  private async processQueue() {
    if (this.queue.length === 0) {
      this.isSending = false;
      return;
    }

    this.isSending = true;
    const logEntry = this.queue.shift();

    try {
      await this.http.post(this.logUrl, logEntry, { withCredentials: true }).toPromise();
      console.log('[LoggerService] Log sent successfully');
    } catch (error) {
      console.error('[LoggerService] Failed to send log:', error);
      // Якщо не вдалося відправити, можна повернути назад у чергу
      // this.queue.unshift(logEntry);
    }

    // Обробляємо наступний лог
    setTimeout(() => this.processQueue(), 100);
  }
}