import {
    Component, OnInit, AfterViewInit, ViewChildren, QueryList, ElementRef,
    Input, OnDestroy, ChangeDetectorRef
} from '@angular/core';
import { gsap } from 'gsap';
import { Observer } from 'gsap/Observer';

gsap.registerPlugin(Observer);

interface BackgroundItem {
    content: string;
}

interface ItemAnimationProxy {
    element: HTMLElement;
    _virtualPosition: number;
}

@Component({
    selector: 'app-infinite-background',
    templateUrl: './infinite-background.component.html',
    styleUrls: ['./infinite-background.component.css']
})
export class InfiniteBackgroundComponent implements OnInit, AfterViewInit, OnDestroy {

    @Input() width: string = "30rem";
    @Input() maxHeight: string = "100vh";
    @Input() items: BackgroundItem[] = [];
    @Input() itemMinHeight: number = 150;
    @Input() isTilted: boolean = false;
    @Input() tiltDirection: "left" | "right" = "left";
    @Input() autoplay: boolean = true;
    @Input() autoplaySpeed: number = 0.0005; // ЗМЕНШЕНО ШВИДКІСТЬ НА 50% (ЗБІЛЬШЕНО ТРИВАЛІСТЬ ВДВІЧІ)
    @Input() autoplayDirection: "up-left" | "down-right" | "down-left" | "up-right" = "up-left";
    @Input() pauseOnHover: boolean = false;

    @Input() itemRotationZ: number = -15;
    @Input() itemRotationX: number = 15;
    @Input() itemRotationY: number = -8;
    @Input() diagonalSpacing: number = 400;

    // НОВІ ВЛАСТИВОСТІ ДЛЯ БОКОВИХ ПОТОКІВ
    @Input() enableSideFlows: boolean = true;
    // Ці властивості тепер будуть прямим початковим X-зміщенням для потоків
    @Input() leftFlowInitialX: number = -1000; // Початкова X-координата для лівого потоку
    @Input() rightFlowInitialX: number = 150; // Початкова X-координата для правого потоку

    @Input() leftFlowOffsetY: number = 250; // Зміщення лівого потоку по Y (вниз)
    @Input() rightFlowOffsetY: number = 20; // Зміщення правого потоку по Y (вниз)

    @Input() sideFlowSpeedMultiplier: number = 1;
    @Input() sideFlowDensityMultiplier: number = 1;


    @ViewChildren('scrollItem') divItems!: QueryList<ElementRef>;

    private mainTimeline: gsap.core.Timeline | null = null;
    private observer: Observer | null = null;
    private itemAnimationProxies: ItemAnimationProxy[] = [];
    private mainFlowDecreasingVirtualPosition: boolean = false;

    private contentUpdateInterval: any;

    private readonly contentSets = [
        // 1. Поєднання тексту та іконок (Technology & Development)
        [
            { text: "Fast", icon: "⚡" },
            { text: "Smart", icon: "🧠" },
            { text: "Creative", icon: "🎨" },
            { text: "Strong", icon: "💪" },
            { text: "Optimized", icon: "🚀" },
            { text: "Secure", icon: "🔒" },
            { text: "Responsive", icon: "📱" },
            { text: "Modern", icon: "✨" },
            { text: "Powerful", icon: "⚙️" },
            { text: "Scalable", icon: "📈" },
            { text: "Reliable", icon: "🛡️" },
            { text: "Innovative", icon: "💡" },
        ].map(c => `${c.icon} ${c.text}`),

        // 2. Тематичні теги (Chat/IT/Web Development)
        [
            "JavaScript", "TypeScript", "Angular", "React", "Vue.js", "Node.js",
            "Design", "Innovate", "Creativity", "Future", "Tech", "API", 
            "#Chat", "SignalR", "GSAP", "WebSockets", "HTML5", "CSS3",
            "MongoDB", "PostgreSQL", "Docker", "Kubernetes", "GraphQL", "REST",
            "DevOps", "CI/CD", "Microservices", "Serverless", "Cloud", "AWS"
        ],

        // 3. Короткі цитати/фрази (Мотиваційні)
        [
            "Dream big!", "Stay curious", "Code more", "Be awesome", 
            "Keep going", "You got this", "Think outside the box", "Create magic",
            "Never give up", "Make it happen", "Believe in yourself", "Push limits",
            "Stay focused", "Build dreams", "Code the future", "Embrace change",
            "Ship it!", "Debug life", "Commit often", "Deploy daily",
            "Test everything", "Refactor always", "Learn forever", "Teach others"
        ],
        
        // 4. Емодзі для спілкування (Chat & Communication)
        [
            '💬', '✉️', '💻', '⭐', '🚀', '✨', '🟢', '🔵', '💡', '✅', '✔️', '🛠️',
            '📱', '⌨️', '🖱️', '🖥️', '📡', '🌐', '📶', '🔔', '📣', '💌', '📨', '📧'
        ],

        // 5. Професійні терміни (Programming Concepts)
        [
            "Async/Await", "Promises", "Callback", "Closure", "Hoisting", "Scope",
            "Polymorphism", "Inheritance", "Encapsulation", "Abstraction", "DRY", "SOLID",
            "MVC", "MVVM", "SPA", "PWA", "SSR", "CSR", "SEO", "UX/UI",
            "Responsive", "Adaptive", "Mobile-First", "Desktop-First", "Flexbox", "Grid"
        ],

        // 6. Технології та фреймворки
        [
            "Bootstrap", "Tailwind", "Material UI", "Sass", "Less", "PostCSS",
            "Webpack", "Vite", "Rollup", "Babel", "ESLint", "Prettier",
            "Jest", "Mocha", "Cypress", "Selenium", "Puppeteer", "Playwright",
            "Redux", "MobX", "Zustand", "Pinia", "Vuex", "Context API"
        ],

        // 7. Бази даних та Backend
        [
            "MySQL", "MariaDB", "SQLite", "Redis", "Memcached", "Elasticsearch",
            "Firebase", "Supabase", "Appwrite", "Prisma", "TypeORM", "Sequelize",
            "Express", "Fastify", "Koa", "Hapi", "NestJS", "AdonisJS",
            "Django", "Flask", "FastAPI", "Laravel", "Symfony", "Spring Boot"
        ],

        // 8. Короткі фрази (Tech Humor)
        [
            "It works on my machine", "Have you tried turning it off?", "404 Not Found",
            "Syntax Error", "Null Pointer", "Stack Overflow", "Merge Conflict",
            "Push to prod", "Hotfix incoming", "Legacy code", "Technical debt",
            "Break the build", "Ship it Friday", "Works as intended", "Feature not bug"
        ],

        // 9. Емодзі для розробки (Developer Life)
        [
            '👨‍💻', '👩‍💻', '🐛', '🔧', '🔨', '⚙️', '🎯', '📊', '📈', '📉',
            '🔍', '🔎', '📝', '📋', '📌', '📍', '🏆', '🎖️', '🥇', '🥈'
        ],

        // 10. Cloud & Infrastructure
        [
            "Azure", "GCP", "DigitalOcean", "Heroku", "Vercel", "Netlify",
            "CloudFlare", "Akamai", "Jenkins", "GitLab CI", "GitHub Actions", "CircleCI",
            "Terraform", "Ansible", "Chef", "Puppet", "Vagrant", "VirtualBox",
            "VMware", "Hyper-V", "Load Balancer", "CDN", "VPN", "Firewall"
        ],

        // 11. UI/UX терміни
        [
            "Wireframe", "Prototype", "Mockup", "User Flow", "Journey Map", "Persona",
            "A/B Testing", "Usability", "Accessibility", "Color Theory", "Typography",
            "Whitespace", "Grid System", "Visual Hierarchy", "Contrast", "Balance",
            "Figma", "Sketch", "Adobe XD", "InVision", "Zeplin", "Abstract"
        ],

        // 12. Версії та стандарти
        [
            "ES6", "ES2015", "ES2020", "ES2023", "HTML5", "CSS3", "HTTP/2", "HTTP/3",
            "WebAssembly", "WebGL", "WebRTC", "WebSockets", "Service Workers", "Web Workers",
            "OAuth 2.0", "JWT", "CORS", "CSRF", "XSS", "SQL Injection"
        ],

        // 13. Мотиваційні фрази (Developer Edition)
        [
            "Write clean code", "Test driven", "Refactor often", "Document always",
            "Review carefully", "Deploy safely", "Monitor closely", "Scale wisely",
            "Optimize later", "Security first", "User focused", "Data driven",
            "Performance matters", "Simplicity wins", "Consistency key", "Quality over quantity"
        ],

        // 14. Символи та знаки
        [
            '→', '←', '↑', '↓', '↗', '↘', '↙', '↖', '⇒', '⇐', '⇑', '⇓',
            '▶', '◀', '▲', '▼', '●', '○', '■', '□', '◆', '◇', '★', '☆'
        ],

        // 15. Скорочення та акроніми
        [
            "CRUD", "REST", "SOAP", "JSON", "XML", "YAML", "TOML", "CSV",
            "DTO", "DAO", "ORM", "API", "SDK", "CLI", "GUI", "IDE",
            "VCS", "Git", "SVN", "CI/CD", "TDD", "BDD", "DDD", "KISS"
        ],

        // 16. Емодзі для статусів (Status Indicators)
        [
            '✅', '❌', '⚠️', '🔴', '🟡', '🟢', '🔵', '🟣', '⚫', '⚪',
            '🟠', '🟤', '⏸️', '⏯️', '⏹️', '⏺️', '▶️', '⏭️', '⏮️', '🔄'
        ],

        // 17. Архітектурні патерни
        [
            "Singleton", "Factory", "Observer", "Strategy", "Decorator", "Adapter",
            "Facade", "Proxy", "Command", "Iterator", "State", "Template Method",
            "Chain of Responsibility", "Mediator", "Memento", "Visitor", "Flyweight", "Bridge"
        ],

        // 18. Короткі команди (Git Commands)
        [
            "git commit", "git push", "git pull", "git merge", "git rebase", "git checkout",
            "git branch", "git stash", "git log", "git diff", "git reset", "git revert",
            "npm install", "npm run", "npm test", "npm build", "yarn add", "pnpm install"
        ],

        // 19. Часові поняття (Time Related)
        [
            "Real-time", "Async", "Sync", "Latency", "Throughput", "Bandwidth",
            "Request", "Response", "Timeout", "Retry", "Polling", "Streaming",
            "Debounce", "Throttle", "Cache", "TTL", "Expiry", "Stale"
        ],

        // 20. Емодзі для емоцій (Emotions)
        [
            '😀', '😃', '😄', '😁', '😊', '😍', '🤩', '😎', '🤔', '🧐',
            '😅', '😂', '🤣', '😇', '🥳', '🎉', '🎊', '🎈', '🎁', '🏅'
        ]
    ];

    constructor(private cdr: ChangeDetectorRef) {}

    ngOnInit(): void {
        this.generateRandomItems(); // Початкове заповнення
        this.startContentUpdateInterval(); // Запуск періодичного оновлення
    }

    // 🚀 НОВА ЛОГІКА: Генерація випадкового вмісту (ПОКРАЩЕНА - ЗМІШАНИЙ КОНТЕНТ)
    private generateRandomItems(): void {
        const totalItems = 150;
        
        // Об'єднуємо всі набори в один великий масив
        const allContent: string[] = [];
        this.contentSets.forEach(set => {
            allContent.push(...set);
        });
        
        const newItems: BackgroundItem[] = [];
        
        // Випадково вибираємо контент з усіх доступних варіантів
        for (let i = 0; i < totalItems; i++) {
            const randomIndex = Math.floor(Math.random() * allContent.length);
            const content = allContent[randomIndex];
            
            newItems.push({ content: content });
        }
        
        this.items = newItems;
        this.cdr.detectChanges();
        
        console.log(`[Background] Content mixed from all ${this.contentSets.length} sets`);
    }

    // 🔄 НОВА ЛОГІКА: Інтервал для зміни контенту
    private startContentUpdateInterval(): void {
        // Розраховуємо приблизний час для зміни контенту. 
        // 3 хвилини (180 000 мс) - це достатньо довго, щоб цикл завершився, 
        // але не надто довго, щоб стало нудно. Ви можете коригувати це число.
        const updateFrequencyMs = 180000; 

        this.contentUpdateInterval = setInterval(() => {
            this.generateRandomItems();
            // ПІСЛЯ ЗМІНИ КОНТЕНТУ ПЕРЕЗАПУСКАЄМО АНІМАЦІЮ!
            this.attemptInitGsapAnimation();
        }, updateFrequencyMs);
    }

    ngAfterViewInit(): void {
        this.attemptInitGsapAnimation();
    }

    public getTiltTransform(): string {
        if (!this.isTilted) return "none";
        return this.tiltDirection === "left"
            ? "rotateX(20deg) rotateZ(-20deg) skewX(20deg)"
            : "rotateX(20deg) rotateZ(20deg) skewX(-20deg)";
    }

    private attemptInitGsapAnimation(): void {
        setTimeout(() => {
            const container = this.divItems.first?.nativeElement?.parentElement;
            if (this.divItems && this.divItems.length > 0 &&
                this.divItems.first?.nativeElement.offsetHeight > 0 &&
                container && container.offsetWidth > 0 && container.offsetHeight > 0) {
                this.initGsapAnimation();
            } else {
                setTimeout(() => {
                    this.cdr.detectChanges();
                    this.attemptInitGsapAnimation();
                }, 100);
            }
        }, 0);
    }

    private wrapAround(min: number, max: number): (value: number) => number {
        const range = max - min;
        return (value: number): number => {
            let wrappedValue = value;
            while (wrappedValue < min) wrappedValue += range;
            while (wrappedValue >= max) wrappedValue -= range;
            return wrappedValue;
        };
    }

    private getOppositeDirection(direction: "up-left" | "down-right" | "down-left" | "up-right"): "up-left" | "down-right" | "down-left" | "up-right" {
        switch (direction) {
            case "up-left": return "down-right";
            case "down-right": return "up-left";
            case "down-left": return "up-right";
            case "up-right": return "down-left";
        }
    }

    private initGsapAnimation(): void {
        const itemsArray = this.divItems.toArray().map(item => item.nativeElement);
        const container = itemsArray[0]?.parentElement;
        if (!container) return;

        const firstItem = itemsArray[0];
        const itemWidthNum = firstItem.offsetWidth;
        const itemHeightNum = firstItem.offsetHeight;

        const rootFontSizeNum = parseFloat(getComputedStyle(document.documentElement).fontSize);
        const inputWidthValue = parseFloat(this.width);
        const calculatedWidthNum = this.width.includes('rem') ? inputWidthValue * rootFontSizeNum : inputWidthValue;
        const inputMaxHeightValue = parseFloat(this.maxHeight);
        const calculatedMaxHeightNum = this.maxHeight.includes('vh') ? inputMaxHeightValue * container.offsetHeight / 100 : inputMaxHeightValue;

        const actualItemHeight = itemHeightNum > 0 ? itemHeightNum : this.itemMinHeight;
        const actualItemWidth = itemWidthNum > 0 ? itemWidthNum : calculatedWidthNum;

        const containerWidth = container.offsetWidth;
        const containerHeight = container.offsetHeight;
        const offscreenBuffer = Math.max(actualItemWidth, actualItemHeight) * 1.5;

        this.cleanupAnimations();
        this.itemAnimationProxies = [];

        this.mainTimeline = gsap.timeline({
            repeat: -1,
            paused: !this.autoplay,
            ease: "none"
        });

        // --- КОНФІГУРАЦІЯ ПОТОКІВ ---
        let mainFlowConfig = this.getFlowConfig(this.autoplayDirection, containerWidth, containerHeight, offscreenBuffer, 1, 1);
        this.mainFlowDecreasingVirtualPosition = mainFlowConfig.decreasingVirtualPosition;

        let leftFlowConfig: any = null;
        let rightFlowConfig: any = null;

        if (this.enableSideFlows) {
            const oppositeDirection = this.getOppositeDirection(this.autoplayDirection);

            // Лівий бічний потік
            leftFlowConfig = this.getFlowConfig(
                oppositeDirection,
                containerWidth, containerHeight, offscreenBuffer,
                this.sideFlowSpeedMultiplier, this.sideFlowDensityMultiplier
            );
            // Прямо встановлюємо initialBaseX для лівого потоку
            leftFlowConfig.initialBaseX = this.leftFlowInitialX;
            leftFlowConfig.initialBaseY += this.leftFlowOffsetY;

            // Правий бічний потік
            rightFlowConfig = this.getFlowConfig(
                oppositeDirection,
                containerWidth, containerHeight, offscreenBuffer,
                this.sideFlowSpeedMultiplier, this.sideFlowDensityMultiplier
            );
            // Прямо встановлюємо initialBaseX для правого потоку
            rightFlowConfig.initialBaseX = this.rightFlowInitialX;
            rightFlowConfig.initialBaseY += this.rightFlowOffsetY;
        }

        // --- РОЗПОДІЛ ЕЛЕМЕНТІВ ---
        const totalItems = itemsArray.length;
        let itemsPerFlow: number;
        if (this.enableSideFlows) {
            itemsPerFlow = Math.floor(totalItems / 3);
            if (itemsPerFlow === 0 && totalItems > 0) itemsPerFlow = 1;
        } else {
            itemsPerFlow = totalItems;
        }

        const mainItems = itemsArray.slice(0, itemsPerFlow);
        const leftSideItems = this.enableSideFlows ? itemsArray.slice(itemsPerFlow, itemsPerFlow * 2) : [];
        const rightSideItems = this.enableSideFlows ? itemsArray.slice(itemsPerFlow * 2) : [];


        // --- ФУНКЦІЯ ДЛЯ ІНІЦІАЛІЗАЦІЇ ТА ДОДАВАННЯ АНІМАЦІЙ ДЛЯ КОНКРЕТНОГО ПОТОКУ ---
        const setupAndAddFlowAnimations = (
            elements: HTMLElement[],
            flowConfig: {
                moveAngleRad: number;
                initialBaseX: number;
                initialBaseY: number;
                decreasingVirtualPosition: boolean;
                speedMultiplier: number;
                densityMultiplier: number;
            }
        ) => {
            if (elements.length === 0) return;

            const currentSpacing = this.diagonalSpacing / flowConfig.densityMultiplier;
            const flowCycleLength = elements.length * currentSpacing;
            const flowTotalCyclePath = flowCycleLength + (offscreenBuffer * 2);

            elements.forEach((item, i) => {
                const initialVirtualPosition = flowConfig.decreasingVirtualPosition
                    ? flowTotalCyclePath - (i * currentSpacing % flowTotalCyclePath)
                    : i * currentSpacing % flowTotalCyclePath;

                const proxy: ItemAnimationProxy = {
                    element: item,
                    _virtualPosition: initialVirtualPosition
                };
                this.itemAnimationProxies.push(proxy);

                // Забезпечуємо, що pos є числом перед використанням
                const pos = Number(initialVirtualPosition);
                const xPos = flowConfig.initialBaseX + (pos * Math.cos(flowConfig.moveAngleRad));
                const yPos = flowConfig.initialBaseY + (pos * Math.sin(flowConfig.moveAngleRad));

                gsap.set(item, {
                    x: xPos,
                    y: yPos,
                    position: 'absolute',
                    width: `${calculatedWidthNum}px`,
                    height: `${this.itemMinHeight}px`,
                    rotationZ: this.itemRotationZ,
                    rotationX: this.itemRotationX,
                    rotationY: this.itemRotationY,
                    transformOrigin: "center center",
                    opacity: 0,
                });
            });

            const baseSpeedFactor = 250;
            // Ось де швидкість обчислюється і застосовується як тривалість
            let cycleDurationSeconds = (flowTotalCyclePath / (this.autoplaySpeed * baseSpeedFactor)) / flowConfig.speedMultiplier;
            cycleDurationSeconds = Math.max(5, Math.min(120, cycleDurationSeconds)); // Обмеження для розумних значень

            elements.forEach(item => {
                const proxy = this.itemAnimationProxies.find(p => p.element === item);
                if (!proxy) return;

                const targetVirtualPosition = flowConfig.decreasingVirtualPosition
                    ? proxy._virtualPosition - flowTotalCyclePath
                    : proxy._virtualPosition + flowTotalCyclePath;

                this.mainTimeline!.add(gsap.to(proxy, {
                    _virtualPosition: targetVirtualPosition,
                    duration: cycleDurationSeconds, // Використання розрахованої тривалості
                    ease: "none",
                    modifiers: {
                        _virtualPosition: this.wrapAround(0, flowTotalCyclePath)
                    },
                    onUpdate: () => {
                        // Забезпечуємо, що pos є числом перед використанням
                        const pos = Number(proxy._virtualPosition);
                        const x = flowConfig.initialBaseX + (pos * Math.cos(flowConfig.moveAngleRad));
                        const y = flowConfig.initialBaseY + (pos * Math.sin(flowConfig.moveAngleRad));

                        let opacity = 0;
                        const fade = offscreenBuffer;
                        const full = 0.7;

                        // Переконаємося, що всі операнди в Math.mapRange є числами
                        const totalPath = Number(flowTotalCyclePath);
                        const fadeVal = Number(fade);
                        const posVal = Number(pos);

                        if (flowConfig.decreasingVirtualPosition) {
                            if (posVal > totalPath - fadeVal)
                                opacity = gsap.utils.mapRange(totalPath - fadeVal, totalPath, 0, full, posVal);
                            else if (posVal < fadeVal)
                                opacity = gsap.utils.mapRange(0, fadeVal, full, 0, posVal);
                            else
                                opacity = full;
                        } else {
                            if (posVal < fadeVal)
                                opacity = gsap.utils.mapRange(0, fadeVal, 0, full, posVal);
                            else if (posVal > totalPath - fadeVal)
                                opacity = gsap.utils.mapRange(totalPath - fadeVal, totalPath, full, 0, posVal);
                            else
                                opacity = full;
                        }

                        gsap.set(proxy.element, { x, y, opacity: Math.max(0, Math.min(full, opacity)) });
                    }
                }), 0);
            });
        };

        // --- ЗАПУСК НАЛАШТУВАННЯ ДЛЯ КОЖНОГО ПОТОКУ ---
        setupAndAddFlowAnimations(mainItems, mainFlowConfig);

        if (this.enableSideFlows) {
            if (leftFlowConfig) {
                setupAndAddFlowAnimations(leftSideItems, leftFlowConfig);
            }
            if (rightFlowConfig) {
                setupAndAddFlowAnimations(rightSideItems, rightFlowConfig);
            }
        }

        // Observer (використовує mainFlowDecreasingVirtualPosition)
        if (this.pauseOnHover) {
            this.observer = Observer.create({
                target: container,
                type: "wheel,touch,pointer",
                preventDefault: true,
                onPress: (data: Observer) => {
                    (data.target as HTMLElement).style.cursor = "grabbing";
                    this.mainTimeline?.pause();
                },
                onRelease: (data: Observer) => {
                    (data.target as HTMLElement).style.cursor = "grab";
                    this.mainTimeline?.resume();
                },
                onChange: (data: Observer) => {
                    const amount = Number(data.deltaY); // Приводимо до Number
                    const speed = data.isDragging ? 0.0005 : 0.001;
                    if (this.mainTimeline) {
                        const delta = amount * speed;
                        this.mainTimeline.progress(
                            this.mainTimeline.progress() + (this.mainFlowDecreasingVirtualPosition ? -delta : delta)
                        );
                    }
                }
            });
        }

        if (this.autoplay && this.mainTimeline) this.mainTimeline.play();
    }

    private getFlowConfig(
        direction: "up-left" | "down-right" | "down-left" | "up-right",
        containerWidth: number,
        containerHeight: number,
        offscreenBuffer: number,
        speedMultiplier: number,
        densityMultiplier: number
    ): { moveAngleRad: number; initialBaseX: number; initialBaseY: number; decreasingVirtualPosition: boolean; speedMultiplier: number; densityMultiplier: number } {
        let moveAngleRad: number;
        let initialBaseX: number;
        let initialBaseY: number;
        let decreasingVirtualPosition: boolean;

        switch (direction) {
            case "up-left":
                moveAngleRad = Math.atan2(-1, -1);
                initialBaseX = containerWidth + offscreenBuffer;
                initialBaseY = containerHeight + offscreenBuffer;
                decreasingVirtualPosition = true;
                break;
            case "down-right":
                moveAngleRad = Math.atan2(1, 1);
                initialBaseX = -offscreenBuffer;
                initialBaseY = -offscreenBuffer;
                decreasingVirtualPosition = false;
                break;
            case "down-left":
                moveAngleRad = Math.atan2(1, -1);
                initialBaseX = containerWidth + offscreenBuffer;
                initialBaseY = -offscreenBuffer;
                decreasingVirtualPosition = true;
                break;
            case "up-right":
                moveAngleRad = Math.atan2(-1, 1);
                initialBaseX = -offscreenBuffer;
                initialBaseY = containerHeight + offscreenBuffer;
                decreasingVirtualPosition = false;
                break;
            default: // Fallback
                moveAngleRad = Math.atan2(-1, -1);
                initialBaseX = containerWidth + offscreenBuffer;
                initialBaseY = containerHeight + offscreenBuffer;
                decreasingVirtualPosition = true;
                break;
        }

        return { moveAngleRad, initialBaseX, initialBaseY, decreasingVirtualPosition, speedMultiplier, densityMultiplier };
    }

    private cleanupAnimations(): void {
        this.mainTimeline?.kill();
        this.mainTimeline = null;
        this.observer?.kill();
        this.observer = null;
        this.itemAnimationProxies.forEach(p => gsap.killTweensOf(p));
        this.divItems?.forEach(i => gsap.killTweensOf(i.nativeElement));
        this.itemAnimationProxies = [];
    }

    ngOnDestroy(): void {
        this.cleanupAnimations();
    }
}