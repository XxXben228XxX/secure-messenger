import {
  Component, EventEmitter, OnDestroy, OnInit, Output,
  AfterViewChecked, ChangeDetectorRef
} from '@angular/core';
import { ChatService } from '../services/chat.service';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { PrivateChatComponent } from '../private-chat/private-chat.component';
import { Message } from '../models/message';
import { Subscription } from 'rxjs';
import { AuthService } from '../services/auth.service';

@Component({
  selector: 'app-chat',
  templateUrl: './chat.component.html',
  styleUrls: ['./chat.component.css']
})
export class ChatComponent implements OnInit, OnDestroy, AfterViewChecked {
  messages: Message[] = [];
  onlineUsers: string[] = [];
  chatConnectionError: string | null = null;
  newMessageContent: string = '';
  replyingToMessage: Message | null = null;
  private hasNewUnreadMessages = false;
  public showScrollButton = false; // ✅ Початково TRUE для тестування
  
  @Output() closeChatEmitter = new EventEmitter();
  private subscriptions: Subscription[] = [];
  searchQuery: string = '';
  filteredUsers: string[] = [];

  public selectedFile: File | null = null;
  public selectedFileName: string | null = null;
  public previewUrl: string | ArrayBuffer | null = null;

  private scrollListener: (() => void) | null = null;
  private isUserScrolling = false;

  constructor(
    public chatService: ChatService,
    private modalService: NgbModal,
    private authService: AuthService,
    private cdRef: ChangeDetectorRef
  ) { }

  ngOnInit(): void {
    this.subscriptions.push(this.chatService.connectionError$.subscribe(error => {
      this.chatConnectionError = error;
    }));

    this.subscriptions.push(this.authService.userName$.subscribe((name: string | null) => {
      if (name) {
        this.chatService.myName = name;
      } else {
        this.chatConnectionError = "Будь ласка, увійдіть, щоб використовувати чат.";
      }
    }));

    this.subscriptions.push(this.chatService.messages$.subscribe(newMessages => {
      const hadMessages = this.messages.length > 0;
      this.messages = newMessages;
      
      if (!this.isUserScrolling) {
        setTimeout(() => this.autoScrollToBottom(), 200);
      } else if (hadMessages) {
        this.showScrollButton = true;
        this.cdRef.detectChanges();
      }
    }));

    this.subscriptions.push(this.chatService.users$.subscribe(users => {
      this.onlineUsers = users;
      this.filterUsers();
    }));

    this.chatService.onGlobalMessagesStatusUpdated().subscribe(({ messageIds, status }) => {
      if (status === 'read') {
        const updatedIds = new Set(messageIds);
        this.messages.forEach(m => {
          if (updatedIds.has(m.id)) {
            m.status = 'read';
          }
        });
      }
    });

    setTimeout(() => this.attachScrollListener(), 500);
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach(sub => sub.unsubscribe());
    this.detachScrollListener();
  }

  ngAfterViewChecked(): void {
    if (this.hasNewUnreadMessages) {
      this.chatService.markAllGlobalMessagesAsRead();
      this.hasNewUnreadMessages = false;
    }
  }

  private attachScrollListener(): void {
    const container = document.querySelector('.messages-scroll-container') as HTMLElement;
    const appMessages = document.querySelector('app-messages') as HTMLElement;
    
    if (container && !this.scrollListener) {
      this.scrollListener = () => this.onMessageScroll();
      container.addEventListener('scroll', this.scrollListener);
      
      this.onMessageScroll();
    }
  }

  private detachScrollListener(): void {
    const container = document.querySelector('.messages-scroll-container') as HTMLElement;
    if (container && this.scrollListener) {
      container.removeEventListener('scroll', this.scrollListener);
      this.scrollListener = null;

    }
  }

  private lastScrollTop = 0;

  onMessageScroll(): void {
    const container = document.querySelector('.messages-scroll-container') as HTMLElement;
    if (!container) return;

    const distanceFromBottom = container.scrollHeight - (container.scrollTop + container.clientHeight);
    const isAtBottom = distanceFromBottom < 50;
    const isScrollingDown = container.scrollTop > this.lastScrollTop; // ← напрямок

    this.lastScrollTop = container.scrollTop;
    this.isUserScrolling = !isAtBottom;

    // показуємо тільки якщо гортаємо ВНИЗ і ще не досягли низу
    this.showScrollButton = isScrollingDown && !isAtBottom;
    this.cdRef.detectChanges();
  }

  private autoScrollToBottom(): void {
    const container = document.querySelector('.messages-scroll-container') as HTMLElement;
    if (container) {
      container.scrollTop = container.scrollHeight;
      this.showScrollButton = false;
      this.isUserScrolling = false;
      this.cdRef.detectChanges();
    }
  }

  scrollToLatestMessage(): void {
    const container = document.querySelector('.messages-scroll-container') as HTMLElement;
    if (container) {
           
      container.scrollTop = container.scrollHeight;
      
      setTimeout(() => {
        container.scrollTo({
          top: container.scrollHeight,
          behavior: 'smooth'
        });
        console.log('📊 After scroll:', container.scrollTop);
      }, 50);
      
      setTimeout(() => {
        this.showScrollButton = false;
        this.isUserScrolling = false;
        this.cdRef.detectChanges();
      }, 300);
    } else {
      console.error('❌ Scroll container not found!');
    }
  }

  filterUsers(): void {
    const query = this.searchQuery.toLowerCase().trim();
    if (query) {
      this.filteredUsers = this.onlineUsers.filter(user =>
        user.toLowerCase().includes(query)
      );
    } else {
      this.filteredUsers = [...this.onlineUsers];
    }
  }

  backToHome() {
    this.closeChatEmitter.emit();
  }

  sendNewMessage(): void {
    if (this.selectedFile) {
        const parentMessageId = this.replyingToMessage ? this.replyingToMessage.id : null;
        this.chatService.sendGlobalFile(this.selectedFile, parentMessageId);
        this.cancelFileSelection();
    } else if (this.newMessageContent.trim()) {
        const parentMessageId = this.replyingToMessage ? this.replyingToMessage.id : null;
        this.chatService.sendMessage(this.newMessageContent, false, null, parentMessageId);
        this.newMessageContent = '';
        this.replyingToMessage = null;
    }
    
    this.isUserScrolling = false;
  }

  onReply(message: Message): void {
    this.replyingToMessage = message;
  }

  cancelReply(): void {
    this.replyingToMessage = null;
  }

  onEdit(event: { messageId: string, content: string }): void {
    if (this.chatService.myName && event.messageId) {
      this.chatService.editGlobalMessage(event.messageId, event.content);
    }
  }

  onDelete(messageId: string): void {
    if (messageId) {
      this.chatService.deleteGlobalMessage(messageId);
    }
  }

  onMessageRead(messageId: string): void {
    if (messageId) {
        this.chatService.markMessagesInViewAsRead([messageId]);
    }
  }

  openPrivateChat(toUser: string) {
    if (toUser === this.chatService.myName) {
      alert("Ви не можете почати приватний чат із самим собою.");
      return;
    }
    const modalRef = this.modalService.open(PrivateChatComponent);
    modalRef.componentInstance.toUser = toUser;
  }

  trackByUser(index: number, user: string): string {
    return user;
  }

  public onFileSelected(event: any): void {
    const file: File = event.target.files[0];
    if (file) {
      this.selectedFile = file;
      this.selectedFileName = file.name;
      
      this.cdRef.detectChanges();

      if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = (e: any) => {
          this.previewUrl = e.target.result;
          this.cdRef.detectChanges();
        };
        reader.readAsDataURL(file);
      } else {
        this.previewUrl = null;
        this.cdRef.detectChanges();
      }
    }
  }

  public cancelFileSelection(): void {
    this.selectedFile = null;
    this.selectedFileName = null;
    this.previewUrl = null;
    const fileInput = document.getElementById('fileInput') as HTMLInputElement;
    if (fileInput) {
        fileInput.value = '';
    }
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

  downloadFile(message: Message): void {
      if (message.isFile && message.content && message.fileName) {
          this.chatService.downloadFile(message.content, message.fileName);
      } else {
          console.error('Cannot download file: message is not a file message or missing data.', message);
      }
  }
}