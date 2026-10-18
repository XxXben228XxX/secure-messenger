// aurora-background.component.ts
import {
  Component,
  OnInit,
  AfterViewInit,
  OnDestroy,
  Input,
  ElementRef,
  ViewChild,
  HostListener,
  ChangeDetectionStrategy
} from '@angular/core';
// Додаємо OGLRenderingContext до імпорту
import { Renderer, Program, Mesh, Color, Triangle, OGLRenderingContext } from 'ogl';

@Component({
  selector: 'app-aurora-background',
  template: '<div #auroraContainer class="aurora-container"></div>',
  styleUrls: ['./aurora-background.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AuroraBackgroundComponent implements AfterViewInit, OnDestroy {
  @ViewChild('auroraContainer') ctnDom!: ElementRef<HTMLDivElement>;

  @Input() colorStops: string[] = ["#5227FF", "#7cff67", "#5227FF"];
  @Input() amplitude: number = 1.0;
  @Input() blend: number = 0.5;
  @Input() time: number | undefined;
  @Input() speed: number = 1.0;

  private renderer!: Renderer;
  private gl!: OGLRenderingContext; // Змінено тип на OGLRenderingContext
  private program!: Program;
  private mesh!: Mesh;
  private animateId: number = 0;

  // GLSL шейдери (без змін)
  private readonly VERT = `#version 300 es
in vec2 position;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

  private readonly FRAG = `#version 300 es
precision highp float;

uniform float uTime;
uniform float uAmplitude;
uniform vec3 uColorStops[3];
uniform vec2 uResolution;
uniform float uBlend;

out vec4 fragColor;

vec3 permute(vec3 x) {
  return mod(((x * 34.0) + 1.0) * x, 289.0);
}

float snoise(vec2 v){
  const vec4 C = vec4(
      0.211324865405187, 0.366025403784439,
      -0.577350269189626, 0.024390243902439
  );
  vec2 i  = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod(i, 289.0);

  vec3 p = permute(
      permute(i.y + vec3(0.0, i1.y, 1.0))
    + i.x + vec3(0.0, i1.x, 1.0)
  );

  vec3 m = max(
      0.5 - vec3(
          dot(x0, x0),
          dot(x12.xy, x12.xy),
          dot(x12.zw, x12.zw)
      ),
      0.0
  );
  m = m * m;
  m = m * m;

  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);

  vec3 g;
  g.x  = a0.x  * x0.x  + h.x  * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

struct ColorStop {
  vec3 color;
  float position;
};

#define COLOR_RAMP(colors, factor, finalColor) {            \\
  int index = 0;                                            \\
  for (int i = 0; i < 2; i++) {                             \\
    ColorStop currentColor = colors[i];                     \\
    bool isInBetween = currentColor.position <= factor;     \\
    index = int(mix(float(index), float(i), float(isInBetween))); \\
  }                                                         \\
  ColorStop currentColor = colors[index];                   \\
  ColorStop nextColor = colors[index + 1];                  \\
  float range = nextColor.position - currentColor.position; \\
  float lerpFactor = (factor - currentColor.position) / range; \\
  finalColor = mix(currentColor.color, nextColor.color, lerpFactor); \\
}

void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;

  ColorStop colors[3];
  colors[0] = ColorStop(uColorStops[0], 0.0);
  colors[1] = ColorStop(uColorStops[1], 0.5);
  colors[2] = ColorStop(uColorStops[2], 1.0);

  vec3 rampColor;
  COLOR_RAMP(colors, uv.x, rampColor);

  float height = snoise(vec2(uv.x * 2.0 + uTime * 0.1, uTime * 0.25)) * 0.5 * uAmplitude;
  height = exp(height);
  height = (uv.y * 2.0 - height + 0.2);
  float intensity = 0.6 * height;

  float midPoint = 0.20;
  float auroraAlpha = smoothstep(midPoint - uBlend * 0.5, midPoint + uBlend * 0.5, intensity);

  vec3 auroraColor = intensity * rampColor;

  fragColor = vec4(auroraColor * auroraAlpha, auroraAlpha);
}
`;


  ngAfterViewInit(): void {
    this.initAurora();
  }

  ngOnDestroy(): void {
    this.cleanupAurora();
  }

  @HostListener('window:resize')
  onResize(): void {
    this.resizeCanvas();
  }

  private initAurora(): void {
    const ctn = this.ctnDom.nativeElement;
    if (!ctn) {
      console.error('Aurora container not found.');
      return;
    }

    this.renderer = new Renderer({
      alpha: true,
      premultipliedAlpha: true,
      antialias: true,
      webgl: 2 // Явно вказуємо використовувати WebGL2
    });
    this.gl = this.renderer.gl as OGLRenderingContext; // Приводимо до OGLRenderingContext

    const canvas = this.gl.canvas as HTMLCanvasElement; // Явне приведення типів тут

    this.gl.clearColor(0, 0, 0, 0);
    this.gl.enable(this.gl.BLEND);
    this.gl.blendFunc(this.gl.ONE, this.gl.ONE_MINUS_SRC_ALPHA);
    canvas.style.backgroundColor = "transparent";
    canvas.style.position = "absolute";
    canvas.style.top = "0";
    canvas.style.left = "0";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.zIndex = "-1";

    // Створюємо геометрію та програму, передаючи this.gl
    const geometry = new Triangle(this.gl);
    if ((geometry.attributes as any).uv) {
      delete (geometry.attributes as any).uv;
    }

    const colorStopsArray = this.colorStops.map((hex) => {
      const c = new Color(hex);
      return [c.r, c.g, c.b];
    });

    this.program = new Program(this.gl, {
      vertex: this.VERT,
      fragment: this.FRAG,
      uniforms: {
        uTime: { value: 0 },
        uAmplitude: { value: this.amplitude },
        uColorStops: { value: colorStopsArray },
        uResolution: { value: [ctn.offsetWidth, ctn.offsetHeight] },
        uBlend: { value: this.blend },
      },
    });

    this.mesh = new Mesh(this.gl, { geometry, program: this.program });
    ctn.appendChild(canvas);

    this.resizeCanvas();

    this.animate();
  }

  private resizeCanvas(): void {
    const ctn = this.ctnDom.nativeElement;
    if (!ctn) return;
    const width = ctn.offsetWidth;
    const height = ctn.offsetHeight;
    this.renderer.setSize(width, height);
    if (this.program) {
      this.program.uniforms['uResolution'].value = [width, height];
    }
  }

  private animate = (t: number = 0): void => {
    this.animateId = requestAnimationFrame(this.animate);

    const currentTime = this.time !== undefined ? this.time : t * 0.01;
    if (this.program) {
      this.program.uniforms['uTime'].value = currentTime * this.speed * 0.1;
      this.program.uniforms['uAmplitude'].value = this.amplitude;
      this.program.uniforms['uBlend'].value = this.blend;
      const stops = this.colorStops;
      this.program.uniforms['uColorStops'].value = stops.map((hex: string) => {
        const c = new Color(hex);
        return [c.r, c.g, c.b];
      });
      this.renderer.render({ scene: this.mesh });
    }
  }

  private cleanupAurora(): void {
    cancelAnimationFrame(this.animateId);
    if (this.gl) {
      const canvas = this.gl.canvas as HTMLCanvasElement;
      const ctn = this.ctnDom.nativeElement;
      if (ctn && canvas.parentNode === ctn) {
        ctn.removeChild(canvas);
      }
      const loseContext = this.gl.getExtension("WEBGL_lose_context");
      if (loseContext) {
        loseContext.loseContext();
      }
    }
  }
}