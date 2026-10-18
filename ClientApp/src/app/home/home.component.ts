// src/app/home/home.component.ts
import { Component, OnInit, OnDestroy } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { ChatService } from '../services/chat.service';
import { HttpErrorResponse } from '@angular/common/http';
import { AuthService } from '../services/auth.service';
import { Subscription } from 'rxjs';
import { finalize } from 'rxjs/operators';

@Component({
  selector: 'app-home',
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.css']
})
export class HomeComponent implements OnInit, OnDestroy {
  userForm: FormGroup = new FormGroup({});
  submitted = false;
  apiErrorMessages: string[] = [];
  openChat = false;
  isLoading = false;
  private subscriptions: Subscription[] = [];
  
  constructor(
    private formBuilder: FormBuilder,
    private chatService: ChatService,
    private authService: AuthService
  ) {}

  ngOnInit(): void {
    this.initializeForm();
    this.isLoading = true;
    
    this.authService.checkAndFetchCurrentUser().pipe(
      finalize(() => this.isLoading = false)
    ).subscribe({
      error: (err: any) => {
        console.error('[HomeComponent] Error checking auth status, assuming no session:', err);
        this.openChat = false;
      }
    });

    this.subscriptions.push(this.authService.userName$.subscribe((name: string | null) => {
      if (name) {
        console.log(`[HomeComponent] Found existing session for user: ${name}.`);
        this.openChat = true;
      } else {
        console.log('[HomeComponent] No active session found.');
        this.openChat = false;
      }
    }));
    
    // 🔥 ВИПРАВЛЕННЯ: Додаємо перевірку типу помилки
    this.subscriptions.push(this.chatService.connectionError$.subscribe(errorMsg => {
      if (errorMsg) {
        this.apiErrorMessages.push(errorMsg);
        
        // ✅ Logout ТІЛЬКИ при критичних помилках підключення, НЕ при помилках файлів
        const isCriticalError = errorMsg.includes('підключення') || 
                                errorMsg.includes('З\'єднання') ||
                                errorMsg.includes('Перепідключення');
        
        if (isCriticalError) {
          console.warn('[HomeComponent] Critical connection error detected. Logging out.');
          this.openChat = false;
          this.authService.logout().subscribe();
        } else {
          // Для некритичних помилок (наприклад, файл не знайдено) - просто показуємо повідомлення
          console.log('[HomeComponent] Non-critical error (e.g., file not found). Not logging out.');
          // ❌ НЕ викликаємо logout!
        }
      } else {
        this.apiErrorMessages = [];
        // ✅ Відкриваємо чат тільки якщо є активна сесія
        if (this.authService.currentUserName) { // Використовуємо новий геттер
            this.openChat = true;
        }
      }
    }));
    
    // 🆕 Підписка на некритичні повідомлення
    this.subscriptions.push(this.chatService.userNotification$.subscribe((notification: string | null) => {
      if (notification) {
        this.apiErrorMessages.push(notification);
        // ❌ НЕ викликаємо logout для некритичних повідомлень
        
        // Опціонально: автоматично видаляємо повідомлення через 5 секунд
        setTimeout(() => {
          const index = this.apiErrorMessages.indexOf(notification);
          if (index > -1) {
            this.apiErrorMessages.splice(index, 1);
          }
        }, 5000);
      }
    }));
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach(sub => sub.unsubscribe());
    this.chatService.stopChatConnection();
  }
  
  private initializeForm() {
    this.userForm = this.formBuilder.group({
      username: ['', [Validators.required, Validators.minLength(3), Validators.maxLength(15)]],
      password: ['', [Validators.required, Validators.minLength(6), Validators.maxLength(20)]]
    });
  }

  submitForm(): void {
    this.submitted = true;
    this.apiErrorMessages = [];

    if (!this.userForm.valid) return;

    this.isLoading = true;
    const credentials = {
      Name: this.userForm.get('username')?.value,
      Password: this.userForm.get('password')?.value
    };

    this.authService.login(credentials).pipe(
      finalize(() => this.isLoading = false)
    ).subscribe({
      next: () => {
        this.userForm.reset();
        this.submitted = false;
      },
      error: (error: HttpErrorResponse) => {
        // ✅ Реєструємо ТІЛЬКИ якщо 404 (юзер не існує), НЕ 401 (неправильний пароль)
        if (error.status === 404) {
          this.isLoading = true;
          this.authService.register(credentials).pipe(
            finalize(() => this.isLoading = false)
          ).subscribe({
            next: () => {
              this.userForm.reset();
              this.submitted = false;
            },
            error: (regError: any) => {
              let errorMsg = 'Невідома помилка при реєстрації.';
              if (regError.error && typeof regError.error === 'string') {
                errorMsg = regError.error;
              }
              this.apiErrorMessages.push(errorMsg);
            }
          });
        } else {
          // 401 = неправильний пароль — просто показуємо помилку
          let errorMessage = 'Невірний логін або пароль.';
          if (error.error && typeof error.error === 'string') {
            errorMessage = error.error;
          }
          this.apiErrorMessages.push(errorMessage);
        }
      }
    });
  }

  closeChat(): void {
    this.openChat = false;
    this.apiErrorMessages = [];
    this.submitted = false;
    this.userForm.reset();
    this.authService.logout().subscribe();
    this.chatService.stopChatConnection();
  }
}