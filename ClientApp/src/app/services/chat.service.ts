// src/app/services/chat.service.ts

import { Injectable, OnDestroy } from '@angular/core';
import { HttpClient, HttpHeaders , HttpErrorResponse } from '@angular/common/http';
import { environment } from '../../environments/environment';
import { HubConnection, HubConnectionBuilder, HubConnectionState } from '@microsoft/signalr';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import * as CryptoJS from 'crypto-js';

import { BehaviorSubject, Observable, Subject, Subscription, firstValueFrom } from 'rxjs';

import { AuthService } from './auth.service';
import { LoggerService } from './logger.service';
import { PrivateChatComponent } from '../private-chat/private-chat.component';
import { Message } from '../models/message';
import { map } from 'rxjs/operators';

@Injectable({
  providedIn: 'root'
})
export class ChatService implements OnDestroy {
  public myName: string | null = null;
  
  private chatConnection?: HubConnection;
  private isConnecting: boolean = false;
  private subscriptions: Subscription[] = [];
  private privateMessagesMap = new Map<string, BehaviorSubject<Message[]>>();
  public readonly backendUrl = 'http://localhost:5051';

  private messagesSubject = new BehaviorSubject<Message[]>([]);
  public messages$ = this.messagesSubject.asObservable();
  public allPublicMessages: Message[] = [];
  
  private newMessageSubject = new Subject<Message>();
  private globalMessagesStatusUpdatedSubject = new Subject<{ messageIds: string[], status: string }>();

  private privateMessagesSubjectMap = new Map<string, BehaviorSubject<Message[]>>();
  private isPrivateChatModalOpen = false;
  
  private usersSubject = new BehaviorSubject<string[]>([]);
  public users$ = this.usersSubject.asObservable();

  private userNotificationSubject = new Subject<string | null>();
  public userNotification$ = this.userNotificationSubject.asObservable(); 

  private encryptionKey!: CryptoJS.lib.WordArray; // Змініть на пізню ініціалізацію
  private encryptionIv!: CryptoJS.lib.WordArray;

  private privateChatClosedSubject = new Subject<{ otherUser: string; initiator: string }>();
  public privateChatClosed$ = this.privateChatClosedSubject.asObservable();

  private connectionErrorSubject = new Subject<string | null>();
  public connectionError$ = this.connectionErrorSubject.asObservable();

  public openPrivateChats = new Set<string>();
  public activeAndVisibleChats = new Set<string>();

  constructor(
    private httpClient: HttpClient,
    private modalService: NgbModal,
    private authService: AuthService,
    private logger: LoggerService,
  ) {
    this.encryptionKey = CryptoJS.enc.Base64.parse(environment.encryptionKey);
    this.encryptionIv = CryptoJS.enc.Base64.parse(environment.encryptionIv);
    
    // Додайте лог для перевірки, що вони не нульові
    console.log(`[ChatService] Key parsed (Length: ${this.encryptionKey.sigBytes} bytes)`);
    console.log(`[ChatService] IV parsed (Length: ${this.encryptionIv.sigBytes} bytes)`);
    this.subscriptions.push(this.authService.userName$.subscribe(name => {
      this.myName = name;
      if (name) {
        console.log(`[ChatService] User is authenticated as: ${name}. Attempting to create chat connection.`);
        this.createChatConnection();
      } else {
        console.log('[ChatService] User is not authenticated. Stopping chat connection.');
        this.stopChatConnection();
      }
    }));
  }

  

  ngOnDestroy(): void {
    this.stopChatConnection();
    this.subscriptions.forEach(sub => sub.unsubscribe());
  }
  
  public onNewMessage(): Observable<Message> {
    return this.newMessageSubject.asObservable();
  }
  
  public onGlobalMessagesStatusUpdated(): Observable<{ messageIds: string[], status: string }> {
    return this.globalMessagesStatusUpdatedSubject.asObservable();
  }
  
  public async markAllGlobalMessagesAsRead(): Promise<void> {
    if (this.chatConnection && this.chatConnection.state === HubConnectionState.Connected) {
      try {
        await this.chatConnection.invoke('MarkAllGlobalMessagesAsRead');
        console.log('[ChatService] Invoked MarkAllGlobalMessagesAsRead on server.');
      } catch (err) {
        console.error('[ChatService] Error invoking MarkAllGlobalMessagesAsRead:', err);
      }
    } else {
      console.warn('Cannot mark messages as read: SignalR connection is not established.');
    }
  }

  public async createChatConnection(): Promise<void> {
    if (!this.myName) {
      this.logger.logError('Cannot establish SignalR connection: User name is not set', 'SignalR');
      console.error('User name is not set. Cannot establish SignalR connection.');
      this.connectionErrorSubject.next('Помилка: ім\'я користувача не встановлено. Спробуйте увійти знову.');
      this.stopChatConnection();
      return;
    }
    
    if (this.chatConnection &&
      (this.chatConnection.state === HubConnectionState.Connected || this.isConnecting)) {
      console.log('SignalR connection already exists or in connecting state. Skipping creation.');
      return;
    }

    this.isConnecting = true;

    this.chatConnection = new HubConnectionBuilder()
      .withUrl(`${environment.apiUrl}/hubs/chat`, {
        withCredentials: true 
      })
      .withAutomaticReconnect({
        nextRetryDelayInMilliseconds: retryContext => {
          if (retryContext.elapsedMilliseconds < 2000) {
            return 0;
          } else if (retryContext.elapsedMilliseconds < 10000) {
            return 2000;
          } else if (retryContext.elapsedMilliseconds < 30000) {
            return 10000;
          } else {
            return 30000;
          }
        }
      })
      .build();

    this.chatConnection.start()
      .then(() => {
        console.log('SignalR Connection started!');
        this.logger.logInfo('SignalR connection established successfully', 'SignalR');
        this.isConnecting = false;
        this.connectionErrorSubject.next(null);
        this.registerHubListeners();
        this.loadInitialMessages();
      })
      .catch(error => {
        console.error('Error while starting SignalR connection: ' + error);
        this.logger.logError('Failed to start SignalR connection', 'SignalR', error);
        this.connectionErrorSubject.next('Помилка підключення до чату. Спробуйте пізніше.');
        this.isConnecting = false;
        this.chatConnection = undefined;
      });

    this.chatConnection.onclose(async error => {
        console.log('SignalR Connection closed.', error);
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        if (this.chatConnection && this.chatConnection.state === HubConnectionState.Disconnected) {
          console.log('[ChatService] Connection not re-established. Clearing chat data.');
          this.clearAllChatData(); 
          this.connectionErrorSubject.next('З\'єднання з чатом розірвано. Спроба перепідключення...');
        }
    });

    this.chatConnection.onreconnecting(error => {
      console.log('SignalR Connection reconnecting...', error);
      this.connectionErrorSubject.next('Перепідключення до чату...');
    });

    this.chatConnection.onreconnected(connectionId => {
      console.log('SignalR Connection reconnected with ID:', connectionId);
      this.connectionErrorSubject.next(null);
    });
  }

  public async markMessagesInViewAsRead(messageIds: string[]): Promise<void> {
    if (!this.chatConnection || this.chatConnection.state !== HubConnectionState.Connected) {
        console.warn('Cannot mark messages as read: SignalR connection is not established.');
        return;
    }

    const messagesToMark = this.allPublicMessages.filter(m => 
        messageIds.includes(m.id) && 
        m.from !== this.myName && 
        m.status !== 'read'
    );

    if (messagesToMark.length === 0) {
        return;
    }

    try {
        await this.chatConnection.invoke('MarkMultipleGlobalMessagesAsRead', messagesToMark.map(m => m.id));
        console.log(`[ChatService] Invoked 'MarkMultipleGlobalMessagesAsRead' for IDs: ${messagesToMark.map(m => m.id).join(', ')}`);
    } catch (err) {
        console.error(`[ChatService] Error while invoking MarkMultipleGlobalMessagesAsRead:`, err);
    }
  }

  private async deriveSessionKey(masterKey: string, salt: CryptoJS.lib.WordArray): Promise<CryptoJS.lib.WordArray> {
  return new Promise((resolve) => {
    // Використовуємо setTimeout для асинхронності, щоб не блокувати UI
    setTimeout(() => {
      const derivedKey = CryptoJS.PBKDF2(masterKey, salt, {
        keySize: 256 / 32, // 32 байти = 256 біт AES-256
        iterations: 10000, // OWASP рекомендує мінімум 10,000
        hasher: CryptoJS.algo.SHA256
      });
      resolve(derivedKey);
    }, 0);
  });
}
  
  private registerHubListeners(): void {
        // ✅ This is the correct and only place for the NewMessage listener
        this.chatConnection?.on('NewMessage', (receivedMessage: Message) => {
            this.handleReceivedMessage(receivedMessage);
        });

    this.chatConnection?.on('MessageEdited', async (editedMessage: Message) => {
    // ✅ Розшифровуємо ТІЛЬКИ текстові повідомлення
    if (!editedMessage.isFile && editedMessage.content) {
        try {
            // ✅ Використовуємо оновлений метод з await
            const decryptedContent = await this.decryptContent(
                editedMessage.content,
                editedMessage.iv,
                editedMessage.salt
            );

            if (decryptedContent.includes('[ПОМИЛКА')) {
                throw new Error('Decryption returned error');
            }

            editedMessage.content = decryptedContent;

        } catch (error) {
            console.warn(`⚠️ Failed to decrypt edited message ${editedMessage.id}:`, error);
            editedMessage.content = '[ПОМИЛКА РОЗШИФРУВАННЯ]';
        }
    }

    // ✅ Оновлюємо UI
    this.updateMessageContentAndEditedStatusInClient(
        editedMessage.id,
        editedMessage.content,
        editedMessage.edited,
        editedMessage.to ?? undefined
    );

});

    this.chatConnection?.on('MessageDeleted', (messageId: string, isPrivate: boolean, toUser?: string) => {
      console.log(`[ChatService] MessageDeleted received: ID=${messageId}`);
      this.removeMessageFromClient(messageId, toUser);
    });

    this.chatConnection?.on('OnlineUsers', (onlineUsers: string[]) => {
      this.usersSubject.next(onlineUsers);
      console.log('Online users updated:', onlineUsers);
    });

    this.chatConnection?.on('OpenPrivateChat', async (encryptedMessage: Message) => {
        // ✅ ВИКОРИСТОВУЄМО УНІФІКОВАНИЙ МЕТОД:
        const decryptedContent = await this.decryptContent(
            encryptedMessage.content,
            encryptedMessage.iv,
            encryptedMessage.salt
        );

        encryptedMessage.content = decryptedContent;
        encryptedMessage.edited = encryptedMessage.edited || false;

        this.addOrUpdatePrivateMessage(encryptedMessage);
        this.openPrivateChatModal(encryptedMessage.from!);
    });

    this.chatConnection?.on('NewPrivateMessage', async (encryptedMessage: Message) => {
        console.log(`[ChatService] NewPrivateMessage received: ID=${encryptedMessage.id}`);
        
        // ✅ await для async методу
        const receivedMessage = await this.processReceivedMessage(encryptedMessage);
        this.addOrUpdatePrivateMessage(receivedMessage);
    });

    this.chatConnection?.on('MessageError', (messageId: string, toUser: string, error: string) => {
      console.error(`Message ${messageId} to ${toUser} failed: ${error}`);
      this.updateMessageStatusInClient(messageId, 'error', toUser);
    });

    this.chatConnection?.on('PrivateChatClosed', (closingUser: string, targetUser: string) => {
      if (this.myName === targetUser) {
        console.log(`Received signal to close private chat with ${closingUser}`);
        this.privateChatClosedSubject.next({ otherUser: closingUser, initiator: closingUser });
      }
    });
    
    this.chatConnection?.on('AllMessagesReadFromUser', (readerUserName: string) => {
      console.log(`All messages from ${readerUserName} in global chat are now read.`);
    });
    
    this.chatConnection?.on('MessageStatusUpdated', (messageId: string, newStatus: string, toUser?: string) => {
      console.log('📨 MessageStatusUpdated:', { messageId, newStatus, toUser });
      console.log('📦 privateMessagesSubjectMap keys:', [...this.privateMessagesSubjectMap.keys()]);
      this.updateMessageStatusInClient(messageId, newStatus as 'sent' | 'delivered' | 'read' | 'error', toUser);
    });

    this.chatConnection?.on('MessagesMarkedAsRead', (otherUser: string) => {
      const subject = this.privateMessagesSubjectMap.get(otherUser);
      if (subject) {
        const updatedMessages = subject.getValue().map(m => ({
          ...m,
          status: (m.from !== this.myName ? m.status : 'read') as 'sent' | 'delivered' | 'read' | 'error'
        }));
        subject.next(updatedMessages);
      }
    });

    this.chatConnection?.on('CheckAndMarkAsRead', (fromUser: string) => {
      if (this.openPrivateChats.has(fromUser) && this.activeAndVisibleChats.has(fromUser)) {
        setTimeout(() => this.markMessagesAsRead(fromUser), 300);
      }
    });

    this.chatConnection?.on('GlobalMessagesStatusUpdated', (messageIds: string[], status: string) => {
      this.globalMessagesStatusUpdatedSubject.next({ messageIds, status });
      this.allPublicMessages.forEach(msg => {
        if (messageIds.includes(msg.id)) {
          msg.status = status as 'read';
        }
      });
      this.messagesSubject.next([...this.allPublicMessages]);
      console.log(`[ChatService] Received bulk status update for global messages: IDs=${messageIds.join(', ')}, Status=${status}`);
    });
  }


 // src/app/services/chat.service.ts

private addOrUpdatePrivateMessage(newMessage: Message) {
     
     // 🔥 ВИПРАВЛЕННЯ: Використовуємо лише newMessage.from та newMessage.to
     const sender = newMessage.from;
     const receiver = newMessage.to;

     // Логіка визначення співрозмовника:
     // Якщо відправник - я, співрозмовник - отримувач. Інакше - відправник.
     const otherUser = sender === this.myName ? (receiver || '') : (sender || '');

     // Додаткова перевірка, щоб уникнути помилок, якщо це не приватний чат
     if (!otherUser || otherUser === 'GlobalChat') { 
         return;
     }

     
     // Встановлюємо isMyMessage, використовуючи коректно визначеного sender
     newMessage.isMyMessage = sender === this.myName;

     let subjectForUser = this.privateMessagesSubjectMap.get(otherUser);

     if (!subjectForUser) {
         subjectForUser = new BehaviorSubject<Message[]>([]);
         this.privateMessagesSubjectMap.set(otherUser, subjectForUser);
     }

     const currentMessages = subjectForUser.getValue();
     
     const existingMessageIndex = currentMessages.findIndex(m => m.id === newMessage.id);

     if (existingMessageIndex === -1) {
         currentMessages.push(newMessage);
     } else {
         // Оновлюємо, використовуючи Object.assign для збереження посилань
         Object.assign(currentMessages[existingMessageIndex], newMessage); 
     }
     
     subjectForUser.next([...currentMessages]);
 }

  getPrivateMessagesObservableForUser(user: string): Observable<Message[]> {
    if (!this.privateMessagesSubjectMap.has(user)) {
      this.privateMessagesSubjectMap.set(user, new BehaviorSubject<Message[]>([]));
    }
    return this.privateMessagesSubjectMap.get(user)!.asObservable();
  }

  private openPrivateChatModal(toUser: string) {
    if (!this.isPrivateChatModalOpen) {
      this.isPrivateChatModalOpen = true;
      const modalRef = this.modalService.open(PrivateChatComponent);
      modalRef.componentInstance.toUser = toUser;
      modalRef.result.finally(() => {
        this.isPrivateChatModalOpen = false;
      });
    }
  }

  private createUserHash(userId: string): { hash: string, timestamp: number } {
      // ✅ Використовуємо Math.floor для цілого числа
      const timestamp = Math.floor(Date.now() / 1000); 
      
      // Рядок, який буде хешуватися. Завжди в одному форматі.
      const dataToHash = `${userId}:${timestamp}:${environment.userHashSecretKey}`;
      
      // Явно кодуємо в UTF-8 перед хешуванням
      const hashedBytes = CryptoJS.SHA256(CryptoJS.enc.Utf8.parse(dataToHash));
      
      // Переводимо результат у формат Base64
      const hash = CryptoJS.enc.Base64.stringify(hashedBytes);
      
      // Повертаємо об'єкт з хешем та timestamp
      return { hash, timestamp };
  }

  public async sendMessage(
  content: string, 
  isPrivate: boolean, 
  targetUser: string | null = null, 
  parentMessageId?: string | null
): Promise<void> {
  if (!this.myName) {
    console.error('[sendMessage] User not authenticated');
    return;
  }

  const tempId = this.generateGuid();
  const userHashData = this.createUserHash(this.myName);

  // ✅ Генеруємо криптографічно стійкі IV та Salt
  const iv = CryptoJS.lib.WordArray.random(16);   // 128 біт для AES
  const salt = CryptoJS.lib.WordArray.random(32); // 256 біт (оптимально для PBKDF2)

  try {
    // ✅ Деривуємо сесійний ключ
    const sessionKey = await this.deriveSessionKey(
      environment.encryptionKey, 
      salt
    );

    // ✅ Шифруємо контент з деривованим ключем
    const encryptedContent = CryptoJS.AES.encrypt(content, sessionKey, {
      iv: iv,
      mode: CryptoJS.mode.CBC,
      padding: CryptoJS.pad.Pkcs7
    }).toString();

    // Конвертуємо у Base64 для передачі
    const ivBase64 = iv.toString(CryptoJS.enc.Base64);
    const saltBase64 = salt.toString(CryptoJS.enc.Base64);

    console.log('[sendMessage] Encryption metadata:', {
      ivLength: ivBase64.length,
      saltLength: saltBase64.length,
      messageId: tempId
    });

    const messageToSend: Message = {
      id: tempId,
      tempId: tempId,
      from: this.myName,
      to: targetUser ?? undefined,
      content: encryptedContent,
      iv: ivBase64,
      salt: saltBase64,
      timestamp: new Date(),
      status: 'sent',
      edited: false,
      userHash: userHashData.hash,
      userHashTimestamp: userHashData.timestamp,
      parentMessageId: parentMessageId
    };

    // Показуємо plain text в UI (розшифрований контент)
    const displayMessage = { ...messageToSend, content: content };
    this.addOrUpdateMessage(displayMessage, true);

    // Відправляємо через SignalR
    if (isPrivate) {
      await this.chatConnection?.invoke('SendPrivateMessage', messageToSend);
      this.logger.logInfo(`Private message sent to ${targetUser}`, 'Chat');
    } else {
      await this.chatConnection?.invoke('SendMessage', messageToSend);
      this.logger.logInfo('Global message sent', 'Chat');
    }

  } catch (error) {
    console.error('[sendMessage] Encryption/Send failed:', error);
    this.logger.logError('Failed to send message', 'Chat', error);
    this.connectionErrorSubject.next('Помилка надсилання повідомлення');
  }
}

  private generateGuid(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      var r = Math.random() * 16 | 0,
        v = c == 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  public stopChatConnection() {
    if (this.chatConnection && this.chatConnection.state !== HubConnectionState.Disconnected) {
      console.log('Stopping SignalR Connection...');
      this.chatConnection.stop()
        .then(() => console.log('SignalR Connection stopped successfully.'))
        .catch(error => console.error('Error while stopping SignalR connection: ' + error));
    } else {
      console.log('SignalR connection is already disconnected or does not exist.');
    }
    this.privateMessagesSubjectMap.clear();
    this.allPublicMessages = [];
    this.messagesSubject.next([]);
    this.usersSubject.next([]);
    this.isConnecting = false;
    this.chatConnection = undefined;
  }

  public async sendPrivateMessage(to: string, content: string, parentMessageId?: string | null) {
    if (!this.myName) {
        console.error('User is not authenticated. Cannot send private message.');
        return;
    }

    const tempId = this.generateGuid();
    const userHashData = this.createUserHash(this.myName);

    // ✅ КРИТИЧНО: Генеруємо криптографічні параметри
    const iv = CryptoJS.lib.WordArray.random(16);
    const salt = CryptoJS.lib.WordArray.random(32);
    
    try {
        // ✅ Деривуємо сесійний ключ
        const sessionKey = await this.deriveSessionKey(environment.encryptionKey, salt);
        
        // ✅ Шифруємо контент
        const encryptedContent = CryptoJS.AES.encrypt(content, sessionKey, {
            iv: iv,
            mode: CryptoJS.mode.CBC,
            padding: CryptoJS.pad.Pkcs7
        }).toString();

        // ✅ Конвертуємо в Base64
        const ivBase64 = iv.toString(CryptoJS.enc.Base64);
        const saltBase64 = salt.toString(CryptoJS.enc.Base64);

        const messageToSend: Message = {
            id: tempId,
            tempId: tempId,
            from: this.myName,
            to: to,
            content: encryptedContent, // ✅ Зашифрований контент
            iv: ivBase64,              // ✅ IV
            salt: saltBase64,          // ✅ Salt
            timestamp: new Date(),
            status: 'sent',
            edited: false,
            userHash: userHashData.hash,
            userHashTimestamp: userHashData.timestamp,
            parentMessageId: parentMessageId
        };

        // ✅ Показуємо plain text в UI одразу
        const displayMessage = { ...messageToSend, content: content };
        this.addOrUpdatePrivateMessage(displayMessage);

        await this.chatConnection?.invoke('SendPrivateMessage', messageToSend);
        console.log(`[ChatService] Invoked 'SendPrivateMessage' to ${to} with encrypted content. ID: ${messageToSend.id}`);
        
    } catch (error) {
        console.error('Error sending private message:', error);
        this.connectionErrorSubject.next('Помилка надсилання приватного повідомлення. Спробуйте ще раз.');
    }
}

  async closePrivateChatMessage(otherUser: string) {
    if (!this.myName) return;
    await this.chatConnection?.invoke('RemovePrivateChat', this.myName, otherUser)
      .catch(error => console.log(error));
  }

  private updateMessageStatusInClient(messageId: string, newStatus: 'sent' | 'delivered' | 'read' | 'error', toUser?: string) {
      if (toUser) {
          // Логіка для приватних повідомлен
          const subject = this.privateMessagesSubjectMap.get(toUser);
          if (subject) {
              const currentMessages = subject.getValue();
              const messageIndex = currentMessages.findIndex(msg => msg.id === messageId);
              
              if (messageIndex !== -1) {
                  const updatedMessages = [...currentMessages];
                  updatedMessages[messageIndex] = { ...updatedMessages[messageIndex], status: newStatus };
                  
                  subject.next(updatedMessages); 
              } else {

              }
          }
      } else {
          //Логіка для глобальних (публічних) повідомлень
          const messageIndex = this.allPublicMessages.findIndex(msg => msg.id === messageId);
          if (messageIndex !== -1) {
              this.allPublicMessages[messageIndex].status = newStatus;
              this.messagesSubject.next([...this.allPublicMessages]);
          } else {

          }
      }
  }

  public async editGlobalMessage(messageId: string, newContent: string): Promise<void> {
    if (!this.myName || !this.chatConnection || this.chatConnection.state !== HubConnectionState.Connected) {
        console.error('[ChatService] Cannot edit global message');
        throw new Error('User not authenticated or SignalR connection is not established.');
    }

    // ✅ Оновлюємо UI оптимістично
    this.updateMessageContentAndEditedStatusInClient(messageId, newContent, true);
    
    // ✅ Генеруємо нові криптографічні параметри
    const iv = CryptoJS.lib.WordArray.random(16);
    const salt = CryptoJS.lib.WordArray.random(32);
    const sessionKey = await this.deriveSessionKey(environment.encryptionKey, salt);
    
    const encryptedContent = CryptoJS.AES.encrypt(newContent, sessionKey, {
        iv: iv,
        mode: CryptoJS.mode.CBC,
        padding: CryptoJS.pad.Pkcs7
    }).toString();

    // ✅ Конвертуємо в Base64
    const ivBase64 = iv.toString(CryptoJS.enc.Base64);
    const saltBase64 = salt.toString(CryptoJS.enc.Base64);

    try {
        // ✅ КРИТИЧНО: Передаємо ВСІ три параметри!
        await this.chatConnection.invoke(
            'EditGlobalMessage', 
            messageId, 
            encryptedContent,
            ivBase64,      // ✅ Новий IV
            saltBase64     // ✅ Новий Salt
        );
        
        console.log(`[ChatService] Invoked 'EditGlobalMessage' for ID: ${messageId} with new IV/Salt`);
    } catch (error) {
        console.error(`[ChatService] Error editing global message ${messageId}:`, error);
        this.revertLocalMessageEdit(messageId);
        this.connectionErrorSubject.next('Не вдалося відредагувати повідомлення.');
    }
}

  public async editPrivateMessage(toUser: string, messageId: string, newContent: string): Promise<void> {
    if (!this.myName || !this.chatConnection || this.chatConnection.state !== HubConnectionState.Connected) {
        console.error('[ChatService] Cannot edit private message');
        throw new Error('User not authenticated or SignalR connection is not established.');
    }

    // ✅ Оптимістичне оновлення UI
    this.updateMessageContentAndEditedStatusInClient(messageId, newContent, true, toUser);
    
    // ✅ Генеруємо нові криптографічні параметри
    const iv = CryptoJS.lib.WordArray.random(16);
    const salt = CryptoJS.lib.WordArray.random(32);
    const sessionKey = await this.deriveSessionKey(environment.encryptionKey, salt);
    
    const encryptedContent = CryptoJS.AES.encrypt(newContent, sessionKey, {
        iv: iv,
        mode: CryptoJS.mode.CBC,
        padding: CryptoJS.pad.Pkcs7
    }).toString();

    // ✅ Конвертуємо в Base64
    const ivBase64 = iv.toString(CryptoJS.enc.Base64);
    const saltBase64 = salt.toString(CryptoJS.enc.Base64);

    console.log('[editPrivateMessage] Sending encrypted content with IV/Salt:', {
        messageId,
        ivLength: ivBase64.length,
        saltLength: saltBase64.length
    });

    try {
        // ✅ КРИТИЧНО: Передаємо параметри в порядку: messageId, encrypted, IV, Salt, toUser
        await this.chatConnection.invoke(
            'EditPrivateMessage', 
            messageId,          // 1. string messageId
            encryptedContent,   // 2. string newContent (encrypted)
            ivBase64,           // 3. string iv ✅
            saltBase64,         // 4. string salt ✅
            toUser              // 5. string recipientUserName ✅
        );
        
        console.log(`[ChatService] ✅ Invoked 'EditPrivateMessage' for ID: ${messageId} with new IV/Salt`);
    } catch (error) {
        console.error(`[ChatService] Error editing private message ${messageId}:`, error);
        this.revertLocalMessageEdit(messageId, toUser);
        this.connectionErrorSubject.next('Не вдалося відредагувати повідомлення.');
    }
}

  
  private revertLocalMessageEdit(messageId: string, toUser?: string) {
    if (toUser) {
      const subject = this.privateMessagesSubjectMap.get(toUser);
      if (subject) {
        const currentMessages = subject.getValue();
        const messageIndex = currentMessages.findIndex(msg => msg.id === messageId);
        if (messageIndex !== -1) {
          const updatedMessages = [...currentMessages];
          updatedMessages[messageIndex] = { ...updatedMessages[messageIndex], edited: false };
          subject.next(updatedMessages);
        }
      }
    } else {
      const messageIndex = this.allPublicMessages.findIndex(msg => msg.id === messageId);
      if (messageIndex !== -1) {
        const updatedMessages = [...this.allPublicMessages];
        updatedMessages[messageIndex] = { ...updatedMessages[messageIndex], edited: false };
        this.allPublicMessages = updatedMessages;
        this.messagesSubject.next(this.allPublicMessages);
      }
    }
  }

  public async getPrivateChatHistory(otherUser: string): Promise<Message[]> {
        console.log(`[ChatService: History] Loading private chat history with: ${otherUser}`);
        
        try {
            const historyUrl = `${environment.apiUrl}/api/Chat/private/${otherUser}`;
            const messages = await firstValueFrom(
                this.httpClient.get<Message[]>(historyUrl, { withCredentials: true })
            );

            console.log(`[ChatService: History] Loaded ${messages.length} messages.`);
            
            // ✅ ВИПРАВЛЕННЯ: Promise.all для async map
            const processedMessages = await Promise.all(
                messages.map(async msg => {
                    msg.isMyMessage = msg.from === this.myName;
                    return await this.processReceivedMessage(msg);
                })
            );

            return processedMessages;

        } catch (error) {
            console.error(`[ChatService: History] Error loading history with ${otherUser}:`, error);
            throw error; 
        }
    }

 private async loadInitialMessages() {
    try {
        const url = `${this.backendUrl}/api/chat/messages/global`;
               
        const messages = await firstValueFrom(
            this.httpClient.get<Message[]>(url, {
                withCredentials: true
            })
        );
        
        this.allPublicMessages = await Promise.all(
        messages.map(async (msg) => {
            let processedMsg = { ...msg };

            // 1. Розшифрування тексту
            if (processedMsg.content && !processedMsg.isFile) {
            try {
                processedMsg.content = await this.decryptContent(
                processedMsg.content,
                processedMsg.iv,
                processedMsg.salt
                );
            } catch (error) {
                console.warn(`Failed to decrypt message ${processedMsg.id}`);
                processedMsg.content = '[Помилка розшифрування]';
            }
            }

            // 2. Обробка файлів
            if (processedMsg.isFile && processedMsg.fileName) {
            processedMsg.fileUrl = `${environment.apiUrl}/uploads/${processedMsg.fileName}`;
            }

            // 3. Конвертація часу
            if (typeof processedMsg.timestamp === 'string') {
            processedMsg.timestamp = new Date(processedMsg.timestamp);
            }

            return processedMsg;
        })
        );

        this.messagesSubject.next([...this.allPublicMessages]);
        
    } catch (error) {
        console.error('🛑 [ChatService] CRITICAL NETWORK/HTTP ERROR loading history:', error);
    }
}


  private aesEncryptionService = {
    encrypt: (text: string): string => {
      return CryptoJS.AES.encrypt(text, this.encryptionKey, {
        iv: this.encryptionIv,
        mode: CryptoJS.mode.CBC,
        padding: CryptoJS.pad.Pkcs7
      }).toString();
    },
    decrypt: (cipherText: string): string => {
      const bytes = CryptoJS.AES.decrypt(cipherText, this.encryptionKey, {
        iv: this.encryptionIv,
        mode: CryptoJS.mode.CBC,
        padding: CryptoJS.pad.Pkcs7
      });
      return bytes.toString(CryptoJS.enc.Utf8);
    }
  };

  public async decryptContent(
  encryptedText: string,
  ivBase64?: string,
  saltBase64?: string
): Promise<string> {
  if (!encryptedText || !this.encryptionKey) {
    console.warn('[decryptContent] Missing parameters');
    return '[ПОМИЛКА: Відсутні дані]';
  }

  try {
    // КРОК 1: Визначаємо IV
    const ivToUse = ivBase64
      ? CryptoJS.enc.Base64.parse(ivBase64)
      : this.encryptionIv; // Fallback для старих повідомлень

    // КРОК 2: Визначаємо ключ (деривований або статичний)
    let keyToUse: CryptoJS.lib.WordArray;

    if (saltBase64) {
      // ✅ Новий формат: деривуємо ключ з salt
      const salt = CryptoJS.enc.Base64.parse(saltBase64);
      keyToUse = await this.deriveSessionKey(environment.encryptionKey, salt);
    } else {
      // ✅ Старий формат: використовуємо статичний ключ
      keyToUse = this.encryptionKey;
    }

    // КРОК 3: Розшифрування
    const decryptedBytes = CryptoJS.AES.decrypt(
      encryptedText,
      keyToUse,
      {
        iv: ivToUse,
        mode: CryptoJS.mode.CBC,
        padding: CryptoJS.pad.Pkcs7
      }
    );

    if (decryptedBytes.sigBytes === 0) {
      throw new Error('Decryption returned 0 bytes');
    }

    const decryptedContent = decryptedBytes.toString(CryptoJS.enc.Utf8);

    if (!decryptedContent?.trim()) {
      throw new Error('Decrypted content is empty');
    }

    return decryptedContent;

  } catch (error) {
    // КРОК 4: Fallback для старих повідомлень без salt
    if (saltBase64) {
      console.warn('[decryptContent] PBKDF2 failed, trying static key...');
      try {
        const decryptedBytes = CryptoJS.AES.decrypt(
          encryptedText,
          this.encryptionKey,
          {
            iv: ivBase64 
              ? CryptoJS.enc.Base64.parse(ivBase64) 
              : this.encryptionIv,
            mode: CryptoJS.mode.CBC,
            padding: CryptoJS.pad.Pkcs7
          }
        );

        const content = decryptedBytes.toString(CryptoJS.enc.Utf8);
        if (content?.trim()) {
          return content;
        }
      } catch (fallbackError) {
        console.error('[decryptContent] Fallback also failed');
      }
    }

    console.error('[decryptContent] All decryption attempts failed:', error);
    return '[ПОМИЛКА РОЗШИФРУВАННЯ]';
  }
}

  private logMessageState(msg: Message, context: string): void {
      console.log(`[${context}] Message ID: ${msg.id}`);
      console.log(`[${context}] From: ${msg.from}, To: ${msg.to}`);
      console.log(`[${context}] Content: ${msg.content?.substring(0, 50) || 'EMPTY'}`);
      console.log(`[${context}] isFile: ${msg.isFile}, fileName: ${msg.fileName}`);
      console.log(`[${context}] fileUrl: ${msg.fileUrl}`);
      console.log(`[${context}] isMyMessage: ${msg.isMyMessage}`);
      console.log(`[${context}] status: ${msg.status}`);
  }

  private async processReceivedMessage(msg: any): Promise<Message> {
    
    const detectedFrom = msg.fromUser || msg.FromUser || msg.from;
    const detectedTo = msg.toUser || msg.ToUser || msg.to;
    
    const finalMessage: Message = {
        ...msg,
        from: detectedFrom,
        to: detectedTo
    };
    
    finalMessage.isMyMessage = (finalMessage.from === this.myName);

    if (typeof finalMessage.timestamp === 'string') {
        finalMessage.timestamp = new Date(finalMessage.timestamp);
    }

    // 1. Обробка файлів
    if (finalMessage.isFile && finalMessage.fileName) {
        finalMessage.content = finalMessage.content || '';
        finalMessage.fileUrl = `${environment.apiUrl}/uploads/${finalMessage.fileName}`;
    } 
    // 2. Обробка текстових повідомлень
    else if (finalMessage.content) {
        // ✅ ВИКОРИСТОВУЄМО await для асинхронного розшифрування
        if (typeof finalMessage.content === 'string') {
            finalMessage.content = await this.decryptContent(
                finalMessage.content,
                finalMessage.iv,
                finalMessage.salt
            );
        }
    }
    
    finalMessage.status = (finalMessage.status || 'delivered') as 'sent' | 'delivered' | 'read' | 'error';
    finalMessage.edited = finalMessage.edited || false;


    return finalMessage;
}

  public sendNotification(message: string): void {
      this.userNotificationSubject.next(message);
      // Опціонально: автоматично очищаємо після 5 секунд, щоб notification не відображався постійно
      setTimeout(() => this.userNotificationSubject.next(null), 5000); 
  }

  private updateMessageContentAndEditedStatusInClient(messageId: string, newContent: string, editedStatus?: boolean, toUser?: string) {
    let messageFound = false;
    
    if (toUser) {
      const subject = this.privateMessagesSubjectMap.get(toUser);
      if (subject) {
        const currentMessages = subject.getValue();
        const messageIndex = currentMessages.findIndex(m => m.id === messageId);
        if (messageIndex !== -1) {
          const updatedMessages = [...currentMessages];
          updatedMessages[messageIndex] = {
            ...updatedMessages[messageIndex],
            content: newContent,
            edited: editedStatus !== undefined ? editedStatus : true
          };
          subject.next(updatedMessages);
          console.log(`[ChatService] Updated private message ${messageId} content and edited status for user ${toUser}.`);
          messageFound = true;
        }
      }
    }

    if (!messageFound) {
      const messageIndex = this.allPublicMessages.findIndex(msg => msg.id === messageId);
      if (messageIndex !== -1) {
        const updatedMessages = [...this.allPublicMessages];
        updatedMessages[messageIndex] = {
          ...updatedMessages[messageIndex],
          content: newContent,
          edited: editedStatus !== undefined ? editedStatus : true
        };
        this.allPublicMessages = updatedMessages;
        this.messagesSubject.next(this.allPublicMessages);
        console.log(`[ChatService] Updated public message ${messageId} content and edited status.`);
      } else {
        console.warn(`[ChatService] Message with ID ${messageId} not found for content update.`);
      }
    }
  }

  public async deleteGlobalMessage(messageId: string): Promise<void> {
    if (!this.chatConnection || this.chatConnection.state !== HubConnectionState.Connected) {
      console.error('[ChatService] Cannot delete message: SignalR connection is not established.');
      throw new Error('SignalR connection is not established.');
    }
    
    if (!this.myName) {
      console.error('User not authenticated. Cannot delete message.');
      return;
    }

    this.removeMessageFromClient(messageId); 

    try {
      await this.chatConnection.invoke('DeleteGlobalMessage', messageId);
      console.log(`[ChatService] Invoked 'DeleteGlobalMessage' for ID: ${messageId}`);
    } catch (error) {
      console.error(`[ChatService] Error deleting global message ${messageId}:`, error);
      this.connectionErrorSubject.next('Не вдалося видалити повідомлення. Спробуйте ще раз.');
    }
  }

  public async deletePrivateMessage(toUser: string, messageId: string): Promise<void> {
        if (!this.chatConnection || this.chatConnection.state !== HubConnectionState.Connected) {
        console.error('[ChatService] Cannot delete private message: SignalR connection is not established.');
        this.userNotificationSubject.next('Помилка: З\'єднання з чатом втрачено.');
        return;
        }
        
        if (!this.myName) {
        console.error('User not authenticated. Cannot delete private message.');
        this.userNotificationSubject.next('Помилка: Ви не авторизовані.');
        return;
        }

        console.log(`[deletePrivateMessage] Attempting to delete message ${messageId} in chat with ${toUser}`);
        
        const subject = this.privateMessagesSubjectMap.get(toUser);
        
        // Перевірка наявності повідомлення
        const backupMessage: Message | undefined = subject?.getValue().find(m => m.id === messageId);
        if (!backupMessage) {
            console.warn(`[ChatService] Message ${messageId} not found locally. Aborting optimistic deletion.`);
            return;
        }
        
        // ОПТИМІСТИЧНЕ ВИДАЛЕННЯ (Видаляємо з UI перед підтвердженням сервера)
        this.removeMessageFromClient(messageId, toUser); 

        try {
        // 🚀 ВИПРАВЛЕННЯ №1: Передаємо аргументи в порядку, який очікує C# Hub: (messageId, toUser)
        // C#: public async Task DeletePrivateMessage(string messageId, string toUser)
        await this.chatConnection.invoke('DeletePrivateMessage', messageId, toUser);
        
        console.log(`[ChatService] ✅ Successfully invoked 'DeletePrivateMessage' for ID: ${messageId}. Waiting for server confirmation.`);
            
        } catch (error) {
        console.error(`[ChatService] ❌ Error deleting private message ${messageId}:`, error);
        
        // КОМПЕНСАЦІЙНА ЛОГІКА (Відновлення повідомлення в UI)
            if (subject) {
                let currentMessages = subject.getValue();
                
                // 1. Додаємо повідомлення
                currentMessages.push(backupMessage); 
                
                // 2. 🚀 ВИПРАВЛЕННЯ №2: Сортуємо масив для відновлення правильного хронологічного порядку
                currentMessages.sort((a, b) => {
                // Використовуємо оператор || 0, щоб уникнути помилки, якщо timestamp відсутній.
                // Припускаємо, що повідомлення без timestamp є найстарішим.

                const timeA = a.timestamp 
                            ? new Date(a.timestamp).getTime() 
                            : 0; // 👈 Виправлення: Якщо undefined, приймати 0
                            
                const timeB = b.timestamp 
                            ? new Date(b.timestamp).getTime() 
                            : 0; // 👈 Виправлення: Якщо undefined, приймати 0
                            
                return timeA - timeB; // Сортування за зростанням часу
            });

            // Оновлюємо Subject
            subject.next(currentMessages);
            console.warn(`[ChatService] Restored message ${messageId} after failed server deletion.`);
        }
                
        this.userNotificationSubject.next('Не вдалося видалити повідомлення. Спробуйте ще раз.');
        }
    }

  private removeMessageFromClient(messageId: string, toUser?: string) {
    let messageFound = false;
    
    if (!this.myName) return;
    
    if (toUser) {
      const subject = this.privateMessagesSubjectMap.get(toUser);
      if (subject) {
        const currentMessages = subject.getValue();
        const initialLength = currentMessages.length;
        const filteredMessages = currentMessages.filter(msg => msg.id !== messageId);
        if (filteredMessages.length < initialLength) {
          subject.next([...filteredMessages]);
          console.log(`[ChatService] Removed private message ${messageId} from user ${toUser}'s chat.`);
          messageFound = true;
        }
      }
    }

    if (!messageFound) {
      const initialLength = this.allPublicMessages.length;
      this.allPublicMessages = this.allPublicMessages.filter(msg => msg.id !== messageId);
      if (this.allPublicMessages.length < initialLength) {
        this.messagesSubject.next([...this.allPublicMessages]);
        console.log(`[ChatService] Removed public message ${messageId} from global chat.`);
      } else {
        console.warn(`[ChatService] Message with ID ${messageId} not found for removal in any chat.`);
      }
    }
  }


  public async markGlobalMessageAsRead(messageId: string): Promise<void> {
    const message = this.allPublicMessages.find(m => m.id === messageId);
    if (message && message.status !== 'read') {
      try {
        if (this.chatConnection) {
          await this.chatConnection.invoke('MarkSingleGlobalMessageAsRead', messageId);
          console.log(`[ChatService] Global message ${messageId} invoked MarkSingleGlobalMessageAsRead on server.`);
        }
      } catch (err) {
        console.error(`[ChatService] Error while invoking MarkSingleGlobalMessageAsRead on server for ${messageId}:`, err);
      }
    } else {
      console.log(`[ChatService] Message ${messageId} is already marked as read or not found.`);
    }
  }

  public markMessageAsRead(messageId: string): void {
    if (this.chatConnection && this.chatConnection.state === HubConnectionState.Connected) {
      this.chatConnection.invoke("MarkSingleGlobalMessageAsRead", messageId)
        .catch(err => console.error('[ChatService] Error invoking MarkSingleGlobalMessageAsRead:', err));
    } else {
      console.error('[ChatService] Cannot mark message as read. Connection is not active.');
    }
  }

  // chat.service.ts

  public async loadPrivateMessages(otherUser: string): Promise<void> {
    try {
        const url = `${environment.apiUrl}/api/chat/private/${otherUser}`;
        const encryptedMessages = await firstValueFrom(
            this.httpClient.get<Message[]>(url, { withCredentials: true })
        );

        // ✅ Promise.all для async map
        const decryptedMessages = await Promise.all(
            encryptedMessages.map(async (msg: Message) => 
                await this.processReceivedMessage(msg)
            )
        );

        let subjectForUser = this.privateMessagesSubjectMap.get(otherUser);
        if (!subjectForUser) {
            subjectForUser = new BehaviorSubject<Message[]>([]);
            this.privateMessagesSubjectMap.set(otherUser, subjectForUser);
        }

        subjectForUser.next(decryptedMessages);
        console.log(`[ChatService] Loaded private messages for ${otherUser}.`);
    } catch (error) {
        console.error(`[ChatService] Failed to load private messages for ${otherUser}:`, error);
    }
}

  // src/app/services/chat.service.ts

public async loadAndSyncPrivateChat(otherUser: string): Promise<void> {
    console.log(`[loadAndSyncPrivateChat] STARTING for user: ${otherUser}`);
    
    if (!this.privateMessagesSubjectMap.has(otherUser)) {
        this.privateMessagesSubjectMap.set(otherUser, new BehaviorSubject<Message[]>([]));
    }

    try {
        const url = `${environment.apiUrl}/api/Chat/private/${otherUser}`;
        const history = await firstValueFrom(
            this.httpClient.get<any[]>(url, { withCredentials: true })
        );

        // ✅ КРИТИЧНО: await Promise.all перед сортуванням!
        const processedMessages = await Promise.all(
            history.map(async (msgFromBackend: any) => {
                const correctedMessage: Message = {
                    ...msgFromBackend,
                    from: msgFromBackend.FromUser || msgFromBackend.from,
                    to: msgFromBackend.ToUser || msgFromBackend.to,
                } as Message;
                
                return await this.processReceivedMessage(correctedMessage);
            })
        );
        
        // ✅ Тепер сортуємо вже розшифровані Message об'єкти
        const sortedMessages = processedMessages.sort((a, b) =>
            (a.timestamp?.getTime() ?? 0) - (b.timestamp?.getTime() ?? 0) 
        );
        
        const subject = this.privateMessagesSubjectMap.get(otherUser)!;
        subject.next(sortedMessages);
        
        await this.markMessagesAsRead(otherUser);

    } catch (error) {
        console.error(`[loadAndSyncPrivateChat] ERROR:`, error);
    }
}

  private markAsReadTimeout: any = null;

  public async markMessagesAsRead(otherUser: string) {
    if (!this.myName) return;

    const subjectForUser = this.privateMessagesSubjectMap.get(otherUser);
    if (subjectForUser) {
      const messages = subjectForUser.getValue();
      const hasUnread = messages.some(m => m.from === otherUser && m.status !== 'read');
      if (hasUnread) {
        await this.chatConnection?.invoke('MarkMessagesAsRead', otherUser);
      }
    }
  }

  // src/app/services/chat.service.ts

  // src/app/services/chat.service.ts

public async sendPrivateFile(to: string, file: File, parentMessageId: string | null = null) {
     if (!this.myName) {
         console.error('User is not authenticated. Cannot send private file.');
         return;
     }

     // 1. Надсилаємо сам файл через HTTP POST-запит
     const formData = new FormData();
     
     // Вирівнювання імен полів для C# бекенду
     formData.append('File', file, file.name); 
     formData.append('ToUser', to); 
     formData.append('TempId', crypto.randomUUID()); // ✅ ДОДАНО: TempId для C# бекенду

     // Додаємо parentMessageId лише якщо він існує
     if (parentMessageId) {
         formData.append('ParentMessageId', parentMessageId);
     }

     try {
         const url = `${environment.apiUrl}/api/Chat/SendFile`;
         console.log(`[ChatService] Sending file POST to: ${url}`);

         // Очікуємо об'єкт Message, який містить поля 'fromUser' та 'toUser' від C#
         const message: Message = await firstValueFrom(
             this.httpClient.post<Message>(url, formData, { withCredentials: true })
         );
         
         // 🔥 ВИПРАВЛЕННЯ: Трансформація полів з PascalCase (C#) на CamelCase (Angular)
         // Використовуємо 'as any', оскільки 'fromUser' та 'toUser' не існують у типі Message.
         (message as any).from = (message as any).fromUser;
         (message as any).to = (message as any).toUser;
         
         // Очищаємо поля 'fromUser' і 'toUser', щоб вони не конфліктували
         delete (message as any).fromUser;
         delete (message as any).toUser;


         // 🔥 ВИПРАВЛЕННЯ: Встановлення fileUrl для компонента
         if (message.isFile && message.fileName) {
              message.fileUrl = `${environment.apiUrl}/uploads/${message.fileName}`;
         } else {
             console.warn('[ChatService] File metadata missing (isFile/fileName). Cannot set fileUrl.');
         }

         console.log('[ChatService] File uploaded and message created successfully:', message);

         // Тепер message.from та message.to встановлені, і це виправить проблему з addOrUpdatePrivateMessage
         this.addOrUpdatePrivateMessage(message); 

     } catch (error) {
         console.error('Error sending private file:', error);
         this.connectionErrorSubject.next('Помилка надсилання файлу. Спробуйте ще раз.');
     }
 }

  public getPrivateMessages(user: string): Message[] {
    const subject = this.privateMessagesSubjectMap.get(user);
    return subject ? subject.getValue() : [];
  }

  // Замініть метод downloadFile у chat.service.ts на цей:

public async downloadFile(fileUrl: string, fileName: string): Promise<void> {
    try {
        console.log(`[ChatService] Starting download: ${fileUrl}`);
        
        const fileBlob = await firstValueFrom(
            this.httpClient.get(fileUrl, { 
                responseType: 'blob', 
                withCredentials: true 
            })
        );

        const blobUrl = window.URL.createObjectURL(fileBlob);
        const link = document.createElement('a');
        link.href = blobUrl;
        link.download = fileName;
        
        document.body.appendChild(link);
        link.click();
        
        document.body.removeChild(link);
        window.URL.revokeObjectURL(blobUrl);

        console.log(`[ChatService] File '${fileName}' downloaded successfully.`);
        
    } catch (error: any) {
        const httpError = error as HttpErrorResponse;

        // 🔥 КРИТИЧНЕ ВИПРАВЛЕННЯ: Обробляємо 404 БЕЗ викидання помилки далі
        if (httpError && httpError.status === 404) {
            console.warn(`[Download Error] File not found (404): ${fileUrl}`);
            console.warn('This is expected if the file was deleted from server.');
            
            // ✅ Показуємо user-friendly повідомлення через Subject
            this.connectionErrorSubject.next(
                `Файл "${fileName}" не знайдено на сервері. Можливо, він був видалений.`
            );
            
            // ✅ ВАЖЛИВО: Не викидаємо помилку далі, щоб не спрацював інший error handler
            return; 
        }
        
        // 🔥 Для інших помилок (401, 403, 500) - логуємо і показуємо загальне повідомлення
        console.error('[ChatService] Download failed with error:', httpError?.status || 'unknown', error);
        
        this.connectionErrorSubject.next(
            'Помилка завантаження файлу. Перевірте з\'єднання та спробуйте ще раз.'
        );
        
        // ❌ НЕ ВИКЛИКАЄМО throw error - інакше це може потрапити в глобальний error handler
    }
}

  // src/app/services/chat.service.ts

  public async sendGlobalFile(file: File, parentMessageId: string | null = null) {
    if (!this.myName) {
        console.error('User is not authenticated. Cannot send global file.');
        return;
    }

    const tempMessageId = this.generateGuid();
    const tempMessage: Message = {
        id: tempMessageId,
        tempId: tempMessageId, // Зберігаємо тимчасовий ID
        from: this.myName,
        to: 'GlobalChat',
        content: '',
        isFile: true,
        fileName: file.name,
        fileUrl: URL.createObjectURL(file),
        timestamp: new Date(),
        status: 'sent',
        edited: false,
        parentMessageId: parentMessageId,
    };
    
    // Додаємо повідомлення одразу в UI
    this.addOrUpdateMessage(tempMessage, true);

    const formData = new FormData();
    formData.append('file', file);
    formData.append('tempId', tempMessageId); // ✅ Надсилаємо тимчасовий ID на сервер
    if (parentMessageId) {
        formData.append('parentMessageId', parentMessageId);
    }
    
    try {
        const url = `${environment.apiUrl}/api/chat/send-global-file`;
        await firstValueFrom(this.httpClient.post<any>(url, formData, { withCredentials: true }));
        console.log('[ChatService] Global file upload request sent. Waiting for SignalR update.');
    } catch (error) {
        console.error('Error sending global file:', error);
        this.connectionErrorSubject.next('Помилка надсилання файлу в глобальний чат. Спробуйте ще раз.');
        // У разі помилки оновлюємо статус на "error"
        const index = this.allPublicMessages.findIndex(m => m.id === tempMessageId);
        if (index !== -1) {
            this.allPublicMessages[index].status = 'error';
            this.messagesSubject.next([...this.allPublicMessages]);
            if (this.allPublicMessages[index].fileUrl) {
                URL.revokeObjectURL(this.allPublicMessages[index].fileUrl!);
            }
        }
    }
  }

 private addOrUpdateMessage(message: Message, isMyMessage: boolean = false) {
      let existingMessageIndex = -1;
      
      // ✅ 1. Спочатку шукаємо за постійним ID
      existingMessageIndex = this.allPublicMessages.findIndex(m => m.id === message.id);
      
      // ✅ 2. Якщо повідомлення наше і не знайдено, шукаємо за тимчасовим ID
      if (existingMessageIndex === -1 && isMyMessage && message.tempId) {
          existingMessageIndex = this.allPublicMessages.findIndex(m => m.id === message.tempId);
      }
      
      if (existingMessageIndex !== -1) {
          // Оновлюємо існуюче повідомлення
          const messageToUpdate = this.allPublicMessages[existingMessageIndex];
          
          // Відкликаємо тимчасовий Blob URL, щоб уникнути витоків пам'яті
          if (messageToUpdate.fileUrl?.startsWith('blob:')) {
              URL.revokeObjectURL(messageToUpdate.fileUrl);
              console.log(`[ChatService] Revoked Blob URL for message ${messageToUpdate.id}`);
          }
          
          // Оновлюємо повідомлення: id змінюється на постійний
          const updatedMessage = {
              ...messageToUpdate, 
              ...message, 
              id: message.id,
          };
          this.allPublicMessages[existingMessageIndex] = updatedMessage;
          console.log(`[ChatService] Message updated from tempId ${messageToUpdate.id} to permanent ID ${message.id}.`);
      } else {
          // Додаємо нове повідомлення, якщо його не знайдено
          this.allPublicMessages.push(message);
          console.log(`[ChatService] Added new message ${message.id} to public chat.`);
      }

      this.messagesSubject.next([...this.allPublicMessages]);
  }

  // ✅ Єдина функція для обробки вхідних повідомлень
  // src/app/services/chat.service.ts

  private async handleReceivedMessage(receivedMessage: Message): Promise<void> {
    const isFileMessage = receivedMessage.isFile;
    let finalMessage = receivedMessage;

    if (receivedMessage.to && receivedMessage.to !== 'GlobalChat') {
        const processed = await this.processReceivedMessage(receivedMessage);
        this.addOrUpdatePrivateMessage(processed);
        return;
    }

    // 1. РОЗШИФРУВАННЯ ТЕКСТУ (якщо це НЕ файл і контент існує)
    if (receivedMessage.content && !isFileMessage) { 
        try {
            
            // ✅ ВИКОРИСТОВУЄМО await для асинхронного розшифрування
            const decryptedContent = await this.decryptContent(
                receivedMessage.content,
                receivedMessage.iv,
                receivedMessage.salt
            );
            
            if (!decryptedContent || decryptedContent.includes('[DECRYPTION ERROR]')) {
                throw new Error("Decryption returned error");
            }

            finalMessage.content = decryptedContent;
            
        } catch (error) {
            console.warn(`Decryption failed for message ${receivedMessage.id}:`, error);
            finalMessage.content = `[DECRYPTION ERROR] Could not decrypt message`;
        }
    }

    // 2. Встановлення fileUrl для файлів
    if (isFileMessage && receivedMessage.fileName) { 
        finalMessage.fileUrl = `${environment.apiUrl}/uploads/${receivedMessage.fileName}`;
    }
    
    finalMessage.status = (receivedMessage.status || 'delivered') as 'sent' | 'delivered' | 'read' | 'error';
    finalMessage.edited = receivedMessage.edited || false;

    const isMyMessage = finalMessage.from === this.myName;
    this.addOrUpdateMessage(finalMessage, isMyMessage);
    this.newMessageSubject.next(finalMessage);
}

  

  public clearAllChatData() {
      this.privateMessagesSubjectMap.clear();
      this.allPublicMessages = [];
      this.messagesSubject.next([]);
      this.usersSubject.next([]);
  }

}