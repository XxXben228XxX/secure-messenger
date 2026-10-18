// src/app/services/auth.service.ts
import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, Subject, of, throwError, BehaviorSubject } from 'rxjs';
import { tap, map, catchError, switchMap } from 'rxjs/operators';
import { environment } from '../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private _userName = new BehaviorSubject<string | null>(null);
  public userName$ = this._userName.asObservable();

  private loginSuccessSource = new Subject<void>();
  public loginSuccess$ = this.loginSuccessSource.asObservable();

  private logoutSuccessSource = new Subject<void>();
  public logoutSuccess$ = this.logoutSuccessSource.asObservable();

  constructor(private http: HttpClient) { }

  // 🟢 CORRECTED login() method
  login(credentials: any): Observable<any> {
    return this.http.post<any>(`${environment.apiUrl}/api/Chat/login`, credentials, {
      withCredentials: true
    }).pipe(
      tap(() => console.log('Login request sent to server.')),
      switchMap(() => this.checkAndFetchCurrentUser()),
      
      // ✅ switchMap замість tap — тепер можемо кинути реальну помилку
      switchMap((name: string | null) => {
        if (name) {
          console.log(`Login successful for user: ${name}`);
          this.loginSuccessSource.next();
          return of(name);
        } else {
          console.error('Session was not established after login.');
          this._userName.next(null);
          return throwError(() => new Error('Session not established'));
        }
      }),
      
      catchError(error => {
        console.error('Login failed:', error);
        this._userName.next(null);
        return throwError(() => error);
      })
    );
  }

  // 🟢 CORRECTED register() method
  register(credentials: any): Observable<any> {
    return this.http.post(`${environment.apiUrl}/api/Chat/register`, credentials, {
      withCredentials: true
    }).pipe(
      tap(() => console.log('Registration request sent.')),
      // After a successful registration, it immediately switches to the login stream.
      switchMap(() => this.login(credentials)),
      catchError(error => {
        console.error('Registration or auto-login failed:', error);
        this._userName.next(null);
        return throwError(() => error);
      })
    );
  }

  // 🟢 CORRECTED logout() method
  logout(): Observable<any> {
    return this.http.post(`${environment.apiUrl}/api/Chat/logout`, {}, { withCredentials: true }).pipe(
      tap(() => {
        console.log('Logout successful on the server.');
        this._userName.next(null);
        this.logoutSuccessSource.next();
      }),
      catchError(err => {
        console.error('Error during server logout, but clearing local session anyway:', err);
        // Even if the server logout fails, we must clear the client-side state.
        this._userName.next(null);
        this.logoutSuccessSource.next();
        return of(null); // Return a successful observable to prevent breaking the chain
      })
    );
  }

  // checkAndFetchCurrentUser() remains largely the same.
  public checkAndFetchCurrentUser(): Observable<string | null> {
    return this.http.get<any>(`${environment.apiUrl}/api/Chat/current-user`, { withCredentials: true }).pipe(
      map(user => {
        const name = user && user.name ? user.name : null;
        this._userName.next(name);
        return name;
      }),
      catchError(err => {
        if (err.status === 401) {
          console.warn('Current user check failed with 401, assuming no session.');
          this._userName.next(null);
          return of(null);
        }
        return throwError(() => err);
      })
    );
  }

  public get currentUserName(): string | null {
    return this._userName.value;
  }
}