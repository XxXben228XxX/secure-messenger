# Secure Messenger (Chat)

Веб-застосунок для обміну зашифрованими повідомленнями в реальному часі з анонімним доступом.
Розроблено як кваліфікаційну роботу «Цифрова система обміну зашифрованими повідомленнями
з використанням ASP.NET Core».

Сервер зберігає та маршрутизує лише зашифровані дані (принцип Zero-Knowledge):
шифрування й розшифрування відбуваються в браузері.

## Можливості

- Анонімний доступ: ім'я + пароль, без email. Якщо користувача немає, акаунт створюється автоматично, інакше виконується вхід
- Глобальний та приватний чати в реальному часі (SignalR / WebSocket)
- Наскрізне шифрування AES-256-CBC; для кожного повідомлення генеруються унікальні IV (16 байт) і Salt (32 байти), ключ виводиться через PBKDF2 (10 000 ітерацій, SHA-256)
- Відповіді на повідомлення, редагування (з новими IV/Salt) і видалення
- Статуси повідомлень: надіслано, доставлено, переглянуто
- Надсилання файлів і зображень
- Автентифікація через JWT у HttpOnly cookie
- Анімований WebGL-фон (бібліотека OGL)

## Технології

| Частина  | Стек                                                     |
|----------|----------------------------------------------------------|
| Бекенд   | ASP.NET Core, SignalR, Entity Framework Core             |
| Фронтенд | Angular, TypeScript, RxJS, CryptoJS, OGL                 |
| База     | Microsoft SQL Server                                     |
| Тести    | Jest (ts-jest)                                           |

## Структура репозиторію

```
secure-messenger/
├── Chat.sln
├── Api/                  # бекенд (ASP.NET Core)
│   ├── Controllers/      # Chat, User, Encryption, Log, Test, Fallback
│   ├── Hubs/ChatHub.cs   # SignalR-хаб (/chatHub)
│   ├── Services/         # ChatService, UserService, JwtService
│   ├── Models/ Dtos/ Data/
│   └── Migrations/       # міграції EF Core
└── ClientApp/            # фронтенд (Angular)
    ├── src/app/          # chat, private-chat, messages, navbar, services...
    └── tests/            # unit та api тести (Jest)
```

## REST API

| Метод | Ендпоінт                          | Доступ    | Опис                                  |
|-------|-----------------------------------|-----------|---------------------------------------|
| POST  | /api/Chat/register                | публічний | Реєстрація або вхід                   |
| POST  | /api/Chat/login                   | публічний | Вхід, JWT у cookie                    |
| POST  | /api/Chat/logout                  | захищений | Завершення сесії                      |
| GET   | /api/Chat/current-user            | захищений | Поточний користувач                   |
| GET   | /api/Chat/messages/global         | захищений | Історія глобального чату              |
| GET   | /api/Chat/private/{otherUser}     | захищений | Історія приватного чату               |
| POST  | /api/Chat/SendFile                | захищений | Файл у приватний чат                  |
| POST  | /api/Chat/send-global-file        | захищений | Файл у глобальний чат                 |

Повідомлення в реальному часі йдуть через SignalR-хаб `/chatHub`.

## Вимоги

- .NET SDK (версія з `Api.csproj`)
- Node.js та npm
- Microsoft SQL Server
- EF Core CLI: `dotnet tool install --global dotnet-ef`

## Налаштування

### Бекенд (`Api/appsettings.json`)

Реальні значення не комітяться. Потрібні такі налаштування:

```json
{
  "ConnectionStrings": { "DefaultConnection": "<рядок підключення до SQL Server>" },
  "Jwt": {
    "SecretKey": "<ключ щонайменше 32 символи>",
    "Issuer": "ChatApp",
    "Audience": "ChatAppUsers",
    "ExpirationMinutes": 60
  },
  "ChatSettings": {
    "UserHashSecretKey": "<секрет>",
    "UserHashExpirationMinutes": 5
  }
}
```

Секрети зручно задавати через user-secrets:

```
cd Api
dotnet user-secrets init
dotnet user-secrets set "Jwt:SecretKey" "<ключ>"
dotnet user-secrets set "ConnectionStrings:DefaultConnection" "<рядок>"
```

### Фронтенд (`ClientApp/src/environments/environment.ts`)

Вкажіть `apiUrl` (за замовчуванням `http://localhost:5051`) та ключі шифрування:
`encryptionKey`, `encryptionIv`, `userHashSecretKey`.

### База даних

```
cd Api
dotnet ef database update
```

Папка `Api/wwwroot/uploads` потрібна для завантажених файлів (у репозиторії є `.gitkeep`).

## Запуск

Бекенд:

```
cd Api
dotnet run
```

Фронтенд:

```
cd ClientApp
npm install
ng serve
```

Збірка фронтенду, який віддає сам бекенд з `Api/wwwroot`:

```
cd ClientApp
ng build
```

## Тести

```
cd ClientApp
npx jest
```

- 25 юніт-тестів криптографічного модуля, покриття 98.48% рядків і 100% функцій
- 22 інтеграційні тести API (потребують запущеного бекенду)
- Навантажувальне тестування в Chrome DevTools: 55–60 FPS при 4x CPU throttling, затримка доставки до 100 мс

## Відомі обмеження

- Мастер-ключ шифрування задається в конфігурації клієнта, а не обмінюється між користувачами. Повноцінний асиметричний обмін ключами (Diffie-Hellman) запланований як подальший розвиток
- Для сумісності зі старими повідомленнями без Salt є режим розшифрування зі статичним ключем