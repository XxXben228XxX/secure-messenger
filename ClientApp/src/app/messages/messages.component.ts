// src/app/messages/messages.component.ts

import { Component, Input, Output, EventEmitter, AfterViewInit, ViewChildren, ElementRef, QueryList, OnDestroy } from '@angular/core';
import { Message } from '../models/message';
import { ChatService } from '../services/chat.service'; // Додайте цей імпорт

@Component({
  selector: 'app-messages',
  templateUrl: './messages.component.html',
  styleUrls: ['./messages.component.css']
})
export class MessagesComponent implements AfterViewInit, OnDestroy {
  @Input() messages: Message[] = [];
  @Input() currentUser: string | null = null;
  @ViewChildren('messageElement') messageElements!: QueryList<ElementRef>;

  @Output() reply = new EventEmitter<Message>();
  @Output() edit = new EventEmitter<{ messageId: string, content: string }>();
  @Output() delete = new EventEmitter<string>();
  @Output() read = new EventEmitter<string>();

  editingMessageId: string | null = null;
  editingMessageContent: string = '';
  private observer!: IntersectionObserver;

  constructor(private chatService: ChatService) {}

  ngAfterViewInit() {
    this.setupIntersectionObserver();
    this.messageElements.changes.subscribe(() => this.startObservingMessages());
  }

  ngOnDestroy(): void {
    if (this.observer) {
      this.observer.disconnect();
    }
  }

  private setupIntersectionObserver(): void {
    const options = {
      root: document.querySelector('.messages-scroll-container'),
      threshold: 0.5
    };

    this.observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const messageId = (entry.target as HTMLElement).getAttribute('data-messageid');
          if (messageId) {
            const message = this.messages.find(m => m.id === messageId);
            if (message && message.from !== this.currentUser && message.status === 'delivered') {
              this.read.emit(message.id);
              this.observer.unobserve(entry.target);
            }
          }
        }
      });
    }, options);
    
    this.startObservingMessages();
  }

  private startObservingMessages(): void {
    this.observer.disconnect();
    
    this.messageElements.forEach(element => {
      const messageId = element.nativeElement.getAttribute('data-messageid');
      const message = this.messages.find(m => m.id === messageId);
      if (message && message.status === 'delivered' && message.from !== this.currentUser) {
        this.observer.observe(element.nativeElement);
      }
    });
  }

  getParentMessage(message: Message): Message | undefined {
    return this.messages.find(m => m.id === message.parentMessageId);
  }

  public scrollToMessage(messageId: string): void {
    const messageElement = this.messageElements.find(
      (element) => element.nativeElement.getAttribute('data-messageid') === messageId
    );

    if (messageElement) {
      messageElement.nativeElement.scrollIntoView({
        behavior: 'smooth',
        block: 'start'
      });
    }
  }

  startEditMessage(message: Message): void {
    if (message.from === this.currentUser) {
      this.editingMessageId = message.id;
      this.editingMessageContent = this.decodeMessageContent(message);
    }
  }

  saveEditedMessage(message: Message): void {
    if (this.editingMessageId && this.editingMessageContent.trim()) {
      this.edit.emit({ messageId: this.editingMessageId, content: this.editingMessageContent });
      this.cancelEdit();
    }
  }

  cancelEdit(): void {
    this.editingMessageId = null;
    this.editingMessageContent = '';
  }

  confirmDeleteMessage(messageId: string): void {
    if (confirm('Ви впевнені, що хочете видалити це повідомлення?')) {
      this.delete.emit(messageId);
    }
  }

  replyToMessage(message: Message): void {
    this.reply.emit(message);
  }

  trackByMessageId(index: number, message: any): number {
    return message.id;
  }

  // ✅ ВИПРАВЛЕННЯ 1: Видаляємо невірний fallback, який використовував message.content
  getImageUrl(message: Message): string {
    if (message.fileUrl) {
      return message.fileUrl;
    }
    // Якщо fileUrl немає (хоча він має бути встановлений chatService для старих повідомлень), 
    // повертаємо порожній рядок, щоб уникнути помилок URL.
    return ''; 
  }

  isImage(message: Message): boolean {
    if (!message.isFile || !message.fileName) {
      return false;
    }
    const lowerCaseFileName = message.fileName.toLowerCase();
    return lowerCaseFileName.endsWith('.jpg') ||
           lowerCaseFileName.endsWith('.jpeg') ||
           lowerCaseFileName.endsWith('.png') ||
           lowerCaseFileName.endsWith('.gif');
  }

  // ✅ ВИПРАВЛЕННЯ 2: Для файлів повертаємо fileName, щоб відображати його у прев'ю відповіді
  decodeMessageContent(message: Message): string {
    if (message.isFile) {
      return message.fileName || '[File Attached]';
    }
    
    const isBase64 = /^[A-Za-z0-9+/=]+$/.test(message.content) && (message.content.length % 4 === 0);
    
    try {
      if (isBase64) {
        return atob(message.content);
      }
    } catch (e) {
      return message.content;
    }
    
    return message.content;
  }

  // Ця функція вже правильна, оскільки використовує message.fileUrl
  downloadFile(message: Message): void {
    if (message.isFile && message.fileUrl && message.fileName) {
      this.chatService.downloadFile(message.fileUrl, message.fileName); 
    } else {
      console.error('Не можу завантажити файл: повідомлення не є файлом або відсутні дані.', message);
    }
  }
  getImageDimensions(message: Message): { width: number, height: number } {
    // Зберігайте розміри в об'єкті повідомлення
    return { width: message.imageWidth || 300, height: message.imageHeight || 200 };
  }
}