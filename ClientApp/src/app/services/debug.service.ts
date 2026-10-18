// src/app/services/debug.service.ts

import { Injectable } from '@angular/core';
import { environment } from 'src/environments/environment';

@Injectable({
  providedIn: 'root'
})
export class DebugService {
  private logCount = 0;
  private readonly MAX_LOGS_PER_SECOND = 50; // Максимум 50 логів/секунду
  private logTimestamps: number[] = [];
  
  // Увімкнути детальні логи тільки в development
  private readonly enableDetailedLogs = !environment.production;

  constructor() {}

  /**
   * Розумне логування з дросселюванням
   */
  log(message: string, ...args: any[]): void {
    if (!this.enableDetailedLogs) return;
    
    if (this.shouldLog()) {
      console.log(message, ...args);
    }
  }

  /**
   * Критичні помилки завжди виводяться
   */
  error(message: string, ...args: any[]): void {
    console.error(message, ...args);
  }

  /**
   * Попередження завжди виводяться
   */
  warn(message: string, ...args: any[]): void {
    console.warn(message, ...args);
  }

  /**
   * Групове логування (згортається в консолі)
   */
  group(groupName: string, callback: () => void): void {
    if (!this.enableDetailedLogs) return;
    
    if (this.shouldLog()) {
      console.group(groupName);
      callback();
      console.groupEnd();
    }
  }

  /**
   * Логування тільки певних категорій
   */
  logCategory(category: 'encryption' | 'signalr' | 'http' | 'ui', message: string, ...args: any[]): void {
    // Можна налаштувати, які категорії логувати
    const enabledCategories: string[] = ['encryption', 'signalr']; // Увімкнути тільки ці
    
    if (!this.enableDetailedLogs || !enabledCategories.includes(category)) {
      return;
    }
    
    if (this.shouldLog()) {
      console.log(`[${category.toUpperCase()}] ${message}`, ...args);
    }
  }

  /**
   * Перевірка, чи можна логувати (захист від спаму)
   */
  private shouldLog(): boolean {
    const now = Date.now();
    
    // Видаляємо старі timestamps (старіші 1 секунди)
    this.logTimestamps = this.logTimestamps.filter(timestamp => now - timestamp < 1000);
    
    // Якщо перевищено ліміт, пропускаємо лог
    if (this.logTimestamps.length >= this.MAX_LOGS_PER_SECOND) {
      return false;
    }
    
    this.logTimestamps.push(now);
    return true;
  }

  /**
   * Спрощене логування для масових операцій
   */
  logBatch(operation: string, count: number): void {
    if (!this.enableDetailedLogs) return;
    console.log(`[BATCH] ${operation}: ${count} items`);
  }
}