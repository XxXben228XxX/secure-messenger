// src/app/info-page/info-page.component.ts
import { Component, OnInit, OnDestroy } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-info-page',
  templateUrl: './info-page.component.html',
  styleUrls: ['./info-page.component.css']
})
export class InfoPageComponent implements OnInit, OnDestroy {
  private fragmentSubscription: Subscription | undefined;

  constructor(private route: ActivatedRoute) { }

  ngOnInit(): void {
    // Підписуємося на зміни фрагменту URL
    this.fragmentSubscription = this.route.fragment.subscribe(fragment => {
      if (fragment) {
        // Затримка, щоб дозволити Angular відобразити DOM
        setTimeout(() => {
          const element = document.getElementById(fragment);
          if (element) {
            element.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        }, 100);
      }
    });
  }

  ngOnDestroy(): void {
    if (this.fragmentSubscription) {
      this.fragmentSubscription.unsubscribe();
    }
  }
}