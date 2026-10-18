import { ComponentFixture, TestBed } from '@angular/core/testing';

import { InfiniteBackgroundComponent } from './infinite-background.component';

describe('InfiniteBackgroundComponent', () => {
  let component: InfiniteBackgroundComponent;
  let fixture: ComponentFixture<InfiniteBackgroundComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [ InfiniteBackgroundComponent ]
    })
    .compileComponents();

    fixture = TestBed.createComponent(InfiniteBackgroundComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
