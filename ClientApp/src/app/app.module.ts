import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { AppRoutingModule } from './app-routing.module';
import { AppComponent } from './app.component';
import { NgbModule } from '@ng-bootstrap/ng-bootstrap';
import { NavbarComponent } from './navbar/navbar.component';
import { HomeComponent } from './home/home.component';
import { FooterComponent } from './footer/footer.component';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import {HttpClientModule} from '@angular/common/http';
import { ChatComponent } from './chat/chat.component';
import { ChatInputComponent } from './chat-input/chat-input.component';
import { MessagesComponent } from './messages/messages.component';
import { PrivateChatComponent } from './private-chat/private-chat.component';
import { InfiniteBackgroundComponent } from './shared/infinite-background/infinite-background.component';
import { AuroraBackgroundComponent } from './aurora-background/aurora-background.component';
import { LightRaysBackgroundComponent } from './light-rays-background/light-rays-background.component';
import { InfoPageComponent } from './info-page/info-page.component'
import { DateFormatterPipe } from './pipes/date-formatter.pipe';
import { ErrorHandler } from '@angular/core';
import { GlobalErrorHandler } from './services/global-error-handler';

@NgModule({
  declarations: [
    AppComponent,
    NavbarComponent,
    HomeComponent,
    FooterComponent,
    ChatComponent,
    ChatInputComponent,
    MessagesComponent,
    PrivateChatComponent,
    InfiniteBackgroundComponent,
    AuroraBackgroundComponent,
    LightRaysBackgroundComponent,
    InfoPageComponent,
    DateFormatterPipe
  ],
  imports: [
    BrowserModule,
    AppRoutingModule,
    NgbModule,
    ReactiveFormsModule,
    HttpClientModule,
    FormsModule
  ],
  providers: [{ provide: ErrorHandler, useClass: GlobalErrorHandler }],
  bootstrap: [AppComponent]
})
export class AppModule { }
