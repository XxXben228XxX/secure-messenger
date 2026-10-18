import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AuroraBackgroundComponent } from './aurora-background.component';

describe('AuroraBackgroundComponent', () => {
  let component: AuroraBackgroundComponent;
  let fixture: ComponentFixture<AuroraBackgroundComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [ AuroraBackgroundComponent ]
    })
    .compileComponents();

    fixture = TestBed.createComponent(AuroraBackgroundComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
