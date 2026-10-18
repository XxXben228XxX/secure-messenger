// src/app/models/user.ts
export interface User {
    id?: number;
    userName: string; // Змінено з 'name' на 'userName'
    password: string;
    isOnline: boolean;
    connectionId: string;
}