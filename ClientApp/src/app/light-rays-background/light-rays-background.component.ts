// src/app/light-rays-background/light-rays-background.component.ts
import {
  Component,
  ElementRef,
  ViewChild,
  AfterViewInit,
  OnDestroy,
  Input,
  OnChanges,
  SimpleChanges,
  NgZone // Додаємо NgZone для роботи з анімацією поза Angular Change Detection
} from '@angular/core';
import { Renderer, Program, Triangle, Mesh } from 'ogl';

// Типи для RaysOrigin - можна скопіювати
export type RaysOrigin =
  | 'top-center'
  | 'top-left'
  | 'top-right'
  | 'right'
  | 'left'
  | 'bottom-center'
  | 'bottom-right'
  | 'bottom-left';

// Функції hexToRgb та getAnchorAndDir - можна скопіювати
const hexToRgb = (hex: string): [number, number, number] => {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return m
    ? [
        parseInt(m[1], 16) / 255,
        parseInt(m[2], 16) / 255,
        parseInt(m[3], 16) / 255,
      ]
    : [1, 1, 1];
};

const getAnchorAndDir = (
  origin: RaysOrigin,
  w: number,
  h: number
): { anchor: [number, number]; dir: [number, number] } => {
  const outside = 0.2;
  switch (origin) {
    case 'top-left':
      return { anchor: [0, -outside * h], dir: [0, 1] };
    case 'top-right':
      return { anchor: [w, -outside * h], dir: [0, 1] };
    case 'left':
      return { anchor: [-outside * w, 0.5 * h], dir: [1, 0] };
    case 'right':
      return { anchor: [(1 + outside) * w, 0.5 * h], dir: [-1, 0] };
    case 'bottom-left':
      return { anchor: [0, (1 + outside) * h], dir: [0, -1] };
    case 'bottom-center':
      return { anchor: [0.5 * w, (1 + outside) * h], dir: [0, -1] };
    case 'bottom-right':
      return { anchor: [w, (1 + outside) * h], dir: [0, -1] };
    default: // "top-center"
      return { anchor: [0.5 * w, -outside * h], dir: [0, 1] };
  }
};

@Component({
  selector: 'app-light-rays-background',
  templateUrl: './light-rays-background.component.html',
  styleUrls: ['./light-rays-background.component.css']
})
export class LightRaysBackgroundComponent implements AfterViewInit, OnDestroy, OnChanges {
  @ViewChild('containerRef', { static: true })
  containerRef!: ElementRef<HTMLDivElement>;

  // Input properties, як у React-компонента
  @Input() raysOrigin: RaysOrigin = 'top-center';
  @Input() raysColor: string = '#ffffff';
  @Input() raysSpeed: number = 1;
  @Input() lightSpread: number = 1;
  @Input() rayLength: number = 2;
  @Input() pulsating: boolean = false;
  @Input() fadeDistance: number = 1.0;
  @Input() saturation: number = 1.0;
  @Input() followMouse: boolean = true;
  @Input() mouseInfluence: number = 0.1;
  @Input() noiseAmount: number = 0.0;
  @Input() distortion: number = 0.0;
  @Input() customClass: string = ''; // Відповідає className

  private renderer!: Renderer;
  private uniforms: any; // OGL uniforms object
  private mesh!: Mesh;
  private animationFrameId: number | null = null;
  private mouse = { x: 0.5, y: 0.5 };
  private smoothMouse = { x: 0.5, y: 0.5 };
  private intersectionObserver!: IntersectionObserver;
  private isVisible = false;

  constructor(private ngZone: NgZone) { } // Вводимо NgZone

  ngAfterViewInit(): void {
    // Використовуємо IntersectionObserver, як у React-прикладі
    this.intersectionObserver = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        this.isVisible = entry.isIntersecting;
        if (this.isVisible) {
          this.initializeWebGL();
        } else {
          this.cleanupWebGL(); // Очищаємо WebGL, коли невидимий
        }
      },
      { threshold: 0.1 }
    );
    this.intersectionObserver.observe(this.containerRef.nativeElement);

    // Додаємо обробник подій миші, якщо потрібно
    if (this.followMouse) {
      this.addMouseListeners();
    }
  }

  ngOnChanges(changes: SimpleChanges): void {
    // Оновлюємо уніформи OGL, коли змінюються @Input() властивості
    if (this.uniforms && this.renderer && this.containerRef.nativeElement) {
      const u = this.uniforms;
      const renderer = this.renderer;

      if (changes['raysColor']) u.raysColor.value = hexToRgb(this.raysColor);
      if (changes['raysSpeed']) u.raysSpeed.value = this.raysSpeed;
      if (changes['lightSpread']) u.lightSpread.value = this.lightSpread;
      if (changes['rayLength']) u.rayLength.value = this.rayLength;
      if (changes['pulsating']) u.pulsating.value = this.pulsating ? 1.0 : 0.0;
      if (changes['fadeDistance']) u.fadeDistance.value = this.fadeDistance;
      if (changes['saturation']) u.saturation.value = this.saturation;
      if (changes['mouseInfluence']) u.mouseInfluence.value = this.mouseInfluence;
      if (changes['noiseAmount']) u.noiseAmount.value = this.noiseAmount;
      if (changes['distortion']) u.distortion.value = this.distortion;

      // Оновлення rayPos та rayDir при зміні raysOrigin або розміру контейнера
      if (changes['raysOrigin'] || changes['containerRef'] || changes['raysSpeed']) {
         this.updatePlacement();
      }

      // Якщо followMouse змінюється, додаємо/видаляємо слухачів
      if (changes['followMouse']) {
        if (this.followMouse) {
          this.addMouseListeners();
        } else {
          this.removeMouseListeners();
        }
      }
    }
  }

  ngOnDestroy(): void {
    if (this.intersectionObserver) {
      this.intersectionObserver.disconnect();
    }
    this.cleanupWebGL();
    this.removeMouseListeners();
  }

  private initializeWebGL(): void {
    // Якщо вже ініціалізовано, нічого не робимо
    if (this.renderer) return;

    this.ngZone.runOutsideAngular(() => { // Важливо: запускаємо WebGL анімацію поза зоною Angular
      const container = this.containerRef.nativeElement;

      this.renderer = new Renderer({
        dpr: Math.min(window.devicePixelRatio, 2),
        alpha: true,
      });
      const gl = this.renderer.gl;

      gl.canvas.style.width = '100%';
      gl.canvas.style.height = '100%';

      // Очищаємо вміст контейнера, якщо там щось було
      while (container.firstChild) {
        container.removeChild(container.firstChild);
      }
      container.appendChild(gl.canvas);

      const vert = `
attribute vec2 position;
varying vec2 vUv;
void main() {
  vUv = position * 0.5 + 0.5;
  gl_Position = vec4(position, 0.0, 1.0);
}`;

      // Фрагментний шейдер - скопіюйте його повністю
      const frag = `precision highp float;

uniform float iTime;
uniform vec2  iResolution;

uniform vec2  rayPos;
uniform vec2  rayDir;
uniform vec3  raysColor;
uniform float raysSpeed;
uniform float lightSpread;
uniform float rayLength;
uniform float pulsating;
uniform float fadeDistance;
uniform float saturation;
uniform vec2  mousePos;
uniform float mouseInfluence;
uniform float noiseAmount;
uniform float distortion;

varying vec2 vUv;

float noise(vec2 st) {
  return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453123);
}

float rayStrength(vec2 raySource, vec2 rayRefDirection, vec2 coord,
                  float seedA, float seedB, float speed) {
  vec2 sourceToCoord = coord - raySource;
  vec2 dirNorm = normalize(sourceToCoord);
  float cosAngle = dot(dirNorm, rayRefDirection);

  float distortedAngle = cosAngle + distortion * sin(iTime * 2.0 + length(sourceToCoord) * 0.01) * 0.2;
  
  float spreadFactor = pow(max(distortedAngle, 0.0), 1.0 / max(lightSpread, 0.001));

  float distance = length(sourceToCoord);
  float maxDistance = iResolution.x * rayLength;
  float lengthFalloff = clamp((maxDistance - distance) / maxDistance, 0.0, 1.0);
  
  float fadeFalloff = clamp((iResolution.x * fadeDistance - distance) / (iResolution.x * fadeDistance), 0.5, 1.0);
  float pulse = pulsating > 0.5 ? (0.8 + 0.2 * sin(iTime * speed * 3.0)) : 1.0;

  float baseStrength = clamp(
    (0.45 + 0.15 * sin(distortedAngle * seedA + iTime * speed)) +
    (0.3 + 0.2 * cos(-distortedAngle * seedB + iTime * speed)),
    0.0, 1.0
  );

  return baseStrength * lengthFalloff * fadeFalloff * spreadFactor * pulse;
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 coord = vec2(fragCoord.x, iResolution.y - fragCoord.y);
  
  vec2 finalRayDir = rayDir;
  if (mouseInfluence > 0.0) {
    vec2 mouseScreenPos = mousePos * iResolution.xy;
    vec2 mouseDirection = normalize(mouseScreenPos - rayPos);
    finalRayDir = normalize(mix(rayDir, mouseDirection, mouseInfluence));
  }

  vec4 rays1 = vec4(1.0) *
                rayStrength(rayPos, finalRayDir, coord, 36.2214, 21.11349,
                            1.5 * raysSpeed);
  vec4 rays2 = vec4(1.0) *
                rayStrength(rayPos, finalRayDir, coord, 22.3991, 18.0234,
                            1.1 * raysSpeed);

  fragColor = rays1 * 0.5 + rays2 * 0.4;

  if (noiseAmount > 0.0) {
    float n = noise(coord * 0.01 + iTime * 0.1);
    fragColor.rgb *= (1.0 - noiseAmount + noiseAmount * n);
  }

  float brightness = 1.0 - (coord.y / iResolution.y);
  fragColor.x *= 0.1 + brightness * 0.8;
  fragColor.y *= 0.3 + brightness * 0.6;
  fragColor.z *= 0.5 + brightness * 0.5;

  if (saturation != 1.0) {
    float gray = dot(fragColor.rgb, vec3(0.299, 0.587, 0.114));
    fragColor.rgb = mix(vec3(gray), fragColor.rgb, saturation);
  }

  fragColor.rgb *= raysColor;
}

void main() {
  vec4 color;
  mainImage(color, gl_FragCoord.xy);
  gl_FragColor  = color;
}`;

      this.uniforms = {
        iTime: { value: 0 },
        iResolution: { value: [1, 1] },
        rayPos: { value: [0, 0] },
        rayDir: { value: [0, 1] },
        raysColor: { value: hexToRgb(this.raysColor) },
        raysSpeed: { value: this.raysSpeed },
        lightSpread: { value: this.lightSpread },
        rayLength: { value: this.rayLength },
        pulsating: { value: this.pulsating ? 1.0 : 0.0 },
        fadeDistance: { value: this.fadeDistance },
        saturation: { value: this.saturation },
        mousePos: { value: [0.5, 0.5] },
        mouseInfluence: { value: this.mouseInfluence },
        noiseAmount: { value: this.noiseAmount },
        distortion: { value: this.distortion },
      };

      const geometry = new Triangle(gl);
      const program = new Program(gl, {
        vertex: vert,
        fragment: frag,
        uniforms: this.uniforms,
      });
      this.mesh = new Mesh(gl, { geometry, program });

      // Початкове оновлення розміру та позиції променів
      this.updatePlacement();

      // Додаємо слухача resize
      window.addEventListener('resize', this.updatePlacement.bind(this));

      // Починаємо цикл рендерингу
      this.animationFrameId = requestAnimationFrame(this.loop.bind(this));
    }); // End ngZone.runOutsideAngular
  }

  private cleanupWebGL(): void {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    window.removeEventListener('resize', this.updatePlacement.bind(this));

    if (this.renderer) {
      try {
        const canvas = this.renderer.gl.canvas;
        // Спроба звільнити WebGL контекст
        const loseContextExt = this.renderer.gl.getExtension('WEBGL_lose_context');
        if (loseContextExt) {
          loseContextExt.loseContext();
        }
        if (canvas && canvas.parentNode) {
          canvas.parentNode.removeChild(canvas);
        }
      } catch (error) {
        console.warn('Error during WebGL cleanup:', error);
      }
      this.renderer = null as any; // Очищаємо посилання
      this.uniforms = null;
      this.mesh = null as any;
    }
  }

  private updatePlacement(): void {
    if (!this.containerRef || !this.renderer || !this.uniforms) return;

    const { clientWidth: wCSS, clientHeight: hCSS } = this.containerRef.nativeElement;
    this.renderer.setSize(wCSS, hCSS);

    const dpr = this.renderer.dpr;
    const w = wCSS * dpr;
    const h = hCSS * dpr;

    this.uniforms.iResolution.value = [w, h];

    const { anchor, dir } = getAnchorAndDir(this.raysOrigin, w, h);
    this.uniforms.rayPos.value = anchor;
    this.uniforms.rayDir.value = dir;
  }

  private loop(t: number): void {
    if (!this.renderer || !this.uniforms || !this.mesh || !this.isVisible) {
      this.animationFrameId = null; // Зупиняємо анімацію, якщо невидимий або неініціалізований
      return;
    }

    this.uniforms.iTime.value = t * 0.001;

    if (this.followMouse && this.mouseInfluence > 0.0) {
      const smoothing = 0.92;

      this.smoothMouse.x =
        this.smoothMouse.x * smoothing +
        this.mouse.x * (1 - smoothing);
      this.smoothMouse.y =
        this.smoothMouse.y * smoothing +
        this.mouse.y * (1 - smoothing);

      this.uniforms.mousePos.value = [
        this.smoothMouse.x,
        this.smoothMouse.y,
      ];
    }

    try {
      this.renderer.render({ scene: this.mesh });
      this.animationFrameId = requestAnimationFrame(this.loop.bind(this));
    } catch (error) {
      console.warn('WebGL rendering error:', error);
      this.cleanupWebGL(); // Очищаємо, якщо сталася помилка рендерингу
      return;
    }
  }

  private handleMouseMove = (e: MouseEvent) => {
    if (!this.containerRef || !this.renderer) return;
    const rect = this.containerRef.nativeElement.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    this.mouse = { x, y };
  };

  private addMouseListeners(): void {
    window.addEventListener('mousemove', this.handleMouseMove);
  }

  private removeMouseListeners(): void {
    window.removeEventListener('mousemove', this.handleMouseMove);
  }
}