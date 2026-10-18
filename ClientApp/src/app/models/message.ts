// src/app/models/message.ts

export interface Message {
    id: string; // Постійний ID, що присвоюється сервером
    tempId?: string; // ✅ Тимчасовий ID, що генерується на клієнті
    from: string;
    to?: string | null; 
    content: string;
    iv?: string;        // ✅ ДОДАНО
    salt?: string;      // ✅ ДОДАНО
    timestamp?: Date;
    status?: 'sent' | 'delivered' | 'read' | 'error';
    edited?: boolean;
    parentMessageId?: string | null;
    isMyMessage?: boolean;
    isFile?: boolean;
    fileName?: string;
    fileUrl?: string;
    userHash?: string;
    userHashTimestamp?: number;
    imageWidth?: number;
    imageHeight?: number;
}