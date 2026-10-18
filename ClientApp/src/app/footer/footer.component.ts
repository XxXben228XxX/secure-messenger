// src/app/shared/footer/footer.component.ts
import { Component, HostListener } from '@angular/core';

@Component({
  selector: 'app-footer',
  templateUrl: './footer.component.html',
  styleUrls: ['./footer.component.css']
})
export class FooterComponent {
  get currentYear(): number {
    return new Date().getFullYear();
  }

  isAtBottom: boolean = false;
  isCollapsed: boolean = false;

  // Додаємо прийняття параметра (event) або використовуємо $event всередині
  @HostListener('window:scroll', ['$event'])
  onScroll(event: Event) {
    const windowHeight = window.innerHeight;
    const documentHeight = document.documentElement.scrollHeight;
    const scrollTop = document.documentElement.scrollTop || document.body.scrollTop;
    
    this.isAtBottom = (scrollTop + windowHeight >= documentHeight);
  }
  
  toggleCollapse(): void {
    this.isCollapsed = !this.isCollapsed;
  }
}