import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { HomeComponent } from './home/home.component';
import { InfoPageComponent } from './info-page/info-page.component'; // ✅ Імпортуємо компонент

const routes: Routes = [
  { path: '', component: HomeComponent },
  { path: 'privacy-policy', component: InfoPageComponent },
  { path: 'terms-of-service', component: InfoPageComponent },
  { path: 'about', component: InfoPageComponent },
  { path: 'contact', component: InfoPageComponent },
  { path: 'faq', component: InfoPageComponent },
  { path: '**', redirectTo: '' } // Перенаправлення неіснуючих маршрутів на головну
];

@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports: [RouterModule]
})
export class AppRoutingModule { }