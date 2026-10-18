import { Component, Input, OnDestroy, OnInit, ViewChildren, QueryList, ElementRef, AfterViewChecked } from '@angular/core';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { ChatService } from '../services/chat.service';
import { Subscription, Observable } from 'rxjs';
import { Message } from '../models/message';

@Component({
  selector: 'app-private-chat',
  templateUrl: './private-chat.component.html',
  styleUrls: ['./private-chat.component.css']
})
export class PrivateChatComponent implements OnInit, OnDestroy, AfterViewChecked {
  @Input() toUser = '';
  private closeChatSubscription: Subscription | undefined;
  private messagesSubscription: Subscription | undefined;

  public privateMessages$!: Observable<Message[]>;
  public previewUrl: string | ArrayBuffer | null = null;

  @ViewChildren('messageElement') messageElements!: QueryList<ElementRef>;

  public replyingToMessage: Message | null = null;
  public editingMessageId: string | null = null;
  public editingMessageContent: string = '';
  public newMessageContent: string = '';
  public selectedFile: File | null = null;
  public selectedFileName: string | null = null;

  private shouldScrollToBottom = false;
  private wasAtBottom = true;
  private lastMessageCount = 0;

  constructor(public activeModal: NgbActiveModal, public chatService: ChatService) { }

  ngOnInit(): void {
    this.privateMessages$ = this.chatService.getPrivateMessagesObservableForUser(this.toUser);

    this.messagesSubscription = this.privateMessages$.subscribe(messages => {
      const isNewMessage = messages.length > this.lastMessageCount;
      this.lastMessageCount = messages.length;

      // скролимо вниз тільки якщо були внизу і прийшло нове повідомлення
      if (isNewMessage && this.wasAtBottom) {
        this.shouldScrollToBottom = true;
      }

      // позначаємо як прочитані тільки якщо є нові непрочитані від співрозмовника
      const hasUnread = messages.some(m => m.from === this.toUser && m.status !== 'read');
      if (hasUnread) {
        this.chatService.markMessagesAsRead(this.toUser);
      }
    });

    this.chatService.loadAndSyncPrivateChat(this.toUser).then(() => {
      this.shouldScrollToBottom = true;
    });

    this.closeChatSubscription = this.chatService.privateChatClosed$.subscribe(
      (data: { otherUser: string; initiator: string }) => {
        if (data.otherUser === this.toUser && data.initiator !== this.chatService.myName) {
          this.activeModal.dismiss('remote close');
        }
      }
    );

    setTimeout(() => this.attachScrollListener(), 300);
  }

  private attachScrollListener(): void {
    const container = document.querySelector('.private-chat-messages-container') as HTMLElement;
    if (container) {
      container.addEventListener('scroll', () => {
        const distanceFromBottom = container.scrollHeight - (container.scrollTop + container.clientHeight);
        this.wasAtBottom = distanceFromBottom < 100;
      });
    }
  }

  ngAfterViewChecked(): void {
    if (this.shouldScrollToBottom) {
      this.shouldScrollToBottom = false;
      setTimeout(() => this.scrollToBottom(), 0);
    }
  }

  private scrollToBottom(): void {
    try {
      const container = document.querySelector('.private-chat-messages-container') as HTMLElement;
      if (container) {
        container.scrollTop = container.scrollHeight;
        const distanceFromBottom = container.scrollHeight - (container.scrollTop + container.clientHeight);
        this.wasAtBottom = distanceFromBottom < 100;
      }
    } catch (err) { }
  }

  ngAfterViewInit(): void { }

  ngOnDestroy(): void {
    this.closeChatSubscription?.unsubscribe();
    this.messagesSubscription?.unsubscribe(); // ← важливо відписатись
  }

  getParentMessage(message: Message): Message | null {
    if (!message.parentMessageId) return null;
    const messages = this.chatService.getPrivateMessages(this.toUser);
    return messages.find(m => m.id === message.parentMessageId) || null;
  }

  replyToMessage(message: Message): void {
    this.replyingToMessage = message;
  }

  cancelReply(): void {
    this.replyingToMessage = null;
  }

  startEditMessage(message: Message): void {
    this.editingMessageId = message.id;
    this.editingMessageContent = message.content;
  }

  saveEditedMessage(message: Message): void {
    if (this.editingMessageContent.trim() !== '') {
      this.chatService.editPrivateMessage(this.toUser, message.id, this.editingMessageContent);
      this.cancelEdit();
    }
  }

  cancelEdit(): void {
    this.editingMessageId = null;
    this.editingMessageContent = '';
  }

  confirmDeleteMessage(messageId: string): void {
    if (confirm('Ви впевнені, що хочете видалити це повідомлення?')) {
      this.chatService.deletePrivateMessage(this.toUser, messageId);
    }
  }

  public sendNewMessage(): void {
    if (this.selectedFile) {
      this.chatService.sendPrivateFile(this.toUser, this.selectedFile, this.replyingToMessage?.id || null);
      this.cancelFileSelection();
    } else if (this.newMessageContent.trim()) {
      const messageContent = this.newMessageContent;
      const replyToId = this.replyingToMessage ? this.replyingToMessage.id : null;
      this.chatService.sendPrivateMessage(this.toUser, messageContent, replyToId);
      this.newMessageContent = '';
      this.cancelReply();
    }
  }

  trackByMessageId(index: number, message: Message): string {
    return message.id;
  }

  public onFileSelected(event: any): void {
    const file: File = event.target.files[0];
    if (file) {
      this.selectedFile = file;
      this.selectedFileName = file.name;
      if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = (e: any) => { this.previewUrl = e.target.result; };
        reader.readAsDataURL(file);
      } else {
        this.previewUrl = null;
      }
    }
  }

  public cancelFileSelection(): void {
    this.selectedFile = null;
    this.selectedFileName = null;
    this.previewUrl = null;
    const fileInput = document.getElementById('fileInput') as HTMLInputElement;
    if (fileInput) fileInput.value = '';
  }

  isImage(message: Message): boolean {
    if (!message.isFile || !message.fileName) return false;
    const f = message.fileName.toLowerCase();
    return ['.jpg', '.jpeg', '.png', '.gif', '.svg', '.bmp', '.ico', '.tiff', '.tif', '.avif', '.webp']
      .some(ext => f.endsWith(ext));
  }

  downloadFile(message: Message): void {
    if (message.isFile && message.fileUrl && message.fileName) {
      this.chatService.downloadFile(message.fileUrl, message.fileName)
        .catch(error => console.error("File download failed:", error));
    }
  }

  scrollToMessage(messageId: string): void {
    const element = this.messageElements
      .find(el => el.nativeElement.getAttribute('data-messageid') === messageId);
    if (element) {
      element.nativeElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
      element.nativeElement.classList.add('message-highlight');
      setTimeout(() => element.nativeElement.classList.remove('message-highlight'), 1500);
    }
  }
}