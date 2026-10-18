import { ComponentFixture, TestBed } from '@angular/core/testing';

import { LightRaysBackgroundComponent } from './light-rays-background.component';

describe('LightRaysBackgroundComponent', () => {
  let component: LightRaysBackgroundComponent;
  let fixture: ComponentFixture<LightRaysBackgroundComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [ LightRaysBackgroundComponent ]
    })
    .compileComponents();

    fixture = TestBed.createComponent(LightRaysBackgroundComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
